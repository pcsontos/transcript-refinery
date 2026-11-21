import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { EventSink } from '../events.js'
import type { HandoffResult } from '../fetch/audio/run.js'
import type { AudioStore } from '../fetch/audio/store.js'
import { parseLang } from '../fetch/subtitle/args.js'
import type { Config } from '../config.js'
import { AFTER_FIELD, CLI_AFTER, missingAfter, requestAfter } from './after.js'
import { findEntry, listArchive, statusContext, transcriptStatus, type AudioEntry, type TranscriptStatus } from './archive.js'
import { channelSlug, watcherWarning, whisperDirs, type WhisperDirs } from './paths.js'

const LANG_ERROR = 'A --lang értéke egyetlen nyelvkód, például hu vagy en-US.'
const NO_LANG_ERROR = 'nincs nyelv: adj meg --lang kapcsolót'

/**
 * `--lang` > az archív `info.json` `language` mezője > a config első nyelve. `askLang` (Telegram, pcsontos/issue-tracker#82):
 * nincs config-tartalék, a nyelv hiányát a hívó kérdéssé alakítja.
 */
export function resolveLang(input: {
  flag?: string
  info: Record<string, unknown>
  languages: readonly string[]
  askLang?: boolean
}): string | null {
  const fromFlag = input.flag === undefined ? null : parseLang(input.flag)
  if (fromFlag !== null) return fromFlag
  const fromInfo = typeof input.info.language === 'string' ? parseLang(input.info.language) : null
  if (fromInfo !== null) return fromInfo
  const first = input.askLang === true ? undefined : input.languages[0]
  return first === undefined ? null : parseLang(first)
}

/** Az inboxba kerülő `info.json`: az archív tartalom, felülírt `id` és `channel`, plusz a refinery mezői; `after`: az utólépés jelölője (#45). */
export function inboxInfo(entry: AudioEntry, lang: string, after?: string): Record<string, unknown> {
  return {
    ...entry.info,
    id: entry.id,
    channel: entry.channel,
    refinery_lang: lang,
    refinery_target: `whisper/${channelSlug(entry.channel)}`,
    ...(after === undefined ? {} : { [AFTER_FIELD]: after }),
  }
}

/** `needsLang`: nincs nyelv, a hívó dönt (kérdez vagy hibát ad); az inboxhoz nem nyúltunk (pcsontos/issue-tracker#82). */
export type SubmitResult =
  | { ok: true }
  | { ok: false; skip: 'kész' | 'vár' | 'átírás alatt' }
  | { ok: false; needsLang: true }
  | { ok: false; error: string }

const SKIP: Partial<Record<TranscriptStatus, 'kész' | 'vár' | 'átírás alatt'>> = {
  done: 'kész',
  pending: 'vár',
  working: 'átírás alatt',
}

/** Az `info.json` előbb, a hang utoljára, mindkettő `.partial` + átnevezéssel; hibánál nem marad semmi az inboxban. */
export async function submitEntry(
  entry: AudioEntry,
  deps: { store: AudioStore; dirs: WhisperDirs; status: TranscriptStatus; lang: string | null; after?: string },
): Promise<SubmitResult> {
  const skip = SKIP[deps.status]
  if (skip !== undefined) return { ok: false, skip }
  if (deps.lang === null) return { ok: false, needsLang: true }
  const info = join(deps.dirs.inbox, `${entry.id}.info.json`)
  const audio = join(deps.dirs.inbox, `${entry.id}.${entry.ext}`)
  // Leadónként külön átmeneti név: két egyidejű leadó nem ír közös fájlba, és nem takarítja egymás félkészét.
  const token = randomBytes(4).toString('hex')
  const infoPartial = `${info}.${token}.partial`
  const audioPartial = `${audio}.${token}.partial`
  try {
    await mkdir(deps.dirs.inbox, { recursive: true })
    await sweepStalePartials(deps.dirs.inbox, entry.id)
    await writeFile(infoPartial, JSON.stringify(inboxInfo(entry, deps.lang, deps.after), null, 2))
    await rename(infoPartial, info)
    await deps.store.copyTo(entry.key, audioPartial)
    await rename(audioPartial, audio)
    return { ok: true }
  } catch (error) {
    await Promise.all([info, infoPartial, audioPartial].map((path) => rm(path, { force: true })))
    return { ok: false, error: (error as Error).message }
  }
}

const STALE_PARTIAL_MS = 3600_000

/** Összeomlott leadó `.partial` maradékai: az egy óránál régebbieket törli, a frisset (másik leadóét) nem. */
async function sweepStalePartials(inbox: string, id: string): Promise<void> {
  for (const name of await readdir(inbox)) {
    if (!name.startsWith(`${id}.`) || !name.endsWith('.partial')) continue
    const path = join(inbox, name)
    try {
      if (Date.now() - (await stat(path)).mtimeMs > STALE_PARTIAL_MS) await rm(path, { force: true })
    } catch {
      // időközben eltűnt: nincs teendő
    }
  }
}

