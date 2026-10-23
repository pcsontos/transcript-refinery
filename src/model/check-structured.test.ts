import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelConfig } from '../config.js'
import { RECIPES } from '../recipe/registry.js'
import { commandCheckStructured, PROBE_SCHEMAS } from './check-structured.js'
import type { ModelClient } from './client.js'

const PRICE = { inputPerMillion: 3, outputPerMillion: 15 }

/** Négy modell; egy próba (4000 be, 1500 ki) 0,0345 $, a teljes 4 × 3 × 3 × 0,0345 = 1,242 $. */
const cfg = (costLimitUsd: number, switchable: ModelConfig['switchable']): ModelConfig => ({
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'jo', judge: 'jo' },
  recipeModels: {},
  switchable,
  judgeEnabled: true,
  pricing: { draft: PRICE, judge: PRICE },
  modelPricing: { jo: PRICE, rossz: PRICE, szoveg: PRICE, halo: PRICE },
  costLimitUsd,
})

const SWITCHABLE = { jo: 'structured', rossz: 'structured', szoveg: 'text', halo: 'text' } as const

/** A `view.models.draft` szerint válaszol: jó modell, séma-hiba, vagy hálózati hiba. */
function fakeClient(view: ModelConfig): ModelClient {
  const schemaError = Object.assign(new Error('nincs objektum'), { name: 'AI_NoObjectGeneratedError' })
  return {
    generate: () => Promise.reject(new Error('nem hívódhat')),
    generateObject: (() => {
      switch (view.models.draft) {
        case 'jo':
          return Promise.resolve({ value: {}, usage: { inputTokens: 10, outputTokens: 5 } })
        case 'halo':
          return Promise.reject(new Error('ECONNRESET'))
        default:
          return Promise.reject(schemaError)
      }
    }) as ModelClient['generateObject'],
  }
}

describe('commandCheckStructured', () => {
  let logs: string[]
  let errors: string[]

  beforeEach(() => {
    logs = []
    errors = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('modellenként összeveti a mérést a config jelzésével, eltérésnél 1-es kód', async () => {
    expect(await commandCheckStructured(cfg(10, SWITCHABLE), fakeClient)).toBe(1)

    expect(logs).toContain('jo: config structured, mért structured (9/9 sémás)')
    expect(logs).toContain('rossz: config structured, mért text (0/9 sémás)  ← ELTÉR')
    expect(logs).toContain('szoveg: config text, mért text (0/9 sémás)')
    // a hálózati hiba nem séma-hiba: nem dönt a „text” mellett
    expect(logs).toContain('halo: config text, mért ? (0/0 sémás, 9 egyéb hiba)')
  })

  it('eltérés nélkül 0-s kód', async () => {
    const { rossz: _rossz, ...rest } = SWITCHABLE
    expect(await commandCheckStructured(cfg(10, rest), fakeClient)).toBe(0)
  })

  it('ha a becslés kétszerese a plafon fölött van, egy hívás nélkül áll meg', async () => {
    const createClient = vi.fn(fakeClient)

    // a becslés 1,242 $ (a plafon alatt), a duplája 2,484 $ (fölötte)
    expect(await commandCheckStructured(cfg(2, SWITCHABLE), createClient)).toBe(1)

    expect(createClient).not.toHaveBeenCalled()
    expect(errors[0]).toContain('cost_limit_usd')
  })

  it('üres switchable listával nincs mit mérni', async () => {
    expect(await commandCheckStructured(cfg(10, {}), fakeClient)).toBe(0)
    expect(logs).toEqual(['A model.switchable üres: nincs mit mérni.'])
  })

  it('a próbasémák a registry sémás receptjeivel egyeznek', () => {
    const structured = Object.values(RECIPES)
      .filter((recipe) => recipe.structured)
      .map((recipe) => recipe.id)
      .sort()
    expect(Object.keys(PROBE_SCHEMAS).sort()).toEqual(structured)
  })
})
