import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { frontmatter } from '../serve/notes.js'
import type { SourceItem } from '../types.js'
import { noteFile, type NoteFileOptions } from './paths.js'
import { sanitizeSegment } from './sanitize.js'

const SUFFIX = '_transcript.md'

/**
 * A mappa `*_transcript.md` fájljai közül azok alapneve, amelyek frontmatterében
 * `item_id` a tétel azonosítója. Több találatnál a `currentBase`-től (a tétel mai
 * alapnevétől) eltérő nyer: két átirat csak úgy lehet, hogy a mai név eltér a
 * régitől, és a meglévő jegyzetek a régit használják. A fájlidő erre nem jó
 * (git-klónban azonos, `--force` után megfordul), csak a maradék döntetlent
 * dönti el (a régebbi nyer). Nincs mappa vagy találat: `null`.
 */
export function transcriptBase(dir: string, itemId: string, currentBase?: string): string | null {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  const matches: { base: string; mtime: number }[] = []
  for (const name of names) {
    if (!name.endsWith(SUFFIX)) continue
    const path = join(dir, name)
    // ponytail: a teljes átiratot olvassa; readHead-szerű részolvasás, ha a mappák nagyra nőnek.
    const id = frontmatter(readFileSync(path, 'utf8'))?.item_id
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) !== itemId) continue
    matches.push({ base: name.slice(0, -SUFFIX.length), mtime: statSync(path).mtimeMs })
  }
  const others = matches.filter((m) => m.base !== currentBase)
  const pool = others.length > 0 ? others : matches
  pool.sort((a, b) => a.mtime - b.mtime || a.base.localeCompare(b.base))
  return pool[0]?.base ?? null
}

/** A tétel jegyzetmappája és a benne már használt alapnév (ha van). */
export function notePlacement(
  notesRoot: string,
  item: SourceItem,
  layout: string,
  pinnedDir: string | null,
): NoteFileOptions {
  const dir = dirname(noteFile(notesRoot, item, SUFFIX, { layout, pinnedDir }))
  const pinnedBase = transcriptBase(dir, item.itemId, sanitizeSegment(item.baseName)) ?? undefined
  return { layout, pinnedDir, pinnedBase }
}
