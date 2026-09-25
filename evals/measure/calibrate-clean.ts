import { existsSync } from 'node:fs'
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
import { CLEAN_RECIPES } from '../../src/recipe/clean.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { fidelityMetrics } from '../../src/rubric/fidelity.js'
import { discoverAll } from '../../src/source/folder.js'
import type { SourceItem, TimedLine } from '../../src/types.js'
import { noteFile } from '../../src/vault/paths.js'
import { metered } from './metered.js'
import { rateLimited } from './rate-limit.js'

/**
 * A `clean`-szintek hűségküszöbének és kimeneti arányának kalibrálása valódi
 * hívásokkal (spec 2.4). Három elem — a legrövidebb, a medián és a
 * leghosszabb azok közül, amelyeknek van `_clean.md` vagy `_clean-moderate.md`
 * jegyzete —, szintenként
 * egy generálással, **bíró és hűségkapu nélkül**: a kapu küszöbét épp most
 * mérjük, a kezdőérték nem buktathatja el a mérést.
 *
 * Folytatható: a nyers eredmény minden generálás után kiíródik, és
 * újraindításkor a kész (szint, elem) párok kimaradnak.
 */
const RAW_PATH = join('evals', 'private', 'calibration-clean.json')

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

/** A mérés receptje: a kapuk és a bíró nélkül, hogy a nyers kimenetet lássuk. */
const measured = (recipe: Recipe): Recipe => ({
  ...recipe,
  rubric: { ...recipe.rubric, criteria: [] },
})

interface Candidate {
  item: SourceItem
  words: number
  transcript: string
  timed: TimedLine[]
}

// 1. Jelöltek: a tisztított jegyzettel rendelkező elemek szószáma. A régi
// `_clean.md` a tervezett átnevezés után `_clean-moderate.md` lesz; bármelyik
// megfelel. Nulla modellhívás.
const CLEAN_MARKERS = ['_clean.md', '_clean-moderate.md']
const candidates: Candidate[] = []
for (const item of await discoverAll(cfg.sources, cfg.languages)) {
  const hasCleanNote = CLEAN_MARKERS.some((file) => existsSync(noteFile(cfg.notesRoot, item, file)))
  if (!hasCleanNote) continue
  try {
    const normalized = await normalizeItem(item)
    candidates.push({
      item,
      words: normalized.wordsNormalized,
      transcript: normalized.lines.join(' '),
      timed: normalized.timed,
    })
  } catch {
    // Sérült feliratfájl: kimarad.
  }
}
if (candidates.length === 0) {
  console.error('Nincs olyan elem, amelynek van _clean.md vagy _clean-moderate.md jegyzete.')
  process.exit(2)
}
candidates.sort((a, b) => a.words - b.words)
const medianIndex = Math.floor(candidates.length / 2)
const medianId = candidates[medianIndex]!.item.itemId
const sample = [...new Set([0, medianIndex, candidates.length - 1])].map((i) => candidates[i]!)

// 2. Becslés, bíró nélkül.
let sampleUsd = 0
for (const recipe of CLEAN_RECIPES) {
  const usd = sample.reduce(
    (sum, c) =>
      sum + estimateItemUsd(c.words, 0, modelConfig, { outputRatio: recipe.outputRatio, judges: 0 }),
    0,
  )
  sampleUsd += usd
  console.log(`${recipe.id}: minta ~$${usd.toFixed(2)}`)
}
console.log(`Draft modell: ${modelConfig.models.draft}`)
console.log(`A minta: ${sample.map((c) => `${c.item.title} (${String(c.words)} szó)`).join('; ')}`)
console.log(
  `Becsült költség összesen: $${sampleUsd.toFixed(2)}, kétszeres ráhagyással $${(sampleUsd * 2).toFixed(2)}`,
)
if (values.estimate) process.exit(0)

// 3. Költségkapu.
const budget = Number(values.budget)
if (!Number.isFinite(budget) || budget <= 0) {
  console.error('Kötelező a --budget kapcsoló, pozitív dollárösszeggel (pl. --budget 10).')
  process.exit(2)
}
if (sampleUsd * 2 > budget) {
  console.error('A kétszeres ráhagyással számolt becslés a budget fölött van — a kalibrálás nem indul el.')
  process.exit(2)
}

