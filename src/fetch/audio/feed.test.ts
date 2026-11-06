import { describe, expect, it } from 'vitest'
import type { FeedProbe } from '../subtitle/ytdlp.js'
import { feedListLines, feedMessages, feedHash, pickHint, resolvePick } from './feed.js'

const entry = (title: string, timestamp: number | null = null, duration: number | null = null) => ({ url: `https://f.hu/${title}.mp3`, title, duration, timestamp, raw: {} })

describe('feedListLines', () => {
  it('dátummal és hosszal, hiányzó rész nélkül', () => {
    const feed: FeedProbe = { title: 'F', entries: [entry('A', 1552480285, 6024), entry('B'), entry('C', 1552480285)] }
    expect(feedListLines(feed)).toEqual(['1. A — 2019-03-13, 1:40:24', '2. B', '3. C — 2019-03-13'])
  })
})

describe('feedMessages', () => {
  const big: FeedProbe = { title: 'Nagy feed', entries: Array.from({ length: 500 }, (_, i) => entry(`Epizód száma ${i + 1} hosszabb címmel`, 1552480285, 3600)) }

  it('500 epizód, limit 4000 → minden darab ≤ 4000, mindegyikben a Feed: sor, a sorok hiánytalanul és sorrendben', () => {
    const messages = feedMessages('https://f.hu/rss', big, 4000)
    expect(messages.length).toBeGreaterThan(1)
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(4000)
      expect(message.startsWith('Nagy feed\nFeed: https://f.hu/rss\n')).toBe(true)
    }
    const body = messages.flatMap((message) => message.split('\n').slice(2))
    expect(body).toEqual(feedListLines(big))
  })

  it('limit nélkül egy üzenet', () => {
    expect(feedMessages('https://f.hu/rss', big)).toHaveLength(1)
  })

  it('a túl hosszú sor …-ra vágva, a határon belül', () => {
    const feed: FeedProbe = { title: 'F', entries: [entry('x'.repeat(500))] }
    const [message] = feedMessages('u', feed, 100)
    expect(message?.length).toBeLessThanOrEqual(100)
    expect(message?.endsWith('…')).toBe(true)
  })
})

describe('resolvePick és pickHint', () => {
  it('resolvePick', () => {
    expect(resolvePick('all', 3)).toEqual({ ok: true, indexes: [0, 1, 2] })
    expect(resolvePick([1, 3], 3)).toEqual({ ok: true, indexes: [0, 2] })
    expect(resolvePick([2, 9], 2)).toEqual({ ok: false, reason: 'érvénytelen sorszám: 9 (a feedben 2 epizód van)' })
  })
  it('pickHint és feedHash', () => {
    expect(pickHint('U', 'cli')).toBe('Választás: refinery fetch audio U --pick 1,3 (0 = mind)')
    expect(pickHint('U', 'telegram')).toContain('Feed: U')
    expect(feedHash(' https://x ')).toBe(feedHash('https://x'))
    expect(feedHash('a')).toMatch(/^[0-9a-f]{8}$/)
  })
})
