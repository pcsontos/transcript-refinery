import { tokenize } from '../normalize/tokens.js'
import type { Criterion, Score } from './types.js'

/** A kimenet és a forrás szószintű viszonya. */
export interface FidelityMetrics {
  /** Kimeneti szószám / forrás-szószám. */
  ratio: number
  /** A forrás tokenjeinek ekkora része látszik a kimenetben (multihalmaz-metszet). */
  coverage: number
}

/** A hűségkapu küszöbei; a `clean` szintjei mind mást kapnak. */
export interface FidelityThresholds {
  minWordRatio: number
  minCoverage: number
  /** `cleanup`: szó szerinti tisztítás; `edit`: írott formára szerkesztés. A hiányüzenet szövegét választja. */
  task: 'cleanup' | 'edit'
}

/**
 * A szó szerinti tisztítás eredeti küszöbei. **Becsült, nem mért** értékek; a
 * `clean`-szintek a saját, kalibrált küszöbüket kapják (`recipe/clean.ts`).
 */
export const DEFAULT_FIDELITY: FidelityThresholds = {
  minWordRatio: 0.85,
  minCoverage: 0.8,
  task: 'cleanup',
}

/**
 * A lefedettséget multihalmaz-metszettel számoljuk, nem sorrendtartóan: egy 30
 * ezer tokenes kimeneten az LCS nagyságrendileg milliárd művelet lenne,
 * kapuként futtathatatlan — a sorrendet amúgy is az illesztő monotonitása őrzi.
 */
export function fidelityMetrics(output: string, transcript: string): FidelityMetrics {
  const source = tokenize(transcript)
  if (source.length === 0) return { ratio: 1, coverage: 1 }
  const result = tokenize(output)

  const counts = new Map<string, number>()
  for (const word of result) counts.set(word, (counts.get(word) ?? 0) + 1)
  let matched = 0
  for (const word of source) {
    const left = counts.get(word) ?? 0
    if (left > 0) {
      counts.set(word, left - 1)
      matched++
    }
  }
  return { ratio: result.length / source.length, coverage: matched / source.length }
}

/**
 * Determinisztikus szöveghűség-ellenőrzés: nulla token.
 *
 * Azt a hibamódot fogja meg, ami a tisztított leiratnál a legvalószínűbb:
 * hogy a modell **összefoglal, ahelyett hogy tisztítana** (vagy szerkesztene).
 * A hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFidelity(
  output: string,
  transcript: string,
  thresholds: FidelityThresholds = DEFAULT_FIDELITY,
): Score {
  const { ratio, coverage } = fidelityMetrics(output, transcript)
  const gaps: string[] = []
  const edit = thresholds.task === 'edit'

  if (ratio < thresholds.minWordRatio) {
    gaps.push(
      edit
        ? `The output is ${ratio.toFixed(2)}× the length of the transcript. This is an edit, ` +
            `not a summary: keep every point, example and claim the speaker makes.`
        : `The output is ${ratio.toFixed(2)}× the length of the transcript. This is a ` +
            `cleanup task, not a summary: keep every sentence, and only fix punctuation, ` +
            `capitalisation and obvious mishearings.`,
    )
  }
  if (coverage < thresholds.minCoverage) {
    gaps.push(
      edit
        ? `The output only covers ${coverage.toFixed(2)} of the transcript's words. Edit ` +
            `the speech, do not drop passages or replace them with your own.`
        : `The output only covers ${coverage.toFixed(2)} of the transcript's words. Do not ` +
            `drop or rewrite passages: reproduce the speech, cleaned up.`,
    )
  }
  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium adott küszöbökkel: bukása esetén a bíró-hívás el sem indul. */
export function fidelityCriterionFor(thresholds: FidelityThresholds): Criterion {
  return {
    name: 'fidelity',
    blocking: true,
    score: (ctx) => Promise.resolve(checkFidelity(ctx.output, ctx.transcript, thresholds)),
  }
}

/** Az alapküszöbű kapu. */
export const fidelityCriterion: Criterion = fidelityCriterionFor(DEFAULT_FIDELITY)
