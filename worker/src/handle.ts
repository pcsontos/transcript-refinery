import {
  BIND_FIRST,
  LANG_LINE,
  LINK_INVALID,
  MISSING_NOTE_URL,
  NOTHING_TO_TRANSLATE,
  PICK_LINE,
  REJECTED_SECRET,
  TOKEN_TTL,
  alreadyBoundLine,
  alreadyLine,
  boundLine,
  decideRun,
  decideStart,
  hashToken,
  isAllowed,
  isToken,
  langKeyboard,
  linesForMessage,
  linkLine,
  maskRecipes,
  notAllowedLine,
  parseTap,
  pickKeyboard,
  queuedLine,
  readyBases,
  readyLine,
  recipeKeyboard,
  runId,
  runQueuedLine,
  runReadyMessage,
  waitingLine,
  type Key,
} from './plan.js'
import type { Binding, JobRow, JobStatus, JobStore, RunRow } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
}

export interface WorkerDeps {
  allowedEmails: string
  botUsername: string
  linkBase: string
  store: JobStore
  now: () => number
  newToken: () => string
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  send: (chatId: string, text: string, keyboard?: Key[][]) => Promise<boolean>
  edit: (chatId: string, messageId: number, text: string, keyboard: Key[][]) => Promise<boolean>
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

async function allowedBinding(userId: string | undefined, deps: WorkerDeps): Promise<Binding | null> {
  if (userId === undefined) return null
  const binding = await deps.store.bindingFor(userId)
  if (binding === null || !isAllowed(binding.email, deps.allowedEmails)) return null
  return binding
}

/** A felirat sora és a futás sora is így áll be a kopogtatás eredménye szerint. */
async function settle(
  target: { status: JobStatus; acceptedAt: number | null; error: string | null },
  row: JobRow,
  save: () => Promise<void>,
  result: KnockResult,
  deps: WorkerDeps,
): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    target.status = 'accepted'
    target.acceptedAt = deps.now()
    await save()
    return
  }
  if (result === 401) {
    const sent = await deps.send(row.chatId, REJECTED_SECRET)
    if (!sent) return
    target.status = 'failed'
    target.error = REJECTED_SECRET
    await save()
    return
  }
  if (target.status === 'waiting') return
  const sent = await deps.send(row.chatId, waitingLine(row.videoId))
  if (!sent) return
  target.status = 'waiting'
  await save()
}

function knockFor(run: RunRow, row: JobRow): PlannedKnock {
  const knock: PlannedKnock = { jobId: run.runId, videoId: row.videoId, url: row.url, recipes: run.recipes }
  if (run.lang !== null) knock.lang = run.lang
  return knock
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
    if (knock.recipes !== undefined) {
      const run = await deps.store.run(knock.jobId)
      const row = run === null ? null : await findRow(deps.store, run.jobId)
      if (run === null || row === null) continue
      await settle(run, row, () => deps.store.saveRun(run), await deps.knock(knock), deps)
      continue
    }
    const row = await findRow(deps.store, knock.jobId)
    if (!row) continue
    await settle(row, row, () => deps.store.save(row), await deps.knock(knock), deps)
  }
}

type CallbackBody = { status: 'ready'; title: string; noteUrl?: string } | { status: 'failed'; error: string }

async function runCallback(run: RunRow, body: CallbackBody, deps: WorkerDeps): Promise<void> {
  const row = await findRow(deps.store, run.jobId)
  if (row === null) return
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return
    run.status = 'failed'
    run.error = body.error
    await deps.store.saveRun(run)
    return
  }
  if (run.notified) return
  if (body.noteUrl === undefined || body.noteUrl === '') {
    const sent = await deps.send(row.chatId, MISSING_NOTE_URL)
    if (!sent) return
    run.status = 'failed'
    run.error = MISSING_NOTE_URL
    await deps.store.saveRun(run)
    return
  }
  run.noteUrl = body.noteUrl
  const sent = await deps.send(row.chatId, runReadyMessage(body.title, run, deps.linkBase))
  if (!sent) {
    run.status = 'accepted'
    await deps.store.saveRun(run)
    return
  }
  run.status = 'ready'
  run.notified = true
  await deps.store.saveRun(run)
}

