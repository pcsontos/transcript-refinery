import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { loadCliConfig, loadModelConfig, type Config } from '../config.js'
import { pickHint } from '../fetch/audio/feed.js'
import { audioSummary, openAudioRunLog, runAudioFetch } from '../fetch/audio/run.js'
import { createAudioStore } from '../fetch/audio/store.js'
import { createHandoff, runTranscribe } from '../whisper/submit.js'
import { listArchive, statusContext, transcribeMessages, transcriptStatus } from '../whisper/archive.js'
import { watcherWarning, whisperDirs } from '../whisper/paths.js'
import { commandFetch } from '../fetch/command.js'
import { createYtdlpRunner, type ProcessRunner } from '../fetch/subtitle/ytdlp.js'
import type { LanguageTag } from '../lang/identify.js'
import { VERSION } from '../meta.js'
import { modelsView } from '../model/recipe-model.js'
import { recipesFor } from '../recipe/registry.js'
import { deleteLocalPair, readLocalPair } from './inventory.js'
import { runJob, subtitleArgv, type CallbackBody, type JobEffects, type RecipesOutcome, type ServeJob } from './job.js'
import { createR2Store, type R2Config } from './r2.js'
import { claimGate, createServeServer, type ServeGate } from './http.js'
import { createNotesSource } from './notes.js'
import { firstLine, runRecipes as defaultRunRecipes } from './summary.js'

type RecipesRun = (input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
  signal?: AbortSignal
  notify?: (body: CallbackBody) => void
  /** A Worker felülírása; a YAML `model.recipes` fölé kerül. */
  models?: Readonly<Record<string, string>>
  load?: () => Promise<{ cfg: Config; raw: unknown }>
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
  fetchAudio?: JobEffects['fetchAudio']
  transcribe?: JobEffects['transcribe']
  configArg?: string
}): JobEffects & {
  writeFile: (path: string, body: Uint8Array) => Promise<void>
  refine: (
    videoId: string,
    recipes: readonly string[],
    lang?: LanguageTag,
    signal?: AbortSignal,
    notify?: (body: CallbackBody) => void,
    models?: Readonly<Record<string, string>>,
  ) => Promise<RecipesOutcome>
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
    fetchAudio: input.fetchAudio,
    transcribe: input.transcribe,
    callback: input.callback,
    writeFile: async (path, body) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    },
    refine: (videoId, recipes, lang, signal, notify, models) =>
      refineWith({
        videoId,
        outDir: input.outDir,
        recipes,
        lang,
        signal,
        notify,
        models,
        load: () => loadCliConfig(input.configArg),
      }),
  }
}

/**
 * A Telegram `/fetch` hangletöltése: munkánként tölti a configot, így a `audio` blokk
 * szerkesztése újraindítás nélkül hat. A futás a `logs.dir` alá naplózódik.
 */
export function serveFetchAudio(
  configArg: string | undefined,
  deps: { runner?: ProcessRunner; fetchImpl?: typeof fetch } = {},
): NonNullable<JobEffects['fetchAudio']> {
  return async (request, signal, emit) => {
    const { cfg } = await loadCliConfig(configArg)
    if (cfg.audio === null) throw new Error('Nincs audio blokk a configban.')
    const store = createAudioStore(cfg.audio, process.env)
    const pick = request.pick === undefined ? [] : ['--pick', request.pick === 'all' ? '0' : request.pick.join(',')]
    const lang = request.lang === undefined ? [] : ['--lang', request.lang]
    const log = openAudioRunLog(cfg.logsDir, `/fetch_audio ${[...lang, ...request.inputs, ...pick].join(' ')}`)
    const { handoff, warning } = await createHandoff({ cfg, store, lang: request.lang })
    try {
      const rows = await runAudioFetch(request.inputs, {
        store,
        runner: deps.runner ?? createYtdlpRunner(),
        fetchImpl: deps.fetchImpl,
        overwrite: false,
        // A watch?v=…&list=… a spec szerint egy videó.
        yesPlaylist: false,
        pick: request.pick,
        handoff,
        listLimit: 4000,
        stopped: () => signal?.aborted ?? false,
        emit,
        sink: log.sink,
      })
      const notice = await warning()
      if (notice !== null) await emit(notice)
      return rows.length === 1 && rows[0]?.outcome === 'listed'
        ? pickHint(request.inputs[0] ?? rows[0].label, 'telegram')
        : audioSummary(rows)
    } finally {
      log.sink({ type: 'run:ended', interrupted: signal?.aborted ?? false })
      log.close()
    }
  }
}

/** A leadható (archivált vagy hibás) hangok listája üzenetekben; a vég a használati sor. */
export const TRANSCRIBE_HINT =
  'Válaszolj a lista egyik üzenetére a sorszámokkal: 0 = az üzenet összes tétele, vagy pl. 1,3. Nyelv: 1,3 --lang en.'

/**
 * A Telegram `/transcribe`: munkánként tölti a configot. Üres `ids`: a leadható hangok listája; különben leadás
 * (a `refinery transcribe` menete), a futás a `logs.dir` alá naplózódik.
 */
