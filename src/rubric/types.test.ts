import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { scoreRubric, type Criterion, type Rubric } from './types.js'

/** A kliens, amit ezekben a tesztekben nem szabad meghívni. */
const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}

function fixKriterium(
  name: string,
  value: number,
  gaps: string[] = [],
  blocking = false,
): Criterion {
  return { name, blocking, score: () => Promise.resolve({ value, gaps }) }
}

const CTX = { transcript: 'az átirat', output: 'a jegyzet' }

describe('scoreRubric', () => {
  it('a nem-blokkoló kritériumok átlagát adja', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('a', 1), fixKriterium('b', 0.5)],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.value).toBeCloseTo(0.75, 10)
  })

  it('összegyűjti minden kritérium hiányait', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('a', 0.5, ['első hiány']), fixKriterium('b', 0.5, ['második'])],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.gaps).toEqual(['első hiány', 'második'])
  })

  it('bukó blokkoló kritériumnál a drága kritériumok el sem indulnak', async () => {
    let futott = false
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () => {
        futott = true
        return Promise.resolve({ value: 1, gaps: [] })
      },
    }
    const rubric: Rubric = {
      criteria: [fixKriterium('formatum', 0, ['rossz formátum'], true), dragaKriterium],
      passThreshold: 0.8,
    }

    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)

    expect(futott).toBe(false)
    expect(result.value).toBe(0)
    expect(result.gaps).toEqual(['rossz formátum'])
  })

  it('átmenő blokkoló kritérium nem számít bele a pontszámba', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('formatum', 1, [], true), fixKriterium('b', 0.5)],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.value).toBeCloseTo(0.5, 10)
  })

  it('összegzi a kritériumok token-felhasználását', async () => {
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () =>
        Promise.resolve({
          value: 1,
          gaps: [],
          usage: { inputTokens: 100, outputTokens: 10 },
        }),
    }
    const rubric: Rubric = {
      criteria: [dragaKriterium, dragaKriterium],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 })
  })
})
