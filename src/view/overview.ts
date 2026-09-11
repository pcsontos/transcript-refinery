import type { Config } from '../config.js'
import { ARTIFACT_KIND } from '../pipeline.js'
import { queuePath, readQueueFile } from '../queue/file.js'
import { checkedPairs, parseQueue } from '../queue/parse.js'
import { RECIPES, RECIPE_IDS } from '../recipe/registry.js'
import type { KindCorpus } from '../run/report.js'
import { isPidAlive } from '../run/status.js'
import { discoverAll } from '../source/folder.js'
import type { CorpusStatus, SourceStatus } from '../state/db.js'
import type { ArtifactRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'
import type { SourceItem } from '../types.js'
import { readRuns, type RunSummaryView } from './runs.js'

/** A műtermék-típusok a felület sorrendjében: az átirat, majd a registry receptjei. */
export function artifactKinds(): string[] {
  return [ARTIFACT_KIND, ...RECIPE_IDS]
}

/**
 * A korpusz állapota állapotfájl nélkül: minden felderített elem hátra van. Az
 * alakja pontosan az, amit a `corpusStatus` adna egy üres állapottáron.
 */
export function emptyCorpusStatus(items: readonly SourceItem[]): CorpusStatus {
  const bySource = new Map<string, SourceStatus>()
  for (const item of items) {
    const entry = bySource.get(item.source) ?? {
      source: item.source,
      total: 0,
      done: 0,
      failed: 0,
      pending: 0,
    }
    entry.total++
    entry.pending++
    bySource.set(item.source, entry)
  }
  return {
    bySource: [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source)),
    byCaptionSource: { creator: 0, auto: 0 },
    done: 0,
    failed: 0,
    pending: items.length,
    totalCostUsd: 0,
  }
}

/** Egy recept pontszámainak eloszlása. */
export interface ScoreDistribution {
  recipe: string
  /** A recept rubrikájának küszöbe. */
  threshold: number
  /** Tíz sáv: [0; 0,1), [0,1; 0,2), …, [0,9; 1]. */
  buckets: number[]
  /** A pontszámmal rögzített kész jegyzetek száma. */
  scored: number
  belowThreshold: number
}

export function scoreDistribution(
  recipe: string,
  artifacts: readonly ArtifactRow[],
): ScoreDistribution {
  const threshold = RECIPES[recipe]?.rubric.passThreshold ?? 0
  const buckets = Array.from({ length: 10 }, () => 0)
  let scored = 0
  let belowThreshold = 0
  for (const artifact of artifacts) {
    if (artifact.kind !== recipe || artifact.status !== 'done' || artifact.score === null) continue
    scored++
    const index = Math.min(9, Math.floor(artifact.score * 10))
    buckets[index] = (buckets[index] ?? 0) + 1
    if (artifact.score < threshold) belowThreshold++
  }
  return { recipe, threshold, buckets, scored, belowThreshold }
}

/** A feldolgozási sor állapota egy receptre. */
export interface QueueRecipeOverview {
  recipe: string
  checked: number
  done: number
  failed: number
  pending: number
}

/**
 * A kipipált párok állapota receptenként, az állapottár szerint.
 * Registry-sorrendben; a registryben nem szereplő receptek kimaradnak.
 */
export function queueOverview(
  queueText: string,
  artifacts: readonly ArtifactRow[],
): QueueRecipeOverview[] {
  const statusOf = new Map(
    artifacts.map((a) => [JSON.stringify([a.itemId, a.kind]), a.status] as const),
  )
  const rows = new Map<string, QueueRecipeOverview>()
  for (const pair of checkedPairs(parseQueue(queueText))) {
    const row = rows.get(pair.recipeId) ?? {
      recipe: pair.recipeId,
      checked: 0,
      done: 0,
      failed: 0,
      pending: 0,
    }
    row.checked++
    const status = statusOf.get(JSON.stringify([pair.itemId, pair.recipeId]))
    if (status === 'done') row.done++
    else if (status === 'failed') row.failed++
    else row.pending++
    rows.set(pair.recipeId, row)
  }
  return RECIPE_IDS.flatMap((recipe) => {
    const row = rows.get(recipe)
    return row ? [row] : []
  })
}

/** Az áttekintő oldal adatai. */
export interface Overview {
  /** Van-e már állapotfájl. */
  hasState: boolean
  /** A felderített elemek száma. */
  discovered: number
  /** Típusonként a korpusz állapota, az `artifactKinds()` sorrendjében. */
  corpus: KindCorpus[]
  scores: ScoreDistribution[]
  totalCostUsd: number
  /** `null`, ha nincs feldolgozási sor. */
  queue: QueueRecipeOverview[] | null
  /** A most futó futások. */
  running: RunSummaryView[]
}

export interface OverviewInput {
  hasState: boolean
  discovered: number
  corpus: KindCorpus[]
  artifacts: readonly ArtifactRow[]
  queueText: string | null
  runs: readonly RunSummaryView[]
}

export function buildOverview(input: OverviewInput): Overview {
  return {
    hasState: input.hasState,
    discovered: input.discovered,
    corpus: input.corpus,
    scores: RECIPE_IDS.map((recipe) => scoreDistribution(recipe, input.artifacts)),
    totalCostUsd: input.artifacts.reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
    queue: input.queueText === null ? null : queueOverview(input.queueText, input.artifacts),
    running: input.runs.filter((run) => run.status === 'running'),
  }
}

/**
 * Az áttekintő beolvasása: felderítés, állapottár, feldolgozási sor és
 * futásnaplók. A korpusz-állapot ugyanabból a lekérdezésből jön, amiből a futás
 * riportja — a két szám ezért nem térhet el.
 */
export async function readOverview(
  cfg: Pick<Config, 'sources' | 'languages' | 'statePath' | 'notesRoot' | 'logsDir'>,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<Overview> {
  const discovered = await discoverAll(cfg.sources, cfg.languages)
  const reader = openStateReader(cfg.statePath)
  try {
    const corpus = artifactKinds().map((kind) => ({
      kind,
      status: reader ? reader.corpusStatus(discovered, kind) : emptyCorpusStatus(discovered),
    }))
    return buildOverview({
      hasState: reader !== null,
      discovered: discovered.length,
      corpus,
      artifacts: reader ? reader.artifacts() : [],
      queueText: await readQueueFile(queuePath(cfg.notesRoot)),
      runs: await readRuns(cfg, isAlive),
    })
  } finally {
    reader?.close()
  }
}
