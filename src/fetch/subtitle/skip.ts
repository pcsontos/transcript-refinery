import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSegment } from '../../vault/sanitize.js'

const SUB = /^(.*) \[([A-Za-z0-9_-]{11})\]\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(vtt|srt)$/i
const INFO = /^(.*) \[([A-Za-z0-9_-]{11})\]\.info\.json$/i

export function videoDir(out: string, channel: string, flat: boolean): string {
  if (flat) return out
  const segment = channel.trim() === '' ? 'névtelen' : sanitizeSegment(channel)
  return join(out, segment)
}

export function playlistDir(out: string, title: string, playlistId: string, flat: boolean): string {
  if (flat) return out
  const label = title.trim() === '' ? `[${playlistId}]` : `${title} [${playlistId}]`
  return join(out, sanitizeSegment(label))
}

function languageMatches(tag: string, languages: readonly string[]): boolean {
  const lower = tag.toLowerCase()
  return languages.some((wanted) => lower.startsWith(wanted.toLowerCase()))
}

async function jsonId(path: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { id?: unknown }
    return typeof raw.id === 'string' ? raw.id : null
  } catch {
    return null
  }
}

/** A célmappa egy szintje. A hiányzó mappa nem kész. */
export async function alreadyFetched(
  dir: string,
  videoId: string,
  languages: readonly string[],
): Promise<boolean> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return false
  }
  let subtitle = false
  let info = false
  for (const name of names) {
    const sub = SUB.exec(name)
    if (sub?.[2] === videoId && sub[3] !== undefined && languageMatches(sub[3], languages)) {
      const file = await stat(join(dir, name))
      if (file.size > 0) subtitle = true
    }
    const meta = INFO.exec(name)
    if (meta?.[2] === videoId && (await jsonId(join(dir, name))) === videoId) info = true
  }
  return subtitle && info
}

/** Üres felirat és idegen vagy törött info.json. Más videó fájlja marad. */
export async function prepareIncomplete(dir: string, videoId: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    const sub = SUB.exec(name)
    if (sub?.[2] === videoId && (await stat(path)).size === 0) await rm(path)
    const meta = INFO.exec(name)
    if (meta?.[2] === videoId && (await jsonId(path)) !== videoId) await rm(path)
  }
}
