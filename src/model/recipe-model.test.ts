import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { assertRecipeModels, modelConfigFor, usedModels } from './recipe-model.js'

const SONNET = { inputPerMillion: 3, outputPerMillion: 15 }

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  recipeModels: { notes: 'sonnet-proba', qa: 'draft-modell' },
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 4, outputPerMillion: 20 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  modelPricing: {
    'draft-modell': { inputPerMillion: 4, outputPerMillion: 20 },
    'judge-modell': { inputPerMillion: 0.2, outputPerMillion: 0.5 },
    'sonnet-proba': SONNET,
  },
  costLimitUsd: 5,
}

describe('modelConfigFor', () => {
  it('a felülbírált recept a saját modelljét és árát kapja, a bíró marad', () => {
    const view = modelConfigFor(CFG, 'notes')
    expect(view.models).toEqual({ draft: 'sonnet-proba', judge: 'judge-modell' })
    expect(view.pricing.draft).toEqual(SONNET)
    expect(view.pricing.judge).toEqual(CFG.pricing.judge)
  })

  it('felülbírálás nélkül az alapértelmezést adja', () => {
    expect(modelConfigFor(CFG, 'summary')).toBe(CFG)
  })

  it('a fordítás nem örököl a forrásrecepttől', () => {
    expect(modelConfigFor(CFG, 'notes-hu').models.draft).toBe('draft-modell')
  })
})

describe('usedModels', () => {
  it('a használt modelleket ismétlés nélkül, a draft-tal kezdve adja', () => {
    expect(usedModels(CFG)).toEqual(['draft-modell', 'judge-modell', 'sonnet-proba'])
  })
})

describe('assertRecipeModels', () => {
  it('ismert kulcsokra nem szól', () => {
    expect(() => assertRecipeModels(CFG, ['summary', 'notes', 'qa'])).not.toThrow()
  })

  it('ismeretlen kulcsra felsorolja az ismerteket', () => {
    expect(() => assertRecipeModels(CFG, ['summary', 'notes'])).toThrow(
      'model.recipes: ismeretlen recept: qa. Ismert receptek: summary, notes.',
    )
  })
})
