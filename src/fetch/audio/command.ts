import { mkdir, readFile } from 'node:fs/promises'
import { loadCliConfig, type Config } from '../../config.js'
import { installSigint } from '../../run/finish.js'
import type { RunLog } from '../../run/log.js'
import { listEntries, type FetchRuntime } from '../command.js'
import { createYtdlpRunner } from '../subtitle/ytdlp.js'
import { parseAudioArgs } from './args.js'
import { pickHint } from './feed.js'
import { audioSummary, openAudioRunLog, runAudioFetch } from './run.js'
import { createAudioStore, localAudioStore, type AudioStore } from './store.js'

export type AudioRuntime = FetchRuntime & { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv }

export async function commandFetchAudio(argv: readonly string[], runtime?: AudioRuntime): Promise<number> {
  const stdout = runtime?.stdout ?? ((line: string) => console.log(line))
  const stderr = runtime?.stderr ?? ((line: string) => console.error(line))

  const parsed = parseAudioArgs(argv)
  if (!parsed.ok) {
    stderr(parsed.error)
    return 1
  }
  const args = parsed.args

  let inputs = args.inputs
  if (args.listPath !== undefined) {
    try {
      inputs = listEntries(await readFile(args.listPath, 'utf8'))
    } catch (error) {
      stderr((error as NodeJS.ErrnoException).code === 'ENOENT' ? `Nincs listafájl: ${args.listPath}.` : (error as Error).message)
      return 1
    }
    if (inputs.length === 0) {
      stderr('A listafájl nem tartalmaz címet.')
      return 1
    }
  }

  let cfg: Config | null = null
  if (args.out === undefined || args.config !== undefined) {
    try {
      cfg = (await loadCliConfig(args.config)).cfg
    } catch (error) {
      stderr((error as Error).message)
      return 1
    }
  }

  let store: AudioStore
  try {
    if (args.out !== undefined) {
      await mkdir(args.out, { recursive: true })
      store = localAudioStore(args.out)
    } else if (cfg?.audio) {
      store = createAudioStore(cfg.audio, runtime?.env ?? process.env)
    } else {
      stderr('Nincs hangtároló: adj meg --out kapcsolót vagy audio blokkot a configban.')
      return 1
    }
  } catch (error) {
    stderr((error as Error).message)
    return 1
  }

  let stopped = false
  const uninstall = installSigint(() => {
    stopped = true
  }, runtime?.signals)
  const log: RunLog | null = cfg === null ? null : openAudioRunLog(cfg.logsDir, `fetch audio ${argv.join(' ')}`)

  try {
    const rows = await runAudioFetch(inputs, {
      store,
      runner: runtime?.runner ?? createYtdlpRunner(),
      fetchImpl: runtime?.fetchImpl,
      overwrite: args.overwrite,
      yesPlaylist: args.yesPlaylist,
      playlistItems: args.playlistItems,
      pick: args.pick,
      stopped: () => stopped,
      emit: (line) => stdout(line),
      sink: log?.sink,
    })
    const listed = rows.length === 1 && rows[0]?.outcome === 'listed' ? rows[0] : null
    if (listed !== null) stdout(pickHint(listed.label, 'cli'))
    else if (!stopped || rows.length > 0) stdout(audioSummary(rows))
    if (stopped) return 130
    return rows.some((row) => row.outcome === 'failed') ? 1 : 0
  } catch (error) {
    stderr((error as Error).message)
    return 1
  } finally {
    log?.sink({ type: 'run:ended', interrupted: stopped })
    log?.close()
    uninstall()
  }
}
