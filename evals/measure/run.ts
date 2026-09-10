import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { loadConfig, loadDotEnv, loadModelConfig } from '../../src/config.js'
import { createModelClient } from '../../src/model/client.js'
import { createCostGuard, estimateItemUsd } from '../../src/model/budget.js'
import { costOf } from '../../src/model/pricing.js'
import { retrying } from '../../src/model/retry.js'
import { normalizeItem } from '../../src/pipeline.js'
import { flashcardsRecipe } from '../../src/recipe/flashcards.js'
import { summaryRecipe } from '../../src/recipe/summary.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { folderSource } from '../../src/source/folder.js'
import type { SourceItem } from '../../src/types.js'
import { metered } from './metered.js'
import { rateLimited } from './rate-limit.js'
import { renderMeasurementReport } from './report.js'
import { stratifiedSample, type SampleCandidate } from './sample.js'
import { aggregate, decide, type RunRecord } from './stats.js'

const RECIPES: Recipe[] = [summaryRecipe, flashcardsRecipe]
const SAMPLE_PATH = join('evals', 'private', 'measurement-items.json')
const RAW_PATH = join('evals', 'private', 'measurement-raw.json')
const REPORT_PATH = join('docs', 'measurements', '2026-09-09-iteracio.md')

const { values } = parseArgs({
  options: {
    budget: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    items: { type: 'string', default: '20' },
    /** Hány elemre szűkítsük a rögzített mintát — pilóta futáshoz. */
    limit: { type: 'string' },
    /**
     * Percenkénti kéréskorlát. A gateway kulcsonként 20-nál elvágja; a
     * mérés ezernél több hívást indít, tehát alatta kell maradni.
     */
    rpm: { type: 'string', default: '18' },
  },
})

if (!values.budget) {
  console.error(
    'Kötelező a --budget kapcsoló, dollárban. Alapértelmezés szándékosan nincs:\n' +
      'a mérés valódi pénzt költ, ezért a keretet minden futásnál ki kell mondani.\n' +
      'Példa: pnpm measure --budget 10',
  )
  process.exit(2)
}

/**
 * Számot váró kapcsoló beolvasása.
 *
 * Ez nem formaság: a `Number('tiz')` `NaN`, és minden `NaN`-nal végzett
 * összehasonlítás hamis. Validálás nélkül egy elgépelt `--budget` átengedné az
 * indulási kapun a futást, **és** a költségőr `spent > NaN` feltétele is
 * örökre hamis maradna — vagyis egyetlen elütés kikapcsolná a teljes
 * költségvédelmet egy valódi pénzt költő szkriptnél.
 */
function readNumber(name: string, value: string | undefined, integer = false): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    console.error(
      `A --${name} értéke ${integer ? 'pozitív egész' : 'pozitív szám'} kell legyen, kapott: ${String(value)}`,
    )
    process.exit(2)
  }
  return n
}

const budget = readNumber('budget', values.budget)
const repeats = readNumber('repeats', values.repeats, true)
const itemCount = readNumber('items', values.items, true)
const rpm = readNumber('rpm', values.rpm, true)

// A rétegzés négy negyedbe oszt, tehát az elemszámnak oszthatónak kell lennie.
// Enélkül a `stratifiedSample` nem egész `perStratum`-ot kapna, és némán
// kevesebb — szélsőséges esetben nulla — elemet adna vissza.
if (itemCount % 4 !== 0) {
  console.error(`A --items értéke néggyel osztható kell legyen, kapott: ${String(itemCount)}`)
  process.exit(2)
}

// A CLI is így tölti be a kulcsot: a YAML sosem tartalmazhatja, a `.env`-ből
// (vagy a környezetből) jön (`src/cli.ts`).
loadDotEnv()

const raw = parseYaml(await readFile('refinery.config.yaml', 'utf8')) as Record<string, unknown>
const cfg = loadConfig(raw, 'refinery.config.yaml')
const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)

