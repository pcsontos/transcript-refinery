import { join } from 'node:path'
import { parseAudioArgs, type Pick } from '../fetch/audio/args.js'
import { parseTranscribeArgs } from '../whisper/submit.js'
import { AFTER_WHISPER, MISSING_TRANSCRIPT } from '../whisper/after.js'
import { mediaId } from '../fetch/media-id.js'
import { YTDLP_MISSING, type ProcessResult } from '../fetch/subtitle/ytdlp.js'
import { LANGUAGE_NAMES, type LanguageTag } from '../lang/identify.js'
import { RECIPES } from '../recipe/registry.js'
import { isLanguageTag, normalizeText, textItemId } from '../source/text.js'
import { sanitizeSegment } from '../vault/sanitize.js'
import { infoKey, itemPrefix, languageMatches, subtitleKey, textInfoKey, textKey, type LocalPair } from './inventory.js'
import type { NoteOrigin } from '../vault/render.js'
import type { ObjectStore } from './r2.js'

export interface ServeJob {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
  /** Szöveges tétel (Telegram-csatolmány vagy `/scan`): a Worker normalizálta, a `videoId` a `t-…` azonosító. */
  text?: string
  title?: string
  /** A fájlnévből kapott nyelvkód; nem a fordítás `lang`-ja. */
  textLang?: string
  /** Receptazonosító → modell, a futás tényleges azonosítóival (`notes`, `notes-hu`); a Worker felülírása (#292). */
  models?: Record<string, string>
  /**
   * Hangletöltés (`/fetch_audio`): az `url` szóközzel elválasztott argumentumlista (linkek, `--lang <kód>`, vagy
   * `<feed-url> --pick <lista>`). Első szava `transcribe`: átírás-munka (`transcribe [<id>…] [--lang <kód>]`).
   */
  fetch?: boolean
  /** Újragenerálás (#104): a recept jegyzetét újraírja, az átiratot nem (`forceRecipe`). */
  force?: boolean
  /** Csak a serve belső jobja állítja (CLI-jelölős utólépés, #85); kívülről érkezve az `isJob` elutasítja. */
  origin?: 'cli'
  /** Link vagy lista feloldása (`url`): a serve visszahívja a `resolved` üzenetet, letöltés nincs. */
  resolve?: boolean
}

export type CallbackBody =
  /**
   * `deployError` csak átírás utáni futásnál (pcsontos/issue-tracker#45): hiányzik = a deploy kint van (showroom-link),
   * `null` = nem volt deploy (Worker-link), szöveg = a deploy hibája (Worker-link + hibasor).
   */
  | { status: 'ready'; title: string; noteUrl?: string; deployError?: string | null }
  /** `done`: a futás elkészült jegyzetei, ha a futás recept-leállás miatt bukott; a záró üzenet csak ezeket linkeli. */
  | { status: 'failed'; error: string; done?: string[] }
  /** Életjel: a futás még dolgozik; a Worker változatlan állapot mellett továbbítja. */
  | { status: 'progress'; text: string }
  /** Egy recept a futásidő-korlát miatt leállt; a Worker rákérdez az újrapróbálásra. */
  | { status: 'stalled'; text: string }
  /** Kész a jelölős átirat (#45): a leadó munkának szól, a Worker új tételt és receptfutást ír. */
  | { status: 'transcribed'; videoId: string; title: string; recipes: string[] }
  /** A feloldott link: egy videó (`playlist: false`) vagy a lista tételei, sorrendben, azonosító szerint egyedien. */
  | { status: 'resolved'; title: string; playlist: boolean; items: { videoId: string; url: string; title: string }[] }

/**
 * `followUp`: a jelentés (`ready`/`failed`) után futó munka, pl. a hosszan tartó showroom-deploy.
 * Nem dobhat: a hibáját maga naplózza, és szövegként visszaadja (az átírás utáni üzenet ebből tudja).
 */
export type RecipesOutcome = ({ ok: true; noteUrl: string } | { ok: false; error: string; done?: string[] }) & {
  followUp?: () => Promise<string | void>
}

/** A `refine` további, a jobból jövő beállításai. */
export interface RefineOptions {
  forceRecipe?: boolean
  origin?: NoteOrigin
}

