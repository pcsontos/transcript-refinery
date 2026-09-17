import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { RECIPES } from './registry.js'

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
 * A meglévő receptek promptjainak ujjlenyomata a Bloom- és jegyzetszelet
 * előtti `main`-ről. Regressziós horgony: a közös modulokba költözés és a
 * címkevarrat egyetlen bájtot sem változtathat a promptokon.
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
  clean: {
    prompt: '95458655342096b5a39ea368a523273a5e41e148211ffb595098e35f56f5a302',
    repair: '5b34753065aa9cf6ebe557133be2357edb37b214d02a6db3c2def8a45264d00a',
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
})
