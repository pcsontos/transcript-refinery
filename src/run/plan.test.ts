import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { estimateItemUsd } from '../model/budget.js'
import { normalizeItem } from '../pipeline.js'
import { getRecipe } from '../recipe/registry.js'
import type { SourceItem } from '../types.js'
import {
  estimateUnits,
  filterItems,
  matchesFilters,
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
    expect(first).toEqual({ value: units[1], words, maxIterations: summary.maxIterations })
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
