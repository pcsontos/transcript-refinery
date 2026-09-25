import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { RECIPES, RECIPE_IDS } from './registry.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'proba',
  sourceFile: 'Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: {},
}

const INPUT = { item: ITEM, transcript: 'A, majd B.', timed: [{ start: 0, text: 'A, majd B.' }] }

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * A meglévő receptek promptjainak ujjlenyomata. A `summary`, `flashcards`, `qa`
 * és `clean` értéke a Bloom- és jegyzetszelet előtti `main`-ről (2026-09-16), a
 * `bloom` és a `notes` értéke a fordítás-szelet előttiről (2026-09-17).
 * Regressziós horgony: egyetlen később változtatás sem módosíthat egy bájtot
 * sem a promptokon. A `clean`-szintek értéke a v1.5 kör bevezetésekor
 * (2026-09-25) rögzült; a régi `clean` prompt megszűnt.
 */
const EXPECTED: Record<string, { prompt: string; repair: string }> = {
  summary: {
    prompt: '8f7bf756ccfff9e3fb881c6b3d682446397adfa47fab8c95e094ccf42ede2c6e',
    repair: 'a487815e6c5cbb033aa636708fa777f2c3dc13a81c996366c5fdf787b9730953',
  },
  flashcards: {
    prompt: 'f515047dfc8c95c92f2669f148fbf1ebb7396abb6569a520a5505e567832f3ff',
    repair: '63394bd2a58311ffdd6d40b8287748e1c81a6bada6bc89f0f548e56b12807d42',
  },
  qa: {
    prompt: 'a3be6367760592a0fbb6d5ab48e12913c76902b0fa46459b02b0756e41a435cf',
    repair: '90cd8cf2f8b000addca27c4ff52ea2c2f7dbb1f2aa6afa92a02aa685515e5d54',
  },
  'clean-mild': {
    prompt: 'cdc2888d7e56d1ae76675425c9d22c4755f560e344a25f5a89e671d05ec8f218',
    repair: 'afd0af567cae45e48898853bc22ae04be49b5caee2dcd42d39353dc58296f515',
  },
  'clean-moderate': {
    prompt: 'b78ff6831c1ba498df9f70e6f03166097c1b373c176cde21e1488a28859b316c',
    repair: '9061cafc2f9b709aef06acf98d253e5c9b0ee6a6b32fe38bdb5b743d55901a19',
  },
  'clean-deep': {
    prompt: 'a8d8fe9f87c83943662579bd24b52968fcb77c994263e9037655202e61351bd5',
    repair: '475ce89850011bff9b1160d963574a7bffbd3119580aab9cb0b561193ded4f54',
  },
  bloom: {
    prompt: '9c9196b97fe0ee7b0ccada981a86750087e439c7a17c3321378a5ba3d572f6cc',
    repair: '982741b18d089c8e87b16c7bb38b216c4e4602e9d994a36a0479990648653053',
  },
  notes: {
    prompt: '7be1d2dc933adf3fa7a792678147e7e1cd7c0feee0b7beed7b8ad27ecb0168b2',
    repair: '6f6220e3e551c189ef1baccbdd3beadcde10f09b8256d825e173459ecec9e7a3',
  },
}

describe('a meglévő receptek promptjai', () => {
  for (const [id, expected] of Object.entries(EXPECTED)) {
    it(`a ${id} promptja és javító promptja bájtra változatlan`, () => {
      const recipe = RECIPES[id]!
      expect(sha256(recipe.prompt(INPUT))).toBe(expected.prompt)
      expect(
        sha256(recipe.repairPrompt({ ...INPUT, previous: 'ELŐZŐ', gaps: ['HIÁNY'] })),
      ).toBe(expected.repair)
    })
  }

  it('minden alaprecept horgonyozva van, regiszter-sorrendben', () => {
    expect(Object.keys(EXPECTED)).toEqual(RECIPE_IDS)
  })
})
