import { originOf } from '../serve/notes.js'

// a site lib/note-frontmatter.ts ISO_639_1 listájának átirata (183 kétbetűs kód); az eredeti változat nyelve
export const ISO_639_1: ReadonlySet<string> = new Set([
  'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az', 'ba', 'be', 'bg', 'bi', 'bm', 'bn',
  'bo', 'br', 'bs', 'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy', 'da', 'de', 'dv', 'dz', 'ee', 'el',
  'en', 'eo', 'es', 'et', 'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'gu', 'gv',
  'ha', 'he', 'hi', 'ho', 'hr', 'ht', 'hu', 'hy', 'hz', 'ia', 'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is', 'it',
  'iu', 'ja', 'jv', 'ka', 'kg', 'ki', 'kj', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky',
  'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lu', 'lv', 'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt',
  'my', 'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny', 'oc', 'oj', 'om', 'or', 'os', 'pa',
  'pi', 'pl', 'ps', 'pt', 'qu', 'rm', 'rn', 'ro', 'ru', 'rw', 'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl',
  'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn',
  'to', 'tr', 'ts', 'tt', 'tw', 'ty', 'ug', 'uk', 'ur', 'uz', 've', 'vi', 'vo', 'wa', 'wo', 'xh', 'yi', 'yo',
  'za', 'zh', 'zu',
])

// a fordítás nyelve: a site lib/i18n.ts nyelvei
export const TRANSLATION_LANGUAGES: readonly string[] = ['hu', 'en']

export interface VaultNote {
  vaultKind: string
  fields: Record<string, unknown>
}

export type Variant =
  | { ok: true; siteKind: string; language: string; target: string; fields: Record<string, unknown> }
  | { ok: false; reason: string }

/** A YAML időbélyege szövegként is, `Date`-ként is érkezhet; a site szövegként várja. */
function stamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' && value !== '' ? value : null
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')
const noOrig = (tag: unknown) => textOf(tag).replace(/-orig$/, '')

/** A vault-fajtából a site-fajta (a célfájl nevében álló): `glossary-*` → `glossary`, a fordításnál a `-<nyelv>` levágva. */
export function siteKindOf(vaultKind: string, fields: Record<string, unknown>): string {
  if (/^glossary-/.test(vaultKind)) return 'glossary'
  if (fields.translation_of === undefined) return vaultKind
  const suffix = `-${noOrig(fields.language)}`
  return vaultKind.endsWith(suffix) ? vaultKind.slice(0, -suffix.length) : vaultKind
}

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
  // a szójegyzék nyelve marad hu/en (a spec: változatlan); másképp egy második eredeti törné a site buildjét
  const known = fields.translation_of === undefined && !/^glossary-/.test(vaultKind) ? ISO_639_1.has(lang) : TRANSLATION_LANGUAGES.includes(lang)
  if (!known) {
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
