import { readFile } from 'node:fs/promises'
import { loadCliConfig } from '../config.js'
import { commandFetch } from '../fetch/command.js'
import { deleteLocalPair, readLocalPair } from './inventory.js'
import { runJob, subtitleArgv, type JobEffects, type ServeJob } from './job.js'
import { createR2Store, type R2Config } from './r2.js'
import { createServeServer, type ServeGate } from './http.js'

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
  let languages: readonly string[]
  try {
    const { cfg } = await loadCliConfig(undefined)
    languages = cfg.languages.length > 0 ? cfg.languages : ['hu', 'en']
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : 'A konfiguráció nem olvasható.')
    return 1
  }
  const r2: R2Config = {
    accountId: env.R2_ACCOUNT_ID ?? '',
    bucket: env.R2_BUCKET ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
  }
  const effects: JobEffects = {
    store: createR2Store(r2),
    languages,
    readPair: (videoId) => readLocalPair(outDir, videoId, languages),
    deletePair: (videoId) => deleteLocalPair(outDir, videoId),
    readFile: async (path) => new Uint8Array(await readFile(path)),
    fetchSubtitle: async (url) => {
      const stdout: string[] = []
      const stderr: string[] = []
      const code = await commandFetch(subtitleArgv(url, outDir), {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      })
      return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
    },
    callback: async (jobId, body) => {
      await fetch(`${callbackBase}/internal/jobs/${encodeURIComponent(jobId)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
  }
  const gate: ServeGate = { current: null }
  const server = createServeServer({
    secret,
    gate,
    onJob: (job: ServeJob) => runJob(job, effects),
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => resolve())
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
