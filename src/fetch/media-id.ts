import { createHash } from 'node:crypto'

const UNSAFE = /[^A-Za-z0-9_-]/g

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Egy tétel azonosítója a yt-dlp kinyerőjéből. YouTube és kinyerő nélküli tétel (feed-epizód, szöveges, whisper):
 * a puszta `id`, változatlanul. Más kinyerő: `<kinyerő>-<id>`; Generic: `generic-<webpage_url sha256 első 8 hex>`.
 * A lapos listaelemben nincs `extractor_key`, csak `ie_key`. Kettőspont soha nincs benne (a Worker `videoIdOf`-ja az
 * utolsó `:`-nál vág). `null`, ha nincs használható azonosító.
 */
export function mediaId(info: {
  extractor_key?: unknown
  ie_key?: unknown
  id?: unknown
  webpage_url?: unknown
}): string | null {
  const id = text(info.id)
  if (id === undefined) return null
  const extractor = text(info.extractor_key) ?? text(info.ie_key)
  if (extractor === undefined || extractor.toLowerCase() === 'youtube') return id
  if (extractor.toLowerCase() === 'generic') {
    const url = text(info.webpage_url)
    if (url === undefined) return null
    return `generic-${createHash('sha256').update(url).digest('hex').slice(0, 8)}`
  }
  return `${extractor.toLowerCase().replace(UNSAFE, '_')}-${id.replace(UNSAFE, '_')}`
}
