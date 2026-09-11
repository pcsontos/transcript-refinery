import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandCheckPricing, commandRun, commandScan, commandScanQueue } from './cli.js'
import { loadConfig, loadModelConfig } from './config.js'
import type { RunEvent } from './events.js'
import { estimateItemUsd } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { normalizeItem } from './pipeline.js'
import { queuePath } from './queue/file.js'
import { getRecipe } from './recipe/registry.js'
import { runId } from './run/id.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'
import type { ModelRole } from './types.js'
import { gitCommitPaths } from './vault/git.js'
import { lintVaultMarkdown } from './vault/lint.js'
import { noteFile } from './vault/paths.js'

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
 * Feliratfájl egyetlen értelmezhető feliratblokk nélkül: a `normalizeItem`
 * dob rá, tehát az elem a feldolgozás hibaágára kerül.
 */
async function makeBrokenVideo(downloads: string, id: string, title: string, channel: string) {
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
  await writeFile(join(dir, `${title}.en.srt`), '', 'utf8')
}

/**
 * Hamis modellkliens: a generálás fix szöveget ad, a bíró mindig egyest.
 * A `hivasok` a tényleges generálások számát számolja — ezen múlik, hogy a
 * szeletelés tényleg csak a tervezett elemeket futtatta-e.
 *
 * Az `onGenerate` horog a hányadik generálást kapja meg; a megszakítási
 * teszt ebből süti el a hamis SIGINT-et, pontosan a köteg közepén.
 */
