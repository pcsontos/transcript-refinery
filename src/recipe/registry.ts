import { flashcardsRecipe } from './flashcards.js'
import { summaryRecipe } from './summary.js'
import type { Recipe } from './types.js'

/**
 * Statikus registry: egy indexfájl importálja az összes receptet. Nincs
 * plugin-loader és nincs dinamikus betöltés — néhány tucat elemnél az csak a
 * fordítási idejű típusbiztonságot venné el (`architecture.md` §5).
 *
 * Új prózarecept felvétele ezért **pontosan két sor**: egy import és egy
 * bejegyzés. A motorhoz nem kell nyúlni.
 */
export const RECIPES: Record<string, Recipe> = {
  [summaryRecipe.id]: summaryRecipe,
  [flashcardsRecipe.id]: flashcardsRecipe,
}

export const RECIPE_IDS: string[] = Object.keys(RECIPES)

export function getRecipe(id: string): Recipe {
  const recipe = RECIPES[id]
  if (!recipe) {
    throw new Error(
      `Ismeretlen recept: ${id}. Ismert receptek: ${RECIPE_IDS.join(', ')}.`,
    )
  }
  return recipe
}
