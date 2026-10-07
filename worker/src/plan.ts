import { classifyInput } from 'transcript-refinery/classify'
import { NO_VIDEO_LINE, NOT_YOUTUBE_LINE, PLAYLIST_LINE, alreadyLine, queuedLine } from './messages.js'
import type { JobRow, LinkToken } from './store.js'

export {
  alreadyLine,
  queuedLine,
  readyLine,
  waitingLine,
  REJECTED_SECRET,
  MISSING_NOTE_URL,
  noteReadyMessage,
  summaryButton,
  BIND_FIRST,
  LINK_INVALID,
  LINK_INVALID_PAGE,
  linkLine,
  boundLine,
  alreadyBoundLine,
  notAllowedLine,
} from './messages.js'

export type TapAction = { type: 'start' } | { type: 'retry' } | { type: 'busy' } | { type: 'resend' } | { type: 'ignore' }

export function decideTap(row: JobRow | null, allowed: boolean): TapAction {
  if (row === null || allowed === false) return { type: 'ignore' }
  if (row.phase === 'subtitle' && row.status === 'ready') return { type: 'start' }
  if (row.phase === 'summary' && (row.status === 'queued' || row.status === 'waiting' || row.status === 'accepted')) {
    return { type: 'busy' }
  }
  if (row.phase === 'summary' && row.status === 'ready' && row.noteNotified) return { type: 'resend' }
  if (row.phase === 'summary' && row.status === 'failed') return { type: 'retry' }
  return { type: 'ignore' }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const OPEN = new Set(['queued', 'waiting', 'accepted'])

export function linesForMessage(
  text: string,
  active: readonly JobRow[],
): { lines: string[]; jobs: { videoId: string; url: string }[] } {
  const lines: string[] = []
  const jobs: { videoId: string; url: string }[] = []
  for (const token of text.split(/\s+/)) {
    if (token === '') continue
    if (!token.includes('://') && !VIDEO_ID.test(token)) continue
    const classified = classifyInput(token, false)
    if (classified.kind === 'video') {
      const open = active.some((row) => row.videoId === classified.id && OPEN.has(row.status))
      if (open) lines.push(alreadyLine(classified.id))
      else {
        lines.push(queuedLine(classified.id))
        jobs.push({ videoId: classified.id, url: classified.url })
      }
      continue
    }
    if (classified.kind === 'playlist') {
      lines.push(PLAYLIST_LINE)
      continue
    }
    if (token.includes('://')) lines.push(NOT_YOUTUBE_LINE)
  }
  if (lines.length === 0 && jobs.length === 0) return { lines: [NO_VIDEO_LINE], jobs }
  return { lines, jobs }
}

export const TOKEN_TTL = 10 * 60 * 1000
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export function isAllowed(email: string, allowedEmails: string): boolean {
  const wanted = email.trim().toLowerCase()
  if (wanted === '') return false
  return allowedEmails.split(',').some((item) => item.trim().toLowerCase() === wanted)
}

export function isToken(value: string): boolean {
  return TOKEN.test(value)
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type StartAction = { type: 'invalid' } | { type: 'denied'; email: string } | { type: 'bind'; sub: string; email: string }

export function decideStart(
  token: LinkToken | null,
  userId: string,
  now: number,
  allowedEmails: string,
): StartAction {
  if (token === null || token.used || token.expiresAt <= now || token.telegramUserId !== userId) return { type: 'invalid' }
  if (token.pendingSub === null || token.pendingEmail === null) return { type: 'invalid' }
  if (!isAllowed(token.pendingEmail, allowedEmails)) return { type: 'denied', email: token.pendingEmail }
  return { type: 'bind', sub: token.pendingSub, email: token.pendingEmail }
}