export interface TranscribeArgs {
  ids: string[]
  lang?: string
  config?: string
}

export function parseTranscribeArgs(argv: readonly string[]): { ok: true; args: TranscribeArgs } | { ok: false; error: string } {
  let values: { lang?: string; config?: string }
  let positionals: string[]
  // A YouTube-azonosító `-`-lel is kezdődhet: az egy `-` kezdetű szó azonosító, nem (rövid) kapcsoló. A kapcsolók
  // `--` előtagúak; a `--`-ot a parseArgs-nak adott lista elején állítjuk elő, az azonosítókat utána.
  const flagArgs: string[] = []
  const idArgs: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const word = argv[i] as string
    if (word === '--lang' || word === '--config') {
      flagArgs.push(word)
      const value = argv[i + 1]
      if (value !== undefined) flagArgs.push(value)
      i += 1
    } else if (word === '--') {
      continue // a felhasználó saját `--`-a: a sajátunkat lent tesszük be (pcsontos/issue-tracker#39)
    } else if (word.startsWith('--')) {
      flagArgs.push(word)
    } else {
      idArgs.push(word)
    }
  }
  try {
    const parsed = parseArgs({
      args: [...flagArgs, '--', ...idArgs],
      options: { lang: { type: 'string' }, config: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (error) {
    const unknown = /Unknown option '(--[^']+)'/.exec((error as Error).message)
    return { ok: false, error: unknown?.[1] !== undefined ? `Ismeretlen kapcsoló: ${unknown[1]}` : (error as Error).message }
  }
  let lang: string | undefined
  if (values.lang !== undefined) {
    const tag = parseLang(values.lang)
    if (tag === null) return { ok: false, error: LANG_ERROR }
    lang = tag
  }
  const ids = [...new Set(positionals)]
  if (ids.length === 0) return { ok: false, error: 'Adj meg legalább egy hangot (videó-azonosító vagy a list --audios kulcsa).' }
  return { ok: true, args: { ids, lang, config: values.config } }
}

export interface TranscribeDeps {
  store: AudioStore
  dirs: WhisperDirs
  sourcesRoot: string
  languages: readonly string[]
  emit: (line: string) => void | Promise<void>
  sink?: EventSink
  stopped?: () => boolean
  /** Az utólépés jelölője (`afterMarker`); hiányában nincs jelölő. */
  after?: string
  /** Tételenként a kész receptek (`readDoneRecipes`); nélküle a kész tétel „kihagyva (kész)”, utólépés-kérés nincs. */
  done?: ReadonlyMap<string, readonly string[]>
  /** A `whisper.after` készlete; `null`/hiányzó = nincs utólépés-kérés. */
  afterRecipes?: { recipes: readonly string[]; notify: boolean } | null
  /**
   * Telegramról: a nyelv nélküli hangnál nincs config-tartalék, a hang „nyelvre vár” (`langPending`), a Worker nyelvgombot küld.
   * Hiányában (CLI) a config első nyelve a tartalék, és nyelv hiányában a mai hibasor jön.
   */
  askLang?: boolean
}

export async function runTranscribe(
  args: { ids: readonly string[]; lang?: string },
  deps: TranscribeDeps,
): Promise<{ submitted: number; requested: number; failed: number; langPending: string[] }> {
  const sink = deps.sink ?? (() => undefined)
  const { entries, warning } = await listArchive(deps.store)
  if (warning !== undefined) await deps.emit(warning)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const ctx = await statusContext(deps.sourcesRoot, deps.dirs)
  const handedOver = new Set<string>()
  let submitted = 0
  let requested = 0
  let skipped = 0
  let failed = 0
  const langPending: string[] = []
  sink({ type: 'scan:found', count: args.ids.length })

  for (const id of args.ids) {
    if (deps.stopped?.() === true) break
    const entry = byId.get(id)
    if (entry === undefined) {
      failed += 1
      sink({ type: 'item:start', itemId: id, title: id })
      sink({ type: 'item:failed', itemId: id, source: 'whisper', kind: 'whisper', error: 'nincs ilyen hang' })
      await deps.emit(`hiba: ${id}: nincs ilyen hang`)
      continue
    }
    const label = `${entry.title} [${id}]`
    sink({ type: 'item:start', itemId: id, title: entry.title })
    const status = handedOver.has(id) ? 'pending' : transcriptStatus(entry, ctx)
    if (status === 'done' && deps.after !== undefined && deps.afterRecipes != null && deps.done !== undefined) {
      const have = deps.done.get(id) ?? []
      if (missingAfter(have, deps.afterRecipes.recipes).length === 0) {
        skipped += 1
        sink({ type: 'item:skipped', itemId: id, reason: 'kész' })
        await deps.emit(`kihagyva (kész, receptek: ${have.join(', ')}): ${label}`)
      } else if (await requestAfter(deps.sourcesRoot, id, deps.after)) {
        requested += 1
        handedOver.add(id)
        sink({ type: 'item:step', itemId: id, step: 'utólépés kérve' })
        const silent = deps.after !== CLI_AFTER && !deps.afterRecipes.notify
        await deps.emit(
          `utólépés kérve: ${label} (receptek: ${deps.afterRecipes.recipes.join(', ')}; a serve utólépése futtatja)` +
            (silent ? ' — kész-üzenet nem jön (whisper.after.notify: false)' : ''),
        )
      } else {
        failed += 1
        sink({ type: 'item:failed', itemId: id, source: 'whisper', kind: 'whisper', error: 'nincs meg az átirat info.json-ja' })
        await deps.emit(`hiba: ${label}: nincs meg az átirat info.json-ja`)
      }
      continue
    }
    const lang = resolveLang({ flag: args.lang, info: entry.info, languages: deps.languages, askLang: deps.askLang })
    const result = await submitEntry(entry, { store: deps.store, dirs: deps.dirs, status, lang, after: deps.after })
    if ('needsLang' in result) {
      if (deps.askLang === true) {
        langPending.push(id)
        skipped += 1
        sink({ type: 'item:skipped', itemId: id, reason: 'nyelvre vár' })
        await deps.emit(`nyelvre vár: ${label}`)
      } else {
        failed += 1
        sink({ type: 'item:failed', itemId: id, source: 'whisper', kind: 'whisper', error: NO_LANG_ERROR })
        await deps.emit(`hiba: ${label}: ${NO_LANG_ERROR}`)
      }
    } else if ('error' in result) {
      failed += 1
      sink({ type: 'item:failed', itemId: id, source: 'whisper', kind: 'whisper', error: result.error })
      await deps.emit(`hiba: ${label}: ${result.error}`)
    } else if ('skip' in result) {
      skipped += 1
      sink({ type: 'item:skipped', itemId: id, reason: result.skip })
      await deps.emit(`kihagyva (${result.skip}): ${label}`)
    } else {
      submitted += 1
      handedOver.add(id)
      sink({ type: 'item:step', itemId: id, step: 'átírásra leadva' })
      sink({ type: 'item:published', itemId: id, path: `${id}.${entry.ext}` })
      await deps.emit(`leadva: ${label}`)
    }
  }

  await deps.emit(`${submitted} tétel leadva.`)
  if (requested > 0) await deps.emit(`${requested} tételre utólépés kérve.`)
  const warn = await watcherWarning(deps.dirs)
  if (warn !== null) await deps.emit(warn)
  sink({ type: 'run:done', succeeded: submitted, skipped, failed })
  return { submitted, requested, failed, langPending }
}

/**
 * A `fetch audio` fallback-leadása. `string` = a nem-elérhetőség oka. Mindig az archívumból ad le
 * (a friss letöltést is: Saját döntés 8), az állapotot hívásonként frissen olvassa.
 */
export async function createHandoff(input: {
  cfg: Config | null
  store: AudioStore
  lang?: string
  after?: string
  /** Lásd `TranscribeDeps.askLang`: igaz értéknél a nyelv nélküli hang `needs-lang`, az id a `langPending`-be kerül. */
  askLang?: boolean
}): Promise<{ handoff: (id: string) => Promise<HandoffResult>; warning: () => Promise<string | null>; langPending: string[] }> {
  const { cfg, store } = input
  const dirs = cfg === null ? null : await whisperDirs(cfg)
  const handedOver = new Set<string>()
  const langPending: string[] = []
  return {
    langPending,
    async handoff(id) {
      if (cfg === null) return { error: 'nincs config' }
      if (dirs === null) return { error: 'nincs whisper-mappa' }
      const entry = await findEntry(store, id)
      if (entry === null) return { error: 'nincs ilyen hang' }
      const ctx = await statusContext(cfg.sources[0]!.path, dirs)
      const status = handedOver.has(id) ? 'pending' : transcriptStatus(entry, ctx)
      const lang = resolveLang({ flag: input.lang, info: entry.info, languages: cfg.languages, askLang: input.askLang })
      const result = await submitEntry(entry, { store, dirs, status, lang, after: input.after })
      if ('needsLang' in result) {
        if (input.askLang !== true) return { error: NO_LANG_ERROR }
        langPending.push(id)
        return 'needs-lang'
      }
      if ('error' in result) return { error: result.error }
      if ('skip' in result) return 'skipped'
      handedOver.add(id)
      return 'submitted'
    },
    warning: async () => (dirs === null || handedOver.size === 0 ? null : watcherWarning(dirs)),
  }
}