function hamisKliens(
  hivasok: { generate: number },
  onGenerate?: (hanyadik: number) => void,
): ModelClient {
  return {
    // A `ModelClient` interfész Promise-t vár vissza; itt nincs mire várni,
    // de az `async` a szerződés, nem hiba.
    // eslint-disable-next-line @typescript-eslint/require-await
    async generate() {
      hivasok.generate++
      onGenerate?.(hivasok.generate)
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

  it('a megszakítás a addig elkészült elemekről ír riportot, és 130-cal lép ki', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    // A második elem átirata ELŐRE kész: így a második elem feldolgozása
    // egyenesen a generálásnál tart, amikor a jel érkezik, és a riportnak
    // pontosan egy elkészült elemet kell számolnia.
    const items = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const pre = openState(cfg.statePath)
    const masodik = items.find((i) => i.itemId === 'a2')!
    pre.recordItem(masodik)
    pre.recordArtifact('a2', 'transcript', 'done', join(vault, 'a2_transcript.md'), null)
    pre.close()

    let exitCode: number | undefined
    let sigint: (() => void) | undefined
    let interrupted: () => void
    const exited = new Promise<void>((resolve) => (interrupted = resolve))

    const hivasok = { generate: 0 }
    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      {
        // A jel nem a kezelő beszerelésekor, hanem a MÁSODIK elem
        // generálásakor érkezik: az első elem ekkor már publikálva van.
        signals: {
          on(_event: string, listener: () => void) {
            sigint = listener
            return this
          },
        },
        exit: (code: number) => {
          exitCode = code
          interrupted()
        },
        createClient: () =>
          hamisKliens(hivasok, (hanyadik) => {
            if (hanyadik === 2) sigint?.()
          }),
      },
    )
    await exited

    expect(exitCode).toBe(130)

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    // A megszakításig pontosan egy elem készült el.
    expect(report).toContain('| sikeres | 1 ')
  })

  it('a plafon alatti megállás üzenete megnevezi a becsült költséget és a plafont', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    // Ebben a nagyságrendben a két tizedes mindkét számot nullának mutatná —
    // pontosan ezért formáz a `run:aborted` négy tizedessel.
    expect(cost.toFixed(2)).toBe('0.00')
    expect(cost.toFixed(4)).not.toBe('0.0000')
    expect((cost / 2).toFixed(4)).not.toBe('0.0000')

    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })
    const megallt: string[] = []
    for (const [line] of logSpy.mock.calls) {
      if (typeof line === 'string' && line.startsWith('A futás megállt:')) megallt.push(line)
    }
    logSpy.mockRestore()

    expect(code).toBe(2)
    expect(megallt).toHaveLength(1)
    // Az 5. sikerkritérium: az üzenet megnevezi a becsült költséget ÉS a plafont.
    expect(megallt[0]).toContain(`${cost.toFixed(4)} $`)
    expect(megallt[0]).toContain(`${(cost / 2).toFixed(4)} $`)

    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const aborted = (await readFile(join(cfg.logsDir, jsonl), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RunEvent)
      .find((e) => e.type === 'run:aborted')
    expect(aborted).toMatchObject({ limitUsd: cost / 2 })
    expect(aborted?.type === 'run:aborted' && aborted.reason).toContain(`${cost.toFixed(4)} $`)
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

  it('a törzsben dobott hiba után is elkészül a riport', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    // A `gitCommitPaths` mockja dob. A riport a `finally`-ből is elkészül:
    // egy git-hiba vagy tele lemez enélkül naplót hagyna, riportot nem.
    await expect(
      commandRun(cfg, raw, { dryRun: false, force: false, commit: true }),
    ).rejects.toThrow('szimulált git hiba')

    expect((await readdir(cfg.logsDir)).some((f) => f.endsWith('.md'))).toBe(true)
  })

  it('nem ír bele egy már létező futás naplójába', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    // Előre lefoglaljuk azt a két másodpercet, amelyikben a futás indulhat:
    // bármelyikben indul is, a bázisnév foglalt, tehát utótagot kell kapnia.
    await mkdir(cfg.logsDir, { recursive: true })
    const most = new Date()
    const foglalt = [runId(most), runId(new Date(most.getTime() + 1000))]
    for (const id of foglalt) await writeFile(join(cfg.logsDir, `${id}.jsonl`), '', 'utf8')

    await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    // Egyik korábbi napló sem hízott meg.
    for (const id of foglalt) {
      expect(await readFile(join(cfg.logsDir, `${id}.jsonl`), 'utf8')).toBe('')
    }
    const files = await readdir(cfg.logsDir)
    expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(3)
    expect(files.some((f) => f.endsWith('-2.jsonl'))).toBe(true)
    expect(files.some((f) => f.endsWith('-2.md'))).toBe(true)
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

describe('commandRun — --retry-failed', () => {
  it('csak a korábban elbukott elemeket futtatja', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const pre = openState(cfg.statePath)
    for (const i of await folderSource({ name: 'downloads', path: downloads }, []).discover()) {
      pre.recordItem(i)
    }
    pre.recordArtifact('a1', 'transcript', 'done', '/v/a1.md', null)
    pre.recordArtifact('a2', 'transcript', 'failed', null, 'olvashatatlan felirat')
    pre.close()

    const code = await commandRun(cfg, raw, {
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const log = await readFile(join(cfg.logsDir, jsonl), 'utf8')
    expect(log).toContain('"itemId":"a2"')
    expect(log).not.toContain('"itemId":"a1"')
  })

  it('hibás elem nélkül nulla elemmel fut le', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, {
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    expect(await readFile(join(cfg.logsDir, jsonl), 'utf8')).toContain(
      '"type":"scan:found","count":0',
    )
  })

  it('a --retry-failed a --limit szűrővel együtt is a hibás elemet választja, nem az elöl álló készet', async () => {
    // a1 KÉSZ, a2 HIBÁS — a felfedezési sorrend a1, a2. Egy hibás sorrendű
    // szűrés (limit előbb, mint a hibás-szűrő) az elöl álló a1-et választaná
    // ki és azt dobná el (mert nem hibás), így nulla elemmel futna le. A
    // helyes sorrend a hibásokra szűkít, ÉS UTÁNA vág a limitre — tehát a2-t
    // kell választania.
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const pre = openState(cfg.statePath)
    for (const i of await folderSource({ name: 'downloads', path: downloads }, []).discover()) {
      pre.recordItem(i)
    }
    pre.recordArtifact('a1', 'transcript', 'done', '/v/a1.md', null)
    pre.recordArtifact('a2', 'transcript', 'failed', null, 'hiba')
    pre.close()

    const code = await commandRun(cfg, raw, {
      limit: 1,
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const log = await readFile(join(cfg.logsDir, jsonl), 'utf8')
    expect(log).toContain('"itemId":"a2"')
    expect(log).not.toContain('"itemId":"a1"')
  })

  it('--recipe mellett, ha a receptre nincs egyetlen rekord sem, nulla elemmel fut le', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    expect(await readFile(join(cfg.logsDir, jsonl), 'utf8')).toContain(
      '"type":"scan:found","count":0',
    )
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

describe('commandRun — a riport folytatási javaslata', () => {
  it('a javaslatból kimarad a --limit, hogy a folytatás a hátralévőket vigye', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    await makeVideo(downloads, 'a3', 'Harmadik videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      {
        recipe: 'summary',
        limit: 2,
        dryRun: false,
        force: false,
        commit: false,
        command: 'run --recipe summary --limit 2',
      },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(code).toBe(0)
    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')

    expect(report).toContain('1 elem hátravan')
    expect(report).toContain('Folytatás: `run --recipe summary`')
  })

  it('hátralévő elem nélkül, hibással a --retry-failed-et ajánlja', async () => {
    // Átirat-futás: a sérült elem `transcript` típusra hibás, tehát a korpusz
    // végigment (nincs hátralévő), de maradt hibás elem — ez a reggel-utáni
    // eset, amiért a --retry-failed egyáltalán elkészült.
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeBrokenVideo(downloads, 'a2', 'Sérült videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, {
      limit: 5,
      dryRun: false,
      force: false,
      commit: false,
      command: 'run --limit 5',
    })

    expect(code).toBe(1)
    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')

    expect(report).toContain('A korpusz feldolgozva, de maradtak hibás elemek.')
    // A --limit kimarad a javaslatból, a --retry-failed rákerül.
    expect(report).toContain('Újrapróbálás: `run --retry-failed`')
  })
})

describe('commandRun — a megszakadt köteg folytatása', () => {
  it('a megszakadt köteg folytatása a kész elemre nulla modellhívást tesz', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }

    // Első futás: csak egy elem — ez a „megszakadt" köteg.
    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', limit: 1, dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )
    const elsoUtan = hivasok.generate
    expect(elsoUtan).toBeGreaterThan(0)

    // Második futás: mindkét elem sorra kerül, de a kész elem egyetlen
    // hívást sem termel — a második elem ugyanannyiba kerül, mint az első.
    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(hivasok.generate).toBe(elsoUtan * 2)
  })
})

describe('commandRun — a hibás elem a naplóban és a riportban', () => {
  it('a normalizáláson elbukó elem hibaként jelenik meg, és a kilépőkód 1', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeBrokenVideo(downloads, 'a2', 'Sérült videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    // A sérült elem nem eshet ki némán: hibás elem van, tehát a kilépőkód 1.
    expect(code).toBe(1)

    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const events = (await readFile(join(cfg.logsDir, jsonl), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RunEvent)
    const failed = events.filter((e) => e.type === 'item:failed')
    // Recept-futásban a normalizáláson elbukó elem mindkét érintett típus
    // alatt hibás: típusonként egy esemény.
    expect(failed).toHaveLength(2)
    // A JSONL sor is megnevezi a forrásmappát — ugyanaz a bizonyítékigény
    // egy szinttel a riport alatt.
    expect(failed[0]).toMatchObject({ itemId: 'a2', source: 'downloads', kind: 'transcript' })
    expect(failed[1]).toMatchObject({ itemId: 'a2', source: 'downloads', kind: 'summary' })

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    expect(report).toContain('## Hibák')
    // A spec §2.2: elemenként az azonosító, a típus, a FORRÁSMAPPA NEVE és az ok.
    expect(report).toMatch(/\| `a2` \| transcript \| downloads \| .+ \|/)
    expect(report).toMatch(/\| `a2` \| summary \| downloads \| .+ \|/)
  })

  it('a már feldolgozott korpuszon a második futás kihagyottnak jelenti az elemeket', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    await makeVideo(downloads, 'a3', 'Harmadik videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const hivasok = { generate: 0 }
    await commandRun(
      loadConfig(raw, '/p/refinery.config.yaml'),
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )
    const elsoUtan = hivasok.generate
    expect(elsoUtan).toBeGreaterThan(0)

    // A második futás saját naplómappát kap, hogy a riportja egyértelműen
    // beazonosítható legyen; az állapottár és a vault közös.
    const masodikRaw = { ...raw, logs: { dir: join(work, 'logs-masodik') } }
    const masodikCfg = loadConfig(masodikRaw, '/p/refinery.config.yaml')
    const code = await commandRun(
      masodikCfg,
      masodikRaw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(code).toBe(0)
    // Nulla új modellhívás: a kész elemek a kihagyás ágára mennek.
    expect(hivasok.generate).toBe(elsoUtan)

    const md = (await readdir(masodikCfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(masodikCfg.logsDir, md), 'utf8')
    expect(report).toContain('| kihagyva | 3 |')
  })
})

/**
 * Kártyás hamis kliens: a `draft` szerep sémás kártyakészletet ad, a `judge`
 * az ítéletet. A `generate` sosem hívódhat — a kártyarecept a sémás úton megy.
 */
function kartyasKliens(
  cards: { question: string; answer: string }[],
  hivasok = { judge: 0 },
): ModelClient {
  return {
    generate: () => Promise.reject(new Error('a kártyarecept nem hívhat generate-et')),
    // eslint-disable-next-line @typescript-eslint/require-await
    async generateObject<T>(role: ModelRole) {
      if (role === 'judge') {
        hivasok.judge++
        return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }
      }
      return { value: { cards } as T, usage: { inputTokens: 10, outputTokens: 5 } }
    },
  }
}

const HAROM_KARTYA = [
  { question: 'Mi az A?', answer: 'Az A egy dolog.' },
  { question: 'Mi a B?', answer: 'A B másik.' },
  { question: 'Mi a C?', answer: 'A C harmadik.' },
]

/** A kártyajegyzet útvonala a vaultban, a `makeVideo` mappaszerkezetéhez. */
const kartyaJegyzet = (notesRoot: string) =>
  join(notesRoot, 'downloads', 'youtube', 'Csatorna A', 'Első videó_flashcards.md')

describe('commandRun — a kártyarecept a vaultban', () => {
  it('minden kártya `##` fejléc plusz bekezdés, és a frontmatter megnevezi a receptet', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false, recipe: 'flashcards' },
      { createClient: () => kartyasKliens(HAROM_KARTYA) },
    )

    expect(code).toBe(0)
    const note = await readFile(kartyaJegyzet(cfg.notesRoot), 'utf8')
    expect(note.match(/^## .+$/gm)).toHaveLength(3)
    expect(note).toContain('## Mi az A?\n\nAz A egy dolog.')
    expect(note).toContain('recipe: flashcards')
  })

  it('a kérdésbe került sortörés nem tör szét kártyát a vaultban', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false, recipe: 'flashcards' },
      {
        createClient: () =>
          kartyasKliens([
            { question: 'Mi az\nA fogalom?', answer: 'Ez az.' },
            ...HAROM_KARTYA.slice(1),
          ]),
      },
    )

    const note = await readFile(kartyaJegyzet(cfg.notesRoot), 'utf8')
    expect(note).toContain('## Mi az A fogalom?')
    expect(note.match(/^## .+$/gm)).toHaveLength(3)
  })

  it('az ismétlődő kérdés nulla bíró-hívással megáll a kapun', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { judge: 0 }

    await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false, recipe: 'flashcards' },
      {
        createClient: () =>
          kartyasKliens(
            [
              HAROM_KARTYA[0]!,
              HAROM_KARTYA[1]!,
              { question: 'mi az a?', answer: 'Ugyanaz még egyszer.' },
            ],
            hivasok,
          ),
      },
    )

    expect(hivasok.judge).toBe(0)
  })

  it('séma-sértő modellkimenetnél az elem hibás lesz, és a riport megnevezi az okot', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    // Az SDK ezen az úton mindig `AI_NoObjectGeneratedError`-t dob: a felső
    // szintű üzenet általános, a használható részlet a `cause`-ban van. Hogy
    // ez tényleg az SDK viselkedése, a `recipe/structured.test.ts` rögzíti az
    // SDK saját hibaosztályával; itt a névre és az okra van szükség.
    const semaHiba = Object.assign(
      new Error('No object generated: response did not match schema.'),
      {
        name: 'AI_NoObjectGeneratedError',
        cause: new Error('cards: array must contain at least 3 element(s)'),
      },
    )

    const code = await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false, recipe: 'flashcards' },
      {
        createClient: () => ({
          generate: () => Promise.reject(new Error('nem ez az út')),
          generateObject: () => Promise.reject(semaHiba),
        }),
      },
    )

    expect(code).toBe(1)
    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    expect(report).toContain('## Hibák')
    expect(report).toMatch(/nem a sémának megfelelő/i)
    // A riport a felső szintű üzenetet kapja; ha a `cause` részlete nem
    // kerülne bele, a hibasor nem mondaná meg, mi volt a baj a kimenettel.
    expect(report).toContain('array must contain at least 3 element(s)')
  })
})

