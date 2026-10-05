import { YTDLP_MISSING } from '../fetch/subtitle/ytdlp.js'
import { infoKey, subtitleKey, type LocalPair } from './inventory.js'
import type { ObjectStore } from './r2.js'

export interface ServeJob {
  jobId: string
  videoId: string
  url: string
}

export type CallbackBody = { status: 'ready'; title: string } | { status: 'failed'; error: string }

export interface JobEffects {
  store: ObjectStore
  languages: readonly string[]
  readPair: (videoId: string) => Promise<LocalPair>
  deletePair: (videoId: string) => Promise<void>
  readFile: (path: string) => Promise<Uint8Array>
  fetchSubtitle: (url: string) => Promise<{ code: number; stdout: string; stderr: string }>
  callback: (jobId: string, body: CallbackBody) => Promise<void>
}

const UPLOAD_FAILED = 'A feltöltés nem sikerült.'
const NO_SUBTITLE = 'Nincs felirat'
const SUB_NAME = /^([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(vtt|srt)$/i

export function subtitleArgv(url: string, outDir: string): string[] {
  return ['subtitle', url, '--out', outDir, '--flat']
}

function languageMatches(tag: string, languages: readonly string[]): boolean {
  const lower = tag.toLowerCase()
  return languages.some((wanted) => lower.startsWith(wanted.toLowerCase()))
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

export async function runJob(job: ServeJob, effects: JobEffects): Promise<void> {
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
