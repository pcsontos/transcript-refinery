import {
  LANGS,
  NO_NOTES,
  NOTE_MISSING,
  NOTES_STALE,
  RECIPES,
  SERVE_BAD_REPLY,
  SERVE_DOWN,
  SERVE_NO_VAULT,
  SERVE_SECRET_MISMATCH,
} from './messages.js'
import { videoIdOf } from './plan.js'

export interface ReaderDeps {
  serveUrl: string
  secret: string
}

const TIMEOUT_MS = 10_000

const STYLE =
  ':root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1rem}' +
  'table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #8886;padding:.25rem .5rem;text-align:left;vertical-align:top}' +
  'img{max-width:100%}.meta,.origin{opacity:.7}' +
  '.fm{margin:.5rem 0}.fm summary{cursor:pointer;opacity:.7}.fm table{display:table;font-size:.9rem}.fm th{white-space:nowrap}.fm td{white-space:pre-wrap;word-break:break-word}'

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style><body>${body}</body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

interface ListItem {
  itemId: string
  title: string
  url: string | null
  origin: string
  generatedAt: string | null
  kinds: string[]
}

interface NoteView {
  title: string
  url: string | null
  origin: string
  generatedAt: string | null
  /** A frontmatter mezői; a régi `serve` nem küldi. */
  meta?: { key: string; value: string }[]
  html: string
}

const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string'

function isItem(value: unknown): value is ListItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.itemId === 'string' &&
    typeof item.title === 'string' &&
    nullableText(item.url) &&
    typeof item.origin === 'string' &&
    nullableText(item.generatedAt) &&
    Array.isArray(item.kinds) &&
    item.kinds.every((kind) => typeof kind === 'string')
  )
}

function isList(value: unknown): value is { stale: boolean; items: ListItem[] } {
  if (typeof value !== 'object' || value === null) return false
  const list = value as { stale?: unknown; items?: unknown }
  return typeof list.stale === 'boolean' && Array.isArray(list.items) && list.items.every(isItem)
}

function isMeta(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const field = value as Record<string, unknown>
  return typeof field.key === 'string' && typeof field.value === 'string'
}

function isView(value: unknown): value is NoteView {
  if (typeof value !== 'object' || value === null) return false
  const view = value as Record<string, unknown>
  if (view.meta !== undefined && !(Array.isArray(view.meta) && view.meta.every(isMeta))) return false
  return (
    typeof view.title === 'string' &&
    nullableText(view.url) &&
    typeof view.origin === 'string' &&
    nullableText(view.generatedAt) &&
    typeof view.html === 'string'
  )
}

/** A `serve` válasza: siker esetén a JSON-törzs (hibás JSON-nál `undefined`), különben a státusz (hálózati hibánál 0). */
async function ask(path: string, deps: ReaderDeps): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  let response: Response
  try {
    response = await fetch(`${deps.serveUrl.replace(/\/$/, '')}${path}`, {
      headers: { authorization: `Bearer ${deps.secret}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, status: 0 }
  }
  if (!response.ok) return { ok: false, status: response.status }
  try {
    const body: unknown = await response.json()
    return { ok: true, body }
  } catch {
    return { ok: true, body: undefined }
  }
}

function failure(title: string, status: number): Response {
  if (status === 404) return page(title, `<p>${NOTE_MISSING}</p>`, 404)
  const line = status === 401 ? SERVE_SECRET_MISMATCH : status === 503 ? SERVE_NO_VAULT : SERVE_DOWN
  return page(title, `<p>${line}</p>`, 502)
}

const day = (generatedAt: string | null) => (generatedAt === null ? '' : generatedAt.slice(0, 10))

/** Csak `http(s)` címből lesz link: a frontmatter `url` mezője nem kerülhet `javascript:`-tal `href`-be. */
const linkable = (url: string | null): url is string => url !== null && /^https?:\/\//.test(url)

/** A receptek a gombok sorrendjében, mindegyik után a fordításai a nyelvek sorrendjében; az ismeretlen fajta a végén. */
const KIND_ORDER: readonly string[] = RECIPES.flatMap((recipe) => [recipe, ...LANGS.map((lang) => `${recipe}-${lang}`)])
const rank = (kind: string) => KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length + 1

function ordered(kinds: readonly string[]): string[] {
  const rest = kinds.filter((kind) => kind !== 'transcript').sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return kinds.includes('transcript') ? [...rest, 'transcript'] : rest
}

export async function notesPage(deps: ReaderDeps): Promise<Response> {
  const asked = await ask('/notes', deps)
  // A listára adott 404 régi, `/notes` útvonal nélküli serve-et jelent: az elérhetetlen eset.
  if (!asked.ok) return failure('Jegyzetek', asked.status === 404 ? 0 : asked.status)
  if (!isList(asked.body)) return page('Jegyzetek', `<p>${SERVE_BAD_REPLY}</p>`, 502)
  const { stale, items } = asked.body
  const warning = stale ? `<p>${NOTES_STALE}</p>` : ''
  if (items.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1>${warning}<p>${NO_NOTES}</p>`)
  const rows = items.map((item) => {
    const id = escapeHtml(encodeURIComponent(item.itemId))
    const links = ordered(item.kinds)
      .map((kind) => `<li><a href="/notes/${id}/${escapeHtml(encodeURIComponent(kind))}">${escapeHtml(kind)}</a></li>`)
      .join('')
    const title = escapeHtml(item.title)
    const name = linkable(item.url) ? `<a href="${escapeHtml(item.url)}">${title}</a>` : title
    return `<li>${name} · ${day(item.generatedAt)} · <span class="origin">${escapeHtml(item.origin)}</span><ul>${links}</ul></li>`
  })
  return page('Jegyzetek', `<h1>Jegyzetek</h1>${warning}<ul>${rows.join('')}</ul>`)
}

/** Az `id` videó- vagy elemazonosító, vagy egy régi bot-link `jobId`-ja (`<update_id>:<videóazonosító>`). */
export async function notePage(id: string, kind: string, deps: ReaderDeps): Promise<Response> {
  const asked = await ask(`/notes/${encodeURIComponent(videoIdOf(id))}/${encodeURIComponent(kind)}`, deps)
  if (!asked.ok) return failure('Jegyzet', asked.status)
  if (!isView(asked.body)) return page('Jegyzet', `<p>${SERVE_BAD_REPLY}</p>`, 502)
  const view = asked.body
  // A cím és a YouTube-link a jegyzet saját `# cím` és `🌐 <url>` sorából látszik.
  const meta = `<p class="meta">${escapeHtml(kind)} · ${escapeHtml(view.origin)} · ${day(view.generatedAt)}</p>`
  const fields = (view.meta ?? [])
    .map((field) => `<tr><th>${escapeHtml(field.key)}</th><td>${escapeHtml(field.value)}</td></tr>`)
    .join('')
  const frontmatter = fields === '' ? '' : `<details class="fm"><summary>Frontmatter</summary><table>${fields}</table></details>`
  return page(`${view.title} · ${kind}`, `${meta}${frontmatter}${view.html}`)
}
