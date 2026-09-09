import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { loadConfig, loadDotEnv, loadModelConfig } from '../../src/config.js'
import { createModelClient } from '../../src/model/client.js'
import { createCostGuard, estimateItemUsd } from '../../src/model/budget.js'
import { costOf } from '../../src/model/pricing.js'
import { normalizeItem } from '../../src/pipeline.js'
import { flashcardsRecipe } from '../../src/recipe/flashcards.js'
import { summaryRecipe } from '../../src/recipe/summary.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { folderSource } from '../../src/source/folder.js'
import type { SourceItem } from '../../src/types.js'
import { renderMeasurementReport } from './report.js'
import { stratifiedSample, type SampleCandidate } from './sample.js'
import { aggregate, decide, type RunRecord } from './stats.js'

const RECEPTEK: Recipe[] = [summaryRecipe, flashcardsRecipe]
const MINTA_UTVONAL = join('evals', 'private', 'measurement-items.json')
const NYERS_UTVONAL = join('evals', 'private', 'measurement-raw.json')
const RIPORT_UTVONAL = join('docs', 'measurements', '2026-09-09-iteracio.md')

const { values } = parseArgs({
  options: {
    budget: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    items: { type: 'string', default: '20' },
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
const keret = Number(values.budget)
const ismetlesek = Number(values.repeats)
const elemszam = Number(values.items)

// A CLI is így tölti be a kulcsot: a YAML sosem tartalmazhatja, a `.env`-ből
// (vagy a környezetből) jön (`src/cli.ts`).
loadDotEnv()

const raw = parseYaml(await readFile('refinery.config.yaml', 'utf8')) as Record<string, unknown>
const cfg = loadConfig(raw, 'refinery.config.yaml')
const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)

// 1. Jelöltek: minden elem szószáma. Nulla modellhívás.
const items: SourceItem[] = []
for (const forras of cfg.sources) {
  items.push(...(await folderSource(forras, cfg.languages).discover()))
}
const jeloltek: SampleCandidate[] = []
const atiratok = new Map<string, { item: SourceItem; transcript: string }>()
for (const item of items) {
  try {
    const norm = await normalizeItem(item)
    jeloltek.push({ itemId: item.itemId, words: norm.wordsNormalized })
    atiratok.set(item.itemId, { item, transcript: norm.lines.join(' ') })
  } catch {
    // Sérült feliratfájl: kimarad a mintából, nem állítja meg a mérést.
  }
}

// 2. Minta: ha van rögzített, azt használjuk — az ismétlések csak így
//    ismétlések. Ha nincs, most rögzítjük.
let mintaIdk: string[]
try {
  mintaIdk = JSON.parse(await readFile(MINTA_UTVONAL, 'utf8')) as string[]
  console.log(`A rögzített minta betöltve: ${String(mintaIdk.length)} elem.`)
} catch {
  mintaIdk = stratifiedSample(jeloltek, elemszam / 4)
  await mkdir(join('evals', 'private'), { recursive: true })
  await writeFile(MINTA_UTVONAL, JSON.stringify(mintaIdk, null, 2), 'utf8')
  console.log(`Új minta rögzítve ide: ${MINTA_UTVONAL}`)
}

// 3. Költségkapu a becslésből: a keret fölött el sem indulunk.
const maxIterations = RECEPTEK[0]!.maxIterations
let becsult = 0
for (const id of mintaIdk) {
  const szo = jeloltek.find((j) => j.itemId === id)?.words ?? 0
  becsult += estimateItemUsd(szo, maxIterations, modelConfig) * ismetlesek * RECEPTEK.length
}
console.log(`Becsült költség: $${becsult.toFixed(2)} (keret: $${keret.toFixed(2)})`)
if (becsult > keret) {
  console.error('A becslés a keret fölött van — a mérés nem indul el.')
  process.exit(2)
}

// 4. A mérés. A költségőr a TÉNYLEGES használatból összegez, mert a becslés
//    tévedhet (decisions/0004).
const guard = createCostGuard(keret)
const client = createModelClient(modelConfig)
const eredmenyek = new Map<string, RunRecord[]>()

for (const recipe of RECEPTEK) {
  const rekordok: RunRecord[] = []
  for (const id of mintaIdk) {
    const bejegyzes = atiratok.get(id)
    if (!bejegyzes) continue
    for (let repeat = 0; repeat < ismetlesek; repeat++) {
      if (guard.exceeded()) {
        console.error(`A költségkeret elfogyott ($${guard.spentUsd().toFixed(2)}) — a mérés megáll.`)
        process.exit(1)
      }
      const result = await refine(
        recipe,
        { item: bejegyzes.item, transcript: bejegyzes.transcript },
        client,
        { stopEarly: false },
      )
      for (const kor of result.rounds) {
        guard.add(recipe.role, kor.usage, modelConfig)
      }
      rekordok.push({
        itemId: id,
        repeat,
        scores: result.rounds.map((r) => r.score),
        usdPerRound: result.rounds.map((r) =>
          costOf(r.usage, modelConfig.pricing[recipe.role]),
        ),
      })
      console.log(
        `${recipe.id} ${id} #${String(repeat + 1)}: ${result.rounds.map((r) => r.score.toFixed(2)).join(' → ')}`,
      )
    }
  }
  eredmenyek.set(recipe.id, rekordok)
}

// 5. Kiírás: a nyers adat privát, a riport publikus.
await writeFile(NYERS_UTVONAL, JSON.stringify([...eredmenyek], null, 2), 'utf8')

const receptEredmenyek = RECEPTEK.map((recipe) => {
  const agg = aggregate(eredmenyek.get(recipe.id) ?? [], recipe.rubric.passThreshold)
  return { recipe: recipe.id, agg, decision: decide(agg) }
})

await mkdir(join('docs', 'measurements'), { recursive: true })
await writeFile(
  RIPORT_UTVONAL,
  renderMeasurementReport(receptEredmenyek, {
    items: mintaIdk.length,
    repeats: ismetlesek,
    generations: maxIterations + 1,
    totalUsd: guard.spentUsd(),
    draftModel: modelConfig.models.draft,
    judgeModel: modelConfig.models.judge,
  }),
  'utf8',
)

console.log(`\nKész. Tényleges költés: $${guard.spentUsd().toFixed(2)}`)
console.log(`Riport: ${RIPORT_UTVONAL}`)
for (const r of receptEredmenyek) {
  console.log(`  ${r.recipe}: maxIterations: ${String(r.decision.maxIterations)} — ${r.decision.reason}`)
}
