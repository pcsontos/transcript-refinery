import { isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'

export type Pick = 'all' | number[]

export interface AudioArgs {
  inputs: string[]
  listPath?: string
  out?: string
  overwrite: boolean
  playlistItems?: string
  yesPlaylist: boolean
  config?: string
  pick?: Pick
}

export type ParseResult = { ok: true; args: AudioArgs } | { ok: false; error: string }

function fail(error: string): ParseResult {
  return { ok: false, error }
}

/** `0` = mind; különben vesszővel elválasztott sorszámok, ismétlés nélkül, növekvő sorrendben. */
export function parsePick(raw: string): Pick | null {
  const text = raw.replace(/\s+/g, '')
  if (!/^\d+(,\d+)*$/.test(text)) return null
  const numbers = text.split(',').map(Number)
  if (numbers.includes(0)) return numbers.length === 1 ? 'all' : null
  return [...new Set(numbers)].sort((a, b) => a - b)
}

/** Az audio modalitás kapcsolóelemzője (több URL, --pick; nincs felirat-kapcsoló). */
export function parseAudioArgs(argv: readonly string[]): ParseResult {
  let values: {
    out?: string
    list?: string
    overwrite: boolean
    'playlist-items'?: string
    'yes-playlist': boolean
    config?: string
    pick?: string
  }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        out: { type: 'string' },
        list: { type: 'string' },
        overwrite: { type: 'boolean', default: false },
        'playlist-items': { type: 'string' },
        'yes-playlist': { type: 'boolean', default: false },
        config: { type: 'string' },
        pick: { type: 'string' },
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

  if (positionals.length > 0 && values.list !== undefined) {
    return fail('Adj meg címet vagy egy --list fájlt, a kettőt együtt nem.')
  }
  if (positionals.length === 0 && values.list === undefined) {
    return fail('Adj meg egy címet vagy egy --list fájlt.')
  }
  if (values.out !== undefined && !isAbsolute(values.out)) return fail('A --out abszolút útvonal kell legyen.')
  if (values['playlist-items'] === '') return fail('A --playlist-items értéke nem lehet üres.')
  let pick: Pick | undefined
  if (values.pick !== undefined) {
    const parsedPick = parsePick(values.pick)
    if (parsedPick === null) return fail('A --pick értéke 0, vagy vesszővel elválasztott sorszámok (pl. 1,3).')
    if (positionals.length !== 1 || values.list !== undefined) return fail('A --pick csak egyetlen címmel adható meg.')
    pick = parsedPick
  }
  return {
    ok: true,
    args: {
      inputs: positionals,
      listPath: values.list,
      out: values.out,
      overwrite: values.overwrite,
      playlistItems: values['playlist-items'],
      yesPlaylist: values['yes-playlist'],
      config: values.config,
      pick,
    },
  }
}
