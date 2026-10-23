import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCostGuard } from '../model/budget.js'
import type { ModelClient } from '../model/client.js'
import { openState, type StateStore } from '../state/db.js'
import { GLOSSARY_SEPARATOR as S } from './glossary.js'
import { translationOf } from './translate.js'
import { translateChunked, type ChunkedDeps } from './translate-chunks.js'
import type { Recipe, RecipeInput } from './types.js'

const MODELL_CFG = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  recipeModels: {},
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  modelPricing: {},
  costLimitUsd: 5,
}

const PROBA: Recipe = {
  id: 'proba',
  outputFile: '_proba.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  prompt: () => 'generálj',
  repairPrompt: () => 'javíts',
  rubric: { criteria: [], passThreshold: 0.8 },
}

/** Fordítórecept kis küszöbbel; a rubrika mindig átengedi (a kapukat a pipeline-teszt nézi). */
const fordito = (chunkWords: number): Recipe => ({
  ...translationOf(PROBA, 'hu', chunkWords),
  rubric: {
    criteria: [{ name: 'mindig-jo', score: () => Promise.resolve({ value: 1, gaps: [] }) }],
    passThreshold: 0.8,
  },
})

// 23 szó: [fejléc + 1. bekezdés = 13], [2. bekezdés = 10] → 10-es küszöbnél két darab.
const FORRAS = [
  '## Overview',
  '',
  'The speaker explains why a problem should come before a tool.',
  '',
  'The second paragraph adds an example from his first company.',
].join('\n')

const ELSO = `## Áttekintés\n\nElső darab.\n${S}\nproblem | probléma`
const MASODIK = `Második darab.\n${S}\ntool | eszköz`
const HIBAS = 'elválasztó nélkül'

function sorKliens(replies: string[]): ModelClient & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    generate: (_role, prompt) => {
      prompts.push(prompt)
      const value = replies.shift()
      if (value === undefined) return Promise.reject(new Error('nincs több válasz'))
      return Promise.resolve({ value, usage: { inputTokens: 100, outputTokens: 20 } })
    },
    generateObject: () => Promise.reject(new Error('nem hívjuk')),
  }
}

let store: StateStore
beforeEach(async () => {
  store = openState(join(await mkdtemp(join(tmpdir(), 'refinery-chunks-')), 'state.db'))
})
afterEach(() => store.close())

const input = (transcript = FORRAS): RecipeInput => ({
  item: { itemId: 'a1', source: 'youtube', sourceFile: 'x', subtitlePath: 'x', baseName: 'B', title: 'Cím', language: 'en', metadata: {} },
  transcript,
  timed: [],
})

function deps(client: ModelClient, over: Partial<ChunkedDeps> = {}): ChunkedDeps {
  return {
    client,
    modelConfig: MODELL_CFG,
    guard: createCostGuard(5),
    store,
    persist: true,
    force: false,
    skipJudge: true,
    clock: (fn) => fn(),
    onGenerate: () => {},
    onScore: () => {},
    ...over,
  }
}

const run = (recipe: Recipe, client: ModelClient, over: Partial<ChunkedDeps> = {}, glossary = []) =>
  translateChunked(recipe, recipe.translation!, input(), glossary, deps(client, over))