/** A Q&A jegyzet útvonala a vaultban, a `makeVideo` mappaszerkezetéhez. */
const qaJegyzet = (notesRoot: string) =>
  join(notesRoot, 'downloads', 'youtube', 'Csatorna A', 'Első videó_qa.md')

const QA_KIMENET = '**Mit magyaráz a beszélő?**\n\nAz A fogalmat, majd a B-t.\n'

/**
 * Receptenként helyes kimenetet adó hamis kliens: a prompt eleje dönti el,
 * melyik recept hív. A bíró mindig átengedi. A kimenetek a meglévő, a kapukon
 * bizonyítottan átmenő szövegek.
 */
function sorKliens(hivasok: { generate: number }): ModelClient {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async generate(_role: ModelRole, prompt: string) {
      hivasok.generate++
      const value = prompt.startsWith('Write a question-and-answer')
        ? QA_KIMENET
        : '## Összefoglaló\n\nEgy mondat a jegyzetből.\n'
      return { value, usage: { inputTokens: 10, outputTokens: 5 } }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async generateObject<T>() {
      return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }
    },
  }
}

/** Kipipálja a megadott (videó, recept) sorokat a sor szövegében. */
function pipal(text: string, parok: readonly (readonly [string, string])[]): string {
  let video: string | undefined
  return text
    .split('\n')
    .map((line) => {
      const id = /^- .*? %%(.+?)%%/.exec(line)?.[1]
      if (id !== undefined) video = id
      const recipeId = /^\s+- \[ \] (\S+)$/.exec(line)?.[1]
      return recipeId !== undefined && parok.some(([v, r]) => v === video && r === recipeId)
        ? line.replace('- [ ]', '- [x]')
        : line
    })
    .join('\n')
}

