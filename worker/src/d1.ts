import type { Binding, JobRow, JobStatus, JobStore, LinkToken } from './store.js'

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
  sub: string | null
}

interface BindingRecord {
  telegram_user_id: string
  sub: string
  email: string
  bound_at: number
}

interface TokenRecord {
  token_hash: string
  telegram_user_id: string
  expires_at: number
  pending_sub: string | null
  pending_email: string | null
  used: number
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
    sub: record.sub,
  }
}

function toBinding(record: BindingRecord): Binding {
  return {
    telegramUserId: record.telegram_user_id,
    sub: record.sub,
    email: record.email,
    boundAt: record.bound_at,
  }
}

function toToken(record: TokenRecord): LinkToken {
  return {
    tokenHash: record.token_hash,
    telegramUserId: record.telegram_user_id,
    expiresAt: record.expires_at,
    pendingSub: record.pending_sub,
    pendingEmail: record.pending_email,
    used: record.used === 1,
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
            note_url, notified_ready, note_notified, accepted_at, sub
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          row.sub,
        )
        .run()
    },
    async save(row) {
      await db
        .prepare(
          `UPDATE jobs SET
            update_id = ?, chat_id = ?, message_id = ?, video_id = ?, url = ?, status = ?, phase = ?,
            error = ?, title = ?, note_url = ?, notified_ready = ?, note_notified = ?, accepted_at = ?, sub = ?
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
          row.sub,
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
    async bindingFor(telegramUserId) {
      const record = await db
        .prepare('SELECT * FROM bindings WHERE telegram_user_id = ?')
        .bind(telegramUserId)
        .first<BindingRecord>()
      return record === null ? null : toBinding(record)
    },
    async bind(binding, chatId) {
      await db
        .prepare(
          `INSERT INTO bindings (telegram_user_id, sub, email, bound_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(telegram_user_id) DO UPDATE SET sub = excluded.sub, email = excluded.email, bound_at = excluded.bound_at`,
        )
        .bind(binding.telegramUserId, binding.sub, binding.email, binding.boundAt)
        .run()
      await db.prepare('UPDATE jobs SET sub = ? WHERE chat_id = ?').bind(binding.sub, chatId).run()
    },
    async insertToken(token) {
      await db
        .prepare(
          `INSERT INTO link_tokens (token_hash, telegram_user_id, expires_at, pending_sub, pending_email, used)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(token.tokenHash, token.telegramUserId, token.expiresAt, token.pendingSub, token.pendingEmail, token.used ? 1 : 0)
        .run()
    },
    async token(tokenHash) {
      const record = await db
        .prepare('SELECT * FROM link_tokens WHERE token_hash = ?')
        .bind(tokenHash)
        .first<TokenRecord>()
      return record === null ? null : toToken(record)
    },
    async saveToken(token) {
      await db
        .prepare('UPDATE link_tokens SET pending_sub = ?, pending_email = ?, used = ? WHERE token_hash = ?')
        .bind(token.pendingSub, token.pendingEmail, token.used ? 1 : 0, token.tokenHash)
        .run()
    },
    async notesFor(sub) {
      const result = await db
        .prepare('SELECT * FROM jobs WHERE sub = ? AND note_url IS NOT NULL ORDER BY accepted_at DESC')
        .bind(sub)
        .all<JobRecord>()
      return result.results.map(toRow)
    },
  }
}
