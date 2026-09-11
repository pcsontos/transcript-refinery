import { dirname } from 'node:path'
import type { SourceItem } from '../types.js'

/** A pipeline által írt utótag elválasztója a horgony után. */
export const SEPARATOR = ' — '

export type QueueLine =
  | { kind: 'heading'; key: string }
  | { kind: 'video'; itemId: string; head: string; suffix: string }
  | { kind: 'recipe'; recipeId: string; checked: boolean; head: string; suffix: string }
  | { kind: 'other' }

const HEADING = /^## (.+)$/
// A cím nem-mohó: az ELSŐ `%%…%%` a horgony. A `cleanTitle` gondoskodik róla,
// hogy a címben ne maradjon `%%`.
const VIDEO = /^(- .*? %%(.+?)%%)(.*)$/
const RECIPE = /^([ \t]+- \[([ xX])\] ([A-Za-z0-9_-]+))(.*)$/

/** Egy sor fajtája. Ami egyik mintára sem illik, az saját sor. */
export function classifyLine(line: string): QueueLine {
  const heading = HEADING.exec(line)
  if (heading) return { kind: 'heading', key: heading[1]! }

  const video = VIDEO.exec(line)
  if (video) {
    return { kind: 'video', itemId: video[2]!, head: video[1]!, suffix: video[3]! }
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

export function videoLine(item: SourceItem): string {
  return `- ${cleanTitle(item.title, item.itemId)} %%${item.itemId}%%`
}

export function recipeLine(recipeId: string): string {
  return `  - [ ] ${recipeId}`
}

/** A horgony utáni rész cseréje; a horgonyig minden bájt változatlan marad. */
export function withSuffix(head: string, status: string | null): string {
  return status === null ? head : `${head}${SEPARATOR}${status}`
}