/** A futás JSONL naplójának eseményei. */
async function naploEsemenyek(logsDir: string): Promise<RunEvent[]> {
  const jsonl = (await readdir(logsDir)).find((f) => f.endsWith('.jsonl'))!
  return (await readFile(join(logsDir, jsonl), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as RunEvent)
}

describe('commandRun --queue', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  it('a kipipált párokat dolgozza fel, csak azok sorait írja vissza, és egyetlen commitot készít', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    await makeVideo(downloads, 'b1', 'Harmadik videó', 'Csatorna B')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })

    // Kézzel előrehozott blokk és saját megjegyzés: mindkettőnek túl kell élnie.
    const friss = await readFile(sor, 'utf8')
    const blokk = (id: string): string => {
      const lines = friss.split('\n')
      const start = lines.findIndex((line) => line.includes(`%%${id}%%`))
      return lines.slice(start, start + 4).join('\n')
    }
    const kezi = pipal(
      friss
        .replace(`${blokk('a1')}\n${blokk('a2')}`, `${blokk('a2')}\n${blokk('a1')}`)
        .replace(
          '## downloads/youtube/Csatorna B',
          'Saját megjegyzés: ezt nézem meg először.\n\n## downloads/youtube/Csatorna B',
        ),
      [
        ['a1', 'summary'],
        ['a1', 'qa'],
        ['b1', 'summary'],
      ],
    )
    await writeFile(sor, kezi, 'utf8')
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    expect(await readFile(sor, 'utf8')).toBe(kezi)

    const hivasok = { generate: 0 }
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)
    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: true },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    const items = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const elem = (id: string) => items.find((i) => i.itemId === id)!
    const vart = [
      noteFile(cfg.notesRoot, elem('a1'), '_transcript.md'),
      noteFile(cfg.notesRoot, elem('a1'), '_summary.md'),
      noteFile(cfg.notesRoot, elem('a1'), '_qa.md'),
      noteFile(cfg.notesRoot, elem('b1'), '_transcript.md'),
      noteFile(cfg.notesRoot, elem('b1'), '_summary.md'),
    ]
    for (const path of vart) expect(existsSync(path)).toBe(true)
    expect(existsSync(noteFile(cfg.notesRoot, elem('a2'), '_transcript.md'))).toBe(false)

    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledTimes(1)
    const [, commitolt, uzenet] = vi.mocked(gitCommitPaths).mock.calls[0]!
    expect([...commitolt].sort()).toEqual([...vart, sor].sort())
    expect(uzenet).toBe('docs(videos): 5 jegyzet a feldolgozási sorból')

    const elotte = kezi.split('\n')
    const utana = (await readFile(sor, 'utf8')).split('\n')
    expect(utana).toHaveLength(elotte.length)
    const valtozott = utana.filter((line, i) => line !== elotte[i])
    expect(valtozott).toHaveLength(3)
    for (const line of valtozott) {
      expect(line).toMatch(/^ {2}- \[x\] (summary|qa) — ✓ 1\.00 · \$\d\.\d{4} · \[jegyzet\]\(<.+>\)$/)
    }
  })

  it('másodszor futtatva nulla modellhívás, nincs új commit, és a sor bájtra változatlan', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, pipal(await readFile(sor, 'utf8'), [['a1', 'summary']]), 'utf8')
    const hivasok = { generate: 0 }
    await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )
    const elsoHivasok = hivasok.generate
    const elsoSor = await readFile(sor, 'utf8')
    expect(elsoHivasok).toBeGreaterThan(0)

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: true },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(elsoHivasok)
    expect(vi.mocked(gitCommitPaths)).not.toHaveBeenCalled()
    expect(await readFile(sor, 'utf8')).toBe(elsoSor)
  })

  it('ha a plafon csak az első párra elég, egyetlen közös szeletelés után a többi ⏳-t kap', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const alap = rawWithVault(5)
    const alapCfg = loadConfig(alap, '/p/refinery.config.yaml')
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const words = (await normalizeItem(item!)).wordsNormalized
    const summary = getRecipe('summary')
    // Mindhárom recept maxIterations-e ma 0: egy pár becslése mindegyikre
    // ugyanaz, tehát a plafon pontosan az első párra elég.
    const egyPar = estimateItemUsd(
      words,
      summary.maxIterations,
      loadModelConfig(alap, process.env, alapCfg.configPath),
    )
    const raw = { ...alap, cost_limit_usd: egyPar * 1.5 }
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(
      sor,
      pipal(await readFile(sor, 'utf8'), [
        ['a1', 'summary'],
        ['a1', 'flashcards'],
        ['a1', 'qa'],
      ]),
      'utf8',
    )

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const sliced = (await naploEsemenyek(cfg.logsDir)).filter((e) => e.type === 'run:sliced')
    expect(sliced).toMatchObject([{ planned: 1, deferred: 2 }])
    const note = await readFile(sor, 'utf8')
    expect(note).toMatch(/ {2}- \[x\] summary — ✓ /)
    expect(note).toContain('  - [x] flashcards — ⏳ a plafon miatt a következő futásra maradt')
    expect(note).toContain('  - [x] qa — ⏳ a plafon miatt a következő futásra maradt')
  })

  it('ha már az első pár sem fér a plafon alá, 2-vel lép ki, és a sorba ⏳ kerül', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(0.000001)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, pipal(await readFile(sor, 'utf8'), [['a1', 'summary']]), 'utf8')
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(2)
    expect(hivasok.generate).toBe(0)
    expect(await readFile(sor, 'utf8')).toContain(
      '  - [x] summary — ⏳ a plafon miatt a következő futásra maradt',
    )
  })

  it('sor nélkül indulás előtt hibával megáll, és a scan --queue-t javasolja', async () => {
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(1)
    expect(hiba.mock.calls.flat().join('\n')).toContain('refinery scan --queue')
    expect(existsSync(cfg.logsDir)).toBe(false)
    hiba.mockRestore()
  })

  it('--dry-run mellett nem ír vissza a sorba', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    const kipipalt = pipal(await readFile(sor, 'utf8'), [['a1', 'summary']])
    await writeFile(sor, kipipalt, 'utf8')

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: true, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    expect(await readFile(sor, 'utf8')).toBe(kipipalt)
  })

  it('a --recipe csak az adott recept kipipált párjait viszi', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(
      sor,
      pipal(await readFile(sor, 'utf8'), [
        ['a1', 'summary'],
        ['a1', 'qa'],
      ]),
      'utf8',
    )

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, recipe: 'qa', dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_qa.md'))).toBe(true)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_summary.md'))).toBe(false)
    const note = await readFile(sor, 'utf8')
    expect(note).toContain('  - [x] summary\n')
    expect(note).toMatch(/ {2}- \[x\] qa — ✓ /)
  })

  it('a kipipált, de már nem felderített videó párja ✗-t kap, és a kilépőkód 1', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, pipal(await readFile(sor, 'utf8'), [['a2', 'summary']]), 'utf8')
    await rm(join(downloads, 'youtube', 'Csatorna A', 'Második videó.en.srt'))
    await rm(join(downloads, 'youtube', 'Csatorna A', 'Második videó.info.json'))

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(1)
    expect(await readFile(sor, 'utf8')).toContain('  - [x] summary — ✗ a felirat nem található')
  })

  it('ismeretlen receptnevű kipipált sor nem fut, és a riport figyelmeztet', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, (await readFile(sor, 'utf8')).replace('  - [ ] qa', '  - [x] nincsilyen'), 'utf8')
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(0)
    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    expect(report).toContain('## Figyelmeztetések')
    expect(report).toContain('- ismeretlen recept a sorban: nincsilyen (a1)')
  })
})