interface CleanRecord {
  recipe: string
  itemId: string
  title: string
  words: number
  median: boolean
  outputTokens: number
  outputRatio: number
  wordRatio: number
  coverage: number
  usd: number
  output: string
}

// 4. Folytatás: a korábbi rekordok betöltése.
const previous = existsSync(RAW_PATH)
  ? (JSON.parse(await readFile(RAW_PATH, 'utf8')) as { records: CleanRecord[]; spentUsd: number })
  : { records: [], spentUsd: 0 }
const records: CleanRecord[] = [...previous.records]
const failures: { recipe: string; itemId: string; message: string }[] = []
const guard = createCostGuard(budget - previous.spentUsd)
const client = retrying(
  rateLimited(metered(createModelClient(modelConfig), guard, modelConfig), { perMinute: 18 }),
)
const save = async (): Promise<void> => {
  await mkdir(join('evals', 'private'), { recursive: true })
  await writeFile(
    RAW_PATH,
    JSON.stringify({ records, failures, spentUsd: previous.spentUsd + guard.spentUsd() }, null, 2),
    'utf8',
  )
}

for (const recipe of CLEAN_RECIPES) {
  for (const c of sample) {
    if (records.some((r) => r.recipe === recipe.id && r.itemId === c.item.itemId)) continue
    if (guard.exceeded()) break
    try {
      const result = await refine(
        measured(recipe),
        { item: c.item, transcript: c.transcript, timed: c.timed },
        client,
        { maxIterations: 0, skipJudge: true },
      )
      const round = result.rounds[0]!
      const metrics = fidelityMetrics(result.output, c.transcript)
      const record: CleanRecord = {
        recipe: recipe.id,
        itemId: c.item.itemId,
        title: c.item.title,
        words: c.words,
        median: c.item.itemId === medianId,
        outputTokens: round.generateUsage.outputTokens,
        outputRatio: round.generateUsage.outputTokens / (c.words * TOKENS_PER_WORD),
        wordRatio: metrics.ratio,
        coverage: metrics.coverage,
        usd: costOf(round.generateUsage, modelConfig.pricing[recipe.role]),
        output: result.output,
      }
      records.push(record)
      await save()
      console.log(
        `${recipe.id} ${String(c.words)} szó: szóarány ${record.wordRatio.toFixed(2)}, lefedettség ${record.coverage.toFixed(2)}, tokenarány ${record.outputRatio.toFixed(2)}, $${record.usd.toFixed(3)}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ recipe: recipe.id, itemId: c.item.itemId, message })
      await save()
      console.error(`${recipe.id} ${c.item.itemId}: HIBA — ${message}`)
    }
  }
}
if (guard.exceeded()) console.error('A keret elfogyott — a kalibrálás megállt; újraindítva folytatja.')

// 5. Javaslat a küszöbszabály szerint (spec 2.4).
const floor2 = (x: number): number => Math.floor(x * 100) / 100
const ceil2 = (x: number): number => Math.ceil(x * 100) / 100
console.log('\n| recept | szó | medián | szóarány | lefedettség | tokenarány | $ |')
console.log('|---|---|---|---|---|---|---|')
for (const r of records) {
  console.log(
    `| ${r.recipe} | ${String(r.words)} | ${r.median ? 'igen' : ''} | ${r.wordRatio.toFixed(2)} | ${r.coverage.toFixed(2)} | ${r.outputRatio.toFixed(2)} | ${r.usd.toFixed(3)} |`,
  )
}
for (const recipe of CLEAN_RECIPES) {
  const mine = records.filter((r) => r.recipe === recipe.id)
  const median = mine.find((r) => r.median)
  if (mine.length < sample.length || !median) {
    console.log(`${recipe.id}: hiányos mérés — nincs javaslat.`)
    continue
  }
  const minRatio = floor2(Math.min(...mine.map((r) => r.wordRatio)) - 0.05)
  const minCoverage = floor2(Math.min(...mine.map((r) => r.coverage)) - 0.05)
  console.log(
    `${recipe.id}: javasolt minWordRatio ${minRatio.toFixed(2)}, minCoverage ${minCoverage.toFixed(2)}, outputRatio ${ceil2(median.outputRatio).toFixed(2)}`,
  )
}
console.log(`Költés összesen: $${(previous.spentUsd + guard.spentUsd()).toFixed(2)} · nyers adat: ${RAW_PATH}`)
if (failures.length > 0) process.exit(1)
