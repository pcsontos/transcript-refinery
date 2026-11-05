import { readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { sanitizeSegment } from '../../vault/sanitize.js'
import type { EventSink } from '../../events.js'
import { openRunLog, type RunLog } from '../../run/log.js'
import { reserveRunId, runId } from '../../run/id.js'
import { classifyAudioInput } from '../classify.js'
import type { Pick } from './args.js'
import { playlistDir, videoDir } from '../subtitle/skip.js'
import {
  audioDownloadArgs,
  parseFeedProbe,
  parsePlaylistProbe,
  parseVideoProbe,
  playlistProbeArgs,
  type ProcessResult,
  type ProcessRunner,
  versionArgs,
  videoProbeArgs,
  YTDLP_MISSING,
} from '../subtitle/ytdlp.js'
import { directTarget, downloadDirect } from './direct.js'
import { detectFeed, feedHash, feedMessages, resolvePick } from './feed.js'
import { audioId, type AudioStore } from './store.js'

export type AudioOutcome = 'downloaded' | 'skipped' | 'failed' | 'uploaded' | 'listed'

export interface AudioRow {
  outcome: AudioOutcome
  label: string
  reason?: string
}

export function rowLine(row: AudioRow): string {
  switch (row.outcome) {
    case 'downloaded':
      return `letöltve: ${row.label}`
    case 'skipped':
      return `kihagyva: ${row.label}`
    case 'uploaded':
      return `feltöltve (korábbi letöltés): ${row.label}`
    case 'listed':
      return ''
    case 'failed':
      return `hiba: ${row.label}: ${row.reason ?? 'ismeretlen hiba'}`
  }
}

export function audioSummary(rows: readonly AudioRow[]): string {
  const count = (outcome: AudioOutcome) => rows.filter((row) => row.outcome === outcome).length
  const uploaded = count('uploaded')
  const base = `Kész: letöltve ${count('downloaded')} db fájl, ${count('skipped')} kihagyva, ${count('failed')} hibás.`
  return uploaded > 0 ? `${base} Korábbi letöltésből feltöltve: ${uploaded}.` : base
}

export interface AudioRunDeps {
  store: AudioStore
  runner: ProcessRunner
  fetchImpl?: typeof fetch
  overwrite: boolean
  yesPlaylist: boolean
  playlistItems?: string
  /** Feed-epizódok kiválasztása; nélküle a feed listázása történik. */
  pick?: Pick
  /** A feed-lista üzeneteinek legfeljebb ekkora hossza (a serve 4000-et ad). */
  listLimit?: number
  stopped: () => boolean
  /** Minden sor (figyelmeztetés is) ezen megy ki; a mag megvárja. */
  emit: (line: string) => void | Promise<void>
  /** A futásnapló eseményei; hiányában nincs napló. */
  sink?: EventSink
}

/** Új futásnapló a `logsDir` alatt, `run:started` sorral. A hívó zárja: `run:ended`, aztán `close()`. */
export function openAudioRunLog(logsDir: string, command: string): RunLog {
  const id = reserveRunId(logsDir, runId(new Date()))
  const log = openRunLog(join(logsDir, `${id}.jsonl`))
  log.sink({ type: 'run:started', command, pid: process.pid })
  return log
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? ''
}

const FIRST_TITLE_LINE = (title: string | undefined): string | undefined => title?.split(/\r?\n/)[0]?.trim() || undefined

export async function runAudioFetch(inputs: readonly string[], deps: AudioRunDeps): Promise<AudioRow[]> {
  const { store } = deps
  const rows: AudioRow[] = []
  const sink = deps.sink ?? (() => undefined)

  async function runCmd(args: readonly string[]): Promise<ProcessResult> {
    try {
      return await deps.runner(args)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(YTDLP_MISSING, { cause: error })
      throw error
    }
  }

  async function row(next: AudioRow, terminal?: Parameters<EventSink>[0]): Promise<void> {
    rows.push(next)
    if (terminal !== undefined) sink(terminal)
    if (next.outcome !== 'listed') await deps.emit(rowLine(next))
  }

  const failed = (label: string, reason: string, itemId: string): Promise<void> =>
    row({ outcome: 'failed', label, reason }, { type: 'item:failed', itemId, source: 'audio', kind: 'audio', error: reason })

  const skipped = (label: string, itemId: string): Promise<void> =>
    row({ outcome: 'skipped', label }, { type: 'item:skipped', itemId, reason: 'már a tárolóban' })

  const version = await runCmd(versionArgs())
  if (version.code !== 0) throw new Error(firstLine(version.stderr) || 'A yt-dlp --version nem sikerült.')

  const pendingGroups = await store.pending()
  let total = inputs.length + pendingGroups.length
  sink({ type: 'scan:found', count: total })

  // 1. A korábbi, még fel nem töltött letöltések.
  for (const group of pendingGroups) {
    const audio = group[0] as string
    const itemId = audioId(audio) ?? audio
    const label = basename(audio)
    sink({ type: 'item:start', itemId, title: label })
    sink({ type: 'item:step', itemId, step: 'feltöltés S3-ba' })
    try {
      await store.commit(group)
      await row({ outcome: 'uploaded', label }, { type: 'item:published', itemId, path: audio })
    } catch {
      await failed(label, 'a feltöltés nem sikerült', itemId)
    }
  }

  // 2. A tároló meglévő hangjai.
  const existing = await store.existing()
  if (existing.warning !== undefined) await deps.emit(existing.warning)
  const ids = new Set(existing.keys.flatMap((key) => audioId(key) ?? []))

  /** A letöltött fájl és az info.json a `dest` mappában; a tároló-relatív utak. */
  async function findDownloaded(destRel: string, id: string): Promise<string[] | null> {
    let names: string[]
    try {
      names = await readdir(join(store.staging, destRel))
    } catch {
      return null
    }
    const audio = names.find((name) => audioId(name) === id)
    if (audio === undefined) return null
    const info = audio.replace(/\.[A-Za-z0-9]+$/, '.info.json')
    const hasInfo = await stat(join(store.staging, destRel, info)).then(() => true, () => false)
    return [join(destRel, audio), ...(hasInfo ? [join(destRel, info)] : [])]
  }

  async function commitItem(paths: readonly string[], id: string, label: string): Promise<void> {
    if (store.remote) sink({ type: 'item:step', itemId: id, step: 'feltöltés S3-ba' })
    try {
      await store.commit(paths)
    } catch {
      await failed(label, 'a feltöltés nem sikerült; a fájl a munkamappában maradt', id)
      return
    }
    await row({ outcome: 'downloaded', label }, { type: 'item:published', itemId: id, path: paths[0] as string })
  }

  async function fetchVideo(url: string, destOf: (channel: string) => string, fallbackTitle?: string): Promise<void> {
    const probeResult = await runCmd(videoProbeArgs(url))
    const probe = probeResult.code === 0 ? parseVideoProbe(probeResult.stdout) : null
    if (probe === null) {
      sink({ type: 'item:start', itemId: url, title: url })
      await failed(url, probeResult.code !== 0 ? firstLine(probeResult.stderr) || 'letöltési hiba' : 'hiányzó videóazonosító', url)
      return
    }
    const title = FIRST_TITLE_LINE(probe.title) ?? FIRST_TITLE_LINE(fallbackTitle) ?? probe.id
    const label = `${title} [${probe.id}]`
    sink({ type: 'item:start', itemId: probe.id, title: label })
    if (ids.has(probe.id) && !deps.overwrite) {
      await skipped(label, probe.id)
      return
    }
    const destRel = destOf(probe.channel ?? '')
    sink({ type: 'item:step', itemId: probe.id, step: 'letöltés' })
    const download = await runCmd(audioDownloadArgs({ url, dest: join(store.staging, destRel), overwrite: deps.overwrite }))
    const paths = await findDownloaded(destRel, probe.id)
    if (paths === null) {
      await failed(label, (download.code !== 0 ? firstLine(download.stderr) : '') || 'nincs hangfájl', probe.id)
      return
    }
    ids.add(probe.id)
    await commitItem(paths, probe.id, label)
  }

  async function fetchFeed(url: string): Promise<void> {
    if (inputs.length > 1) {
      sink({ type: 'item:start', itemId: url, title: url })
      return failed(url, 'a feedet egyedül add meg', url)
    }
    const probeResult = await runCmd(playlistProbeArgs(url))
    const feed = probeResult.code === 0 ? parseFeedProbe(probeResult.stdout) : null
    if (feed === null) {
      sink({ type: 'item:start', itemId: url, title: url })
      return failed(url, 'a feed nem olvasható', url)
    }
    if (deps.pick === undefined) {
      for (const message of feedMessages(url, feed, deps.listLimit)) await deps.emit(message)
      await row({ outcome: 'listed', label: url })
      return
    }
    const picked = resolvePick(deps.pick, feed.entries.length)
    if (!picked.ok) {
      sink({ type: 'item:start', itemId: url, title: url })
      return failed(url, picked.reason, url)
    }
    total += picked.indexes.length - 1
    sink({ type: 'scan:found', count: total })
    const dir = playlistDir('', feed.title, feedHash(url), false)
    for (const index of picked.indexes) {
      if (deps.stopped()) return
      const entry = feed.entries[index]
      if (entry === undefined) continue
      const hash = directTarget(entry.url).hash
      const label = `${entry.title} [${hash}]`
      sink({ type: 'item:start', itemId: hash, title: label })
      if (ids.has(hash) && !deps.overwrite) {
        await skipped(label, hash)
        continue
      }
      sink({ type: 'item:step', itemId: hash, step: 'letöltés' })
      const result = await downloadDirect(entry.url, store.staging, deps.fetchImpl, { dir, name: sanitizeSegment(entry.title) })
      if (!result.ok) {
        await failed(entry.url, 'reason' in result ? result.reason : 'nem hangfájl (feed)', hash)
        continue
      }
      const info = result.path.replace(/\.[A-Za-z0-9]+$/, '.info.json')
      await writeFile(join(store.staging, info), JSON.stringify(entry.raw, null, 2))
      ids.add(hash)
      await commitItem([result.path, info], hash, label)
    }
  }

  async function fetchDirect(url: string): Promise<void> {
    // A feedet előre felismerjük (csak kiterjesztés nélküli URL-nél kér le), így listázáskor nincs item:* esemény.
    if (await detectFeed(url, deps.fetchImpl)) return fetchFeed(url)
    if (deps.pick !== undefined) {
      sink({ type: 'item:start', itemId: url, title: url })
      return failed(url, 'a --pick csak feedhez adható meg', url)
    }
    const target = directTarget(url)
    const label = `${target.name} [${target.hash}]`
    sink({ type: 'item:start', itemId: target.hash, title: label })
    if (ids.has(target.hash) && !deps.overwrite) {
      await skipped(label, target.hash)
      return
    }
    sink({ type: 'item:step', itemId: target.hash, step: 'letöltés' })
    const result = await downloadDirect(url, store.staging, deps.fetchImpl)
    if (!result.ok) {
      await failed(url, 'reason' in result ? result.reason : 'podcast-feed', target.hash)
      return
    }
    ids.add(target.hash)
    await commitItem([result.path], target.hash, label)
  }

  async function fetchPlaylist(url: string): Promise<void> {
    const result = await runCmd(playlistProbeArgs(url, deps.playlistItems))
    const fail = async (reason: string): Promise<void> => {
      sink({ type: 'item:start', itemId: url, title: url })
      await failed(url, reason, url)
    }
    if (result.code !== 0) return fail(firstLine(result.stderr) || 'ismeretlen hiba')
    const probe = parsePlaylistProbe(result.stdout)
    if (probe === null) return fail('hiányzó listaazonosító')
    if (probe.entries.length === 0) return fail('a lista üres')
    total += probe.entries.length - 1
    sink({ type: 'scan:found', count: total })
    const destRel = playlistDir('', probe.title ?? '', probe.id, false)
    for (const entry of probe.entries) {
      if (deps.stopped()) return
      if (entry.id === undefined) {
        sink({ type: 'item:start', itemId: url, title: url })
        await failed(url, 'hiányzó videóazonosító', url)
        continue
      }
      await fetchVideo(`https://www.youtube.com/watch?v=${entry.id}`, () => destRel, entry.title)
    }
  }

  for (const raw of inputs) {
    if (deps.stopped()) break
    const classified = classifyAudioInput(raw, deps.yesPlaylist)
    if (deps.pick !== undefined && classified.kind !== 'direct') {
      sink({ type: 'item:start', itemId: classified.kind === 'rejected' ? classified.raw : classified.url, title: raw })
      await failed(raw, 'a --pick csak feedhez adható meg', raw)
    } else if (classified.kind === 'rejected') {
      sink({ type: 'item:start', itemId: classified.raw, title: classified.raw })
      await failed(classified.raw, 'nem URL', classified.raw)
    } else if (classified.kind === 'direct') {
      await fetchDirect(classified.url)
    } else if (classified.kind === 'video') {
      await fetchVideo(classified.url, (channel) => videoDir('', channel, false))
    } else {
      await fetchPlaylist(classified.url)
    }
  }

  const count = (outcome: AudioOutcome) => rows.filter((r) => r.outcome === outcome).length
  sink({ type: 'run:done', succeeded: count('downloaded') + count('uploaded'), skipped: count('skipped'), failed: count('failed') })
  return rows
}
