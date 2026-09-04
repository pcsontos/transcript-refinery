import type { Rubric } from '../rubric/types.js'
import type { ModelRole, SourceItem } from '../types.js'

export interface RecipeInput {
  item: SourceItem
  /** A normalizált átirat teljes szövege. */
  transcript: string
}

export interface RepairInput extends RecipeInput {
  /** Az előző kör kimenete, amit javítani kell. */
  previous: string
  /** A rubrika által megnevezett konkrét hiányok. */
  gaps: string[]
}

/**
 * Egy dokumentumtípus egy modul (`decisions/0002`). Erős alapértelmezések
 * mellett egy prózarecept nagyjából tíz sor, amiből kilenc maga a prompt.
 */
export interface Recipe {
  /** Az állapottárban és a `--recipe` kapcsolóban használt azonosító. */
  id: string
  /** A vault fájlnév-utótagja, például `_summary.md`. */
  outputFile: string
  /**
   * A publisher által kikényszerített invariáns, nem konvenció. Bizonyos
   * típusok — például cikkvázlat mások videójából — soha nem kerülhetnek
   * publikálási útra.
   */
  publishable: boolean
  /** Modellszerep, nem modellnév. */
  role: ModelRole
  /** Javító körök felső korlátja. Kettő javítás = három generálás. */
  maxIterations: number
  prompt(input: RecipeInput): string
  repairPrompt(input: RepairInput): string
  rubric: Rubric
}
