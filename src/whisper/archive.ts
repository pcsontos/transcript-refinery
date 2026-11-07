import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { audioId, type AudioStore } from '../fetch/audio/store.js'
import type { WhisperDirs } from './paths.js'

/** Az archívum egy hangja az `info.json` adataival. */
export interface AudioEntry {
  /** `audioId(key)`: videó-azonosító vagy `[url-hash]`. */
  id: string
  /** Tároló-relatív út. */
  key: string
  /** Kiterjesztés pont nélkül. */
  ext: string
  title: string
  /** `info.channel`, `info.uploader`, különben az archívumkulcs első mappaneve a ` [<…>]` nélkül. */
  channel: string
  duration: number | null
  /** ÉÉÉÉ-HH-NN. */
  date: string | null
  /** A nyers archív `info.json`, vagy `{}`. */
  info: Record<string, unknown>
}

export type TranscriptStatus = 'archived' | 'pending' | 'working' | 'done' | 'failed'

export const STATUS_LABEL: Record<TranscriptStatus, string> = {
  archived: 'archivált',
  pending: 'vár',
  working: 'átírás alatt',
  done: 'kész',
  failed: 'hibás',
}

export interface StatusContext {
  srtIds: Set<string>
  dirs: WhisperDirs | null
  dirFiles: { inbox: string[]; work: string[]; failed: string[] }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

function entryDate(info: Record<string, unknown>): string | null {
  const upload = text(info.upload_date)
  if (upload !== null && /^\d{8}$/.test(upload)) return `${upload.slice(0, 4)}-${upload.slice(4, 6)}-${upload.slice(6)}`
  if (typeof info.timestamp === 'number') return new Date(info.timestamp * 1000).toISOString().slice(0, 10)
  return null
}

async function readInfo(store: AudioStore, key: string): Promise<Record<string, unknown>> {
  try {
    const body = await store.read(key.replace(/\.[A-Za-z0-9]+$/, '.info.json'))
    if (body === null) return {}
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function toEntry(key: string, id: string, info: Record<string, unknown>): AudioEntry {
  const parts = key.split('/')
  const file = parts[parts.length - 1] ?? key
  const ext = /\.([A-Za-z0-9]+)$/.exec(file)?.[1] ?? ''
  const fromName = file.replace(/ \[[A-Za-z0-9_-]+\]\.[A-Za-z0-9]+$/, '')
  const folder = parts.length > 1 ? (parts[0] ?? '').replace(/ \[[^\]]*\]$/, '') : ''
  return {
    id,
    key,
    ext,
    title: text(info.title) ?? fromName,
    channel: text(info.channel) ?? text(info.uploader) ?? folder,
    duration: typeof info.duration === 'number' ? info.duration : null,
    date: entryDate(info),
    info,
  }
}

/** Az archívum hangjai dátum szerint csökkenő sorrendben, azonosítónként az első; dátum nélküliek a végén. */
export async function listArchive(store: AudioStore): Promise<{ entries: AudioEntry[]; warning?: string }> {
  const { keys, warning } = await store.existing()
  const seen = new Set<string>()
  const entries: AudioEntry[] = []
  for (const key of keys) {
    const id = audioId(key)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    entries.push(toEntry(key, id, await readInfo(store, key)))
  }
  entries.sort((a, b) => (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) || (b.date ?? '').localeCompare(a.date ?? ''))
  return warning === undefined ? { entries } : { entries, warning }
}

/** done > working > pending (`inbox/<id>.<ext>`, a `.partial` nem) > failed > archived. */
export function transcriptStatus(entry: AudioEntry, ctx: StatusContext): TranscriptStatus {
  if (ctx.srtIds.has(entry.id)) return 'done'
  if (ctx.dirs === null) return 'archived'
  const own = (name: string): boolean => name.startsWith(`${entry.id}.`)
  if (ctx.dirFiles.work.some(own)) return 'working'
  if (ctx.dirFiles.inbox.includes(`${entry.id}.${entry.ext}`)) return 'pending'
  if (ctx.dirFiles.failed.some(own)) return 'failed'
  return 'archived'
}

const SRT_NAME = /^(.+)\.[a-z]{2,3}(?:-[A-Za-z]{2,4})?\.srt$/

async function names(dir: string, recursive = false): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function statusContext(sourcesRoot: string, dirs: WhisperDirs | null): Promise<StatusContext> {
  const srtIds = new Set<string>()
  for (const name of await names(join(sourcesRoot, 'whisper'), true)) {
    const id = SRT_NAME.exec(name)?.[1]
    if (id !== undefined) srtIds.add(id)
  }
  return {
    srtIds,
    dirs,
    dirFiles:
      dirs === null
        ? { inbox: [], work: [], failed: [] }
        : { inbox: await names(dirs.inbox), work: await names(dirs.work), failed: await names(dirs.failed) },
  }
}

/** A `failed/<id>.log` utolsó nem üres sora. */
export async function failedReason(dirs: WhisperDirs, id: string): Promise<string | null> {
  try {
    const lines = (await readFile(join(dirs.failed, `${id}.log`), 'utf8')).split('\n').map((line) => line.trim())
    return lines.filter((line) => line !== '').pop() ?? null
  } catch {
    return null
  }
}
