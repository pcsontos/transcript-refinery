import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioS3Config, Config } from '../config.js'
import { createS3Store, type S3Store } from '../serve/r2.js'

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

/**
 * A `<sourcesRoot>/whisper/**\/*.srt` fájlok közül a Garage-ban még hiányzókat feltölti
 * (`prefix + <csatorna-slug>/<id>.<nyelv>.srt`). Hiba nem dob: figyelmeztetés lesz belőle.
 */
export async function syncTranscripts(input: {
  sourcesRoot: string
  s3: AudioS3Config
  client: Pick<S3Store, 'list' | 'putFile'>
}): Promise<{ uploaded: string[]; warning?: string }> {
  const uploaded: string[] = []
  try {
    const root = join(input.sourcesRoot, 'whisper')
    const files = await srtFiles(root)
    if (files.length === 0) return { uploaded }
    // Csak az érintett csatorna-mappák prefixét listázzuk: a költség nem nő a teljes hang-archívummal.
    const present = new Set<string>()
    for (const dir of new Set(files.map((rel) => rel.slice(0, rel.lastIndexOf('/') + 1)))) {
      for (const key of await input.client.list(`${input.s3.prefix}${dir}`)) present.add(key)
    }
    for (const rel of files) {
      const key = `${input.s3.prefix}${rel}`
      if (present.has(key)) continue
      await input.client.putFile(key, join(root, rel))
      uploaded.push(key)
    }
    return { uploaded }
  } catch (error) {
    return { uploaded, warning: WARNING((error as Error).message) }
  }
}

/** A kiírandó sorok: `Garage-ba másolva: <kulcs>` soronként, vagy a figyelmeztetés. Hiányzó titok is figyelmeztetés. */
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
  const result = await syncTranscripts({ sourcesRoot, s3, client })
  return [...result.uploaded.map((key) => `Garage-ba másolva: ${key}`), ...(result.warning === undefined ? [] : [result.warning])]
}
