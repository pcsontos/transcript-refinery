import { classifyLine } from './line.js'

export interface QueueRecipe {
  /** A sor indexe a jegyzetben, nullától. */
  line: number
  recipeId: string
  checked: boolean
  head: string
  suffix: string
}

export interface QueueVideo {
  line: number
  itemId: string
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
}

export interface QueuePair {
  itemId: string
  recipeId: string
}

/**
 * A jegyzet szerkezete. Sorvégként `\n`-t feltételez — a vault macOS-en,
 * Obsidianból szerkesztődik. A receptsor a legközelebbi megelőző videósorhoz
 * tartozik; az első videósor előtti receptsor saját sornak számít.
 */
export function parseQueue(text: string): QueueDoc {
  const lines = text.split('\n')
  const headings: QueueHeading[] = []
  const videos: QueueVideo[] = []
  const seen = new Set<string>()
  let current: QueueVideo | undefined

  lines.forEach((raw, line) => {
    const parsed = classifyLine(raw)
    switch (parsed.kind) {
      case 'heading':
        headings.push({ line, key: parsed.key })
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
        seen.add(parsed.itemId)
        videos.push(current)
        break
      case 'recipe':
        current?.recipes.push({
          line,
          recipeId: parsed.recipeId,
          checked: parsed.checked,
          head: parsed.head,
          suffix: parsed.suffix,
        })
        break
      default:
        break
    }
  })

  return { lines, headings, videos }
}

/** A kipipált párok a jegyzet sorrendjében — a duplikátum-blokkok nélkül. */
export function checkedPairs(doc: QueueDoc): QueuePair[] {
  return doc.videos
    .filter((video) => !video.duplicate)
    .flatMap((video) =>
      video.recipes
        .filter((recipe) => recipe.checked)
        .map((recipe) => ({ itemId: video.itemId, recipeId: recipe.recipeId })),
    )
}