// 1. Jelöltek: minden elem szószáma. Nulla modellhívás.
const items: SourceItem[] = []
for (const source of cfg.sources) {
  items.push(...(await folderSource(source, cfg.languages).discover()))
}
const candidates: SampleCandidate[] = []
const transcripts = new Map<string, { item: SourceItem; transcript: string }>()
for (const item of items) {
  try {
    const normalized = await normalizeItem(item)
    candidates.push({ itemId: item.itemId, words: normalized.wordsNormalized })
    transcripts.set(item.itemId, { item, transcript: normalized.lines.join(' ') })
  } catch {
    // Sérült feliratfájl: kimarad a mintából, nem állítja meg a mérést.
  }
}

// 2. Minta: ha van rögzített, azt használjuk — az ismétlések csak így
//    ismétlések. Ha nincs, most rögzítjük.
let sampleIds: string[]
try {
  sampleIds = JSON.parse(await readFile(SAMPLE_PATH, 'utf8')) as string[]
  console.log(`A rögzített minta betöltve: ${String(sampleIds.length)} elem.`)
} catch {
  sampleIds = stratifiedSample(candidates, itemCount / 4)
  await mkdir(join('evals', 'private'), { recursive: true })
  await writeFile(SAMPLE_PATH, JSON.stringify(sampleIds, null, 2), 'utf8')
  console.log(`Új minta rögzítve ide: ${SAMPLE_PATH}`)
}

// A `--limit` a rögzített mintát szűkíti, de **nem írja felül** a fájlt: a
// pilóta futás nem ronthatja el a teljes mérés mintáját. A szűkítés minden
// negyedből vesz, hogy a pilóta is lásson rövid és hosszú elemet is.
if (values.limit) {
  const n = Number(values.limit)
  const step = Math.max(1, Math.floor(sampleIds.length / n))
  sampleIds = sampleIds.filter((_, i) => i % step === 0).slice(0, n)
  console.log(`Pilóta: a minta ${String(sampleIds.length)} elemre szűkítve.`)
}

// 3. Költségkapu a becslésből: a budget fölött el sem indulunk.
let estimated = 0
for (const id of sampleIds) {
  const words = candidates.find((j) => j.itemId === id)?.words ?? 0
  // Receptenként külön: a Feladat 6 épp receptenkénti maxIterations-re
  // állítja őket, és onnantól egyetlen közös érték az egyikre hazudna.
  for (const recipe of RECIPES) {
    estimated += estimateItemUsd(words, recipe.maxIterations, modelConfig) * repeats
  }
}
console.log(`Becsült költség: $${estimated.toFixed(2)} (budget: $${budget.toFixed(2)})`)
if (estimated > budget) {
  console.error('A becslés a budget fölött van — a mérés nem indul el.')
  process.exit(2)
}

// 4. A mérés. A költségőr a TÉNYLEGES használatból összegez, mert a becslés
//    tévedhet (decisions/0004).
const guard = createCostGuard(budget)
// A burkolók sorrendje számít, kívülről befelé:
//   metered   — minden TÉNYLEGES hívás a saját szerepe árán könyvelődik, akkor
//               is, ha a `refine` később dob. Legbelül van, hogy az
//               újrapróbálkozás minden kísérletét külön lássa.
//   rateLimited — a gateway percenkénti korlátja alatt tart.
//   retrying  — a produkciós csővezeték mintája: a hívás szintjén véd.
const client = retrying(
  rateLimited(metered(createModelClient(modelConfig), guard, modelConfig), {
    perMinute: rpm,
  }),
)
const results = new Map<string, RunRecord[]>()
const failures: { recipe: string; itemId: string; repeat: number; message: string }[] = []

/** Részeredmény kiírása, hogy egy összeomlás ne vigye el az addigi munkát. */
async function saveRawData(): Promise<void> {
  await mkdir(join('evals', 'private'), { recursive: true })
  await writeFile(
    RAW_PATH,
    JSON.stringify({ results: [...results], failures }, null, 2),
    'utf8',
  )
}