describe('commandRun — a Q&A recept a vaultban', () => {
  it('a jegyzet átmegy a vault linterén, és a frontmatter mind az öt recept-mezőt viszi', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false, recipe: 'qa' },
      {
        createClient: () => ({
          // eslint-disable-next-line @typescript-eslint/require-await
          async generate() {
            return { value: QA_KIMENET, usage: { inputTokens: 10, outputTokens: 5 } }
          },
          // eslint-disable-next-line @typescript-eslint/require-await
          async generateObject<T>() {
            return {
              value: { score: 1, gaps: [] } as T,
              usage: { inputTokens: 5, outputTokens: 2 },
            }
          },
        }),
      },
    )

    expect(code).toBe(0)
    const note = await readFile(qaJegyzet(cfg.notesRoot), 'utf8')
    expect(note).toContain('**Mit magyaráz a beszélő?**')
    expect(lintVaultMarkdown(note)).toEqual([])
    expect(note).toContain('recipe: qa')
    expect(note).toMatch(/^model: .+$/m)
    expect(note).toMatch(/^iterations: \d+$/m)
    expect(note).toMatch(/^score: \d\.\d\d$/m)
    expect(note).toMatch(/^cost_usd: \d\.\d{4}$/m)
  })
})

describe('commandCheckPricing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const MODEL_CONFIG = {
    baseUrl: 'http://localhost:4000/v1',
    apiKey: 'sk-proba',
    models: { draft: 'claude-sonnet-5', judge: 'grok-4-fast-reasoning' } as Record<
      ModelRole,
      string
    >,
    pricing: {
      draft: { inputPerMillion: 2, outputPerMillion: 10 },
      judge: { inputPerMillion: 1.25, outputPerMillion: 2.5 },
    },
    costLimitUsd: 5,
  }

  function stubLiteLLM(data: { model_name: string; input: number; output: number }[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: data.map((d) => ({
              model_name: d.model_name,
              model_info: { input_cost_per_token: d.input, output_cost_per_token: d.output },
            })),
          }),
      }),
    )
  }

  it('0-val tér vissza, ha a config egyezik a LiteLLM élő áraival', async () => {
    stubLiteLLM([
      { model_name: 'claude-sonnet-5', input: 0.000002, output: 0.00001 },
      { model_name: 'grok-4-fast-reasoning', input: 0.00000125, output: 0.0000025 },
    ])

    expect(await commandCheckPricing(MODEL_CONFIG)).toBe(0)
  })

  it('1-gyel tér vissza, és jelzi az eltérést, ha a config elavult', async () => {
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    stubLiteLLM([
      { model_name: 'claude-sonnet-5', input: 0.000003, output: 0.000015 },
      { model_name: 'grok-4-fast-reasoning', input: 0.00000125, output: 0.0000025 },
    ])

    const code = await commandCheckPricing(MODEL_CONFIG)

    expect(code).toBe(1)
    expect(naplo.mock.calls.flat().join('\n')).toContain('ELTÉR draft')
    naplo.mockRestore()
  })

  it('2-vel tér vissza, ha a LiteLLM nem érhető el', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(await commandCheckPricing(MODEL_CONFIG)).toBe(2)

    hiba.mockRestore()
  })
})

