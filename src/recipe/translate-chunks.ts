import { createHash } from 'node:crypto'
import type { ModelConfig } from '../config.js'
import type { CostGuard } from '../model/budget.js'
import type { ModelClient, ModelUsage } from '../model/client.js'
import type { RefineResult, RoundTrace } from '../refine/loop.js'
import { scoreRubric } from '../rubric/types.js'
import type { StateStore } from '../state/db.js'
import { mergeGlossary, parseChunkReply, type GlossaryPair } from './glossary.js'
import { splitForTranslation } from './split.js'
import { translationChunkPrompt } from './translate.js'
import type { Recipe, RecipeInput, Translation } from './types.js'

/** Egy darab legfeljebb ennyiszer generálódik, ha a válasza nem értelmezhető: egyszer, és kétszer újra (spec). */
const CHUNK_ATTEMPTS = 3

const ZERO: ModelUsage = { inputTokens: 0, outputTokens: 0 }
const plus = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

export interface ChunkedDeps {
  /** A már újrapróbáló (`retrying`) kliens. */
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
  store: StateStore
  /** Hamis (`dryRun`) esetén a tábla érintetlen. */
  persist: boolean
  skipJudge?: boolean
  /** A recept órája egy hívásláncra: darabkísérletenként és a pontozásra külön indul. */
  clock: <T>(fn: () => Promise<T>) => Promise<T>
  onGenerate: (generation: number) => void
  onScore: (score: number, gaps: number) => void
}

export interface ChunkedResult extends RefineResult {
  /** A szójegyzék teljes állása a futás végén (a kezdeti párokkal együtt). */
  glossary: GlossaryPair[]
  /** A korábbi futásban kész darabok felhasználása: a `costUsd`-be számít, a költségőrbe nem. */
  resumedUsage: ModelUsage
  /** Igaz, ha egynél több darab volt; csak ekkor van mit törölni a táblából. */
  chunked: boolean
}

/**
 * A tárolt darabok érvényessége. A `template` a darabprompt sablonja (a változó részek nélkül):
 * promptcsere után a tárolt darabok érvénytelenek. A `--force` a darabokat nem törli: egy bukott
 * `--force` futás után az újabb a kész darabokkal folytat (siker után a tábla úgyis üres).
 */
export function chunkSourceHash(body: string, chunkWords: number, target: string, model: string, template = ''): string {
  return createHash('sha256').update(JSON.stringify([body, chunkWords, target, model, template])).digest('hex')
}

async function generateChunk(
  recipe: Recipe,
  prompt: string,
  deps: ChunkedDeps,
  label: string,
): Promise<{ translation: string; pairs: GlossaryPair[]; usage: ModelUsage }> {
  let usage = ZERO
  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
    // Kísérletenként saját óra: egy 8 000 szavas darab ~9 perc, három kísérlet nem férne a 25 percbe.
    const reply = await deps.clock(() => deps.client.generate(recipe.role, prompt))
    // Hívásonként könyvelünk: a bukó darab előtti hívások is a futás költésébe számítanak.
    deps.guard.add(recipe.role, reply.usage, deps.modelConfig)
    usage = plus(usage, reply.usage)
    const parsed = parseChunkReply(reply.value)
    if (parsed !== null) return { ...parsed, usage }
  }
  throw new Error(
    `a(z) ${label}. darab válasza ${CHUNK_ATTEMPTS} generálás után sem értelmezhető (hiányzó vagy többszörös elválasztó, hibás szójegyzéksor vagy üres fordítás)`,
  )
}

/**
 * Egy fordítás darabokban, sorban (#259). Minden darab az addigi szójegyzéket
 * kapja, és a kész darab a táblába kerül; a folytatás az első hiányzó darabbal
 * indul. A pontozás egyszer, az összefűzött szövegen fut, a teljes forráshoz mérve.
 * Egy darabnál (rövid jegyzet) a tábla érintetlen, a szójegyzék ugyanúgy bemenet és kimenet.
 */
export async function translateChunked(
  recipe: Recipe,
  translation: Translation,
  input: RecipeInput,
  initialGlossary: readonly GlossaryPair[],
  deps: ChunkedDeps,
): Promise<ChunkedResult> {
  const { item } = input
  const chunks = splitForTranslation(input.transcript, translation.chunkWords)
  const chunked = chunks.length > 1
  const useTable = chunked && deps.persist
  const hash = chunkSourceHash(
    input.transcript,
    translation.chunkWords,
    translation.target,
    deps.modelConfig.models[recipe.role],
    translationChunkPrompt({ title: '', chunk: '', glossary: [], target: translation.target, part: { index: 0, total: 0 } }),
  )

  let stored = useTable ? deps.store.translationChunks(item.itemId, recipe.id) : []
  // Más lenyomatnál a darabhatárok is mások lehetnek: minden darab elölről.
  if (useTable && stored.some((chunk) => chunk.sourceHash !== hash)) {
    deps.store.clearTranslationChunks(item.itemId, recipe.id)
    stored = []
  }

  const outputs = stored.map((chunk) => chunk.output)
  let glossary = stored.at(-1)?.glossaryAfter ?? [...initialGlossary]
  const resumedUsage = stored.reduce((sum, chunk) => plus(sum, chunk.usage), ZERO)
  const rounds: RoundTrace[] = []

  for (let index = outputs.length; index < chunks.length; index++) {
    deps.onGenerate(index + 1)
    const prompt = translationChunkPrompt({
      title: item.title,
      chunk: chunks[index]!,
      glossary,
      target: translation.target,
      part: chunked ? { index: index + 1, total: chunks.length } : undefined,
    })
    const done = await generateChunk(recipe, prompt, deps, `${index + 1}/${chunks.length}`)
    glossary = mergeGlossary(glossary, done.pairs)
    outputs.push(done.translation)
    rounds.push({ score: 0, gaps: 0, generateUsage: done.usage, scoreUsage: ZERO })
    if (useTable) {
      deps.store.saveTranslationChunk(item.itemId, recipe.id, {
        index,
        sourceHash: hash,
        output: done.translation,
        glossaryAfter: glossary,
        usage: done.usage,
      })
    }
  }

  const output = outputs.join('\n\n')
  const scored = await deps.clock(() =>
    scoreRubric(recipe.rubric, { transcript: input.transcript, output }, deps.client, {
      skipJudge: deps.skipJudge,
    }),
  )
  deps.guard.add('judge', scored.usage, deps.modelConfig)
  deps.onScore(scored.value, scored.gaps.length)

  // Minden darab-kör a végső pontszámot viszi; a pontozás felhasználása és hiányszáma az utolsóé.
  // Ha minden darab a korábbi futásból jött, a pontozás egy saját kört kap.
  if (rounds.length === 0) rounds.push({ score: 0, gaps: 0, generateUsage: ZERO, scoreUsage: ZERO })
  for (const round of rounds) round.score = scored.value
  const last = rounds.at(-1)!
  last.gaps = scored.gaps.length
  last.scoreUsage = scored.usage

  const usage = rounds.reduce((sum, round) => plus(plus(sum, round.generateUsage), round.scoreUsage), ZERO)
  return { output, score: scored.value, gaps: scored.gaps, generations: 1, usage, rounds, glossary, resumedUsage, chunked }
}
