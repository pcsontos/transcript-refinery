import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Config } from '../config.js'
import { frontmatter, scanNotes } from '../serve/notes.js'
import { noteCommitMessage } from '../vault/commit.js'
import {
  gitAheadCount,
  gitCommitPaths,
  gitCurrentBranch,
  gitHasChanges,
  gitLastCommitIso,
  gitPullRebase,
  gitPush,
  type PushResult,
} from '../vault/git.js'
import { FRONTMATTER } from '../vault/lint.js'
import { type Contract, escapeMdx, frontmatterError, mdxErrors, renderMdx } from './mdx.js'
import { type SiteLanguage, variantOf } from './variant.js'

/** Az LLM-es átalakító (#278): a vault-törzsből `.mdx`-törzs. A frontmattert nem írja. */
export type Transform = (input: {
  fields: Record<string, unknown>
  body: string
  language: SiteLanguage
  contract: Contract
}) => Promise<string>

export interface DeployReport {
  /** A `content/notes`-hoz képest: `<tétel>/<fajta>.<nyelv>.mdx`. */
  written: string[]
  skipped: { path: string; reason: string }[]
  commits: number
  push: PushResult | null
}

const NOTES_DIR = 'content/notes'

const stamp = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw cause
  }
}

/** Egy vault-fájl egy kiküldendő nyelvi változata. */
interface Candidate {
  path: string
  target: string
  language: SiteLanguage
  fields: Record<string, unknown>
  body: string
  original: boolean
}

/**
 * A vault jegyzeteit a showroom szerződése szerinti `.mdx`-ként a showroom
 * külön klónjába írja, tételenként commitol, a végén pushol. Csak hozzáad és
 * frissít. `itemIds`: csak ezek a tételek (az `auto` út); nélküle a teljes vault.
 */
