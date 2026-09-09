import { describe, expect, it } from 'vitest'
import { RECIPES, RECIPE_IDS, getRecipe } from './registry.js'

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
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa'])
  })
})
