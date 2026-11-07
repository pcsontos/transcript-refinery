import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { EventSink } from '../events.js'
import type { AudioStore } from '../fetch/audio/store.js'
import { parseLang } from '../fetch/subtitle/args.js'
import type { Config } from '../config.js'
import { findEntry, listArchive, statusContext, transcriptStatus, type AudioEntry, type TranscriptStatus } from './archive.js'
import { channelSlug, watcherWarning, whisperDirs, type WhisperDirs } from './paths.js'

const LANG_ERROR = 'A --lang értéke egyetlen nyelvkód, például hu vagy en-US.'

/** `--lang` > az archív `info.json` `language` mezője > a config első nyelve. */
export function resolveLang(input: { flag?: string; info: Record<string, unknown>; languages: readonly string[] }): string | null {
  const fromFlag = input.flag === undefined ? null : parseLang(input.flag)
  if (fromFlag !== null) return fromFlag
  const fromInfo = typeof input.info.language === 'string' ? parseLang(input.info.language) : null
  if (fromInfo !== null) return fromInfo
  const first = input.languages[0]
  return first === undefined ? null : parseLang(first)
}

/** Az inboxba kerülő `info.json`: az archív tartalom, felülírt `id` és `channel`, plusz a refinery mezői. */
export function inboxInfo(entry: AudioEntry, lang: string): Record<string, unknown> {
  return {
    ...entry.info,
    id: entry.id,
    channel: entry.channel,
    refinery_lang: lang,
    refinery_target: `whisper/${channelSlug(entry.channel)}`,
  }
}

export type SubmitResult = { ok: true } | { ok: false; skip: 'kész' | 'vár' | 'átírás alatt' } | { ok: false; error: string }

const SKIP: Partial<Record<TranscriptStatus, 'kész' | 'vár' | 'átírás alatt'>> = {
  done: 'kész',
  pending: 'vár',
  working: 'átírás alatt',
}

/** Az `info.json` előbb, a hang utoljára, mindkettő `.partial` + átnevezéssel; hibánál nem marad semmi az inboxban. */
export async function submitEntry(
  entry: AudioEntry,
  deps: { store: AudioStore; dirs: WhisperDirs; status: TranscriptStatus; lang: string | null },
): Promise<SubmitResult> {
  const skip = SKIP[deps.status]
  if (skip !== undefined) return { ok: false, skip }
  if (deps.lang === null) return { ok: false, error: 'nincs nyelv: adj meg --lang kapcsolót' }
  const info = join(deps.dirs.inbox, `${entry.id}.info.json`)
  const audio = join(deps.dirs.inbox, `${entry.id}.${entry.ext}`)
  try {
    await mkdir(deps.dirs.inbox, { recursive: true })
    await writeFile(`${info}.partial`, JSON.stringify(inboxInfo(entry, deps.lang), null, 2))
    await rename(`${info}.partial`, info)
    await deps.store.copyTo(entry.key, `${audio}.partial`)
    await rename(`${audio}.partial`, audio)
    return { ok: true }
  } catch (error) {
    await Promise.all([info, `${info}.partial`, `${audio}.partial`].map((path) => rm(path, { force: true })))
    return { ok: false, error: (error as Error).message }
  }
}

export interface TranscribeArgs {
  ids: string[]
  lang?: string
  config?: string
}

export function parseTranscribeArgs(argv: readonly string[]): { ok: true; args: TranscribeArgs } | { ok: false; error: string } {
  let values: { lang?: string; config?: string }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { lang: { type: 'string' }, config: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (error) {
    const unknown = /Unknown option '(--[^']+)'/.exec((error as Error).message)
    return { ok: false, error: unknown?.[1] !== undefined ? `Ismeretlen kapcsoló: ${unknown[1]}` : (error as Error).message }
  }
  let lang: string | undefined
  if (values.lang !== undefined) {
    const tag = parseLang(values.lang)
    if (tag === null) return { ok: false, error: LANG_ERROR }
    lang = tag
  }
  const ids = [...new Set(positionals)]
  if (ids.length === 0) return { ok: false, error: 'Adj meg legalább egy hangot (videó-azonosító vagy a list --audios kulcsa).' }
  return { ok: true, args: { ids, lang, config: values.config } }
}

