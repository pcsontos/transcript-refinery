import { byText, type CellStatus, type ItemCell, type ItemListRow } from './items.js'

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
 * A fordítási típus alapja (`summary-hu` → `summary`): a `-<nyelv>` utótagú
 * típus, amelynek az alapja is a típusok között van. Más típusra `null`.
 */
export function translationBase(kind: string, kinds: readonly string[]): string | null {
  const translation = /^(.+)-([a-z]{2})$/.exec(kind)
  return translation && kinds.includes(translation[1]!) ? translation[1]! : null
}

/** Egy alaprecept kódja: kötőjelenként az első három karakter (`clean-moderate` → `cle-mod`). */
const baseCode = (kind: string): string =>
  kind
    .split('-')
    .map((part) => part.slice(0, 3))
    .join('-')

/**
 * Rövid oszlopkód típusonként: az alaprecept kötőjellel tagolt részeinek első
 * 3-3 karaktere, a fordítás `<alapkód>-<nyelv>`. Ha két típus kódja egyezne,
 * mindkettő a teljes azonosítót kapja — a fejléc sosem lehet kétértelmű.
 */
export function kindCodes(kinds: readonly string[]): Record<string, string> {
  const candidates = kinds.map((kind) => {
    const base = translationBase(kind, kinds)
    return base === null ? baseCode(kind) : `${baseCode(base)}${kind.slice(base.length)}`
  })
  const codes: Record<string, string> = {}
  kinds.forEach((kind, i) => {
    const code = candidates[i]!
    codes[kind] = candidates.filter((c) => c === code).length > 1 ? kind : code
  })
  return codes
}

/** Látható szélesség: kódpontok száma. A széles (CJK, emoji) karaktert nem kezeli. */
const widthOf = (text: string): number => [...text].length

function truncate(text: string, max: number): string {
  return widthOf(text) <= max ? text : `${[...text].slice(0, max - 1).join('')}…`
}

type Align = 'left' | 'right'

interface Column {
  header: string
  cells: string[]
  align: Align
}

function pad(text: string, width: number, align: Align): string {
  const fill = ' '.repeat(Math.max(0, width - widthOf(text)))
  return align === 'left' ? text + fill : fill + text
}

/** Oszlopok egy szóközzel elválasztva; a sorvégi szóközöket levágja. */
function layout(columns: readonly Column[]): string[] {
  const widths = columns.map((c) => Math.max(widthOf(c.header), ...c.cells.map(widthOf)))
  const rowCount = columns[0]?.cells.length ?? 0
  const line = (pick: (c: Column) => string): string =>
    columns
      .map((c, i) => pad(pick(c), widths[i]!, c.align))
      .join(' ')
      .trimEnd()
  const lines = [line((c) => c.header)]
  for (let r = 0; r < rowCount; r++) lines.push(line((c) => c.cells[r]!))
  return lines
}

const usd = (value: number): string => value.toFixed(4)

function mark(cell: ItemCell | undefined): string {
  if (cell?.status === 'failed') return '✗'
  if (cell?.status === 'done') return cell.belowThreshold ? '↓' : '✓'
  return '·'
}

function statusText(cell: ItemCell | undefined): string {
  if (cell?.status === 'failed') return 'hibás'
  if (cell?.status === 'done') return cell.belowThreshold ? 'kész ↓' : 'kész'
  return 'hátra'
}

/** Az elem összköltsége; `null`, ha egyik cellájának sincs költsége. */
export function rowCost(row: ItemListRow): number | null {
  const costs = Object.values(row.cells)
    .map((cell) => cell.costUsd)
    .filter((cost): cost is number => cost !== null)
  return costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0)
}

function codeLegend(kinds: readonly string[]): string | null {
  const codes = kindCodes(kinds)
  const pairs = kinds.filter((k) => codes[k] !== k).map((k) => `${codes[k]!} = ${k}`)
  return pairs.length === 0 ? null : pairs.join(', ')
}

const CHANNEL_WIDTH = 16
/** Az összesítőben több hely jut a névnek: ott ez az egyetlen szöveges oszlop. */
const SUMMARY_CHANNEL_WIDTH = 24
/** A cím szélessége, ha nincs terminál (csővezeték, fájl). */
export const PIPE_TITLE_WIDTH = 40
const MIN_TITLE_WIDTH = 20
const LEGEND = '✓ kész  ↓ küszöb alatt  ✗ hibás  · hátra  † a felirat eltűnt'

export interface ItemTableOptions {
  /** Ha meg van adva, a jeloszlopok helyett ennek a típusnak a részletei. */
  recipe?: string
  showChannel: boolean
  /** A terminál szélessége; `undefined`, ha nincs terminál. */
  lineWidth?: number
  /** A `describeFilters` kimenete. */
  filterNote: string
}

