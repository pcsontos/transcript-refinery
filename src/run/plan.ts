import type { ModelConfig } from '../config.js'
import { sliceToBudget, type BudgetEntry, type BudgetSlice } from '../model/budget.js'
import { ARTIFACT_KIND, normalizeItem } from '../pipeline.js'
import type { Recipe } from '../recipe/types.js'
import type { SourceItem } from '../types.js'

/** A futás egysége: egy elem és a rajta futó recept — vagy csak az átirat. */
export interface WorkUnit {
  item: SourceItem
  recipe: Recipe | null
}

/** Az egység műtermék-típusa: a recept azonosítója, recept nélkül az átirat. */
export function unitKind(unit: WorkUnit): string {
  return unit.recipe?.id ?? ARTIFACT_KIND
}

/** Az egység kulcsa. JSON-tömb: nincs ütköző elválasztó. */
export function unitKey(unit: WorkUnit): string {
  return JSON.stringify([unit.item.itemId, unitKind(unit)])
}

export interface ItemFilters {
  source?: string
  channel?: string
}

/** Forrás- és csatornaszűrés: a `run` szabályai, egy helyen. */
export function matchesFilters(item: SourceItem, filters: ItemFilters): boolean {
  if (filters.source && item.source.toLocaleLowerCase() !== filters.source.toLocaleLowerCase()) {
    return false
  }
  // Metaadat nélküli elemnek nincs csatornája: a szűrő ilyenkor kizárja.
  if (
    filters.channel &&
    item.metadata.channel?.toLocaleLowerCase() !== filters.channel.toLocaleLowerCase()
  ) {
    return false
  }
  return true
}

export function filterItems(items: readonly SourceItem[], filters: ItemFilters): SourceItem[] {
  return items.filter((item) => matchesFilters(item, filters))
}

export interface UnitBudget {
  /** A közös szeletelés a modellhívást igénylő egységeken. */
  slice: BudgetSlice<WorkUnit>
  /** Az első becsült egység — a „már az első sem fér be" üzenethez. */
  first: BudgetEntry<WorkUnit> | undefined
}

/**
 * Egyetlen közös becslés az egységekre: a plafon az egész indításra
 * vonatkozik, nem receptenként. Csak a recepttel bíró egység kerül bele — az
 * átirat modellhívás nélkül készül. A szószám elemenként egyszer számolódik;
 * a normalizáláson elbukó elem csak a becslésből marad ki, a feldolgozás sorra
 * veszi, és a hibája ott jelenik meg.
 */
export async function estimateUnits(
  pending: readonly WorkUnit[],
  cfg: ModelConfig,
): Promise<UnitBudget> {
  const words = new Map<string, number | null>()
  const entries: BudgetEntry<WorkUnit>[] = []
  for (const unit of pending) {
    if (unit.recipe === null) continue
    let count = words.get(unit.item.itemId)
    if (count === undefined) {
      try {
        count = (await normalizeItem(unit.item)).wordsNormalized
      } catch {
        count = null
      }
      words.set(unit.item.itemId, count)
    }
    if (count === null) continue
    entries.push({ value: unit, words: count, maxIterations: unit.recipe.maxIterations })
  }
  return { slice: sliceToBudget(entries, cfg), first: entries[0] }
}
