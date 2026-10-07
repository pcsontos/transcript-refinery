import {
  BIND_FIRST,
  LINK_INVALID,
  MISSING_NOTE_URL,
  REJECTED_SECRET,
  TOKEN_TTL,
  alreadyBoundLine,
  alreadyLine,
  boundLine,
  decideStart,
  decideTap,
  hashToken,
  isAllowed,
  isToken,
  linesForMessage,
  linkLine,
  notAllowedLine,
  noteReadyMessage,
  queuedLine,
  readyLine,
  summaryButton,
  waitingLine,
} from './plan.js'
import type { Binding, JobRow, JobStore } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
  recipe?: 'summary'
}

export interface WorkerDeps {
  allowedEmails: string
  botUsername: string
  linkBase: string
  store: JobStore
  now: () => number
  newToken: () => string
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  send: (chatId: string, text: string, button?: { text: string; data: string }) => Promise<boolean>
  answerTap: (callbackQueryId: string) => Promise<void>
}

type KnockResult = 202 | 409 | 401 | 'down'

const START = /^\/start(?:\s+(\S+))?\s*$/

export async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
  const head = jobId.split(':')[0]
  if (head === undefined || !/^\d+$/.test(head)) return null
  const rows = await store.listByUpdate(Number(head))
  return rows.find((row) => row.jobId === jobId) ?? null
}

function readerLink(jobId: string, deps: WorkerDeps): string {
  return `${deps.linkBase}/notes/${jobId}/summary`
}

async function allowedBinding(userId: string | undefined, deps: WorkerDeps): Promise<Binding | null> {
  if (userId === undefined) return null
  const binding = await deps.store.bindingFor(userId)
  if (binding === null || !isAllowed(binding.email, deps.allowedEmails)) return null
  return binding
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
    const sent = await deps.send(row.chatId, REJECTED_SECRET)
    if (!sent) return
    row.status = 'failed'
    row.error = REJECTED_SECRET
    await deps.store.save(row)
    return
  }
  if (row.status === 'waiting') return
  const sent = await deps.send(row.chatId, waitingLine(row.videoId))
  if (!sent) return
  row.status = 'waiting'
  await deps.store.save(row)
}

async function handleStart(
  updateId: number,
  userId: string,
  chatId: string,
  arg: string | undefined,
  deps: WorkerDeps,
): Promise<void> {
  if (!(await deps.store.rememberUpdate(updateId))) return
  if (arg === undefined) {
    const binding = await allowedBinding(userId, deps)
    if (binding !== null) {
      await deps.send(chatId, alreadyBoundLine(binding.email))
      return
    }
    const raw = deps.newToken()
    await deps.store.insertToken({
      tokenHash: await hashToken(raw),
      telegramUserId: userId,
      expiresAt: deps.now() + TOKEN_TTL,
      pendingSub: null,
      pendingEmail: null,
      used: false,
    })
    await deps.send(chatId, linkLine(`${deps.linkBase}/link?t=${raw}`))
    return
  }
  const token = isToken(arg) ? await deps.store.token(await hashToken(arg)) : null
  const action = decideStart(token, userId, deps.now(), deps.allowedEmails)
  // A visszatérő token az első felhasználásnál elhasználódik, akkor is, ha más küldi: kiszivárogva se kössön.
  if (token !== null && token.pendingSub !== null && !token.used) await deps.store.saveToken({ ...token, used: true })
  if (token === null || action.type === 'invalid') {
    await deps.send(chatId, LINK_INVALID)
    return
  }
  if (action.type === 'denied') {
    await deps.send(chatId, notAllowedLine(action.email))
    return
  }
  await deps.store.bind({ telegramUserId: userId, sub: action.sub, email: action.email, boundAt: deps.now() }, chatId)
  await deps.send(chatId, boundLine(action.email))
}

