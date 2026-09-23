import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { primaryLanguage, type QueueLayout } from './layout.js'
import { groupKey, headingLine, recipeLine, translationLine, videoLine, withSuffix } from './line.js'
import { parseQueue, type QueueDoc, type QueueRecipe } from './parse.js'

export const NOT_FOUND_MARK = '⚠ a felirat nem található'
export const DUPLICATE_MARK = '⚠ duplikátum'

/**
 * A sor feje, amit az első `scan --queue` ír. Onnantól saját szöveg: a
 * pipeline többé nem írja.
 */
export const QUEUE_HEADER = [
  '# Feldolgozási sor',
  '',
  'Pipáld ki, melyik videóhoz melyik jegyzet készüljön, majd futtasd: `refinery run --queue`.',
  'Új feliratok után: `refinery scan --queue`. A recept neve utáni szöveget a pipeline írja,',
  'saját megjegyzés külön sorba kerüljön.',
  '',
].join('\n')

export interface MergeStats {
  /** Új videóblokkok száma. */
  addedVideos: number
  /** Meglévő videó alá beszúrt recept- és fordítássorok száma. */
  addedRecipeLines: number
  /** Célnyelvű videó alól törölt fordítássorok száma. */
  removedTranslationLines: number
  /** Videófejléc-jelölések változása: felkerült vagy lekerült `⚠`. */
  changedMarks: number
}

function assertLint(fragment: string): void {
  const errors = lintVaultMarkdown(fragment)
  if (errors.length > 0) {
    throw new Error(
      `a feldolgozási sor generált része megsérti a vault írási szabályait: ${errors.join('; ')}`,
    )
  }
}

/**
 * A fejléc szakaszának utolsó nem üres sora, a következő csoportfejléc vagy
 * saját fejléc előtt: a felhasználó saját szakaszába nem szúrunk be.
 */
function sectionEnd(doc: QueueDoc, lines: readonly string[], headingIndex: number): number {
  const next = Math.min(
    doc.headings.find((heading) => heading.line > headingIndex)?.line ?? lines.length,
    doc.boundaries.find((line) => line > headingIndex) ?? lines.length,
  )
  let end = headingIndex
  for (let i = headingIndex + 1; i < next; i++) {
    if (lines[i]!.trim() !== '') end = i
  }
  return end
}

/** Kell-e fordítássor a videó alá: a célnyelvű videónál nem, ismeretlen nyelvnél igen. */
function wantsTranslation(language: string | null, target: string): boolean {
  const lang = primaryLanguage(language)
  return lang === null || lang !== target
}

/** Egy recept generált sorai: a receptsor, és ha kell, alatta a fordítássora. */
function recipeBlock(id: string, layout: QueueLayout, language: string | null): string[] {
  const target = layout.translations.get(id)
  return target !== undefined && wantsTranslation(language, target)
    ? [recipeLine(id), translationLine(target)]
    : [recipeLine(id)]
}

/** A recept és a fordítássorai közül az utolsó sor indexe. */
function recipeEnd(recipe: QueueRecipe): number {
  return recipe.translations.at(-1)?.line ?? recipe.line
}

/**
 * A felderített elemek összefésülése a sorba. Tiszta függvény.
 *
 * Új videó a csoportja szakaszának végére kerül, vagy új csoportként a
 * jegyzet végére; meglévő videóhoz csak a hiányzó recept- és fordítássor; a
 * videófejléc utótagja a `⚠` jelölés. A célnyelvű videó ilyen nyelvű
 * fordítássorai törlődnek — ez az egyetlen törlés. Minden más sor — pipák,
 * saját sorok, sorrend — bájtra érintetlen. Az új fejlécek `0`-s sorszámot
 * kapnak, a `renumberQueue` írja át őket. Kétszer alkalmazva ugyanazt adja.
 */
