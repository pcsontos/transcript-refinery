import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { loadConfig, loadDotEnv, loadModelConfig } from '../../src/config.js'
import { createCostGuard, estimateItemUsd } from '../../src/model/budget.js'
import { createModelClient } from '../../src/model/client.js'
import { TOKENS_PER_WORD, costOf } from '../../src/model/pricing.js'
import { retrying } from '../../src/model/retry.js'
import { countWords } from '../../src/normalize/dedupe.js'
import { normalizeItem } from '../../src/pipeline.js'
import { formatTimestamp } from '../../src/recipe/anchor.js'
import { cleanRecipe } from '../../src/recipe/clean.js'
import { notesRecipe } from '../../src/recipe/notes.js'
import { summaryRecipe } from '../../src/recipe/summary.js'
import { alreadyInTarget, translationOf } from '../../src/recipe/translate.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { checkSkeleton } from '../../src/rubric/skeleton.js'
import { discoverAll } from '../../src/source/folder.js'
import { openStateReader } from '../../src/state/reader.js'
import type { SourceItem } from '../../src/types.js'
import { noteBody } from '../../src/vault/note-body.js'
import { metered } from './metered.js'
import { rateLimited } from './rate-limit.js'

/**
 * A fordítórecept kalibrálása valódi hívásokkal (spec: „Kalibrálás — a szelet
 * végén"). Két kérdésre felel:
 *
 * 1. Mennyi a fordítás kimeneti aránya a forrásjegyzethez mérve? A vaultban
 *    kész `clean`, `summary` és `notes` jegyzeteken, receptenként legfeljebb
 *    hárommal, egy generálással és teljes rubrikával.
 * 2. Lefordítható-e egy hosszú forrás egyetlen hívásban? Egy kb. 16 ezer
 *    szavas valódi átiratból bekezdésekre tördelt szintetikus forrás, egy
 *    hívással, bíró és újrapróbálkozás nélkül — az időtúllépést látni akarjuk,
 *    nem elnyelni.
 */
const TARGET = 'hu'
const SOURCES: Recipe[] = [cleanRecipe, summaryRecipe, notesRecipe]
const PER_SOURCE = 3
const LONG_WORDS = 16_000
const RAW_PATH = join('evals', 'private', 'calibration-translate.json')

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
const translations = new Map(
  SOURCES.map((source) => [source.id, translationOf(source, TARGET)] as const),
)
const translationFor = (source: Recipe): Recipe => translations.get(source.id)!

const discovered = new Map(
  (await discoverAll(cfg.sources, cfg.languages)).map((item) => [item.itemId, item] as const),
)

interface Sample {
  source: Recipe
  item: SourceItem
  body: string
  words: number
}

// 1. Minta a vaultban kész forrásjegyzetekből, azonosító szerinti sorrendben.
//    Nulla modellhívás.
const reader = openStateReader(cfg.statePath)
if (reader === null) {
  console.error(`Nincs állapottár: ${cfg.statePath}`)
  process.exit(2)
}
const samples: Sample[] = []
for (const source of SOURCES) {
  const done = reader
    .artifacts()
    .filter((a) => a.kind === source.id && a.status === 'done' && a.path !== null)
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
  let taken = 0
  for (const artifact of done) {
    if (taken >= PER_SOURCE) break
    const item = discovered.get(artifact.itemId)
    if (item === undefined) continue
    let body: string
    try {
      body = noteBody(await readFile(artifact.path!, 'utf8')).body
    } catch (error) {
      console.error(`${source.id} ${artifact.itemId}: kimarad — ${(error as Error).message}`)
      continue
    }
    // A már célnyelvű forrást a futás is kihagyná: a mérésben sincs helye.
    if (alreadyInTarget(body, TARGET) !== null) continue
    samples.push({ source, item, body, words: countWords(body) })
    taken++
  }
}
reader.close()

