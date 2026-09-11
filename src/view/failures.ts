import type { Config } from '../config.js'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'

export interface FailureGroup {
  /** A hibaüzenet első sora: egy rendszeres hiba így egy csoport, nem húsz sor. */
  message: string
  count: number
  items: { itemId: string; title: string; kind: string }[]
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** A hibás műtermékek csoportjai: a nagyobb csoport elöl, azon belül cím szerint. */
export function groupFailures(
  items: readonly ItemRow[],
  artifacts: readonly ArtifactRow[],
): FailureGroup[] {
  const titleOf = new Map(items.map((row) => [row.itemId, row.title] as const))
  const groups = new Map<string, FailureGroup>()
  for (const artifact of artifacts) {
    if (artifact.status !== 'failed') continue
    const message = (artifact.error ?? 'ismeretlen hiba').split('\n')[0]!.trim()
    const group = groups.get(message) ?? { message, count: 0, items: [] }
    group.count++
    group.items.push({
      itemId: artifact.itemId,
      title: titleOf.get(artifact.itemId) ?? artifact.itemId,
      kind: artifact.kind,
    })
    groups.set(message, group)
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => byText(a.title, b.title) || byText(a.kind, b.kind))
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || byText(a.message, b.message))
}

export function readFailures(cfg: Pick<Config, 'statePath'>): FailureGroup[] {
  const reader = openStateReader(cfg.statePath)
  if (!reader) return []
  try {
    return groupFailures(reader.items(), reader.artifacts())
  } finally {
    reader.close()
  }
}
