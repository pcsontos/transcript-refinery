import { findRow } from './handle.js'
import { GITHUB_DOWN, NO_NOTES, NOTE_MISSING, OPEN_ON_GITHUB, VAULT_LOCKED } from './messages.js'
import type { JobStore } from './store.js'

export interface ReaderDeps {
  store: JobStore
  vaultRepo: string
  vaultBranch: string
  vaultToken: string
}

export const NOTE_KINDS = ['summary', 'transcript'] as const
const SUMMARY_END = '_summary.md'

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

export function vaultPath(noteUrl: string, repo: string, branch: string, kind: string): string[] | null {
  if (!(NOTE_KINDS as readonly string[]).includes(kind)) return null
  const prefix = `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/`
  if (!noteUrl.startsWith(prefix)) return null
  try {
    const segments = noteUrl.slice(prefix.length).split('/').map((segment) => decodeURIComponent(segment))
    const last = segments.pop() ?? ''
    if (!last.endsWith(SUMMARY_END)) return null
    return [...segments, `${last.slice(0, -SUMMARY_END.length)}_${kind}.md`]
  } catch {
    return null
  }
}

export async function notesPage(sub: string, deps: ReaderDeps): Promise<Response> {
  const rows = await deps.store.notesFor(sub)
  if (rows.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1><p>${NO_NOTES}</p>`)
  const items = rows.map((row) => {
    const links = NOTE_KINDS.map((kind) => `<a href="/notes/${escapeHtml(row.jobId)}/${kind}">${kind}</a>`).join(' · ')
    const day = row.acceptedAt === null ? '' : new Date(row.acceptedAt).toISOString().slice(0, 10)
    return `<li>${escapeHtml(row.title ?? row.videoId)} · ${day} — ${links}</li>`
  })
  return page('Jegyzetek', `<h1>Jegyzetek</h1><ul>${items.join('')}</ul>`)
}

export async function notePage(jobId: string, kind: string, sub: string, deps: ReaderDeps): Promise<Response> {
  const row = await findRow(deps.store, jobId)
  if (row === null || row.sub !== sub || row.noteUrl === null) return new Response(null, { status: 404 })
  const segments = vaultPath(row.noteUrl, deps.vaultRepo, deps.vaultBranch, kind)
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