// 2. A hosszú, szintetikus forrás: a LONG_WORDS-höz legközelebbi átirat, nyolc
//    feliratsoronként egy időbélyeges bekezdés — a `clean` kimenetének alakja.
let long: { item: SourceItem; body: string; words: number; distance: number } | null = null
for (const item of discovered.values()) {
  let normalized: Awaited<ReturnType<typeof normalizeItem>>
  try {
    normalized = await normalizeItem(item)
  } catch {
    continue
  }
  const distance = Math.abs(normalized.wordsNormalized - LONG_WORDS)
  if (long !== null && distance >= long.distance) continue
  const paragraphs: string[] = []
  for (let i = 0; i < normalized.timed.length; i += 8) {
    const group = normalized.timed.slice(i, i + 8)
    paragraphs.push(
      `${formatTimestamp(group[0]!.start)} ${group.map((line) => line.text).join(' ')}`,
    )
  }
  const body = paragraphs.join('\n\n')
  if (alreadyInTarget(body, TARGET) !== null) continue
  long = { item, body, words: countWords(body), distance }
}

// 3. Becslés, a repó képletével.
const judgesOf = (recipe: Recipe): number =>
  recipe.rubric.criteria.filter((c) => !c.blocking).length
let sampleUsd = 0
for (const s of samples) {
  const recipe = translationFor(s.source)
  sampleUsd += estimateItemUsd(s.words, recipe.maxIterations, modelConfig, {
    outputRatio: recipe.outputRatio,
    judges: judgesOf(recipe),
  })
}
const longUsd =
  long === null
    ? 0
    : estimateItemUsd(long.words, 0, modelConfig, {
        outputRatio: translationFor(cleanRecipe).outputRatio,
        judges: 0,
      })
const totalUsd = sampleUsd + longUsd

console.log(`Modellek: vázlat ${modelConfig.models.draft}, bíró ${modelConfig.models.judge}`)
console.log(
  `Minta (${String(samples.length)}): ${samples
    .map((s) => `${s.source.id} — ${s.item.title} (${String(s.words)} szó)`)
    .join('; ')}`,
)
console.log(
  long === null
    ? 'Hosszú forrás: nincs feldolgozható átirat.'
    : `Hosszú forrás: ${long.item.title} (${String(long.words)} szó)`,
)
console.log(
  `Becsült költség: minta $${sampleUsd.toFixed(2)}, hosszú forrás $${longUsd.toFixed(2)}, ` +
    `összesen $${totalUsd.toFixed(2)}, kétszeres ráhagyással $${(totalUsd * 2).toFixed(2)}`,
)

if (values.estimate) process.exit(0)

// 4. Költségkapu: a kétszeres ráhagyással számolt becslés a budget fölött el
//    sem indul (valódi pénzt költő futások fegyelme).
const budget = Number(values.budget)
if (!Number.isFinite(budget) || budget <= 0) {
  console.error('Kötelező a --budget kapcsoló, pozitív dollárösszeggel (pl. --budget 1.4).')
  process.exit(2)
}
if (totalUsd * 2 > budget) {
  console.error('A kétszeres ráhagyással számolt becslés a budget fölött van — a kalibrálás nem indul el.')
  process.exit(2)
}

// 5. A mérés. A `metered` legbelül könyvel minden tényleges hívást, akkor is, ha
//    a `refine` később dob.
const guard = createCostGuard(budget)
const base = rateLimited(metered(createModelClient(modelConfig), guard, modelConfig), {
  perMinute: 18,
})
const client = retrying(base)

interface RatioRecord {
  recipe: string
  itemId: string
  title: string
  words: number
  outputTokens: number
  outputRatio: number
  score: number
  gaps: string[]
  usd: number
  output: string
}
const records: RatioRecord[] = []
const failures: { recipe: string; itemId: string; message: string }[] = []

