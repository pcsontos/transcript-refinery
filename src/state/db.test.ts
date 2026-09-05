import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openState, type StateStore } from './db.js'
import type { SourceItem } from '../types.js'

let store: StateStore

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: '/s/youtube/csatorna/Beszéd.en.srt',
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: {},
  ...overrides,
})

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'refinery-state-'))
  store = openState(join(dir, 'state.db'))
})

afterEach(() => {
  store.close()
})

describe('StateStore', () => {
  it('metaadat nélküli elemet is el tud tárolni', () => {
    store.recordItem(item())
    store.recordTranscript('a1b2c3', 'creator', 100, 90)
    expect(store.transcriptOf('a1b2c3')).toEqual({
      source: 'creator',
      wordsRaw: 100,
      wordsNormalized: 90,
    })
  })

  it('a metaadatot eltárolja, ha van', () => {
    store.recordItem(item({ itemId: 'q6p', metadata: { videoId: 'q6p', channel: 'Cs' } }))
    store.recordArtifact('q6p', 'transcript', 'done', '/v/a.md', null)
    expect(store.artifactOf('q6p', 'transcript')?.path).toBe('/v/a.md')
  })

  it('ugyanazt az elemet kétszer rögzítve nem duplikál', () => {
    store.recordItem(item())
    store.recordItem(item({ title: 'Új cím' }))
    expect(store.listPending([item()], 'transcript')).toHaveLength(1)
  })

  it('a kész elemet kihagyja a függők közül', () => {
    const it1 = item()
    const it2 = item({ itemId: 'masik' })
    store.recordItem(it1)
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null)
    expect(store.listPending([it1, it2], 'transcript').map((i) => i.itemId)).toEqual(['masik'])
  })

  it('a hibás artefaktum nem számít késznek', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'failed', null, 'olvashatatlan')
    expect(store.isDone('a1b2c3', 'transcript')).toBe(false)
  })

  it('a recept mérőszámait visszaadja', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/s.md', null, {
      iterations: 2,
      score: 0.85,
      costUsd: 0.08,
      model: 'claude-sonnet-5',
    })
    const record = store.artifactOf('a1b2c3', 'summary')
    expect(record?.iterations).toBe(2)
    expect(record?.model).toBe('claude-sonnet-5')
  })

  it('a kétszeri zárás nem dob', () => {
    store.close()
    expect(() => store.close()).not.toThrow()
  })
})
