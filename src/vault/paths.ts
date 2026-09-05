import { dirname, join } from 'node:path'
import type { SourceItem } from '../types.js'
import { sanitizeSegment } from './sanitize.js'

/**
 * A jegyzet célútja: `<gyökér>/<forrás>/<a felirat relatív mappája>/<alapnév><utótag>`.
 *
 * Szándékosan **metaadat-független**: ugyanoda ír metaadatfájllal és nélküle
 * is. Ha a célút a metaadatból jönne, ugyanaz a felirat két helyre kerülne
 * aszerint, hogy a metaadat elérhető volt-e — és a write-once védelem nem
 * venné észre a duplikátumot.
 *
 * A forrásmappa szerkezetének tükrözése azért jó csoportosítás, mert a
 * letöltők eleve csatornánként rendezik a fájlokat; ehhez viszont nem kell
 * tudnunk, hogy a mappa neve csatornát jelöl-e.
 */
export function noteFile(
  notesRoot: string,
  item: SourceItem,
  outputFile: string,
): string {
  const relDir = dirname(item.sourceFile)
  const segments = relDir === '.' ? [] : relDir.split('/').map(sanitizeSegment)
  return join(
    notesRoot,
    sanitizeSegment(item.source),
    ...segments,
    `${sanitizeSegment(item.baseName)}${outputFile}`,
  )
}

/** A Fázis 0 átirata: a `noteFile` speciális esete. */
export function transcriptFile(notesRoot: string, item: SourceItem): string {
  return noteFile(notesRoot, item, '_transcript.md')
}
