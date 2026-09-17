import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { loadConfig, loadDotEnv, loadModelConfig } from '../../src/config.js'
import { createCostGuard, estimateItemUsd } from '../../src/model/budget.js'
import { createModelClient } from '../../src/model/client.js'
import { TOKENS_PER_WORD, costOf } from '../../src/model/pricing.js'
import { retrying } from '../../src/model/retry.js'
import { normalizeItem } from '../../src/pipeline.js'
import { bloomRecipe } from '../../src/recipe/bloom.js'
import { notesRecipe } from '../../src/recipe/notes.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { discoverAll } from '../../src/source/folder.js'
import type { SourceItem, TimedLine } from '../../src/types.js'
import { metered } from './metered.js'
import { rateLimited } from './rate-limit.js'

/**
 * A `bloom` és a `notes` kimeneti arányának kalibrálása valódi hívásokkal
 * (spec: „Kalibrálás — a szelet végén"). Három elemen fut — a legrövidebb, a
 * medián és a leghosszabb —, receptenként egy generálással, teljes rubrikával.
 *
 * A becslő a kimenetet a bemenet arányában számolja, ezért a javasolt
 * `outputRatio` a MEDIÁN elemen mért arány: ugyanaz a választás, amivel a spec
 * a kezdőértékeket számolta.
 */
const RECIPES: Recipe[] = [bloomRecipe, notesRecipe]
const RAW_PATH = join('evals', 'private', 'calibration-bloom-notes.json')

const { values } = parseArgs({
  options: {
    budget: { type: 'string' },
    /** Csak a becslést írja ki, modellhívás nélkül. */
    estimate: { type: 'boolean', default: false },
  },
})

loadDotEnv()
const raw = parseYaml(await readFile('refinery.config.yaml', 'utf8')) as Record<string, unknown>
const cfg = loadConfig(raw, 'refinery.config.yaml')
const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)

interface Candidate {
  item: SourceItem
  words: number
  transcript: string
  timed: TimedLine[]
}

// 1. Jelöltek: minden elem szószáma. Nulla modellhívás.
const candidates: Candidate[] = []
for (const item of await discoverAll(cfg.sources, cfg.languages)) {
  try {
    const normalized = await normalizeItem(item)
    candidates.push({
      item,
      words: normalized.wordsNormalized,
      transcript: normalized.lines.join(' '),
      timed: normalized.timed,
    })
  } catch {
    // Sérült feliratfájl: kimarad, nem állítja meg a kalibrálást.
  }
}
if (candidates.length === 0) {
  console.error('Nincs feldolgozható elem a forrásmappákban.')
  process.exit(2)
}
candidates.sort((a, b) => a.words - b.words)

const medianIndex = Math.floor(candidates.length / 2)
const medianId = candidates[medianIndex]!.item.itemId
const sample = [...new Set([0, medianIndex, candidates.length - 1])].map((i) => candidates[i]!)

// 2. Becslés: a mintára és a teljes korpuszra, receptenként.
const judgesOf = (recipe: Recipe): number =>
  recipe.rubric.criteria.filter((c) => !c.blocking).length
const estimateFor = (recipe: Recipe, words: number): number =>
  estimateItemUsd(words, recipe.maxIterations, modelConfig, {
    outputRatio: recipe.outputRatio,
    judges: judgesOf(recipe),
  })

let sampleUsd = 0
for (const recipe of RECIPES) {
  const recipeSample = sample.reduce((sum, c) => sum + estimateFor(recipe, c.words), 0)
  const corpus = candidates.reduce((sum, c) => sum + estimateFor(recipe, c.words), 0)
  sampleUsd += recipeSample
  console.log(
    `${recipe.id}: minta ~$${recipeSample.toFixed(2)}, teljes korpusz (${String(candidates.length)} elem) ~$${corpus.toFixed(2)}`,
  )
}
console.log(`A minta: ${sample.map((c) => `${c.item.title} (${String(c.words)} szó)`).join('; ')}`)
console.log(
  `Becsült költség összesen: $${sampleUsd.toFixed(2)}, kétszeres ráhagyással $${(sampleUsd * 2).toFixed(2)}`,
)