export interface JobEffects {
  /** A hangletöltés; az összesítőt adja vissza (feed-listázásnál a választási felszólítást). */
  fetchAudio?: (
    request: { inputs: readonly string[]; pick?: Pick; lang?: string; jobId?: string },
    signal: AbortSignal | undefined,
    emit: (line: string) => Promise<void>,
  ) => Promise<string>
  /** Az átírás: üres `ids` = a váró hangok listája (`emit`-tel), különben leadás. Az összesítőt adja vissza. */
  transcribe?: (
    request: { ids: readonly string[]; lang?: string; jobId?: string },
    signal: AbortSignal | undefined,
    emit: (line: string) => Promise<void>,
  ) => Promise<string>
  store: ObjectStore
  languages: readonly string[]
  readPair: (videoId: string) => Promise<LocalPair>
  deletePair: (videoId: string) => Promise<void>
  readFile: (path: string) => Promise<Uint8Array>
  fetchSubtitle: (url: string) => Promise<{ code: number; stdout: string; stderr: string }>
  /** `yt-dlp -J --flat-playlist <url>` a feloldáshoz. */
  resolve?: (url: string) => Promise<ProcessResult>
  callback: (jobId: string, body: CallbackBody) => Promise<void>
  outDir?: string
  writeFile?: (path: string, body: Uint8Array) => Promise<void>
  /** Átírás utáni futás bemenete: a helyi whisper-pár (`readWhisperPair`). */
  whisperPair?: (videoId: string) => Promise<SummaryPair>
  refine?: (
    videoId: string,
    recipes: readonly string[],
    lang?: LanguageTag,
    signal?: AbortSignal,
    notify?: (body: CallbackBody) => void,
    models?: Readonly<Record<string, string>>,
    command?: string,
    options?: RefineOptions,
  ) => Promise<RecipesOutcome>
}

const UPLOAD_FAILED = 'A feltöltés nem sikerült.'
const NO_SUBTITLE = 'Nincs felirat'
const MISSING_PAIR = 'A felirat nincs az R2-ben.'
const UNREADABLE_PAIR = 'A felirat nem olvasható az R2-ből.'
const UNKNOWN_RECIPE = 'Ismeretlen recept.'
const UNKNOWN_LANGUAGE = 'Ismeretlen nyelv.'
const ID_MISMATCH = 'A szöveg azonosítója nem egyezik.'
const SUB_NAME = /^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(vtt|srt)$/i

export function subtitleArgv(url: string, outDir: string): string[] {
  return ['subtitle', url, '--out', outDir, '--flat']
}


function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim() !== '')
  return line?.trim() ?? ''
}

async function report(effects: JobEffects, jobId: string, body: CallbackBody): Promise<void> {
  try {
    await effects.callback(jobId, body)
  } catch (error) {
    console.error(error)
  }
}

async function remoteReady(
  store: ObjectStore,
  videoId: string,
  languages: readonly string[],
): Promise<{ complete: boolean; title: string }> {
  const keys = await store.list(`videos/${videoId}/`)
  const found: string[] = []
  let infoOk = false
  let infoLanguage: string | undefined
  let title = videoId
  for (const key of keys) {
    const name = key.slice(`videos/${videoId}/`.length)
    const sub = SUB_NAME.exec(name)
    if (sub?.[1] !== undefined) {
      const body = await store.get(key)
      if (body !== null && body.byteLength > 0) found.push(sub[1])
    }
    if (name !== 'info.json') continue
    const body = await store.get(key)
    if (body === null || body.byteLength === 0) continue
    try {
      const raw = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>
      if (mediaId(raw) !== videoId) continue
      infoOk = true
      infoLanguage = typeof raw.language === 'string' && raw.language.trim() !== '' ? raw.language : undefined
      const text = typeof raw.title === 'string' ? raw.title : ''
      title = text.trim() === '' ? videoId : text
    } catch {
      infoOk = false
    }
  }
  const accepted = infoLanguage ? [infoLanguage] : languages
  const subtitle = found.some((tag) => languageMatches(tag, accepted))
  return { complete: subtitle && infoOk, title }
}

async function putWithRetry(store: ObjectStore, key: string, body: Uint8Array): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await store.put(key, body)
      return
    } catch {
      // A következő kör ugyanazt a törzset küldi.
    }
  }
  throw new Error(UPLOAD_FAILED)
}

