import { join } from 'node:path'
import type { SourceItem } from '../types.js'
import { sanitizeSegment } from './sanitize.js'

export const DEFAULT_LAYOUT = '{channel}/{item_id}'
export const LAYOUT_FIELDS = ['item_id', 'title', 'channel', 'video_id', 'uploaded'] as const
type LayoutField = (typeof LAYOUT_FIELDS)[number]

const FIELD_SEGMENT = /^\{([a-z_]+)\}$/

/** A sablon hibája, vagy `null`. Csak `{mező}` szegmensek, ismert mezőnévvel. */
export function layoutError(layout: string): string | null {
  for (const segment of layout.split('/')) {
    const name = FIELD_SEGMENT.exec(segment)?.[1]
    if (name === undefined) return `a szegmens nem {mező}: ${segment}`
    if (!(LAYOUT_FIELDS as readonly string[]).includes(name)) {
      return `ismeretlen mező: {${name}}; ismert: ${LAYOUT_FIELDS.join(', ')}`
    }
  }
  return null
}

/** A kitöltött szegmensek; a hiányzó vagy üres mező szegmense kimarad. */
export function layoutSegments(layout: string, fields: Partial<Record<LayoutField, string>>): string[] {
  return layout.split('/').flatMap((segment) => {
    // Vezető pont nélkül: a ponttal kezdődő mappa rejtett lenne, a követés pedig kihagyná.
    const value = fields[FIELD_SEGMENT.exec(segment)![1] as LayoutField]?.trim().replace(/^\.+/, '').trim()
    return value ? [sanitizeSegment(value)] : []
  })
}

/** Egy elem sablonmezői. */
export function itemFields(item: SourceItem): Partial<Record<LayoutField, string>> {
  return {
    item_id: item.itemId,
    title: item.title,
    channel: item.metadata.channel,
    video_id: item.metadata.videoId,
    uploaded: item.metadata.uploadedAt,
  }
}

export interface NoteFileOptions {
  /** A `vault.layout` sablon; hiányában `DEFAULT_LAYOUT`. */
  layout?: string
  /** Az elem már megírt kimenetének mappája: ez nyer a sablon fölött. */
  pinnedDir?: string | null
}

/**
 * A jegyzet célútja: `<gyökér>/<forrás>/<kitöltött sablon>/<alapnév><utótag>`.
 *
 * A sablon a metaadatból számolódik, ezért ugyanaz az elem metaadat nélkül
 * máshová kerülne. A kettéválást a `pinnedDir` akadályozza meg: ha az
 * elemnek már van kimenete, a további receptek annak a mappájába mennek.
 */
export function noteFile(
  notesRoot: string,
  item: SourceItem,
  outputFile: string,
  opts: NoteFileOptions = {},
): string {
  const dir =
    opts.pinnedDir ??
    join(
      notesRoot,
      sanitizeSegment(item.source),
      ...layoutSegments(opts.layout ?? DEFAULT_LAYOUT, itemFields(item)),
    )
  return join(dir, `${sanitizeSegment(item.baseName)}${outputFile}`)
}

/** A Fázis 0 átirata: a `noteFile` speciális esete. */
export function transcriptFile(notesRoot: string, item: SourceItem, opts?: NoteFileOptions): string {
  return noteFile(notesRoot, item, '_transcript.md', opts)
}