export interface TranscribeDeps {
  store: AudioStore
  dirs: WhisperDirs
  sourcesRoot: string
  languages: readonly string[]
  emit: (line: string) => void | Promise<void>
  sink?: EventSink
  stopped?: () => boolean
}

export async function runTranscribe(
  args: { ids: readonly string[]; lang?: string },
  deps: TranscribeDeps,
): Promise<{ submitted: number; failed: number }> {
  const sink = deps.sink ?? (() => undefined)
  const { entries, warning } = await listArchive(deps.store)
  if (warning !== undefined) await deps.emit(warning)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const ctx = await statusContext(deps.sourcesRoot, deps.dirs)
  const handedOver = new Set<string>()
  let submitted = 0
  let skipped = 0
  let failed = 0
  sink({ type: 'scan:found', count: args.ids.length })

  for (const id of args.ids) {
    if (deps.stopped?.() === true) break
    const entry = byId.get(id)
    if (entry === undefined) {
      failed += 1
      sink({ type: 'item:start', itemId: id, title: id })
      sink({ type: 'item:failed', itemId: id, source: 'whisper', kind: 'whisper', error: 'nincs ilyen hang' })
      await deps.emit(`hiba: ${id}: nincs ilyen hang`)
      continue
    }
    const label = `${entry.title} [${id}]`
    sink({ type: 'item:start', itemId: id, title: entry.title })
    const status = handedOver.has(id) ? 'pending' : transcriptStatus(entry, ctx)
    const lang = resolveLang({ flag: args.lang, info: entry.info, languages: deps.languages })
    const result = await submitEntry(entry, { store: deps.store, dirs: deps.dirs, status, lang })
    if ('error' in result) {
      failed += 1
      sink({ type: 'item:failed', itemId: id, source: 'whisper', kind: 'whisper', error: result.error })
      await deps.emit(`hiba: ${label}: ${result.error}`)
    } else if ('skip' in result) {
      skipped += 1
      sink({ type: 'item:skipped', itemId: id, reason: result.skip })
      await deps.emit(`kihagyva (${result.skip}): ${label}`)
    } else {
      submitted += 1
      handedOver.add(id)
      sink({ type: 'item:step', itemId: id, step: 'átírásra leadva' })
      sink({ type: 'item:published', itemId: id, path: `${id}.${entry.ext}` })
      await deps.emit(`leadva: ${label}`)
    }
  }

  await deps.emit(`${submitted} tétel leadva.`)
  const warn = await watcherWarning(deps.dirs)
  if (warn !== null) await deps.emit(warn)
  sink({ type: 'run:done', succeeded: submitted, skipped, failed })
  return { submitted, failed }
}

/**
 * A `fetch audio` fallback-leadása. `string` = a nem-elérhetőség oka. Mindig az archívumból ad le
 * (a friss letöltést is: Saját döntés 8), az állapotot hívásonként frissen olvassa.
 */
export async function createHandoff(input: {
  cfg: Config | null
  store: AudioStore
  lang?: string
}): Promise<{ handoff: (id: string) => Promise<string>; warning: () => Promise<string | null> }> {
  const { cfg, store } = input
  const dirs = cfg === null ? null : await whisperDirs(cfg)
  const handedOver = new Set<string>()
  return {
    async handoff(id) {
      if (cfg === null) return 'nincs config'
      if (dirs === null) return 'nincs whisper-mappa'
      const entry = await findEntry(store, id)
      if (entry === null) return 'nincs ilyen hang'
      const ctx = await statusContext(cfg.sources[0]!.path, dirs)
      const status = handedOver.has(id) ? 'pending' : transcriptStatus(entry, ctx)
      const lang = resolveLang({ flag: input.lang, info: entry.info, languages: cfg.languages })
      const result = await submitEntry(entry, { store, dirs, status, lang })
      if ('error' in result) return result.error
      if ('skip' in result) return 'skipped'
      handedOver.add(id)
      return 'submitted'
    },
    warning: async () => (dirs === null || handedOver.size === 0 ? null : watcherWarning(dirs)),
  }
}
