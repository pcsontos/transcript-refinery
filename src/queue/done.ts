import type { Registry } from '../recipe/registry.js'
import type { ArtifactRecord } from '../state/db.js'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { noteFile } from '../vault/paths.js'
import { translationId } from './layout.js'
import { SEPARATOR, withSuffix } from './line.js'
import { parseQueue } from './parse.js'
import { doneStatus } from './status.js'

/** A kész pár utótagja, vagy `null`, ha a pár nem kész. */
export type DoneLookup = (itemId: string, kind: string) => string | null

export interface DoneLookupDeps {
  /** A felderített elemek, azonosító szerint. */
  items: ReadonlyMap<string, SourceItem>
  registry: Registry
  notesRoot: string
  artifactOf: (
    itemId: string,
    kind: string,
  ) => Pick<ArtifactRecord, 'status' | 'score' | 'costUsd' | 'path'> | null
  exists: (path: string) => boolean
}

/**
 * A „kész" forrása: előbb az állapottár `done` rekordja — a rekord útjával,
 * akkor is, ha az eltér a mai célúttól —, aztán a lemezen lévő célfájl. A
 * `failed` rekord nem kész. I/O-t nem végez: az `artifactOf` és az `exists`
 * befecskendezett.
 */
export function doneLookup(deps: DoneLookupDeps): DoneLookup {
  return (itemId, kind) => {
    const item = deps.items.get(itemId)
    const recipe = deps.registry[kind]
    if (item === undefined || recipe === undefined) return null
    const record = deps.artifactOf(itemId, kind)
    if (record?.status === 'done') return doneStatus(record, deps.notesRoot)
    if (!recipe.publishable) return null
    const path = noteFile(deps.notesRoot, item, recipe.outputFile)
    return deps.exists(path) ? doneStatus({ score: null, costUsd: null, path }, deps.notesRoot) : null
  }
}

/** A már meglévő `✓` utótag: a futás saját eredménye, a scan nem írja felül. */
const DONE_SUFFIX = `${SEPARATOR}✓`

/** A fej pipája bepipálva; a `[x]` és `[X]` marad, ahogy van. */
function checkedHead(head: string): string {
  return head.replace('[ ]', '[x]')
}

/**
 * A kész párok sora `[x]` pipát és `✓` utótagot kap. Tiszta függvény: a sorok
 * száma nem változik, a meglévő `✓` utótag bájtra marad, és minden sor, amire
 * a `lookup` `null`-t ad, érintetlen. A duplikátum videó kimarad. Kétszer
 * alkalmazva ugyanazt adja.
 */
export function markDone(text: string, lookup: DoneLookup): { text: string; marked: number } {
  const doc = parseQueue(text)
  const lines = [...doc.lines]
  let marked = 0

  const mark = (
    line: number,
    row: { head: string; suffix: string },
    itemId: string,
    kind: string,
  ): void => {
    const status = lookup(itemId, kind)
    if (status === null) return
    const head = checkedHead(row.head)
    let next: string
    if (row.suffix.startsWith(DONE_SUFFIX)) {
      next = `${head}${row.suffix}`
    } else {
      const errors = lintVaultMarkdown(status)
      if (errors.length > 0) {
        throw new Error(`a kész jelölés megsérti a vault írási szabályait: ${errors.join('; ')}`)
      }
      next = withSuffix(head, status)
    }
    if (next !== lines[line]) {
      lines[line] = next
      marked++
    }
  }

  for (const video of doc.videos) {
    if (video.duplicate) continue
    for (const recipe of video.recipes) {
      mark(recipe.line, recipe, video.itemId, recipe.recipeId)
      for (const translation of recipe.translations) {
        mark(translation.line, translation, video.itemId, translationId(recipe.recipeId, translation.lang))
      }
    }
  }

  return { text: lines.join('\n'), marked }
}