export async function handleLink(
  raw: string,
  who: { sub: string; email: string },
  deps: WorkerDeps,
): Promise<{ status: 302; location: string } | { status: 200 }> {
  const token = isToken(raw) ? await deps.store.token(await hashToken(raw)) : null
  if (token === null || token.used || token.pendingSub !== null || token.expiresAt <= deps.now()) return { status: 200 }
  await deps.store.saveToken({ ...token, used: true })
  const back = deps.newToken()
  await deps.store.insertToken({
    tokenHash: await hashToken(back),
    telegramUserId: token.telegramUserId,
    expiresAt: token.expiresAt,
    pendingSub: who.sub,
    pendingEmail: who.email,
    used: false,
  })
  return { status: 302, location: `https://t.me/${deps.botUsername}?start=${back}` }
}

export async function handleUpdate(
  update: {
    update_id: number
    message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string }
  },
  deps: WorkerDeps,
): Promise<{ status: number; knocks: PlannedKnock[] }> {
  const message = update.message
  if (!message?.from) return { status: 200, knocks: [] }
  // A bot csak privát chatre készült: csoportban a kötés a többi tag sorait is átírná.
  if (message.chat.id !== message.from.id) return { status: 200, knocks: [] }
  const userId = String(message.from.id)
  const chatId = String(message.chat.id)
  const start = START.exec(message.text ?? '')
  if (start) {
    await handleStart(update.update_id, userId, chatId, start[1], deps)
    return { status: 200, knocks: [] }
  }
  const binding = await allowedBinding(userId, deps)
  if (binding === null) {
    await deps.send(chatId, BIND_FIRST)
    return { status: 200, knocks: [] }
  }
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
      chatId,
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
      sub: binding.sub,
    }
    await deps.store.insert(row)
    knocks.push({ jobId: row.jobId, videoId: row.videoId, url: row.url })
  }
  if (lines.length > 0) await deps.send(chatId, lines.join('\n'))
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
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.phase === 'summary') {
    if (row.noteNotified) return 200
    if (body.noteUrl === undefined || body.noteUrl === '') {
      const sent = await deps.send(row.chatId, MISSING_NOTE_URL)
      if (!sent) return 200
      row.status = 'failed'
      row.error = MISSING_NOTE_URL
      await deps.store.save(row)
      return 200
    }
    row.title = body.title
    row.noteUrl = body.noteUrl
    const sent = await deps.send(row.chatId, noteReadyMessage(body.title, readerLink(row.jobId, deps)))
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
  const sent = await deps.send(row.chatId, readyLine(body.title), summaryButton(row.jobId))
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
  update: {
    update_id: number
    callback_query: { id: string; data?: string; from?: { id: number }; message?: { chat: { id: number } } }
  },
  deps: WorkerDeps,
): Promise<PlannedKnock[]> {
  await deps.answerTap(update.callback_query.id)
  if (!(await deps.store.rememberUpdate(update.update_id))) return []
  const from = update.callback_query.from
  const binding = await allowedBinding(from === undefined ? undefined : String(from.id), deps)
  if (binding === null) return []
  const data = update.callback_query.data ?? ''
  if (!data.startsWith('summary:')) return []
  const jobId = data.slice('summary:'.length)
  const row = await findRow(deps.store, jobId)
  const action = decideTap(row, row?.sub === binding.sub)
  if (action.type === 'busy') {
    if (row) await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  if (action.type === 'resend') {
    if (row?.title && row.noteUrl) await deps.send(row.chatId, noteReadyMessage(row.title, readerLink(row.jobId, deps)))
    return []
  }
  if (action.type === 'ignore') return []
  const claimed =
    action.type === 'start'
      ? await deps.store.claim(jobId, { phase: 'subtitle', status: 'ready' }, { phase: 'summary', status: 'queued' })
      : await deps.store.claim(jobId, { phase: 'summary', status: 'failed' }, { phase: 'summary', status: 'queued' })
  if (claimed === null) {
    if (row) await deps.send(row.chatId, alreadyLine(row.videoId))
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