async function upload(job: ServeJob, effects: JobEffects, local: LocalPair): Promise<void> {
  console.log(`[job] Feltöltés Cloudflare R2-be (${local.files.length} feliratfájl)...`)
  for (const file of local.files) {
    const body = await effects.readFile(file.absolutePath)
    await putWithRetry(effects.store, subtitleKey(job.videoId, file.language, file.extension), body)
    console.log(`  [r2] Feltöltve: ${subtitleKey(job.videoId, file.language, file.extension)}`)
  }
  if (local.infoPath === null) return
  const info = await effects.readFile(local.infoPath)
  await putWithRetry(effects.store, infoKey(job.videoId), info)
  console.log(`  [r2] Feltöltve: ${infoKey(job.videoId)}`)
}

async function forgetWork(effects: JobEffects, videoId: string): Promise<void> {
  try {
    await effects.deletePair(videoId)
  } catch (error) {
    console.error(error)
  }
}

export type SummaryPair =
  | { ok: true; title: string; language: string | null; extension: string; subtitle: Uint8Array; info: Uint8Array }
  | { ok: false; error: string }

async function loadSummaryPair(effects: JobEffects, videoId: string): Promise<SummaryPair> {
  const prefix = itemPrefix(videoId)
  let keys: string[]
  try {
    keys = await effects.store.list(prefix)
  } catch {
    return { ok: false, error: UNREADABLE_PAIR }
  }
  const named = keys.map((key) => ({ key, name: key.slice(prefix.length) }))
  const infoItem = named.find((item) => item.name === 'info.json')
  const subs = named.filter((item) => SUB_NAME.test(item.name))
  const textItem = named.find((item) => item.key === textKey(videoId))
  if (infoItem === undefined || (subs.length === 0 && textItem === undefined)) return { ok: false, error: MISSING_PAIR }
  let infoBody: Uint8Array | null
  try {
    infoBody = await effects.store.get(infoItem.key)
  } catch {
    return { ok: false, error: UNREADABLE_PAIR }
  }
  if (infoBody === null || infoBody.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
  let title: string
  let accepted = effects.languages
  let infoLanguage: string | null = null
  try {
    const raw = JSON.parse(new TextDecoder().decode(infoBody)) as Record<string, unknown>
    if (mediaId(raw) !== videoId) return { ok: false, error: MISSING_PAIR }
    const text = typeof raw.title === 'string' ? raw.title : ''
    title = text.trim() === '' ? videoId : text
    if (typeof raw.language === 'string' && raw.language.trim() !== '') {
      accepted = [raw.language]
      infoLanguage = raw.language
    }
  } catch {
    return { ok: false, error: MISSING_PAIR }
  }
  if (textItem !== undefined) {
    let text: Uint8Array | null
    try {
      text = await effects.store.get(textItem.key)
    } catch {
      return { ok: false, error: UNREADABLE_PAIR }
    }
    if (text === null || text.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
    // A szöveges tétel nyelve a fájlnévből jön, ha volt; különben a futás a tartalomból dönt.
    // Az info.json az R2-ből jön, a nyelvkód a fájlnévbe kerül: csak érvényes kód mehet tovább.
    const language = infoLanguage !== null && isLanguageTag(infoLanguage) ? infoLanguage : null
    return { ok: true, title, language, extension: 'txt', subtitle: text, info: infoBody }
  }
  for (const sub of subs) {
    const match = SUB_NAME.exec(sub.name)
    if (match?.[1] === undefined || match[2] === undefined || !languageMatches(match[1], accepted)) continue
    let subtitle: Uint8Array | null
    try {
      subtitle = await effects.store.get(sub.key)
    } catch {
      return { ok: false, error: UNREADABLE_PAIR }
    }
    if (subtitle === null || subtitle.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
    return { ok: true, title, language: match[1], extension: match[2], subtitle, info: infoBody }
  }
  return { ok: false, error: MISSING_PAIR }
}

/** A feliratletöltés párja szöveges tételre: ellenőrzés, majd az R2-be, yt-dlp nélkül. */
async function runTextJob(job: ServeJob & { text: string }, effects: JobEffects): Promise<void> {
  const title = job.title ?? job.videoId
  try {
    const keys = await effects.store.list(itemPrefix(job.videoId))
    // ponytail: a kulcs a tartalom hash-e, ezért a megléte elég; üres objektumot a putWithRetry nem hagy.
    if (keys.includes(textKey(job.videoId)) && keys.includes(textInfoKey(job.videoId))) {
      await report(effects, job.jobId, { status: 'ready', title })
      return
    }
    // A Worker és a serve más verziója más azonosítót adhat: ilyenkor a jegyzet rossz tételhez kerülne.
    const text = normalizeText(new TextEncoder().encode(job.text), false)
    if ((await textItemId(text)) !== job.videoId) {
      await report(effects, job.jobId, { status: 'failed', error: ID_MISMATCH })
      return
    }
    const info = { id: job.videoId, title, ...(job.textLang === undefined ? {} : { language: job.textLang }) }
    await putWithRetry(effects.store, textKey(job.videoId), new TextEncoder().encode(text))
    await putWithRetry(effects.store, textInfoKey(job.videoId), new TextEncoder().encode(JSON.stringify(info)))
    console.log(`[job] Szöveges tétel az R2-ben: "${title}" (${job.videoId})`)
    await report(effects, job.jobId, { status: 'ready', title })
  } catch (error) {
    const message = error instanceof Error ? error.message : UPLOAD_FAILED
    await report(effects, job.jobId, { status: 'failed', error: message })
  }
}

async function localPair(effects: JobEffects, videoId: string): Promise<SummaryPair> {
  try {
    return (await effects.whisperPair?.(videoId)) ?? { ok: false, error: MISSING_TRANSCRIPT }
  } catch {
    return { ok: false, error: MISSING_TRANSCRIPT }
  }
}

/** Átírás utáni futás: a deploy az üzenet előtt fut. `undefined` = kint van, `null` = nem volt deploy, szöveg = a hibája. */
async function deployFirst(outcome: RecipesOutcome): Promise<string | null | undefined> {
  if (outcome.followUp === undefined) return null
  const error = await outcome.followUp()
  return typeof error === 'string' ? error : undefined
}

async function runRecipeJob(
  job: ServeJob & { recipes: string[] },
  effects: JobEffects,
  signal?: AbortSignal,
): Promise<void> {
  // Object.hasOwn: az `in` a `toString`-et is receptnek látná.
  if (!job.recipes.every((id) => Object.hasOwn(RECIPES, id))) {
    await report(effects, job.jobId, { status: 'failed', error: UNKNOWN_RECIPE })
    return
  }
  if (job.lang !== undefined && !Object.hasOwn(LANGUAGE_NAMES, job.lang)) {
    await report(effects, job.jobId, { status: 'failed', error: UNKNOWN_LANGUAGE })
    return
  }
  const lang = job.lang as LanguageTag | undefined
  // Átírás utáni futás (#45): a bemenet a helyi .srt (nem az R2), a deploy az üzenet előtt fut.
  const afterWhisper = job.url === AFTER_WHISPER
  const loaded = afterWhisper ? await localPair(effects, job.videoId) : await loadSummaryPair(effects, job.videoId)
  if (!loaded.ok) {
    await forgetWork(effects, job.videoId)
    await report(effects, job.jobId, { status: 'failed', error: loaded.error })
    return
  }
  if (effects.outDir === undefined || effects.writeFile === undefined || effects.refine === undefined) {
    await forgetWork(effects, job.videoId)
    await report(effects, job.jobId, { status: 'failed', error: UNREADABLE_PAIR })
    return
  }
  const stem = `${sanitizeSegment(loaded.title)} [${job.videoId}]`
  try {
    const name =
      loaded.language === null ? `${stem}.${loaded.extension}` : `${stem}.${loaded.language}.${loaded.extension}`
    await effects.writeFile(join(effects.outDir, name), loaded.subtitle)
    await effects.writeFile(join(effects.outDir, `${stem}.info.json`), loaded.info)
  } catch {
    await forgetWork(effects, job.videoId)
    await report(effects, job.jobId, { status: 'failed', error: UNREADABLE_PAIR })
    return
  }
  let outcome: RecipesOutcome
  try {
    outcome = await effects.refine(job.videoId, job.recipes, lang, signal, (body) => {
      void report(effects, job.jobId, body)
    }, job.models, afterWhisper ? `after-whisper ${job.videoId}` : undefined, job.origin === undefined && job.force !== true
      ? undefined
      : { ...(job.origin === undefined ? {} : { origin: job.origin }), ...(job.force === true ? { forceRecipe: true } : {}) })
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    await forgetWork(effects, job.videoId)
    await report(effects, job.jobId, { status: 'failed', error: message === '' ? UNREADABLE_PAIR : message })
    return
  }
  await forgetWork(effects, job.videoId)
  if (outcome.ok) {
    const deployError = afterWhisper ? await deployFirst(outcome) : undefined
    await report(effects, job.jobId, {
      status: 'ready',
      title: loaded.title,
      noteUrl: outcome.noteUrl,
      ...(deployError === undefined ? {} : { deployError }),
    })
  } else {
    await report(effects, job.jobId, {
      status: 'failed',
      error: outcome.error,
      ...(outcome.done === undefined ? {} : { done: outcome.done }),
    })
  }
  if (!(afterWhisper && outcome.ok)) await outcome.followUp?.()
}

/** A hangletöltés: a sorok progressként, az összesítő readyként megy a Workernek. */
async function runTranscribeJob(job: ServeJob, words: readonly string[], effects: JobEffects, signal?: AbortSignal): Promise<void> {
  // Üres maradék = lista-mód, nem hiba.
  const parsed = words.length === 0 ? ({ ok: true, args: { ids: [] } } as const) : parseTranscribeArgs(words)
  if (!parsed.ok) {
    await report(effects, job.jobId, { status: 'failed', error: parsed.error })
    return
  }
  if (effects.transcribe === undefined) {
    await report(effects, job.jobId, { status: 'failed', error: 'Az átírás nincs beállítva.' })
    return
  }
  const { ids, lang } = parsed.args as { ids: string[]; lang?: string }
  try {
    const title = await effects.transcribe(
      { ids, ...(lang === undefined ? {} : { lang }), jobId: job.jobId },
      signal,
      (text) => report(effects, job.jobId, { status: 'progress', text }),
    )
    await report(effects, job.jobId, { status: 'ready', title })
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    await report(effects, job.jobId, { status: 'failed', error: message === '' ? 'Az átírás nem sikerült.' : message })
  }
}

async function runFetchJob(job: ServeJob, effects: JobEffects, signal?: AbortSignal): Promise<void> {
  const words = job.url.split(' ').filter(Boolean)
  if (words[0] === 'transcribe') return runTranscribeJob(job, words.slice(1), effects, signal)
  const parsed = parseAudioArgs(words)
  if (!parsed.ok) {
    await report(effects, job.jobId, { status: 'failed', error: parsed.error })
    return
  }
  if (effects.fetchAudio === undefined) {
    await report(effects, job.jobId, { status: 'failed', error: 'A hangletöltés nincs beállítva.' })
    return
  }
  const { inputs, pick, lang } = parsed.args
  try {
    const title = await effects.fetchAudio(
      { inputs, ...(pick === undefined ? {} : { pick }), ...(lang === undefined ? {} : { lang }), jobId: job.jobId },
      signal,
      (text) => report(effects, job.jobId, { status: 'progress', text }),
    )
    await report(effects, job.jobId, { status: 'ready', title })
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    await report(effects, job.jobId, { status: 'failed', error: message === '' ? 'A hangletöltés nem sikerült.' : message })
  }
}

const UNRESOLVABLE = 'A link nem oldható fel.'
const EMPTY_LIST = 'a lista üres'

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** A feloldás: egy yt-dlp-hívás, letöltés nélkül; az eredmény a `resolved` visszahívás. */
async function runResolveJob(job: ServeJob, effects: JobEffects): Promise<void> {
  const fail = (error: string) => report(effects, job.jobId, { status: 'failed', error })
  if (effects.resolve === undefined) return fail(UNRESOLVABLE)
  let result: ProcessResult
  try {
    result = await effects.resolve(job.url)
  } catch (error) {
    return fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? YTDLP_MISSING : firstLine((error as Error).message) || UNRESOLVABLE)
  }
  if (result.code !== 0) return fail(firstLine(result.stderr) || UNRESOLVABLE)
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(result.stdout) as Record<string, unknown>
  } catch {
    return fail(UNRESOLVABLE)
  }
  const title = textOf(raw.title) ?? job.url
  if (raw._type !== 'playlist') {
    const videoId = mediaId(raw)
    if (videoId === null) return fail(UNRESOLVABLE)
    await report(effects, job.jobId, {
      status: 'resolved',
      title,
      playlist: false,
      items: [{ videoId, url: textOf(raw.webpage_url) ?? job.url, title }],
    })
    return
  }
  const seen = new Set<string>()
  const items: { videoId: string; url: string; title: string }[] = []
  // A csatornacím tételei a fülek (Videók, Élő …) beágyazott listaként: egy szinttel kibontjuk őket (mérve, 2026-11-18).
  const entries = (Array.isArray(raw.entries) ? (raw.entries as Record<string, unknown>[]) : []).flatMap((entry) =>
    Array.isArray(entry.entries) ? (entry.entries as Record<string, unknown>[]) : [entry],
  )
  for (const entry of entries) {
    const videoId = mediaId(entry)
    const url = textOf(entry.url)
    if (videoId === null || url === undefined || seen.has(videoId)) continue
    seen.add(videoId)
    items.push({ videoId, url, title: textOf(entry.title) ?? videoId })
  }
  if (items.length === 0) return fail(EMPTY_LIST)
  await report(effects, job.jobId, { status: 'resolved', title, playlist: true, items })
}

/** A `signal` csak a receptjobot és a hangletöltést állítja meg; a felirat-job lefut, az eredményét a Worker elnyeli. */
export async function runJob(job: ServeJob, effects: JobEffects, signal?: AbortSignal): Promise<void> {
  if (job.resolve === true) {
    await runResolveJob(job, effects)
    return
  }
  if (job.fetch === true) {
    await runFetchJob(job, effects, signal)
    return
  }
  if (job.recipes !== undefined) {
    await runRecipeJob({ ...job, recipes: job.recipes }, effects, signal)
    return
  }
  if (job.text !== undefined) {
    await runTextJob({ ...job, text: job.text }, effects)
    return
  }
  try {
    const remote = await remoteReady(effects.store, job.videoId, effects.languages)
    if (remote.complete) {
      console.log(`[job] A videó (${job.videoId}) már készen van az R2-ben: "${remote.title}"`)
      await report(effects, job.jobId, { status: 'ready', title: remote.title })
      return
    }
    let local = await effects.readPair(job.videoId)
    if (local.complete) {
      console.log(`[job] Helyi pár kész (${job.videoId}), feltöltés indul`)
      await upload(job, effects, local)
      await effects.deletePair(job.videoId)
      await report(effects, job.jobId, { status: 'ready', title: local.title })
      return
    }
    await effects.deletePair(job.videoId)
    console.log(`[job] Felirat lekérése indul YouTube-ról: ${job.url}`)
    const result = await effects.fetchSubtitle(job.url)
    if (result.stderr.includes(YTDLP_MISSING)) {
      console.warn(`[job] yt-dlp hiányzik a rendszerből`)
      await report(effects, job.jobId, { status: 'failed', error: YTDLP_MISSING })
      return
    }
    if (result.stdout.includes(NO_SUBTITLE)) {
      console.warn(`[job] Nincs felirat a videóhoz: ${job.videoId}`)
      await report(effects, job.jobId, { status: 'failed', error: NO_SUBTITLE })
      return
    }
    if (result.code !== 0) {
      const error = firstLine(result.stdout) || firstLine(result.stderr)
      console.warn(`[job] Hiba a letöltés során (${job.videoId}): ${error}`)
      await report(effects, job.jobId, { status: 'failed', error })
      return
    }
    local = await effects.readPair(job.videoId)
    if (local.files.length === 0) {
      console.warn(`[job] A letöltés után nem található illeszkedő feliratfájl: ${job.videoId}`)
      await report(effects, job.jobId, { status: 'failed', error: NO_SUBTITLE })
      return
    }
    await upload(job, effects, local)
    await effects.deletePair(job.videoId)
    console.log(`[job] Sikeresen feldolgozva és feltöltve R2-be: "${local.title}" (${job.videoId})`)
    await report(effects, job.jobId, { status: 'ready', title: local.title })
  } catch (error) {
    const message = error instanceof Error ? error.message : UPLOAD_FAILED
    console.error(`[job] Feldolgozási kivétel (${job.videoId}):`, message)
    await report(effects, job.jobId, { status: 'failed', error: message === UPLOAD_FAILED ? UPLOAD_FAILED : message })
  }
}
