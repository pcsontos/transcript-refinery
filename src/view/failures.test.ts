import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import { groupFailures, readFailures } from './failures.js'

const itemRow = (itemId: string, title: string): ItemRow => ({
  itemId,
  source: 'youtube',
  sourceFile: `${title}.en.srt`,
  baseName: title,
  title,
  language: 'en',
  channel: null,
  uploadedAt: null,
  url: null,
  discoveredAt: '2026-09-01T00:00:00.000Z',
  captionSource: null,
  wordsRaw: null,
  wordsNormalized: null,
})

const failed = (itemId: string, kind: string, error: string): ArtifactRow => ({
  itemId,
  kind,
  status: 'failed',
  path: null,
  error,
  iterations: null,
  score: null,
  costUsd: null,
  model: null,
  createdAt: '2026-09-11T09:00:00.000Z',
})

describe('groupFailures', () => {
  it('a hibaüzenet első sora szerint csoportosít, a nagyobb csoport elöl', () => {
    const items = [itemRow('a', 'Első példavideó'), itemRow('b', 'Második példavideó')]
    const wikilink = 'a jegyzet megsérti a vault írási szabályait: wikilink tiltott'

    const groups = groupFailures(items, [
      failed('b', 'qa', `${wikilink}\nrészletek`),
      failed('a', 'summary', wikilink),
      failed('a', 'qa', 'sebességkorlát'),
      { ...failed('b', 'summary', ''), status: 'done', error: null },
    ])

    expect(groups).toEqual([
      {
        message: wikilink,
        count: 2,
        items: [
          { itemId: 'a', title: 'Első példavideó', kind: 'summary' },
          { itemId: 'b', title: 'Második példavideó', kind: 'qa' },
        ],
      },
      {
        message: 'sebességkorlát',
        count: 1,
        items: [{ itemId: 'a', title: 'Első példavideó', kind: 'qa' }],
      },
    ])
  })
})

describe('readFailures', () => {
  it('állapotfájl nélkül üres listát ad', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-failures-'))
    expect(readFailures({ statePath: join(dir, 'nincs.db') })).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })
})
