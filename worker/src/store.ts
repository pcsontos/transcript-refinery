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
}

const OPEN: readonly JobStatus[] = ['queued', 'waiting', 'accepted']
const FIFTEEN_MINUTES = 15 * 60 * 1000

export function memoryStore(): JobStore {
  const rows: JobRow[] = []
  const seen = new Set<number>()
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
    due: (now) =>
      Promise.resolve(
        rows.filter((row) => {
          if (row.status === 'queued' || row.status === 'waiting') return true
          if (row.status !== 'accepted' || row.acceptedAt === null) return false
          return row.acceptedAt < now - FIFTEEN_MINUTES
        }),
      ),
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
  }
}
