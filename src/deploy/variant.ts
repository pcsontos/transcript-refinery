import { originOf } from '../serve/notes.js'

export type SiteLanguage = 'hu' | 'en'

export interface VaultNote {
  vaultKind: string
  fields: Record<string, unknown>
}

export type Variant =
  | { ok: true; siteKind: string; language: SiteLanguage; target: string; fields: Record<string, unknown> }
  | { ok: false; reason: string }

/** A YAML időbélyege szövegként is, `Date`-ként is érkezhet; a site szövegként várja. */
function stamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' && value !== '' ? value : null
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')
const noOrig = (tag: unknown) => textOf(tag).replace(/-orig$/, '')

/**
 * Egy vault-jegyzetből a showroom szerződése szerinti nyelvi változat, vagy a
 * kihagyás oka. `siblings`: a tétel többi jegyzetének mezői vault-fajta szerint;
 * `committedAt`: csak szójegyzéknél, a fájl utolsó vault-commitjának ideje.
 * A `target` a `content/notes`-hoz képest értendő.
 */
export function variantOf(
  itemId: string,
  note: VaultNote,
  siblings: ReadonlyMap<string, Record<string, unknown>>,
  committedAt: string | null,
): Variant {
  const { vaultKind, fields } = note
  const lang = noOrig(fields.language)
  if (lang !== 'hu' && lang !== 'en') {
    return { ok: false, reason: `nyelv: ${textOf(fields.language) || 'ismeretlen'}` }
  }
  const out: Record<string, unknown> = { ...fields, item_id: itemId, language: lang }
  let siteKind = vaultKind

  if (/^glossary-/.test(vaultKind)) {
    siteKind = 'glossary'
    if (committedAt === null) return { ok: false, reason: 'a szójegyzék még nincs commitolva' }
    const sibling = [...siblings.values()].find((s) => typeof s.source === 'string')
    if (sibling === undefined) return { ok: false, reason: 'a tételnek nincs forrás-adata' }
    // A site a magányos source_language-re buktatná a buildet, ezért kimarad.
    delete out.source_language
    out.source = sibling.source
    out.origin = originOf(sibling)
    out.generated_at = committedAt
  } else if (fields.translation_of !== undefined) {
    const suffix = `-${lang}`
    if (!vaultKind.endsWith(suffix)) return { ok: false, reason: 'a fordítás fájlneve nem <fajta>-<nyelv> alakú' }
    siteKind = vaultKind.slice(0, -suffix.length)
    if (!fields.source_language) return { ok: false, reason: 'fordítás: hiányzik a source_language' }
    out.source_language = noOrig(fields.source_language)
    const sourceStamp = stamp(fields.source_generated_at) ?? stamp(siblings.get(siteKind)?.generated_at)
    if (sourceStamp === null) {
      return { ok: false, reason: 'fordítás: hiányzik a source_generated_at, és az eredeti nincs a vaultban' }
    }
    out.source_generated_at = sourceStamp
    out.translation_of = siteKind
  }

  const generated = stamp(out.generated_at)
  if (generated === null) return { ok: false, reason: 'nincs generated_at' }
  out.generated_at = generated
  out.kind = siteKind
  if (siteKind !== 'glossary') out.origin = originOf(fields)
  return { ok: true, siteKind, language: lang, target: `${itemId}/${siteKind}.${lang}.mdx`, fields: out }
}
