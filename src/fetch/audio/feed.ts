import { createHash } from 'node:crypto'
import { FEED_TYPES, directTarget } from './direct.js'
import type { FeedEntry, FeedProbe } from '../subtitle/ytdlp.js'
import type { Pick } from './args.js'

export type { FeedEntry, FeedProbe }

/** A feed URL-jének azonosítója a mappanévben: a trimelt URL sha256-jának első 8 hex jegye. */
export function feedHash(url: string): string {
  return createHash('sha256').update(url.trim()).digest('hex').slice(0, 8)
}

/** `ó:pp:mm`; `—`, ha nincs hossz. */
export function audioDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** `<N>. <cím> — <ÉÉÉÉ-HH-NN>, <ó:pp:mm>`; a hiányzó rész kimarad. */
export function feedListLines(feed: FeedProbe): string[] {
  return feed.entries.map((entry, index) => {
    const parts = [
      entry.timestamp === null ? null : new Date(entry.timestamp * 1000).toISOString().slice(0, 10),
      entry.duration === null ? null : audioDuration(entry.duration),
    ].filter((part): part is string => part !== null)
    return `${index + 1}. ${entry.title}${parts.length === 0 ? '' : ` — ${parts.join(', ')}`}`
  })
}

/** A sorok üzenetekre bontva, mindegyik a `header`-rel kezdődik; `limit` nélkül egyetlen üzenet. A túl hosszú sort levágja. */
export function chunkMessages(header: string, lines: readonly string[], limit?: number): string[] {
  if (limit === undefined) return [header + lines.join('\n')]
  const room = Math.max(limit - header.length, 2)
  const messages: string[] = []
  let current = ''
  for (const raw of lines) {
    const line = raw.length > room ? `${raw.slice(0, room - 1)}…` : raw
    if (current !== '' && header.length + current.length + 1 + line.length > limit) {
      messages.push(header + current)
      current = line
    } else {
      current = current === '' ? line : `${current}\n${line}`
    }
  }
  messages.push(header + current)
  return messages
}

/** A lista üzenetekre bontva; mindegyik a feed címével és a `Feed:` sorral kezdődik. */
export function feedMessages(feedUrl: string, feed: FeedProbe, limit?: number): string[] {
  return chunkMessages(`${feed.title.slice(0, 200)}\nFeed: ${feedUrl}\n`, feedListLines(feed), limit)
}

export function pickHint(feedUrl: string, surface: 'cli' | 'telegram'): string {
  return surface === 'cli'
    ? `Választás: refinery fetch audio ${feedUrl} --pick 1,3 (0 = mind)`
    : `Válaszolj erre vagy a lista bármelyik üzenetére a sorszámokkal: 0 = mind, vagy pl. 1,3.\nFeed: ${feedUrl}`
}

export function resolvePick(pick: Pick, count: number): { ok: true; indexes: number[] } | { ok: false; reason: string } {
  if (pick === 'all') return { ok: true, indexes: Array.from({ length: count }, (_, index) => index) }
  const bad = pick.find((n) => n > count)
  if (bad !== undefined) return { ok: false, reason: `érvénytelen sorszám: ${bad} (a feedben ${count} epizód van)` }
  return { ok: true, indexes: pick.map((n) => n - 1) }
}

/** Feed-e az URL: nincs hangkiterjesztése, és a Content-Type RSS/XML. A törzset eldobja. */
export async function detectFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (directTarget(url).ext !== null) return false
  try {
    const response = await fetchImpl(url.trim().split('#')[0] ?? url)
    await response.body?.cancel()
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    return response.ok && FEED_TYPES.includes(type)
  } catch {
    return false
  }
}
