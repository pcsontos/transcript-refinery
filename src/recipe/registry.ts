import type { Config } from '../config.js'
import { bloomRecipe } from './bloom.js'
import { cleanRecipe } from './clean.js'
import { flashcardsRecipe } from './flashcards.js'
import { notesRecipe } from './notes.js'
import { qaRecipe } from './qa.js'
import { summaryRecipe } from './summary.js'
import { translationOf } from './translate.js'
import type { Recipe } from './types.js'

/** Azonosító → recept. A kulcs mindig a recept saját azonosítója. */
export type Registry = Readonly<Record<string, Recipe>>

/**
 * Az alapreceptek statikus registryje: egy indexfájl importálja mindet. Nincs
 * plugin-loader és nincs dinamikus betöltés — néhány tucat elemnél az csak a
 * fordítási idejű típusbiztonságot venné el (`architecture.md` §5).
 *
 * Új prózarecept felvétele ezért **pontosan két sor**: egy import és egy
 * bejegyzés. A motorhoz nem kell nyúlni.
 */
export const RECIPES: Registry = {
  [summaryRecipe.id]: summaryRecipe,
  [flashcardsRecipe.id]: flashcardsRecipe,
  [qaRecipe.id]: qaRecipe,
  [cleanRecipe.id]: cleanRecipe,
  [bloomRecipe.id]: bloomRecipe,
  [notesRecipe.id]: notesRecipe,
}

export const RECIPE_IDS: string[] = Object.keys(RECIPES)

/** Recept a megadott regiszterből; ismeretlen azonosítóra felsorolja az ismerteket. */
export function recipeFrom(registry: Registry, id: string): Recipe {
  const recipe = registry[id]
  if (!recipe) {
    throw new Error(
      `Ismeretlen recept: ${id}. Ismert receptek: ${Object.keys(registry).join(', ')}.`,
    )
  }
  return recipe
}

/** Recept az alapregiszterből. */
export function getRecipe(id: string): Recipe {
  return recipeFrom(RECIPES, id)
}

/**
 * A futás regisztere: az alapreceptek, utánuk a konfigban kért fordítások, a
 * lista sorrendjében (`decisions/0012`). A fordítópéldány ugyanabból a
 * statikusan importált gyártófüggvényből jön; a konfig csak azt mondja meg,
 * melyik forrásból készüljön.
 *
 * A forrásreceptek azonosítóit itt ellenőrizzük, nem a konfig betöltésekor: így
 * a konfig nem függ a receptektől. A CLI és a felület a konfig betöltése után,
 * minden felderítés előtt hívja.
 */
export function recipesFor(
  cfg: Pick<Config, 'translate' | 'configPath'>,
  base: Registry = RECIPES,
): Registry {
  if (cfg.translate === null) return base

  const registry: Record<string, Recipe> = { ...base }
  for (const id of cfg.translate.recipes) {
    const source = base[id]
    if (!source) {
      const prefix = /^(.+)-[a-z]{2}$/.exec(id)?.[1]
      throw new Error(
        prefix !== undefined && base[prefix]
          ? `translate.recipes: a(z) ${id} maga is fordítás; a forrásreceptet add meg (${prefix}). (${cfg.configPath})`
          : `translate.recipes: ismeretlen recept: ${id}. Fordítható receptek: ${Object.keys(base).join(', ')}. (${cfg.configPath})`,
      )
    }
    if (!source.publishable) {
      throw new Error(
        `translate.recipes: a(z) ${id} recept nem publikálható, tehát nincs jegyzete, amiből fordítani lehetne. (${cfg.configPath})`,
      )
    }
    const translation = translationOf(source, cfg.translate.to)
    registry[translation.id] = translation
  }
  return registry
}
