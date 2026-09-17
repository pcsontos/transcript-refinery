import { toParagraphs } from '../normalize/dedupe.js'
import type { NormalizedTranscript, SourceItem } from '../types.js'
import { renderFrontmatter, type FrontmatterField } from './frontmatter.js'

/**
 * A minden jegyzeten szereplő mezők.
 *
 * Az első négy metaadat nélkül is kitölthető — ez a garancia, hogy a
 * frontmatter mindig elkészül. Utánuk a metaadat mezői jönnek, amik hiány
 * esetén kimaradnak, majd a normalizálás mérőszámai, amik szintén mindig
 * megvannak.
 *
 * A származás rögzítése nem díszítés: enélkül a későbbi mérés nem tudná,
 * milyen minőségű bemeneten dolgozott.
 */
/**
 * A metaadat-címkék érintetlenül, a mai sorrendben; utánuk a recept címkéi,
 * csak ha még nincsenek a listában. Recept-címke nélkül a metaadat listáját
 * adja vissza változatlanul — így a címke nélküli receptek frontmatterje
 * bájtra ugyanaz marad.
 */
function mergeTags(
  metadata: readonly string[] | undefined,
  extra: readonly string[] | undefined,
): readonly string[] | undefined {
  if (extra === undefined || extra.length === 0) return metadata
  const merged = [...(metadata ?? [])]
  for (const tag of extra) {
    if (!merged.includes(tag)) merged.push(tag)
  }
  return merged
}

function baseFields(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
  extraTags?: readonly string[],
  /** A jegyzet nyelve, ha eltér az elemétől — fordításnál a célnyelv. */
  language?: string,
): FrontmatterField[] {
  const captionSource =
    transcript.captionSource === 'creator' ? 'creator_captions' : 'auto_captions'

  return [
    ['item_id', item.itemId],
    ['title', item.title],
    ['source', item.source],
    ['source_file', item.sourceFile],
    ['language', language ?? item.language ?? undefined],
    ['video_id', item.metadata.videoId],
    ['channel', item.metadata.channel],
    ['uploaded', item.metadata.uploadedAt],
    ['url', item.metadata.url],
    ['duration', item.metadata.duration],
    ['tags', mergeTags(item.metadata.tags, extraTags)],
    ['description', item.metadata.description],
    ['transcript_source', captionSource],
    ['words_raw', transcript.wordsRaw],
    ['words_normalized', transcript.wordsNormalized],
    ['punctuation_density', transcript.punctuationDensity.toFixed(2)],
    ['generated_at', new Date().toISOString()],
    ['generator', `transcript-refinery@${generatorVersion}`],
  ]
}

/** A jegyzet törzse. A linksor kimarad, ha nincs URL — üres link nem kerül a vaultba. */
function body(item: SourceItem, content: string): string {
  const link = item.metadata.url ? [`🌐 <${item.metadata.url}>`, ''] : []
  return ['', `# ${item.title}`, '', ...link, '---', '', content, ''].join('\n')
}

/** Normalizált átirat → vault-jegyzet. */
export function renderTranscriptNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
): string {
  const frontmatter = renderFrontmatter(baseFields(item, transcript, generatorVersion))
  return frontmatter + body(item, toParagraphs(transcript.lines))
}

/** Egy recept futásának eredménye, ahogy a frontmatterbe kerül. */
export interface RecipeNoteMeta {
  recipe: string
  /** A ténylegesen futott generáló modell neve. */
  model: string
  /** Hány generálás történt. */
  iterations: number
  score: number
  costUsd: number
  /** A recept címkéi; a metaadat-címkék után kerülnek a frontmatterbe. */
  tags?: readonly string[]
  /** Fordításnál a jegyzet nyelve és a forrás adatai; alapreceptnél hiányzik. */
  translation?: TranslationNoteMeta
}

/** Egy fordítás frontmatter-adatai. */
export interface TranslationNoteMeta {
  /** A jegyzet nyelve: a célnyelv. */
  language: string
  /** A forrásrecept azonosítója. */
  sourceRecipe: string
  /** A forrásjegyzet `generated_at` értéke; `null`, ha hiányzik. */
  sourceGeneratedAt: string | null
}

/**
 * A fordítás mezői a mérőszámok után. A `source_generated_at` mutatja meg, ha a
 * forrás a fordítás után újragenerálódott — automatikus elavulás nincs.
 */
function translationFields(
  item: SourceItem,
  translation: TranslationNoteMeta | undefined,
): FrontmatterField[] {
  if (translation === undefined) return []
  return [
    ['source_language', item.language ?? undefined],
    ['translation_of', translation.sourceRecipe],
    ['source_generated_at', translation.sourceGeneratedAt ?? undefined],
  ]
}

/**
 * Recept kimenete → vault-jegyzet.
 *
 * A frontmatter az átirat származását **és** a generálás körülményeit is
 * rögzíti: melyik modell, hány körben és mennyiért állította elő a jegyzetet.
 */
export function renderRecipeNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  content: string,
  meta: RecipeNoteMeta,
  generatorVersion: string,
): string {
  const frontmatter = renderFrontmatter([
    ...baseFields(item, transcript, generatorVersion, meta.tags, meta.translation?.language),
    ['recipe', meta.recipe],
    ['model', meta.model],
    ['iterations', meta.iterations],
    ['score', meta.score.toFixed(2)],
    ['cost_usd', meta.costUsd.toFixed(4)],
    ...translationFields(item, meta.translation),
  ])
  return frontmatter + body(item, content.trim())
}
