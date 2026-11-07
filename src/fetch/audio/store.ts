import { copyFile, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioConfig, AudioS3Config } from '../../config.js'
import { createS3Store, type S3Store } from '../../serve/r2.js'

const AUDIO_NAME = / \[([A-Za-z0-9_-]+)\]\.([A-Za-z0-9]+)$/

/** A `[id]` az út utolsó szegmensében, kiterjesztés előtt; `.info.json`, `.part`, `.ytdl` nem illik rá. */
export function audioId(name: string): string | null {
  const last = name.split('/').pop() ?? name
  const match = AUDIO_NAME.exec(last)
  if (match === null || match[2] === 'json') return null
  return match[1] ?? null
}

export interface AudioStore {
  /** Ide tölt a letöltés; a staging-beli relatív út a kulcs. */
  readonly staging: string
  /** A tároló hangfájljainak relatív útjai; S3-nál a staging kész hangjai is. */
  existing(): Promise<{ keys: string[]; warning?: string }>
  /** Igaz, ha a commit feltölt (S3); a futásnapló ebből tudja, kell-e „feltöltés S3-ba” lépés. */
  readonly remote: boolean
  /** Helyben semmi; S3-nál sorban feltölt (prefix + relatív út), majd törli a helyi fájlokat. Hibára dob, és a fájlok maradnak. */
  commit(paths: readonly string[]): Promise<void>
  /** S3: a staging kész hangjai a mellettük lévő .info.json-nal ([hang] vagy [hang, info]); helyben []. */
  pending(): Promise<string[][]>
  /** A tároló egy fájlja (kicsi: `.info.json`); `null`, ha nincs. */
  read(path: string): Promise<Buffer | null>
  /** A tároló egy fájlja a `dest` útra (S3-nál streamelve); ha nincs, dob: `nincs ilyen hang`. */
  copyTo(path: string, dest: string): Promise<void>
}

async function walk(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const audioFiles = (files: readonly string[]): string[] => files.filter((file) => audioId(file) !== null)

export function localAudioStore(root: string): AudioStore {
  return {
    staging: root,
    remote: false,
    existing: async () => ({ keys: audioFiles(await walk(root)) }),
    commit: () => Promise.resolve(),
    pending: () => Promise.resolve([]),
    async read(path) {
      try {
        return await readFile(join(root, path))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async copyTo(path, dest) {
      try {
        await copyFile(join(root, path), dest)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('nincs ilyen hang', { cause: error })
        throw error
      }
    },
  }
}

export function s3AudioStore(input: {
  s3: AudioS3Config
  workDir: string
  client: Pick<S3Store, 'list' | 'putFile' | 'get' | 'getFile'>
}): AudioStore {
  const { s3, workDir, client } = input

  async function pending(): Promise<string[][]> {
    const files = await walk(workDir)
    const set = new Set(files)
    return audioFiles(files).map((file) => {
      const info = file.replace(/\.[A-Za-z0-9]+$/, '.info.json')
      return set.has(info) ? [file, info] : [file]
    })
  }

  return {
    staging: workDir,
    remote: true,
    async existing() {
      const staged = (await pending()).map(([file]) => file as string)
      try {
        const listed = await client.list(s3.prefix)
        const keys = listed.filter((key) => key.startsWith(s3.prefix)).map((key) => key.slice(s3.prefix.length))
        return { keys: [...audioFiles(keys), ...staged] }
      } catch (error) {
        return { keys: staged, warning: `Az S3 lista nem érhető el (${(error as Error).message}); csak a munkamappát nézem.` }
      }
    },
    async commit(paths) {
      for (const path of paths) await client.putFile(`${s3.prefix}${path}`, join(workDir, path))
      for (const path of paths) await rm(join(workDir, path), { force: true })
    },
    pending,
    async read(path) {
      const body = await client.get(`${s3.prefix}${path}`)
      return body === null ? null : Buffer.from(body)
    },
    async copyTo(path, dest) {
      if (!(await client.getFile(`${s3.prefix}${path}`, dest))) throw new Error('nincs ilyen hang')
    },
  }
}

export function createAudioStore(audio: AudioConfig, env: NodeJS.ProcessEnv): AudioStore {
  if (audio.s3 !== null) {
    const secret = env.AUDIO_S3_SECRET_ACCESS_KEY
    if (secret === undefined || secret === '') throw new Error('Hiányzó AUDIO_S3_SECRET_ACCESS_KEY.')
    const client = createS3Store({
      endpoint: audio.s3.endpoint,
      region: audio.s3.region,
      bucket: audio.s3.bucket,
      pathStyle: audio.s3.pathStyle,
      accessKeyId: audio.s3.accessKeyId,
      secretAccessKey: secret,
    })
    return s3AudioStore({ s3: audio.s3, workDir: audio.workDir, client })
  }
  if (audio.dir === null) throw new Error('Az audio blokkban a dir és az s3 közül legalább egy kell.')
  return localAudioStore(audio.dir)
}
