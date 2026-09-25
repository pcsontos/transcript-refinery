export interface Scheduler {
  /** Egy változott feliratfájl; a csend lejártakor a kör megkapja. */
  notify(path: string): void
  /** Leállításkor: a futó kör befejeződik, a még nem indult eldobódik. */
  drain(): Promise<void>
}

/**
 * Kötegelés: az utolsó esemény után `quietMs` csend következik, és csak utána
 * indul egy kör az addig összegyűlt útvonalakkal. Egyszerre legfeljebb egy kör
 * fut; ami közben érkezik, a következő körbe kerül. A kör hibája nem állítja
 * le az ütemezőt.
 */
export function createScheduler(opts: {
  quietMs: number
  run: (paths: ReadonlySet<string>) => Promise<void>
  onError: (error: Error) => void
}): Scheduler {
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  let stopped = false

  const arm = (): void => {
    if (stopped) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(fire, opts.quietMs)
  }

  const fire = (): void => {
    timer = undefined
    if (running !== null || pending.size === 0) return
    const batch = pending
    pending = new Set()
    running = opts
      .run(batch)
      .catch((error: unknown) => opts.onError(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        running = null
        if (pending.size > 0) arm()
      })
  }

  return {
    notify(path) {
      if (stopped) return
      pending.add(path)
      if (running === null) arm()
    },
    async drain() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      await running
    },
  }
}
