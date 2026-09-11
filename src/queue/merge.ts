import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { groupKey, recipeLine, videoLine, withSuffix } from './line.js'
import { parseQueue, type QueueDoc } from './parse.js'

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
  /** Meglévő videó alá beszúrt receptsorok száma. */
  addedRecipeLines: number
  /** Videósor-jelölések változása: felkerült vagy lekerült `⚠`. */
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

/** A fejléc szakaszának utolsó nem üres sora, a következő `## ` fejléc előtt. */
function sectionEnd(doc: QueueDoc, lines: readonly string[], headingLine: number): number {
  const next = doc.headings.find((heading) => heading.line > headingLine)?.line ?? lines.length
  let end = headingLine
  for (let i = headingLine + 1; i < next; i++) {
    if (lines[i]!.trim() !== '') end = i
  }
  return end
}

/**
 * A felderített elemek összefésülése a sorba. Tiszta függvény.
 *
 * Új videó a csoportja szakaszának végére kerül, vagy új csoportként a
 * jegyzet végére; meglévő videóhoz csak a hiányzó receptsor; a videósor
 * utótagja a `⚠` jelölés. Minden más sor — pipák, saját sorok, sorrend —
 * bájtra érintetlen. Kétszer alkalmazva ugyanazt adja.
 */
export function mergeQueue(
  current: string | null,
  items: readonly SourceItem[],
  recipeIds: readonly string[],
): { text: string; stats: MergeStats } {
  const doc = parseQueue(current ?? QUEUE_HEADER)
  const lines = [...doc.lines]
  const stats: MergeStats = { addedVideos: 0, addedRecipeLines: 0, changedMarks: 0 }
  const discovered = new Set(items.map((item) => item.itemId))

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

  // 2. Beszúrások: sorindex → utána kerülő sorok. A végén egyszerre fűzzük
  //    össze, hogy a korábbi indexek érvényesek maradjanak.
  const after = new Map<number, string[]>()
  const insertAfter = (line: number, added: readonly string[]): void => {
    after.set(line, [...(after.get(line) ?? []), ...added])
  }

  for (const video of doc.videos) {
    if (video.duplicate) continue
    const present = new Set(video.recipes.map((recipe) => recipe.recipeId))
    const missing = recipeIds.filter((id) => !present.has(id))
    if (missing.length === 0) continue
    insertAfter(video.recipes.at(-1)?.line ?? video.line, missing.map(recipeLine))
    stats.addedRecipeLines += missing.length
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
    const block = groupItems.flatMap((item) => [videoLine(item), ...recipeIds.map(recipeLine)])
    assertLint([`## ${key}`, ...block].join('\n'))
    stats.addedVideos += groupItems.length
    const heading = doc.headings.find((h) => h.key === key)
    if (heading) {
      insertAfter(sectionEnd(doc, lines, heading.line), block)
    } else {
      tail.push(`## ${key}`, ...block, '')
    }
  }

  const out: string[] = []
  lines.forEach((line, index) => {
    out.push(line)
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