export async function handleCallback(id: string, body: CallbackBody, deps: WorkerDeps): Promise<number> {
  const run = await deps.store.run(id)
  if (run !== null) {
    await runCallback(run, body, deps)
    return 200
  }
  const row = await findRow(deps.store, id)
  if (!row) return 200
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.notifiedReady) return 200
  row.title = body.title
  const sent = await deps.send(row.chatId, readyLine(body.title), recipeKeyboard(row.jobId))
  if (!sent) {
    await deps.store.save(row)
    return 200
  }
  row.status = 'ready'
  row.notifiedReady = true
  await deps.store.save(row)
  return 200
}

async function requestRun(row: JobRow, recipes: string[], lang: string | null, deps: WorkerDeps): Promise<PlannedKnock[]> {
  const id = runId(row.jobId, recipes, lang)
  const run = await deps.store.run(id)
  const action = decideRun(run)
  if (action.type === 'ignore') return []
  if (action.type === 'busy') {
    await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  if (action.type === 'resend') {
    if (run !== null) await deps.send(row.chatId, runReadyMessage(row.title ?? row.videoId, run, deps.linkBase))
    return []
  }
  const fresh: RunRow = {
    runId: id,
    jobId: row.jobId,
    recipes,
    lang,
    status: 'queued',
    error: null,
    noteUrl: null,
    notified: false,
    acceptedAt: null,
  }
  const claimed =
    action.type === 'start' ? await deps.store.insertRun(fresh) : await deps.store.claimRun(id, 'failed', 'queued')
  if (!claimed) {
    await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  await deps.send(row.chatId, runQueuedLine(recipes, lang))
  return [knockFor(fresh, row)]
}

export async function handleTap(
  update: {
    update_id: number
    callback_query: {
      id: string
      data?: string
      from?: { id: number }
      message?: { message_id?: number; chat: { id: number } }
    }
  },
  deps: WorkerDeps,
): Promise<PlannedKnock[]> {
  await deps.answerTap(update.callback_query.id)
  if (!(await deps.store.rememberUpdate(update.update_id))) return []
  const from = update.callback_query.from
  const binding = await allowedBinding(from === undefined ? undefined : String(from.id), deps)
  if (binding === null) return []
  const tap = parseTap(update.callback_query.data ?? '')
  if (tap === null) return []
  const row = await findRow(deps.store, tap.jobId)
  if (row === null || row.sub !== binding.sub || row.status !== 'ready') return []
  if (tap.type === 'recipe') return requestRun(row, [tap.recipe], null, deps)
  if (tap.type === 'lang') {
    const recipes = maskRecipes(tap.mask)
    return recipes.length === 0 ? [] : requestRun(row, recipes, tap.lang, deps)
  }
  const ready = readyBases(await deps.store.runsFor(row.jobId))
  if (tap.type === 'translate') {
    if (ready.length === 0) await deps.send(row.chatId, NOTHING_TO_TRANSLATE)
    else await deps.send(row.chatId, PICK_LINE, pickKeyboard(0, ready, row.jobId))
    return []
  }
  // A Telegram a régi üzenetnél elhagyhatja a message mezőt: ilyenkor nincs mit szerkeszteni.
  const messageId = update.callback_query.message?.message_id
  if (typeof messageId !== 'number') return []
  if (tap.type === 'toggle') await deps.edit(row.chatId, messageId, PICK_LINE, pickKeyboard(tap.mask, ready, row.jobId))
  else if (tap.mask !== 0) await deps.edit(row.chatId, messageId, LANG_LINE, langKeyboard(tap.mask, row.jobId))
  return []
}

export async function handleCron(deps: WorkerDeps): Promise<void> {
  for (const row of await deps.store.due(deps.now())) {
    const knock: PlannedKnock = { jobId: row.jobId, videoId: row.videoId, url: row.url }
    await settle(row, row, () => deps.store.save(row), await deps.knock(knock), deps)
  }
  for (const run of await deps.store.dueRuns(deps.now())) {
    const row = await findRow(deps.store, run.jobId)
    if (row === null) continue
    await settle(run, row, () => deps.store.saveRun(run), await deps.knock(knockFor(run, row)), deps)
  }
}
