import type { Config } from '../config.js'
import { recipesFor } from '../recipe/registry.js'
import { installSigint } from '../run/finish.js'
import { watchRound } from './round.js'
import { createScheduler } from './scheduler.js'
import { watchSubtitles } from './watcher.js'

export interface WatchRuntime {
  out?: (line: string) => void
  now?: () => Date
  quietMs?: number
  stabilityMs?: number
  signals?: {
    on(event: string, listener: () => void): unknown
    off?(event: string, listener: () => void): unknown
  }
  /** Teszthez: feloldódásakor a watch leáll, mint SIGINT-re. */
  stop?: Promise<void>
}

const firstLine = (text: string): string => text.split('\n')[0] ?? text

/**
 * `refinery watch`: előtérben figyeli a forrásmappákat, és az új feliratból
 * átiratot és queue-sort készít — modellt nem hív, tehát nem költ. Indításkor
 * egy felzárkózó kör pótolja, ami a leállás alatt érkezett. Minden eseményről
 * egy időbélyeges sor megy ki; a kör hibája nem állítja le. Ctrl+C-re a futó
 * kör befejeződik, és 0-val lép ki.
 */
export async function commandWatch(
  cfg: Config,
  flags: { source?: string; commit: boolean },
  runtime: WatchRuntime = {},
): Promise<number> {
  const print = runtime.out ?? ((line: string) => console.log(line))
  const now = runtime.now ?? (() => new Date())
  const stamp = (line: string): void => print(`${now().toTimeString().slice(0, 8)}  ${line}`)

  const sources =
    flags.source === undefined ? cfg.sources : cfg.sources.filter((s) => s.name === flags.source)
  if (sources.length === 0) {
    console.error(
      `Ismeretlen forrás: ${flags.source ?? ''}. Ismert források: ${cfg.sources.map((s) => s.name).join(', ')}.`,
    )
    return 1
  }
  const registry = recipesFor(cfg)
  const reportError = (error: Error): void => stamp(`hiba: ${firstLine(error.message)}`)
  const round = async (changed: ReadonlySet<string> | null): Promise<void> => {
    await watchRound({ cfg, registry, sources, commit: flags.commit, changed, out: stamp })
  }

  // A leállítási kérést elsőként figyeljük: a felzárkózó kör alatti Ctrl+C is
  // megvárja a kört, és utána 0-val lép ki.
  let stopRequested = false
  let resolveStop = (): void => {}
  const stopped = new Promise<void>((resolve) => (resolveStop = resolve))
  let uninstall = (): void => {}
  const requestStop = (): void => {
    if (stopRequested) return
    stopRequested = true
    uninstall()
    resolveStop()
  }
  uninstall = installSigint(requestStop, runtime.signals)
  void runtime.stop?.then(requestStop)

  stamp(`figyelés: ${sources.map((s) => s.path).join(', ')} (${String(sources.length)} mappa)`)
  const scheduler = createScheduler({ quietMs: runtime.quietMs ?? 5000, run: round, onError: reportError })
  // A figyelés a felzárkózó kör ELŐTT indul, így a kör alatt érkező felirat sem
  // vész el: a `notify` a felzárkózó kör utáni körbe gyűjti.
  const watcher = await watchSubtitles(
    sources.map((s) => s.path),
    (path) => scheduler.notify(path),
    reportError,
    { stabilityMs: runtime.stabilityMs ?? 2000 },
  )
  try {
    if (!stopRequested) await scheduler.runNow(null)
    if (!stopRequested) {
      stamp('kész, várom az új feliratokat (Ctrl+C: leállítás)')
      await stopped
    }
  } finally {
    try {
      await watcher.close()
    } finally {
      await scheduler.drain()
    }
  }
  stamp('leállítva')
  return 0
}
