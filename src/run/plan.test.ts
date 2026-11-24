import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { estimateItemUsd } from '../model/budget.js'
import { normalizeItem } from '../pipeline.js'
import { getRecipe } from '../recipe/registry.js'
import { translationOf } from '../recipe/translate.js'
import type { StateStore } from '../state/db.js'
import type { SourceItem } from '../types.js'
import {
  dryRunLines,
  type DryRunEntry,
  estimateUnits,
  filterItems,
  matchesFilters,
  sourceGap,
  sourcePlanned,
  sourcesFirst,
  unitKey,
  unitKind,
  type WorkUnit,
} from './plan.js'

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ez egy első mondat a becsléshez.

2
00:00:02,000 --> 00:00:04,000
Ez pedig egy második, eltérő mondat.
`

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  recipeModels: {},
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  modelPricing: {},
  costLimitUsd: 5,
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-plan-'))
  await writeFile(join(dir, 'Elso.hu.srt'), SRT, 'utf8')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function elem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    itemId: 'abcDEF12345',
    source: 'feliratok',
    sourceFile: 'csatorna-a/Elso.hu.srt',
    subtitlePath: join(dir, 'Elso.hu.srt'),
    baseName: 'Elso',
    title: 'Első példavideó',
    language: 'hu',
    metadata: {},
    ...overrides,
  }
}

describe('unitKind, unitKey', () => {
  it('recepttel a recept azonosítója, nélküle az átirat a típus', () => {
    expect(unitKind({ item: elem(), recipe: getRecipe('summary') })).toBe('summary')
    expect(unitKind({ item: elem(), recipe: null })).toBe('transcript')
  })

  it('a kulcs az elemet és a típust is megkülönbözteti', () => {
    const keys = new Set([
      unitKey({ item: elem(), recipe: getRecipe('summary') }),
      unitKey({ item: elem(), recipe: getRecipe('qa') }),
      unitKey({ item: elem({ itemId: 'masik' }), recipe: getRecipe('summary') }),
    ])
    expect(keys.size).toBe(3)
  })
})

describe('matchesFilters, filterItems', () => {
  it('a forrást kis- és nagybetűtől függetlenül szűri', () => {
    expect(matchesFilters(elem(), { source: 'FELIRATOK' })).toBe(true)
    expect(matchesFilters(elem(), { source: 'masik' })).toBe(false)
  })

  it('a csatornaszűrő a metaadat nélküli elemet kizárja', () => {
    const csatornas = elem({ itemId: 'c1', metadata: { channel: 'Csatorna A' } })
    expect(filterItems([elem(), csatornas], { channel: 'csatorna a' })).toEqual([csatornas])
  })

  it('szűrő nélkül mindent átenged', () => {
    expect(filterItems([elem()], {})).toHaveLength(1)
  })
})

describe('estimateUnits', () => {
  it('csak a recepttel bíró egységet becsüli, a saját iterációszámával', async () => {
    const summary = getRecipe('summary')
    const units: WorkUnit[] = [
      { item: elem(), recipe: null },
      { item: elem(), recipe: summary },
    ]

    const { slice, first } = await estimateUnits(units, CFG)

    const words = (await normalizeItem(elem())).wordsNormalized
    expect(first).toEqual({
      value: units[1],
      words,
      maxIterations: summary.maxIterations,
      shape: {
        outputRatio: summary.outputRatio,
        judges: summary.rubric.criteria.filter((c) => !c.blocking).length,
        draftPricing: CFG.pricing.draft,
      },
    })
    expect(slice.planned).toEqual([units[1]])
    expect(slice.usd).toBeCloseTo(estimateItemUsd(words, summary.maxIterations, CFG), 10)
  })

  it('a normalizáláson elbukó elem kimarad a becslésből', async () => {
    const units: WorkUnit[] = [
      {
        item: elem({ itemId: 'nincs', subtitlePath: join(dir, 'nincs.hu.srt') }),
        recipe: getRecipe('summary'),
      },
    ]

    const { slice, first } = await estimateUnits(units, CFG)

    expect(first).toBeUndefined()
    expect(slice.planned).toEqual([])
    expect(slice.deferred).toEqual([])
  })

  it('a plafon a teljes indításra közös: két recept együtt szeletelődik', async () => {
    const summary = getRecipe('summary')
    const qa = getRecipe('qa')
    const words = (await normalizeItem(elem())).wordsNormalized
    const egy = estimateItemUsd(words, summary.maxIterations, CFG)
    // A plafon egyetlen párra elég. Receptenkénti szeletelésnél mindkét
    // recept első párja befutna — a közös plafon épp ezt tiltja.
    const cfg: ModelConfig = { ...CFG, costLimitUsd: egy * 1.5 }
    const units: WorkUnit[] = [
      { item: elem(), recipe: summary },
      { item: elem(), recipe: qa },
    ]

    const { slice } = await estimateUnits(units, cfg)

    expect(slice.planned).toEqual([units[0]])
    expect(slice.deferred).toEqual([units[1]])
  })

  it('a felülbírált recept a saját modellje árán becsül', async () => {
    const summary = getRecipe('summary')
    const draga = { inputPerMillion: 300, outputPerMillion: 1500 }
    const cfg: ModelConfig = {
      ...CFG,
      recipeModels: { summary: 'draga-modell' },
      modelPricing: { 'draga-modell': draga },
    }
    const units: WorkUnit[] = [{ item: elem(), recipe: summary }]

    const { slice } = await estimateUnits(units, cfg)

    const words = (await normalizeItem(elem())).wordsNormalized
    const nezet = { ...CFG, pricing: { ...CFG.pricing, draft: draga } }
    expect(slice.usd).toBeCloseTo(
      estimateItemUsd(words, summary.maxIterations, nezet, {
        outputRatio: summary.outputRatio,
        judges: summary.rubric.criteria.filter((c) => !c.blocking).length,
      }),
      10,
    )
  })
})

/** Hamis állapottár: `elem/recept` → státusz. */
function tarolo(statusok: Record<string, string>): Pick<StateStore, 'artifactOf'> {
  return {
    artifactOf: (itemId, kind) => {
      const status = statusok[`${itemId}/${kind}`]
      return status === undefined
        ? null
        : { status, path: null, error: null, iterations: null, score: null, costUsd: null, model: null }
    },
  }
}

describe('sourcesFirst', () => {
  it('az alapreceptek után a fordítások jönnek, mindkét csoporton belül változatlan sorrendben', () => {
    const cleanHu = translationOf(getRecipe('clean-moderate'), 'hu')
    const units: WorkUnit[] = [
      { item: elem({ itemId: 'a' }), recipe: cleanHu },
      { item: elem({ itemId: 'a' }), recipe: getRecipe('clean-moderate') },
      { item: elem({ itemId: 'b' }), recipe: cleanHu },
      { item: elem({ itemId: 'b' }), recipe: null },
    ]
    expect(sourcesFirst(units)).toEqual([units[1], units[3], units[0], units[2]])
  })
})

describe('sourceGap', () => {
  const cleanHu = translationOf(getRecipe('clean-moderate'), 'hu')

  it('nem fordításra és kész forrásra null', () => {
    expect(sourceGap({ item: elem(), recipe: getRecipe('clean-moderate') }, tarolo({}))).toBeNull()
    expect(
      sourceGap({ item: elem(), recipe: cleanHu }, tarolo({ 'abcDEF12345/clean-moderate': 'done' })),
    ).toBeNull()
  })

  it('rögzítetlen forrásra az „előbb kell" okot adja', () => {
    expect(sourceGap({ item: elem(), recipe: cleanHu }, tarolo({}))).toBe(
      'előbb a clean-moderate recept kell',
    )
  })

  it('hibás forrásra a „nem készült el" okot adja', () => {
    expect(
      sourceGap({ item: elem(), recipe: cleanHu }, tarolo({ 'abcDEF12345/clean-moderate': 'failed' })),
    ).toBe('a clean-moderate recept jegyzete nem készült el')
  })
})

describe('sourcePlanned', () => {
  it('csak ugyanannak az elemnek a forrásegységét fogadja el', () => {
    const cleanHu = translationOf(getRecipe('clean-moderate'), 'hu')
    const forditas: WorkUnit = { item: elem({ itemId: 'a' }), recipe: cleanHu }
    expect(sourcePlanned(forditas, [forditas, { item: elem({ itemId: 'a' }), recipe: getRecipe('clean-moderate') }])).toBe(true)
    expect(sourcePlanned(forditas, [forditas, { item: elem({ itemId: 'b' }), recipe: getRecipe('clean-moderate') }])).toBe(false)
    expect(sourcePlanned({ item: elem(), recipe: getRecipe('clean-moderate') }, [])).toBe(false)
  })
})

describe('estimateUnits fordítással', () => {
  it('a fordítás bemenete az átirat a forrásrecept kimeneti arányával, egy bíróval', async () => {
    const clean = getRecipe('clean-moderate')
    const cleanHu = translationOf(clean, 'hu')
    const words = (await normalizeItem(elem())).wordsNormalized

    const { first } = await estimateUnits([{ item: elem(), recipe: cleanHu }], CFG)

    expect(first!.words).toBeCloseTo(words * clean.outputRatio!, 10)
    expect(first!.shape).toEqual({
      outputRatio: cleanHu.outputRatio,
      judges: 1,
      draftPricing: CFG.pricing.draft,
    })
  })

  it('kimeneti arány nélküli forrásnál a becslő alapértelmezésével', async () => {
    const summaryHu = translationOf(getRecipe('summary'), 'hu')
    const words = (await normalizeItem(elem())).wordsNormalized

    const { first } = await estimateUnits([{ item: elem(), recipe: summaryHu }], CFG)

    expect(first!.words).toBeCloseTo(words * 0.1, 10)
  })
})

describe('dryRunLines', () => {
  it('igazított sorok, becslés, összegzés', () => {
    expect(
      dryRunLines(
        [
          { label: 'futna', title: 'Cím A', itemId: 'a1', kind: 'summary', detail: 'AI/a1/Cím_A_summary.md' },
          { label: 'kész', title: 'Cím B', itemId: 'b2', kind: 'summary', detail: 'meglévő jegyzet: AI/b2/Régi_summary.md' },
        ],
        'becslés: 1 elem, ~1200 token, ~0.0100 $ (plafon: 5 $)',
      ),
    ).toEqual([
      '  futna  Cím A (a1)  summary  AI/a1/Cím_A_summary.md',
      '  kész   Cím B (b2)  summary  meglévő jegyzet: AI/b2/Régi_summary.md',
      'becslés: 1 elem, ~1200 token, ~0.0100 $ (plafon: 5 $)',
      'run (szárazfutás): 1 pár futna, 1 kész, 0 kihagyva, 0 elhalasztva',
    ])
  })

  it('üres listán csak az összegzés', () => {
    expect(dryRunLines([], null)).toEqual([
      'run (szárazfutás): 0 pár futna, 0 kész, 0 kihagyva, 0 elhalasztva',
    ])
  })

  it('a sorrend futna, kész, kihagyva, halasztva; csoporton belül a bemeneté', () => {
    const e = (label: DryRunEntry['label'], itemId: string): DryRunEntry => ({
      label,
      title: 'T',
      itemId,
      kind: 'k',
      detail: 'd',
    })
    const lines = dryRunLines([e('halasztva', 'h'), e('kész', 'k'), e('futna', 'f2'), e('futna', 'f1'), e('kihagyva', 's')], null)
    expect(lines.map((l) => /\((\w+)\)/.exec(l)?.[1])).toEqual(['f2', 'f1', 'k', 's', 'h', undefined])
  })
})
