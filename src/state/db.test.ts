import { DatabaseSync } from 'node:sqlite'
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

  it('az isDone típus-specifikus: az egyik recept kész státusza nem érinti a másikat', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('a1b2c3', 'transcript')).toBe(true)
    expect(store.isDone('a1b2c3', 'summary')).toBe(false)
  })

  it('a fájlba írt állapot újranyitás után is megmarad', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-state-reopen-'))
    const path = join(dir, 'state.db')
    const first = openState(path)
    first.recordItem(item())
    first.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null)
    first.close()

    const reopened = openState(path)
    expect(reopened.isDone('a1b2c3', 'transcript')).toBe(true)
    reopened.close()
  })

  it('a régi, videó-alapú sémájú állapotfájlt beszédes hibával utasítja el', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-state-legacy-'))
    const path = join(dir, 'state.db')
    const legacy = new DatabaseSync(path)
    legacy.exec('CREATE TABLE artifacts (video_id TEXT, kind TEXT)')
    legacy.close()

    expect(() => openState(path)).toThrow(/régi/)
  })
})

describe('corpusStatus', () => {
  it('forrásonként bontja a készet, a hibásat és a hátralévőt', () => {
    const a = item({ itemId: 'a', source: 'youtube' })
    const b = item({ itemId: 'b', source: 'youtube' })
    const c = item({ itemId: 'c', source: 'meetings' })
    for (const i of [a, b, c]) store.recordItem(i)

    store.recordArtifact('a', 'summary', 'done', '/v/a.md', null, {
      iterations: 1,
      score: 0.9,
      costUsd: 0.08,
      model: 'draft-modell',
    })
    store.recordArtifact('b', 'summary', 'failed', null, 'a bíró nem válaszolt')

    const status = store.corpusStatus([a, b, c], 'summary')
    expect(status.bySource).toEqual([
      { source: 'meetings', total: 1, done: 0, failed: 0, pending: 1 },
      { source: 'youtube', total: 2, done: 1, failed: 1, pending: 0 },
    ])
    expect(status.done).toBe(1)
    expect(status.failed).toBe(1)
    expect(status.pending).toBe(1)
  })

  it('a felirat-forrás bontása az átiratokból jön, és csak a megadott elemeket számolja', () => {
    const a = item({ itemId: 'a' })
    const b = item({ itemId: 'b' })
    for (const i of [a, b]) store.recordItem(i)
    store.recordTranscript('a', 'creator', 100, 40)
    store.recordTranscript('b', 'auto', 200, 90)

    expect(store.corpusStatus([a], 'summary').byCaptionSource).toEqual({
      creator: 1,
      auto: 0,
    })
  })

  it('összegzi az eddig elköltött dollárt', () => {
    const a = item({ itemId: 'a' })
    const b = item({ itemId: 'b' })
    for (const i of [a, b]) store.recordItem(i)
    store.recordArtifact('a', 'summary', 'done', '/v/a.md', null, {
      iterations: 1,
      score: 0.9,
      costUsd: 0.08,
      model: 'm',
    })
    store.recordArtifact('b', 'summary', 'done', '/v/b.md', null, {
      iterations: 2,
      score: 0.8,
      costUsd: 0.12,
      model: 'm',
    })

    expect(store.corpusStatus([a, b], 'summary').totalCostUsd).toBeCloseTo(0.2, 6)
  })

  it('üres állapottáron minden elem hátralévő', () => {
    expect(store.corpusStatus([item({ itemId: 'a' })], 'summary')).toEqual({
      bySource: [{ source: 'youtube', total: 1, done: 0, failed: 0, pending: 1 }],
      byCaptionSource: { creator: 0, auto: 0 },
      done: 0,
      failed: 0,
      pending: 1,
      totalCostUsd: 0,
    })
  })
})

describe('listFailed', () => {
  it('csak a hibás státuszú elemeket adja vissza', () => {
    const a = item({ itemId: 'a' })
    const b = item({ itemId: 'b' })
    const c = item({ itemId: 'c' })
    for (const i of [a, b, c]) store.recordItem(i)
    store.recordArtifact('a', 'summary', 'done', '/v/a.md', null)
    store.recordArtifact('b', 'summary', 'failed', null, 'időtúllépés')

    expect(store.listFailed([a, b, c], 'summary').map((i) => i.itemId)).toEqual(['b'])
  })

  it('a hibás státusz típusonként külön él', () => {
    const a = item({ itemId: 'a' })
    store.recordItem(a)
    store.recordArtifact('a', 'transcript', 'failed', null, 'olvashatatlan felirat')

    expect(store.listFailed([a], 'summary')).toEqual([])
    expect(store.listFailed([a], 'transcript').map((i) => i.itemId)).toEqual(['a'])
  })
})
