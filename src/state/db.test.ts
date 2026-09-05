import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { openState, type StateStore } from './db.js'

const item = (videoId: string): SourceItem => ({
  videoId,
  title: `Cím ${videoId}`,
  channel: 'Csatorna',
  uploadedAt: '2026-07-14',
  url: `https://www.youtube.com/watch?v=${videoId}`,
  subtitlePath: `/d/${videoId}.srt`,
  mediaPath: null,
})

let store: StateStore
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-state-'))
  store = openState(join(dir, 'state.db'))
})

afterEach(() => store.close())

describe('StateStore', () => {
  it('egy videó kétszeri rögzítése nem hoz létre duplikátumot', () => {
    store.recordVideo(item('abc'))
    store.recordVideo(item('abc'))
    expect(store.listPending([item('abc')], 'transcript')).toHaveLength(1)
  })

  it('a sikeresen kész elemet kihagyja a függőben lévők közül', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.listPending([item('abc')], 'transcript')).toEqual([])
  })

  it('a hibás elemet nem tekinti késznek, hogy újrapróbálható legyen', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'failed', null, 'nincs felirat')
    expect(store.listPending([item('abc')], 'transcript')).toHaveLength(1)
  })

  it('megkülönbözteti a soha nem próbáltat a hibásan végződőtől', () => {
    store.recordVideo(item('abc'))
    expect(store.isDone('abc', 'transcript')).toBe(false)
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('abc', 'transcript')).toBe(true)
  })

  it('a típusokat külön követi', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('abc', 'summary')).toBe(false)
  })

  it('rögzíti az átirat származását és szószámait', () => {
    store.recordVideo(item('abc'))
    store.recordTranscript('abc', 'auto', 11468, 3939)
    expect(store.transcriptOf('abc')).toEqual({
      source: 'auto',
      wordsRaw: 11468,
      wordsNormalized: 3939,
    })
  })

  it('újranyitás után is emlékszik', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    const path = store.path
    store.close()
    const again = openState(path)
    expect(again.isDone('abc', 'transcript')).toBe(true)
    again.close()
  })
})

describe('artifacts metrikák', () => {
  const ITEM = item('abc123')

  it('eltárolja és visszaadja a recept-metrikákat', () => {
    const store = openState(join(dir, 'metrikak.db'))
    store.recordVideo(ITEM)
    store.recordArtifact(ITEM.videoId, 'summary', 'done', '/vault/a_summary.md', null, {
      iterations: 2,
      score: 0.91,
      costUsd: 0.0812,
      model: 'claude-sonnet-5',
    })

    const record = store.artifactOf(ITEM.videoId, 'summary')

    expect(record).not.toBeNull()
    expect(record!.iterations).toBe(2)
    expect(record!.score).toBeCloseTo(0.91, 10)
    expect(record!.costUsd).toBeCloseTo(0.0812, 10)
    expect(record!.model).toBe('claude-sonnet-5')
    store.close()
  })

  it('metrikák nélkül is rögzít — a Fázis 0 útja változatlan', () => {
    const store = openState(join(dir, 'metrika-nelkul.db'))
    store.recordVideo(ITEM)
    store.recordArtifact(ITEM.videoId, 'transcript', 'done', '/vault/a.md', null)

    const record = store.artifactOf(ITEM.videoId, 'transcript')

    expect(record!.status).toBe('done')
    expect(record!.score).toBeNull()
    expect(record!.model).toBeNull()
    store.close()
  })

  it('régi sémájú adatbázist migrál, adatvesztés nélkül', () => {
    const path = join(dir, 'regi-sema.db')

    // A Fázis 0 sémája, pontosan úgy, ahogy a lemezen van.
    const regi = new DatabaseSync(path)
    regi.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY, title TEXT NOT NULL, channel TEXT NOT NULL,
        uploaded_at TEXT NOT NULL, url TEXT NOT NULL, subtitle_path TEXT NOT NULL,
        media_path TEXT, discovered_at TEXT NOT NULL
      );
      CREATE TABLE artifacts (
        video_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
        path TEXT, error TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY (video_id, kind)
      );
    `)
    regi
      .prepare(
        `INSERT INTO videos VALUES ('regi1','Régi','Csatorna','2026-01-01','http://x','/a.srt',NULL,'2026-01-01')`,
      )
      .run()
    regi
      .prepare(
        `INSERT INTO artifacts VALUES ('regi1','transcript','done','/vault/regi.md',NULL,'2026-01-01')`,
      )
      .run()
    regi.close()

    // A megnyitás migrál.
    const store = openState(path)

    const record = store.artifactOf('regi1', 'transcript')
    expect(record!.path).toBe('/vault/regi.md')
    expect(record!.score).toBeNull()

    // És az új oszlopok írhatók.
    store.recordArtifact('regi1', 'summary', 'done', '/vault/regi_summary.md', null, {
      iterations: 1,
      score: 0.85,
      costUsd: 0.05,
      model: 'proba-modell',
    })
    expect(store.artifactOf('regi1', 'summary')!.score).toBeCloseTo(0.85, 10)
    store.close()
  })

  it('a migráció idempotens: kétszeri megnyitás nem hasal el', () => {
    const path = join(dir, 'ketszer.db')
    openState(path).close()
    const masodik = openState(path)
    expect(masodik.path).toBe(path)
    masodik.close()
  })

  it('nem létező artefaktumra null', () => {
    const store = openState(join(dir, 'ures.db'))
    expect(store.artifactOf('nincs', 'summary')).toBeNull()
    store.close()
  })
})