if (values.estimate) process.exit(0)

// 3. Költségkapu: a kétszeres ráhagyással számolt becslés a budget fölött el
//    sem indul (valódi pénzt költő futások fegyelme).
const budget = Number(values.budget)
if (!Number.isFinite(budget) || budget <= 0) {
  console.error('Kötelező a --budget kapcsoló, pozitív dollárösszeggel (pl. --budget 1).')
  process.exit(2)
}
if (sampleUsd * 2 > budget) {
  console.error('A kétszeres ráhagyással számolt becslés a budget fölött van — a kalibrálás nem indul el.')
  process.exit(2)
}

// 4. A mérés. A burkolók sorrendje a mérő harness (`run.ts`) mintája: a
//    `metered` legbelül könyvel minden tényleges hívást, akkor is, ha a
//    `refine` később dob.
const guard = createCostGuard(budget)
const client = retrying(
  rateLimited(metered(createModelClient(modelConfig), guard, modelConfig), { perMinute: 18 }),
)

interface CalibrationRecord {
  recipe: string
  itemId: string
  title: string
  words: number
  median: boolean
  outputTokens: number
  outputRatio: number
  score: number
  gaps: string[]
  usd: number
  output: string
}
const records: CalibrationRecord[] = []
const failures: { recipe: string; itemId: string; message: string }[] = []

for (const recipe of RECIPES) {
  for (const c of sample) {
    if (guard.exceeded()) break
    try {
      const result = await refine(
        recipe,
        { item: c.item, transcript: c.transcript, timed: c.timed },
        client,
      )
      const round = result.rounds[0]!
      const record: CalibrationRecord = {
        recipe: recipe.id,
        itemId: c.item.itemId,
        title: c.item.title,
        words: c.words,
        median: c.item.itemId === medianId,
        outputTokens: round.generateUsage.outputTokens,
        outputRatio: round.generateUsage.outputTokens / (c.words * TOKENS_PER_WORD),
        score: result.score,
        gaps: result.gaps,
        usd:
          costOf(round.generateUsage, modelConfig.pricing[recipe.role]) +
          costOf(round.scoreUsage, modelConfig.pricing.judge),
        output: result.output,
      }
      records.push(record)
      console.log(
        `${recipe.id} ${String(c.words)} szó: arány ${record.outputRatio.toFixed(2)}, pontszám ${record.score.toFixed(2)}, $${record.usd.toFixed(3)}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ recipe: recipe.id, itemId: c.item.itemId, message })
      console.error(`${recipe.id} ${c.item.itemId}: HIBA — ${message}`)
    }
  }
}
if (guard.exceeded()) {
  console.error(`A keret elfogyott ($${guard.spentUsd().toFixed(2)}) — a kalibrálás megállt.`)
}

// 5. Kiírás: a nyers adat (a kimenetekkel és a hiánylistákkal) privát.
await mkdir(join('evals', 'private'), { recursive: true })
await writeFile(
  RAW_PATH,
  JSON.stringify({ records, failures, spentUsd: guard.spentUsd() }, null, 2),
  'utf8',
)

console.log('\n| recept | szó | medián elem | kimeneti token | arány | pontszám | $ |')
console.log('|---|---|---|---|---|---|---|')
for (const r of records) {
  console.log(
    `| ${r.recipe} | ${String(r.words)} | ${r.median ? 'igen' : ''} | ${String(r.outputTokens)} | ${r.outputRatio.toFixed(2)} | ${r.score.toFixed(2)} | ${r.usd.toFixed(3)} |`,
  )
}

for (const recipe of RECIPES) {
  const median = records.find((r) => r.recipe === recipe.id && r.median)
  console.log(
    median
      ? `${recipe.id}: javasolt outputRatio ${(Math.ceil(median.outputRatio * 100) / 100).toFixed(2)} (most ${String(recipe.outputRatio)})`
      : `${recipe.id}: a medián elem mérése hiányzik — nincs javaslat.`,
  )
}
console.log(`Költés: $${guard.spentUsd().toFixed(2)} · nyers adat: ${RAW_PATH}`)
if (failures.length > 0) process.exit(1)
