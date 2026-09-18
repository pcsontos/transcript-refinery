import type { ModelClient, ModelResult } from '../model/client.js'
import type { Rubric } from '../rubric/types.js'
import type { ModelRole, SourceItem, TimedLine } from '../types.js'
import type { LanguageTag } from '../lang/identify.js'

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
  /**
   * A recept bemenő és viszonyítási szövege: alaprecepteknél a normalizált
   * átirat teljes szövege, fordításnál a forrásjegyzet törzse. A rubrika ehhez
   * mér.
   */
  transcript: string
  /** Az átirat soronkénti kezdőidővel — az időbélyegző receptek alapja; fordításnál üres. */
  timed: readonly TimedLine[]
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
  /**
   * A kimenet várható hossza a bemenet arányában, a költségbecsléshez.
   * Hiánya a becslő alapértelmezését (0,1) hagyja érvényben. A tisztított
   * leirat kimenete nagyjából akkora, mint a bemenet — enélkül a becslés
   * többszörösen alábecsülne, és a plafon nem tartaná meg a kötegét.
   */
  outputRatio?: number
  /**
   * A jegyzet frontmatterjébe kerülő címkék, a videó metaadat-címkéi után.
   * A Decks-plugin a `decks` címkéből ismeri fel a paklit; enélkül egy
   * kártyarecept jegyzete a vaultban nem válik ismételhető paklivá.
   */
  tags?: readonly string[]
  /**
   * Ha igaz, a fejlécek darabszáma tartalmi invariáns: a Bloom-jegyzetben egy
   * `##` fejléc egy kártya. A fordítás vázkapuja ilyenkor nem tűr eltérést a
   * fejlécek számában.
   */
  headingsAreContent?: boolean
  /**
   * Ha igaz, a recept kimenete bekezdésenkénti időbélyeget kap. A csővezeték
   * ebből tudja, hogy az időbélyeg nélküli bekezdés hiány, nem a recept alakja.
   */
  anchored?: boolean
  prompt(input: RecipeInput): string
  repairPrompt(input: RepairInput): string
  /**
   * Ha jelen van, a generálás objektumot kér a sémára, és a renderelt
   * Markdown megy tovább pontozásra és publikálásra. Prózarecepteknél
   * hiányzik.
   */
  structured?: StructuredOutput
  /**
   * Ha jelen van, a generált szöveg ezen megy át, **mielőtt** a rubrika
   * pontozná. Így a bíró, a javító kör és a publikálás ugyanazt a szöveget
   * látja. Dobhat: a feldolgozhatatlan kimenet `item:failed` lesz, nem néma
   * hiba — ugyanaz a precedens, mint a séma-hibánál (`structured.ts`).
   */
  postprocess?(output: string, input: RecipeInput): string
  /**
   * Ha jelen van, a recept egy másik recept kész jegyzetét fordítja
   * célnyelvre (`translationOf`). A futás ilyenkor a forrásjegyzet törzsét adja
   * a `transcript` mezőben, a forrás után futtatja, és hiányzó forrásnál
   * kihagyja.
   */
  translation?: Translation
  rubric: Rubric
}

/** Egy fordítórecept forrása és célnyelve. */
export interface Translation {
  source: Recipe
  target: LanguageTag
}
