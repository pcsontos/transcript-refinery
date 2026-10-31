import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Config } from '../config.js'
import { frontmatter, scanNotes } from '../serve/notes.js'
import { noteCommitMessage } from '../vault/commit.js'
import {
  gitAheadCount,
  gitCommitPaths,
  gitCurrentBranch,
  gitFetch,
  gitHasChanges,
  gitLastCommitIso,
  gitLocalChanges,
  gitPullRebase,
  gitPush,
  gitShowOptional,
  type PushResult,
} from '../vault/git.js'
import { FRONTMATTER } from '../vault/lint.js'
import { cardsMdx } from './cards.js'
import type { Transform, TransformUsage } from './llm.js'
import { type Contract, escapeMdx, frontmatterError, mdxErrors, renderMdx } from './mdx.js'
import { type SiteLanguage, siteKindOf, variantOf } from './variant.js'

export type Route = 'llm' | 'cards' | 'plain'
export type DeployAction = 'new' | 'update' | 'retry' | 'regenerate'

export interface DeployReport {
  /** A `content/notes`-hoz képest: `<tétel>/<fajta>.<nyelv>.mdx`. */
  written: string[]
  skipped: { path: string; reason: string; target?: string }[]
  commits: number
  push: PushResult | null
  /** Az LLM-es átalakítás használata; `null`, ha nem volt átalakító. */
  transform: TransformUsage | null
  /** Amit írásra kiválasztott, sorrendben. */
  planned: { target: string; action: DeployAction; route: Route }[]
  /** Az illeszkedő, nem írandó jelöltek száma. */
  unchanged: number
  /** A pull utáni pusholatlan commitok és a maradék-commit; ezek a szűrőtől függetlenül kimennek. */
  pendingCommits: number
  /** Szűrt futás, amelyre egyetlen jegyzet sem illett; a klónhoz nem nyúlt. */
  noMatch?: true
}

const LLM_KINDS = ['clean-mild', 'clean-moderate', 'clean-deep', 'summary', 'notes'] as const
const CARD_KINDS = ['flashcards', 'qa', 'bloom'] as const
/** A site-oldal ismert fajtái (a `--kind` nevei, a rövid `clean` nélkül). */
export const SITE_KINDS = [...LLM_KINDS, ...CARD_KINDS, 'glossary'] as const

