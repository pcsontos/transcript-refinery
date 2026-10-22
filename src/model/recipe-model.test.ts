import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { RECIPES } from '../recipe/registry.js'
import {
  assertOverrideModels,
  assertRecipeModels,
  modelConfigFor,
  modelsView,
  usedModels,
  withRecipeModels,
} from './recipe-model.js'

const SONNET = { inputPerMillion: 3, outputPerMillion: 15 }

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  recipeModels: { notes: 'sonnet-proba', qa: 'draft-modell' },
  switchable: { 'sonnet-proba': 'structured', 'draft-modell': 'text' },
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

describe('withRecipeModels', () => {
  it('a model.recipes fölé írja a felülírást, a bemenetet nem módosítja', () => {
    const raw = { model: { draft: 'd', recipes: { qa: 'x' } }, pricing: {} }
    const before = structuredClone(raw)
    expect(withRecipeModels(raw, { notes: 'y' })).toEqual({
      model: { draft: 'd', recipes: { qa: 'x', notes: 'y' } },
      pricing: {},
    })
    expect(raw).toEqual(before)
  })

  it('üres felülírásnál ugyanazt az objektumot adja', () => {
    const raw = { model: {} }
    expect(withRecipeModels(raw, {})).toBe(raw)
  })
})

describe('assertOverrideModels', () => {
  const registry = { notes: { structured: {} }, summary: {} } as never
  const cfg = { ...CFG, switchable: { semas: 'structured', szoveg: 'text' } } as ModelConfig

  it('sémás receptnél text modellre, ismeretlen modellre dob', () => {
    expect(() => assertOverrideModels(cfg, registry, { notes: 'szoveg' })).toThrow('notes=szoveg')
    expect(() => assertOverrideModels(cfg, registry, { summary: 'ismeretlen' })).toThrow('nem váltható modell')
    expect(() => assertOverrideModels(cfg, registry, { summary: 'constructor' })).toThrow('nem váltható modell')
  })

  it('a megengedett párosítást átengedi', () => {
    expect(() => assertOverrideModels(cfg, registry, { summary: 'szoveg' })).not.toThrow()
    expect(() => assertOverrideModels(cfg, registry, { summary: 'semas' })).not.toThrow()
    expect(() => assertOverrideModels(cfg, registry, { notes: 'semas' })).not.toThrow()
  })
})

describe('modelsView', () => {
  it('a switchable modelleit adja a structured jelzővel, a bíró nélkül', () => {
    const view = modelsView(CFG, RECIPES)
    expect(view.draft).toBe('draft-modell')
    expect(view.models).toEqual([
      { name: 'sonnet-proba', structured: true },
      { name: 'draft-modell', structured: false },
    ])
    expect(view.structuredRecipes).toHaveLength(3)
    expect(view.structuredRecipes).toEqual(expect.arrayContaining(['notes', 'flashcards', 'bloom']))
  })
})