for (const recipe of RECIPES) {
  const records: RunRecord[] = []
  results.set(recipe.id, records)
  for (const id of sampleIds) {
    const entry = transcripts.get(id)
    if (!entry) continue
    for (let repeat = 0; repeat < repeats; repeat++) {
      if (guard.exceeded()) {
        console.error(`A költségkeret elfogyott ($${guard.spentUsd().toFixed(2)}) — a mérés megáll.`)
        await saveRawData()
        process.exit(1)
      }
      // Egy elem bukása nem viheti el az egész mérést. A produkciós
      // csővezeték is elemenként kapja el a hibát; itt ugyanez a logika,
      // különben egyetlen séma-hiba órákat töröl el eredmény nélkül.
      try {
        const result = await refine(
          recipe,
          { item: entry.item, transcript: entry.transcript },
          client,
          { stopEarly: false },
        )
        // A könyvelés a `metered` burkolóban történik, hívásonként és a
        // hívás saját szerepe szerint — itt már nem lenne ismert, melyik
        // token melyik modellé, és a bukott futások kimaradnának.
        records.push({
          itemId: id,
          repeat,
          scores: result.rounds.map((r) => r.score),
          // Szerepenként külön árazva: a bíró tokenjei a bíró árán mennek.
          // Összevonva a vázlatmodell ára két és félszeres túlbecslést adna,
          // és épp ez a szám kerülne a publikált riportba.
          usdPerRound: result.rounds.map(
            (r) =>
              costOf(r.generateUsage, modelConfig.pricing[recipe.role]) +
              costOf(r.scoreUsage, modelConfig.pricing.judge),
          ),
        })
        console.log(
          `${recipe.id} ${id} #${String(repeat + 1)}: ${result.rounds.map((r) => r.score.toFixed(2)).join(' → ')}`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ recipe: recipe.id, itemId: id, repeat, message })
        console.error(`${recipe.id} ${id} #${String(repeat + 1)}: HIBA — ${message}`)
      }
      await saveRawData()
    }
  }
}

// 5. Kiírás: a nyers adat privát, a riport publikus.
await saveRawData()
if (failures.length > 0) {
  console.error(`\n${String(failures.length)} futás bukott el a mérés során.`)
}

// Egy recept, aminek minden futása elbukott, kimarad a riportból — döntést
// nulla adatból nem hozunk. A tény viszont látható marad a konzolon.
const recipeResults = RECIPES.flatMap((recipe) => {
  const agg = aggregate(results.get(recipe.id) ?? [], recipe.rubric.passThreshold)
  if (agg.rounds.length === 0) {
    console.error(`${recipe.id}: egyetlen sikeres futás sincs — kimarad a riportból.`)
    return []
  }
  return [{ recipe: recipe.id, agg, decision: decide(agg) }]
})

if (recipeResults.length === 0) {
  console.error('Egyetlen recept sem adott értékelhető adatot — riport nem készül.')
  process.exit(1)
}

await mkdir(join('docs', 'measurements'), { recursive: true })
await writeFile(
  REPORT_PATH,
  renderMeasurementReport(recipeResults, {
    // A ténylegesen mért elemek száma, nem a tervezetté: ha egy azonosítóhoz
    // nem tartozik átirat (a korpusz változott), vagy minden futása elbukott,
    // a riport nem állíthatja, hogy húsz elemet mért.
    items: new Set(
      [...results.values()].flatMap((rs) => rs.map((r) => r.itemId)),
    ).size,
    repeats: repeats,
    generations: Math.max(...RECIPES.map((r) => r.maxIterations)) + 1,
    totalUsd: guard.spentUsd(),
    draftModel: modelConfig.models.draft,
    judgeModel: modelConfig.models.judge,
  }),
  'utf8',
)

console.log(`\nKész. Tényleges költés: $${guard.spentUsd().toFixed(2)}`)
console.log(`Riport: ${REPORT_PATH}`)
for (const r of recipeResults) {
  console.log(`  ${r.recipe}: maxIterations: ${String(r.decision.maxIterations)} — ${r.decision.reason}`)
}