/** A kézi deploy szűrői; `items`: az id-k, `kinds`: site-fajták vagy a rövid `clean`. */
export interface DeployFilter {
  items?: readonly string[]
  kinds?: readonly string[]
  channel?: string
  source?: string
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

/** Az oldal útja: LLM-es tagolás, kódos kártyabontás vagy a determinisztikus (végleges) escape. */
function routeOf(siteKind: string): Route {
  if ((LLM_KINDS as readonly string[]).includes(siteKind)) return 'llm'
  if ((CARD_KINDS as readonly string[]).includes(siteKind)) return 'cards'
  return 'plain'
}

/** Az „írná-e” döntés; az éles futás és a szárazfutás közös kódja. */
function decide(
  old: Record<string, unknown> | null,
  generatedAt: unknown,
  route: Route,
  o: { force: boolean; retryFailed: boolean; hasTransform: boolean },
): DeployAction | 'unchanged' | 'failed' {
  if (old === null) return 'new'
  if (stamp(old.generated_at) !== generatedAt) return 'update'
  if (old.mdx_fallback === true && (route !== 'llm' || o.hasTransform)) {
    if (stamp(old.mdx_failed) !== generatedAt) return 'update'
    return o.retryFailed || o.force ? 'retry' : 'failed'
  }
  // Átalakító nélkül nincs mivel újragenerálni; a kint lévő végleges oldal marad (a szárazfutás is ezt lássa).
  if (route === 'llm' && !o.hasTransform) return 'unchanged'
  return o.force ? 'regenerate' : 'unchanged'
}

/** Egy vault-fájl egy kiküldendő nyelvi változata. */
interface Candidate {
  path: string
  target: string
  siteKind: string
  language: SiteLanguage
  fields: Record<string, unknown>
  body: string
  original: boolean
}

/**
 * A vault jegyzeteit a showroom szerződése szerinti `.mdx`-ként a showroom
 * külön klónjába írja, tételenként commitol, a végén pushol. Csak hozzáad és
 * frissít. `itemIds`: csak ezek a tételek (az `auto` út); nélküle a teljes vault.
 * `retryFailed`: a korábban elbukott (`mdx_failed`) átalakítást is újra megpróbálja.
 */
export async function deployNotes(input: {
  cfg: Config
  itemIds?: ReadonlySet<string>
  transform?: Transform
  retryFailed?: boolean
  filter?: DeployFilter
  dryRun?: boolean
}): Promise<DeployReport> {
  const { cfg, itemIds, transform, retryFailed = false, filter, dryRun = false } = input
  if (cfg.showroom === null) throw new Error('A deploy ki van kapcsolva: nincs showroom: blokk a configban.')
  const clone = cfg.showroom.clonePath

  const kinds = filter?.kinds
  const unknownKinds = (kinds ?? []).filter((k) => k !== 'clean' && !(SITE_KINDS as readonly string[]).includes(k))
  if (unknownKinds.length > 0) {
    throw new Error(`--kind: ismeretlen fajta: ${unknownKinds.join(', ')}. Ismert: clean, ${SITE_KINDS.join(', ')}`)
  }
  const kindMatches = (siteKind: string) =>
    kinds === undefined || kinds.includes(siteKind) || (kinds.includes('clean') && siteKind.startsWith('clean-'))
  const same = (field: unknown, wanted: string | undefined) =>
    wanted === undefined || (typeof field === 'string' && field.toLocaleLowerCase() === wanted.toLocaleLowerCase())

  // Vault-fázis: a klón érintése előtt dől el, mely tételek és jegyzetek jönnek szóba.
  const vaultItems = await scanNotes(cfg.notesRoot)
  const unknownItems = (filter?.items ?? []).filter((id) => !vaultItems.has(id))
  if (unknownItems.length > 0) throw new Error(`--item: nincs ilyen tétel a vaultban: ${unknownItems.join(', ')}`)
  const selected = new Map<string, Map<string, { path: string; fields: Record<string, unknown>; body: string }>>()
  for (const [itemId, item] of vaultItems) {
    if (itemIds !== undefined && !itemIds.has(itemId)) continue
    if (filter?.items !== undefined && !filter.items.includes(itemId)) continue
    const notes = new Map<string, { path: string; fields: Record<string, unknown>; body: string }>()
    for (const [kind, file] of item.files) {
      if (kind === 'transcript') continue
      const text = await readFile(file.path, 'utf8')
      const fields = frontmatter(text)
      if (fields !== null) notes.set(kind, { path: file.path, fields, body: text.replace(FRONTMATTER, '').trimStart() })
    }
    const all = [...notes.values()]
    if (!all.some((n) => same(n.fields.channel, filter?.channel)) || !all.some((n) => same(n.fields.source, filter?.source))) continue
    selected.set(itemId, notes)
  }
  if (
    filter !== undefined &&
    ![...selected.values()].some((notes) => [...notes].some(([kind, n]) => kindMatches(siteKindOf(kind, n.fields))))
  ) {
    return { written: [], skipped: [], commits: 0, push: null, transform: null, planned: [], unchanged: 0, pendingCommits: 0, noMatch: true }
  }

  const branch = await gitCurrentBranch(clone)
  if (branch !== 'main') throw new Error(`showroom.clone_path: a klón nem a main ágon áll (${branch})`)

  const report: DeployReport = { written: [], skipped: [], commits: 0, push: null, transform: null, planned: [], unchanged: 0, pendingCommits: 0 }

  // Az oldal jelenlegi tartalma az összevetéshez. Élesben a munkafa a pull után; szárazfutásban
  // a távoli main, rajta a helyi eltérésekkel (épp a `pull --rebase --autostash` utáni állapot).
  let read = (target: string) => readOptional(join(clone, NOTES_DIR, target))
  let contract: Contract
  if (dryRun) {
    await gitFetch(clone)
    const local = await gitLocalChanges(clone, [NOTES_DIR])
    read = (target) => {
      const path = `${NOTES_DIR}/${target}`
      return local.has(path) ? readOptional(join(clone, path)) : gitShowOptional(clone, '@{u}', path)
    }
    report.pendingCommits = (await gitAheadCount(clone)) + ((await gitHasChanges(clone, [NOTES_DIR])) ? 1 : 0)
    contract = { components: {} } // szárazfutásban nincs átalakítás, a szerződés nem kell
  } else {
    // Rebase, nem fast-forward: egy elutasított push commitjai különben a közben előrelépett
    // távoli main mellett örökre beragadnának.
    await gitPullRebase(clone)
    report.pendingCommits = await gitAheadCount(clone)
    // Egy félbeszakadt futás kiírt, de nem commitolt fájljait az összevetés változatlannak látná.
    if (await gitHasChanges(clone, [NOTES_DIR])) {
      if (await gitCommitPaths(clone, [NOTES_DIR], noteCommitMessage('deploy', 'félbemaradt futás maradéka', '-'))) {
        report.commits += 1
        report.pendingCommits += 1
      }
    }
    contract = JSON.parse(await readFile(join(clone, 'contract', 'mdx-components.json'), 'utf8')) as Contract
  }

  const check = async (target: string, fields: Record<string, unknown>, text: string) =>
    frontmatterError(target, fields) ?? (await mdxErrors(text, contract))[0] ?? null

  /** Az oldal törzse az útja szerint; `{}`: nincs átalakító (fallback), `failed`: az ok, `budget`: a plafon miatt kimaradt. */
  const convert = async (
    c: Candidate,
    route: Route,
  ): Promise<{ body: string } | { failed?: string } | 'budget'> => {
    if (route === 'plain') return { body: escapeMdx(c.body) }
    if (route === 'cards') {
      const body = cardsMdx(c.body, c.siteKind as 'flashcards' | 'qa' | 'bloom')
      return body === null ? { failed: 'a kártyák nem bonthatók' } : { body }
    }
    if (transform === undefined) return {}
    try {
      const result = await transform.run({ siteKind: c.siteKind, body: c.body, language: c.language, contract })
      if (result.kind === 'budget') return 'budget'
      return result.kind === 'final' ? { body: result.body } : { failed: `LLM-kimenet elvetve: ${result.reason}` }
    } catch (e) {
      return { failed: `LLM-kimenet elvetve: ${(e as Error).message.split('\n')[0]}` }
    }
  }

  for (const [itemId, notes] of selected) {
    const siblings = new Map([...notes].map(([kind, n]) => [kind, n.fields]))

    const candidates = new Map<string, Candidate>()
    for (const [kind, n] of notes) {
      const committedAt = /^glossary-/.test(kind) ? await gitLastCommitIso(cfg.vaultPath, n.path) : null
      const v = variantOf(itemId, { vaultKind: kind, fields: n.fields }, siblings, committedAt)
      if (!v.ok) {
        if (kindMatches(siteKindOf(kind, n.fields))) report.skipped.push({ path: n.path, reason: v.reason })
        continue
      }
      const next: Candidate = {
        path: n.path,
        target: v.target,
        siteKind: v.siteKind,
        language: v.language,
        fields: v.fields,
        body: n.body,
        original: n.fields.translation_of === undefined,
      }
      const taken = candidates.get(v.target)
      if (taken === undefined || (next.original && !taken.original)) {
        candidates.set(v.target, next)
        if (taken !== undefined && kindMatches(v.siteKind)) report.skipped.push({ path: taken.path, reason: `ütközik: ${v.target}` })
      } else if (kindMatches(v.siteKind)) {
        report.skipped.push({ path: next.path, reason: `ütközik: ${v.target}` })
      }
    }

    const written: string[] = []
    const ordered = [...candidates.values()].sort((a, b) => Number(b.original) - Number(a.original) || a.target.localeCompare(b.target))
    for (const c of ordered.filter((o) => kindMatches(o.siteKind))) {
      const abs = join(clone, NOTES_DIR, c.target)
      const existing = await read(c.target)
      const old = existing === null ? null : frontmatter(existing)
      const route = routeOf(c.siteKind)
      const action = decide(old, c.fields.generated_at, route, { force: filter?.items !== undefined, retryFailed, hasTransform: transform !== undefined })
      if (action === 'failed') {
        report.skipped.push({ path: c.path, target: c.target, reason: 'mdx_failed (--retry-failed nélkül)' })
        continue
      }
      if (action === 'unchanged') {
        report.unchanged += 1
        continue
      }
      report.planned.push({ target: c.target, action, route })
      if (dryRun) continue

      const converted = await convert(c, route)
      if (converted === 'budget') {
        // a kint lévő oldal marad; az új a determinisztikus változatot kapja, `mdx_failed` nélkül
        if (old !== null && stamp(old.generated_at) === c.fields.generated_at) continue
      }
      let text: string | null = null
      let failed: string | null = null
      if (typeof converted === 'object' && 'body' in converted) {
        const candidate = renderMdx(c.fields, converted.body)
        const error = await check(c.target, c.fields, candidate)
        if (error === null) text = candidate
        else if (route === 'plain') {
          report.skipped.push({ path: c.path, reason: error })
          continue
        } else failed = route === 'llm' ? `LLM-kimenet elvetve: ${error}` : error
      } else if (typeof converted === 'object') failed = converted.failed ?? null
      // A kint lévő, végleges oldalt az elbukott újragenerálás nem cserélheti fallbackre.
      const keep = action === 'regenerate' && old !== null && old.mdx_fallback !== true
      if (keep && text === null) {
        report.skipped.push({ path: c.path, reason: `${failed ?? 'nincs átalakító'}; a kint lévő oldal marad` })
        continue
      }
      if (failed !== null) report.skipped.push({ path: c.path, reason: failed })
      if (text === null) {
        const fields = { ...c.fields, mdx_fallback: true, ...(failed !== null ? { mdx_failed: c.fields.generated_at } : {}) }
        const candidate = renderMdx(fields, escapeMdx(c.body))
        const error = await check(c.target, fields, candidate)
        if (error !== null) {
          report.skipped.push({ path: c.path, reason: error })
          continue
        }
        text = candidate
      }
      if (text === existing) continue
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, text, 'utf8')
      written.push(c.target)
    }

    if (dryRun) continue

    // Cím nélküli jelölt nem írhat `{"title":"undefined"}`-ot; ilyenből úgysem íródik fájl.
    const titled = ordered.filter((c) => typeof c.fields.title === 'string' && c.fields.title !== '')
    const first = titled.find((c) => c.original) ?? titled[0]
    if (first === undefined) continue
    const title = first.fields.title as string
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

  if (dryRun) return report
  report.transform = transform?.usage() ?? null
  // Egy korábbi, elutasított push commitjai is ide tartoznak.
  if (report.commits > 0 || (await gitAheadCount(clone)) > 0) report.push = await gitPush(clone)
  return report
}

/** A jelentés terminálsorai (CLI és serve-napló közös): összesítő, kihagyások, push. */
export function deployLines(report: DeployReport): string[] {
  if (report.noMatch === true) return ['deploy: Nincs a szűrőnek megfelelő jegyzet.']
  const lines = [
    `deploy: ${report.written.length} írva, ${report.skipped.length} kihagyva, ${report.commits} commit`,
    ...(report.pendingCommits > 0 ? [`deploy: korábbi futás függő munkája is kimegy: ${report.pendingCommits} commit`] : []),
    ...[...report.skipped]
      .sort((a, b) => a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path))
      .map((s) => `  kihagyva: ${basename(s.path)} — ${s.reason}`),
  ]
  if (report.transform !== null) {
    const { inputTokens, outputTokens, usd, budgetSkipped } = report.transform
    lines.push(
      `deploy: átalakítás: ${inputTokens}+${outputTokens} token, ${usd.toFixed(4)} $` +
        (budgetSkipped > 0 ? `, ${budgetSkipped} oldal kimaradt a költségplafon miatt` : ''),
    )
  }
  if (report.push?.pushed === true) lines.push('deploy: push ok')
  else if (report.push !== null) {
    // Az első sor mindig „Command failed: git push”; az ok a git kimenetében van.
    const [first = '', ...rest] = (report.push.reason ?? '').split('\n').filter((l) => l.trim() !== '')
    lines.push(`deploy: push sikertelen: ${first}`, ...rest.map((l) => `  ${l.trim()}`))
  }
  return lines
}

