export type JobStatus = 'queued' | 'waiting' | 'accepted' | 'ready' | 'failed'
export type JobPhase = 'subtitle' | 'summary'

export interface JobRow {
  jobId: string
  updateId: number
  chatId: string
  messageId: number
  videoId: string
  url: string
  status: JobStatus
  phase: JobPhase
  error: string | null
  title: string | null
  noteUrl: string | null
  notifiedReady: boolean
  noteNotified: boolean
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
  save(row: JobRow): Promise<void>
  due(now: number): Promise<JobRow[]>
  claim(
    jobId: string,
    expect: { phase: JobPhase; status: JobStatus },
    next: { phase: JobPhase; status: JobStatus },
  ): Promise<JobRow | null>
  rememberUpdate(updateId: number): Promise<boolean>
  bindingFor(telegramUserId: string): Promise<Binding | null>
  bind(binding: Binding, chatId: string): Promise<void>
  insertToken(token: LinkToken): Promise<void>
  token(tokenHash: string): Promise<LinkToken | null>
  saveToken(token: LinkToken): Promise<void>
  notesFor(sub: string): Promise<JobRow[]>
  run(runId: string): Promise<RunRow | null>
  insertRun(run: RunRow): Promise<boolean>
  saveRun(run: RunRow): Promise<void>
  claimRun(runId: string, expect: JobStatus, next: JobStatus): Promise<boolean>
  runsFor(jobId: string): Promise<RunRow[]>
  dueRuns(now: number): Promise<RunRow[]>
}

const OPEN: readonly JobStatus[] = ['queued', 'waiting', 'accepted']
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
      if (index === -1) rows.push(row)
      else rows[index] = row
      return Promise.resolve()
    },
    due: (now) => Promise.resolve(rows.filter((row) => isDue(row, now))),
    claim: (jobId, expect, next) => {
      const row = rows.find((item) => item.jobId === jobId)
      if (row === undefined || row.phase !== expect.phase || row.status !== expect.status) return Promise.resolve(null)
      row.phase = next.phase
      row.status = next.status
      row.error = null
      row.acceptedAt = null
      return Promise.resolve(row)
    },
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
    notesFor: (sub) =>
      Promise.resolve(
        rows
          .filter((row) => row.sub === sub && row.noteUrl !== null)
          .sort((a, b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0)),
      ),
    run: (runId) => Promise.resolve(runs.find((item) => item.runId === runId) ?? null),
    insertRun: (run) => {
      if (runs.some((item) => item.runId === run.runId)) return Promise.resolve(false)
      runs.push(run)
      return Promise.resolve(true)
    },
    saveRun: (run) => {
      const index = runs.findIndex((item) => item.runId === run.runId)
      if (index === -1) runs.push(run)
      else runs[index] = run
      return Promise.resolve()
    },
    claimRun: (runId, expect, next) => {
      const run = runs.find((item) => item.runId === runId)
      if (run === undefined || run.status !== expect) return Promise.resolve(false)
      run.status = next
      run.error = null
      run.acceptedAt = null
      return Promise.resolve(true)
    },
    runsFor: (jobId) => Promise.resolve(runs.filter((item) => item.jobId === jobId)),
    dueRuns: (now) => Promise.resolve(runs.filter((item) => isDue(item, now))),
  }
}
