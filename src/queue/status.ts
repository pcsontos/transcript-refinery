import { relative, sep } from 'node:path'
import type { ArtifactRecord } from '../state/db.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { withSuffix } from './line.js'
import { parseQueue } from './parse.js'

export const DEFERRED_STATUS = '⏳ a plafon miatt a következő futásra maradt'
export const NOT_FOUND_STATUS = '✗ a felirat nem található'

/** A hibaüzenet-kivonat felső korlátja, a záró `…`-lel együtt. */
const MAX_ERROR = 120

/** Egy (elem, recept) pár kulcsa. JSON-tömb: nincs ütköző elválasztó. */
export function pairKey(itemId: string, recipeId: string): string {
  return JSON.stringify([itemId, recipeId])
}

/**
 * Kész pár utótagja: pontszám, költség és a jegyzet relatív linkje. A költség
 * négy tizedes, mint az `item:refined` kiírásában — egy pár nagyságrendjében a
 * két tizedes minden összeget `0.00`-nak mutatna.
 */
export function doneStatus(
  record: Pick<ArtifactRecord, 'score' | 'costUsd' | 'path'>,
  notesRoot: string,
): string {
  const parts = [
    `✓ ${record.score === null ? '–' : record.score.toFixed(2)}`,
    `$${(record.costUsd ?? 0).toFixed(4)}`,
  ]
  if (record.path !== null) {
    const link = relative(notesRoot, record.path).split(sep).join('/')
    parts.push(`[jegyzet](<${link}>)`)
  }
  return parts.join(' · ')
}

/**
 * Hibás pár utótagja: a hibaüzenet első sora, szögletes zárójelek és `%%`
 * nélkül — ne képezhessen linket vagy azonosító-horgonyt —, legfeljebb 120
 * karakter.
 */
export function failedStatus(error: string | null): string {
  let excerpt = (error ?? '')
    .split('\n')[0]!
    .replace(/[[\]]/g, '')
    .replace(/%{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (excerpt === '') excerpt = 'ismeretlen hiba'
  if (excerpt.length > MAX_ERROR) excerpt = `${excerpt.slice(0, MAX_ERROR - 1)}…`
  return `✗ ${excerpt}`
}

/**
 * A párok utótagjának cseréje **azonosító és receptId szerint**, nem sorszám
 * szerint. Csak a `statuses`-ben szereplő párokhoz nyúl, és csak az azonosító
 * első előfordulásánál; minden más sor bájtra változatlan.
 */
export function applyStatuses(text: string, statuses: ReadonlyMap<string, string>): string {
  const doc = parseQueue(text)
  const lines = [...doc.lines]
  for (const video of doc.videos) {
    if (video.duplicate) continue
    for (const recipe of video.recipes) {
      const status = statuses.get(pairKey(video.itemId, recipe.recipeId))
      if (status === undefined) continue
      const errors = lintVaultMarkdown(status)
      if (errors.length > 0) {
        throw new Error(
          `a visszaírt állapot megsérti a vault írási szabályait: ${errors.join('; ')}`,
        )
      }
      lines[recipe.line] = withSuffix(recipe.head, status)
    }
  }
  return lines.join('\n')
}
