import { afterEach, describe, expect, it, vi } from 'vitest'
import { comparePricing, fetchLivePricing, type LivePricing } from './pricing-check.js'
import type { ModelPricing } from '../config.js'
import type { ModelRole } from '../types.js'

const MODELS: Record<ModelRole, string> = { draft: 'claude-sonnet-5', judge: 'grok-4-fast-reasoning' }

const PRICING: Record<ModelRole, ModelPricing> = {
  draft: { inputPerMillion: 2, outputPerMillion: 10 },
  judge: { inputPerMillion: 1.25, outputPerMillion: 2.5 },
}

describe('comparePricing', () => {
  it('nem talál eltérést, ha a configolt ár egyezik az élővel', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 2, outputPerMillion: 10 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
    ])
    expect(comparePricing(MODELS, PRICING, live)).toEqual({ mismatches: [], unknown: [] })
  })

  it('eltérést jelez, ha a bemeneti ár elcsúszott', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 3, outputPerMillion: 15 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
    ])
    const result = comparePricing(MODELS, PRICING, live)
    expect(result.mismatches).toEqual([
      {
        role: 'draft',
        model: 'claude-sonnet-5',
        configured: PRICING.draft,
        live: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    ])
    expect(result.unknown).toEqual([])
  })

  it('eltérést jelez, ha csak a kimeneti ár csúszott el', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 2, outputPerMillion: 12 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
    ])
    expect(comparePricing(MODELS, PRICING, live).mismatches).toHaveLength(1)
  })

  it('ismeretlenként jelzi, ha a LiteLLM nem ismeri a modellt', () => {
    const live = new Map<string, LivePricing>([
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
    ])
    const result = comparePricing(MODELS, PRICING, live)
    expect(result.mismatches).toEqual([])
    expect(result.unknown).toEqual([{ role: 'draft', model: 'claude-sonnet-5' }])
  })

  it('egy cent alatti eltérést nem jelez (kerekítési zaj)', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 2.001, outputPerMillion: 10 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
    ])
    expect(comparePricing(MODELS, PRICING, live).mismatches).toEqual([])
  })
})

describe('fetchLivePricing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a base_url /v1 végét levágva kérdezi le a /model/info-t, Bearer tokennel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              model_name: 'claude-sonnet-5',
              model_info: { input_cost_per_token: 0.000002, output_cost_per_token: 0.00001 },
            },
          ],
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const live = await fetchLivePricing('http://localhost:4000/v1', 'sk-titok')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/model/info',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-titok' } }),
    )
    expect(live.get('claude-sonnet-5')).toEqual({ inputPerMillion: 2, outputPerMillion: 10 })
  })

  it('kihagyja azokat a bejegyzéseket, amiknek nincs teljes árazásuk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ model_name: 'valami-modell', model_info: {} }],
          }),
      }),
    )

    const live = await fetchLivePricing('http://localhost:4000/v1', 'sk-titok')

    expect(live.size).toBe(0)
  })

  it('hibás HTTP válasznál beszédes hibát dob', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    await expect(fetchLivePricing('http://localhost:4000/v1', 'sk-titok')).rejects.toThrow(/401/)
  })
})