export async function deployNotes(input: {
  cfg: Config
  itemIds?: ReadonlySet<string>
  transform?: Transform
}): Promise<DeployReport> {
  const { cfg, itemIds, transform } = input
  if (cfg.showroom === null) throw new Error('A deploy ki van kapcsolva: nincs showroom: blokk a configban.')
  const clone = cfg.showroom.clonePath

  const branch = await gitCurrentBranch(clone)
  if (branch !== 'main') throw new Error(`showroom.clone_path: a klón nem a main ágon áll (${branch})`)

  const report: DeployReport = { written: [], skipped: [], commits: 0, push: null }

  // Rebase, nem fast-forward: egy elutasított push commitjai különben a közben előrelépett
  // távoli main mellett örökre beragadnának.
  await gitPullRebase(clone)
  // Egy félbeszakadt futás kiírt, de nem commitolt fájljait az összevetés változatlannak látná.
  if (await gitHasChanges(clone, [NOTES_DIR])) {
    if (await gitCommitPaths(clone, [NOTES_DIR], noteCommitMessage('deploy', 'félbemaradt futás maradéka', '-'))) {
      report.commits += 1
    }
  }
  const contract = JSON.parse(await readFile(join(clone, 'contract', 'mdx-components.json'), 'utf8')) as Contract

  const check = async (target: string, fields: Record<string, unknown>, text: string) =>
    frontmatterError(target, fields) ?? (await mdxErrors(text, contract))[0] ?? null

  for (const [itemId, item] of await scanNotes(cfg.notesRoot)) {
    if (itemIds !== undefined && !itemIds.has(itemId)) continue

    const notes = new Map<string, { path: string; fields: Record<string, unknown>; body: string }>()
    for (const [kind, file] of item.files) {
      if (kind === 'transcript') continue
      const text = await readFile(file.path, 'utf8')
      const fields = frontmatter(text)
      if (fields !== null) notes.set(kind, { path: file.path, fields, body: text.replace(FRONTMATTER, '').trimStart() })
    }
    const siblings = new Map([...notes].map(([kind, n]) => [kind, n.fields]))

    const candidates = new Map<string, Candidate>()
    for (const [kind, n] of notes) {
      const committedAt = /^glossary-/.test(kind) ? await gitLastCommitIso(cfg.vaultPath, n.path) : null
      const v = variantOf(itemId, { vaultKind: kind, fields: n.fields }, siblings, committedAt)
      if (!v.ok) {
        report.skipped.push({ path: n.path, reason: v.reason })
        continue
      }
      const next: Candidate = {
        path: n.path,
        target: v.target,
        language: v.language,
        fields: v.fields,
        body: n.body,
        original: n.fields.translation_of === undefined,
      }
      const taken = candidates.get(v.target)
      if (taken === undefined || (next.original && !taken.original)) {
        candidates.set(v.target, next)
        if (taken !== undefined) report.skipped.push({ path: taken.path, reason: `ütközik: ${v.target}` })
      } else {
        report.skipped.push({ path: next.path, reason: `ütközik: ${v.target}` })
      }
    }

    const written: string[] = []
    const ordered = [...candidates.values()].sort((a, b) => Number(b.original) - Number(a.original) || a.target.localeCompare(b.target))
    for (const c of ordered) {
      const abs = join(clone, NOTES_DIR, c.target)
      const existing = await readOptional(abs)
      const old = existing === null ? null : frontmatter(existing)
      const changed =
        old === null ||
        stamp(old.generated_at) !== c.fields.generated_at ||
        (old.mdx_fallback === true && transform !== undefined)
      if (!changed) continue

      let text: string | null = null
      if (transform !== undefined) {
        try {
          const candidate = renderMdx(c.fields, await transform({ fields: c.fields, body: c.body, language: c.language, contract }))
          const error = await check(c.target, c.fields, candidate)
          if (error === null) text = candidate
          else report.skipped.push({ path: c.path, reason: `LLM-kimenet elvetve: ${error}` })
        } catch (e) {
          report.skipped.push({ path: c.path, reason: `LLM-kimenet elvetve: ${(e as Error).message.split('\n')[0]}` })
        }
      }
      if (text === null) {
        const fields = { ...c.fields, mdx_fallback: true }
        const candidate = renderMdx(fields, escapeMdx(c.body))
        const error = await check(c.target, fields, candidate)
        if (error !== null) {
          report.skipped.push({ path: c.path, reason: error })
          continue
        }
        text = candidate
      }
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, text, 'utf8')
      written.push(c.target)
    }

    const first = ordered.find((c) => c.original) ?? ordered[0]
    if (first === undefined) continue
    const title = String(first.fields.title)
    const metaPath = join(clone, NOTES_DIR, itemId, 'meta.json')
    const meta = `${JSON.stringify({ title }, null, 2)}\n`
    const currentMeta = await readOptional(metaPath)
    const paths = written.map((t) => `${NOTES_DIR}/${t}`)
    // meta.json csak akkor jön létre, ha a tételből ténylegesen íródott fájl
    if (currentMeta !== meta && (written.length > 0 || currentMeta !== null)) {
      await mkdir(dirname(metaPath), { recursive: true })
      await writeFile(metaPath, meta, 'utf8')
      paths.push(`${NOTES_DIR}/${itemId}/meta.json`)
    }
    if (paths.length === 0) continue
    report.written.push(...written)
    if (await gitCommitPaths(clone, paths, noteCommitMessage('deploy', title, itemId))) report.commits += 1
  }

  // Egy korábbi, elutasított push commitjai is ide tartoznak.
  if (report.commits > 0 || (await gitAheadCount(clone)) > 0) report.push = await gitPush(clone)
  return report
}

/** A jelentés terminálsorai (CLI és serve-napló közös): összesítő, kihagyások, push. */
export function deployLines(report: DeployReport): string[] {
  const lines = [
    `deploy: ${report.written.length} írva, ${report.skipped.length} kihagyva, ${report.commits} commit`,
    ...[...report.skipped]
      .sort((a, b) => a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path))
      .map((s) => `  kihagyva: ${basename(s.path)} — ${s.reason}`),
  ]
  if (report.push !== null) {
    lines.push(report.push.pushed ? 'deploy: push ok' : `deploy: push sikertelen: ${(report.push.reason ?? '').split('\n')[0]}`)
  }
  return lines
}
