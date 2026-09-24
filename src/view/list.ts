import type { CellStatus, ItemListRow } from './items.js'

/** A `--status` elfogadott értékei. */
export const LIST_STATUSES: readonly CellStatus[] = ['done', 'failed', 'pending']

export interface ListFilters {
  source?: string
  channel?: string
  /** A típus, amire a `status` vonatkozik; nélküle bármely típus illik. */
  recipe?: string
  status?: CellStatus
  limit?: number
}

const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/**
 * A `list` szűrése: forrás → csatorna → állapot → limit. A forrás és a
 * csatorna a `run` szabályát követi (`matchesFilters`): pontos egyezés, kis- és
 * nagybetű nélkül; csatorna nélküli elemre a csatornaszűrő nem illik. A sorrend
 * nem változik.
 */
export function filterRows(rows: readonly ItemListRow[], filters: ListFilters): ItemListRow[] {
  const kept = rows.filter((row) => {
    if (filters.source && !same(row.source, filters.source)) return false
    if (filters.channel && (row.channel === null || !same(row.channel, filters.channel))) {
      return false
    }
    if (filters.status) {
      const cells = filters.recipe ? [row.cells[filters.recipe]] : Object.values(row.cells)
      if (!cells.some((cell) => cell?.status === filters.status)) return false
    }
    return true
  })
  return filters.limit === undefined ? kept : kept.slice(0, filters.limit)
}

/** A szűrők emberi olvasatra, a táblázat első sorához. Szűrő nélkül üres. */
export function describeFilters(filters: ListFilters): string {
  const parts: string[] = []
  if (filters.source) parts.push(`forrás: ${filters.source}`)
  if (filters.channel) parts.push(`csatorna: ${filters.channel}`)
  if (filters.recipe) parts.push(`típus: ${filters.recipe}`)
  if (filters.status) parts.push(`állapot: ${filters.status}`)
  if (filters.limit !== undefined) parts.push(`legfeljebb ${String(filters.limit)}`)
  return parts.join(', ')
}

/**
 * Rövid oszlopkód típusonként: az alaprecept első 3 karaktere, a fordítás
 * `<alapkód>-<nyelv>`. Ha két típus kódja egyezne, mindkettő a teljes azonosítót
 * kapja — a fejléc sosem lehet kétértelmű.
 */
export function kindCodes(kinds: readonly string[]): Record<string, string> {
  const known = new Set(kinds)
  const candidates = kinds.map((kind) => {
    const translation = /^(.+)-([a-z]{2})$/.exec(kind)
    if (translation && known.has(translation[1]!)) {
      return `${translation[1]!.slice(0, 3)}-${translation[2]!}`
    }
    return kind.slice(0, 3)
  })
  const codes: Record<string, string> = {}
  kinds.forEach((kind, i) => {
    const code = candidates[i]!
    codes[kind] = candidates.filter((c) => c === code).length > 1 ? kind : code
  })
  return codes
}
