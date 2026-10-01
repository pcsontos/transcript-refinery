import type { ModelConfig } from '../config.js'

/**
 * Receptre szabott nézet: a `draft` modell és ára a `model.recipes`
 * felülbírálása, ha van, a bíró a configé. A szerep szerint számoló kód
 * (költségőr, könyvelés, becslés) így változatlan logikával a ténylegesen
 * használt modell árát látja (#79). A fordítás saját azonosítóval szerepel
 * (`notes-hu`), nem örököl a forrásrecepttől.
 */
export function modelConfigFor(cfg: ModelConfig, recipeId: string): ModelConfig {
  const model = cfg.recipeModels[recipeId]
  if (model === undefined) return cfg
  const price = cfg.modelPricing[model]
  // A betöltő ezt kizárja; ha mégis ide jutunk, ne könyveljünk rossz áron.
  if (price === undefined) {
    throw new Error(`pricing: nincs ára a(z) ${model} modellnek (model.recipes.${recipeId}).`)
  }
  return {
    ...cfg,
    models: { ...cfg.models, draft: model },
    pricing: { ...cfg.pricing, draft: price },
  }
}

/** A configban ténylegesen használt modellek, ismétlés nélkül, a `draft`-tal kezdve. */
export function usedModels(cfg: ModelConfig): string[] {
  return [...new Set([cfg.models.draft, cfg.models.judge, ...Object.values(cfg.recipeModels)])]
}

/**
 * A `model.recipes` kulcsainak ellenőrzése a futás regiszterén (alapreceptek
 * és a konfigban kért fordítások). Itt, nem a konfig betöltésekor: így a
 * konfig nem függ a receptektől (`recipesFor` ugyanezt teszi).
 */
export function assertRecipeModels(cfg: ModelConfig, known: readonly string[]): void {
  const unknown = Object.keys(cfg.recipeModels).filter((id) => !known.includes(id))
  if (unknown.length === 0) return
  throw new Error(
    `model.recipes: ismeretlen recept: ${unknown.join(', ')}. Ismert receptek: ${known.join(', ')}.`,
  )
}
