import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadCliConfig } from '../config.js'
import { commandFetch } from '../fetch/command.js'
import type { LanguageTag } from '../lang/identify.js'
import { VERSION } from '../meta.js'
import { deleteLocalPair, readLocalPair } from './inventory.js'
import { runJob, subtitleArgv, type JobEffects, type RecipesOutcome, type ServeJob } from './job.js'
import { createR2Store, type R2Config } from './r2.js'
import { createServeServer, type ServeGate } from './http.js'
import { runRecipes as defaultRunRecipes } from './summary.js'

type RecipesRun = (input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
}) => Promise<RecipesOutcome>

export function serveEffects(input: {
  outDir: string
  languages: readonly string[]
  store: JobEffects['store']
  fetchSubtitle: JobEffects['fetchSubtitle']
  callback: JobEffects['callback']
  readPair?: JobEffects['readPair']
  deletePair?: JobEffects['deletePair']
  readFile?: JobEffects['readFile']
  runRecipes?: RecipesRun
}): JobEffects & {
  writeFile: (path: string, body: Uint8Array) => Promise<void>
  refine: (videoId: string, recipes: readonly string[], lang?: LanguageTag) => Promise<RecipesOutcome>
} {
  const refineWith = input.runRecipes ?? defaultRunRecipes
  return {
    store: input.store,
    languages: input.languages,
    outDir: input.outDir,
    readPair: input.readPair ?? ((videoId) => readLocalPair(input.outDir, videoId, input.languages)),
    deletePair: input.deletePair ?? ((videoId) => deleteLocalPair(input.outDir, videoId)),
    readFile: input.readFile ?? (async (path) => new Uint8Array(await readFile(path))),
    fetchSubtitle: input.fetchSubtitle,
    callback: input.callback,
    writeFile: async (path, body) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    },
    refine: (videoId, recipes, lang) => refineWith({ videoId, outDir: input.outDir, recipes, lang }),
  }
}

const REQUIRED = [
  'REFINERY_SERVE_SECRET',
  'WORKER_CALLBACK_URL',
  'SERVE_OUT',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
] as const

function missing(env: NodeJS.ProcessEnv): string | null {
  for (const name of REQUIRED) {
    if (!env[name]) return name === 'SERVE_OUT' ? 'Hiányzó SERVE_OUT.' : `Hiányzó ${name}.`
  }
  return null
}

export async function commandServe(env: NodeJS.ProcessEnv): Promise<number> {
  const error = missing(env)
  if (error !== null) {
    console.error(error)
    return 1
  }
  const secret = env.REFINERY_SERVE_SECRET ?? ''
  const outDir = env.SERVE_OUT ?? ''
  const callbackBase = (env.WORKER_CALLBACK_URL ?? '').replace(/\/$/, '')
  const port = Number(env.SERVE_PORT && env.SERVE_PORT !== '' ? env.SERVE_PORT : '8787')
  const host = env.SERVE_HOST && env.SERVE_HOST !== '' ? env.SERVE_HOST : '127.0.0.1'
  if (!Number.isInteger(port) || port <= 0) {
    console.error('Hiányzó SERVE_PORT.')
    return 1
  }
  let languages: readonly string[] = ['hu', 'en']
  if (env.REFINERY_SUB_LANG && env.REFINERY_SUB_LANG.trim() !== '') {
    languages = env.REFINERY_SUB_LANG.split(',').map((s) => s.trim()).filter(Boolean)
  } else {
    try {
      const { cfg } = await loadCliConfig(undefined)
      if (cfg.languages && cfg.languages.length > 0) {
        languages = cfg.languages
      }
    } catch {
      // Dedikált serve konténerben vagy ha nincs refinery.config.yaml, az alapértelmezett ['hu', 'en'] érvényes.
    }
  }
  const r2: R2Config = {
    accountId: env.R2_ACCOUNT_ID ?? '',
    bucket: env.R2_BUCKET ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
  }
  const effects = serveEffects({
    outDir,
    languages,
    store: createR2Store(r2),
    fetchSubtitle: async (url) => {
      console.log(`[serve] Letöltés indítása yt-dlp-vel: ${url}`)
      const stdout: string[] = []
      const stderr: string[] = []
      const code = await commandFetch(subtitleArgv(url, outDir), {
        stdout: (line) => {
          console.log(`  [fetch] ${line}`)
          stdout.push(line)
        },
        stderr: (line) => {
          console.error(`  [fetch:err] ${line}`)
          stderr.push(line)
        },
      })
      console.log(`[serve] Letöltés kész, kilépési kód: ${code}`)
      return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
    },
    callback: async (jobId, body) => {
      console.log(`[serve] Visszahívás a Worker felé: ${jobId} -> ${JSON.stringify(body)}`)
      try {
        const response = await fetch(`${callbackBase}/internal/jobs/${encodeURIComponent(jobId)}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        console.log(`[serve] Visszahívás válaszkód: ${response.status}`)
      } catch (err) {
        console.error(`[serve] Visszahívás hiba:`, err instanceof Error ? err.message : err)
      }
    },
  })
  const gate: ServeGate = { current: null }
  const server = createServeServer({
    secret,
    gate,
    version: VERSION,
    onJob: async (job: ServeJob) => {
      console.log(`[serve] Munka végrehajtása indult: ${job.jobId} (${job.url})`)
      try {
        await runJob(job, effects)
        console.log(`[serve] Munka kész: ${job.jobId}`)
      } catch (err) {
        console.error(`[serve] Munka sikertelen: ${job.jobId}:`, err)
      }
    },
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        console.log(`[serve] Refinery daemon elindult: http://${host}:${port}`)
        resolve()
      })
    })
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : 'A serve port nem nyílt meg.')
    return 1
  }
  await new Promise<void>((resolve) => {
    server.on('close', () => resolve())
  })
  return 0
}
