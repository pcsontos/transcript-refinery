import { tokenize } from '../normalize/tokens.js'
import type { Criterion, Score } from './types.js'

/**
 * A kimenet nem lehet lényegesen rövidebb a forrásnál: az enyhe szerkesztés
 * keveset vesz el. **Becsült küszöb, nem mért** — a kalibrálás külön kör.
 */
const MIN_WORD_RATIO = 0.85

/** A forrás tokenjeinek ekkora részét vissza kell látnunk a kimenetben. */
const MIN_COVERAGE = 0.8

/**
 * Determinisztikus szöveghűség-ellenőrzés: nulla token.
 *
 * Azt a hibamódot fogja meg, ami a tisztított leiratnál a legvalószínűbb:
 * hogy a modell **összefoglal, ahelyett hogy tisztítana**. A lefedettséget
 * multihalmaz-metszettel számoljuk, nem sorrendtartóan: egy 30 ezer tokenes
 * kimeneten az LCS nagyságrendileg milliárd művelet lenne, kapuként
 * futtathatatlan — a sorrendet amúgy is az illesztő monotonitása őrzi.
 *
 * A hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFidelity(output: string, transcript: string): Score {
  const source = tokenize(transcript)
  const result = tokenize(output)
  if (source.length === 0) return { value: 1, gaps: [] }

  const gaps: string[] = []

  const ratio = result.length / source.length
  if (ratio < MIN_WORD_RATIO) {
    gaps.push(
      `The output is ${ratio.toFixed(2)}× the length of the transcript. This is a ` +
        `cleanup task, not a summary: keep every sentence, and only fix punctuation, ` +
        `capitalisation and obvious mishearings.`,
    )
  }

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
  const coverage = matched / source.length
  if (coverage < MIN_COVERAGE) {
    gaps.push(
      `The output only covers ${coverage.toFixed(2)} of the transcript's words. Do not ` +
        `drop or rewrite passages: reproduce the speech, cleaned up.`,
    )
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívás el sem indul. */
export const fidelityCriterion: Criterion = {
  name: 'fidelity',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFidelity(ctx.output, ctx.transcript)),
}
