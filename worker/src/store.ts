export type JobStatus = 'queued' | 'waiting' | 'accepted' | 'ready' | 'failed'

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
}

export interface JobStore {
  listByUpdate(updateId: number): Promise<JobRow[]>
  activeByVideo(videoId: string): Promise<JobRow | null>
  insert(row: JobRow): Promise<void>
  save(row: JobRow): Promise<void>
  due(now: number): Promise<JobRow[]>
}

const OPEN: readonly JobStatus[] = ['queued', 'waiting', 'accepted']
const FIFTEEN_MINUTES = 15 * 60 * 1000

export function memoryStore(): JobStore {
  const rows: JobRow[] = []
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
  }
}
