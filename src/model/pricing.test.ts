import { describe, expect, it } from 'vitest'
import { TOKENS_PER_WORD, costOf } from './pricing.js'

describe('costOf', () => {
  it('millió tokenre vetített árból számol', () => {
    const usd = costOf(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { inputPerMillion: 3, outputPerMillion: 15 },
    )
    expect(usd).toBe(18)
  })

  it('arányosan számol a millió töredékére is', () => {
    const usd = costOf(
      { inputTokens: 10_000, outputTokens: 2_000 },
      { inputPerMillion: 3, outputPerMillion: 15 },
    )
    expect(usd).toBeCloseTo(0.06, 10)
  })

  it('nulla használat nulla költség', () => {
    expect(
      costOf({ inputTokens: 0, outputTokens: 0 }, { inputPerMillion: 3, outputPerMillion: 15 }),
    ).toBe(0)
  })

  it('a szó→token szorzó megnevezett konstans, nem szórt szám', () => {
    expect(TOKENS_PER_WORD).toBeGreaterThan(1)
    expect(TOKENS_PER_WORD).toBeLessThan(2)
  })
})
