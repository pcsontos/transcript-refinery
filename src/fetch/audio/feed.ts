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

export interface FeedItemUrls {
  link?: string
  enclosure?: string
  media?: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_all, hex?: string, dec?: string, name?: string) => {
    if (name !== undefined) return ENTITIES[name.toLowerCase()] ?? _all
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec ?? '', 10)
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : _all
  })
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of tag.matchAll(/(\w+)=("[^"]*"|'[^']*')/g)) {
    result[match[1] as string] = decodeEntities((match[2] as string).slice(1, -1))
  }
  return result
}

/** Epizódonként a `<link>`, az `<enclosure url>` és az első hang-típusú `<media:content url>` (regexszel, XML-parser nélkül). */
export function feedMediaUrls(xml: string): FeedItemUrls[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((block) => {
    const item = block[0]
    const link = /<link>([\s\S]*?)<\/link>/.exec(item)?.[1]?.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim()
    const enclosure = [...item.matchAll(/<enclosure\b[^>]*>/g)].map((tag) => attributes(tag[0]).url).find((url) => url)
    const media = [...item.matchAll(/<media:content\b[^>]*>/g)]
      .map((tag) => attributes(tag[0]))
      .find((attr) => attr.url && attr.type?.toLowerCase().startsWith('audio/'))?.url
    return {
      ...(link ? { link: decodeEntities(link) } : {}),
      ...(enclosure ? { enclosure } : {}),
      ...(media ? { media } : {}),
    }
  })
}

const bare = (url: string | undefined): string | undefined => url?.split('#')[0]

/** A yt-dlp epizód-URL-je helyett a feed hangfájlja: az egyező tétel `enclosure ?? media`-ja, különben az `entryUrl`. */
export function episodeAudioUrl(entryUrl: string, items: readonly FeedItemUrls[]): string {
  const wanted = bare(entryUrl)
  const item = items.find((candidate) => bare(candidate.enclosure) === wanted || bare(candidate.link) === wanted)
  return item?.enclosure ?? item?.media ?? entryUrl
}

const HTML_TYPES = ['text/html', 'application/xhtml+xml']

/**
 * Az URL fajtája: `feed` (RSS/XML Content-Type), `html` (weboldal, a yt-dlp-nek adjuk), egyébként `other`
 * (közvetlen fájl). Hangkiterjesztésű URL-re kérés nélkül `other`. Egy GET, a törzset eldobja.
 */
export async function feedKind(url: string, fetchImpl: typeof fetch = fetch): Promise<'feed' | 'html' | 'other'> {
  if (directTarget(url).ext !== null) return 'other'
  try {
    const response = await fetchImpl(url.trim().split('#')[0] ?? url)
    await response.body?.cancel()
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!response.ok) return 'other'
    if (FEED_TYPES.includes(type)) return 'feed'
    return HTML_TYPES.includes(type) ? 'html' : 'other'
  } catch {
    return 'other'
  }
}
