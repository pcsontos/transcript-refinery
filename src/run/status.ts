import { stat } from 'node:fs/promises'
import type { RunLogLine } from './logfile.js'

/** Ilyen időközönként frissíti az író a napló fájlidejét (`openRunLog`). */
export const HEARTBEAT_MS = 30_000
/** Ennél régebbi fájlidő: az író halott. A küszöb 3× az időköz. */
export const STALE_MS = 90_000

/** Egy futás állapota; a felület magyarul írja ki. */
export type RunStatus =
  | 'running'
  | 'died'
  | 'interrupted'
  | 'capped'
  | 'done'
  | 'failed'
  | 'closed'
  | 'unknown'

export interface RunStatusContext {
  /** Él-e a napló írója (`isWriterAlive`). */
  writerAlive: boolean
  /** Elkészült-e a futás riportja. */
  hasReport: boolean
}

/**
 * A futás állapota a naplósorokból.
 *
 * Új naplóban (`run:started` van) a lezárás dönt; a változás előtti naplóban a
 * `run:aborted`, a `run:done` és a riport megléte. A plafonos megállásnál a
 * kód a `run:aborted` után `run:done`-t is kibocsát, ezért a `run:aborted`
 * vizsgálata jön előbb.
 */
export function runStatus(lines: readonly RunLogLine[], ctx: RunStatusContext): RunStatus {
  const started = lines.find((line) => line.type === 'run:started')
  const ended = lines.find((line) => line.type === 'run:ended')
  const aborted = lines.some((line) => line.type === 'run:aborted')
  const done = lines.some((line) => line.type === 'run:done')

  if (started?.type === 'run:started') {
    if (ended?.type !== 'run:ended') return ctx.writerAlive ? 'running' : 'died'
    if (ended.interrupted) return 'interrupted'
    if (aborted) return 'capped'
    if (done) return 'done'
    return 'failed'
  }

  if (aborted) return 'capped'
  if (done) return 'done'
  return ctx.hasReport ? 'closed' : 'unknown'
}

/** Él-e a napló írója; a tesztek hamis függvényt adnak. */
export type WriterAlive = (logPath: string) => Promise<boolean>

/**
 * Él-e a napló írója: az író `HEARTBEAT_MS`-enként frissíti a fájlidőt
 * (`openRunLog`), így legfeljebb `STALE_MS`-es fájlidő élő írót jelent. A
 * jövőbeli fájlidő (órakülönbség) is élőnek számít; a hiányzó fájl halottnak.
 *
 * Ismert korlát: egy 90 mp-nél hosszabban blokkolt eseményhurok átmenetileg
 * „meghalt"-ot ad; a futás oldala ilyenkor csak újratöltés után követ újra.
 */
export async function isWriterAlive(logPath: string, now: number = Date.now()): Promise<boolean> {
  try {
    return now - (await stat(logPath)).mtimeMs <= STALE_MS
  } catch {
    return false
  }
}
