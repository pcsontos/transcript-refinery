import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { discoverAll } from '../source/folder.js'
import { openState } from '../state/db.js'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import type { SourceItem } from '../types.js'
import { buildItemRows, readItemDetail, stripFrontmatter } from './items.js'

const sourceItem = (itemId: string, title: string, channel?: string): SourceItem => ({
  itemId,
  source: 'youtube',
  sourceFile: `${title}.en.srt`,
  subtitlePath: `/s/${title}.en.srt`,
  baseName: title,
  title,
  language: 'en',
  metadata: channel ? { channel } : {},
})

const itemRow = (itemId: string, title: string): ItemRow => ({
  itemId,
  source: 'youtube',
  sourceFile: `${title}.en.srt`,
  baseName: title,
  title,
  language: 'en',
  channel: 'Régi Csatorna',
  uploadedAt: null,
  url: null,
  discoveredAt: '2026-09-01T00:00:00.000Z',
  captionSource: 'auto',
  wordsRaw: 100,
  wordsNormalized: 40,
})

const artifact = (overrides: Partial<ArtifactRow>): ArtifactRow => ({
  itemId: 'a',
  kind: 'summary',
  status: 'done',
  path: null,
  error: null,
  iterations: 1,
  score: null,
  costUsd: null,
  model: null,
  createdAt: '2026-09-11T09:00:00.000Z',
  ...overrides,
})

describe('buildItemRows', () => {
  it('a felderített elemeket felderítési sorrendben, a csak az állapottárban lévőket utánuk adja', () => {
    const rows = buildItemRows(
      [
        sourceItem('b', 'Második példavideó', 'Szintetikus Csatorna'),
        sourceItem('a', 'Első példavideó'),
      ],
      [itemRow('a', 'Első példavideó'), itemRow('z', 'Eltűnt példavideó')],
      [],
    )

    expect(rows.map((r) => [r.itemId, r.discovered, r.channel])).toEqual([
      ['b', true, 'Szintetikus Csatorna'],
      ['a', true, 'Régi Csatorna'],
      ['z', false, 'Régi Csatorna'],
    ])
    expect(rows[1]!.captionSource).toBe('auto')
  })

  it('típusonként állapotcellát ad, a küszöb alattiak jelölésével', () => {
    const [row] = buildItemRows(
      [sourceItem('a', 'Első példavideó')],
      [],
      [
        artifact({ kind: 'transcript', createdAt: '2026-09-11T08:00:00.000Z' }),
        artifact({ kind: 'summary', score: 0.62, costUsd: 0.01 }),
        artifact({ kind: 'qa', status: 'failed', createdAt: '2026-09-11T10:00:00.000Z' }),
      ],
    )

    expect(row!.cells).toEqual({
      transcript: { status: 'done', score: null, costUsd: null, belowThreshold: false },
      summary: { status: 'done', score: 0.62, costUsd: 0.01, belowThreshold: true },
      flashcards: { status: 'pending', score: null, costUsd: null, belowThreshold: false },
      qa: { status: 'failed', score: null, costUsd: null, belowThreshold: false },
    })
    expect(row!.updatedAt).toBe('2026-09-11T10:00:00.000Z')
  })
})

describe('stripFrontmatter', () => {
  it('levágja a frontmattert, a törzset meghagyja', () => {
    expect(stripFrontmatter('---\nitem_id: a\ntitle: x\n---\n# Cím\n\nSzöveg.\n')).toBe(
      '# Cím\n\nSzöveg.\n',
    )
  })

  it('a frontmatter nélküli szöveget változatlanul adja', () => {
    expect(stripFrontmatter('# Cím\n\n---\n\nSzöveg.\n')).toBe('# Cím\n\n---\n\nSzöveg.\n')
  })
})

describe('readItemDetail', () => {
  let dir: string
  let cfg: Config
  let noteDir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-item-'))
    const channel = join(dir, 'feliratok', 'youtube', 'Szintetikus Csatorna')
    await mkdir(channel, { recursive: true })
    await writeFile(
      join(channel, 'Első példavideó.info.json'),
      JSON.stringify({
        id: 'szint0001',
        title: 'Első példavideó',
        channel: 'Szintetikus Csatorna',
        upload_date: '20260714',
        webpage_url: 'https://example.com/szint0001',
      }),
    )
    await writeFile(
      join(channel, 'Első példavideó.en.srt'),
      '1\n00:00:00,000 --> 00:00:02,000\nEgy szintetikus mondat.\n',
    )
    cfg = loadConfig(
      {
        vault: { path: join(dir, 'vault') },
        sources: [join(dir, 'feliratok', 'youtube')],
        state: { path: 'state.db' },
        logs: { dir: 'logs' },
      },
      join(dir, 'refinery.config.yaml'),
      dir,
    )
    noteDir = join(cfg.notesRoot, 'youtube', 'Szintetikus Csatorna')
    await mkdir(noteDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('ismeretlen elemre null', async () => {
    expect(await readItemDetail(cfg, 'nincs-ilyen')).toBeNull()
  })

  it('a felderített, de fel nem dolgozott elemre műtermék nélküli részletet ad', async () => {
    const detail = await readItemDetail(cfg, 'szint0001')
    expect(detail?.item).toMatchObject({
      title: 'Első példavideó',
      channel: 'Szintetikus Csatorna',
      discovered: true,
    })
    expect(detail?.artifacts).toEqual([])
  })

  it('a jegyzetek törzsét, a hiánylistát, a hibát és a hiányzó fájlt is jelzi', async () => {
    const [item] = await discoverAll(cfg.sources, cfg.languages)
    const transcript = join(noteDir, 'Első példavideó_transcript.md')
    await writeFile(
      transcript,
      '---\nitem_id: szint0001\n---\n# Első példavideó\n\nEgy szintetikus mondat.\n',
    )
    const store = openState(cfg.statePath)
    store.recordItem(item!)
    store.recordTranscript('szint0001', 'creator', 3, 3)
    store.recordArtifact('szint0001', 'transcript', 'done', transcript, null)
    store.recordArtifact('szint0001', 'summary', 'done', join(noteDir, 'nincs_summary.md'), null, {
      iterations: 1,
      score: 0.62,
      costUsd: 0.01,
      model: 'szintetikus-modell',
      gaps: ['kimaradt: a zárás'],
    })
    store.recordArtifact('szint0001', 'qa', 'failed', null, 'szintetikus hiba')
    store.close()

    const detail = await readItemDetail(cfg, 'szint0001')
    expect(detail?.item.captionSource).toBe('creator')
    expect(detail?.artifacts.map((a) => [a.kind, a.status])).toEqual([
      ['transcript', 'done'],
      ['summary', 'done'],
      ['qa', 'failed'],
    ])
    const [t, s, q] = detail!.artifacts
    expect([t!.body, t!.gaps]).toEqual(['# Első példavideó\n\nEgy szintetikus mondat.\n', null])
    expect([s!.body, s!.missingFile, s!.gaps, s!.threshold]).toEqual([
      null,
      true,
      ['kimaradt: a zárás'],
      0.8,
    ])
    expect([q!.error, q!.missingFile]).toEqual(['szintetikus hiba', false])
  })
})