describe('commandScanQueue', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  it('friss vaulton létrehozza a sort: minden videó benne, receptenként egy üres pipával', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'b1', 'Második videó', 'Csatorna B')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)

    const note = await readFile(queuePath(cfg.notesRoot), 'utf8')
    expect(note).toContain(
      '## downloads/youtube/Csatorna A\n- Első videó %%a1%%\n  - [ ] summary\n  - [ ] flashcards\n  - [ ] qa\n',
    )
    expect(note).toContain(
      '## downloads/youtube/Csatorna B\n- Második videó %%b1%%\n  - [ ] summary\n  - [ ] flashcards\n  - [ ] qa\n',
    )
  })

  it('másodszor futtatva a sor bájtra azonos, és csak az első futás commitol', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)

    await commandScanQueue(cfg, { dryRun: false, commit: true })
    const elso = await readFile(sor, 'utf8')
    await commandScanQueue(cfg, { dryRun: false, commit: true })

    expect(await readFile(sor, 'utf8')).toBe(elso)
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledWith(
      cfg.vaultPath,
      [sor],
      'docs(videos): feldolgozási sor frissítése',
    )
  })

  it('LITELLM_API_KEY nélkül is lefut: modellt nem hív', async () => {
    delete process.env.LITELLM_API_KEY
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)
    expect(existsSync(queuePath(cfg.notesRoot))).toBe(true)
  })

  it('--dry-run mellett nem ír jegyzetet és nem commitol', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScanQueue(cfg, { dryRun: true, commit: true })).toBe(0)
    expect(existsSync(queuePath(cfg.notesRoot))).toBe(false)
    expect(vi.mocked(gitCommitPaths)).not.toHaveBeenCalled()
  })

  it('a --queue nélküli scan továbbra sem ír semmit', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScan(cfg)).toBe(0)
    expect(existsSync(queuePath(cfg.notesRoot))).toBe(false)
  })
})

