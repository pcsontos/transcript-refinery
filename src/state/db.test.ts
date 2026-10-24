import { DatabaseSync } from 'node:sqlite'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openState, type StateStore, type TranslationChunk } from './db.js'
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

describe('StateStore — hiánylista', () => {
  const metrics = { iterations: 1, score: 0.6, costUsd: 0.01, model: 'szintetikus-modell' }

  it('a metrikákkal együtt rögzíti, és visszaadja', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a_summary.md', null, {
      ...metrics,
      gaps: ['kimaradt: a zárás'],
    })
    expect(store.gapsOf('a1b2c3', 'summary')).toEqual(['kimaradt: a zárás'])
  })

  it('az üres lista rögzített, és különbözik a nem rögzítettől', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, { ...metrics, gaps: [] })
    store.recordArtifact('a1b2c3', 'qa', 'done', '/v/b.md', null, metrics)
    expect(store.gapsOf('a1b2c3', 'summary')).toEqual([])
    expect(store.gapsOf('a1b2c3', 'qa')).toBeNull()
  })

  it('újrarögzítéskor lecseréli a régit', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, {
      ...metrics,
      gaps: ['régi hiány'],
    })
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, {
      ...metrics,
      gaps: ['új hiány'],
    })
    expect(store.gapsOf('a1b2c3', 'summary')).toEqual(['új hiány'])
  })

  it('hibás rögzítésnél törli', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, {
      ...metrics,
      gaps: ['hiány'],
    })
    store.recordArtifact('a1b2c3', 'summary', 'failed', null, 'szintetikus hiba')
    expect(store.gapsOf('a1b2c3', 'summary')).toBeNull()
  })

  it('a hiánylista-tábla nélküli állapotfájl megnyitás után megkapja a táblát', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-regi-'))
    const path = join(dir, 'state.db')
    const old = new DatabaseSync(path)
    old.exec(
      `CREATE TABLE artifacts (
         item_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, path TEXT,
         error TEXT, iterations INTEGER, score REAL, cost_usd REAL, model TEXT,
         created_at TEXT NOT NULL, PRIMARY KEY (item_id, kind))`,
    )
    old.close()

    openState(path).close()

    const check = new DatabaseSync(path)
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifact_gaps'")
      .all()
    check.close()
    expect(tables).toHaveLength(1)
  })
})

describe('StateStore — commitra váró műtermékek', () => {
  it('commit-módban rögzítve megjelenik a commitra várók közt', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null, undefined, true)
    expect(store.listPendingCommits()).toEqual(['/v/a.md'])
  })

  it('commit nélkül rögzítve nem várakozik commitra', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null)
    expect(store.listPendingCommits()).toEqual([])
  })

  it('hibás rögzítésnél nincs mit commitra várni, út híján sem', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'failed', null, 'olvashatatlan', undefined, true)
    expect(store.listPendingCommits()).toEqual([])
  })

  it('a törlés után már nem várakozik commitra', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null, undefined, true)
    store.clearPendingCommits(['/v/a.md'])
    expect(store.listPendingCommits()).toEqual([])
  })

  it('a törlés csak a megadott útvonalakat érinti', () => {
    store.recordItem(item())
    store.recordItem(item({ itemId: 'masik' }))
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null, undefined, true)
    store.recordArtifact('masik', 'transcript', 'done', '/v/b.md', null, undefined, true)
    store.clearPendingCommits(['/v/a.md'])
    expect(store.listPendingCommits()).toEqual(['/v/b.md'])
  })

  it('üres listával a törlés nem dob', () => {
    expect(() => store.clearPendingCommits([])).not.toThrow()
  })

  it('újrarögzítéskor a friss útvonalat várja commitra', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/regi.md', null, undefined, true)
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/uj.md', null, undefined, true)
    expect(store.listPendingCommits()).toEqual(['/v/uj.md'])
  })

  it('rögzítés sorrendjében sorolja fel, több elem és típus esetén is', () => {
    store.recordItem(item())
    store.recordItem(item({ itemId: 'masik' }))
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a-t.md', null, undefined, true)
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a-s.md', null, undefined, true)
    store.recordArtifact('masik', 'transcript', 'done', '/v/m-t.md', null, undefined, true)
    expect(store.listPendingCommits()).toEqual(['/v/a-t.md', '/v/a-s.md', '/v/m-t.md'])
  })

  it('jegyzetenként adja a videóazonosítót, a címet és a fajtát', () => {
    store.recordItem(item({ title: 'Első', metadata: { videoId: 'dQw4w9WgXcQ' } }))
    store.recordItem(item({ itemId: 'masik', title: 'Második' }))
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a-t.md', null, undefined, true)
    store.recordArtifact('masik', 'transcript', 'done', '/v/m-t.md', null, undefined, true)
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a-s.md', null, undefined, true)
    expect(store.listPendingNotes()).toEqual([
      { id: 'dQw4w9WgXcQ', title: 'Első', kind: 'transcript', path: '/v/a-t.md' },
      { id: 'masik', title: 'Második', kind: 'transcript', path: '/v/m-t.md' },
      { id: 'dQw4w9WgXcQ', title: 'Első', kind: 'summary', path: '/v/a-s.md' },
    ])
  })
})

