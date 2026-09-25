import type { Config } from '../config.js'
import { ARTIFACT_KIND } from '../pipeline.js'
import { recipesFor, type Registry } from '../recipe/registry.js'
import { isPidAlive, type RunStatus } from '../run/status.js'
import { discoverAll } from '../source/folder.js'
import type { ItemRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'
import type { SourceItem } from '../types.js'
import { buildItemRows, byText, type ItemListRow } from './items.js'
import { rowCost, translationBase } from './list.js'
import { artifactKinds } from './overview.js'
import { readRuns, type RunSummaryView } from './runs.js'

/** A halmozott költségsáv közös sorozata a fordítási típusoknak. */
export const TRANSLATION_SERIES = 'fordítás'

/**
 * A tisztított leirat szintjeinek közös sorozata. Külön sorozatként a
 * grafikon 8 alaprecept + fordítás színt kérne, a paletta plafonja 8.
 */
export const CLEAN_SERIES = 'clean'

const CLEAN_LEVEL_KINDS: ReadonlySet<string> = new Set(['clean-mild', 'clean-moderate', 'clean-deep'])

/** A toplisták hossza. */
export const TOP_LIMIT = 10

/** Egy költséggel járó futás a futásonkénti grafikonon. */
export interface RunCostPoint {
  runId: string
  startedAt: string | null
  command: string | null
  status: RunStatus
  spentUsd: number
  estimateUsd: number | null
}

/** Egy típus lefedettsége egy csatornán. */
export interface CoverageCell {
  done: number
  failed: number
  total: number
  /** A hiányzók pótló parancsa; `null`, ha nincs mit pótolni vagy nincs csatorna. */
  command: string | null
}

/** Egy csatorna minden adata a riportoldalhoz. */
export interface ChannelReport {
  /** `null`: a metaadat nélküli elemek csoportja. */
  channel: string | null
  videos: number
  /** A normalizált szavak összege az átiratolt elemeken. */
  words: number
  transcribed: number
  /** Nyelvkód → db, csökkenő sorrendben. */
  languages: { code: string; count: number }[]
  captions: { creator: number; auto: number }
  /** A vault-tartalom költsége; `null`, ha egyik cellának sincs költsége. */
  costUsd: number | null
  /** Sorozatonként (alapreceptek, a `CLEAN_SERIES` és a `TRANSLATION_SERIES`) a költség. */
  costBySeries: Record<string, number>
  /** Fordítási típusonként a költség, a tooltiphez. */
  translationCost: Record<string, number>
  /** Fizetős típusonként. */
  coverage: Record<string, CoverageCell>
  quality: { scored: number; below: number; meanScore: number | null }
}

/** Egy elem egy toplistán. */
export interface ItemRank {
  itemId: string
  title: string
  channel: string | null
  value: number
}

export interface Reports {
  hasState: boolean
  kpis: {
    videos: number
    channels: number
    words: number
    transcribed: number
    /** A futásnaplók `item:refined` költéseinek összege. */
    spentUsd: number
    /** Az állapottár fizetős celláinak költsége. */
    vaultCostUsd: number
    /** Kész fizetős cella rögzített költség nélkül. */
    missingCost: number
  }
  /** Csak a költséggel járó futások, időrendben. */
  runs: RunCostPoint[]
  invalidLogLines: number
  /** A halmozott sáv sorozatai, rögzített sorrendben. */
  series: string[]
  /** A fizetős típusok, az `artifactKinds()` sorrendjében, az átirat nélkül. */
  kinds: string[]
  channels: ChannelReport[]
  topCost: ItemRank[]
  topLong: ItemRank[]
}

export interface ReportsInput {
  hasState: boolean
  /** A felderített elemek: a nyelvkód elsődleges forrása. */
  discovered: readonly SourceItem[]
  rows: readonly ItemListRow[]
  /** Az állapottár elemsorai: szószám, nyelv. */
  items: readonly ItemRow[]
  runs: readonly RunSummaryView[]
  registry: Registry
}

/** POSIX egyszeres idézőjel: a szöveg a shellben betű szerint marad. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** A (csatorna, típus) pár hiányzóit pótló parancs. */
export function runCommandFor(kind: string, channel: string): string {
  return `refinery run --recipe ${kind} --channel ${shellQuote(channel)}`
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

/** Csökkenő érték szerint, azonos értéknél cím szerint, az első `TOP_LIMIT`. */
function top(ranks: ItemRank[]): ItemRank[] {
  return ranks
    .sort((a, b) => b.value - a.value || byText(a.title, b.title))
    .slice(0, TOP_LIMIT)
}

/**
 * A riportoldal nézetmodellje. Tiszta függvény: a cellák a `buildItemRows()`
 * soraiból jönnek, így a számok az elemlistáéval és a `refinery list`-ével
 * azonosak. Rögzítetlen (`null`) költség sehol sem számít nullának.
 */
export function buildReports(input: ReportsInput): Reports {
  const kinds = artifactKinds(input.registry).filter((kind) => kind !== ARTIFACT_KIND)
  const seriesOf = (kind: string): string =>
    translationBase(kind, kinds) !== null
      ? TRANSLATION_SERIES
      : CLEAN_LEVEL_KINDS.has(kind)
        ? CLEAN_SERIES
        : kind
  const series = [...new Set(kinds.map(seriesOf))]
  const translations = kinds.filter((kind) => seriesOf(kind) === TRANSLATION_SERIES)

  const itemOf = new Map(input.items.map((item) => [item.itemId, item] as const))
  const languageOf = new Map(input.discovered.map((item) => [item.itemId, item.language] as const))

  const groups = new Map<string | null, ItemListRow[]>()
  for (const row of input.rows) {
    const list = groups.get(row.channel) ?? []
    list.push(row)
    groups.set(row.channel, list)
  }

  const channels: ChannelReport[] = [...groups.entries()].map(([channel, rows]) => {
    let words = 0
    let transcribed = 0
    const languages = new Map<string, number>()
    const captions = { creator: 0, auto: 0 }
    let costUsd: number | null = null
    const costBySeries = Object.fromEntries(series.map((s) => [s, 0]))
    const translationCost = Object.fromEntries(translations.map((k) => [k, 0]))
    const coverage: Record<string, CoverageCell> = {}
    const scores: number[] = []
    let below = 0

    for (const row of rows) {
      const item = itemOf.get(row.itemId)
      if (item?.wordsNormalized != null) {
        words += item.wordsNormalized
        transcribed++
      }
      const language = languageOf.get(row.itemId) ?? item?.language ?? null
      if (language !== null) languages.set(language, (languages.get(language) ?? 0) + 1)
      if (row.captionSource !== null) captions[row.captionSource]++
    }

    for (const kind of kinds) {
      const cells = rows.map((row) => row.cells[kind])
      const done = cells.filter((cell) => cell?.status === 'done').length
      coverage[kind] = {
        done,
        failed: cells.filter((cell) => cell?.status === 'failed').length,
        total: rows.length,
        command: channel === null || done === rows.length ? null : runCommandFor(kind, channel),
      }
      for (const cell of cells) {
        if (cell?.costUsd != null) {
          costUsd = (costUsd ?? 0) + cell.costUsd
          costBySeries[seriesOf(kind)]! += cell.costUsd
          if (kind in translationCost) translationCost[kind]! += cell.costUsd
        }
        if (cell?.status === 'done' && cell.score !== null) {
          scores.push(cell.score)
          if (cell.belowThreshold) below++
        }
      }
    }

    return {
      channel,
      videos: rows.length,
      words,
      transcribed,
      languages: [...languages.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || byText(a.code, b.code)),
      captions,
      costUsd,
      costBySeries,
      translationCost,
      coverage,
      quality: {
        scored: scores.length,
        below,
        meanScore: scores.length === 0 ? null : sum(scores) / scores.length,
      },
    }
  })
  channels.sort((a, b) =>
    a.channel === null
      ? 1
      : b.channel === null
        ? -1
        : b.videos - a.videos || byText(a.channel, b.channel),
  )

  const paidCells = input.rows.flatMap((row) => kinds.map((kind) => row.cells[kind]))
  const costs = paidCells.flatMap((cell) => (cell?.costUsd != null ? [cell.costUsd] : []))

  const topCost = top(
    input.rows.flatMap((row) => {
      const cost = rowCost(row)
      return cost === null
        ? []
        : [{ itemId: row.itemId, title: row.title, channel: row.channel, value: cost }]
    }),
  )
  const topLong = top(
    input.rows.flatMap((row) => {
      const words = itemOf.get(row.itemId)?.wordsNormalized ?? null
      return words === null
        ? []
        : [{ itemId: row.itemId, title: row.title, channel: row.channel, value: words }]
    }),
  )

  const runs = input.runs
    .filter((run) => run.spentUsd > 0)
    .map(
      (run): RunCostPoint => ({
        runId: run.runId,
        startedAt: run.startedAt,
        command: run.command,
        status: run.status,
        spentUsd: run.spentUsd,
        estimateUsd: run.estimate?.usd ?? null,
      }),
    )
    .sort((a, b) =>
      a.startedAt === null
        ? 1
        : b.startedAt === null
          ? -1
          : byText(a.startedAt, b.startedAt),
    )

  return {
    hasState: input.hasState,
    kpis: {
      videos: input.discovered.length,
      channels: channels.filter((c) => c.channel !== null).length,
      words: sum(channels.map((c) => c.words)),
      transcribed: sum(channels.map((c) => c.transcribed)),
      spentUsd: sum(input.runs.map((run) => run.spentUsd)),
      vaultCostUsd: sum(costs),
      missingCost: paidCells.filter((cell) => cell?.status === 'done' && cell.costUsd === null)
        .length,
    },
    runs,
    invalidLogLines: sum(input.runs.map((run) => run.invalid)),
    series,
    kinds,
    channels,
    topCost,
    topLong,
  }
}

/**
 * A riport beolvasása: felderítés, állapottár és futásnaplók. Állapottár
 * nélkül minden cella „hátra", a szószám nulla.
 */
export async function readReports(
  cfg: Pick<
    Config,
    'sources' | 'languages' | 'statePath' | 'translate' | 'configPath' | 'logsDir'
  >,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<Reports> {
  const registry = recipesFor(cfg)
  const discovered = await discoverAll(cfg.sources, cfg.languages)
  const reader = openStateReader(cfg.statePath)
  try {
    const items = reader?.items() ?? []
    return buildReports({
      hasState: reader !== null,
      discovered,
      rows: buildItemRows(discovered, items, reader?.artifacts() ?? [], registry),
      items,
      runs: await readRuns(cfg, isAlive),
      registry,
    })
  } finally {
    reader?.close()
  }
}
