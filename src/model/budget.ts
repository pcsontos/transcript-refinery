import type { ModelConfig } from '../config.js'
import type { ModelRole } from '../types.js'
import type { ModelUsage } from './client.js'
import { TOKENS_PER_WORD, costOf } from './pricing.js'

/**
 * A generált jegyzet hossza a bemenet töredéke. Egy összefoglaló nagyjából a
 * normalizált átirat tizede — ez felső becslés, tehát a kapu inkább
 * óvatosabb, mint megengedőbb.
 */
const OUTPUT_RATIO = 0.1

/** A rubrika modell-bíró kritériumainak száma (hűség és lefedettség). */
const JUDGE_CRITERIA = 2

/**
 * Egy elem becsült költsége dollárban.
 *
 * A `maxIterations` javítási kört jelent, tehát a generálások száma
 * `maxIterations + 1`. Minden generálás után lefut a rubrika, ami
 * kritériumonként egy bíró-hívást jelent; a bíró bemenete az átirat és a
 * vázlat együtt.
 */
export function estimateItemUsd(
  words: number,
  maxIterations: number,
  cfg: ModelConfig,
): number {
  const transcriptTokens = words * TOKENS_PER_WORD
  const outputTokens = transcriptTokens * OUTPUT_RATIO
  const generations = maxIterations + 1

  const draft = costOf(
    {
      inputTokens: transcriptTokens * generations,
      outputTokens: outputTokens * generations,
    },
    cfg.pricing.draft,
  )

  const judgeCalls = generations * JUDGE_CRITERIA
  const judge = costOf(
    {
      inputTokens: (transcriptTokens + outputTokens) * judgeCalls,
      // A bíró strukturált ítéletet ad: pontszám és néhány mondatnyi hiány.
      outputTokens: 200 * judgeCalls,
    },
    cfg.pricing.judge,
  )

  return draft + judge
}

/** A köteg becsült költsége és becsült összes tokene. */
export function estimateRunUsd(
  wordCounts: readonly number[],
  maxIterations: number,
  cfg: ModelConfig,
): { usd: number; tokens: number } {
  let usd = 0
  let tokens = 0
  for (const words of wordCounts) {
    usd += estimateItemUsd(words, maxIterations, cfg)
    tokens += Math.round(
      words * TOKENS_PER_WORD * (maxIterations + 1) * (1 + JUDGE_CRITERIA),
    )
  }
  return { usd, tokens }
}

export interface BudgetEntry<T> {
  value: T
  /** A normalizált átirat szószáma — ebből jön a becslés. */
  words: number
}

export interface BudgetSlice<T> {
  /** Ezek indulnak ebben a futásban. */
  planned: T[]
  /** Ezek maradnak a következőre, mert nem fértek a plafon alá. */
  deferred: T[]
  usd: number
  tokens: number
}

/**
 * A köteg vágása a plafonig.
 *
 * A tiltás helyett szeletelünk: egy 153 elemes korpusz becsült költsége
 * sokszorosa lehet a futásonkénti plafonnak, és ilyenkor a helyes válasz nem
 * az, hogy a köteg indíthatatlan, hanem az, hogy annyi megy át, amennyi
 * belefér — a maradékot az állapottár tartja számon.
 */
export function sliceToBudget<T>(
  entries: readonly BudgetEntry<T>[],
  maxIterations: number,
  cfg: ModelConfig,
): BudgetSlice<T> {
  const planned: T[] = []
  const deferred: T[] = []
  let usd = 0
  let tokens = 0
  let full = false

  for (const entry of entries) {
    if (full) {
      deferred.push(entry.value)
      continue
    }
    const itemUsd = estimateItemUsd(entry.words, maxIterations, cfg)
    if (usd + itemUsd > cfg.costLimitUsd) {
      full = true
      deferred.push(entry.value)
      continue
    }
    usd += itemUsd
    tokens += estimateRunUsd([entry.words], maxIterations, cfg).tokens
    planned.push(entry.value)
  }

  return { planned, deferred, usd, tokens }
}

export interface CostGuard {
  add(role: ModelRole, usage: ModelUsage, cfg: ModelConfig): void
  spentUsd(): number
  exceeded(): boolean
}

/**
 * A futás közbeni lágy kapu. A **tényleges** használati adatokból összegez,
 * nem a becslésből — a becslés tévedhet, ezért kell a második réteg
 * (`decisions/0004`).
 */
export function createCostGuard(limitUsd: number): CostGuard {
  let spent = 0
  return {
    add(role, usage, cfg) {
      spent += costOf(usage, cfg.pricing[role])
    },
    spentUsd: () => spent,
    exceeded: () => spent > limitUsd,
  }
}
