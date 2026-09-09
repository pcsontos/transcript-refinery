import type { ModelClient, ModelResult } from '../model/client.js'
import type { Rubric } from '../rubric/types.js'
import type { ModelRole, SourceItem } from '../types.js'

/**
 * Sémával kikényszerített kimenet.
 *
 * A séma típusparamétere a `structuredOutput` építő zárásán belül marad,
 * ezért ez az interfész konkrét: sem generikus, sem `unknown` nem szivárog a
 * `refine` loopba, a registrybe vagy a csővezetékbe. A `generate` már kész,
 * renderelt Markdownt ad vissza — innentől a strukturált és a prózarecept
 * ugyanaz a szerződés.
 */
export interface StructuredOutput {
  generate(
    client: ModelClient,
    role: ModelRole,
    prompt: string,
  ): Promise<ModelResult<string>>
}

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
  /**
   * Ha jelen van, a generálás objektumot kér a sémára, és a renderelt
   * Markdown megy tovább pontozásra és publikálásra. Prózarecepteknél
   * hiányzik.
   */
  structured?: StructuredOutput
  rubric: Rubric
}