describe('translateChunked', () => {
  it('a darabok sorban futnak, a második megkapja az első szójegyzékét', async () => {
    const client = sorKliens([ELSO, MASODIK])
    const result = await run(fordito(10), client)

    expect(result.output).toBe('## Áttekintés\n\nElső darab.\n\nMásodik darab.')
    expect(client.prompts[0]).toContain('part 1 of 2')
    expect(client.prompts[1]).toContain('problem | probléma')
    expect(result.glossary).toEqual([
      { source: 'problem', target: 'probléma' },
      { source: 'tool', target: 'eszköz' },
    ])
    expect(result.rounds).toHaveLength(2)
    expect(result.generations).toBe(1)
    expect(result.chunked).toBe(true)
    expect(store.translationChunks('a1', 'proba-hu')).toHaveLength(2)
  })

  it('hibás választ legfeljebb kétszer újrakér; a sikeres darab felhasználása az összes kísérleté', async () => {
    const result = await run(fordito(10), sorKliens([ELSO, HIBAS, MASODIK]))
    expect(result.rounds[1]!.generateUsage).toEqual({ inputTokens: 200, outputTokens: 40 })
  })

  it('három hibás válasz után bukik, a kész darab a táblában marad, minden hívás könyvelve', async () => {
    const guard = createCostGuard(5)
    await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]), { guard })).rejects.toThrow(
      /2\/2\. darab válasza 3 generálás után sem értelmezhető/,
    )
    expect(store.translationChunks('a1', 'proba-hu').map((chunk) => chunk.index)).toEqual([0])
    // 4 hívás × (100 × 3 + 20 × 15) / 1e6
    expect(guard.spentUsd()).toBeCloseTo(0.0024, 10)
  })

  it('folytatáskor a kész darabot nem fordítja újra, és az utolsó szójegyzékből indul', async () => {
    await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]))).rejects.toThrow()
    const client = sorKliens([MASODIK])
    const result = await run(fordito(10), client)

    expect(client.prompts).toHaveLength(1)
    expect(client.prompts[0]).toContain('problem | probléma')
    expect(result.output).toBe('## Áttekintés\n\nElső darab.\n\nMásodik darab.')
    expect(result.resumedUsage).toEqual({ inputTokens: 100, outputTokens: 20 })
    expect(result.rounds).toHaveLength(1)
  })

  it('eltérő lenyomatnál (más draft modell) elölről kezd', async () => {
    await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]))).rejects.toThrow()
    const client = sorKliens([ELSO, MASODIK])
    const masik = { ...MODELL_CFG, models: { ...MODELL_CFG.models, draft: 'masik-modell' } }
    await run(fordito(10), client, { modelConfig: masik })
    expect(client.prompts).toHaveLength(2)
  })

  it('force mellett a tárolt darabokat törli, és mindent újragenerál', async () => {
    await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]))).rejects.toThrow()
    const client = sorKliens([ELSO, MASODIK])
    await run(fordito(10), client, { force: true })
    expect(client.prompts).toHaveLength(2)
  })

  it('egy darabnál a táblához nem nyúl, de a szójegyzéket olvassa és bővíti', async () => {
    const client = sorKliens([`Fordítás.\n${S}\ntool | eszköz`])
    const result = await translateChunked(fordito(4000), fordito(4000).translation!, input(), [{ source: 'x', target: 'y' }], deps(client))

    expect(client.prompts[0]).toContain('x | y')
    expect(client.prompts[0]).not.toContain('part ')
    expect(result.glossary).toEqual([{ source: 'x', target: 'y' }, { source: 'tool', target: 'eszköz' }])
    expect(result.chunked).toBe(false)
    expect(store.translationChunks('a1', 'proba-hu')).toEqual([])
  })

  it('persist nélkül (dryRun) nem ír a táblába', async () => {
    await run(fordito(10), sorKliens([ELSO, MASODIK]), { persist: false })
    expect(store.translationChunks('a1', 'proba-hu')).toEqual([])
  })

  it('darabonként saját óra, a pontozásnak külön; a pontozás az összefűzött szövegen', async () => {
    let clocks = 0
    const scored: string[] = []
    const recipe: Recipe = {
      ...fordito(10),
      rubric: {
        criteria: [{ name: 'figyelo', score: (ctx) => (scored.push(ctx.output), Promise.resolve({ value: 0.7, gaps: ['x'] })) }],
        passThreshold: 0.8,
      },
    }
    const result = await run(recipe, sorKliens([ELSO, MASODIK]), {
      clock: (fn) => (clocks++, fn()),
      skipJudge: false,
    })
    expect(clocks).toBe(3)
    expect(scored).toEqual(['## Áttekintés\n\nElső darab.\n\nMásodik darab.'])
    expect(result.rounds.map((round) => [round.score, round.gaps])).toEqual([[0.7, 0], [0.7, 1]])
  })
})
