import {
  BIND_FIRST,
  DOWNLOAD_FAILED,
  SCAN_EMPTY,
  SCAN_LONG,
  TEXT_ONLY,
  CANCEL_CLOSED,
  CANCEL_LINE,
  CANCEL_RETRY,
  HELP_TEXT,
  LANG_LINE,
  LINK_INVALID,
  MISSING_NOTE_URL,
  NOTHING_TO_CANCEL,
  NOTHING_TO_TRANSLATE,
  DROPPED_LINE,
  PICK_LINE,
  REJECTED_SECRET,
  TOKEN_TTL,
  alreadyBoundLine,
  alreadyLine,
  boundLine,
  cancelKeyboard,
  cancelledLine,
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
  pingLine,
  pickKeyboard,
  queuedLine,
  readyBases,
  readyLine,
  recipeKeyboard,
  retryKeyboard,
  runId,
  runFailedLine,
  runQueuedLine,
  runReadyMessage,
  runStartedLine,
  statusText,
  versionLine,
  waitingLine,
  type Key,
  type Probe,
} from './plan.js'
import {
  MAX_TEXT_BYTES,
  TEXT_EXTENSIONS,
  isTextItemId,
  normalizeText,
  splitSubtitleName,
  textItemId,
  tooLargeMessage,
} from 'transcript-refinery/text'
import { OPEN, type Binding, type JobRow, type JobStatus, type JobStore, type RunRow } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
  /** Szöveges tétel: a normalizált szöveg, a cím és a fájlnév nyelvkódja; a serve ebből tölti az R2-t. */
  text?: string
  title?: string
  textLang?: string
}

export interface WorkerDeps {
  allowedEmails: string
  botUsername: string
  linkBase: string
  store: JobStore
  now: () => number
  newToken: () => string
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  /** A serve futó jobjának leállítása: `ok` 200, `unknown` 404, minden más `unreachable`. */
  cancel: (id: string) => Promise<'ok' | 'unknown' | 'unreachable'>
  /** A serve `GET /status`-a, mért válaszidővel; ebből dolgozik a `/ping`, a `/version` és a `/status`. */
  probe: () => Promise<Probe>
  /** A Telegram-csatolmány bájtjai (`getFile`, majd a fájl-URL); `null`, ha nem sikerült. */
  download: (fileId: string) => Promise<Uint8Array | null>
  send: (chatId: string, text: string, keyboard?: Key[][]) => Promise<boolean>
  edit: (chatId: string, messageId: number, text: string, keyboard: Key[][]) => Promise<boolean>
  answerTap: (callbackQueryId: string) => Promise<void>
}

type KnockResult = 202 | 409 | 401 | 'down'

const START = /^\/start(?:\s+(\S+))?\s*$/
const COMMAND = /^\/(help|cancel|ping|version|status)(?:@\w+)?\s*$/

const SCAN = /^\/scan(?:@\w+)?(?:\s+([\s\S]*))?$/
/** A Telegram 4096 karakternél bont, mondathatáron, így az első darab rövidebb is lehet. */
const SCAN_WARN_AT = 3900
const TITLE_MAX = 80

type TelegramDocument = { file_id: string; file_name?: string; file_size?: number }
type TextJob = { videoId: string; title: string; text: string; fileId: string | null; fileName: string | null }

