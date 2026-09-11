import { readFile } from 'node:fs/promises'
import type { Config } from '../config.js'
import {
  findRun,
  listRuns,
  readRunEvents,
  type RunFiles,
  type RunLogLine,
} from '../run/logfile.js'
import { isPidAlive, runStatus, type RunStatus } from '../run/status.js'
import { liveRunState, type LiveRunState } from './live.js'

/** Egy futás a futáslistában. */
export interface RunSummaryView {
  runId: string
  status: RunStatus
  /** A `run:started` parancssora; a változás előtti naplóban `null`. */
  command: string | null
  /** Az első időbélyeges sor ideje; a változás előtti naplóban `null`. */
  startedAt: string | null
  lastEventAt: string | null
  durationMs: number | null
  units: number | null
  estimate: { items: number; usd: number; limitUsd: number } | null
  succeeded: number
  failed: number
  spentUsd: number
  hasReport: boolean
  /** Kihagyott, értelmezhetetlen naplósorok. */
  invalid: number
}

export function summarizeRun(
  files: RunFiles,
  lines: readonly RunLogLine[],
  status: RunStatus,
  invalid: number,
): RunSummaryView {
  const live = liveRunState(lines)
  const started = lines.find((line) => line.type === 'run:started')
  const startedAt = lines.find((line) => line.at !== undefined)?.at ?? null
  return {
    runId: files.runId,
    status,
    command: started?.type === 'run:started' ? started.command : null,
    startedAt,
    lastEventAt: live.lastEventAt,
    durationMs:
      startedAt !== null && live.lastEventAt !== null
        ? Date.parse(live.lastEventAt) - Date.parse(startedAt)
        : null,
    units: live.units,
    estimate: live.estimate,
    succeeded: live.succeeded,
    failed: live.failed,
    spentUsd: live.spentUsd,
    hasReport: files.reportPath !== null,
    invalid,
  }
}

/** Egy futás beolvasása: a sorai és az összegzése. */
export async function loadRun(
  files: RunFiles,
  isAlive: (pid: number) => boolean,
): Promise<{ summary: RunSummaryView; lines: RunLogLine[] }> {
  const chunk = await readRunEvents(files.logPath)
  const lines = chunk.lines.map((entry) => entry.line)
  const status = runStatus(lines, { isAlive, hasReport: files.reportPath !== null })
  return { summary: summarizeRun(files, lines, status, chunk.invalid), lines }
}

/** A naplómappa futásai, legújabb elöl. */
export async function readRuns(
  cfg: Pick<Config, 'logsDir'>,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<RunSummaryView[]> {
  const runs = await listRuns(cfg.logsDir)
  return Promise.all(runs.map(async (files) => (await loadRun(files, isAlive)).summary))
}

/** Egy futás minden adata a futás oldalához. */
export interface RunDetail {
  summary: RunSummaryView
  lines: RunLogLine[]
  state: LiveRunState
  /** A riport Markdownja; `null`, ha nincs. */
  report: string | null
}

/** Egy futás beolvasása; nem `runId` alakú vagy nem létező futásra `null`. */
export async function readRun(
  cfg: Pick<Config, 'logsDir'>,
  runId: string,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<RunDetail | null> {
  const files = findRun(cfg.logsDir, runId)
  if (!files) return null
  const { summary, lines } = await loadRun(files, isAlive)
  const report = files.reportPath === null ? null : await readFile(files.reportPath, 'utf8')
  return { summary, lines, state: liveRunState(lines), report }
}
