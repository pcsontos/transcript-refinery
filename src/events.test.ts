import { describe, expect, it } from 'vitest'
import { collectEvents, summarize } from './events.js'

describe('collectEvents', () => {
  it('sorrendben gyűjti az eseményeket', () => {
    const { sink, events } = collectEvents()
    sink({ type: 'scan:start', source: 'folder' })
    sink({ type: 'scan:found', count: 3 })
    expect(events.map((e) => e.type)).toEqual(['scan:start', 'scan:found'])
  })
})

const EMPTY_SUMMARY = {
  succeeded: 0,
  skipped: 0,
  failed: 0,
  byCaptionSource: { creator: 0, auto: 0 },
  autoItems: [],
  failures: [],
}

describe('summarize — elemszintű összegzés', () => {
  it('egy elem két publikált jegyzete egyetlen sikernek számít', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:published', itemId: 'a', path: '/v/a_summary.md' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.byCaptionSource).toEqual({ creator: 1, auto: 0 })
  })

  it('felirat-forrás szerint bontja a sikeres elemeket, és felsorolja az automatikusakat', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a.md' },
      { type: 'item:normalized', itemId: 'b', wordsRaw: 200, wordsNormalized: 90, captionSource: 'auto' },
      { type: 'item:published', itemId: 'b', path: '/v/b.md' },
      { type: 'item:normalized', itemId: 'c', wordsRaw: 300, wordsNormalized: 120, captionSource: 'auto' },
      { type: 'item:published', itemId: 'c', path: '/v/c.md' },
    ])
    expect(summary.succeeded).toBe(3)
    expect(summary.byCaptionSource).toEqual({ creator: 1, auto: 2 })
    expect(summary.autoItems).toEqual(['b', 'c'])
  })

  it('a hiba erősebb a publikálásnál: a részben elkészült elem hibás', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'auto' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:failed', itemId: 'a', error: 'a bíró nem válaszolt' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      failed: 1,
      failures: [{ itemId: 'a', error: 'a bíró nem válaszolt' }],
    })
  })

  it('a publikálás elnyeli ugyanannak az elemnek a kihagyását', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:skipped', itemId: 'a', reason: 'a fájl már létezik' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.skipped).toBe(0)
  })

  it('az újrapróbálkozás és a szeletelés nem torzítja az összegzést', () => {
    const summary = summarize([
      { type: 'run:sliced', planned: 2, deferred: 1, usd: 0.16, limitUsd: 5 },
      { type: 'item:retry', itemId: 'a', attempt: 1, delayMs: 1000, reason: '429' },
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a.md' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it('metaadat nélküli, normalizálás előtt elbukott elem nem kerül a bontásba', () => {
    const summary = summarize([
      { type: 'item:failed', itemId: 'x', error: 'olvashatatlan felirat' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      failed: 1,
      failures: [{ itemId: 'x', error: 'olvashatatlan felirat' }],
    })
  })

  it('megszámolja a sikeres, kihagyott és hibás elemeket', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/x/a.md' },
      { type: 'item:normalized', itemId: 'b', wordsRaw: 100, wordsNormalized: 40, captionSource: 'auto' },
      { type: 'item:skipped', itemId: 'b', reason: 'már feldolgozva' },
      { type: 'item:failed', itemId: 'c', error: 'nincs felirat' },
      { type: 'item:normalized', itemId: 'd', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'd', path: '/x/d.md' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      succeeded: 2,
      skipped: 1,
      failed: 1,
      byCaptionSource: { creator: 2, auto: 0 },
      failures: [{ itemId: 'c', error: 'nincs felirat' }],
    })
  })

  it('üres folyamra nullákat ad', () => {
    expect(summarize([])).toEqual(EMPTY_SUMMARY)
  })

  it('az új események nem torzítják az összegzést', () => {
    const summary = summarize([
      { type: 'run:estimate', items: 3, tokens: 1000, usd: 0.2, limitUsd: 5 },
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:generating', itemId: 'a', recipe: 'summary', generation: 1 },
      { type: 'item:scored', itemId: 'a', recipe: 'summary', score: 0.9, gaps: 0 },
      { type: 'item:refined', itemId: 'a', recipe: 'summary', score: 0.9, generations: 1, usd: 0.08 },
      { type: 'item:published', itemId: 'a', path: '/vault/a.md' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      succeeded: 1,
      byCaptionSource: { creator: 1, auto: 0 },
    })
  })
})
