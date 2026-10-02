import { isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

export interface SubtitleArgs {
  inputs: string[]
  listPath?: string
  out?: string
  subLang?: string[]
  subFormat: string[]
  overwrite: boolean
  flat: boolean
  playlistItems?: string
  yesPlaylist: boolean
  config?: string
}

export type ParseResult = { ok: true; args: SubtitleArgs } | { ok: false; error: string }

function fail(error: string): ParseResult {
  return { ok: false, error }
}

function normalizeLang(raw: string): string | null {
  const [head, ...rest] = raw.trim().split('-')
  if (head === undefined || head === '' || head.toLowerCase() === 'all') return null
  const tag = rest.length === 0 ? head.toLowerCase() : `${head.toLowerCase()}-${rest.join('-')}`
  return LANG.test(tag) ? tag : null
}

function languages(raw: string | undefined): string[] | undefined | ParseResult {
  if (raw === undefined) return undefined
  const items = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (items.length === 0) return fail('A --sub-lang eleme nyelvkód, például hu vagy en-US.')
  const tags: string[] = []
  for (const item of items) {
    const tag = normalizeLang(item)
    if (tag === null) return fail('A --sub-lang eleme nyelvkód, például hu vagy en-US.')
    tags.push(tag)
  }
  return tags
}

function formats(raw: string | undefined): string[] | ParseResult {
  if (raw === undefined) return ['vtt', 'srt']
  const items = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (items.length === 0 || items.some((item) => item !== 'vtt' && item !== 'srt')) {
    return fail('A --sub-format csak vtt és srt lehet.')
  }
  if (new Set(items).size !== items.length) return fail('A --sub-format egy formátumot csak egyszer tartalmazhat.')
  return items
}

/** A subtitle modalitás saját kapcsolóelemzője. */
export function parseSubtitleArgs(argv: readonly string[]): ParseResult {
  let values: {
    out?: string
    list?: string
    'sub-lang'?: string
    'sub-format'?: string
    overwrite: boolean
    flat: boolean
    'playlist-items'?: string
    'yes-playlist': boolean
    config?: string
  }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        out: { type: 'string' },
        list: { type: 'string' },
        'sub-lang': { type: 'string' },
        'sub-format': { type: 'string' },
        overwrite: { type: 'boolean', default: false },
        flat: { type: 'boolean', default: false },
        'playlist-items': { type: 'string' },
        'yes-playlist': { type: 'boolean', default: false },
        config: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (error) {
    const unknown = /Unknown option '(--[^']+)'/.exec((error as Error).message)
    if (unknown?.[1] !== undefined) return fail(`Ismeretlen kapcsoló: ${unknown[1]}`)
    return fail((error as Error).message)
  }

  if (positionals.length > 1) return fail('Egy cím adható meg.')
  const url = positionals[0]
  if (url !== undefined && values.list !== undefined) {
    return fail('Adj meg egy címet vagy egy --list fájlt, a kettőt együtt nem.')
  }
  if (url === undefined && values.list === undefined) {
    return fail('Adj meg egy címet vagy egy --list fájlt.')
  }
  if (values.out !== undefined && !isAbsolute(values.out)) return fail('A --out abszolút útvonal kell legyen.')
  if (values['playlist-items'] === '') return fail('A --playlist-items értéke nem lehet üres.')
  const subLang = languages(values['sub-lang'])
  if (subLang !== undefined && !Array.isArray(subLang)) return subLang
  const subFormat = formats(values['sub-format'])
  if (!Array.isArray(subFormat)) return subFormat
  return {
    ok: true,
    args: {
      inputs: url === undefined ? [] : [url],
      listPath: values.list,
      out: values.out,
      subLang,
      subFormat,
      overwrite: values.overwrite,
      flat: values.flat,
      playlistItems: values['playlist-items'],
      yesPlaylist: values['yes-playlist'],
      config: values.config,
    },
  }
}
