import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { frontmatter, readHead } from '../serve/notes.js'
import type { StateStore } from '../state/db.js'

/** Egy jegyzet a vaultban, a frontmatteréből. */
export interface FoundNote {
  path: string
  fields: Record<string, unknown>
}

/** A vault minden `.md` fájlja `item_id`-s frontmatterrel. Ponttal kezdődő szegmens kimarad. */
export async function findNotes(vaultPath: string): Promise<FoundNote[]> {
  // ponytail: minden futás újraolvas (~0,5 s / 3500 fájl); gyorsítótár, ha a vault nagyságrenddel nő.
  const files = (await readdir(vaultPath, { recursive: true })).filter(
    (f) => f.endsWith('.md') && !f.split('/').some((segment) => segment.startsWith('.')),
  )
  const notes: FoundNote[] = []
  for (const file of files.sort()) {
    const path = join(vaultPath, file)
    try {
      const fields = frontmatter(await readHead(path))
      if (fields !== null && noteKey(fields) !== null) {
        notes.push({ path, fields })
      }
    } catch {
      // olvashatatlan fájl: kimarad
    }
  }
  return notes
}

/** `(item_id, kind)` kulcs; a `recipe` hiánya átiratot jelent. `null`, ha nincs `item_id`. */
export function noteKey(fields: Record<string, unknown>): string | null {
  const itemId = fields.item_id
  if (typeof itemId !== 'string' && typeof itemId !== 'number') return null
  const recipe = fields.recipe
  return `${String(itemId)}\u0000${typeof recipe === 'string' ? recipe : 'transcript'}`
}

export interface Tracked {
  itemId: string
  kind: string
  path: string
}

export interface RelinkReport {
  moved: (Tracked & { to: string })[]
  missing: Tracked[]
  conflicts: (Tracked & { candidates: string[] })[]
}

/** Tiszta: a tárolt utak, a talált jegyzetek és egy létezés-vizsgáló alapján. */
export function planRelink(
  tracked: Tracked[],
  found: FoundNote[],
  exists: (path: string) => boolean,
): RelinkReport {
  const byKey = new Map<string, string[]>()
  for (const note of found) {
    const key = noteKey(note.fields)
    if (key !== null) byKey.set(key, [...(byKey.get(key) ?? []), note.path])
  }
  const report: RelinkReport = { moved: [], missing: [], conflicts: [] }
  for (const t of tracked) {
    if (exists(t.path)) continue
    const candidates = byKey.get(`${t.itemId}\u0000${t.kind}`) ?? []
    if (candidates.length === 0) report.missing.push(t)
    else if (candidates.length === 1) report.moved.push({ ...t, to: candidates[0]! })
    else report.conflicts.push({ ...t, candidates })
  }
  return report
}

/** A jelentés konzolsorai; üres jelentésnél üres tömb. */
export function describeRelink(report: RelinkReport, vaultPath: string): string[] {
  const rel = (p: string): string => relative(vaultPath, p)
  return [
    ...report.moved.map((m) => `áthelyezve: ${rel(m.path)} → ${rel(m.to)}`),
    ...report.missing.map((m) => `eltűnt: ${rel(m.path)}`),
    ...report.conflicts.map(
      (c) => `ütközés: ${c.itemId} ${c.kind}: ${c.candidates.map(rel).join(', ')}`,
    ),
  ]
}

/** Bejár, összevet, és ha `apply`, a `moved` utakat átírja. A jelentés sorait adja. */
export async function relinkNotes(
  store: Pick<StateStore, 'trackedPaths'> & Partial<Pick<StateStore, 'movePath'>>,
  vaultPath: string,
  apply: boolean,
): Promise<string[]> {
  const tracked = store.trackedPaths()
  if (tracked.length === 0 || !existsSync(vaultPath)) return []
  let found: FoundNote[]
  try {
    found = await findNotes(vaultPath)
  } catch (error) {
    // A követés nem létfontosságú: egy olvashatatlan almappa ne állítsa meg a futást.
    return [`követés kihagyva: ${(error as Error).message}`]
  }
  const report = planRelink(tracked, found, existsSync)
  if (apply) for (const m of report.moved) store.movePath?.(m.itemId, m.kind, m.to)
  return describeRelink(report, vaultPath)
}
