import { describe, expect, it } from 'vitest'
import { stratifiedSample, type SampleCandidate } from './sample.js'

/** 100 jelölt, 100-tól 10 000 szóig egyenletesen. */
const JELOLTEK: SampleCandidate[] = Array.from({ length: 100 }, (_, i) => ({
  itemId: `elem-${String(i).padStart(3, '0')}`,
  words: 100 + i * 100,
}))

describe('stratifiedSample', () => {
  it('a kért számú elemet adja: négy réteg × öt elem', () => {
    expect(stratifiedSample(JELOLTEK, 5)).toHaveLength(20)
  })

  it('kétszer futtatva ugyanazt adja', () => {
    expect(stratifiedSample(JELOLTEK, 5)).toEqual(stratifiedSample(JELOLTEK, 5))
  })

  it('a bemenet sorrendjétől független', () => {
    const kevert = [...JELOLTEK].reverse()
    expect(stratifiedSample(kevert, 5)).toEqual(stratifiedSample(JELOLTEK, 5))
  })

  it('mind a négy hossz-negyedből választ', () => {
    const valasztott = new Set(stratifiedSample(JELOLTEK, 5))
    const hosszak = JELOLTEK.filter((c) => valasztott.has(c.itemId)).map((c) => c.words)
    // A negyedek határai a 100 elemű, egyenletes halmazon: 2500, 5000, 7500.
    expect(hosszak.filter((w) => w <= 2500).length).toBe(5)
    expect(hosszak.filter((w) => w > 2500 && w <= 5000).length).toBe(5)
    expect(hosszak.filter((w) => w > 5000 && w <= 7500).length).toBe(5)
    expect(hosszak.filter((w) => w > 7500).length).toBe(5)
  })

  it('azonos szóhossznál az azonosító dönt, tehát stabil marad', () => {
    const egyforma: SampleCandidate[] = [
      { itemId: 'c', words: 500 },
      { itemId: 'a', words: 500 },
      { itemId: 'b', words: 500 },
      { itemId: 'd', words: 500 },
    ]
    expect(stratifiedSample(egyforma, 1)).toEqual(stratifiedSample([...egyforma].reverse(), 1))
  })

  it('kevés jelöltnél hibát dob, nem ad csendben kisebb mintát', () => {
    expect(() => stratifiedSample(JELOLTEK.slice(0, 10), 5)).toThrow(/kevés jelölt/i)
  })
})
