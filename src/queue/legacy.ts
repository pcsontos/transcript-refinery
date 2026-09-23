import { splitTranslationId, type QueueLayout } from './layout.js'

/**
 * A régi, lapos formátum felismerése és egyszeri átalakítása. Ha már nincs
 * régi formátumú sor, ez a modul törölhető.
 */

/** Számozatlan csoportfejléc: a régi formátumé. */
const OLD_HEADING = /^## (?!\d+\. )(.+)$/
const NEW_HEADING = /^## \d+\. .+$/
const NEW_VIDEO = /^### \d+\. .*? %%.+?%%/
/** A régi videósor: listaelem horgonnyal, de nem pipás sor. */
const OLD_VIDEO = /^- (?!\[[ xX]\] ).*? %%.+?%%/
/** A régi receptsor: szóközzel vagy tabbal behúzott pipás sor. */
const OLD_RECIPE = /^[ \t]+- \[([ xX])\] ([A-Za-z0-9_-]+)(.*)$/

interface RecipeEntry {
  kind: 'recipe'
  line: string
  translations: string[]
}
type Entry = RecipeEntry | { kind: 'other'; line: string }

/** Régi formátumú-e a sor: van régi videósora, vagy csak számozatlan fejlécei vannak. */
export function isLegacyQueue(text: string): boolean {
  const lines = text.split('\n')
  if (lines.some((line) => OLD_VIDEO.test(line))) return true
  const numbered = lines.some((line) => NEW_HEADING.test(line) || NEW_VIDEO.test(line))
  return !numbered && lines.some((line) => OLD_HEADING.test(line))
}

/** Egy régi videóblokk sorai az új formátumban. */
function convertBlock(block: readonly string[], layout: QueueLayout): string[] {
  const entries: Entry[] = []
  const bySource = new Map<string, RecipeEntry>()
  const orphans: { source: string; line: string }[] = []

  for (const raw of block) {
    const match = OLD_RECIPE.exec(raw)
    if (!match) {
      entries.push({ kind: 'other', line: raw })
      continue
    }
    const mark = match[1]!
    const id = match[2]!
    const rest = match[3]!
    const translation = splitTranslationId(layout, id)
    if (translation) {
      orphans.push({ source: translation.source, line: `  - [${mark}] ${translation.lang}${rest}` })
      continue
    }
    const entry: RecipeEntry = { kind: 'recipe', line: `- [${mark}] ${id}${rest}`, translations: [] }
    entries.push(entry)
    if (!bySource.has(id)) bySource.set(id, entry)
  }

  for (const orphan of orphans) {
    let parent = bySource.get(orphan.source)
    if (!parent) {
      parent = { kind: 'recipe', line: `- [ ] ${orphan.source}`, translations: [] }
      entries.splice(entries.findLastIndex((entry) => entry.kind === 'recipe') + 1, 0, parent)
      bySource.set(orphan.source, parent)
    }
    parent.translations.push(orphan.line)
  }

  return entries.flatMap((entry) =>
    entry.kind === 'recipe' ? [entry.line, ...entry.translations] : [entry.line],
  )
}

/**
 * A régi formátum átírása az újra, a pipák és az utótagok megtartásával. A
 * sorszámok `0`-k: a `renumberQueue` írja be őket. Új formátumú szövegre
 * bájtra azonos, `migrated: false`.
 */
export function migrateLegacy(
  text: string,
  layout: QueueLayout,
): { text: string; migrated: boolean } {
  if (!isLegacyQueue(text)) return { text, migrated: false }

  const out: string[] = []
  let block: string[] | undefined
  for (const line of text.split('\n')) {
    const heading = OLD_HEADING.exec(line)
    if (heading || OLD_VIDEO.test(line)) {
      if (block) out.push(...convertBlock(block, layout))
      block = undefined
    }
    if (heading) {
      out.push(`## 0. ${heading[1]!}`)
    } else if (OLD_VIDEO.test(line)) {
      out.push(`### 0. ${line.slice(2)}`)
      block = []
    } else if (block) {
      block.push(line)
    } else {
      out.push(line)
    }
  }
  if (block) out.push(...convertBlock(block, layout))

  return { text: out.join('\n'), migrated: true }
}
