import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { sanitizeSegment } from '../../vault/sanitize.js'

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'webm', 'mka']
export const FEED_TYPES = ['application/rss+xml', 'application/xml', 'text/xml']

const TYPE_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/webm': 'webm',
}

export interface DirectTarget {
  dir: string
  name: string
  hash: string
  ext: string | null
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Hova kerül egy közvetlen URL; a hash a `#` utáni rész nélküli URL-ből jön. */
export function directTarget(url: string): DirectTarget {
  const trimmed = url.trim()
  const parsed = new URL(trimmed)
  const last = parsed.pathname.split('/').filter((part) => part !== '').pop() ?? ''
  const decoded = safeDecode(last)
  const dot = decoded.lastIndexOf('.')
  const extRaw = dot > 0 ? decoded.slice(dot + 1).toLowerCase() : ''
  return {
    dir: sanitizeSegment(parsed.hostname.replace(/^www\./i, '')),
    name: sanitizeSegment(dot > 0 ? decoded.slice(0, dot) : decoded),
    hash: createHash('sha256').update(trimmed.split('#')[0] ?? trimmed).digest('hex').slice(0, 8),
    ext: AUDIO_EXTENSIONS.includes(extRaw) ? extRaw : null,
  }
}

const baseType = (contentType: string | null): string | null => contentType?.split(';')[0]?.trim().toLowerCase() || null

export function extensionFor(contentType: string | null): string | null {
  const type = baseType(contentType)
  return type === null ? null : (TYPE_EXTENSIONS[type] ?? null)
}

export type DirectResult = { ok: true; path: string } | { ok: false; reason: string } | { ok: false; feed: true }

export async function downloadDirect(
  url: string,
  staging: string,
  fetchImpl: typeof fetch = fetch,
  target?: { dir: string; name: string },
): Promise<DirectResult> {
  const info = directTarget(url)
  let response: Response
  try {
    response = await fetchImpl(url.trim().split('#')[0] ?? url)
  } catch (error) {
    return { ok: false, reason: (error as Error).message }
  }
  if (!response.ok) {
    await response.body?.cancel()
    return { ok: false, reason: `HTTP ${response.status}` }
  }
  const type = baseType(response.headers.get('content-type'))
  // A hangkiterjesztésű URL sem hang, ha a szerver HTML-t, XML-t vagy JSON-t ad (lejárt link, hibaoldal).
  const textual = type !== null && (type.startsWith('text/') || FEED_TYPES.includes(type) || /^application\/(?:json|xhtml\+xml)$/.test(type))
  const ext = textual && info.ext !== null ? null : (info.ext ?? extensionFor(type))
  if (ext === null) {
    await response.body?.cancel()
    if (target === undefined && info.ext === null && type !== null && FEED_TYPES.includes(type)) return { ok: false, feed: true }
    return { ok: false, reason: `nem hangfájl (${type ?? 'ismeretlen'})` }
  }
  const path = `${target?.dir ?? info.dir}/${target?.name ?? info.name} [${info.hash}].${ext}`
  const part = `${join(staging, path)}.part`
  try {
    await mkdir(dirname(part), { recursive: true })
    if (response.body === null) throw new Error('üres válasz')
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part))
    await rename(part, join(staging, path))
  } catch (error) {
    await rm(part, { force: true })
    return { ok: false, reason: (error as Error).message }
  }
  return { ok: true, path }
}
