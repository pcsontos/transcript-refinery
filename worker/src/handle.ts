import {
  MISSING_NOTE_URL,
  REJECTED_SECRET,
  alreadyLine,
  decideTap,
  linesForMessage,
  noteReadyMessage,
  queuedLine,
  readyLine,
  summaryButton,
  waitingLine,
} from './plan.js'
import type { JobRow, JobStore } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
  recipe?: 'summary'
}

export interface WorkerDeps {
  ownerChatId: string
  store: JobStore
  now: () => number
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  send: (text: string, button?: { text: string; data: string }) => Promise<boolean>
  answerTap: (callbackQueryId: string) => Promise<void>
}

type KnockResult = 202 | 409 | 401 | 'down'

async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
  const head = jobId.split(':')[0]
  if (head === undefined || !/^\d+$/.test(head)) return null
  const rows = await store.listByUpdate(Number(head))
  return rows.find((row) => row.jobId === jobId) ?? null
}

async function settle(row: JobRow, result: KnockResult, deps: WorkerDeps): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    row.status = 'accepted'
    row.acceptedAt = deps.now()
    await deps.store.save(row)
    return
  }
  if (result === 401) {
    const sent = await deps.send(REJECTED_SECRET)
    if (!sent) return
    row.status = 'failed'
    row.error = REJECTED_SECRET
    await deps.store.save(row)
    return
  }
  if (row.status === 'waiting') return
  const sent = await deps.send(waitingLine(row.videoId))
  if (!sent) return
  row.status = 'waiting'
  await deps.store.save(row)
}

export async function handleUpdate(
  update: { update_id: number; message?: { message_id: number; chat: { id: number }; text?: string } },
  deps: WorkerDeps,
): Promise<{ status: number; knocks: PlannedKnock[] }> {
  const message = update.message
  if (!message || String(message.chat.id) !== deps.ownerChatId) return { status: 200, knocks: [] }
  if ((await deps.store.listByUpdate(update.update_id)).length > 0) return { status: 200, knocks: [] }
  const planned = linesForMessage(message.text ?? '', [])
  const lines = [...planned.lines]
  const knocks: PlannedKnock[] = []
  for (const job of planned.jobs) {
    const active = await deps.store.activeByVideo(job.videoId)
    if (active) {
      const at = lines.indexOf(queuedLine(job.videoId))
      if (at !== -1) lines[at] = alreadyLine(job.videoId)
      continue
    }
    const row: JobRow = {
      jobId: `${update.update_id}:${job.videoId}`,
      updateId: update.update_id,
      chatId: String(message.chat.id),
      messageId: message.message_id,
      videoId: job.videoId,
      url: job.url,
      status: 'queued',
      phase: 'subtitle',
      error: null,
      title: null,
      noteUrl: null,
      notifiedReady: false,
      noteNotified: false,
      acceptedAt: null,
    }
    await deps.store.insert(row)
    knocks.push({ jobId: row.jobId, videoId: row.videoId, url: row.url })
  }
  if (lines.length > 0) await deps.send(lines.join('\n'))
  return { status: 200, knocks }
}

export async function applyKnocks(knocks: readonly PlannedKnock[], deps: WorkerDeps): Promise<void> {
  for (const knock of knocks) {
    const row = await findRow(deps.store, knock.jobId)
    if (!row) continue
    await settle(row, await deps.knock(knock), deps)
  }
}

export async function handleCallback(
  jobId: string,
  body: { status: 'ready'; title: string; noteUrl?: string } | { status: 'failed'; error: string },
  deps: WorkerDeps,
): Promise<number> {
  const row = await findRow(deps.store, jobId)
  if (!row) return 200
  if (body.status === 'failed') {
    const sent = await deps.send(body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.phase === 'summary') {
    if (row.noteNotified) return 200
    if (body.noteUrl === undefined || body.noteUrl === '') {
      const sent = await deps.send(MISSING_NOTE_URL)
      if (!sent) return 200
      row.status = 'failed'
      row.error = MISSING_NOTE_URL
      await deps.store.save(row)
      return 200
    }
    row.title = body.title
    row.noteUrl = body.noteUrl
    const sent = await deps.send(noteReadyMessage(body.title, body.noteUrl))
    if (!sent) {
      row.status = 'accepted'
      row.noteNotified = false
      await deps.store.save(row)
      return 200
    }
    row.status = 'ready'
    row.noteNotified = true
    await deps.store.save(row)
    return 200
  }
  if (row.notifiedReady) return 200
  row.title = body.title
  const sent = await deps.send(readyLine(body.title), summaryButton(row.jobId))
  if (!sent) {
    await deps.store.save(row)
    return 200
  }
  row.status = 'ready'
  row.notifiedReady = true
  await deps.store.save(row)
  return 200
}

export async function handleTap(
  update: { update_id: number; callback_query: { id: string; data?: string; message?: { chat: { id: number } } } },
  deps: WorkerDeps,
): Promise<PlannedKnock[]> {
  await deps.answerTap(update.callback_query.id)
  if (!(await deps.store.rememberUpdate(update.update_id))) return []
  const chatId = update.callback_query.message?.chat.id
  if (chatId === undefined || String(chatId) !== deps.ownerChatId) return []
  const data = update.callback_query.data ?? ''
  if (!data.startsWith('summary:')) return []
  const jobId = data.slice('summary:'.length)
  const row = await findRow(deps.store, jobId)
  const action = decideTap(row, true)
  if (action.type === 'busy') {
    if (row) await deps.send(alreadyLine(row.videoId))
    return []
  }
  if (action.type === 'resend') {
    if (row?.title && row.noteUrl) await deps.send(noteReadyMessage(row.title, row.noteUrl))
    return []
  }
  if (action.type === 'ignore') return []
  const claimed =
    action.type === 'start'
      ? await deps.store.claim(jobId, { phase: 'subtitle', status: 'ready' }, { phase: 'summary', status: 'queued' })
      : await deps.store.claim(jobId, { phase: 'summary', status: 'failed' }, { phase: 'summary', status: 'queued' })
  if (claimed === null) {
    if (row) await deps.send(alreadyLine(row.videoId))
    return []
  }
  return [{ jobId: claimed.jobId, videoId: claimed.videoId, url: claimed.url, recipe: 'summary' }]
}

export async function handleCron(deps: WorkerDeps): Promise<void> {
  for (const row of await deps.store.due(deps.now())) {
    const knock: PlannedKnock = { jobId: row.jobId, videoId: row.videoId, url: row.url }
    if (row.phase === 'summary') knock.recipe = 'summary'
    await settle(row, await deps.knock(knock), deps)
  }
}