/** A szöveges mag hibája (`a fájl üres`) a botban mondatként. */
function sentence(message: string): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`
}

/** Szöveges tételnél a cím, videónál az azonosító, ahogy ma. */
function label(row: JobRow): string {
  return isTextItemId(row.videoId) ? (row.title ?? row.videoId) : row.videoId
}

/** Csatolmányból vagy `/scan`-ből a szöveges tétel; `string` a visszaküldendő mondat, `null`, ha nem szöveges bemenet. */
async function textInput(
  message: { text?: string; document?: TelegramDocument },
  deps: WorkerDeps,
): Promise<{ job: TextJob; warn: boolean } | string | null> {
  const doc = message.document
  if (doc !== undefined) {
    const fileName = doc.file_name ?? ''
    const name = splitSubtitleName(fileName, TEXT_EXTENSIONS)
    if (name === null) return TEXT_ONLY
    if ((doc.file_size ?? 0) > MAX_TEXT_BYTES) return sentence(tooLargeMessage(doc.file_size ?? 0))
    const bytes = await deps.download(doc.file_id)
    if (bytes === null) return DOWNLOAD_FAILED
    let text: string
    try {
      text = normalizeText(bytes, fileName.toLowerCase().endsWith('.md'))
    } catch (error) {
      return sentence((error as Error).message)
    }
    return { job: { videoId: await textItemId(text), title: name.base, text, fileId: doc.file_id, fileName }, warn: false }
  }
  const scan = SCAN.exec(message.text ?? '')
  if (scan === null) return null
  let text: string
  try {
    text = normalizeText(new TextEncoder().encode(scan[1] ?? ''), false)
  } catch {
    // Egy Telegram-szöveg nem lehet bináris és 2 MB-os sem: a valós hiba csak az üresség.
    return SCAN_EMPTY
  }
  const first = text.split('\n').find((line) => line.trim() !== '') ?? text
  const title = [...first.trim()].slice(0, TITLE_MAX).join('')
  return {
    job: { videoId: await textItemId(text), title, text, fileId: null, fileName: null },
    warn: (message.text ?? '').length >= SCAN_WARN_AT,
  }
}

function textKnock(row: JobRow, text: string): PlannedKnock {
  const knock: PlannedKnock = { jobId: row.jobId, videoId: row.videoId, url: row.url, text, title: row.title ?? row.videoId }
  const lang = row.fileName ? splitSubtitleName(row.fileName, TEXT_EXTENSIONS)?.language : null
  if (lang) knock.textLang = lang
  return knock
}

/**
 * A sor kopogtatása. Szöveges sornál a szöveg a D1-ből, vagy a csatolmány
 * újraletöltéséből; `null`, ha a letöltés nem sikerült (a hívó `down`-nak veszi).
 */
async function jobKnock(row: JobRow, deps: WorkerDeps): Promise<PlannedKnock | null> {
  if (row.text) return textKnock(row, row.text)
  if (row.fileId && row.fileName) {
    const bytes = await deps.download(row.fileId)
    if (bytes === null) return null
    try {
      return textKnock(row, normalizeText(bytes, row.fileName.toLowerCase().endsWith('.md')))
    } catch {
      // A file_id tartalma nem változik, és a beérkezéskor átment: ide nem jutunk.
      return null
    }
  }
  return { jobId: row.jobId, videoId: row.videoId, url: row.url }
}

async function textRow(
  updateId: number,
  messageId: number,
  chatId: string,
  sub: string,
  input: { job: TextJob; warn: boolean },
  deps: WorkerDeps,
): Promise<{ status: number; knocks: PlannedKnock[] }> {
  const { job, warn } = input
  const lines: string[] = []
  const knocks: PlannedKnock[] = []
  if (await deps.store.activeByVideo(job.videoId)) {
    lines.push(alreadyLine(job.title))
  } else {
    const row: JobRow = {
      jobId: `${updateId}:${job.videoId}`,
      updateId,
      chatId,
      messageId,
      videoId: job.videoId,
      url: '',
      status: 'queued',
      error: null,
      title: job.title,
      notifiedReady: false,
      acceptedAt: null,
      sub,
      fileId: job.fileId,
      fileName: job.fileName,
      // A csatolmány a file_id-ből újra letölthető, a beillesztett szöveg nem.
      text: job.fileId === null ? job.text : null,
    }
    await deps.store.insert(row)
    lines.push(queuedLine(job.title))
    knocks.push(textKnock(row, job.text))
  }
  if (warn) lines.push(SCAN_LONG)
  await deps.send(chatId, lines.join('\n'))
  return { status: 200, knocks }
}

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

async function handleCommand(
  updateId: number,
  command: string,
  userId: string,
  chatId: string,
  deps: WorkerDeps,
): Promise<void> {
  if (!(await deps.store.rememberUpdate(updateId))) return
  if (command === 'help') {
    await deps.send(chatId, HELP_TEXT)
    return
  }
  const binding = await allowedBinding(userId, deps)
  if (binding === null) {
    await deps.send(chatId, BIND_FIRST)
    return
  }
  if (command === 'cancel') {
    const open = await deps.store.openFor(binding.sub)
    if (open.jobs.length === 0) await deps.send(chatId, NOTHING_TO_CANCEL)
    else await deps.send(chatId, CANCEL_LINE, cancelKeyboard(open.jobs))
    return
  }
  const probe = await deps.probe()
  if (command === 'ping') {
    await deps.send(chatId, pingLine(probe))
    return
  }
  if (command === 'version') {
    await deps.send(chatId, versionLine(probe))
    return
  }
  const open = await deps.store.openFor(binding.sub)
  const jobs = open.jobs.filter((job) => OPEN.includes(job.status)).length
  await deps.send(chatId, statusText(probe, jobs, open.runs.length))
}

/**
 * Egy sor vagy futás megszakítása: a futót előbb a serve állítja le, utána a
 * feltételes írás. Ha az írás közben a cron átírta az állapotot, egyszer újra próbál.
 */
async function cancelOne(
  id: string,
  load: () => Promise<{ status: JobStatus } | null>,
  claim: (expect: JobStatus) => Promise<boolean>,
  deps: WorkerDeps,
): Promise<'cancelled' | 'unreachable' | 'closed'> {
  // ponytail: egy újrapróba; a harmadik versenyhez két kopogtatás kellene a koppintás alatt.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const item = await load()
    if (item === null || !OPEN.includes(item.status)) return 'closed'
    if (item.status === 'accepted' && (await deps.cancel(id)) === 'unreachable') return 'unreachable'
    if (await claim(item.status)) return 'cancelled'
  }
  return 'closed'
}

async function cancelTap(target: string, sub: string, chatId: string, deps: WorkerDeps): Promise<void> {
  const open = await deps.store.openFor(sub)
  const jobs = target === '*' ? open.jobs : open.jobs.filter((job) => job.jobId === target)
  if (jobs.length === 0) {
    await deps.send(chatId, CANCEL_CLOSED)
    return
  }
  for (const job of jobs) {
    const outcomes = [
      await cancelOne(
        job.jobId,
        () => findRow(deps.store, job.jobId),
        (expect) => deps.store.claimJob(job.jobId, expect, 'cancelled'),
        deps,
      ),
    ]
    for (const run of open.runs.filter((item) => item.jobId === job.jobId)) {
      outcomes.push(
        await cancelOne(
          run.runId,
          () => deps.store.run(run.runId),
          (expect) => deps.store.claimRun(run.runId, expect, 'cancelled'),
          deps,
        ),
      )
    }
    const text = outcomes.includes('unreachable')
      ? CANCEL_RETRY
      : outcomes.includes('cancelled')
        ? cancelledLine(job.title ?? job.videoId)
        : CANCEL_CLOSED
    // A sor ilyenkor is cancelled marad; a spec szerint csak naplózzuk.
    if (!(await deps.send(chatId, text))) console.warn(`[worker] A megszakítás üzenete nem ment ki: ${job.jobId}`)
  }
}

/** Az utólagos leállítás: ha a serve nem érhető el, a sor már cancelled, és csak a napló őrzi a nyomát. */
async function stopServe(id: string, deps: WorkerDeps): Promise<void> {
  if ((await deps.cancel(id)) === 'unreachable') console.warn(`[worker] A serve leállítása nem sikerült: ${id}`)
}

/**
 * A felirat sora és a futás sora is így áll be a kopogtatás eredménye szerint.
 * A `started` üzenet csak az első elfogadáskor megy: a cron a régóta elfogadott
 * futást újra kopogtatja, és arra a konténer megint 202-t ad. A gomb és a cron
 * egyszerre is kopogtathat: a `claimRun` dönti el, melyikük küldi az üzenetet;
 * a vesztes nem ír és nem küld.
 * Ha a sort vagy a futást a kopogtatás közben megszakították, a 202 nem írja
 * vissza, hanem a serve leállítást kap.
 */
async function settle(
  target: { status: JobStatus; acceptedAt: number | null; error: string | null },
  row: JobRow,
  save: () => Promise<boolean>,
  result: KnockResult,
  deps: WorkerDeps,
  started?: { runId: string; text: string },
): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    const fresh = target.status !== 'accepted'
    const won = fresh && started !== undefined && (await deps.store.claimRun(started.runId, target.status, 'accepted'))
    if (fresh && started !== undefined && !won) {
      if ((await deps.store.run(started.runId))?.status === 'cancelled') await stopServe(started.runId, deps)
      return
    }
    target.status = 'accepted'
    target.acceptedAt = deps.now()
    if (!(await save())) {
      await stopServe(started?.runId ?? row.jobId, deps)
      return
    }
    if (won) await deps.send(row.chatId, started.text)
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
  const sent = await deps.send(row.chatId, waitingLine(label(row)))
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
    message?: {
      message_id: number
      chat: { id: number }
      from?: { id: number }
      text?: string
      document?: TelegramDocument
      caption?: string
    }
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
  const command = COMMAND.exec(message.text ?? '')?.[1]
  if (command !== undefined) {
    await handleCommand(update.update_id, command, userId, chatId, deps)
    return { status: 200, knocks: [] }
  }
  const binding = await allowedBinding(userId, deps)
  if (binding === null) {
    await deps.send(chatId, BIND_FIRST)
    return { status: 200, knocks: [] }
  }
  if ((await deps.store.listByUpdate(update.update_id)).length > 0) return { status: 200, knocks: [] }
  const input = await textInput(message, deps)
  if (typeof input === 'string') {
    await deps.send(chatId, input)
    return { status: 200, knocks: [] }
  }
  if (input !== null) return textRow(update.update_id, message.message_id, chatId, binding.sub, input, deps)
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
      error: null,
      title: null,
      notifiedReady: false,
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
      await settle(
        run,
        row,
        () => deps.store.saveRun(run),
        await deps.knock(knock),
        deps,
        { runId: run.runId, text: runStartedLine(run.recipes, run.lang) },
      )
      continue
    }
    const row = await findRow(deps.store, knock.jobId)
    if (!row) continue
    await settle(row, row, () => deps.store.save(row), await deps.knock(knock), deps)
  }
}

export type CallbackBody =
  | { status: 'ready'; title: string; noteUrl?: string }
  | { status: 'failed'; error: string; done?: string[] }
  | { status: 'progress'; text: string }
  | { status: 'stalled'; text: string }

async function runCallback(run: RunRow, body: CallbackBody, deps: WorkerDeps): Promise<void> {
  const row = await findRow(deps.store, run.jobId)
  if (row === null) return
  // A megszakított futás késői eredménye csak üzenet: az állapot marad, a cron nem kopogtatja.
  if (run.status === 'cancelled') {
    if (body.status === 'progress' || body.status === 'stalled') return
    await deps.send(
      row.chatId,
      body.status === 'failed'
        ? runFailedLine(run.recipes, run.lang, body.error)
        : runReadyMessage(body.title, run, deps.linkBase),
    )
    return
  }
  // Az életjel és a leállás nem változtat állapotot: a záró üzenet (ready/failed) dönt.
  if (body.status === 'progress') {
    await deps.send(row.chatId, body.text)
    return
  }
  if (body.status === 'stalled') {
    await deps.send(row.chatId, body.text, retryKeyboard(run))
    return
  }
  if (body.status === 'failed' && body.done !== undefined) {
    // Recept-leállás: a rákérdezés már kiment, a záró üzenet csak az elkészült jegyzeteket linkeli (ha van).
    if (body.done.length > 0) {
      const sent = await deps.send(row.chatId, runReadyMessage(row.title ?? row.videoId, run, deps.linkBase, body.done))
      if (!sent) return
    }
    run.status = 'failed'
    run.error = body.error
    await deps.store.saveRun(run)
    return
  }
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, runFailedLine(run.recipes, run.lang, body.error))
    if (!sent) return
    run.status = 'failed'
    run.error = body.error
    await deps.store.saveRun(run)
    return
  }
  if (run.notified) return
  if (body.noteUrl === undefined || body.noteUrl === '') {
    const sent = await deps.send(row.chatId, runFailedLine(run.recipes, run.lang, MISSING_NOTE_URL))
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
  // A megszakított felirat-job késői eredményét elnyeljük.
  if (!row || row.status === 'cancelled') return 200
  // A felirat-jobnak nincs életjele és leállása; ha mégis érkezik, nem teszünk vele semmit.
  if (body.status === 'progress' || body.status === 'stalled') return 200
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.notifiedReady) {
    // Az újrakopogtatott, már értesített sor is ready, különben a cron örökké kopogtatja.
    if (row.status !== 'ready') {
      row.status = 'ready'
      await deps.store.save(row)
    }
    return 200
  }
  row.title = body.title
  const sent = await deps.send(row.chatId, readyLine(body.title, isTextItemId(row.videoId)), recipeKeyboard(row.jobId))
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
    await deps.send(row.chatId, alreadyLine(label(row)))
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
    action.type === 'start'
      ? await deps.store.insertRun(fresh)
      : run !== null && (await deps.store.claimRun(id, run.status, 'queued'))
  if (!claimed) {
    await deps.send(row.chatId, alreadyLine(label(row)))
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
  // A privát chatben a chat azonosítója a feladóé.
  if (tap.type === 'cancel') {
    if (from !== undefined) await cancelTap(tap.jobId, binding.sub, String(from.id), deps)
    return []
  }
  const row = await findRow(deps.store, tap.jobId)
  if (row === null || row.sub !== binding.sub || row.status !== 'ready') return []
  if (tap.type === 'drop') {
    // A leállt recept eldobása: nem indul futás; a gombok eltűnnek. Az Újra a receptgombok útján megy (`requestRun`).
    const messageId = update.callback_query.message?.message_id
    if (typeof messageId === 'number') await deps.edit(row.chatId, messageId, DROPPED_LINE, [])
    return []
  }
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
    const knock = await jobKnock(row, deps)
    await settle(row, row, () => deps.store.save(row), knock === null ? 'down' : await deps.knock(knock), deps)
  }
  for (const run of await deps.store.dueRuns(deps.now())) {
    const row = await findRow(deps.store, run.jobId)
    if (row === null) continue
    await settle(
      run,
      row,
      () => deps.store.saveRun(run),
      await deps.knock(knockFor(run, row)),
      deps,
      { runId: run.runId, text: runStartedLine(run.recipes, run.lang) },
    )
  }
}
