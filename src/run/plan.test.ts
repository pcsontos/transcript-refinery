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
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
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
    const cleanHu = translationOf(getRecipe('clean'), 'hu')
    const units: WorkUnit[] = [
      { item: elem({ itemId: 'a' }), recipe: cleanHu },
      { item: elem({ itemId: 'a' }), recipe: getRecipe('clean') },
      { item: elem({ itemId: 'b' }), recipe: cleanHu },
      { item: elem({ itemId: 'b' }), recipe: null },
    ]
    expect(sourcesFirst(units)).toEqual([units[1], units[3], units[0], units[2]])
  })
})

describe('sourceGap', () => {
  const cleanHu = translationOf(getRecipe('clean'), 'hu')

  it('nem fordításra és kész forrásra null', () => {
    expect(sourceGap({ item: elem(), recipe: getRecipe('clean') }, tarolo({}))).toBeNull()
    expect(
      sourceGap({ item: elem(), recipe: cleanHu }, tarolo({ 'abcDEF12345/clean': 'done' })),
    ).toBeNull()
  })

  it('rögzítetlen forrásra az „előbb kell" okot adja', () => {
    expect(sourceGap({ item: elem(), recipe: cleanHu }, tarolo({}))).toBe(
      'előbb a clean recept kell',
    )
  })

  it('hibás forrásra a „nem készült el" okot adja', () => {
    expect(
      sourceGap({ item: elem(), recipe: cleanHu }, tarolo({ 'abcDEF12345/clean': 'failed' })),
    ).toBe('a clean recept jegyzete nem készült el')
  })
})

describe('sourcePlanned', () => {
  it('csak ugyanannak az elemnek a forrásegységét fogadja el', () => {
    const cleanHu = translationOf(getRecipe('clean'), 'hu')
    const forditas: WorkUnit = { item: elem({ itemId: 'a' }), recipe: cleanHu }
    expect(sourcePlanned(forditas, [forditas, { item: elem({ itemId: 'a' }), recipe: getRecipe('clean') }])).toBe(true)
    expect(sourcePlanned(forditas, [forditas, { item: elem({ itemId: 'b' }), recipe: getRecipe('clean') }])).toBe(false)
    expect(sourcePlanned({ item: elem(), recipe: getRecipe('clean') }, [])).toBe(false)
  })
})

describe('estimateUnits fordítással', () => {
  it('a fordítás bemenete az átirat a forrásrecept kimeneti arányával, egy bíróval', async () => {
    const clean = getRecipe('clean')
    const cleanHu = translationOf(clean, 'hu')
    const words = (await normalizeItem(elem())).wordsNormalized

    const { first } = await estimateUnits([{ item: elem(), recipe: cleanHu }], CFG)

    expect(first!.words).toBeCloseTo(words * clean.outputRatio!, 10)
    expect(first!.shape).toEqual({ outputRatio: cleanHu.outputRatio, judges: 1 })
  })

  it('kimeneti arány nélküli forrásnál a becslő alapértelmezésével', async () => {
    const summaryHu = translationOf(getRecipe('summary'), 'hu')
    const words = (await normalizeItem(elem())).wordsNormalized

    const { first } = await estimateUnits([{ item: elem(), recipe: summaryHu }], CFG)

    expect(first!.words).toBeCloseTo(words * 0.1, 10)
  })
})