describe('commandRun — a commit tartalma', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  it('--recipe mellett a commit az átiratot és a recept jegyzetét viszi, a mai üzenettel', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: true },
      { createClient: () => hamisKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledWith(
      cfg.vaultPath,
      [noteFile(cfg.notesRoot, item!, '_transcript.md'), noteFile(cfg.notesRoot, item!, '_summary.md')],
      'docs(videos): átirat 2 videóhoz',
    )
  })
})

describe('commandRun — indulás és lezárás a naplóban', () => {
  it('az első sor a run:started, az utolsó a run:ended', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, {
      dryRun: false,
      force: false,
      commit: false,
      command: 'run --limit 1',
    })

    expect(code).toBe(0)
    const events = await naploEsemenyek(cfg.logsDir)
    const first = events[0]
    expect(first?.type).toBe('run:started')
    expect(first?.type === 'run:started' ? [first.command, first.pid] : null).toEqual([
      'run --limit 1',
      process.pid,
    ])
    const last = events.at(-1)
    expect(last?.type).toBe('run:ended')
    expect(last?.type === 'run:ended' ? last.interrupted : null).toBe(false)
    expect(events.filter((e) => e.type === 'run:ended')).toHaveLength(1)
    expect(events.findIndex((e) => e.type === 'run:done')).toBeLessThan(events.length - 1)
  })

  it('megszakításkor a run:ended megszakítottnak jelöl', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    let sigint: (() => void) | undefined
    let interrupted: () => void
    const exited = new Promise<void>((resolve) => (interrupted = resolve))
    const hivasok = { generate: 0 }

    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      {
        // A jel az első generálás közben érkezik: a megszakítás ága biztosan
        // megelőzi a normál befejezést.
        signals: {
          on(_event: string, listener: () => void) {
            sigint = listener
            return this
          },
        },
        exit: () => interrupted(),
        createClient: () =>
          hamisKliens(hivasok, (hanyadik) => {
            if (hanyadik === 1) sigint?.()
          }),
      },
    )
    await exited

    const lezarasok = (await naploEsemenyek(cfg.logsDir)).filter((e) => e.type === 'run:ended')
    expect(lezarasok).toHaveLength(1)
    expect(lezarasok[0]?.type === 'run:ended' ? lezarasok[0].interrupted : null).toBe(true)
  })

  it('a plafon miatti megállásnál a run:ended a run:aborted után jön', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })

    expect(code).toBe(2)
    const types = (await naploEsemenyek(cfg.logsDir)).map((e) => e.type)
    expect(types.indexOf('run:aborted')).toBeGreaterThan(-1)
    expect(types.indexOf('run:ended')).toBeGreaterThan(types.indexOf('run:aborted'))
  })
})
