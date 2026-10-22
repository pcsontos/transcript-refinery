import { asRecord, type ModelConfig } from '../config.js'
import type { Registry } from '../recipe/registry.js'

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

/** A YAML `model.recipes` a kérés felülírásával (#292); a nyers configot nem módosítja. */
export function withRecipeModels(raw: unknown, overrides: Readonly<Record<string, string>>): unknown {
  if (Object.keys(overrides).length === 0) return raw
  const root = asRecord(raw) ?? {}
  const model = asRecord(root.model) ?? {}
  return { ...root, model: { ...model, recipes: { ...asRecord(model.recipes), ...overrides } } }
}

/**
 * A felülírás csak `model.switchable` modell lehet, sémás receptnél `structured` jelzéssel.
 * A YAML `model.recipes`-t nem nézi, csak a Telegram-felülírást.
 */
export function assertOverrideModels(
  cfg: ModelConfig,
  registry: Registry,
  overrides: Readonly<Record<string, string>>,
): void {
  const switchable = cfg.switchable ?? {}
  const bad = Object.entries(overrides).filter(([id, model]) => {
    const kind = Object.hasOwn(switchable, model) ? switchable[model] : undefined
    return kind === undefined || (registry[id]?.structured !== undefined && kind !== 'structured')
  })
  if (bad.length === 0) return
  throw new Error(
    `model: nem váltható modell: ${bad.map(([id, model]) => `${id}=${model}`).join(', ')}. Telegramról csak a model.switchable modelljei választhatók, sémás recepthez structured jelzéssel.`,
  )
}

export interface ModelsView {
  draft: string
  recipes: Readonly<Record<string, string>>
  models: { name: string; structured: boolean }[]
  structuredRecipes: string[]
}

/** A `GET /models` válasza: a YAML-alap és a `model.switchable` modelljei. */
export function modelsView(cfg: ModelConfig, registry: Registry): ModelsView {
  return {
    draft: cfg.models.draft,
    recipes: cfg.recipeModels,
    models: Object.entries(cfg.switchable ?? {}).map(([name, kind]) => ({ name, structured: kind === 'structured' })),
    structuredRecipes: Object.keys(registry).filter((id) => registry[id]?.structured !== undefined),
  }
}
