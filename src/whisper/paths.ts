import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.js'

/** Az átírás-mappa almappái; az inbox-szerződés szerint (spec: Inbox-szerződés). */
export interface WhisperDirs {
  root: string
  inbox: string
  work: string
  failed: string
  heartbeat: string
}

/** Ennél régebbi életjel mellett a figyelő állónak számít. */
export const WATCHER_STALE_MS = 300_000

const MAX_SLUG = 60

/** Csatorna-név → szóköz- és ékezetmentes, kisbetűs, kötőjeles mappanév. */
export function channelSlug(channel: string): string {
  const slug = channel
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '')
  return slug === '' ? 'nevtelen' : slug
}

/** `null`, ha a mappa nem létezik: ilyenkor a whisper ki van kapcsolva, és nem hozunk létre semmit. */
export async function whisperDirs(cfg: Pick<Config, 'whisperDir'>): Promise<WhisperDirs | null> {
  try {
    if (!(await stat(cfg.whisperDir)).isDirectory()) return null
  } catch {
    return null
  }
  const root = cfg.whisperDir
  return {
    root,
    inbox: join(root, 'inbox'),
    work: join(root, 'work'),
    failed: join(root, 'failed'),
    heartbeat: join(root, 'heartbeat'),
  }
}

function localMinute(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Figyelmeztetés, ha az életjel hiányzik vagy régi; különben `null`. */
export async function watcherWarning(dirs: WhisperDirs, now: number = Date.now()): Promise<string | null> {
  let last: number | null
  try {
    last = (await stat(dirs.heartbeat)).mtimeMs
  } catch {
    last = null
  }
  if (last !== null && now - last <= WATCHER_STALE_MS) return null
  const when = last === null ? 'nincs' : localMinute(last)
  return `A whisper-figyelő nem fut (utolsó életjel: ${when}); a tétel sorban marad, és bejelentkezés után feldolgozódik.`
}
