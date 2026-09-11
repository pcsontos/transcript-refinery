import type { ModelClient, ModelResult, ModelUsage } from '../model/client.js'
import type { Recipe, RecipeInput } from '../recipe/types.js'
import { scoreRubric } from '../rubric/types.js'

export interface RefineOptions {
  /** Felülbírálja a recept saját korlátját. Nulla = nincs javító kör. */
  maxIterations?: number
  /**
   * Hamisra állítva a loop minden kört lefuttat: sem a küszöb átlépése, sem a
   * nem-javulási őr nem szakítja meg. Kizárólag a mérés használja — a
   * produkciós út alapértelmezése változatlanul `true`.
   */
  stopEarly?: boolean
  /** Minden generálás előtt, egytől számozva. Az élő követés ebből látja, hol tart a loop. */
  onGenerate?: (generation: number) => void
  /** Minden pontozás után: a pontszám és a megnevezett hiányok száma. */
  onScore?: (score: number, gaps: number) => void
}

/**
 * Egy generálási kör mérőszámai. **Számokat visz, szöveget nem**: a `gaps` a
 * hiányok száma, nem a listája. Így a nyomvonalon keresztül nem juthat
 * vault-tartalom a mérési adatba vagy a publikált riportba.
 */
export interface RoundTrace {
  score: number
  gaps: number
  /**
   * A generálás felhasználása, a **recept szerepén**. Szándékosan külön a
   * pontozásétól: a két szerep ára nagyságrenddel eltérhet, és összevonva
   * már nem lenne visszabontható, melyik token melyik modellé.
   */
  generateUsage: ModelUsage
  /** A pontozás felhasználása, a **bíró szerepén**. */
  scoreUsage: ModelUsage
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
  /** Körönkénti mérőszámok, generálásonként egy bejegyzés. */
  rounds: RoundTrace[]
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
  const stopEarly = opts.stopEarly ?? true
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: ModelUsage): void => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }
  const rounds: RoundTrace[] = []

  /**
   * A generálás egyetlen elágazása: strukturált receptnél sémás hívás és
   * renderelés, egyébként a prózaút. Mindkét ág **stringet** ad vissza, ezért
   * innentől a loop többi része nem tud a különbségről.
   */
  const generate = (prompt: string): Promise<ModelResult<string>> =>
    recipe.structured
      ? recipe.structured.generate(client, recipe.role, prompt)
      : client.generate(recipe.role, prompt)

  opts.onGenerate?.(1)
  const first = await generate(recipe.prompt(input))
  add(first.usage)

  const firstScore = await scoreRubric(
    recipe.rubric,
    { transcript: input.transcript, output: first.value },
    client,
  )
  add(firstScore.usage)
  opts.onScore?.(firstScore.value, firstScore.gaps.length)

  rounds.push({
    score: firstScore.value,
    gaps: firstScore.gaps.length,
    generateUsage: first.usage,
    scoreUsage: firstScore.usage,
  })

  let best = { output: first.value, score: firstScore.value, gaps: firstScore.gaps }
  let generations = 1

  while (
    generations <= maxIterations &&
    (!stopEarly || best.score < recipe.rubric.passThreshold)
  ) {
    opts.onGenerate?.(generations + 1)
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
    opts.onScore?.(scored.value, scored.gaps.length)

    rounds.push({
      score: scored.value,
      gaps: scored.gaps.length,
      generateUsage: next.usage,
      scoreUsage: scored.usage,
    })

    // Nem-javulási őr. Az azonos pontszám is megállás: ha egy újabb kör nem
    // hozott előrelépést, a következő sem fog, és a loop csak költene. Mérési
    // módban nem állunk meg — a rosszabb kört sem tartjuk meg, de lefuttatjuk,
    // mert a mérés épp arra kíváncsi, mit hoz a kör.
    if (scored.value <= best.score) {
      if (stopEarly) break
      continue
    }

    best = { output: next.value, score: scored.value, gaps: scored.gaps }
  }

  return { ...best, generations, usage, rounds }
}
