import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectEvents, type RunEvent } from './events.js'
import { createCostGuard } from './model/budget.js'
import { modelClientFrom, type ModelClient } from './model/client.js'
import { ARTIFACT_KIND, normalizeItem, processItem, type PipelineDeps } from './pipeline.js'
import { translationOf } from './recipe/translate.js'
import { faithfulnessCriterion } from './rubric/judge.js'
import type { Recipe } from './recipe/types.js'
import { openState, type StateStore } from './state/db.js'
import type { SourceItem } from './types.js'
import { noteFile } from './vault/paths.js'
import { renderRecipeNote } from './vault/render.js'

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ez egy sor.

2
00:00:01,000 --> 00:00:03,000
Ez egy sor.

3
00:00:02,000 --> 00:00:04,000
Ez egy másik sor.
`

let dir: string
let notesRoot: string
let store: StateStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-pipe-'))
  notesRoot = join(dir, 'vault')
  await mkdir(notesRoot, { recursive: true })
  await writeFile(join(dir, 'Beszéd.en.srt'), SRT, 'utf8')
  store = openState(join(dir, 'state.db'))
})

afterEach(() => store.close())

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: join(dir, 'Beszéd.en.srt'),
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: {},
  ...overrides,
})

describe('processItem', () => {
  it('jegyzetet ír, és a tartalomban nincs duplikált sor', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item(), {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: {},
    })
    expect(outcome.status).toBe('published')
    const md = await readFile(outcome.path!, 'utf8')
    expect(md.match(/Ez egy sor\./g)).toHaveLength(1)
    expect(md).toContain('Ez egy másik sor.')
  })

  it('a célutat a forrásmappa adja, a metaadat nem írja felül', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(
      item({
        metadata: {
          videoId: 'dQw4w9WgXcQ',
          channel: 'Egészen Más Csatorna',
          uploadedAt: '2026-07-14',
        },
      }),
      { notesRoot, store, sink, version: '0.1.0', options: {} },
    )
    expect(outcome.path).toBe(join(notesRoot, 'youtube', 'csatorna', 'Beszéd_transcript.md'))
  })

  it('másodszor futtatva kihagy, és nem ír semmit', async () => {
    const { sink } = collectEvents()
    await processItem(item(), { notesRoot, store, sink, version: '0.1.0', options: {} })
    const second = await processItem(item(), { notesRoot, store, sink, version: '0.1.0', options: {} })
    expect(second.status).toBe('skipped')
  })

  it('sérült feliratnál hibát ad, de nem dob kivételt', async () => {
    const broken = item({ subtitlePath: join(dir, 'nincs.en.srt') })
    const { sink } = collectEvents()
    const outcome = await processItem(broken, { notesRoot, store, sink, version: '0.1.0', options: {} })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toBeTruthy()
  })

  it('a kiírt jegyzet átmegy a vault linterén', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item(), { notesRoot, store, sink, version: '0.1.0', options: {} })
    const { lintVaultMarkdown } = await import('./vault/lint.js')
    expect(lintVaultMarkdown(await readFile(outcome.path!, 'utf8'))).toEqual([])
  })

  it('eseményeket bocsát ki, nem ír a konzolra', async () => {
    const { sink, events } = collectEvents()
    await processItem(item(), { notesRoot, store, sink, version: '0.1.0', options: {} })
    expect(events.map((e) => e.type)).toContain('item:normalized')
    expect(events.map((e) => e.type)).toContain('item:published')
  })

  it('nyelvkód nélküli fájlnévnél a tartalomból azonosítja a nyelvet', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item({ language: null }), {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: {},
    })

    expect(outcome.status).toBe('published')
    expect(await readFile(outcome.path!, 'utf8')).toContain('\nlanguage: hu\n')
  })

  it('felismerhetetlen nyelvnél megnevezett hibával áll meg, jegyzet nélkül', async () => {
    await writeFile(
      join(dir, 'Ismeretlen.srt'),
      [
        '1',
        '00:00:00,000 --> 00:00:02,000',
        'Xyzzy quux foobar plugh grault.',
        '',
        '2',
        '00:00:02,000 --> 00:00:04,000',
        'Waldo fred corge thud xyzzy.',
        '',
      ].join('\n'),
      'utf8',
    )
    const { sink } = collectEvents()

    const outcome = await processItem(
      item({
        subtitlePath: join(dir, 'Ismeretlen.srt'),
        sourceFile: 'csatorna/Ismeretlen.srt',
        baseName: 'Ismeretlen',
        title: 'Ismeretlen',
        language: null,
      }),
      { notesRoot, store, sink, version: '0.1.0', options: {} },
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('nyelvkód')
  })

  it('metaadat nélküli elemet is végigvisz, és a forrás fája alá ír', async () => {
    const { sink, events } = collectEvents()
    const outcome = await processItem(item(), {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    })
    expect(outcome.status).toBe('published')
    expect(outcome.path).toBe(join(notesRoot, 'youtube', 'csatorna', 'Beszéd_transcript.md'))
    expect(events.some((e) => e.type === 'item:published')).toBe(true)
  })

  it('a második futás ugyanarra az elemre nem ír újra', async () => {
    const deps = {
      notesRoot,
      store,
      sink: collectEvents().sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    }
    await processItem(item(), deps)
    const second = await processItem(item(), deps)
    expect(second.status).toBe('skipped')
  })
})

function alapDeps(): PipelineDeps {
  return { notesRoot, store, sink: collectEvents().sink, version: '0.1.0', options: {} }
}

/** Fixture-modell: rögzített szöveget ad vissza, rögzített használattal. */
function fixModell(text: string, inputTokens = 100, outputTokens = 20) {
  return new MockLanguageModelV4({
    // A `doGenerate` a `LanguageModelV4` interfészhez igazodva Promise-t vár
    // vissza; itt nincs mire várni, de az `async` a szerződés, nem hiba.
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: {
          total: inputTokens,
          noCache: inputTokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
      },
      warnings: [],
    }),
  })
}

const MODELL_CFG = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  costLimitUsd: 5,
}

/** Recept, ami mindig átmegy, és nem hív bírót. */
const ATMENO_RECEPT: Recipe = {
  id: 'proba',
  outputFile: '_proba.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  prompt: () => 'generálj',
  repairPrompt: () => 'javíts',
  rubric: {
    criteria: [{ name: 'mindig-jo', score: () => Promise.resolve({ value: 1, gaps: [] }) }],
    passThreshold: 0.8,
  },
}

function probaKliens(text: string) {
  return modelClientFrom({
    draft: fixModell(text),
    judge: fixModell('nem hívjuk'),
  })
}

describe('processItem recepttel', () => {
  it('recept nélkül a Fázis 0 útján marad, és nem néz modell-konfigurációt', async () => {
    // Ez a teszt akkor is fut, ha egyetlen LiteLLM-változó sincs beállítva.
    const outcome = await processItem(item(), alapDeps())
    expect(outcome.status).toBe('published')
    expect(outcome.path).toContain('_transcript.md')
  })

  it('recepttel a jegyzetet is kiírja, a recept fájlnevével', async () => {
    const outcome = await processItem(item(), {
      ...alapDeps(),
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Generált jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.status).toBe('published')
    const irt = await readFile(outcome.recipePath!, 'utf8')
    expect(irt).toContain('## Generált jegyzet')
    expect(irt).toContain('recipe: proba')
    expect(irt).toContain('model: draft-modell')
  })

  it('a recept címkéit a jegyzet frontmatterjébe írja', async () => {
    const outcome = await processItem(item(), {
      ...alapDeps(),
      recipeDeps: {
        recipe: { ...ATMENO_RECEPT, tags: ['decks'] },
        client: probaKliens('## Generált jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const irt = await readFile(outcome.recipePath!, 'utf8')
    expect(irt).toContain('tags: [decks]')
  })

  it('a metrikákat az állapottárba írja', async () => {
    const deps = alapDeps()
    const current = item()
    await processItem(current, {
      ...deps,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const record = deps.store.artifactOf(current.itemId, 'proba')
    expect(record!.status).toBe('done')
    expect(record!.iterations).toBe(1)
    expect(record!.score).toBe(1)
    expect(record!.model).toBe('draft-modell')
    expect(record!.costUsd).toBeGreaterThan(0)
  })

  it('a költségőr összegzi a loop tényleges használatát', async () => {
    const guard = createCostGuard(5)
    await processItem(item(), {
      ...alapDeps(),
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard,
      },
    })
    expect(guard.spentUsd()).toBeGreaterThan(0)
  })

  it('a már kész receptet másodszorra kihagyja', async () => {
    const deps = alapDeps()
    const recipeDeps = {
      recipe: ATMENO_RECEPT,
      client: probaKliens('## Jegyzet\n'),
      modelConfig: MODELL_CFG,
      guard: createCostGuard(5),
    }
    const current = item()

    await processItem(current, { ...deps, recipeDeps })
    const masodik = await processItem(current, { ...deps, recipeDeps })

    expect(masodik.status).toBe('skipped')
  })

  it('publishable: false receptet nem ír ki', async () => {
    const outcome = await processItem(item(), {
      ...alapDeps(),
      recipeDeps: {
        recipe: { ...ATMENO_RECEPT, id: 'nem-publikus', publishable: false },
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.recipePath).toBeUndefined()
  })

  it('a recept hibája nem rontja el a már publikált átirat állapotát', async () => {
    const deps = alapDeps()
    const current = item()
    const outcome = await processItem(current, {
      ...deps,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: {
          generate: () => Promise.reject(new Error('proba hiba')),
          generateObject: () => Promise.reject(new Error('nem hívjuk')),
        },
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.status).toBe('published')
    expect(outcome.path).toContain('_transcript.md')
    expect(deps.store.artifactOf(current.itemId, 'transcript')!.status).toBe('done')
    expect(deps.store.artifactOf(current.itemId, ATMENO_RECEPT.id)!.status).toBe('failed')
  })

  it('dry-run mellett nem-publikálható recept sem marad tartósan késznek jelölve', async () => {
    const deps = alapDeps()
    const current = item()
    await processItem(current, {
      ...deps,
      options: { dryRun: true },
      recipeDeps: {
        recipe: { ...ATMENO_RECEPT, id: 'nem-publikus-dry', publishable: false },
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(deps.store.artifactOf(current.itemId, 'nem-publikus-dry')).toBeNull()
  })

  it('átmeneti modellhiba után újrapróbálkozik, és eseményt küld róla', async () => {
    let hivasok = 0
    // A `ModelClient` szerződése async; ez a próba-kliens szinkron dob vagy
    // ad vissza, tehát nincs mire várnia.
    const client: ModelClient = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async generate() {
        hivasok++
        if (hivasok === 1) {
          throw Object.assign(new Error('HTTP 429'), { statusCode: 429 })
        }
        return { value: '## Jegyzet\n', usage: { inputTokens: 10, outputTokens: 5 } }
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async generateObject<T>() {
        return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 1, outputTokens: 1 } }
      },
    }

    const { sink, events } = collectEvents()
    const outcome = await processItem(item(), {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client,
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
        sleep: async () => {},
      },
    })

    expect(outcome.status).toBe('published')
    expect(hivasok).toBe(2)
    expect(events.filter((e) => e.type === 'item:retry')).toHaveLength(1)
  })

  it('végleges modellhibára nem próbálkozik újra, és az elem hibás lesz', async () => {
    let hivasok = 0
    const client: ModelClient = {
      // eslint-disable-next-line @typescript-eslint/require-await
      async generate() {
        hivasok++
        throw Object.assign(new Error('HTTP 400'), { statusCode: 400 })
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      async generateObject<T>() {
        return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 1, outputTokens: 1 } }
      },
    }

    const { sink, events } = collectEvents()
    await processItem(item(), {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client,
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
        sleep: async () => {},
      },
    })

    expect(hivasok).toBe(1)
    expect(events.filter((e) => e.type === 'item:retry')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'item:failed')).toHaveLength(1)
  })

  it('sérült feliratnál recept-futásban MINDKÉT érintett típus alatt hibát rögzít', async () => {
    // Az 1. kör javítása óta a `planned` recept-futásnál is tartalmazza a
    // normalizáláson elbukó elemet (korábban a becslési ciklus kiszűrte,
    // mielőtt a `processItem` ezt a `catch`-ágat elérte volna). A hiba tehát
    // most már mindkét típusra (`transcript` ÉS a recept azonosítója) alatt
    // kell landoljon, különben a `corpusStatus`/`listFailed` a recept
    // kind-je alatt sosem találja meg — örökre „hátra" marad.
    const broken = item({ subtitlePath: join(dir, 'nincs.en.srt') })
    const deps = alapDeps()
    const recipeDeps = {
      recipe: ATMENO_RECEPT,
      client: probaKliens('## Jegyzet\n'),
      modelConfig: MODELL_CFG,
      guard: createCostGuard(5),
    }

    const outcome = await processItem(broken, { ...deps, recipeDeps })

    expect(outcome.status).toBe('failed')
    expect(deps.store.artifactOf(broken.itemId, ARTIFACT_KIND)?.status).toBe('failed')
    expect(deps.store.artifactOf(broken.itemId, recipeDeps.recipe.id)?.status).toBe('failed')
    expect(deps.store.corpusStatus([broken], recipeDeps.recipe.id).failed).toBe(1)
  })

  it('a bíró tokenjeit a bíró árán könyveli, nem a vázlatmodellén', async () => {
    // Egy generálás és egy bíró-hívás, egyenként egymillió bemeneti tokennel.
    // Helyesen: 1M × 3 $ (draft) + 1M × 0,2 $ (judge) = 3,20 $. A javítás
    // előtt mindkettő a draft árán ment: 2M × 3 $ = 6,00 $.
    const biroRecept: Recipe = {
      ...ATMENO_RECEPT,
      id: 'biros',
      rubric: { criteria: [faithfulnessCriterion], passThreshold: 0.8 },
    }
    const client: ModelClient = {
      generate: () =>
        Promise.resolve({
          value: '## Jegyzet\n',
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
        }),
      generateObject: <T>() =>
        Promise.resolve({
          value: { score: 1, gaps: [] } as T,
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
        }),
    }
    const guard = createCostGuard(100)
    const { sink, events } = collectEvents()
    const deps = { ...alapDeps(), sink }
    const current = item()

    await processItem(current, {
      ...deps,
      recipeDeps: { recipe: biroRecept, client, modelConfig: MODELL_CFG, guard },
    })

    expect(guard.spentUsd()).toBeCloseTo(3.2, 10)
    expect(deps.store.artifactOf(current.itemId, 'biros')!.costUsd).toBeCloseTo(3.2, 10)
    const refined = events.find(
      (e): e is Extract<RunEvent, { type: 'item:refined' }> => e.type === 'item:refined',
    )
    expect(refined!.usd).toBeCloseTo(3.2, 10)
  })

  it('sérült feliratnál recept-futásban típusonként egy hibaeseményt küld', async () => {
    const broken = item({ subtitlePath: join(dir, 'nincs.en.srt') })
    const { sink, events } = collectEvents()

    await processItem(broken, {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const failed = events.filter(
      (e): e is Extract<RunEvent, { type: 'item:failed' }> => e.type === 'item:failed',
    )
    expect(failed.map((e) => e.kind)).toEqual([ARTIFACT_KIND, 'proba'])
  })
})

describe('processItem — a hiánylista rögzítése', () => {
  /** Recept, aminek a bírója hiányt nevez meg; javító kör nincs. */
  const HIANYOS_RECEPT: Recipe = {
    ...ATMENO_RECEPT,
    rubric: {
      criteria: [
        {
          name: 'hianyos',
          score: () => Promise.resolve({ value: 0.6, gaps: ['kimaradt: a második pont'] }),
        },
      ],
      passThreshold: 0.8,
    },
  }

  it('a megtartott kimenet hiánylistáját az állapottárba írja', async () => {
    const deps = alapDeps()
    const current = item()
    await processItem(current, {
      ...deps,
      recipeDeps: {
        recipe: HIANYOS_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })
    expect(deps.store.gapsOf(current.itemId, 'proba')).toEqual(['kimaradt: a második pont'])
  })

  it('a nem publikálható receptnél is rögzíti', async () => {
    const deps = alapDeps()
    const current = item()
    await processItem(current, {
      ...deps,
      recipeDeps: {
        recipe: { ...HIANYOS_RECEPT, publishable: false },
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })
    expect(deps.store.gapsOf(current.itemId, 'proba')).toEqual(['kimaradt: a második pont'])
  })
})

describe('processItem — generálási és pontozási események', () => {
  it('generálás előtt és pontozás után eseményt bocsát ki', async () => {
    const { sink, events } = collectEvents()
    await processItem(item(), {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(
      events.filter((e) => e.type === 'item:generating' || e.type === 'item:scored'),
    ).toEqual([
      { type: 'item:generating', itemId: 'a1b2c3', recipe: 'proba', generation: 1 },
      { type: 'item:scored', itemId: 'a1b2c3', recipe: 'proba', score: 1, gaps: 0 },
    ])
  })
})

const ANGOL_FORRAS = [
  '## Overview',
  '',
  'The speaker explains why a problem should come before a tool.',
  '',
  'The second paragraph adds an example from his first company.',
].join('\n')

const MAGYAR_FORDITAS = [
  '## Áttekintés',
  '',
  'A beszélő elmagyarázza, hogy miért kell a problémának az eszköz előtt lennie.',
  '',
  'A második bekezdés egy példát is hoz az első cégéből.',
].join('\n')

/** Egy kész forrásjegyzet a vaultban és az állapottárban, ahogy egy korábbi futás hagyta. */
async function forrasJegyzet(store: StateStore, body: string): Promise<string> {
  const current = item()
  const path = noteFile(notesRoot, current, '_proba.md')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    renderRecipeNote(
      current,
      await normalizeItem(current),
      body,
      { recipe: 'proba', model: 'modell', iterations: 1, score: 1, costUsd: 0.01 },
      '0.1.0',
    ),
    'utf8',
  )
  store.recordItem(current)
  store.recordArtifact(current.itemId, 'proba', 'done', path, null)
  return path
}

describe('processItem fordítással', () => {
  const FORDITO = translationOf(ATMENO_RECEPT, 'hu')
  const biro = () => fixModell(JSON.stringify({ score: 0.9, gaps: [] }))

  it('a forrásjegyzet törzsét fordítja, és a fordítás a forráshoz mér', async () => {
    const deps = alapDeps()
    await forrasJegyzet(deps.store, ANGOL_FORRAS)
    const draft = fixModell(MAGYAR_FORDITAS)

    const outcome = await processItem(item(), {
      ...deps,
      recipeDeps: {
        recipe: FORDITO,
        client: modelClientFrom({ draft, judge: biro() }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.recipePath).toBe(noteFile(notesRoot, item(), '_proba-hu.md'))
    const irt = await readFile(outcome.recipePath!, 'utf8')
    expect(irt).toContain('\nlanguage: hu\n')
    expect(irt).toContain('\nsource_language: en\n')
    expect(irt).toContain('\ntranslation_of: proba\n')
    expect(irt).toMatch(/\nsource_generated_at: "\d{4}-\d{2}-\d{2}T[\d:.]+Z"\n/)
    expect(irt).toContain('## Áttekintés')
    // A 0,9 csak akkor jöhet ki, ha a vázkapu a forrásjegyzethez mért: a
    // feliratszöveg egyetlen bekezdés, fejléc nélkül.
    expect(deps.store.artifactOf(item().itemId, 'proba-hu')!.score).toBe(0.9)
    expect(JSON.stringify(draft.doGenerateCalls[0]!.prompt)).toContain(
      'The speaker explains why a problem should come before a tool.',
    )
  })

  it('ha a forrásjegyzet már a célnyelven van, modellhívás nélkül kihagyja, okkal', async () => {
    const deps = alapDeps()
    await forrasJegyzet(deps.store, MAGYAR_FORDITAS)
    const draft = fixModell('nem hívjuk')
    const { sink, events } = collectEvents()

    const outcome = await processItem(item(), {
      ...deps,
      sink,
      recipeDeps: {
        recipe: FORDITO,
        client: modelClientFrom({ draft, judge: biro() }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.skipReason).toBe('a forrás már magyar')
    expect(draft.doGenerateCalls).toHaveLength(0)
    expect(deps.store.artifactOf(item().itemId, 'proba-hu')).toBeNull()
    expect(events).toContainEqual({
      type: 'item:skipped',
      itemId: item().itemId,
      reason: 'a forrás már magyar',
    })
  })

  it('ha a forrásjegyzet fájlja hiányzik, a fordítás megnevezett útvonallal bukik', async () => {
    const deps = alapDeps()
    await rm(await forrasJegyzet(deps.store, ANGOL_FORRAS))

    await processItem(item(), {
      ...deps,
      recipeDeps: {
        recipe: FORDITO,
        client: modelClientFrom({ draft: fixModell(MAGYAR_FORDITAS), judge: biro() }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const record = deps.store.artifactOf(item().itemId, 'proba-hu')!
    expect(record.status).toBe('failed')
    expect(record.error).toBe('a forrásjegyzet nem található: youtube/csatorna/Beszéd_proba.md')
  })

  it('kész forrás nélkül a pipeline sem fordít', async () => {
    const deps = alapDeps()
    const draft = fixModell(MAGYAR_FORDITAS)

    await processItem(item(), {
      ...deps,
      recipeDeps: {
        recipe: FORDITO,
        client: modelClientFrom({ draft, judge: biro() }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(draft.doGenerateCalls).toHaveLength(0)
    expect(deps.store.artifactOf(item().itemId, 'proba-hu')!.error).toBe('előbb a proba recept kell')
  })
})
