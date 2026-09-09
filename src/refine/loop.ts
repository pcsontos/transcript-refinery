import type { ModelClient, ModelResult, ModelUsage } from '../model/client.js'
import type { Recipe, RecipeInput } from '../recipe/types.js'
import { scoreRubric } from '../rubric/types.js'

export interface RefineOptions {
  /** Felülbírálja a recept saját korlátját. Nulla = nincs javító kör. */
  maxIterations?: number
}

export interface RefineResult {
  /** A megtartott — tehát a legjobb pontszámú — kimenet. */
  output: string
  score: number
  gaps: string[]
  /** Hány generálás történt összesen. Egy = nem volt javító kör. */
  generations: number
  /** A loop teljes token-felhasználása, generálás és pontozás együtt. */
  usage: ModelUsage
}

/**
 * Az evaluator–optimizer loop: generálás → pontozás → javítás, korlátosan.
 *
 * Minden kör pontszáma számít: ebből válik számmal megválaszolhatóvá az a
 * kérdés, amit a legtöbb hasonló projekt meg sem kérdez — **segít-e
 * egyáltalán a második iteráció, és mennyiért?**
 */
export async function refine(
  recipe: Recipe,
  input: RecipeInput,
  client: ModelClient,
  opts: RefineOptions = {},
): Promise<RefineResult> {
  const maxIterations = opts.maxIterations ?? recipe.maxIterations
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: ModelUsage): void => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }

  /**
   * A generálás egyetlen elágazása: strukturált receptnél sémás hívás és
   * renderelés, egyébként a prózaút. Mindkét ág **stringet** ad vissza, ezért
   * innentől a loop többi része nem tud a különbségről.
   */
  const generate = (prompt: string): Promise<ModelResult<string>> =>
    recipe.structured
      ? recipe.structured.generate(client, recipe.role, prompt)
      : client.generate(recipe.role, prompt)

  const first = await generate(recipe.prompt(input))
  add(first.usage)

  const firstScore = await scoreRubric(
    recipe.rubric,
    { transcript: input.transcript, output: first.value },
    client,
  )
  add(firstScore.usage)

  let best = { output: first.value, score: firstScore.value, gaps: firstScore.gaps }
  let generations = 1

  while (best.score < recipe.rubric.passThreshold && generations <= maxIterations) {
    const next = await generate(
      recipe.repairPrompt({ ...input, previous: best.output, gaps: best.gaps }),
    )
    add(next.usage)
    generations++

    const scored = await scoreRubric(
      recipe.rubric,
      { transcript: input.transcript, output: next.value },
      client,
    )
    add(scored.usage)

    // Nem-javulási őr. Az azonos pontszám is megállás: ha egy újabb kör nem
    // hozott előrelépést, a következő sem fog, és a loop csak költene.
    if (scored.value <= best.score) break

    best = { output: next.value, score: scored.value, gaps: scored.gaps }
  }

  return { ...best, generations, usage }
}
