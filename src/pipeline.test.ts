import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectEvents } from './events.js'
import { createCostGuard } from './model/budget.js'
import { modelClientFrom, type ModelClient } from './model/client.js'
import { processItem, type PipelineDeps } from './pipeline.js'
import type { Recipe } from './recipe/types.js'
import { openState, type StateStore } from './state/db.js'
import type { SourceItem } from './types.js'

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
})
