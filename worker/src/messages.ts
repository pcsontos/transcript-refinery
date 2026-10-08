export const REJECTED_SECRET = 'A konténer elutasította a hívást.'

export const PLAYLIST_LINE = 'Lejátszási lista későbbre marad.'
export const NOT_YOUTUBE_LINE = 'Nem YouTube-cím.'
export const NO_VIDEO_LINE = 'Nincs YouTube-videó az üzenetben.'

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

export function readyLine(title: string): string {
  return `${flatTitle(title)}. A felirat megvan.`
}

export function alreadyLine(videoId: string): string {
  return `Már sorban van: ${videoId}.`
}

export const MISSING_NOTE_URL = 'A jegyzet linkje hiányzik.'

export function noteReadyMessage(title: string, noteUrl: string): string {
  return `${flatTitle(title)}. A jegyzet megvan.\n${noteUrl}`
}

export function summaryButton(jobId: string): { text: 'summary'; data: string } {
  return { text: 'summary', data: `summary:${jobId}` }
}

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
export const VAULT_LOCKED = 'A vault nem olvasható.'
export const GITHUB_DOWN = 'A GitHub nem érhető el.'
export const OPEN_ON_GITHUB = 'Megnyitás a GitHubon'

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

export function langKeyboard(mask: number, jobId: string): Key[][] {
  return inRows(
    LANGS.map((lang) => ({ text: lang, data: `l:${mask.toString(16)}:${lang}:${jobId}` })),
    4,
  )
}

export const PICK_LINE = 'Melyik jegyzetet fordítsam?'
export const LANG_LINE = 'Melyik nyelvre?'
export const NOTHING_TO_TRANSLATE = 'Előbb készíts egy jegyzetet.'

export function runQueuedLine(recipes: readonly string[], lang: string | null): string {
  return `Sorba került: ${recipes.join(', ')}${lang === null ? '' : ` → ${lang}`}`
}
