import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRun } from './cli.js'
import { loadConfig, loadModelConfig } from './config.js'
import { estimateItemUsd } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { normalizeItem } from './pipeline.js'
import { getRecipe } from './recipe/registry.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'

// A git-integrációt a `vault/git.test.ts` fedi. Itt csak arra kell, hogy a
// `commandRun` törzse egy valódi (nem szimulált) hibát kapjon: a
// `gitCommitPaths` eldobása igazolja, hogy egy a törzsben dobott kivétel
// esetén is teljes marad a JSONL napló (lásd a „napló és riport" leírót).
vi.mock('./vault/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./vault/git.js')>()
  return {
    ...actual,
    gitPullFfOnly: vi.fn(() => Promise.resolve(undefined)),
    gitCommitPaths: vi.fn(() => Promise.reject(new Error('szimulált git hiba a teszthez'))),
  }
})

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

/**
 * Hamis modellkliens: a generálás fix szöveget ad, a bíró mindig egyest.
 * A `hivasok` a tényleges generálások számát számolja — ezen múlik, hogy a
 * szeletelés tényleg csak a tervezett elemeket futtatta-e.
 */
function hamisKliens(hivasok: { generate: number }): ModelClient {
  return {
    // A `ModelClient` interfész Promise-t vár vissza; itt nincs mire várni,
    // de az `async` a szerződés, nem hiba.
    // eslint-disable-next-line @typescript-eslint/require-await
    async generate() {
      hivasok.generate++
      return {
        value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async generateObject<T>() {
      // A bíró ítéletének alakja: pontszám és hiánylista (rubric/judge.ts).
      return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }
    },
  }
}

/**
 * A modellréteg konfigurációja a YAML-ból jön; egyedül a kulcs a környezetből.
 * Az értékek szintaktikailag érvényesek, de nem valódiak — a becslési szakasz
 * sosem hív ki hálózatot.
 */
const rawConfig = (costLimitUsd: number) => ({
  vault: { path: '/nemletezo/vault' },
  sources: [downloads],
  state: { path: join(work, 'state.db') },
  logs: { dir: join(work, 'logs') },
  model: {
    base_url: 'http://localhost:4000/v1',
    draft: 'proba-draft',
    judge: 'proba-judge',
  },
  pricing: {
    draft: { input_per_million: 3, output_per_million: 15 },
    judge: { input_per_million: 0.2, output_per_million: 0.5 },
  },
  cost_limit_usd: costLimitUsd,
})

/** Konfiguráció valódi, ideiglenes vaulttal: a publikálás így tényleg lefut. */
const rawWithVault = (costLimitUsd: number) => ({
  ...rawConfig(costLimitUsd),
  vault: { path: vault },
})

let savedApiKey: string | undefined
let work: string
let downloads: string
let vault: string

beforeEach(async () => {
  savedApiKey = process.env.LITELLM_API_KEY
  process.env.LITELLM_API_KEY = 'sk-proba'

  work = await mkdtemp(join(tmpdir(), 'refinery-cli-'))
  downloads = join(work, 'downloads')
  await mkdir(downloads, { recursive: true })
  vault = join(work, 'vault')
  await mkdir(vault, { recursive: true })
})

afterEach(async () => {
  if (savedApiKey === undefined) delete process.env.LITELLM_API_KEY
  else process.env.LITELLM_API_KEY = savedApiKey
  await rm(work, { recursive: true, force: true })
})

describe('commandRun — a recept-becslés költségkapui', () => {
  it('a plafon fölötti becslés nulla modellhívással megállítja a köteget', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)
    expect(cost).toBeGreaterThan(0)

    // A plafon szándékosan a becsült költség fele — a becslésnek meg kell
    // állítania a köteget, mielőtt bármi lefutna.
    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })

    expect(code).toBe(2)

    const store = openState(cfg.statePath)
    expect(store.artifactOf(item!.itemId, 'summary')).toBeNull()
    store.close()
  })

  it('a már kész elem kimarad a becslésből, ezért a köteg nem torpan meg a plafonnál', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)
    expect(cost).toBeGreaterThan(0)

    // Előre megjelöljük az elemet késznek — mind az átiratra, mind a
    // receptre —, mielőtt a `commandRun` a saját store-ját megnyitná. Ez
    // szimulálja a hibajelentésben leírt helyzetet: egy köteg, ami egyszer
    // már sikeresen lefutott.
    const pre = openState(cfg.statePath)
    pre.recordItem(item!)
    pre.recordArtifact(item!.itemId, 'transcript', 'done', '/valahol/_transcript.md', null)
    pre.recordArtifact(item!.itemId, recipe.id, 'done', null, null, {
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
    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
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

describe('commandRun — a szűrők', () => {
  it('ismeretlen --source névre egyetlen elem sem marad', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    // A plafon a becsült költség fele: szűrés nélkül a köteg 2-vel megállna.
    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      source: 'nincs-ilyen-forras',
      dryRun: true,
      force: false,
      commit: false,
    })

    expect(code).toBe(0)
  })

  it('metaadat nélküli elemre a --channel szűrő nem illik', async () => {
    // Felirat info.json NÉLKÜL: az elemnek nincs csatornája.
    const dir = join(downloads, 'youtube', 'Csatorna A')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'Metaadat nélküli.en.srt'), SRT, 'utf8')

    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    expect(item!.metadata.channel).toBeUndefined()

    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      channel: 'Csatorna A',
      dryRun: true,
      force: false,
      commit: false,
    })

    expect(code).toBe(0)
  })
})

