import type { RunFiles, RunLogLine } from '../run/logfile.js'
import type { RunStatus } from '../run/status.js'
import { liveRunState } from './live.js'

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
