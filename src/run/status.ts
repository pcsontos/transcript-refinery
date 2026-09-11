import type { RunLogLine } from './logfile.js'

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
  /** Él-e a megadott folyamat. A tesztek hamis függvényt adnak. */
  isAlive: (pid: number) => boolean
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
    if (ended?.type !== 'run:ended') return ctx.isAlive(started.pid) ? 'running' : 'died'
    if (ended.interrupted) return 'interrupted'
    if (aborted) return 'capped'
    if (done) return 'done'
    return 'failed'
  }

  if (aborted) return 'capped'
  if (done) return 'done'
  return ctx.hasReport ? 'closed' : 'unknown'
}

/**
 * Él-e a folyamat. A `kill(pid, 0)` jelet nem küld, csak ellenőriz. `EPERM`: a
 * folyamat létezik, csak nem a miénk — tehát él.
 *
 * Ismert korlát: egy újrahasznosított pid ritkán hamis „fut"-ot adhat; a
 * felület ezért mindig kiírja az utolsó esemény óta eltelt időt.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
