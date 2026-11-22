import { advanceText } from '../view/live.js'
import { failedReason, statusContext, transcriptStatus, type AudioEntry } from './archive.js'
import { watcherWarning, type WhisperDirs } from './paths.js'
import { cancelTranscript, readAdvance } from './queue.js'

export interface WaitDeps {
  dirs: WhisperDirs
  sourcesRoot: string
  signal: AbortSignal
  emit: (line: string) => void
  /** A helyben frissülő haladás-sor; TTY nélkül a hívó ritkítja. */
  progress: (line: string) => void
  sleep?: (ms: number) => Promise<void>
}

export const POLL_MS = 2000
/** Ctrl-C után legfeljebb ennyi kör (15 × POLL_MS = 30 mp) vár a figyelő takarítására. */
export const CANCEL_ROUNDS = 15

/** `ms` várakozás, abortra azonnal felold; a figyelőt mindkét esetben leveszi (órás várakozásnál se halmozódjon). */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * A leadott átírások megvárása: körönként a mappák állapotából követi őket. A lezárt tétel sora egyszer jön `emit`-en;
 * a kívülről megszakított (az inbox-tétel `.srt` nélkül eltűnt) nem hiba. A figyelő elvesztésekor nem vár tovább.
 */
export async function waitForTranscripts(
  entries: readonly AudioEntry[],
  deps: WaitDeps,
): Promise<{ failed: number; watcherLost: boolean; interrupted: boolean }> {
  const sleep = deps.sleep ?? ((ms: number) => abortableSleep(ms, deps.signal))
  const open = new Map(entries.map((entry) => [entry.id, entry]))
  const label = (entry: AudioEntry): string => `${entry.title} [${entry.id}]`
  let failed = 0

  /** Egy kör: a lezárt tételek sora `emit`-re, a legelső nyitott tétel haladás-sora `progress`-re. */
  async function round(): Promise<void> {
    const ctx = await statusContext(deps.sourcesRoot, deps.dirs)
    let line: string | null = null
    let running: string | null = null
    for (const entry of [...open.values()]) {
      const status = transcriptStatus(entry, ctx)
      if (status === 'done') {
        deps.emit(`kész: ${label(entry)}`)
        open.delete(entry.id)
      } else if (status === 'failed') {
        const reason = await failedReason(deps.dirs, entry.id)
        deps.emit(`hiba: ${label(entry)}${reason === null ? '' : `: ${reason}`}`)
        failed += 1
        open.delete(entry.id)
      } else if (status === 'archived') {
        deps.emit(`megszakítva: ${label(entry)}`)
        open.delete(entry.id)
      } else if (status === 'working') {
        const advance = await readAdvance(deps.dirs, entry.id)
        running ??= advance === null ? `átírás: ${entry.title}` : advanceText('átírás', advance)
      } else {
        line ??= `vár: ${entry.title}`
      }
    }
    const shown = running ?? line
    if (shown !== null) deps.progress(shown)
  }

  let watcherLost = false
  while (open.size > 0 && !deps.signal.aborted) {
    await round()
    const warning = await watcherWarning(deps.dirs)
    if (warning !== null) {
      deps.emit(warning)
      watcherLost = true
      break
    }
    if (open.size === 0 || deps.signal.aborted) break
    await sleep(POLL_MS)
  }

  const interrupted = deps.signal.aborted
  if (interrupted && open.size > 0) {
    for (const id of open.keys()) await cancelTranscript(deps.dirs, id)
    for (let i = 0; i < CANCEL_ROUNDS && open.size > 0; i += 1) {
      await sleep(POLL_MS)
      await round()
    }
    if (open.size > 0) deps.emit(`A figyelő nem takarította el: ${[...open.keys()].join(', ')}`)
  }
  return { failed, watcherLost, interrupted }
}
