import { classifyInput } from 'transcript-refinery/classify'
import { LANGS, MODEL_KEYS, NO_VIDEO_LINE, NOT_YOUTUBE_LINE, PLAYLIST_LINE, RECIPES, alreadyLine, flatTitle, queuedLine } from './messages.js'
import type { JobRow, LinkToken, RunRow } from './store.js'

export {
  alreadyLine,
  queuedLine,
  readyLine,
  TEXT_ONLY,
  SCAN_EMPTY,
  DOWNLOAD_FAILED,
  SCAN_LONG,
  waitingLine,
  REJECTED_SECRET,
  MISSING_NOTE_URL,
  BIND_FIRST,
  LINK_INVALID,
  LINK_INVALID_PAGE,
  linkLine,
  boundLine,
  alreadyBoundLine,
  notAllowedLine,
  RECIPES,
  LANGS,
  type Key,
  recipeKeyboard,
  pickKeyboard,
  langKeyboard,
  PICK_LINE,
  LANG_LINE,
  NOTHING_TO_TRANSLATE,
  runQueuedLine,
  runStartedLine,
  runFailedLine,
  CANCEL_LINE,
  NOTHING_TO_CANCEL,
  CANCEL_CLOSED,
  CANCEL_RETRY,
  cancelledLine,
  cancelKeyboard,
  retryKeyboard,
  DROPPED_LINE,
  type Probe,
  HELP_TEXT,
  pingLine,
  versionLine,
  statusText,
  MODEL_KEYS,
  type ModelsReply,
  modelText,
  modelKeyboard,
  fitsTap,
  modelPickLine,
  noModelLine,
  modelPickKeyboard,
  modeLine,
  modeKeyboard,
  modelSetLine,
  modelResetLine,
  probeFailure,
} from './messages.js'

export type TapAction = { type: 'start' } | { type: 'retry' } | { type: 'busy' } | { type: 'resend' } | { type: 'ignore' }

export function decideRun(run: RunRow | null): TapAction {
  if (run === null) return { type: 'start' }
  if (OPEN.has(run.status)) return { type: 'busy' }
  if (run.status === 'failed' || run.status === 'cancelled') return { type: 'retry' }
  if (run.status === 'ready' && run.notified) return { type: 'resend' }
  return { type: 'ignore' }
}

export type Tap =
  | { type: 'recipe'; recipe: string; jobId: string }
  | { type: 'translate'; jobId: string }
  | { type: 'toggle' | 'next'; mask: number; jobId: string }
  | { type: 'cancel'; jobId: string }
  | { type: 'drop'; jobId: string }
  | { type: 'lang'; mask: number; lang: string; jobId: string }
  | { type: 'model'; key: string }
  | { type: 'modelPick'; key: string; model: string }
  | { type: 'modelSet'; mode: 'once' | 'always'; key: string; model: string }
  | { type: 'modelReset'; key: string }

const MASK = /^[0-9a-f]{1,2}$/

function isModelKey(key: string): boolean {
  return (MODEL_KEYS as readonly string[]).includes(key)
}

function maskOf(hex: string | undefined): number | null {
  return hex !== undefined && MASK.test(hex) ? parseInt(hex, 16) : null
}

/** A gomb adata. A `jobId` maga is `:`-ot tartalmaz, ezért a maradék egyben a `jobId`. */
export function parseTap(data: string): Tap | null {
  const [head, ...rest] = data.split(':')
  if (head === 'summary') return { type: 'recipe', recipe: 'summary', jobId: rest.join(':') }
  if (head === 'f') return { type: 'translate', jobId: rest.join(':') }
  if (head === 'r') {
    const [recipe, ...job] = rest
    if (recipe === undefined || !(RECIPES as readonly string[]).includes(recipe)) return null
    return { type: 'recipe', recipe, jobId: job.join(':') }
  }
  if (head === 'd') {
    const jobId = rest.join(':')
    return jobId === '' ? null : { type: 'drop', jobId }
  }
  if (head === 'c') {
    const jobId = rest.join(':')
    return jobId === '' ? null : { type: 'cancel', jobId }
  }
  if (head === 't' || head === 'n') {
    const [hex, ...job] = rest
    const mask = maskOf(hex)
    if (mask === null) return null
    return { type: head === 't' ? 'toggle' : 'next', mask, jobId: job.join(':') }
  }
  if (head === 'l') {
    const [hex, lang, ...job] = rest
    const mask = maskOf(hex)
    if (mask === null || lang === undefined || !(LANGS as readonly string[]).includes(lang)) return null
    return { type: 'lang', mask, lang, jobId: job.join(':') }
  }
  if (head === 'm' || head === 'x') {
    const [key] = rest
    if (rest.length !== 1 || key === undefined || !isModelKey(key)) return null
    return head === 'm' ? { type: 'model', key } : { type: 'modelReset', key }
  }
  if (head === 'p') {
    const [key, ...model] = rest
    if (key === undefined || !isModelKey(key) || model.join(':') === '') return null
    return { type: 'modelPick', key, model: model.join(':') }
  }
  if (head === 'o') {
    const [mode, key, ...model] = rest
    if ((mode !== 'o' && mode !== 'a') || key === undefined || !isModelKey(key) || model.join(':') === '') return null
    return { type: 'modelSet', mode: mode === 'o' ? 'once' : 'always', key, model: model.join(':') }
  }
  return null
}

export function maskRecipes(mask: number): string[] {
  return RECIPES.filter((_, index) => (mask & (1 << index)) !== 0)
}

export function runId(jobId: string, recipes: readonly string[], lang: string | null): string {
  return lang === null ? `${jobId}:${recipes.join('+')}` : `${jobId}:${lang}:${recipes.join('+')}`
}

/** A futás jegyzetfajtái: a fordítás `<recept>-<nyelv>`, ahogy a vault fájlneve. */
export function runKinds(run: Pick<RunRow, 'recipes' | 'lang'>): string[] {
  const lang = run.lang
  return lang === null ? [...run.recipes] : run.recipes.map((recipe) => `${recipe}-${lang}`)
}

export function readyBases(runs: readonly RunRow[]): string[] {
  return RECIPES.filter((recipe) =>
    runs.some((run) => run.status === 'ready' && run.lang === null && run.recipes.includes(recipe)),
  )
}

/** A `jobId` (`<update_id>:<videóazonosító>`) videóazonosító része; kettőspont nélkül maga a bemenet. */
export function videoIdOf(jobId: string): string {
  return jobId.slice(jobId.lastIndexOf(':') + 1)
}

export function runReadyMessage(
  title: string,
  run: Pick<RunRow, 'jobId' | 'recipes' | 'lang'>,
  linkBase: string,
  /** Az elkészült jegyzetek fajtái; hiányában a futás összes fajtája. Leállt futásnál csak a kész részek. */
  kinds: readonly string[] = runKinds(run),
): string {
  const head =
    run.lang === null
      ? `${flatTitle(title)} · ${run.recipes.join(', ')}. A jegyzet megvan.`
      : `${flatTitle(title)} · ${run.lang}. A fordítás megvan.`
  return [head, ...kinds.map((kind) => `${linkBase}/notes/${videoIdOf(run.jobId)}/${kind}`)].join('\n')
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
