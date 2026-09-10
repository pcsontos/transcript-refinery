import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../../src/config.js'
import { createCostGuard } from '../../src/model/budget.js'
import type { ModelClient } from '../../src/model/client.js'
import { metered } from './metered.js'

const CFG: ModelConfig = {
  baseUrl: 'http://nem.szamit',
  apiKey: 'sk-teszt',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  pricing: {
    // Szándékosan nagyon eltérő árak: így a szerep-tévesztés látszik.
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  costLimitUsd: 100,
}

const HASZNALAT = { inputTokens: 1_000_000, outputTokens: 1_000_000 }

/** Kliens, ami mindkét úton fix felhasználást ad vissza. */
function kliens(): ModelClient {
  return {
    generate: () => Promise.resolve({ value: 'szoveg', usage: HASZNALAT }),
    generateObject: <T>() => Promise.resolve({ value: {} as T, usage: HASZNALAT }),
  }
}

/** Kliens, ami a megadott hívásszám után dob. */
function dobóKliens(sikeresHivasok: number): ModelClient {
  let n = 0
  const lepes = (): Promise<{ value: never; usage: typeof HASZNALAT }> => {
    if (n >= sikeresHivasok) return Promise.reject(new Error('szimulált hiba'))
    n++
    return Promise.resolve({ value: 'x' as never, usage: HASZNALAT })
  }
  return { generate: lepes, generateObject: lepes }
}

describe('metered', () => {
  it('a generálást a vázlatmodell árán könyveli', async () => {
    const guard = createCostGuard(100)
    await metered(kliens(), guard, CFG).generate('draft', 'P')
    // 1M be × $3 + 1M ki × $15
    expect(guard.spentUsd()).toBeCloseTo(18, 6)
  })

  it('a bíró hívását a BÍRÓ árán könyveli, nem a vázlatmodellén', async () => {
    const guard = createCostGuard(100)
    await metered(kliens(), guard, CFG).generateObject('judge', 'P', {} as never)
    // 1M be × $0,20 + 1M ki × $0,50 — nem $18.
    expect(guard.spentUsd()).toBeCloseTo(0.7, 6)
  })

  it('a sémás generálást a saját szerepe árán könyveli', async () => {
    const guard = createCostGuard(100)
    await metered(kliens(), guard, CFG).generateObject('draft', 'P', {} as never)
    expect(guard.spentUsd()).toBeCloseTo(18, 6)
  })

  it('a dobás ELŐTTI hívások költése is bekerül', async () => {
    const guard = createCostGuard(100)
    const client = metered(dobóKliens(2), guard, CFG)

    await client.generate('draft', 'A')
    await client.generate('draft', 'B')
    await expect(client.generate('draft', 'C')).rejects.toThrow('szimulált hiba')

    // Két sikeres hívás könyvelve; a harmadik dobott, de az előző kettő
    // költése nem veszhet el — ezen múlik a futás közbeni költséghatár.
    expect(guard.spentUsd()).toBeCloseTo(36, 6)
  })

  it('a hibát változatlanul engedi tovább', async () => {
    const guard = createCostGuard(100)
    const eredeti = new Error('hálózat')
    const client = metered(
      { generate: () => Promise.reject(eredeti), generateObject: () => Promise.reject(eredeti) },
      guard,
      CFG,
    )
    await expect(client.generate('draft', 'P')).rejects.toBe(eredeti)
  })

  it('a hívás eredményét változatlanul adja vissza', async () => {
    const guard = createCostGuard(100)
    const result = await metered(kliens(), guard, CFG).generate('draft', 'P')
    expect(result).toEqual({ value: 'szoveg', usage: HASZNALAT })
  })
})
