import { existsSync } from 'node:fs'
import type { Config } from '../config.js'
import { normalizeItem } from '../pipeline.js'
import type { Registry } from '../recipe/registry.js'
import { openState } from '../state/db.js'
import type { SourceItem } from '../types.js'
import { doneLookup, markDone } from './done.js'
import { queuePath, readQueueFile } from './file.js'
import { queueLayout } from './layout.js'
import { migrateLegacy } from './legacy.js'
import { mergeQueue, type MergeStats } from './merge.js'
import { renumberQueue } from './renumber.js'

/**
 * Nyelvkód nélküli feliratnál a tartalom dönt a nyelvről, ugyanúgy, mint a
 * futásban (`normalizeItem`). Az eredeti elemet nem módosítja. Ha a nyelv a
 * tartalomból sem ismerhető fel, vagy a felirat nem olvasható, `null` marad:
 * a scan ettől nem áll meg, a fordítássor pedig megmarad.
 */
export async function withContentLanguage(items: readonly SourceItem[]): Promise<SourceItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.language !== null) return item
      const copy = { ...item }
      try {
        await normalizeItem(copy)
      } catch {
        // A nyelv null marad.
      }
      return copy
    }),
  )
}

/** A sor frissítésének eredménye; a hívó dönt az írásról és a commitról. */
export interface QueueRefresh {
  path: string
  /** A sor jelenlegi szövege; `null`, ha még nincs. */
  current: string | null
  /** Az új szöveg; ha megegyezik a `current`-tel, nincs mit írni. */
  text: string
  stats: MergeStats
  /** A régi formátumot most alakítottuk át. */
  migrated: boolean
  /** Ennyi sor lett késznek jelölve az állapottár vagy a meglévő jegyzet alapján. */
  marked: number
}

/**
 * A felderített elemek összefésülése a sorba, a kész párok bepipálásával és az
 * újraszámozással — a `scan --queue` és a `watch` közös útja. Nem ír: a sort
 * közvetlenül írás előtt frissen olvassa, így a hívó a lehető legkisebb
 * versenyablakkal írhat vissza. Az állapottárat csak olvassa, és csak ha már van.
 */
export async function refreshQueue(
  cfg: Config,
  registry: Registry,
  items: readonly SourceItem[],
): Promise<QueueRefresh> {
  const layout = queueLayout(registry)
  const path = queuePath(cfg.notesRoot)
  const current = await readQueueFile(path)
  // A régi formátumot egyszer átalakítjuk; utána a merge és az újraszámozás
  // már az újat látja.
  const legacy = current === null ? null : migrateLegacy(current, layout)
  const merged = mergeQueue(legacy?.text ?? null, items, layout)
  const store = existsSync(cfg.statePath) ? openState(cfg.statePath) : null
  let done: ReturnType<typeof markDone>
  try {
    done = markDone(
      merged.text,
      doneLookup({
        items: new Map(items.map((item) => [item.itemId, item] as const)),
        registry,
        notesRoot: cfg.notesRoot,
        artifactOf: (itemId, kind) => store?.artifactOf(itemId, kind) ?? null,
        exists: existsSync,
      }),
    )
  } finally {
    store?.close()
  }
  return {
    path,
    current,
    text: renumberQueue(done.text),
    stats: merged.stats,
    migrated: legacy?.migrated ?? false,
    marked: done.marked,
  }
}
