import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Config } from '../config.js'
import type { CallbackBody, ServeJob, SummaryPair } from '../serve/job.js'
import { failedReason } from './archive.js'
import { whisperDirs, type WhisperDirs } from './paths.js'

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
    return { ok: true, title: titleOf(parsed, id), language, extension: 'srt', subtitle: new Uint8Array(subtitle), info: new Uint8Array(info), sourcePath: srt }
  } catch {
    return { ok: false, error: MISSING_TRANSCRIPT }
  }
}

export interface AfterItem {
  id: string
  title: string
  /** A jelölő: a leadó `jobId`, vagy `cli`. */
  marker: string
  /** A jelölőt hordozó `info.json`. */
  infoPath: string
  /** Elbukott átírás oka; `null`, ha kész az `.srt`. */
  failed: string | null
}

async function readMarked(path: string): Promise<{ info: Record<string, unknown>; marker: string } | null> {
  try {
    const info = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    const marker = info[AFTER_FIELD]
    return typeof marker === 'string' && marker !== '' ? { info, marker } : null
  } catch {
    return null
  }
}

/** A jelölős, még kezeletlen tételek: kész átirat a `sources/whisper` alatt, vagy elbukott átírás a `failed/`-ben. */
export async function pendingAfter(sourcesRoot: string, dirs: WhisperDirs): Promise<AfterItem[]> {
  const items: AfterItem[] = []
  const done = await files(join(sourcesRoot, 'whisper'))
  const srt = new Set(
    done.flatMap((path) => {
      const id = SRT.exec(basename(path))?.[1]
      return id === undefined ? [] : [join(dirname(path), id)]
    }),
  )
  for (const path of done) {
    if (!path.endsWith('.info.json')) continue
    const id = basename(path, '.info.json')
    // A figyelő az info.json-t az .srt előtt teszi ki: .srt nélkül az átirat még nincs kész.
    if (!srt.has(join(dirname(path), id))) continue
    const marked = await readMarked(path)
    if (marked !== null) items.push({ id, title: titleOf(marked.info, id), marker: marked.marker, infoPath: path, failed: null })
  }
  const failed = await files(dirs.failed, false)
  for (const path of failed) {
    if (!path.endsWith('.info.json')) continue
    const id = basename(path, '.info.json')
    // A `.log` készül utoljára (a figyelő `_move_to_failed`-je): nélküle a tétel még mozog.
    if (!failed.includes(join(dirs.failed, `${id}.log`))) continue
    const marked = await readMarked(path)
    if (marked === null) continue
    const reason = (await failedReason(dirs, id)) ?? 'ismeretlen hiba'
    items.push({ id, title: titleOf(marked.info, id), marker: marked.marker, infoPath: path, failed: reason })
  }
  return items
}

/** A jelölő törlése (átnevezéssel, atomikusan): ez az egyszeriség, újraindítás után sem fut újra. */
async function dropMarker(path: string): Promise<void> {
  const info = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  delete info[AFTER_FIELD]
  const temp = `${path}.after-tmp`
  await writeFile(temp, JSON.stringify(info, null, 2))
  await rename(temp, path)
}

export function failedLine(title: string, reason: string): string {
  return `${title}: az átírás nem sikerült: ${reason}`
}

export interface AfterDeps {
  load: () => Promise<{ cfg: Config }>
  /** A serve kapujának lefoglalása (`claimGate`); `null`, ha foglalt. */
  claim: (label: string) => (() => void) | null
  /** A Worker-visszahívás; dob, ha nem ért célba (a jelölő marad, a következő kör újra próbálja). */
  callback: (jobId: string, body: CallbackBody) => Promise<void>
  /** Helyi futás (CLI-leadás vagy `notify: false`): a Telegram-receptjob menete, üzenet nélkül. */
  runLocal: (job: ServeJob) => Promise<void>
}

/** Egy kör: a jelölős tételek kezelése. Telegram + `notify`: jelzés a Workernek; különben helyi futás a kapu alatt. */
export async function afterWhisperTick(deps: AfterDeps): Promise<void> {
  let cfg: Config
  try {
    cfg = (await deps.load()).cfg
  } catch {
    return // dedikált serve config nélkül nincs utólépés
  }
  const after = cfg.whisperAfter
  const dirs = await whisperDirs(cfg)
  if (after === null || dirs === null) return
  for (const item of await pendingAfter(cfg.sources[0]!.path, dirs)) {
    const viaWorker = after.notify && item.marker !== CLI_AFTER
    try {
      if (item.failed !== null) {
        if (viaWorker) await deps.callback(item.marker, { status: 'progress', text: failedLine(item.title, item.failed) })
      } else if (viaWorker) {
        await deps.callback(item.marker, { status: 'transcribed', videoId: item.id, title: item.title, recipes: [...after.recipes] })
      } else {
        const release = deps.claim(`after-whisper ${item.id}`)
        if (release === null) return // a kapu foglalt: a következő kör próbálja
        try {
          await deps.runLocal({ jobId: `after-whisper:${item.id}`, videoId: item.id, url: AFTER_WHISPER, recipes: [...after.recipes], ...(item.marker === CLI_AFTER ? { origin: 'cli' as const } : {}) })
        } finally {
          release()
        }
      }
      await dropMarker(item.infoPath)
    } catch (error) {
      console.warn(`[after-whisper] ${item.id}: ${error instanceof Error ? error.message : String(error)}; a következő kör újra próbálja`)
    }
  }
}

// ponytail: 30 mp-es pollozás; az fs-figyelés a kötetre nem megbízható. Ha a késés zavar, rövidebb kör vagy fs.watch + pollozás.
export const AFTER_POLL_MS = 30_000

/** Az első kör azonnal fut (felzárkózás az újraindítás után), utána `every` ms-onként; a folyamat kilépését nem tartja vissza. */
export function startAfterWhisper(deps: AfterDeps, every = AFTER_POLL_MS): void {
  const loop = async (): Promise<void> => {
    try {
      await afterWhisperTick(deps)
    } catch (error) {
      console.warn(`[after-whisper] ${error instanceof Error ? error.message : String(error)}`)
    }
    setTimeout(() => void loop(), every).unref()
  }
  void loop()
}
