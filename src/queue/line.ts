import { dirname } from 'node:path'
import type { SourceItem } from '../types.js'

/** A pipeline által írt utótag elválasztója a horgony után. */
export const SEPARATOR = ' — '

export type QueueLine =
  | { kind: 'heading'; key: string }
  | { kind: 'video'; itemId: string; path?: string; head: string; suffix: string }
  | { kind: 'recipe'; recipeId: string; checked: boolean; head: string; suffix: string }
  | { kind: 'translation'; lang: string; checked: boolean; head: string; suffix: string }
  | { kind: 'other' }

/** Számozott csoportfejléc; a kulcs a sorszám nélküli rész. */
const HEADING = /^## \d+\. (.+)$/
// A cím nem-mohó: az ELSŐ `%%…%%` a horgony. A `cleanTitle` gondoskodik róla,
// hogy a címben ne maradjon `%%`. A fej a sorszámot is viszi: a `withSuffix`
// ebből írja vissza a sort, a sorszámot csak a `renumberQueue` írja át.
// Szöveges tételnél a horgony `azonosító útvonal`: az azonosítóban nincs
// szóköz, az útvonalban lehet, ezért az első szóköznél válik ketté.
const VIDEO = /^(### \d+\. .*? %%(.+?)%%)(.*)$/
/** Receptsor: behúzás nélküli pipás sor a videófejléc alatt. */
const RECIPE = /^(- \[([ xX])\] ([A-Za-z0-9_-]+))(.*)$/
/** Fordítássor: pontosan két szóközzel behúzott, kétbetűs nyelvkódú pipás sor. */
const TRANSLATION = /^( {2}- \[([ xX])\] ([a-z]{2}))(?=$| )(.*)$/

/** Egy sor fajtája. Ami egyik mintára sem illik, az saját sor. */
export function classifyLine(line: string): QueueLine {
  const heading = HEADING.exec(line)
  if (heading) return { kind: 'heading', key: heading[1]! }

  const video = VIDEO.exec(line)
  if (video) {
    const anchor = video[2]!
    const space = anchor.indexOf(' ')
    return space === -1
      ? { kind: 'video', itemId: anchor, head: video[1]!, suffix: video[3]! }
      : {
          kind: 'video',
          itemId: anchor.slice(0, space),
          path: anchor.slice(space + 1),
          head: video[1]!,
          suffix: video[3]!,
        }
  }

  const recipe = RECIPE.exec(line)
  if (recipe) {
    return {
      kind: 'recipe',
      recipeId: recipe[3]!,
      checked: recipe[2] !== ' ',
      head: recipe[1]!,
      suffix: recipe[4]!,
    }
  }

  const translation = TRANSLATION.exec(line)
  if (translation) {
    return {
      kind: 'translation',
      lang: translation[3]!,
      checked: translation[2] !== ' ',
      head: translation[1]!,
      suffix: translation[4]!,
    }
  }

  return { kind: 'other' }
}

/**
 * A cím egy sorba fésülve, a horgonyt és a vault-linkszabályokat zavaró jelek
 * nélkül: a `%`-sorozat egyetlen `%` lesz, az egymás melletti szögletes
 * zárójelek és a `](` közé szóköz kerül — így a címből nem lehet azonosító-
 * horgony, wikilink vagy zárójel nélküli link-cél.
 */
export function cleanTitle(title: string, fallback: string): string {
  const cleaned = title
    .replace(/\s+/g, ' ')
    .replace(/%+/g, '%')
    .replace(/\[(?=\[)/g, '[ ')
    .replace(/\](?=\])/g, '] ')
    .replace(/\]\(/g, '] (')
    .trim()
  return cleaned === '' ? fallback : cleaned
}

/** A csoport kulcsa: a forrás és a felirat forráson belüli mappája — metaadat nélkül. */
export function groupKey(item: SourceItem): string {
  const relDir = dirname(item.sourceFile)
  return relDir === '.' ? item.source : `${item.source}/${relDir}`
}

/** A sorszámot a `renumberQueue` adja; a generált sor `0`-val indul. */
export function headingLine(key: string): string {
  return `## 0. ${key}`
}

/**
 * Szöveges tételnél a horgony az útvonalat is viszi: a `run --queue` ebből
 * találja meg a fájlt, ami a `sources`-ban nincs. Rejtett, mert egy látható
 * linket a Better Markdown Links plugin átírhatna.
 */
export function videoLine(item: SourceItem): string {
  const anchor = item.format === 'text' ? `${item.itemId} ${item.subtitlePath}` : item.itemId
  return `### 0. ${cleanTitle(item.title, item.itemId)} %%${anchor}%%`
}

export function recipeLine(recipeId: string): string {
  return `- [ ] ${recipeId}`
}

export function translationLine(lang: string): string {
  return `  - [ ] ${lang}`
}

/** A horgony utáni rész cseréje; a horgonyig minden bájt változatlan marad. */
export function withSuffix(head: string, status: string | null): string {
  return status === null ? head : `${head}${SEPARATOR}${status}`
}
