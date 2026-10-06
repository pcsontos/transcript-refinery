import type { JobRow, JobStatus, JobStore } from './store.js'

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface D1Like {
  prepare(sql: string): D1Statement
}

interface JobRecord {
  job_id: string
  update_id: number
  chat_id: string
  message_id: number
  video_id: string
  url: string
  status: JobStatus
  phase: JobRow['phase']
  error: string | null
  title: string | null
  note_url: string | null
  notified_ready: number
  note_notified: number
  accepted_at: number | null
}

const FIFTEEN_MINUTES = 15 * 60 * 1000

function toRow(record: JobRecord): JobRow {
  return {
    jobId: record.job_id,
    updateId: record.update_id,
    chatId: record.chat_id,
    messageId: record.message_id,
    videoId: record.video_id,
    url: record.url,
    status: record.status,
    phase: record.phase,
    error: record.error,
    title: record.title,
    noteUrl: record.note_url,
    notifiedReady: record.notified_ready === 1,
    noteNotified: record.note_notified === 1,
    acceptedAt: record.accepted_at,
  }
}

export function createD1Store(db: D1Like): JobStore {
  return {
    async listByUpdate(updateId) {
      const result = await db.prepare('SELECT * FROM jobs WHERE update_id = ?').bind(updateId).all<JobRecord>()
      return result.results.map(toRow)
    },
    async activeByVideo(videoId) {
      const record = await db
        .prepare(
          "SELECT * FROM jobs WHERE video_id = ? AND status IN ('queued', 'waiting', 'accepted') LIMIT 1",
        )
        .bind(videoId)
        .first<JobRecord>()
      return record === null ? null : toRow(record)
    },
    async insert(row) {
      await db
        .prepare(
          `INSERT INTO jobs (
            job_id, update_id, chat_id, message_id, video_id, url, status, phase, error, title,
            note_url, notified_ready, note_notified, accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.jobId,
          row.updateId,
          row.chatId,
          row.messageId,
          row.videoId,
          row.url,
          row.status,
          row.phase,
          row.error,
          row.title,
          row.noteUrl,
          row.notifiedReady ? 1 : 0,
          row.noteNotified ? 1 : 0,
          row.acceptedAt,
        )
        .run()
    },
    async save(row) {
      await db
        .prepare(
          `UPDATE jobs SET
            update_id = ?, chat_id = ?, message_id = ?, video_id = ?, url = ?, status = ?, phase = ?,
            error = ?, title = ?, note_url = ?, notified_ready = ?, note_notified = ?, accepted_at = ?
          WHERE job_id = ?`,
        )
        .bind(
          row.updateId,
          row.chatId,
          row.messageId,
          row.videoId,
          row.url,
          row.status,
          row.phase,
          row.error,
          row.title,
          row.noteUrl,
          row.notifiedReady ? 1 : 0,
          row.noteNotified ? 1 : 0,
          row.acceptedAt,
          row.jobId,
        )
        .run()
    },
    async due(now) {
      const result = await db
        .prepare(
          `SELECT * FROM jobs
           WHERE status IN ('queued', 'waiting')
              OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_at < ?)`,
        )
        .bind(now - FIFTEEN_MINUTES)
        .all<JobRecord>()
      return result.results.map(toRow)
    },
    async claim(jobId, expect, next) {
      const result = await db
        .prepare(
          `UPDATE jobs SET phase = ?, status = ?, error = NULL, accepted_at = NULL
           WHERE job_id = ? AND phase = ? AND status = ?`,
        )
        .bind(next.phase, next.status, jobId, expect.phase, expect.status)
        .run()
      const changes = (result as { meta?: { changes?: number } }).meta?.changes
      if (changes !== 1) return null
      const record = await db.prepare('SELECT * FROM jobs WHERE job_id = ?').bind(jobId).first<JobRecord>()
      return record === null ? null : toRow(record)
    },
    async rememberUpdate(updateId) {
      try {
        const result = await db.prepare('INSERT INTO seen_updates (update_id) VALUES (?)').bind(updateId).run()
        const changes = (result as { meta?: { changes?: number } }).meta?.changes
        return changes === undefined || changes === 1
      } catch {
        return false
      }
    },
  }
}
