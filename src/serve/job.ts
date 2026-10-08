import { join } from 'node:path'
import { YTDLP_MISSING } from '../fetch/subtitle/ytdlp.js'
import { LANGUAGE_NAMES, type LanguageTag } from '../lang/identify.js'
import { RECIPES } from '../recipe/registry.js'
import { sanitizeSegment } from '../vault/sanitize.js'
import { infoKey, languageMatches, subtitleKey, type LocalPair } from './inventory.js'
import type { ObjectStore } from './r2.js'

export interface ServeJob {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
}

export type CallbackBody =
  | { status: 'ready'; title: string; noteUrl?: string }
  | { status: 'failed'; error: string }

export type RecipesOutcome ={ ok: true; noteUrl: string } | { ok: false; error: string }

export interface JobEffects {
  store: ObjectStore
  languages: readonly string[]
  readPair: (videoId: string) => Promise<LocalPair>
  deletePair: (videoId: string) => Promise<void>
  readFile: (path: string) => Promise<Uint8Array>
  fetchSubtitle: (url: string) => Promise<{ code: number; stdout: string; stderr: string }>
  callback: (jobId: string, body: CallbackBody) => Promise<void>
  outDir?: string
  writeFile?: (path: string, body: Uint8Array) => Promise<void>
  refine?: (videoId: string, recipes: readonly string[], lang?: LanguageTag) => Promise<RecipesOutcome>
}

const UPLOAD_FAILED = 'A feltöltés nem sikerült.'
const NO_SUBTITLE = 'Nincs felirat'
const MISSING_PAIR = 'A felirat nincs az R2-ben.'
const UNREADABLE_PAIR = 'A felirat nem olvasható az R2-ből.'
const UNKNOWN_RECIPE = 'Ismeretlen recept.'
const UNKNOWN_LANGUAGE = 'Ismeretlen nyelv.'
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
      const raw = JSON.parse(new TextDecoder().decode(body)) as {
        id?: unknown
        title?: unknown
        language?: unknown
      }
      if (raw.id !== videoId) continue
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

async function loadSummaryPair(
  effects: JobEffects,
  videoId: string,
): Promise<
  | { ok: true; title: string; language: string; extension: string; subtitle: Uint8Array; info: Uint8Array }
  | { ok: false; error: string }
> {
  const prefix = `videos/${videoId}/`
  let keys: string[]
  try {
    keys = await effects.store.list(prefix)
  } catch {
    return { ok: false, error: UNREADABLE_PAIR }
  }
  const named = keys.map((key) => ({ key, name: key.slice(prefix.length) }))
  const infoItem = named.find((item) => item.name === 'info.json')
  const subs = named.filter((item) => SUB_NAME.test(item.name))
  if (infoItem === undefined || subs.length === 0) return { ok: false, error: MISSING_PAIR }
  let infoBody: Uint8Array | null
  try {
    infoBody = await effects.store.get(infoItem.key)
  } catch {
    return { ok: false, error: UNREADABLE_PAIR }
  }
  if (infoBody === null || infoBody.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
  let title: string
  let accepted = effects.languages
  try {
    const raw = JSON.parse(new TextDecoder().decode(infoBody)) as { id?: unknown; title?: unknown; language?: unknown }
    if (raw.id !== videoId) return { ok: false, error: MISSING_PAIR }
    const text = typeof raw.title === 'string' ? raw.title : ''
    title = text.trim() === '' ? videoId : text
    if (typeof raw.language === 'string' && raw.language.trim() !== '') accepted = [raw.language]
  } catch {
    return { ok: false, error: MISSING_PAIR }
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

async function runRecipeJob(job: ServeJob & { recipes: string[] }, effects: JobEffects): Promise<void> {
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
  const loaded = await loadSummaryPair(effects, job.videoId)
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
    await effects.writeFile(join(effects.outDir, `${stem}.${loaded.language}.${loaded.extension}`), loaded.subtitle)
    await effects.writeFile(join(effects.outDir, `${stem}.info.json`), loaded.info)
  } catch {
    await forgetWork(effects, job.videoId)
    await report(effects, job.jobId, { status: 'failed', error: UNREADABLE_PAIR })
    return
  }
  let outcome: RecipesOutcome
  try {
    outcome = await effects.refine(job.videoId, job.recipes, lang)
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    await forgetWork(effects, job.videoId)
    await report(effects, job.jobId, { status: 'failed', error: message === '' ? UNREADABLE_PAIR : message })
    return
  }
  await forgetWork(effects, job.videoId)
  if (outcome.ok) {
    await report(effects, job.jobId, { status: 'ready', title: loaded.title, noteUrl: outcome.noteUrl })
    return
  }
  await report(effects, job.jobId, { status: 'failed', error: outcome.error })
}

export async function runJob(job: ServeJob, effects: JobEffects): Promise<void> {
  if (job.recipes !== undefined) {
    await runRecipeJob({ ...job, recipes: job.recipes }, effects)
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