describe('commandRun — napló és riport', () => {
  it('a futás után napló és riport is van a naplómappában', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    expect(code).toBe(0)
    const files = await readdir(cfg.logsDir)
    expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(1)
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(1)
  })

  it('a napló minden sora önállóan értelmezhető JSON', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const lines = (await readFile(join(cfg.logsDir, jsonl), 'utf8')).trim().split('\n')

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
  })

  it('a riport megnevezi a felirat-forrás szerinti bontást', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')

    expect(report).toMatch(/kreátori \d+ \/ automatikus \d+/)
    expect(report).toContain('## A korpusz állapota')
  })

  it('a megszakítás riportot hagy maga után, és 130-cal lép ki', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    let exitCode: number | undefined
    let interrupted: () => void
    const exited = new Promise<void>((resolve) => (interrupted = resolve))

    await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false },
      {
        // A megszakítás közvetlenül a kezelő beszerelése után érkezik.
        signals: {
          on(_event: string, listener: () => void) {
            setTimeout(listener, 0)
            return this
          },
        },
        exit: (code: number) => {
          exitCode = code
          interrupted()
        },
      },
    )
    await exited

    expect(exitCode).toBe(130)
    expect((await readdir(cfg.logsDir)).some((f) => f.endsWith('.md'))).toBe(true)
  })

  it('a becslési plafon-túllépés is riportot hagy maga után', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    // A plafon szándékosan a becsült költség fele — a becslésnek meg kell
    // állítania a köteget, mielőtt bármi lefutna.
    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })

    expect(code).toBe(2)
    expect((await readdir(cfg.logsDir)).some((f) => f.endsWith('.md'))).toBe(true)
  })

  it('a riport Parancs sora megnevezi az indító parancssort', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    await commandRun(cfg, raw, {
      source: 'downloads',
      dryRun: false,
      force: false,
      commit: false,
      command: 'run --source downloads',
    })

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')

    expect(report).toContain('Parancs: `run --source downloads`')
  })

  it('a törzsben dobott hiba után is teljes marad a napló', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    // A `gitCommitPaths` a fájl tetején mockolva dob — ez egy a `try`
    // törzsében, a napló megnyitása UTÁN dobott, valódi kivétel, nem
    // szimulált seam. A `finally`-nek enélkül is le kell zárnia a naplót.
    await expect(
      commandRun(cfg, raw, { dryRun: false, force: false, commit: true }),
    ).rejects.toThrow('szimulált git hiba')

    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const lines = (await readFile(join(cfg.logsDir, jsonl), 'utf8')).trim().split('\n')

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
  })

  it('a megszakítás után a normál befejezés nem ír riportot kétszer', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    let interrupted: () => void
    const exited = new Promise<void>((resolve) => (interrupted = resolve))

    await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false },
      {
        // A megszakítás közvetlenül a kezelő beszerelése után érkezik, a
        // normál befejezéssel versenyezve.
        signals: {
          on(_event: string, listener: () => void) {
            setTimeout(listener, 0)
            return this
          },
        },
        exit: () => interrupted(),
      },
    )
    // Az `exit` csak a megszakítás-ág `finish(true)`-ja UTÁN fut le — ha ez
    // megtörtént, a versengő ág biztosan lezárult, akármelyik nyerte az őrt.
    await exited

    const riportLines = logSpy.mock.calls.filter(
      ([line]) => typeof line === 'string' && line.includes('Riport:'),
    )
    logSpy.mockRestore()

    expect(riportLines).toHaveLength(1)
  })
})

describe('commandRun — a plafon szeletel', () => {
  it('a plafon alá férő elemeket futtatja, a többit a következő futásra hagyja', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    await makeVideo(downloads, 'a3', 'Harmadik videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const egy = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    // A plafon két elemre elég, háromra nem: a harmadik marad.
    const limited = { ...rawWithVault(egy * 2.5) }
    const hivasok = { generate: 0 }
    const code = await commandRun(
      loadConfig(limited, '/p/refinery.config.yaml'),
      limited,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(2)

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    expect(await readFile(join(cfg.logsDir, md), 'utf8')).toContain('1 elem hátravan')
  })

  it('ha egy elem sem fér a plafon alá, el sem indul', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')

    const limited = rawWithVault(0.000001)
    const hivasok = { generate: 0 }
    const code = await commandRun(
      loadConfig(limited, '/p/refinery.config.yaml'),
      limited,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(code).toBe(2)
    expect(hivasok.generate).toBe(0)
  })
})
