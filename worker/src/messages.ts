import type { JobRow, ModelOverride, RunRow } from './store.js'

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

/** A bot parancsai: ebből épül a `/help` és a Telegram `/` menüje (`pnpm telegram:commands`). */
export const BOT_COMMANDS: readonly { command: string; args?: string; description: string }[] = [
  { command: 'scan', args: '<szöveg>', description: 'beillesztett átirat feldolgozása (egy üzenetnyi)' },
  { command: 'start', description: 'a bot összekötése a Google-fiókoddal' },
  { command: 'cancel', description: 'nyitott munka megszakítása' },
  { command: 'model', description: 'a receptek modelljének megtekintése és váltása' },
  { command: 'status', description: 'a szerver állapota és a nyitott munkák' },
  { command: 'ping', description: 'a szerver elérhetősége' },
  { command: 'version', description: 'a szerver verziója' },
  { command: 'help', description: 'ez a súgó' },
]

export const HELP_TEXT = [
  'Küldj egy YouTube-linket, és letöltöm a feliratát.',
  'Csatolt .txt vagy .md átiratot is feldolgozok.',
  '',
  ...BOT_COMMANDS.map(({ command, args, description }) =>
    `/${command}${args === undefined ? '' : ` ${args}`} – ${description}`,
  ),
].join('\n')

export const SERVE_SILENT = 'A szerver nem válaszol.'

export function probeFailure(probe: { reason: 'secret' | 'down' }): string {
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

export type ModelsReply =
  | {
      ok: true
      draft: string
      recipes: Readonly<Record<string, string>>
      models: readonly { name: string; structured: boolean }[]
      structuredRecipes: readonly string[]
    }
  | { ok: false; reason: 'secret' | 'down' }

export const MODEL_KEYS = [...RECIPES, 'translate'] as const
const TAP_MAX = 64

function keyLabel(key: string): string {
  return key === 'translate' ? 'fordítás' : key
}

/** A `/model` kiírása: felülírás, ha van (az egyszeri elöl), különben a config szerinti modell. */
export function modelText(view: Extract<ModelsReply, { ok: true }>, overrides: readonly ModelOverride[]): string {
  const lines = MODEL_KEYS.map((key) => {
    const own = (['once', 'always'] as const).flatMap((mode) =>
      overrides.filter((item) => item.recipe === key && item.mode === mode),
    )
    if (own.length > 0) {
      const parts = own.map((item) => `${item.model} (${item.mode === 'once' ? 'egyszeri' : 'állandó'})`)
      return `${keyLabel(key)}: ${parts.join(' · ')}`
    }
    if (key === 'translate') return 'fordítás: a config szerint'
    return `${key}: ${view.recipes[key] ?? view.draft}`
  })
  return ['A receptek modellje:', ...lines].join('\n')
}

export function modelKeyboard(): Key[][] {
  return inRows(MODEL_KEYS.map((key) => ({ text: keyLabel(key), data: `m:${key}` })), 3)
}

/** A modellek, amelyek leghosszabb gombadata is belefér a Telegram 64 bájtjába. */
export function fitsTap(key: string, model: string): boolean {
  return new TextEncoder().encode(`o:a:${key}:${model}`).length <= TAP_MAX
}

export function modelPickLine(key: string): string {
  return `Melyik modellel fusson: ${keyLabel(key)}?`
}

export function noModelLine(key: string): string {
  return `Nincs választható modell: ${keyLabel(key)}. A configban a model.switchable alá kell felvenni, sémás recepthez structured jelzéssel.`
}

export function modelPickKeyboard(key: string, models: readonly string[], reset: boolean): Key[][] {
  const rows = models.map((model) => [{ text: model, data: `p:${key}:${model}` }])
  return reset ? [...rows, [{ text: 'visszaállítás', data: `x:${key}` }]] : rows
}

export function modeLine(key: string, model: string): string {
  return `${keyLabel(key)}: ${model}. Egyszer vagy állandóan?`
}

export function modeKeyboard(key: string, model: string): Key[][] {
  return [[
    { text: 'egyszeri', data: `o:o:${key}:${model}` },
    { text: 'állandó', data: `o:a:${key}:${model}` },
  ]]
}

export function modelSetLine(key: string, model: string, mode: 'once' | 'always'): string {
  return mode === 'once'
    ? `${keyLabel(key)}: ${model}, egyszeri. A következő ${keyLabel(key)}-futás ezzel megy.`
    : `${keyLabel(key)}: ${model}, állandó, amíg vissza nem állítod.`
}

export function modelResetLine(key: string): string {
  return `${keyLabel(key)}: visszaállítva, a config szerinti modell fut.`
}
