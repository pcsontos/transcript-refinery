import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { createCostGuard, estimateItemUsd, estimateRunUsd } from './budget.js'

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  costLimitUsd: 5,
}

describe('estimateItemUsd', () => {
  it('a hosszabb átirat drágább', () => {
    expect(estimateItemUsd(10_000, 2, CFG)).toBeGreaterThan(
      estimateItemUsd(1_000, 2, CFG),
    )
  })

  it('a több iteráció drágább', () => {
    expect(estimateItemUsd(3_000, 2, CFG)).toBeGreaterThan(
      estimateItemUsd(3_000, 0, CFG),
    )
  })

  it('a korpusz mediánjára reális nagyságrendet ad', () => {
    // 3 017 szó a valós korpusz mediánja. A becslés centes nagyságrend —
    // ha dollárokat vagy ezredcenteket adna, a szorzók elcsúsztak.
    const usd = estimateItemUsd(3_017, 2, CFG)
    expect(usd).toBeGreaterThan(0.01)
    expect(usd).toBeLessThan(1)
  })
})

describe('estimateRunUsd', () => {
  it('összegzi az elemeket, és tokent is ad', () => {
    const egy = estimateRunUsd([3_000], 2, CFG)
    const harom = estimateRunUsd([3_000, 3_000, 3_000], 2, CFG)
    expect(harom.usd).toBeCloseTo(egy.usd * 3, 10)
    expect(harom.tokens).toBe(egy.tokens * 3)
  })

  it('üres kötegre nullát ad', () => {
    expect(estimateRunUsd([], 2, CFG)).toEqual({ usd: 0, tokens: 0 })
  })
})

describe('createCostGuard', () => {
  it('összegzi a tényleges használatot szerepenként', () => {
    const guard = createCostGuard(5)
    guard.add('draft', { inputTokens: 1_000_000, outputTokens: 0 }, CFG)
    guard.add('judge', { inputTokens: 1_000_000, outputTokens: 0 }, CFG)
    expect(guard.spentUsd()).toBeCloseTo(3.2, 10)
  })

  it('a plafon alatt nem jelez túllépést', () => {
    const guard = createCostGuard(5)
    guard.add('draft', { inputTokens: 100_000, outputTokens: 0 }, CFG)
    expect(guard.exceeded()).toBe(false)
  })

  it('a plafon átlépésekor jelez', () => {
    const guard = createCostGuard(1)
    guard.add('draft', { inputTokens: 1_000_000, outputTokens: 0 }, CFG)
    expect(guard.exceeded()).toBe(true)
  })
})
