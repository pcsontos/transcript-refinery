export type JobStatus = 'queued' | 'waiting' | 'accepted' | 'ready' | 'failed' | 'cancelled'

export interface JobRow {
  jobId: string
  updateId: number
  chatId: string
  messageId: number
  videoId: string
  url: string
  status: JobStatus
  error: string | null
  title: string | null
  notifiedReady: boolean
  acceptedAt: number | null
  sub: string | null
}

export interface RunRow {
  runId: string
  jobId: string
  recipes: string[]
  lang: string | null
  status: JobStatus
  error: string | null
  noteUrl: string | null
  notified: boolean
  acceptedAt: number | null
}

export interface Binding {
  telegramUserId: string
  sub: string
  email: string
  boundAt: number
}

export interface LinkToken {
  tokenHash: string
  telegramUserId: string
  expiresAt: number
  pendingSub: string | null
  pendingEmail: string | null
  used: boolean
}

export interface JobStore {
  listByUpdate(updateId: number): Promise<JobRow[]>
  activeByVideo(videoId: string): Promise<JobRow | null>
  insert(row: JobRow): Promise<void>
  /** `false`, ha nem hatott: a `cancelled` sort semmi nem írja felül. */
  save(row: JobRow): Promise<boolean>
  /** Feltételes állapotváltás, mint a `claimRun`. */
  claimJob(jobId: string, expect: JobStatus, next: JobStatus): Promise<boolean>
  due(now: number): Promise<JobRow[]>
  rememberUpdate(updateId: number): Promise<boolean>
  bindingFor(telegramUserId: string): Promise<Binding | null>
  bind(binding: Binding, chatId: string): Promise<void>
  insertToken(token: LinkToken): Promise<void>
  token(tokenHash: string): Promise<LinkToken | null>
  saveToken(token: LinkToken): Promise<void>
  run(runId: string): Promise<RunRow | null>
  insertRun(run: RunRow): Promise<boolean>
  /** `false`, ha nem hatott: a `cancelled` futást semmi nem írja felül. */
  saveRun(run: RunRow): Promise<boolean>
  claimRun(runId: string, expect: JobStatus, next: JobStatus): Promise<boolean>
  runsFor(jobId: string): Promise<RunRow[]>
  dueRuns(now: number): Promise<RunRow[]>
}

export const OPEN: readonly JobStatus[] = ['queued', 'waiting', 'accepted']
const FIFTEEN_MINUTES = 15 * 60 * 1000

function isDue(item: { status: JobStatus; acceptedAt: number | null }, now: number): boolean {
  if (item.status === 'queued' || item.status === 'waiting') return true
  return item.status === 'accepted' && item.acceptedAt !== null && item.acceptedAt < now - FIFTEEN_MINUTES
}

export function memoryStore(): JobStore {
  const rows: JobRow[] = []
  const seen = new Set<number>()
  const bindings = new Map<string, Binding>()
  const tokens = new Map<string, LinkToken>()
  const runs: RunRow[] = []
  return {
    listByUpdate: (updateId) => Promise.resolve(rows.filter((row) => row.updateId === updateId)),
    activeByVideo: (videoId) =>
      Promise.resolve(rows.find((row) => row.videoId === videoId && OPEN.includes(row.status)) ?? null),
    insert: (row) => {
      rows.push(row)
      return Promise.resolve()
    },
    save: (row) => {
      const index = rows.findIndex((item) => item.jobId === row.jobId)
      // A cron 202-je és a megszakítás versenyének őre, mint a D1-ben.
      if (rows[index]?.status === 'cancelled') return Promise.resolve(false)
      if (index === -1) rows.push(row)
      else rows[index] = row
      return Promise.resolve(true)
    },
    claimJob: (jobId, expect, next) => {
      const index = rows.findIndex((item) => item.jobId === jobId)
      const row = rows[index]
      if (row === undefined || row.status !== expect) return Promise.resolve(false)
      // Új objektum, mint a D1-nél: aki a régit tartja, elavult másolatot lát.
      rows[index] = { ...row, status: next }
      return Promise.resolve(true)
    },
    due: (now) => Promise.resolve(rows.filter((row) => isDue(row, now))),
    rememberUpdate: (updateId) => {
      if (seen.has(updateId)) return Promise.resolve(false)
      seen.add(updateId)
      return Promise.resolve(true)
    },
    bindingFor: (telegramUserId) => {
      const binding = bindings.get(telegramUserId)
      return Promise.resolve(binding === undefined ? null : { ...binding })
    },
    bind: (binding, chatId) => {
      bindings.set(binding.telegramUserId, { ...binding })
      for (const row of rows) if (row.chatId === chatId) row.sub = binding.sub
      return Promise.resolve()
    },
    insertToken: (token) => {
      tokens.set(token.tokenHash, { ...token })
      return Promise.resolve()
    },
    token: (tokenHash) => {
      const token = tokens.get(tokenHash)
      return Promise.resolve(token === undefined ? null : { ...token })
    },
    saveToken: (token) => {
      const current = tokens.get(token.tokenHash)
      if (current !== undefined) {
        current.pendingSub = token.pendingSub
        current.pendingEmail = token.pendingEmail
        current.used = token.used
      }
      return Promise.resolve()
    },
    run: (runId) => Promise.resolve(runs.find((item) => item.runId === runId) ?? null),
    insertRun: (run) => {
      if (runs.some((item) => item.runId === run.runId)) return Promise.resolve(false)
      runs.push(run)
      return Promise.resolve(true)
    },
    saveRun: (run) => {
      const index = runs.findIndex((item) => item.runId === run.runId)
      if (runs[index]?.status === 'cancelled') return Promise.resolve(false)
      if (index === -1) runs.push(run)
      else runs[index] = run
      return Promise.resolve(true)
    },
    claimRun: (runId, expect, next) => {
      const index = runs.findIndex((item) => item.runId === runId)
      const run = runs[index]
      if (run === undefined || run.status !== expect) return Promise.resolve(false)
      runs[index] = { ...run, status: next, error: null, notified: false, acceptedAt: null }
      return Promise.resolve(true)
    },
    runsFor: (jobId) => Promise.resolve(runs.filter((item) => item.jobId === jobId)),
    dueRuns: (now) => Promise.resolve(runs.filter((item) => isDue(item, now))),
  }
}
