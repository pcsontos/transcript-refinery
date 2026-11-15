import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioS3Config, Config } from '../config.js'
import { audioId } from '../fetch/audio/store.js'
import { createS3Store, type S3Store } from '../serve/r2.js'
import { SRT_NAME } from './archive.js'

const WARNING = (reason: string): string => `A Garage-másolat nem sikerült (${reason}); a scan folytatódik.`

async function srtFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.srt'))
      .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export type SkipReason = 'nincs hang' | 'több hangmappa'
export interface SyncResult {
  uploaded: string[]
  skipped: { rel: string; reason: SkipReason }[]
  warning?: string
}

const dirOf = (rel: string): string => rel.slice(0, rel.lastIndexOf('/') + 1)
const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)

/**
 * A `<sourcesRoot>/whisper/**\/*.srt` fájlok közül a Garage-ban még hiányzókat feltölti a hangjuk mappájába
 * (`prefix + <a hang mappája> + <id>.<nyelv>.srt`; a mappa a hang kulcsából jön, pcsontos/issue-tracker#70).
 * Hang nélküli vagy több hangmappájú `.srt` kimarad. Hiba nem dob: figyelmeztetés lesz belőle.
 */
export async function syncTranscripts(input: {
  sourcesRoot: string
  s3: AudioS3Config
  client: Pick<S3Store, 'list' | 'putFile'>
}): Promise<SyncResult> {
  const uploaded: string[] = []
  const skipped: SyncResult['skipped'] = []
  try {
    const root = join(input.sourcesRoot, 'whisper')
    const files = await srtFiles(root)
    if (files.length === 0) return { uploaded, skipped }
    // ponytail: egy listázás a teljes prefixre minden scan végén; ha a bucket nagyon megnő, a hangok listája gyorsítótárazható.
    const keys = await input.client.list(input.s3.prefix)
    const present = new Set(keys)
    const audioDirs = new Map<string, Set<string>>()
    for (const key of keys) {
      const rel = key.slice(input.s3.prefix.length)
      const id = audioId(rel)
      if (id === null) continue
      const dirs = audioDirs.get(id) ?? new Set<string>()
      dirs.add(dirOf(rel))
      audioDirs.set(id, dirs)
    }
    for (const rel of files) {
      const name = baseOf(rel)
      const dirs = [...(audioDirs.get(SRT_NAME.exec(name)?.[1] ?? '') ?? [])]
      if (dirs.length !== 1) {
        skipped.push({ rel, reason: dirs.length === 0 ? 'nincs hang' : 'több hangmappa' })
        continue
      }
      const key = `${input.s3.prefix}${dirs[0]!}${name}`
      if (present.has(key)) continue
      await input.client.putFile(key, join(root, rel))
      uploaded.push(key)
    }
    return { uploaded, skipped }
  } catch (error) {
    return { uploaded, skipped, warning: WARNING((error as Error).message) }
  }
}

const SKIP_TEXT: Record<SkipReason, string> = { 'nincs hang': 'nincs hozzá hang', 'több hangmappa': 'több hangmappa' }

/** A kiírandó sorok: feltöltés, kimaradás, figyelmeztetés. */
export function transcriptLines(result: SyncResult): string[] {
  return [
    ...result.uploaded.map((key) => `Garage-ba másolva: ${key}`),
    ...result.skipped.map(({ rel, reason }) => `A Garage-másolat kimaradt (${SKIP_TEXT[reason]}): ${rel}`),
    ...(result.warning === undefined ? [] : [result.warning]),
  ]
}

/** A kiírandó sorok (`transcriptLines`). Hiányzó titok is figyelmeztetés. */
export async function syncTranscriptsFor(cfg: Config, env: NodeJS.ProcessEnv): Promise<string[]> {
  const s3 = cfg.audio?.s3
  const sourcesRoot = cfg.sources[0]?.path
  if (s3 === null || s3 === undefined || sourcesRoot === undefined) return []
  const hasDir = await stat(join(sourcesRoot, 'whisper')).then((s) => s.isDirectory(), () => false)
  if (!hasDir) return []
  const secret = env.AUDIO_S3_SECRET_ACCESS_KEY
  if (secret === undefined || secret === '') return [WARNING('hiányzó AUDIO_S3_SECRET_ACCESS_KEY')]
  const client = createS3Store({
    endpoint: s3.endpoint,
    region: s3.region,
    bucket: s3.bucket,
    pathStyle: s3.pathStyle,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: secret,
  })
  return transcriptLines(await syncTranscripts({ sourcesRoot, s3, client }))
}
