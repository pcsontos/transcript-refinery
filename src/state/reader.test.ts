import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { openState } from './db.js'
import { openReadOnlyDatabase, openStateReader } from './reader.js'

let dir: string
let path: string

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: '/s/youtube/csatorna/Beszéd.en.srt',
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: { channel: 'Szintetikus Csatorna' },
  ...overrides,
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-reader-'))
  path = join(dir, 'state.db')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Az író tölti fel: pontosan azt az állapotot látjuk, amit a CLI hagy maga után. */
function seed(): void {
  const store = openState(path)
  store.recordItem(item())
  store.recordTranscript('a1b2c3', 'creator', 1000, 400)
  store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/Beszéd_transcript.md', null)
  store.recordArtifact('a1b2c3', 'summary', 'done', '/v/Beszéd_summary.md', null, {
    iterations: 1,
    score: 0.7,
    costUsd: 0.02,
    model: 'szintetikus-modell',
    gaps: ['kimaradt: a zárás'],
  })
  store.close()
}

describe('openStateReader', () => {
  it('hiányzó állapotfájlra null-t ad', () => {
    expect(openStateReader(path)).toBeNull()
  })

  it('az elemeket az átirat mérőszámaival adja vissza', () => {
    seed()
    const reader = openStateReader(path)!
    expect(reader.items()).toEqual([
      expect.objectContaining({
        itemId: 'a1b2c3',
        title: 'Beszéd',
        channel: 'Szintetikus Csatorna',
        captionSource: 'creator',
        wordsRaw: 1000,
        wordsNormalized: 400,
      }),
    ])
    reader.close()
  })

  it('minden műtermék sorát visszaadja, elem és típus szerint rendezve', () => {
    seed()
    const reader = openStateReader(path)!
    expect(reader.artifacts().map((a) => [a.kind, a.status, a.score])).toEqual([
      ['summary', 'done', 0.7],
      ['transcript', 'done', null],
    ])
    reader.close()
  })

  it('a hiánylistát és a korpusz-állapotot ugyanúgy adja, mint az író', () => {
    seed()
    const reader = openStateReader(path)!
    const writer = openState(path)
    expect(reader.gapsOf('a1b2c3', 'summary')).toEqual(['kimaradt: a zárás'])
    expect(reader.corpusStatus([item()], 'summary')).toEqual(writer.corpusStatus([item()], 'summary'))
    writer.close()
    reader.close()
  })

  it('a nyitott olvasó látja az író későbbi rögzítését', () => {
    seed()
    const reader = openStateReader(path)!
    const writer = openState(path)
    writer.recordArtifact('a1b2c3', 'qa', 'failed', null, 'szintetikus hiba')
    writer.close()
    expect(reader.artifacts().some((a) => a.kind === 'qa' && a.status === 'failed')).toBe(true)
    reader.close()
  })

  it('hiánylista-tábla nélküli állapotfájlon a hiánylista null', () => {
    seed()
    const db = new DatabaseSync(path)
    db.exec('DROP TABLE artifact_gaps')
    db.close()
    const reader = openStateReader(path)!
    expect(reader.gapsOf('a1b2c3', 'summary')).toBeNull()
    reader.close()
  })

  it('régi sémájú állapotfájlnál ugyanazt a hibát dobja, mint az író', () => {
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE artifacts (video_id TEXT PRIMARY KEY)')
    old.close()
    expect(() => openStateReader(path)).toThrow(/régi, videó-alapú sémát/)
  })
})

describe('openReadOnlyDatabase', () => {
  it('a kapcsolaton az írást az SQLite utasítja el', () => {
    seed()
    const db = openReadOnlyDatabase(path)
    expect(() =>
      db.exec("INSERT INTO artifact_gaps (item_id, kind, gaps) VALUES ('x', 'y', '[]')"),
    ).toThrow(/readonly/)
    db.close()
  })
})