for (const s of samples) {
  if (guard.exceeded()) break
  const recipe = translationFor(s.source)
  try {
    const result = await refine(recipe, { item: s.item, transcript: s.body, timed: [] }, client)
    const round = result.rounds[0]!
    const record: RatioRecord = {
      recipe: recipe.id,
      itemId: s.item.itemId,
      title: s.item.title,
      words: s.words,
      outputTokens: round.generateUsage.outputTokens,
      outputRatio: round.generateUsage.outputTokens / (s.words * TOKENS_PER_WORD),
      score: result.score,
      gaps: result.gaps,
      usd:
        costOf(round.generateUsage, modelConfig.pricing[recipe.role]) +
        costOf(round.scoreUsage, modelConfig.pricing.judge),
      output: result.output,
    }
    records.push(record)
    console.log(
      `${recipe.id} ${String(s.words)} szó: arány ${record.outputRatio.toFixed(2)}, ` +
        `pontszám ${record.score.toFixed(2)}, $${record.usd.toFixed(3)}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ recipe: recipe.id, itemId: s.item.itemId, message })
    console.error(`${recipe.id} ${s.item.itemId}: HIBA — ${message}`)
  }
}

interface LongRecord {
  itemId: string
  title: string
  words: number
  seconds: number
  outputTokens: number | null
  outputRatio: number | null
  /** A vázkapu ítélete a hosszú fordításon; hiba esetén `null`. */
  skeleton: number | null
  error: string | null
}
let longRecord: LongRecord | null = null
if (long !== null && !guard.exceeded()) {
  const recipe = translationFor(cleanRecipe)
  const started = Date.now()
  const seconds = (): number => (Date.now() - started) / 1000
  try {
    // Újrapróbálkozás nélkül: az időtúllépés a mérés tárgya.
    const result = await base.generate(
      recipe.role,
      recipe.prompt({ item: long.item, transcript: long.body, timed: [] }),
    )
    longRecord = {
      itemId: long.item.itemId,
      title: long.item.title,
      words: long.words,
      seconds: seconds(),
      outputTokens: result.usage.outputTokens,
      outputRatio: result.usage.outputTokens / (long.words * TOKENS_PER_WORD),
      skeleton: checkSkeleton(result.value, long.body).value,
      error: null,
    }
  } catch (error) {
    longRecord = {
      itemId: long.item.itemId,
      title: long.item.title,
      words: long.words,
      seconds: seconds(),
      outputTokens: null,
      outputRatio: null,
      skeleton: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  console.log(
    longRecord.error === null
      ? `hosszú forrás ${String(long.words)} szó: ${longRecord.seconds.toFixed(0)} mp, ` +
          `${String(longRecord.outputTokens)} kimeneti token, vázkapu ${String(longRecord.skeleton)}`
      : `hosszú forrás ${String(long.words)} szó: HIBA ${longRecord.seconds.toFixed(0)} mp után — ${longRecord.error}`,
  )
}

// 6. Kiírás: a nyers adat (a kimenetekkel és a hiánylistákkal) privát.
await mkdir(join('evals', 'private'), { recursive: true })
await writeFile(
  RAW_PATH,
  JSON.stringify({ records, long: longRecord, failures, spentUsd: guard.spentUsd() }, null, 2),
  'utf8',
)

console.log('\n| recept | szó | kimeneti token | arány | pontszám | $ |')
console.log('|---|---|---|---|---|---|')
for (const r of records) {
  console.log(
    `| ${r.recipe} | ${String(r.words)} | ${String(r.outputTokens)} | ${r.outputRatio.toFixed(2)} | ` +
      `${r.score.toFixed(2)} | ${r.usd.toFixed(3)} |`,
  )
}

const ratios = records.map((r) => r.outputRatio)
if (longRecord !== null && longRecord.outputRatio !== null) ratios.push(longRecord.outputRatio)
console.log(
  ratios.length > 0
    ? `Javasolt outputRatio: ${(Math.ceil(Math.max(...ratios) * 100) / 100).toFixed(2)} ` +
        `(most ${String(translationFor(cleanRecipe).outputRatio)}) — a legnagyobb mért arány, felfelé kerekítve.`
    : 'Nincs mért arány — nincs javaslat.',
)
console.log(`Költés: $${guard.spentUsd().toFixed(2)} · nyers adat: ${RAW_PATH}`)
if (failures.length > 0 || (longRecord !== null && longRecord.error !== null)) process.exit(1)
