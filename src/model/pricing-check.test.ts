import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPricingFix,
  comparePricing,
  fetchLivePricing,
  type LivePricing,
} from './pricing-check.js'
import type { ModelPricing } from '../config.js'

const MODELS = ['claude-sonnet-5', 'grok-4-fast-reasoning']

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': { inputPerMillion: 2, outputPerMillion: 10 },
  'grok-4-fast-reasoning': { inputPerMillion: 1.25, outputPerMillion: 2.5 },
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
        model: 'claude-sonnet-5',
        configured: PRICING['claude-sonnet-5'],
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
    expect(result.unknown).toEqual(['claude-sonnet-5'])
  })

  it('egy cent alatti eltérést nem jelez (kerekítési zaj)', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 2.001, outputPerMillion: 10 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
    ])
    expect(comparePricing(MODELS, PRICING, live).mismatches).toEqual([])
  })

  it('a receptes felülbírálás modelljét is ellenőrzi', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 2, outputPerMillion: 10 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
      ['claude-opus-5-5', { inputPerMillion: 5, outputPerMillion: 25 }],
    ])
    const pricing = { ...PRICING, 'claude-opus-5-5': { inputPerMillion: 4, outputPerMillion: 20 } }

    const result = comparePricing([...MODELS, 'claude-opus-5-5'], pricing, live)

    expect(result.mismatches.map((m) => m.model)).toEqual(['claude-opus-5-5'])
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

describe('applyPricingFix', () => {
  const TEXT = [
    '# Ár-megjegyzés, amelynek meg kell maradnia.',
    'pricing:',
    '  claude-sonnet-5: { input_per_million: 2.00, output_per_million: 10.00 }',
    '  grok-4-fast-reasoning: { input_per_million: 1.25, output_per_million: 2.50 }',
    '',
  ].join('\n')

  it('csak az eltérő modell árát írja át, a megjegyzést és a flow-alakot megtartva', () => {
    const fixed = applyPricingFix(TEXT, [
      {
        model: 'claude-sonnet-5',
        configured: PRICING['claude-sonnet-5']!,
        live: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    ])

    expect(fixed).toContain('# Ár-megjegyzés, amelynek meg kell maradnia.')
    expect(fixed).toContain('claude-sonnet-5: { input_per_million: 3, output_per_million: 15 }')
    expect(fixed).toContain(
      'grok-4-fast-reasoning: { input_per_million: 1.25, output_per_million: 2.50 }',
    )
  })

  it('két tizedesre kerekít, mert az élő ár tokenárból visszaszorzott', () => {
    const fixed = applyPricingFix(TEXT, [
      {
        model: 'grok-4-fast-reasoning',
        configured: PRICING['grok-4-fast-reasoning']!,
        live: { inputPerMillion: 2.4999999999999996, outputPerMillion: 12.345 },
      },
    ])

    expect(fixed).toContain(
      'grok-4-fast-reasoning: { input_per_million: 2.5, output_per_million: 12.35 }',
    )
  })

  it('pontot és dupla kötőjelet tartalmazó modellnevet is talál', () => {
    const text = [
      'pricing:',
      '  sub2api--grok-4.7: { input_per_million: 2.00, output_per_million: 10.00 }',
      '',
    ].join('\n')

    const fixed = applyPricingFix(text, [
      {
        model: 'sub2api--grok-4.7',
        configured: { inputPerMillion: 2, outputPerMillion: 10 },
        live: { inputPerMillion: 3, outputPerMillion: 12 },
      },
    ])

    expect(fixed).toContain('sub2api--grok-4.7: { input_per_million: 3, output_per_million: 12 }')
  })
})
