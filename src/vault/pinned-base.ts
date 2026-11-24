import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { frontmatter } from '../serve/notes.js'
import type { SourceItem } from '../types.js'
import { noteFile, type NoteFileOptions } from './paths.js'

const SUFFIX = '_transcript.md'

/**
 * A mappa `*_transcript.md` fájljai közül azok alapneve, amelyek frontmatterében
 * `item_id` a tétel azonosítója; több találatnál a legrégebbi módosítású.
 * Nincs mappa vagy találat: `null`.
 */
export function transcriptBase(dir: string, itemId: string): string | null {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  let best: { base: string; mtime: number } | null = null
  for (const name of names) {
    if (!name.endsWith(SUFFIX)) continue
    const path = join(dir, name)
    // ponytail: a teljes átiratot olvassa; readHead-szerű részolvasás, ha a mappák nagyra nőnek.
    const id = frontmatter(readFileSync(path, 'utf8'))?.item_id
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) !== itemId) continue
    const mtime = statSync(path).mtimeMs
    if (best === null || mtime < best.mtime) best = { base: name.slice(0, -SUFFIX.length), mtime }
  }
  return best?.base ?? null
}

/** A tétel jegyzetmappája és a benne már használt alapnév (ha van). */
export function notePlacement(
  notesRoot: string,
  item: SourceItem,
  layout: string,
  pinnedDir: string | null,
): NoteFileOptions {
  const dir = dirname(noteFile(notesRoot, item, SUFFIX, { layout, pinnedDir }))
  const pinnedBase = transcriptBase(dir, item.itemId) ?? undefined
  return { layout, pinnedDir, pinnedBase }
}