/** Az elemlista: első sor, táblázat, jelmagyarázat. Legalább egy sort vár. */
export function renderItemTable(
  rows: readonly ItemListRow[],
  kinds: readonly string[],
  opts: ItemTableOptions,
): string {
  const columns: Column[] = [
    { header: '#', cells: rows.map((_, i) => String(i + 1)), align: 'right' },
  ]
  if (opts.showChannel) {
    columns.push({
      header: 'Csatorna',
      cells: rows.map((row) => (row.channel === null ? '—' : truncate(row.channel, CHANNEL_WIDTH))),
      align: 'left',
    })
  }
  if (opts.recipe !== undefined) {
    const recipe = opts.recipe
    columns.push(
      { header: recipe, cells: rows.map((row) => statusText(row.cells[recipe])), align: 'left' },
      {
        header: 'Pont',
        cells: rows.map((row) => row.cells[recipe]?.score?.toFixed(2) ?? '—'),
        align: 'right',
      },
      {
        header: '$',
        cells: rows.map((row) => {
          const cost = row.cells[recipe]?.costUsd ?? null
          return cost === null ? '—' : usd(cost)
        }),
        align: 'right',
      },
    )
  } else {
    const codes = kindCodes(kinds)
    for (const kind of kinds) {
      columns.push({ header: codes[kind]!, cells: rows.map((row) => mark(row.cells[kind])), align: 'left' })
    }
    columns.push({
      header: '$',
      cells: rows.map((row) => {
        const cost = rowCost(row)
        return cost === null ? '—' : usd(cost)
      }),
      align: 'right',
    })
  }

  // A cím a második oszlop; a szélessége a többi oszlop után megmaradó hely,
  // egy karakter tartalékkal, hogy a sor a terminál szélén se törjön.
  const others = columns.reduce(
    (sum, c) => sum + Math.max(widthOf(c.header), ...c.cells.map(widthOf)) + 1,
    0,
  )
  const titleWidth =
    opts.lineWidth === undefined
      ? PIPE_TITLE_WIDTH
      : Math.max(MIN_TITLE_WIDTH, opts.lineWidth - others - 1)
  columns.splice(1, 0, {
    header: 'Cím',
    cells: rows.map((row) => truncate(row.discovered ? row.title : `† ${row.title}`, titleWidth)),
    align: 'left',
  })

  const head = `${String(rows.length)} elem${opts.filterNote ? ` (${opts.filterNote})` : ''}`
  const lines = [head, '', ...layout(columns), '']
  if (opts.recipe === undefined) {
    lines.push(LEGEND)
    const legend = codeLegend(kinds)
    if (legend !== null) lines.push(legend)
  } else if (rows.some((row) => !row.discovered)) {
    lines.push('† a felirat eltűnt')
  }
  return lines.join('\n')
}

export interface ChannelSummary {
  /** `null`: a csatorna nélküli elemek csoportja. */
  channel: string | null
  videos: number
  /** Típusonként a kész (`done`, a küszöb alattiakkal együtt) elemek száma. */
  done: Record<string, number>
  /** A csoport összköltsége; `null`, ha egyik cellának sincs költsége. */
  costUsd: number | null
}

const addCost = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b

/**
 * Csatornánkénti összesítés a már szűrt sorokból: név szerint (`byText`), a
 * csatorna nélküli csoport a végén.
 */
export function summarizeChannels(
  rows: readonly ItemListRow[],
  kinds: readonly string[],
): ChannelSummary[] {
  const groups = new Map<string | null, ChannelSummary>()
  for (const row of rows) {
    let group = groups.get(row.channel)
    if (!group) {
      group = {
        channel: row.channel,
        videos: 0,
        done: Object.fromEntries(kinds.map((k) => [k, 0])),
        costUsd: null,
      }
      groups.set(row.channel, group)
    }
    group.videos++
    for (const kind of kinds) {
      if (row.cells[kind]?.status === 'done') group.done[kind]!++
    }
    group.costUsd = addCost(group.costUsd, rowCost(row))
  }
  return [...groups.values()].sort((a, b) =>
    a.channel === null ? 1 : b.channel === null ? -1 : byText(a.channel, b.channel),
  )
}

/** A csatorna-összesítő: első sor, táblázat `Összesen` sorral, kódmagyarázat. */
export function renderChannelTable(
  summaries: readonly ChannelSummary[],
  kinds: readonly string[],
  filterNote: string,
): string {
  const total: ChannelSummary = {
    channel: 'Összesen',
    videos: summaries.reduce((sum, s) => sum + s.videos, 0),
    done: Object.fromEntries(
      kinds.map((k) => [k, summaries.reduce((sum, s) => sum + (s.done[k] ?? 0), 0)]),
    ),
    costUsd: summaries.reduce<number | null>((sum, s) => addCost(sum, s.costUsd), null),
  }
  const all = [...summaries, total]
  const codes = kindCodes(kinds)
  const columns: Column[] = [
    {
      header: 'Csatorna',
      cells: all.map((s) => truncate(s.channel ?? '(nincs csatorna)', SUMMARY_CHANNEL_WIDTH)),
      align: 'left',
    },
    { header: 'Videó', cells: all.map((s) => String(s.videos)), align: 'right' },
    ...kinds.map(
      (kind): Column => ({
        header: codes[kind]!,
        cells: all.map((s) => `${String(s.done[kind] ?? 0)}/${String(s.videos)}`),
        align: 'right',
      }),
    ),
    {
      header: '$',
      cells: all.map((s) => (s.costUsd === null ? '—' : usd(s.costUsd))),
      align: 'right',
    },
  ]
  const head = `${String(summaries.length)} csatorna${filterNote ? ` (${filterNote})` : ''}`
  const lines = [head, '', ...layout(columns)]
  const legend = codeLegend(kinds)
  if (legend !== null) lines.push('', legend)
  return lines.join('\n')
}
