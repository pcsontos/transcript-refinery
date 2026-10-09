import { findRow } from './handle.js'
import { GITHUB_DOWN, LANGS, NO_NOTES, NOTE_MISSING, OPEN_ON_GITHUB, RECIPES, VAULT_LOCKED } from './messages.js'
import { runKinds } from './plan.js'
import type { JobRow, JobStore, RunRow } from './store.js'

export interface ReaderDeps {
  store: JobStore
  vaultRepo: string
  vaultBranch: string
  vaultToken: string
}

const TRANSCRIPT_END = '_transcript.md'

const STYLE =
  ':root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1rem}' +
  'table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #8886;padding:.25rem .5rem;text-align:left;vertical-align:top}' +
  'img{max-width:100%}.anchor{display:none}'

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style><body>${body}</body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/** A fajta fájlja az átirat mellett: a `_transcript.md` vég cseréje. A fajtát a hívó a kész futásokból ellenőrzi. */
export function vaultPath(noteUrl: string, repo: string, branch: string, kind: string): string[] | null {
  const prefix = `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/`
  if (!noteUrl.startsWith(prefix)) return null
  try {
    const segments = noteUrl.slice(prefix.length).split('/').map((segment) => decodeURIComponent(segment))
    const last = segments.pop() ?? ''
    if (!last.endsWith(TRANSCRIPT_END)) return null
    return [...segments, `${last.slice(0, -TRANSCRIPT_END.length)}_${kind}.md`]
  } catch {
    return null
  }
}

function readyRuns(runs: readonly RunRow[]): RunRow[] {
  return runs.filter((run) => run.status === 'ready' && run.noteUrl !== null)
}

/** A receptek a gombok sorrendjében, mindegyik után a fordításai a nyelvek sorrendjében; az ismeretlen fajta a végén. */
const KIND_ORDER: readonly string[] = RECIPES.flatMap((recipe) => [recipe, ...LANGS.map((lang) => `${recipe}-${lang}`)])
const rank = (kind: string) => KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length + 1

export async function notesPage(sub: string, deps: ReaderDeps): Promise<Response> {
  const rows = await deps.store.notesFor(sub)
  if (rows.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1><p>${NO_NOTES}</p>`)
  // A sorok `accepted_at` szerint csökkenőek: egy videó első sora a legfrissebb
  // job, és egy fajta első előfordulása a legfrissebb kész változata.
  const videos = new Map<string, { latest: JobRow; jobOf: Map<string, string> }>()
  // ponytail: jobonként egy runsFor-lekérés; egy fióknál néhány tucat sor, JOIN, ha a lista lassú lesz.
  for (const row of rows) {
    let video = videos.get(row.videoId)
    if (video === undefined) {
      video = { latest: row, jobOf: new Map() }
      videos.set(row.videoId, video)
    }
    for (const kind of readyRuns(await deps.store.runsFor(row.jobId)).flatMap(runKinds)) {
      if (!video.jobOf.has(kind)) video.jobOf.set(kind, row.jobId)
    }
  }
  const items = [...videos.values()].map(({ latest, jobOf }) => {
    const links = [...[...jobOf].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)), ['transcript', latest.jobId] as const]
      .map(([kind, jobId]) => `<li><a href="/notes/${escapeHtml(jobId)}/${escapeHtml(kind)}">${escapeHtml(kind)}</a></li>`)
      .join('')
    const day = latest.acceptedAt === null ? '' : new Date(latest.acceptedAt).toISOString().slice(0, 10)
    const title = `<a href="${escapeHtml(latest.url)}">${escapeHtml(latest.title ?? latest.videoId)}</a>`
    return `<li>${title} · ${day}<ul>${links}</ul></li>`
  })
  return page('Jegyzetek', `<h1>Jegyzetek</h1><ul>${items.join('')}</ul>`)
}

export async function notePage(jobId: string, kind: string, sub: string, deps: ReaderDeps): Promise<Response> {
  const row = await findRow(deps.store, jobId)
  if (row === null || row.sub !== sub) return new Response(null, { status: 404 })
  const runs = readyRuns(await deps.store.runsFor(jobId))
  const run = kind === 'transcript' ? runs[0] : runs.find((item) => runKinds(item).includes(kind))
  if (run === undefined || run.noteUrl === null) return new Response(null, { status: 404 })
  const segments = vaultPath(run.noteUrl, deps.vaultRepo, deps.vaultBranch, kind)
  if (segments === null) return new Response(null, { status: 404 })
  const title = `${row.title ?? row.videoId} · ${kind}`
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/')
  const branch = encodeURIComponent(deps.vaultBranch)
  const url = `https://api.github.com/repos/${deps.vaultRepo}/contents/${path}?ref=${branch}`
  let line = GITHUB_DOWN
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github.html+json',
        authorization: `Bearer ${deps.vaultToken}`,
        'user-agent': 'transcript-refinery',
      },
    })
    if (response.ok) {
      const github = `https://github.com/${deps.vaultRepo}/blob/${branch}/${path}`
      const link = `<p><a href="${escapeHtml(github)}">${OPEN_ON_GITHUB}</a></p>`
      return page(title, `${link}${await response.text()}`)
    }
    if (response.status === 404) line = NOTE_MISSING
    if (response.status === 401 || response.status === 403) line = VAULT_LOCKED
  } catch {
    // Hálózati hiba: a GITHUB_DOWN marad.
  }
  return page(title, `<p>${line}</p>`, 502)
}
