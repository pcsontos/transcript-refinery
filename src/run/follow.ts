import { stat } from 'node:fs/promises'
import { liveRunState, type LiveRunState } from '../view/live.js'
import { readRunEvents, type RunLogLine } from './logfile.js'

export interface FollowOptions {
  /** A böngésző utolsó ismert offsetje (`Last-Event-ID`); a fájl méreténél nagyobbra 0. */
  fromOffset: number
  intervalMs: number
  isAlive: (pid: number) => boolean
  signal: AbortSignal
  /** A várakozás; a tesztek a napló bővítésére használják. */
  sleep?: (ms: number) => Promise<void>
}

export interface FollowedLine {
  line: RunLogLine
  /** A sor utáni bájt-offset: ez az SSE-üzenet azonosítója. */
  end: number
  /** A futás állapota e sor után, a napló elejétől számolva. */
  state: LiveRunState
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function startedPid(lines: readonly RunLogLine[]): number | null {
  for (const line of lines) {
    if (line.type === 'run:started') return line.pid
  }
  return null
}

const hasEnded = (lines: readonly RunLogLine[]): boolean =>
  lines.some((line) => line.type === 'run:ended')

/**
 * Egy futásnapló követése.
 *
 * Előbb a teljes eddigi tartalmat olvassa — az állapot a napló elejétől
 * számít —, de csak a `fromOffset` utáni sorokat adja ki. Utána
 * `intervalMs`-enként megnézi, nőtt-e a fájl. Fájlfigyelő nincs: egyetlen fájl
 * méretének ellenőrzése egyszerű és kiszámítható.
 *
 * Véget ér: ha a naplóban nincs `run:started` (változás előtti napló) vagy már
 * lezárt; ha követés közben megjön a `run:ended` — egy utolsó olvasás után, mert
 * a megszakítás ágán a fő ág még írhat —; ha a folyamat már nem él, egy utolsó
 * olvasás után; vagy ha a `signal` megszakad.
 */
export async function* followRunLog(
  path: string,
  opts: FollowOptions,
): AsyncGenerator<FollowedLine> {
  const sleep = opts.sleep ?? wait
  const { size } = await stat(path)
  const from = opts.fromOffset <= size ? opts.fromOffset : 0
  const lines: RunLogLine[] = []

  const first = await readRunEvents(path, 0)
  let offset = first.nextOffset
  for (const { line, end } of first.lines) {
    lines.push(line)
    if (end > from) yield { line, end, state: liveRunState(lines) }
  }

  const pid = startedPid(lines)
  if (pid === null || hasEnded(lines)) return

  while (!opts.signal.aborted) {
    // Az élést a várakozás ELŐTT nézzük: egy leállt folyamat után még egy
    // olvasás jár, hogy az utolsó sorai se vesszenek el.
    const alive = opts.isAlive(pid)
    await sleep(opts.intervalMs)
    if (opts.signal.aborted) return

    const chunk = await readRunEvents(path, offset)
    offset = chunk.nextOffset
    for (const { line, end } of chunk.lines) {
      lines.push(line)
      yield { line, end, state: liveRunState(lines) }
    }

    if (hasEnded(lines)) {
      await sleep(opts.intervalMs)
      if (opts.signal.aborted) return
      const tail = await readRunEvents(path, offset)
      for (const { line, end } of tail.lines) {
        lines.push(line)
        yield { line, end, state: liveRunState(lines) }
      }
      return
    }
    if (!alive) return
  }
}
