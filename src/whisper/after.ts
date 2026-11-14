import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Config } from '../config.js'
import type { SummaryPair } from '../serve/job.js'

/** Az inbox-`info.json` jelölője (pcsontos/issue-tracker#45): a leadó Telegram-munka `jobId`-je, vagy `cli`. */
export const AFTER_FIELD = 'refinery_after'
export const CLI_AFTER = 'cli'

/** A `ServeJob.url` értéke az átírás utáni futásnál: a bemenet a helyi `.srt`, nem az R2. A Worker ugyanezt a szót írja. */
export const AFTER_WHISPER = 'after-whisper'

export const MISSING_TRANSCRIPT = 'Az átirat nincs meg a sources/whisper alatt.'

const SRT = /^(.+)\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.srt$/

/** A leadáskor írandó jelölő: csak ha a configban van utólépés, így a régi és az `after` nélkül leadott átiratok nem indítanak semmit. */
export function afterMarker(cfg: Pick<Config, 'whisperAfter'>, origin: string): string | undefined {
  return cfg.whisperAfter === null ? undefined : origin
}

/** A mappa fájljai teljes úttal; hiányzó mappa = üres lista. */
async function files(dir: string, recursive = true): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function titleOf(info: Record<string, unknown>, id: string): string {
  return typeof info.title === 'string' && info.title.trim() !== '' ? info.title : id
}

/** A kész átirat párja a `sources/whisper/<csatorna>/` alól: `<id>.<nyelv>.srt` és `<id>.info.json`. */
export async function readWhisperPair(sourcesRoot: string, id: string): Promise<SummaryPair> {
  const srt = (await files(join(sourcesRoot, 'whisper'))).find((path) => SRT.exec(basename(path))?.[1] === id)
  const language = srt === undefined ? undefined : SRT.exec(basename(srt))?.[2]
  if (srt === undefined || language === undefined) return { ok: false, error: MISSING_TRANSCRIPT }
  try {
    const info = await readFile(join(dirname(srt), `${id}.info.json`))
    const parsed = JSON.parse(info.toString('utf8')) as Record<string, unknown>
    const subtitle = await readFile(srt)
    return { ok: true, title: titleOf(parsed, id), language, extension: 'srt', subtitle: new Uint8Array(subtitle), info: new Uint8Array(info) }
  } catch {
    return { ok: false, error: MISSING_TRANSCRIPT }
  }
}
