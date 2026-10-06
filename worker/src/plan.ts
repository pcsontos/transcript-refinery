import { classifyInput } from 'transcript-refinery/classify'
import { NO_VIDEO_LINE, NOT_YOUTUBE_LINE, PLAYLIST_LINE, alreadyLine, queuedLine } from './messages.js'
import type { JobRow } from './store.js'

export {
  alreadyLine,
  queuedLine,
  readyLine,
  waitingLine,
  REJECTED_SECRET,
  MISSING_NOTE_URL,
  noteReadyMessage,
  summaryButton,
} from './messages.js'

export type TapAction = { type: 'start' } | { type: 'retry' } | { type: 'busy' } | { type: 'resend' } | { type: 'ignore' }

export function decideTap(row: JobRow | null, owner: boolean): TapAction {
  if (row === null || owner === false) return { type: 'ignore' }
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
