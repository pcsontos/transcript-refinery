import { describe, expect, it } from 'vitest'
import { cleanRecipeFor } from './clean.js'
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
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa', 'clean-mild', 'clean-moderate', 'clean-deep', 'bloom', 'notes'])
  })
})

describe('recipesFor', () => {
  it('translate nélkül pontosan az alapregiszter', () => {
    expect(recipesFor(cfg(null))).toBe(RECIPES)
  })

  it('a fordítások az alapreceptek után, a konfig sorrendjében állnak', () => {
    const registry = recipesFor(cfg(['summary', 'clean-moderate']))
    expect(Object.keys(registry)).toEqual([...RECIPE_IDS, 'summary-hu', 'clean-moderate-hu'])
    expect(registry['clean-moderate-hu']!.translation).toEqual({ source: cleanRecipeFor('moderate'), target: 'hu' })
  })

  it('a kulcs a recept saját azonosítója, és minden receptnek van rubrikája', () => {
    for (const [id, recipe] of Object.entries(recipesFor(cfg(['clean-moderate', 'bloom'])))) {
      expect(recipe.id).toBe(id)
      expect(recipe.rubric.criteria.length).toBeGreaterThan(0)
    }
  })

  it('ismeretlen forrásreceptre felsorolja a fordíthatókat', () => {
    expect(() => recipesFor(cfg(['nincsilyen']))).toThrow(
      'translate.recipes: ismeretlen recept: nincsilyen. Fordítható receptek: summary, flashcards, qa, clean-mild, clean-moderate, clean-deep, bloom, notes. (/p/c.yaml)',
    )
  })

  it('fordítás fordítását nem engedi, és a forrásreceptet ajánlja', () => {
    expect(() => recipesFor(cfg(['clean-moderate-hu']))).toThrow(
      'translate.recipes: a(z) clean-moderate-hu maga is fordítás; a forrásreceptet add meg (clean-moderate). (/p/c.yaml)',
    )
  })

  it('nem publikálható forrást nem fordít', () => {
    const rejtett: Recipe = { ...cleanRecipeFor('moderate'), id: 'rejtett', publishable: false }
    expect(() => recipesFor(cfg(['rejtett']), { rejtett })).toThrow(
      'translate.recipes: a(z) rejtett recept nem publikálható, tehát nincs jegyzete, amiből fordítani lehetne. (/p/c.yaml)',
    )
  })

  it('a clean-szintek fordíthatók, és a fordítás-felismerés nem téveszti össze a szintnevet nyelvkóddal', () => {
    const registry = recipesFor(cfg(['clean-deep']))
    expect(registry['clean-deep-hu']!.outputFile).toBe('_clean-deep-hu.md')
    expect(registry['clean-deep-hu']!.translation?.source).toBe(cleanRecipeFor('deep'))
  })
})

describe('recipeFrom', () => {
  it('a megadott regiszterből keres, és a hibaüzenet azt a regisztert sorolja', () => {
    expect(recipeFrom(recipesFor(cfg(['clean-moderate'])), 'clean-moderate-hu').id).toBe('clean-moderate-hu')
    expect(() => recipeFrom(RECIPES, 'clean-moderate-hu')).toThrow(
      'Ismeretlen recept: clean-moderate-hu. Ismert receptek: summary, flashcards, qa, clean-mild, clean-moderate, clean-deep, bloom, notes.',
    )
  })

  it('a régi clean azonosító ismeretlen, és a hiba felsorolja a szinteket', () => {
    expect(() => recipeFrom(RECIPES, 'clean')).toThrow(/clean-mild, clean-moderate, clean-deep/)
  })
})
