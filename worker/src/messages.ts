import type { JobRow, RunRow } from './store.js'

export const REJECTED_SECRET = 'A konténer elutasította a hívást.'

export const PLAYLIST_LINE = 'Lejátszási lista későbbre marad.'
export const NOT_YOUTUBE_LINE = 'Nem YouTube-cím.'
export const NO_VIDEO_LINE = 'Nincs YouTube-videó az üzenetben.'
export const TEXT_ONLY = 'Csak .txt vagy .md fájlt tudok feldolgozni.'
export const SCAN_EMPTY = 'Írd a /scan után a szöveget, vagy küldd fájlként.'
export const DOWNLOAD_FAILED = 'A fájlt nem tudtam letölteni, küldd újra.'
export const SCAN_LONG =
  'A szöveg elérhette a Telegram-üzenet határát, lehet, hogy csonka. Hosszabb átiratot fájlként küldj.'

export function queuedLine(videoId: string): string {
  return `Sorba került: ${videoId}`
}

export function waitingLine(videoId: string): string {
  return `A gép ébredésére vár: ${videoId}.`
}

export function flatTitle(title: string): string {
  const flat = [...title]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f ? ' ' : char
    })
    .join('')
  return flat.replace(/ {2,}/g, ' ').trim()
}

export function readyLine(title: string, text = false): string {
  return `${flatTitle(title)}. ${text ? 'A szöveg' : 'A felirat'} megvan.`
}

export function alreadyLine(videoId: string): string {
  return `Már sorban van: ${videoId}.`
}

export const MISSING_NOTE_URL = 'A jegyzet linkje hiányzik.'

export const BIND_FIRST = 'Előbb kösd össze a Google-fiókoddal: /start'
export const LINK_INVALID = 'A link lejárt vagy már nem érvényes. Kérj újat: /start'
export const LINK_INVALID_PAGE = 'A link lejárt vagy már nem érvényes. Kérj újat a botban: /start'

export function linkLine(url: string): string {
  return `Kösd össze a Google-fiókoddal (10 percig érvényes): ${url}`
}

export function boundLine(email: string): string {
  return `Bekötve: ${email}.`
}

export function alreadyBoundLine(email: string): string {
  return `Már be vagy kötve: ${email}.`
}

export function notAllowedLine(email: string): string {
  return `Ez a Google-fiók nincs engedélyezve: ${email}.`
}

export const NO_NOTES = 'Még nincs jegyzet. Küldj egy YouTube-címet a botnak.'
export const NOTE_MISSING = 'A jegyzet nincs a vaultban.'
export const SERVE_DOWN = 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'
export const SERVE_SECRET_MISMATCH = 'A Worker és a serve titka nem egyezik.'
export const SERVE_NO_VAULT = 'A serve nem éri el a vaultot.'
export const SERVE_BAD_REPLY = 'A serve hibás választ adott.'
export const NOTES_STALE = 'A vault most nem frissült, a lista régebbi lehet.'

export const RECIPES = [
  'summary',
  'notes',
  'qa',
  'flashcards',
  'bloom',
  'clean-mild',
  'clean-moderate',
  'clean-deep',
] as const
export const LANGS = ['en', 'hu', 'nl', 'de', 'es', 'fr', 'it'] as const

export interface Key {
  text: string
  data: string
}

function inRows(keys: readonly Key[], size: number): Key[][] {
  const rows: Key[][] = []
  for (let index = 0; index < keys.length; index += size) rows.push(keys.slice(index, index + size))
  return rows
}

export function recipeKeyboard(jobId: string): Key[][] {
  const keys = RECIPES.map((recipe) => ({ text: recipe, data: `r:${recipe}:${jobId}` }))
  return inRows([...keys, { text: 'fordítás', data: `f:${jobId}` }], 3)
}

/** A kapcsoló adata a koppintás utáni maszk, ezért a Workernek nem kell emlékeznie a kijelölésre. */
export function pickKeyboard(mask: number, ready: readonly string[], jobId: string): Key[][] {
  const keys = ready.map((recipe) => {
    const bit = 1 << (RECIPES as readonly string[]).indexOf(recipe)
    return {
      text: (mask & bit) !== 0 ? `✓ ${recipe}` : recipe,
      data: `t:${(mask ^ bit).toString(16)}:${jobId}`,
    }
  })
  return [...inRows(keys, 3), [{ text: 'tovább', data: `n:${mask.toString(16)}:${jobId}` }]]
}

/**
 * A leállt recept rákérdezése. Az Újra a mai receptgomb adatával megy (alaprecept: `r:`,
 * fordítás: `l:` a futás nyelvével és az összes receptjével), tehát nincs új indítási út:
 * a `failed` futás a `decideRun` szerint újraindul.
 */