export function mergeQueue(
  current: string | null,
  items: readonly SourceItem[],
  layout: QueueLayout,
): { text: string; stats: MergeStats } {
  const doc = parseQueue(current ?? QUEUE_HEADER)
  const lines = [...doc.lines]
  const stats: MergeStats = {
    addedVideos: 0,
    addedRecipeLines: 0,
    removedTranslationLines: 0,
    changedMarks: 0,
  }
  const discovered = new Map(items.map((item) => [item.itemId, item] as const))

  // 1. Jelölések helyben: a sorok száma nem változik, az indexek érvényesek maradnak.
  for (const video of doc.videos) {
    const mark = video.duplicate
      ? DUPLICATE_MARK
      : discovered.has(video.itemId)
        ? null
        : NOT_FOUND_MARK
    const next = withSuffix(video.head, mark)
    if (next !== lines[video.line]) {
      assertLint(next)
      lines[video.line] = next
      stats.changedMarks++
    }
  }

  // 2. Törlések és beszúrások: sorindexek. A végén egyszerre fűzzük össze,
  //    hogy a korábbi indexek érvényesek maradjanak.
  const dropped = new Set<number>()
  const after = new Map<number, string[]>()
  const insertAfter = (line: number, added: readonly string[]): void => {
    after.set(line, [...(after.get(line) ?? []), ...added])
  }

  for (const video of doc.videos) {
    if (video.duplicate) continue
    // A nem talált videó nyelvét nem ismerjük: a fordítássoraihoz nem nyúlunk.
    const language = discovered.get(video.itemId)?.language ?? null
    const lang = primaryLanguage(language)
    if (lang !== null) {
      for (const recipe of video.recipes) {
        for (const translation of recipe.translations) {
          if (translation.lang !== lang) continue
          dropped.add(translation.line)
          stats.removedTranslationLines++
        }
      }
    }

    const present = new Map<string, QueueRecipe>()
    for (const recipe of video.recipes) {
      if (!present.has(recipe.recipeId)) present.set(recipe.recipeId, recipe)
    }

    // Előbb a meglévő receptek hiányzó fordítássora — így egy ugyanoda
    // horgonyzott hiányzó recept mögéjük kerül, nem közéjük.
    for (const [id, recipe] of present) {
      const target = layout.translations.get(id)
      if (target === undefined || !wantsTranslation(language, target)) continue
      if (recipe.translations.some((translation) => translation.lang === target)) continue
      insertAfter(recipeEnd(recipe), [translationLine(target)])
      stats.addedRecipeLines++
    }

    const missing = layout.recipes
      .filter((id) => !present.has(id))
      .flatMap((id) => recipeBlock(id, layout, language))
    if (missing.length > 0) {
      const last = video.recipes.at(-1)
      insertAfter(last ? recipeEnd(last) : video.line, missing)
      stats.addedRecipeLines += missing.length
    }
  }

  // 3. Új videók, csoportonként, a felderítés sorrendjében.
  const listed = new Set(doc.videos.map((video) => video.itemId))
  const groups = new Map<string, SourceItem[]>()
  for (const item of items) {
    if (listed.has(item.itemId)) continue
    listed.add(item.itemId)
    const key = groupKey(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const tail: string[] = []
  for (const [key, groupItems] of groups) {
    const block = groupItems.flatMap((item) => [
      videoLine(item),
      ...layout.recipes.flatMap((id) => recipeBlock(id, layout, item.language)),
    ])
    assertLint([headingLine(key), ...block].join('\n'))
    stats.addedVideos += groupItems.length
    const heading = doc.headings.find((h) => h.key === key)
    if (heading) {
      insertAfter(sectionEnd(doc, lines, heading.line), block)
    } else {
      tail.push(headingLine(key), ...block, '')
    }
  }

  const out: string[] = []
  lines.forEach((line, index) => {
    if (!dropped.has(index)) out.push(line)
    const added = after.get(index)
    if (added) out.push(...added)
  })

  if (tail.length > 0) {
    // A fájl végi újsort jelző üres utolsó elem helyére a `tail` kerül, ami
    // maga is üres sorral zár.
    if (out.at(-1) === '') out.pop()
    if (out.length > 0 && out.at(-1)!.trim() !== '') out.push('')
    out.push(...tail)
  }

  return { text: out.join('\n'), stats }
}
