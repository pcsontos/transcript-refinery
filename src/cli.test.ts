import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRun } from './cli.js'
import { loadConfig, loadModelConfig } from './config.js'
import type { RunEvent } from './events.js'
import { estimateItemUsd } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { normalizeItem } from './pipeline.js'
import { getRecipe } from './recipe/registry.js'
import { runId } from './run/id.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'
import type { ModelRole } from './types.js'

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
    expect(failed).toHaveLength(1)
    // A JSONL sor is megnevezi a forrásmappát — ugyanaz a bizonyítékigény
    // egy szinttel a riport alatt.
    expect(failed[0]).toMatchObject({ itemId: 'a2', source: 'downloads' })

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    expect(report).toContain('## Hibák')
    // A spec §2.2: elemenként az azonosító, a FORRÁSMAPPA NEVE és az ok.
    expect(report).toMatch(/\| `a2` \| downloads \| .+ \|/)
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

    const semaHiba = Object.assign(new Error('cards: array must contain at least 3 element(s)'), {
      name: 'AI_TypeValidationError',
    })

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
  })
})
