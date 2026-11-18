import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mediaId } from './media-id.js'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('mediaId', () => {
  it('a YouTube és a kinyerő nélküli tétel azonosítója a puszta id', () => {
    expect(mediaId({ extractor_key: 'Youtube', id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(mediaId({ id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(mediaId({ id: 't-abc123' })).toBe('t-abc123')
    expect(mediaId({ ie_key: 'Youtube', id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
  })

  it('más kinyerő előtagot kap, a lapos listaelem ie_key-je is számít', () => {
    expect(mediaId({ extractor_key: 'PeerTube', id: 'd4VvgzW5m4jaGr9JFVBUCg' })).toBe('peertube-d4VvgzW5m4jaGr9JFVBUCg')
    expect(mediaId({ ie_key: 'PeerTube', id: 'd4VvgzW5m4jaGr9JFVBUCg' })).toBe('peertube-d4VvgzW5m4jaGr9JFVBUCg')
    expect(mediaId({ extractor_key: 'Vimeo', id: 'a:b.c/d' })).toBe('vimeo-a_b_c_d')
  })

  it('a 36 bájtnál hosszabb azonosító az id hash-ét kapja (Telegram-gombadat), a 36 bájtos marad', () => {
    const claim = 'f'.repeat(40)
    expect(mediaId({ extractor_key: 'LBRY', id: claim })).toBe(`lbry-${sha256(claim).slice(0, 8)}`)
    expect(mediaId({ extractor_key: 'Kick', id: 'a'.repeat(31) })).toBe(`kick-${'a'.repeat(31)}`)
    const long = mediaId({ extractor_key: 'X'.repeat(40), id: 'y'.repeat(40) })
    expect(long).toBe(`${'x'.repeat(27)}-${sha256('y'.repeat(40)).slice(0, 8)}`)
    expect(long?.length).toBe(36)
  })

  it('Generic: a webpage_url hash-e, URL nélkül null', () => {
    const url = 'https://www.w3schools.com/html/horse.mp3'
    expect(mediaId({ extractor_key: 'Generic', id: 'horse', webpage_url: url })).toBe(`generic-${sha256(url).slice(0, 8)}`)
    expect(mediaId({ extractor_key: 'Generic', id: 'audio' })).toBeNull()
  })

  it('id nélkül null (feed-elem)', () => {
    expect(mediaId({ _type: 'url_transparent', url: 'https://x/ep1' } as never)).toBeNull()
  })
})
