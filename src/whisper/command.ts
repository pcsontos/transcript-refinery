import { loadCliConfig, type Config } from '../config.js'
import type { AudioRuntime } from '../fetch/audio/command.js'
import { audioDuration } from '../fetch/audio/feed.js'
import { openAudioRunLog } from '../fetch/audio/run.js'
import { createAudioStore, type AudioStore } from '../fetch/audio/store.js'
import { installSigint } from '../run/finish.js'
import { failedReason, listArchive, STATUS_LABEL, statusContext, transcriptStatus } from './archive.js'
import { watcherWarning, whisperDirs } from './paths.js'
import { parseTranscribeArgs, runTranscribe } from './submit.js'

const NO_AUDIO = 'Nincs audio blokk a configban.'

export async function commandTranscribe(argv: readonly string[], runtime?: AudioRuntime): Promise<number> {
  const stdout = runtime?.stdout ?? ((line: string) => console.log(line))
  const stderr = runtime?.stderr ?? ((line: string) => console.error(line))

  const parsed = parseTranscribeArgs(argv)
  if (!parsed.ok) {
    stderr(parsed.error)
    return 1
  }
  const { args } = parsed

  let cfg: Config
  try {
    cfg = (await loadCliConfig(args.config)).cfg
  } catch (error) {
    stderr((error as Error).message)
    return 1
  }
  if (cfg.audio === null) {
    stderr(NO_AUDIO)
    return 1
  }
  const dirs = await whisperDirs(cfg)
  if (dirs === null) {
    stderr(`nincs whisper-mappa: ${cfg.whisperDir}`)
    return 1
  }

  let store: AudioStore
  try {
    store = createAudioStore(cfg.audio, runtime?.env ?? process.env)
  } catch (error) {
    stderr((error as Error).message)
    return 1
  }

  let stopped = false
  const uninstall = installSigint(() => {
    stopped = true
  }, runtime?.signals)
  const log = openAudioRunLog(cfg.logsDir, `transcribe ${argv.join(' ')}`)
  try {
    const result = await runTranscribe(
      { ids: args.ids, lang: args.lang },
      {
        store,
        dirs,
        sourcesRoot: cfg.sources[0]!.path,
        languages: cfg.languages,
        emit: (line) => stdout(line),
        sink: log.sink,
        stopped: () => stopped,
      },
    )
    if (stopped) return 130
    return result.failed > 0 ? 1 : 0
  } catch (error) {
    stderr((error as Error).message)
    return 1
  } finally {
    log.sink({ type: 'run:ended', interrupted: stopped })
    log.close()
    uninstall()
  }
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => (row[i] ?? '').length)))
  const line = (cells: readonly string[]): string => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ').trimEnd()
  return [line(header), ...rows.map(line)]
}

const TITLE_WIDTH = 50

export async function commandListAudios(
  cfg: Config,
  opts: { channel?: string; limit?: number; status?: string },
  runtime?: AudioRuntime,
): Promise<number> {
  const stdout = runtime?.stdout ?? ((line: string) => console.log(line))
  const stderr = runtime?.stderr ?? ((line: string) => console.error(line))
  if (opts.status !== undefined && opts.status !== 'pending') {
    stderr('Az --audios mellett a --status értéke csak pending lehet.')
    return 1
  }
  if (cfg.audio === null) {
    stderr(NO_AUDIO)
    return 1
  }
  let listed
  try {
    listed = await listArchive(createAudioStore(cfg.audio, runtime?.env ?? process.env))
  } catch (error) {
    stderr((error as Error).message)
    return 1
  }
  const dirs = await whisperDirs(cfg)
  if (dirs === null) {
    stdout(`Nincs whisper-mappa (${cfg.whisperDir}): a vár/átírás alatt/hibás állapot nem látszik.`)
  } else {
    const warning = await watcherWarning(dirs)
    if (warning !== null) stdout(warning)
  }
  if (listed.warning !== undefined) stdout(listed.warning)

  const ctx = await statusContext(cfg.sources[0]!.path, dirs)
  const needle = opts.channel?.toLowerCase()
  let rows = listed.entries
    .filter((entry) => needle === undefined || entry.channel.toLowerCase().includes(needle))
    .map((entry) => ({ entry, status: transcriptStatus(entry, ctx) }))
    .filter(({ status }) => opts.status === undefined || status === 'archived' || status === 'failed')
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit)
  if (rows.length === 0) {
    stdout('Nincs a szűrőnek megfelelő hang.')
    return 0
  }

  const cells: string[][] = []
  for (const { entry, status } of rows) {
    let label = STATUS_LABEL[status]
    if (status === 'failed' && dirs !== null) {
      const reason = await failedReason(dirs, entry.id)
      if (reason !== null) label = `${label}: ${reason}`
    }
    const title = entry.title.length > TITLE_WIDTH ? `${entry.title.slice(0, TITLE_WIDTH - 1)}…` : entry.title
    cells.push([entry.id, title, entry.channel, audioDuration(entry.duration), entry.date ?? '—', label])
  }
  for (const line of table(['kulcs', 'cím', 'csatorna', 'hossz', 'dátum', 'állapot'], cells)) stdout(line)
  return 0
}
