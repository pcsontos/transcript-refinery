import type { ModelClient, ModelUsage } from '../model/client.js'

export interface Score {
  /** 0 és 1 közötti pontszám. */
  value: number
  /**
   * Konkrét, megnevezett hiányok. **Egy szám nem tud javítást vezérelni** —
   * ez a lista megy vissza a javító promptba.
   */
  gaps: string[]
  /** A kritérium modellhívásainak felhasználása; determinisztikusnál hiányzik. */
  usage?: ModelUsage
}

export interface ScoreContext {
  /** A normalizált átirat: a viszonyítási alap minden kritériumnál. */
  transcript: string
  /** A modell által generált jegyzettörzs. */
  output: string
  /** Kurált kulcspont-lista, ha van. A lefedettség ezt tekinti mérvadónak. */
  keyPoints?: string[]
}

export interface Criterion {
  name: string
  /**
   * Kapu, nem pontozott összetevő. Ha nem éri el az 1,0-t, a többi kritérium
   * el sem indul. A determinisztikus formátum-ellenőrzés helye — ez szűri ki
   * a hibák jelentős részét, mielőtt bármi drága elindulna.
   */
  blocking?: boolean
  score(ctx: ScoreContext, client: ModelClient): Promise<Score>
}

export interface Rubric {
  criteria: Criterion[]
  /** E fölött a kimenet elfogadott, és a loop megáll. */
  passThreshold: number
}

export interface RubricResult {
  value: number
  gaps: string[]
  usage: ModelUsage
}

/**
 * Lefuttatja a rubrikát. Előbb a kapuk, aztán a pontozott kritériumok — így
 * egy formátumhibás kimenet nulla bíró-hívásba kerül.
 */
export async function scoreRubric(
  rubric: Rubric,
  ctx: ScoreContext,
  client: ModelClient,
): Promise<RubricResult> {
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: ModelUsage | undefined): void => {
    if (!u) return
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }

  for (const criterion of rubric.criteria.filter((c) => c.blocking)) {
    const score = await criterion.score(ctx, client)
    add(score.usage)
    if (score.value < 1) {
      return { value: score.value, gaps: score.gaps, usage }
    }
  }

  const scored = rubric.criteria.filter((c) => !c.blocking)
  if (scored.length === 0) return { value: 1, gaps: [], usage }

  let total = 0
  const gaps: string[] = []
  for (const criterion of scored) {
    const score = await criterion.score(ctx, client)
    add(score.usage)
    total += score.value
    gaps.push(...score.gaps)
  }

  return { value: total / scored.length, gaps, usage }
}
