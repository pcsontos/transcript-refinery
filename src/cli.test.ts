import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandRun } from './cli.js'
import { loadModelConfig, type Config } from './config.js'
import { estimateItemUsd } from './model/budget.js'
import { normalizeItem } from './pipeline.js'
import { getRecipe } from './recipe/registry.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'

/**
 * A `loadModelConfig`-hoz szükséges változók. Az értékek szintaktikailag
 * érvényesek, de nem valódiak — a becslési szakasz sosem hív ki hálózatot,
 * és a lenti fixture-elemek mindig `done`-ként előre megjelöltek, mielőtt a
 * `commandRun` a saját feldolgozó ciklusához érne, tehát a tényleges
 * modellkliens sosem kap hívást.
 */
const MODEL_ENV_KEYS = [
  'LITELLM_BASE_URL',
  'LITELLM_API_KEY',
  'REFINERY_MODEL_DRAFT',
  'REFINERY_MODEL_JUDGE',
  'REFINERY_PRICE_DRAFT_IN',
  'REFINERY_PRICE_DRAFT_OUT',
  'REFINERY_PRICE_JUDGE_IN',
  'REFINERY_PRICE_JUDGE_OUT',
  'REFINERY_COST_LIMIT_USD',
] as const

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ez egy hosszabb mondat a becsléshez.

2
00:00:01,000 --> 00:00:03,000
Ez egy hosszabb mondat a becsléshez.

3
00:00:02,000 --> 00:00:04,000
Egy második, ettől eltérő mondat is van itt.
`

async function makeVideo(downloads: string, id: string, title: string, channel: string) {
  const dir = join(downloads, 'youtube', channel)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${title}.info.json`),
    JSON.stringify({
      id,
      title,
      channel,
      upload_date: '20260714',
      webpage_url: `https://www.youtube.com/watch?v=${id}`,
    }),
    'utf8',
  )
  await writeFile(join(dir, `${title}.en.srt`), SRT, 'utf8')
}

function makeConfig(downloads: string, statePath: string): Config {
  return {
    // A vaultPath/notesRoot sosem kerül ténylegesen megnyitásra ezekben a
    // tesztekben: `commit: false`-szal hívunk, és a 2. teszt fixture-eleme
    // előre `done`-ként van jelölve, tehát a feldolgozó ciklus a git- és
    // vault-műveleteket, illetve a fájlírást sosem éri el.
    vaultPath: '/nemletezo/vault',
    notesRoot: '/nemletezo/vault/Resources/Videos/YouTube',
    pinchflatDownloads: downloads,
    statePath,
  }
}

let savedEnv: Record<string, string | undefined>
let work: string
let downloads: string

beforeEach(async () => {
  savedEnv = Object.fromEntries(MODEL_ENV_KEYS.map((key) => [key, process.env[key]]))
  process.env.LITELLM_BASE_URL = 'http://localhost:4000/v1'
  process.env.LITELLM_API_KEY = 'sk-proba'
  process.env.REFINERY_MODEL_DRAFT = 'proba-draft'
  process.env.REFINERY_MODEL_JUDGE = 'proba-judge'
  process.env.REFINERY_PRICE_DRAFT_IN = '3.00'
  process.env.REFINERY_PRICE_DRAFT_OUT = '15.00'
  process.env.REFINERY_PRICE_JUDGE_IN = '0.20'
  process.env.REFINERY_PRICE_JUDGE_OUT = '0.50'
  // A tesztesetek felülírják a saját plafonjukra; ez csak egy biztonságos
  // alapérték, hogy a `loadModelConfig` sose bukjon hiányzó változón.
  process.env.REFINERY_COST_LIMIT_USD = '5.00'

  work = await mkdtemp(join(tmpdir(), 'refinery-cli-'))
  downloads = join(work, 'downloads')
  await mkdir(downloads, { recursive: true })
})

afterEach(() => {
  for (const key of MODEL_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('commandRun — a recept-becslés költségkapui', () => {
  it('a plafon fölötti becslés nulla modellhívással megállítja a köteget', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = makeConfig(downloads, join(work, 'state.db'))

    const [item] = await folderSource(downloads).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(process.env)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)
    expect(cost).toBeGreaterThan(0)

    // A plafon szándékosan a becsült költség fele — a becslésnek meg kell
    // állítania a köteget, mielőtt bármi lefutna.
    process.env.REFINERY_COST_LIMIT_USD = String(cost / 2)

    const code = await commandRun(cfg, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })

    expect(code).toBe(2)

    const store = openState(cfg.statePath)
    expect(store.artifactOf('a1', 'summary')).toBeNull()
    store.close()
  })

  it('a már kész elem kimarad a becslésből, ezért a köteg nem torpan meg a plafonnál', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = makeConfig(downloads, join(work, 'state.db'))

    const [item] = await folderSource(downloads).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(process.env)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)
    expect(cost).toBeGreaterThan(0)

    // Előre megjelöljük az elemet késznek — mind az átiratra, mind a
    // receptre —, mielőtt a `commandRun` a saját store-ját megnyitná. Ez
    // szimulálja a hibajelentésben leírt helyzetet: egy köteg, ami egyszer
    // már sikeresen lefutott.
    const pre = openState(cfg.statePath)
    pre.recordVideo(item!)
    pre.recordArtifact(item!.videoId, 'transcript', 'done', '/valahol/_transcript.md', null)
    pre.recordArtifact(item!.videoId, recipe.id, 'done', null, null, {
      iterations: 1,
      score: 1,
      costUsd: cost,
      model: modelConfig.models.draft,
    })
    pre.close()

    // A plafon a MÁR KÉSZ elem becsült költségének fele. A hibás
    // (javítatlan) kód ezt az elemet is beleszámolná a becslésbe, és emiatt
    // a plafon fölé esne — a helyes viselkedés a kész elemet kihagyja, tehát
    // a becslés (üres pending-lista) mindig a plafon alatt marad.
    process.env.REFINERY_COST_LIMIT_USD = String(cost / 2)

    const code = await commandRun(cfg, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })

    // A becslési kapu nem állíthatja meg a futást — ez bizonyítja, hogy a
    // már kész elem valóban kimaradt a becslésből.
    expect(code).not.toBe(2)
    // Az elem mindkét szempontból kész, tehát a feldolgozó ciklus is csak
    // kihagyja — nulla új modellhívással, nulla hibával.
    expect(code).toBe(0)
  })
})
