import { describe, expect, it } from 'vitest'
import type { FeedProbe } from '../subtitle/ytdlp.js'
import { chunkMessages, episodeAudioUrl, feedKind, feedMediaUrls, feedListLines, feedMessages, feedHash, pickHint, resolvePick } from './feed.js'

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

describe('chunkMessages', () => {
  it('limit nélkül egy üzenet; limittel darabol, mindegyik a fejléccel, a sorok sorrendben', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `${i + 1}. tétel`)
    expect(chunkMessages('Fej\n', lines)).toEqual([`Fej\n${lines.join('\n')}`])
    const parts = chunkMessages('Fej\n', lines, 60)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(60)
      expect(part.startsWith('Fej\n')).toBe(true)
    }
    expect(parts.flatMap((part) => part.split('\n').slice(1))).toEqual(lines)
  })
})

describe('feedKind', () => {
  const reply = (type: string, status = 200): typeof fetch => () => Promise.resolve(new Response('x', { status, headers: { 'content-type': type } }))

  it('az RSS-típus feed, a HTML-típus html, a többi other', async () => {
    expect(await feedKind('https://f.hu/rss', reply('application/rss+xml; charset=utf-8'))).toBe('feed')
    expect(await feedKind('https://f.hu/w/abc', reply('text/html; charset=utf-8'))).toBe('html')
    expect(await feedKind('https://f.hu/w/abc', reply('application/xhtml+xml'))).toBe('html')
    expect(await feedKind('https://f.hu/w/abc', reply('audio/mpeg'))).toBe('other')
    expect(await feedKind('https://f.hu/w/abc', reply('text/html', 404))).toBe('other')
  })

  it('a hangkiterjesztés kérés nélkül other, a hálózati hiba other', async () => {
    let calls = 0
    const counting: typeof fetch = () => {
      calls += 1
      return Promise.resolve(new Response('x'))
    }
    expect(await feedKind('https://f.hu/a.mp3', counting)).toBe('other')
    expect(calls).toBe(0)
    expect(await feedKind('https://f.hu/w/abc', () => Promise.reject(new Error('hálózat')))).toBe('other')
  })
})

describe('feedMediaUrls és episodeAudioUrl', () => {
  const item = (inner: string): string => `<item>${inner}</item>`

  it('csak media:content: a hang-URL entitásai dekódolva, a kép kimarad', () => {
    const xml = item(
      `<media:content type="image/jpeg" url="https://x.hu/k.jpg"/><media:content url="https://omny.fm/a/audio.mp3?utm_source=x&amp;t=1" type="audio/mpeg"/>`,
    )
    expect(feedMediaUrls(xml)).toEqual([{ media: 'https://omny.fm/a/audio.mp3?utm_source=x&t=1' }])
    expect(feedMediaUrls(item('<media:content type="image/jpeg" url="https://x.hu/k.jpg"/>'))).toEqual([{}])
  })

  it('az enclosure erősebb a media:content-nél', () => {
    const items = feedMediaUrls(
      item(`<link>https://x.hu/ep1</link><enclosure url="https://x.hu/e.mp3" type="audio/mpeg"/><media:content url="https://x.hu/m.mp3" type="audio/mpeg"/>`),
    )
    expect(episodeAudioUrl('https://x.hu/ep1', items)).toBe('https://x.hu/e.mp3')
  })

  it('numerikus entitás, &quot; és az aposztróf idézőjel is működik', () => {
    const xml = item(`<media:content type='audio/mpeg' url='https://x.hu/a.mp3?a=1&#38;b=2&quot;c'/>`)
    expect(feedMediaUrls(xml)[0]?.media).toBe('https://x.hu/a.mp3?a=1&b=2"c')
  })

  it('URL szerint párosít: a link nélküli középső tétel nem téveszt meg', () => {
    const items = feedMediaUrls(
      item(`<link>https://x.hu/1</link><media:content url="https://a.hu/1.mp3" type="audio/mpeg"/>`) +
        item(`<media:content url="https://a.hu/2.mp3" type="audio/mpeg"/>`) +
        item(`<link><![CDATA[https://x.hu/3#fragment]]></link><media:content url="https://a.hu/3.mp3" type="audio/mpeg"/>`),
    )
    expect(episodeAudioUrl('https://x.hu/1', items)).toBe('https://a.hu/1.mp3')
    expect(episodeAudioUrl('https://x.hu/3', items)).toBe('https://a.hu/3.mp3')
    expect(episodeAudioUrl('https://x.hu/ismeretlen', items)).toBe('https://x.hu/ismeretlen')
  })
})
