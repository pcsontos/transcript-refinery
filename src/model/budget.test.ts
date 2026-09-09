import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { createCostGuard, estimateItemUsd, estimateRunUsd, sliceToBudget } from './budget.js'

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

describe('sliceToBudget', () => {
  const limitel = (costLimitUsd: number): ModelConfig => ({ ...CFG, costLimitUsd })

  it('addig vág, amíg a becslés a plafon alá fér', () => {
    const egy = estimateItemUsd(1_000, 0, CFG)
    const cfg = limitel(egy * 2.5)
    const slice = sliceToBudget(
      [
        { value: 'a', words: 1_000 },
        { value: 'b', words: 1_000 },
        { value: 'c', words: 1_000 },
      ],
      0,
      cfg,
    )

    expect(slice.planned).toEqual(['a', 'b'])
    expect(slice.deferred).toEqual(['c'])
    expect(slice.usd).toBeLessThanOrEqual(cfg.costLimitUsd)
  })

  it('a plafon alá férő teljes köteget elindítja', () => {
    const slice = sliceToBudget([{ value: 'a', words: 100 }], 0, limitel(1_000))
    expect(slice.planned).toEqual(['a'])
    expect(slice.deferred).toEqual([])
  })

  it('ha az első elem sem fér be, üres tervet ad', () => {
    const slice = sliceToBudget([{ value: 'a', words: 5_000 }], 0, limitel(0.000001))
    expect(slice.planned).toEqual([])
    expect(slice.deferred).toEqual(['a'])
    expect(slice.usd).toBe(0)
  })

  it('üres bemenetre üres tervet ad', () => {
    expect(sliceToBudget([], 0, limitel(5))).toEqual({
      planned: [],
      deferred: [],
      usd: 0,
      tokens: 0,
    })
  })

  it('a tokenbecslés ugyanazt adja, mint az estimateRunUsd a tervezett elemekre', () => {
    const cfg = limitel(1_000)
    const slice = sliceToBudget(
      [
        { value: 'a', words: 800 },
        { value: 'b', words: 1_200 },
      ],
      1,
      cfg,
    )

    expect(slice.tokens).toBe(estimateRunUsd([800, 1_200], 1, cfg).tokens)
  })

  it('kemény megállás: plafon-túllépés után egy olcsóbb, később jövő elem sem csúszik be', () => {
    const costA = estimateItemUsd(1_000, 0, CFG)
    const costC = estimateItemUsd(200, 0, CFG)
    // A plafon éppen A-ra és C-re elég, bőséges tartalékkal — egy
    // legjobb-illeszkedést kereső (a plafon-túllépés után is tovább
    // kereső) implementáció a b kihagyása után C-t még beengedné. A helyes
    // viselkedés a kemény megállás: a plafon elfogyása után semmi más nem
    // indulhat, még ha önmagában befért volna is.
    const cfg = limitel(costA + costC * 1.5)

    const slice = sliceToBudget(
      [
        { value: 'a', words: 1_000 }, // befér, tölti a keretet
        { value: 'b', words: 5_000 }, // jóval túllépi a plafont — itt kell megállnia
        { value: 'c', words: 200 }, // önmagában beférne, de a plafon már elfogyott
      ],
      0,
      cfg,
    )

    expect(slice.planned).toEqual(['a'])
    expect(slice.deferred).toEqual(['b', 'c'])
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