/** A jelentés első sora: a szűrés és a modell; `null`, ha éles futásban egyik sincs. */
export function deployHeader(filter: DeployFilter, opts: { dryRun: boolean; model?: string }): string | null {
  const parts = [
    filter.items && `tétel: ${filter.items.join(', ')}`,
    filter.kinds && `fajta: ${filter.kinds.join(', ')}`,
    filter.channel && `csatorna: ${filter.channel}`,
    filter.source && `forrás: ${filter.source}`,
  ].filter((p): p is string => p !== undefined && p !== '')
  const segments = [
    parts.length > 0 ? `szűrés: ${parts.join('; ')}` : opts.dryRun ? 'szűrés nélkül' : null,
    opts.model === undefined ? null : `modell: ${opts.model}`,
  ].filter((p): p is string => p !== null)
  if (segments.length === 0) return null
  return `${opts.dryRun ? 'deploy (szárazfutás)' : 'deploy'}: ${segments.join(' · ')}`
}

const ACTION_LABEL: Record<DeployAction, string> = { new: 'új', update: 'frissítés', retry: 'frissítés', regenerate: 'újragenerálás' }

/** A szárazfutás sorai; `hasTransform`: van-e LLM-átalakító. */
export function dryRunLines(report: DeployReport, hasTransform: boolean): string[] {
  if (report.noMatch === true) return deployLines(report)
  const routeText = (route: Route) => (route === 'cards' ? 'kód' : route === 'plain' ? 'escape' : hasTransform ? 'LLM' : 'fallback, nincs átalakító')
  const rows = [
    ...report.planned.map((p) => [
      ACTION_LABEL[p.action],
      p.target,
      routeText(p.route) + (p.action === 'retry' ? ' (mdx_failed, újrapróbálva)' : ''),
    ]),
    ...[...report.skipped]
      .sort((a, b) => a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path))
      .map((s) => ['kihagyva', s.target ?? basename(s.path), s.reason]),
  ] as [string, string, string][]
  const w1 = Math.max(0, ...rows.map((r) => r[0].length))
  const w2 = Math.max(0, ...rows.map((r) => r[1].length))
  const k = report.skipped.length
  const modelCalls = report.planned.filter((p) => p.route === 'llm' && hasTransform).length
  return [
    ...rows.map(([a, b, c]) => `  ${a.padEnd(w1)}  ${b.padEnd(w2)}  ${c}`),
    ...(report.pendingCommits > 0
      ? [`deploy (szárazfutás): korábbi futás függő munkája is kimegy: ${report.pendingCommits} commit`]
      : []),
    report.planned.length === 0
      ? `deploy (szárazfutás): nincs mit írni; ${k} kihagyva, ${report.unchanged} változatlan`
      : `deploy (szárazfutás): ${report.planned.length} oldalt írna, ebből ${modelCalls} oldalhoz hívna modellt; ${k} kihagyva, ${report.unchanged} változatlan`,
  ]
}