export function serveTranscribe(configArg: string | undefined): NonNullable<JobEffects['transcribe']> {
  return async (request, signal, emit) => {
    const { cfg } = await loadCliConfig(configArg)
    if (cfg.audio === null) throw new Error('Nincs audio blokk a configban.')
    const dirs = await whisperDirs(cfg)
    if (dirs === null) throw new Error(`nincs whisper-mappa: ${cfg.whisperDir}`)
    const store = createAudioStore(cfg.audio, process.env)
    const sourcesRoot = cfg.sources[0]!.path

    if (request.ids.length === 0) {
      const { entries } = await listArchive(store)
      const ctx = await statusContext(sourcesRoot, dirs)
      const pending = entries.filter((entry) => {
        const status = transcriptStatus(entry, ctx)
        return status === 'archived' || status === 'failed'
      })
      if (pending.length === 0) return 'Nincs átírásra váró hang.'
      for (const message of transcribeMessages(pending, 4000)) await emit(message)
      const warning = await watcherWarning(dirs)
      if (warning !== null) await emit(warning)
      return TRANSCRIBE_HINT
    }

    const lang = request.lang === undefined ? [] : ['--lang', request.lang]
    const log = openAudioRunLog(cfg.logsDir, `/transcribe ${[...request.ids, ...lang].join(' ')}`)
    const lines: string[] = []
    try {
      await runTranscribe(request, {
        store,
        dirs,
        sourcesRoot,
        languages: cfg.languages,
        emit: async (line) => {
          lines.push(line)
          await emit(line)
        },
        sink: log.sink,
        stopped: () => signal?.aborted ?? false,
      })
      // Az összesítő sor és ami utána jön (figyelmeztetés).
      const from = lines.findIndex((line) => / tétel leadva\.$/.test(line))
      return (from === -1 ? lines.slice(-1) : lines.slice(from)).join('\n')
    } finally {
      log.sink({ type: 'run:ended', interrupted: signal?.aborted ?? false })
      log.close()
    }
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

/**
 * A tétlen serve SIGTERM-re azonnal kilép. PID 1-ként a Node kezelő nélkül
 * nem állna le, és a Docker a türelmi idő után SIGKILL-t küldene. Futás
 * közben a `commandRun` saját kezelője zárja le a futást és lép ki.
 */
// ponytail: foglalt kapu futás nélkül (felirat-letöltés, notes) → SIGKILL a türelmi idő után; abort, ha zavar.
export function installIdleExit(
  gate: ServeGate,
  target: { on(event: string, listener: () => void): unknown } = process,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  target.on('SIGTERM', () => {
    if (gate.current === null) exit(143)
  })
}

export async function commandServe(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let configArg: string | undefined
  try {
    const { values } = parseArgs({ args: [...argv], options: { config: { type: 'string' } }, allowPositionals: false })
    configArg = values.config
  } catch (cause) {
    console.error(`${(cause as Error).message}\nSúgó: refinery help serve`)
    return 1
  }
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
  // A --config nélküli hiba csendes: dedikált serve konténerben nincs refinery.config.yaml.
  let configLanguages: readonly string[] = []
  try {
    configLanguages = (await loadCliConfig(configArg)).cfg.languages
  } catch (cause) {
    if (configArg !== undefined) {
      console.error(`Hibás konfiguráció: ${firstLine(cause instanceof Error ? cause.message : String(cause))}`)
      return 1
    }
  }
  const fromEnv = env.REFINERY_SUB_LANG?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  const languages: readonly string[] =
    fromEnv.length > 0 ? fromEnv : configLanguages.length > 0 ? configLanguages : ['hu', 'en']
  const r2: R2Config = {
    accountId: env.R2_ACCOUNT_ID ?? '',
    bucket: env.R2_BUCKET ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
  }
  const effects = serveEffects({
    outDir,
    configArg,
    languages,
    store: createR2Store(r2),
    fetchAudio: serveFetchAudio(configArg),
    transcribe: serveTranscribe(configArg),
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
  installIdleExit(gate)
  const server = createServeServer({
    secret,
    gate,
    version: VERSION,
    // A config kérésenként töltődik, mint a receptfuttatásnál; a kaput nem foglalja, mert csak olvas.
    models: async () => {
      const { cfg, raw } = await loadCliConfig(configArg)
      return modelsView(loadModelConfig(raw, process.env, cfg.configPath), recipesFor(cfg))
    },
    // A config kérésenként töltődik, mint a receptfuttatásnál: a vault-config szerkesztése újraindítás nélkül hat.
    notes: createNotesSource({ load: () => loadCliConfig(configArg), claim: () => claimGate(gate, 'notes') }),
    onJob: async (job: ServeJob, signal: AbortSignal) => {
      console.log(`[serve] Munka végrehajtása indult: ${job.jobId} (${job.url})`)
      try {
        await runJob(job, effects, signal)
        // A felirat-ág nem figyeli a signalt: az végigfut, akkor is, ha a kérés megérkezett.
        console.log(`[serve] Munka ${signal.aborted && (job.recipes !== undefined || job.fetch === true) ? 'megszakítva' : 'kész'}: ${job.jobId}`)
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