describe('StateStore — fordítási darabok', () => {
  const chunk = (index: number): TranslationChunk => ({
    index,
    sourceHash: 'h',
    output: `d${index}`,
    glossaryAfter: [{ source: 'a|b', target: `c${index}` }],
    usage: { inputTokens: 10 * index, outputTokens: index },
  })

  it('index szerint rendezve adja vissza, a JSON oda-vissza megmarad', () => {
    store.saveTranslationChunk('i1', 'proba-hu', chunk(1))
    store.saveTranslationChunk('i1', 'proba-hu', chunk(0))
    expect(store.translationChunks('i1', 'proba-hu')).toEqual([chunk(0), chunk(1)])
  })

  it('ugyanaz az index felülíródik', () => {
    store.saveTranslationChunk('i1', 'proba-hu', chunk(0))
    store.saveTranslationChunk('i1', 'proba-hu', chunk(1))
    store.saveTranslationChunk('i1', 'proba-hu', { ...chunk(0), output: 'más' })
    const chunks = store.translationChunks('i1', 'proba-hu')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.output).toBe('más')
  })

  it('a törlés csak az adott elem és fajta sorait viszi', () => {
    store.saveTranslationChunk('i1', 'proba-hu', chunk(0))
    store.saveTranslationChunk('i1', 'proba-de', chunk(0))
    store.saveTranslationChunk('i2', 'proba-hu', chunk(0))
    store.clearTranslationChunks('i1', 'proba-hu')
    expect(store.translationChunks('i1', 'proba-hu')).toEqual([])
    expect(store.translationChunks('i1', 'proba-de')).toHaveLength(1)
    expect(store.translationChunks('i2', 'proba-hu')).toHaveLength(1)
  })

  it('a tábla nélküli régi állapotfájl újranyitása idempotens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-state-'))
    const path = join(dir, 'state.db')
    openState(path).close()
    const again = openState(path)
    expect(again.translationChunks('i1', 'proba-hu')).toEqual([])
    again.close()
  })

  it('a noteDirOf nem számít bele a szójegyzéket', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a/B_summary.md', null)
    store.recordArtifact('a1b2c3', 'glossary-hu', 'done', '/v/Szójegyzékek/G.md', null)
    expect(store.noteDirOf('a1b2c3')).toBe('/v/a')
  })
})