export function retryKeyboard(run: { jobId: string; recipes: readonly string[]; lang: string | null }): Key[][] {
  const mask = run.recipes.reduce((all, recipe) => all | (1 << (RECIPES as readonly string[]).indexOf(recipe)), 0)
  const retry =
    run.lang === null
      ? `r:${run.recipes[0] ?? ''}:${run.jobId}`
      : `l:${mask.toString(16)}:${run.lang}:${run.jobId}`
  // ponytail: futás közben az Újra „már folyamatban”-t ad (decideRun: busy); sorba állítás, ha zavaró lesz.
  // ponytail: alaprecept-futás egy recepttel indul (a receptgomb is így); több alaprecept közös futása nincs.
  return [[
    { text: 'Újra', data: retry },
    { text: 'Eldobás', data: `d:${run.jobId}` },
  ]]
}

export const DROPPED_LINE = 'Eldobva, nem próbálom újra.'

export function langKeyboard(mask: number, jobId: string): Key[][] {
  return inRows(
    LANGS.map((lang) => ({ text: lang, data: `l:${mask.toString(16)}:${lang}:${jobId}` })),
    4,
  )
}

export const PICK_LINE = 'Melyik jegyzetet fordítsam?'
export const LANG_LINE = 'Melyik nyelvre?'
export const NOTHING_TO_TRANSLATE = 'Előbb készíts egy jegyzetet.'

/** A futásüzenet tárgya (#274): a vault-azonosító és a cím. */
type RunItem = Pick<JobRow, 'videoId' | 'title'>
type RunPart = Pick<RunRow, 'recipes' | 'lang' | 'model'>

const LABEL_TITLE_MAX = 60

function shortTitle(title: string): string {
  const chars = [...flatTitle(title)]
  return chars.length > LABEL_TITLE_MAX ? `${chars.slice(0, LABEL_TITLE_MAX - 1).join('')}…` : chars.join('')
}

function runLabel(item: RunItem, run: RunPart): string {
  const head = item.title === null ? `[${item.videoId}]` : `[${item.videoId}] ${shortTitle(item.title)}`
  return `${head}: ${run.recipes.join(', ')}${run.lang === null ? '' : ` → ${run.lang}`}${run.model ? ` (${run.model})` : ''}`
}

export function runQueuedLine(item: RunItem, run: RunPart): string {
  return `Sorba került ${runLabel(item, run)}`
}

export function runStartedLine(item: RunItem, run: RunPart): string {
  return `Elkezdődött a feldolgozás ${runLabel(item, run)}. Hamarosan jelzem az eredményt.`
}

export function runFailedLine(item: RunItem, run: RunPart, error: string): string {
  return `${runLabel(item, run)}: ${error}`
}

export const CANCEL_LINE = 'Melyiket szakítsam meg?'
export const NOTHING_TO_CANCEL = 'Nincs megszakítható munka.'
export const CANCEL_CLOSED = 'Ez már lefutott vagy meg lett szakítva.'
export const CANCEL_RETRY = 'Most nem érem el a szervert, próbáld újra.'

export function cancelledLine(title: string): string {
  return `Megszakítva: ${flatTitle(title)}.`
}

/** Jobonként egy gomb, alul a „Mind megszakítása”; a `c:*` a felhasználó minden nyitott munkája. */
export function cancelKeyboard(jobs: readonly { jobId: string; videoId: string; title: string | null }[]): Key[][] {
  return [
    ...jobs.map((job) => [{ text: flatTitle(job.title ?? job.videoId), data: `c:${job.jobId}` }]),
    [{ text: 'Mind megszakítása', data: 'c:*' }],
  ]
}

export type Probe = { ok: true; ms: number; version: string; busy: string | null } | { ok: false; reason: 'secret' | 'down' }

export const HELP_TEXT = [
  'Küldj egy YouTube-linket, és letöltöm a feliratát.',
  'Csatolt .txt vagy .md átiratot is feldolgozok.',
  '',
  '/scan <szöveg> – beillesztett átirat feldolgozása (egy üzenetnyi)',
  '/start – a bot összekötése a Google-fiókoddal',
  '/cancel – nyitott munka megszakítása',
  '/status – a szerver állapota és a nyitott munkák',
  '/ping – a szerver elérhetősége',
  '/version – a szerver verziója',
  '/help – ez a súgó',
].join('\n')

export const SERVE_SILENT = 'A szerver nem válaszol.'

function probeFailure(probe: { reason: 'secret' | 'down' }): string {
  return probe.reason === 'secret' ? SERVE_SECRET_MISMATCH : SERVE_SILENT
}

export function pingLine(probe: Probe): string {
  return probe.ok ? `A szerver él (${probe.ms} ms).` : probeFailure(probe)
}

export function versionLine(probe: Probe): string {
  return probe.ok ? `A szerver verziója: ${probe.version}.` : probeFailure(probe)
}

export function statusText(probe: Probe, jobs: number, runs: number): string {
  const busy = probe.ok && probe.busy !== null ? `Most ezen dolgozik: ${probe.busy}.` : 'Most nem dolgozik.'
  const head = probe.ok ? `${versionLine(probe)} ${busy}` : probeFailure(probe)
  return `${head}\nNyitott videó: ${jobs}, nyitott receptfutás: ${runs}.`
}
