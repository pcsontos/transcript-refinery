import { describe, expect, it } from 'vitest'
import type { RunRecord } from './stats.js'
import { alreadyDone, loadRawData } from './resume.js'

const REKORD: RunRecord = {
  itemId: 'elem-1',
  repeat: 0,
  scores: [1, 1],
  usdPerRound: [0.1, 0.2],
}

describe('loadRawData', () => {
  it('hiányzó bemenetnél üres állapotot ad', () => {
    const betoltott = loadRawData(undefined)
    expect(betoltott.results.size).toBe(0)
    expect(betoltott.totalSpentUsd).toBe(0)
  })

  it('betölti a korábbi futás rekordjait recept szerint', () => {
    const betoltott = loadRawData({
      results: [['summary', [REKORD]]],
      failures: [],
      totalSpentUsd: 0.3,
    })
    expect(betoltott.results.get('summary')).toEqual([REKORD])
  })

  it('a rögzített totalSpentUsd mezőt használja, ha van', () => {
    // Szándékosan nem egyezik a rekordok összegével (0.3) — a mezőt kell
    // hinni, mert a korábbi futás költséges hibáit is tartalmazhatja, amik
    // nem szerepelnek `usdPerRound`-ban.
    const betoltott = loadRawData({
      results: [['summary', [REKORD]]],
      totalSpentUsd: 5,
    })
    expect(betoltott.totalSpentUsd).toBe(5)
  })

  it('totalSpentUsd hiányában a sikeres körök összegéből pótolja (régi fájlformátum)', () => {
    const betoltott = loadRawData({
      results: [
        ['summary', [REKORD]],
        ['flashcards', [{ ...REKORD, itemId: 'elem-2', usdPerRound: [0.05] }]],
      ],
    })
    expect(betoltott.totalSpentUsd).toBeCloseTo(0.35)
  })
})

describe('alreadyDone', () => {
  const results = new Map<string, RunRecord[]>([['summary', [REKORD]]])

  it('igaz, ha pontosan erre az (elem, ismétlés) párra van rekord', () => {
    expect(alreadyDone(results, 'summary', 'elem-1', 0)).toBe(true)
  })

  it('hamis másik ismétlésre', () => {
    expect(alreadyDone(results, 'summary', 'elem-1', 1)).toBe(false)
  })

  it('hamis másik elemre', () => {
    expect(alreadyDone(results, 'summary', 'elem-2', 0)).toBe(false)
  })

  it('hamis másik receptre', () => {
    expect(alreadyDone(results, 'flashcards', 'elem-1', 0)).toBe(false)
  })
})
