export interface Scheduler {
  /** Egy változott feliratfájl; a csend lejártakor a kör megkapja. */
  notify(path: string): void
  /**
   * Azonnal indít egy kört (a felzárkózó kör: `null`). Ha kör fut, előbb azt
   * megvárja; amíg ez fut, a `notify` a következő körbe gyűjt. A kör hibáját az
   * `onError` kapja, a visszaadott ígéret nem bukik el.
   */
  runNow(paths: ReadonlySet<string> | null): Promise<void>
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
  run: (paths: ReadonlySet<string> | null) => Promise<void>
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

  const start = (batch: ReadonlySet<string> | null): Promise<void> => {
    const current = opts
      .run(batch)
      .catch((error: unknown) => opts.onError(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        running = null
        if (pending.size > 0) arm()
      })
    running = current
    return current
  }

  const fire = (): void => {
    timer = undefined
    if (running !== null || pending.size === 0) return
    const batch = pending
    pending = new Set()
    void start(batch)
  }

  return {
    notify(path) {
      if (stopped) return
      pending.add(path)
      if (running === null) arm()
    },
    async runNow(paths) {
      while (running !== null) await running
      if (stopped) return
      await start(paths)
    },
    async drain() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      await running
    },
  }
}