describe('relatív utak az állapottár határán', () => {
  let dir: string
  let dbPath: string
  const rawPaths = (table: 'artifacts' | 'pending_commits'): (string | null)[] => {
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return (raw.prepare(`SELECT path FROM ${table} ORDER BY path`).all() as { path: string | null }[]).map(
        (r) => r.path,
      )
    } finally {
      raw.close()
    }
  }
  const userVersion = (): number => {
    const raw = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    } finally {
      raw.close()
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-rel-'))
    dbPath = join(dir, 'state.db')
  })

  const seed = (s: StateStore, ...paths: string[]): void => {
    s.recordItem(item())
    paths.forEach((p, i) => s.recordArtifact('a1b2c3', `k${i}`, 'done', p, null, undefined, true))
  }

  it('a vault alatti utat relatívan tárolja, abszolútként adja vissza', () => {
    const s = openState(dbPath, '/v')
    seed(s, '/v/Inbox/a.md')
    expect(rawPaths('artifacts')).toEqual(['Inbox/a.md'])
    expect(rawPaths('pending_commits')).toEqual(['Inbox/a.md'])
    expect(s.artifactOf('a1b2c3', 'k0')?.path).toBe('/v/Inbox/a.md')
    expect(s.listPendingCommits()).toEqual(['/v/Inbox/a.md'])
    expect(s.listPendingNotes().map((n) => n.path)).toEqual(['/v/Inbox/a.md'])
    s.clearPendingCommits(['/v/Inbox/a.md'])
    expect(s.listPendingCommits()).toEqual([])
    s.close()
  })

  it('a vaulton kívüli (és az előtagra hasonlító) út abszolút marad', () => {
    const s = openState(dbPath, '/v')
    seed(s, '/v-masik/a.md')
    expect(rawPaths('artifacts')).toEqual(['/v-masik/a.md'])
    expect(s.artifactOf('a1b2c3', 'k0')?.path).toBe('/v-masik/a.md')
    s.close()
  })

  it('vaulttal megnyitva átírja a régi abszolút sorokat, előtte .bak készül', () => {
    const old = openState(dbPath)
    seed(old, '/v/Inbox/a.md', '/regi/b.md')
    old.close()
    expect(userVersion()).toBe(0)

    const s = openState(dbPath, '/v')
    s.close()
    expect(rawPaths('artifacts')).toEqual(['/regi/b.md', 'Inbox/a.md'])
    expect(rawPaths('pending_commits')).toEqual(['/regi/b.md', 'Inbox/a.md'])
    expect(userVersion()).toBe(1)
    const bak = new DatabaseSync(`${dbPath}.bak`, { readOnly: true })
    expect((bak.prepare('SELECT path FROM artifacts ORDER BY path').all() as { path: string }[]).map((r) => r.path)).toEqual([
      '/regi/b.md',
      '/v/Inbox/a.md',
    ])
    bak.close()
  })

  it('a második megnyitás nem nyúl a .bak-hoz', async () => {
    const old = openState(dbPath)
    seed(old, '/v/Inbox/a.md')
    old.close()
    openState(dbPath, '/v').close()
    const before = statSync(`${dbPath}.bak`).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    openState(dbPath, '/v').close()
    expect(statSync(`${dbPath}.bak`).mtimeMs).toBe(before)
  })

  it('friss tárnál nincs .bak, de a user_version beáll', () => {
    openState(dbPath, '/v').close()
    expect(existsSync(`${dbPath}.bak`)).toBe(false)
    expect(userVersion()).toBe(1)
  })

  it('trackedPaths a done sorokat adja abszolútként, movePath átírja', () => {
    const s = openState(dbPath, '/v')
    s.recordItem(item())
    s.recordArtifact('a1b2c3', 'transcript', 'done', '/v/Inbox/a.md', null)
    s.recordArtifact('a1b2c3', 'notes', 'failed', null, 'hiba')
    expect(s.trackedPaths()).toEqual([{ itemId: 'a1b2c3', kind: 'transcript', path: '/v/Inbox/a.md' }])
    s.movePath('a1b2c3', 'transcript', '/v/Masik/a.md')
    expect(s.artifactOf('a1b2c3', 'transcript')?.path).toBe('/v/Masik/a.md')
    expect(rawPaths('artifacts')).toEqual([null, 'Masik/a.md'])
    s.close()
  })

  it('noteDirOf egy kész kimenet mappáját adja, kimenet nélkül null', () => {
    const s = openState(dbPath, '/v')
    s.recordItem(item())
    expect(s.noteDirOf('a1b2c3')).toBeNull()
    s.recordArtifact('a1b2c3', 'transcript', 'done', '/v/Inbox/cs/a1b2c3/x_transcript.md', null)
    expect(s.noteDirOf('a1b2c3')).toBe('/v/Inbox/cs/a1b2c3')
    s.close()
  })

  it('noteDirOf az átirat mappáját adja, akkor is, ha egy korábbi sor máshová mutat', () => {
    const s = openState(dbPath, '/v')
    s.recordItem(item())
    s.recordArtifact('a1b2c3', '–', 'done', '/v/regi/x.md', null)
    s.recordArtifact('a1b2c3', 'notes', 'done', '/v/mas/n.md', null)
    s.recordArtifact('a1b2c3', 'transcript', 'done', '/v/uj/t.md', null)
    expect(s.noteDirOf('a1b2c3')).toBe('/v/uj')
    s.close()
  })

  it('a záró perjel nélküli vaultPath-szal a _ és % jeles útvonal is relatív lesz', () => {
    const s = openState(dbPath, '/v_%x')
    seed(s, '/v_%x/Inbox/a.md')
    expect(rawPaths('artifacts')).toEqual(['Inbox/a.md'])
    s.close()
  })

  it('vault nélkül a user_version 0 marad', () => {
    openState(dbPath).close()
    expect(userVersion()).toBe(0)
  })
})
