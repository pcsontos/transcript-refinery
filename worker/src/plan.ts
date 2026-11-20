import { classifyInput } from 'transcript-refinery/classify'
import { LANGS, MODEL_KEYS, NO_LINK_LINE, RECIPES, alreadyLine, flatTitle, queuedLine, resolvingLine } from './messages.js'
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
  FETCH_RENAMED,
  FETCH_USAGE,
  PICK_USAGE,
  TRANSCRIBE_HINT,
  TRANSCRIBE_HINT_REPLY,
  langAskKeyboard,
  langAskLine,
  langChosenLine,
  TRANSCRIBE_LIST_HEADER,
  TRANSCRIBE_PICK_USAGE,
  TRANSCRIBE_USAGE,
  fetchTitle,
  cancelKeyboard,
  retryKeyboard,
  recipeMask,
  regenerateKeyboard,
  regenerateConfirmKeyboard,
  regenerateAskLine,
  REGENERATE_DROPPED,
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
  deployFailedLine,
  transcribeHintLine,
  LIST_CANCELLED,
  listLine,
  listQueuedLine,
  listKeyboard,
} from './messages.js'

export type TapAction = { type: 'start' } | { type: 'retry' } | { type: 'regenerate' } | { type: 'busy' } | { type: 'resend' } | { type: 'ignore' }

export function decideRun(run: RunRow | null, regenerate = false): TapAction {
  if (run === null) return { type: 'start' }
  if (OPEN.has(run.status)) return { type: 'busy' }
  // Újragenerálás (pcsontos/issue-tracker#104): kész és hibás futásra is, force-szal; a sima retry ugyanazt a kihagyást hozná vissza.
  if (regenerate) return { type: 'regenerate' }
  if (run.status === 'failed' || run.status === 'cancelled') return { type: 'retry' }
  if (run.status === 'ready' && run.notified) return { type: 'resend' }
  return { type: 'ignore' }
}

const LANG_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

/** A CLI `parseLang`-jának másolata (a Worker nem importálhat a `src/`-ből); közös tesztesetekkel. */
export function workerLang(raw: string): string | null {
  const [head, ...rest] = raw.trim().split('-')
  if (head === undefined || head === '' || head.toLowerCase() === 'all') return null
  const tag = rest.length === 0 ? head.toLowerCase() : `${head.toLowerCase()}-${rest.join('-')}`
  return LANG_TAG.test(tag) ? tag : null
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
  | { type: 'list'; action: 'a' | 'v' | 'x'; jobId: string }
  | { type: 'regenerateAsk' | 'regenerate'; mask: number; lang: string | null; jobId: string }
  | { type: 'regenerateDrop' }
  | { type: 'langAsk'; lang: string; jobId: string }

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
  if (head === 'g' || head === 'G') {
    const [hex, lang, ...job] = rest
    const mask = maskOf(hex)
    const jobId = job.join(':')
    if (mask === null || mask === 0 || lang === undefined || jobId === '') return null
    if (lang !== '-' && !(LANGS as readonly string[]).includes(lang)) return null
    return { type: head === 'g' ? 'regenerateAsk' : 'regenerate', mask, lang: lang === '-' ? null : lang, jobId }
  }
  if (head === 'w') {
    const [raw, ...job] = rest
    const lang = raw === undefined ? null : workerLang(raw)
    const jobId = job.join(':')
    return lang === null || jobId === '' ? null : { type: 'langAsk', lang, jobId }
  }
  if (head === 'q') return rest.length === 0 ? { type: 'regenerateDrop' } : null
  if (head === 'L') {
    const [action, ...job] = rest
    const jobId = job.join(':')
    if ((action !== 'a' && action !== 'v' && action !== 'x') || jobId === '') return null
    return { type: 'list', action, jobId }
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

/** A kopogtatás azonosítója: az első próbálkozásnál a `runId`, utána `<runId>~<n>` (pcsontos/issue-tracker#103). */
export function knockId(run: Pick<RunRow, 'runId' | 'attempt'>): string {
  const attempt = run.attempt ?? 0
  return attempt > 0 ? `${run.runId}~${attempt}` : run.runId
}

/** A `knockId` fordítottja; az utótag nélküli (régi) azonosító a 0. próbálkozás. */
export function splitKnockId(id: string): { runId: string; attempt: number } {
  const match = /^(.*)~(\d+)$/.exec(id)
  return match?.[1] === undefined || match[2] === undefined ? { runId: id, attempt: 0 } : { runId: match[1], attempt: Number(match[2]) }
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

const SITE_TRANSLATIONS = ['hu', 'en']

/** A jegyzet linkje: `siteUrl`-lel a site-ra (alaprecept nyelv nélkül, hu/en fordítás nyelvvel), különben a Workerre. */
export function noteLink(run: Pick<RunRow, 'jobId' | 'lang'>, kind: string, linkBase: string, siteUrl: string): string {
  const id = videoIdOf(run.jobId)
  const site = siteUrl.replace(/\/+$/, '')
  if (site === '' || (run.lang !== null && !SITE_TRANSLATIONS.includes(run.lang))) return `${linkBase}/notes/${id}/${kind}`
  if (run.lang === null) return `${site}/notes/${id}/${kind}`
  return `${site}/${run.lang}/notes/${id}/${kind.slice(0, -(run.lang.length + 1))}`
}

export function runReadyMessage(
  title: string,
  run: Pick<RunRow, 'jobId' | 'recipes' | 'lang'>,
  linkBase: string,
  siteUrl: string,
  /** Az elkészült jegyzetek fajtái; hiányában a futás összes fajtája. Leállt futásnál csak a kész részek. */
  kinds: readonly string[] = runKinds(run),
): string {
  const head =
    run.lang === null
      ? `${flatTitle(title)} · ${run.recipes.join(', ')}. A jegyzet megvan.`
      : `${flatTitle(title)} · ${run.lang}. A fordítás megvan.`
  return [head, ...kinds.map((kind) => noteLink(run, kind, linkBase, siteUrl))].join('\n')
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const OPEN = new Set(['queued', 'waiting', 'accepted'])

export function linesForMessage(
  text: string,
  active: readonly JobRow[],
): { lines: string[]; jobs: { videoId: string; url: string }[]; resolves: string[] } {
  const lines: string[] = []
  const jobs: { videoId: string; url: string }[] = []
  const resolves: string[] = []
  for (const token of text.split(/\s+/)) {
    if (token === '') continue
    if (!token.includes('://') && !VIDEO_ID.test(token)) continue
    // A puszta YouTube-videó közvetlen; minden más http(s) link (lista, `watch?v&list`, nem YouTube-os, YouTube-csatorna)
    // feloldásra megy.
    const asList = classifyInput(token, true)
    const classified = classifyInput(token, false)
    if (asList.kind !== 'playlist' && classified.kind !== 'video' && !/^https?:\/\//i.test(token)) continue
    if (asList.kind === 'playlist' || classified.kind !== 'video') {
      resolves.push(token)
      lines.push(resolvingLine(token))
      continue
    }
    if (classified.kind === 'video') {
      const open = active.some((row) => row.videoId === classified.id && OPEN.has(row.status))
      if (open) lines.push(alreadyLine(classified.id))
      else {
        lines.push(queuedLine(classified.id))
        jobs.push({ videoId: classified.id, url: classified.url })
      }
      continue
    }
  }
  if (lines.length === 0) return { lines: [NO_LINK_LINE], jobs, resolves }
  return { lines, jobs, resolves }
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
