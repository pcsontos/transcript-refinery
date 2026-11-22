import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Advance } from '../events.js'
import type { WhisperDirs } from './paths.js'

/** A figyelő inbox-szerződésének része (tools/whisper/README.md): az `info.json` leadó-munka mezője. */
export const JOB_FIELD = 'refinery_job'

/** Útvonal-biztonság: az azonosító a whisper-mappán belüli fájlnevekben szerepel. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export interface QueuedTranscript {
  id: string
  title: string
  state: 'queued' | 'working'
  /** A leadó Telegram-munka azonosítója (`refinery_job`); CLI-leadásnál `null`. */
  job: string | null
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function readInfo(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Az inbox sorban álló és futó átírásai, a legrégebbi előbb; a `cancel/<id>`-vel jelöltek kimaradnak. */
export async function listQueue(dirs: WhisperDirs): Promise<QueuedTranscript[]> {
  const cancelled = new Set(await names(dirs.cancel))
  const working = new Set(await names(dirs.work))
  const found: { id: string; mtime: number; title: string; job: string | null; state: 'queued' | 'working' }[] = []
  for (const name of await names(dirs.inbox)) {
    if (name.startsWith('.') || !name.endsWith('.info.json')) continue
    const id = name.slice(0, -'.info.json'.length)
    if (id === '' || cancelled.has(id)) continue
    const path = join(dirs.inbox, name)
    const mtime = await stat(path).then(
      (info) => info.mtimeMs,
      () => null,
    )
    if (mtime === null) continue
    const info = await readInfo(path)
    found.push({
      id,
      mtime,
      title: typeof info.title === 'string' && info.title !== '' ? info.title : id,
      job: typeof info[JOB_FIELD] === 'string' ? info[JOB_FIELD] : null,
      state: working.has(`${id}.working`) ? 'working' : 'queued',
    })
  }
  found.sort((a, b) => a.mtime - b.mtime || a.id.localeCompare(b.id))
  return found.map(({ id, title, state, job }) => ({ id, title, state, job }))
}

/** A figyelő `work/<id>.working` haladása; hiányzó, üres vagy hibás fájlnál `null`. */
export async function readAdvance(dirs: WhisperDirs, id: string): Promise<Advance | null> {
  if (!SAFE_ID.test(id)) return null
  try {
    const parsed = JSON.parse(await readFile(join(dirs.work, `${id}.working`), 'utf8')) as Record<string, unknown>
    if (typeof parsed.done !== 'number' || (parsed.total !== null && typeof parsed.total !== 'number')) return null
    if (parsed.unit !== 'bytes' && parsed.unit !== 'percent') return null
    return {
      done: parsed.done,
      total: parsed.total,
      unit: parsed.unit,
      ...(typeof parsed.text === 'string' ? { text: parsed.text } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Átírás megszakítása. `removed`: a tétel még sorban állt, az inbox- és `failed/` maradékait töröltük; a `cancel/<id>`
 * marad, hogy a figyelő, ha épp most vette fel, még lássa (a `_sweep_cancels` törli). `signalled`: fut, a figyelő takarít.
 */
export async function cancelTranscript(dirs: WhisperDirs, id: string): Promise<'removed' | 'signalled' | 'unknown'> {
  if (!SAFE_ID.test(id)) return 'unknown'
  const inbox = await names(dirs.inbox)
  const running = (await names(dirs.work)).includes(`${id}.working`)
  if (!running && !inbox.includes(`${id}.info.json`)) return 'unknown'
  await mkdir(dirs.cancel, { recursive: true })
  await writeFile(join(dirs.cancel, id), '')
  if (running) return 'signalled'
  const own = (dir: string) => (name: string) => rm(join(dir, name), { force: true })
  await Promise.all(inbox.filter((name) => name.startsWith(`${id}.`)).map(own(dirs.inbox)))
  await Promise.all((await names(dirs.failed)).filter((name) => name.startsWith(`${id}.`)).map(own(dirs.failed)))
  return 'removed'
}
