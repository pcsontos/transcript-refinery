import { translationId } from './layout.js'
import { classifyLine } from './line.js'

/** Bármely markdown-fejléc; ami nem csoport és nem videó, az a felhasználóé. */
const OWN_HEADING = /^#{1,6} /

export interface QueueTranslation {
  /** A sor indexe a jegyzetben, nullától. */
  line: number
  lang: string
  checked: boolean
  head: string
  suffix: string
}

export interface QueueRecipe {
  /** A sor indexe a jegyzetben, nullától. */
  line: number
  recipeId: string
  checked: boolean
  head: string
  suffix: string
  /** A recept alá behúzott fordítássorok. */
  translations: QueueTranslation[]
}

export interface QueueVideo {
  line: number
  itemId: string
  /** A sor eleje a horgonyig, a `### N. ` előtaggal együtt. */
  head: string
  suffix: string
  /** Igaz, ha ugyanez az azonosító egy korábbi videósoron már szerepelt. */
  duplicate: boolean
  recipes: QueueRecipe[]
}

export interface QueueHeading {
  line: number
  key: string
}

export interface QueueDoc {
  lines: string[]
  headings: QueueHeading[]
  videos: QueueVideo[]
  /**
   * A saját, számozatlan fejlécek (`# `…`###### `) sorindexe. Nem csoportok és
   * nem számozódnak, de megszakítják a láncot: ami alattuk áll, a felhasználóé.
   */
  boundaries: number[]
}

export interface QueuePair {
  itemId: string
  recipeId: string
}

/**
 * A jegyzet szerkezete. Sorvégként `\n`-t feltételez — a vault macOS-en,
 * Obsidianból szerkesztődik. A receptsor a legközelebbi megelőző videóhoz, a
 * fordítássor a legközelebbi megelőző recepthez tartozik; a csoportfejléc és a
 * saját, számozatlan fejléc mindkét láncot megszakítja. Ami így nem köthető,
 * saját sornak számít.
 */
export function parseQueue(text: string): QueueDoc {
  const lines = text.split('\n')
  const headings: QueueHeading[] = []
  const videos: QueueVideo[] = []
  const boundaries: number[] = []
  const seen = new Set<string>()
  let current: QueueVideo | undefined
  let recipe: QueueRecipe | undefined

  lines.forEach((raw, line) => {
    const parsed = classifyLine(raw)
    switch (parsed.kind) {
      case 'heading':
        headings.push({ line, key: parsed.key })
        current = undefined
        recipe = undefined
        break
      case 'video':
        current = {
          line,
          itemId: parsed.itemId,
          head: parsed.head,
          suffix: parsed.suffix,
          duplicate: seen.has(parsed.itemId),
          recipes: [],
        }
        recipe = undefined
        seen.add(parsed.itemId)
        videos.push(current)
        break
      case 'recipe':
        if (current === undefined) break
        recipe = {
          line,
          recipeId: parsed.recipeId,
          checked: parsed.checked,
          head: parsed.head,
          suffix: parsed.suffix,
          translations: [],
        }
        current.recipes.push(recipe)
        break
      case 'translation':
        recipe?.translations.push({
          line,
          lang: parsed.lang,
          checked: parsed.checked,
          head: parsed.head,
          suffix: parsed.suffix,
        })
        break
      default:
        if (OWN_HEADING.test(raw)) {
          boundaries.push(line)
          current = undefined
          recipe = undefined
        }
        break
    }
  })

  return { lines, headings, videos, boundaries }
}

/**
 * A kipipált párok a jegyzet sorrendjében — a duplikátum-blokkok nélkül. A
 * fordítás párja `<recept>-<nyelv>`: ugyanaz a recept-azonosító, amit a
 * regiszter a fordítórecepteknek ad.
 */
export function checkedPairs(doc: QueueDoc): QueuePair[] {
  return doc.videos
    .filter((video) => !video.duplicate)
    .flatMap((video) =>
      video.recipes.flatMap((recipe) => [
        ...(recipe.checked ? [{ itemId: video.itemId, recipeId: recipe.recipeId }] : []),
        ...recipe.translations
          .filter((translation) => translation.checked)
          .map((translation) => ({
            itemId: video.itemId,
            recipeId: translationId(recipe.recipeId, translation.lang),
          })),
      ]),
    )
}
