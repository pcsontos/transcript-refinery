import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { discoverAll } from '../source/folder.js'
import { openState } from '../state/db.js'
import type { ArtifactRow } from '../state/queries.js'
import type { SourceItem } from '../types.js'
import {
  artifactKinds,
  buildOverview,
  emptyCorpusStatus,
  queueOverview,
  readOverview,
  scoreDistribution,
} from './overview.js'
import type { RunSummaryView } from './runs.js'

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

describe('artifactKinds', () => {
  it('az átirat után a registry receptjei, registry-sorrendben', () => {
    expect(artifactKinds()).toEqual(['transcript', 'summary', 'flashcards', 'qa'])
  })
})

describe('scoreDistribution', () => {
  it('tized-sávokba sorol, és a recept küszöbe alattiakat számolja', () => {
    const artifacts = [
      artifact({ itemId: 'a', score: 0.62 }),
      artifact({ itemId: 'b', score: 0.85 }),
      artifact({ itemId: 'c', score: 1 }),
      artifact({ itemId: 'd', score: 0.3, status: 'failed' }),
      artifact({ itemId: 'e', score: 0.5, kind: 'qa' }),
    ]

    const dist = scoreDistribution('summary', artifacts)
    expect(dist.threshold).toBe(0.8)
    expect(dist.buckets).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 1, 1])
    expect([dist.scored, dist.belowThreshold]).toEqual([3, 1])
  })
})

describe('emptyCorpusStatus', () => {
  it('pontosan azt adja, amit egy üres állapottár corpusStatus-a', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-ures-'))
    const items: SourceItem[] = ['youtube', 'meetings', 'youtube'].map((source, i) => ({
      itemId: `i${String(i)}`,
      source,
      sourceFile: `x${String(i)}.srt`,
      subtitlePath: `/s/x${String(i)}.srt`,
      baseName: `x${String(i)}`,
      title: `x${String(i)}`,
      language: null,
      metadata: {},
    }))

    const store = openState(join(dir, 'state.db'))
    expect(emptyCorpusStatus(items)).toEqual(store.corpusStatus(items, 'summary'))
    store.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('queueOverview', () => {
  const SOR = [
    '## youtube',
    '- Első példavideó %%a%%',
    '  - [x] summary',
    '  - [ ] flashcards',
    '  - [x] qa',
    '- Második példavideó %%b%%',
    '  - [x] summary',
    '- Harmadik példavideó %%c%%',
    '  - [x] summary',
    '  - [x] ismeretlen',
    '',
  ].join('\n')

  it('a kipipált párokat az állapottár szerint számolja, registry-sorrendben', () => {
    const artifacts = [
      artifact({ itemId: 'a', kind: 'summary', status: 'done' }),
      artifact({ itemId: 'b', kind: 'summary', status: 'failed' }),
    ]
    expect(queueOverview(SOR, artifacts)).toEqual([
      { recipe: 'summary', checked: 3, done: 1, failed: 1, pending: 1 },
      { recipe: 'qa', checked: 1, done: 0, failed: 0, pending: 1 },
    ])
  })
})

describe('buildOverview', () => {
  const run = (runId: string, status: RunSummaryView['status']): RunSummaryView => ({
    runId,
    status,
    command: null,
    startedAt: null,
    lastEventAt: null,
    durationMs: null,
    units: null,
    estimate: null,
    succeeded: 0,
    failed: 0,
    spentUsd: 0,
    hasReport: false,
    invalid: 0,
  })

  it('csak a futó futásokat emeli ki, és a teljes költést összegzi', () => {
    const overview = buildOverview({
      hasState: true,
      discovered: 2,
      corpus: [],
      artifacts: [
        artifact({ costUsd: 0.01 }),
        artifact({ itemId: 'b', kind: 'transcript', costUsd: null }),
      ],
      queueText: null,
      runs: [run('2026-09-11T09-00-00', 'running'), run('2026-09-10T08-00-00', 'done')],
    })

    expect(overview.running.map((r) => r.runId)).toEqual(['2026-09-11T09-00-00'])
    expect(overview.totalCostUsd).toBe(0.01)
    expect(overview.queue).toBeNull()
    expect(overview.scores.map((s) => s.recipe)).toEqual(['summary', 'flashcards', 'qa'])
  })
})

describe('readOverview', () => {
  let dir: string
  let cfg: Config
  const SRT = '1\n00:00:00,000 --> 00:00:02,000\nEgy szintetikus mondat.\n'

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-overview-'))
    const channel = join(dir, 'feliratok', 'youtube', 'Szintetikus Csatorna')
    await mkdir(channel, { recursive: true })
    const videos = [
      ['szint0001', 'Első példavideó'],
      ['szint0002', 'Második példavideó'],
    ] as const
    for (const [id, title] of videos) {
      await writeFile(
        join(channel, `${title}.info.json`),
        JSON.stringify({
          id,
          title,
          channel: 'Szintetikus Csatorna',
          upload_date: '20260714',
          webpage_url: `https://example.com/${id}`,
        }),
      )
      await writeFile(join(channel, `${title}.en.srt`), SRT)
    }
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
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('állapotfájl nélkül minden felderített elem hátra van', async () => {
    const overview = await readOverview(cfg)
    expect(overview.hasState).toBe(false)
    expect(overview.discovered).toBe(2)
    expect(overview.corpus.map((c) => [c.kind, c.status.pending])).toEqual([
      ['transcript', 2],
      ['summary', 2],
      ['flashcards', 2],
      ['qa', 2],
    ])
    expect(overview.queue).toBeNull()
    expect(overview.running).toEqual([])
  })

  it('az író corpusStatus-át adja, és látszik a sor és a futó futás', async () => {
    const items = await discoverAll(cfg.sources, cfg.languages)
    const store = openState(cfg.statePath)
    for (const item of items) store.recordItem(item)
    store.recordArtifact('szint0001', 'summary', 'done', '/v/a.md', null, {
      iterations: 1,
      score: 0.62,
      costUsd: 0.01,
      model: 'szintetikus-modell',
      gaps: [],
    })
    const expected = store.corpusStatus(items, 'summary')
    store.close()

    await mkdir(cfg.notesRoot, { recursive: true })
    await writeFile(join(cfg.notesRoot, '_queue.md'), '- Első példavideó %%szint0001%%\n  - [x] summary\n')
    await mkdir(cfg.logsDir, { recursive: true })
    await writeFile(
      join(cfg.logsDir, '2026-09-11T09-00-00.jsonl'),
      `${JSON.stringify({ type: 'run:started', command: 'run', pid: 4242 })}\n`,
    )

    const overview = await readOverview(cfg, (pid) => pid === 4242)
    expect(overview.corpus.find((c) => c.kind === 'summary')?.status).toEqual(expected)
    expect(overview.queue).toEqual([{ recipe: 'summary', checked: 1, done: 1, failed: 0, pending: 0 }])
    expect(overview.running.map((r) => r.runId)).toEqual(['2026-09-11T09-00-00'])
    expect(overview.scores[0]).toMatchObject({ recipe: 'summary', scored: 1, belowThreshold: 1 })
  })
})
