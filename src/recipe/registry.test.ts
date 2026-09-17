import { describe, expect, it } from 'vitest'
import { cleanRecipe } from './clean.js'
import { RECIPES, RECIPE_IDS, getRecipe, recipeFrom, recipesFor } from './registry.js'
import type { Recipe } from './types.js'

const cfg = (recipes: string[] | null) => ({
  configPath: '/p/c.yaml',
  translate: recipes === null ? null : { to: 'hu' as const, recipes },
})

describe('registry', () => {
  it('azonosító alapján adja vissza a receptet', () => {
    expect(getRecipe('summary').id).toBe('summary')
  })

  it('ismeretlen azonosítóra felsorolja az ismerteket', () => {
    expect(() => getRecipe('nincs-ilyen')).toThrow(/nincs-ilyen/)
    expect(() => getRecipe('nincs-ilyen')).toThrow(/summary/)
  })

  it('a kulcs mindig megegyezik a recept saját azonosítójával', () => {
    for (const [id, recipe] of Object.entries(RECIPES)) {
      expect(recipe.id).toBe(id)
    }
  })

  it('minden receptnek van rubrikája — recept nem kerülhet be a rubrikája nélkül', () => {
    for (const recipe of Object.values(RECIPES)) {
      expect(recipe.rubric.criteria.length).toBeGreaterThan(0)
    }
  })

  it('a receptek azonosítói a regisztráció sorrendjében állnak', () => {
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa', 'clean', 'bloom', 'notes'])
  })
})

describe('recipesFor', () => {
  it('translate nélkül pontosan az alapregiszter', () => {
    expect(recipesFor(cfg(null))).toBe(RECIPES)
  })

  it('a fordítások az alapreceptek után, a konfig sorrendjében állnak', () => {
    const registry = recipesFor(cfg(['summary', 'clean']))
    expect(Object.keys(registry)).toEqual([...RECIPE_IDS, 'summary-hu', 'clean-hu'])
    expect(registry['clean-hu']!.translation).toEqual({ source: cleanRecipe, target: 'hu' })
  })

  it('a kulcs a recept saját azonosítója, és minden receptnek van rubrikája', () => {
    for (const [id, recipe] of Object.entries(recipesFor(cfg(['clean', 'bloom'])))) {
      expect(recipe.id).toBe(id)
      expect(recipe.rubric.criteria.length).toBeGreaterThan(0)
    }
  })

  it('ismeretlen forrásreceptre felsorolja a fordíthatókat', () => {
    expect(() => recipesFor(cfg(['nincsilyen']))).toThrow(
      'translate.recipes: ismeretlen recept: nincsilyen. Fordítható receptek: summary, flashcards, qa, clean, bloom, notes. (/p/c.yaml)',
    )
  })

  it('fordítás fordítását nem engedi, és a forrásreceptet ajánlja', () => {
    expect(() => recipesFor(cfg(['clean-hu']))).toThrow(
      'translate.recipes: a(z) clean-hu maga is fordítás; a forrásreceptet add meg (clean). (/p/c.yaml)',
    )
  })

  it('nem publikálható forrást nem fordít', () => {
    const rejtett: Recipe = { ...cleanRecipe, id: 'rejtett', publishable: false }
    expect(() => recipesFor(cfg(['rejtett']), { rejtett })).toThrow(
      'translate.recipes: a(z) rejtett recept nem publikálható, tehát nincs jegyzete, amiből fordítani lehetne. (/p/c.yaml)',
    )
  })
})

describe('recipeFrom', () => {
  it('a megadott regiszterből keres, és a hibaüzenet azt a regisztert sorolja', () => {
    expect(recipeFrom(recipesFor(cfg(['clean'])), 'clean-hu').id).toBe('clean-hu')
    expect(() => recipeFrom(RECIPES, 'clean-hu')).toThrow(
      'Ismeretlen recept: clean-hu. Ismert receptek: summary, flashcards, qa, clean, bloom, notes.',
    )
  })
})
