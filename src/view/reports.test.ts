import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { recipesFor } from '../recipe/registry.js'
import { openState } from '../state/db.js'
import type { ItemRow } from '../state/queries.js'
import type { SourceItem } from '../types.js'
import type { ItemCell, ItemListRow } from './items.js'
import { summarizeChannels } from './list.js'
import {
  buildReports,
  CLEAN_SERIES,
  readReports,
  runCommandFor,
  shellQuote,
  TRANSLATION_SERIES,
  type ReportsInput,
} from './reports.js'
import type { RunSummaryView } from './runs.js'

const REGISTRY = recipesFor({
  translate: { to: 'hu', recipes: ['summary', 'clean-moderate'] },
  configPath: '/p/c.yaml',
})

const cell = (overrides: Partial<ItemCell> = {}): ItemCell => ({
  status: 'pending',
  score: null,
  costUsd: null,
  belowThreshold: false,
  ...overrides,
})

/** Egy sor minden típusra „hátra" cellával, a megadottak felülírásával. */
const row = (
  itemId: string,
  channel: string | null,
  cells: Record<string, Partial<ItemCell>> = {},
  overrides: Partial<Omit<ItemListRow, 'cells'>> = {},
): ItemListRow => ({
  itemId,
  title: `Cím ${itemId}`,
  source: 'youtube',
  channel,
  captionSource: null,
  discovered: true,
  updatedAt: null,
  cells: Object.fromEntries(
    ['transcript', ...Object.keys(REGISTRY)].map((kind) => [kind, cell(cells[kind])]),
  ),
  ...overrides,
})

const discovered = (itemId: string, language: string | null = 'en'): SourceItem => ({
  itemId,
  source: 'youtube',
  sourceFile: `${itemId}.en.srt`,
  subtitlePath: `/s/${itemId}.en.srt`,
  baseName: itemId,
  title: `Cím ${itemId}`,
  language,
  metadata: {},
})

const itemRow = (itemId: string, wordsNormalized: number | null, language = 'en'): ItemRow => ({
  itemId,
  source: 'youtube',
  sourceFile: `${itemId}.en.srt`,
  baseName: itemId,
  title: `Cím ${itemId}`,
  language,
  channel: null,
  uploadedAt: null,
  url: null,
  discoveredAt: '2026-09-01T00:00:00.000Z',
  captionSource: wordsNormalized === null ? null : 'auto',
  wordsRaw: wordsNormalized === null ? null : wordsNormalized * 2,
  wordsNormalized,
})

const run = (runId: string, overrides: Partial<RunSummaryView> = {}): RunSummaryView => ({
  runId,
  status: 'done',
  command: 'run --recipe summary',
  startedAt: `${runId}Z`,
  lastEventAt: null,
  durationMs: null,
  units: null,
  estimate: null,
  succeeded: 0,
  failed: 0,
  spentUsd: 0,
  hasReport: false,
  invalid: 0,
  ...overrides,
})

const input = (overrides: Partial<ReportsInput> = {}): ReportsInput => ({
  hasState: true,
  discovered: [],
  rows: [],
  items: [],
  runs: [],
  registry: REGISTRY,
  ...overrides,
})

describe('shellQuote', () => {
  it('egyszeres idézőjelbe tesz, a szóköz és az ékezet betű szerint marad', () => {
    expect(shellQuote('Árvíztűrő Csatorna')).toBe("'Árvíztűrő Csatorna'")
  })

  it('a benne lévő aposztrófot lezárja, escape-eli és újranyitja', () => {
    expect(shellQuote("O'Brien")).toBe("'O'\\''Brien'")
  })
})

describe('runCommandFor', () => {
  it('a recept és a csatorna a run kapcsolóiként, a csatorna idézőjelezve', () => {
    expect(runCommandFor('summary-hu', "Dev's Corner")).toBe(
      "refinery run --recipe summary-hu --channel 'Dev'\\''s Corner'",
    )
  })
})

describe('buildReports — típusok és sorozatok', () => {
  it('a fizetős típusok az átirat nélkül; a fordítások egy közös sorozatba kerülnek', () => {
    const reports = buildReports(input())
    expect(reports.kinds).toEqual([
      'summary',
      'flashcards',
      'qa',
      'clean-mild',
      'clean-moderate',
      'clean-deep',
      'bloom',
      'notes',
      'summary-hu',
      'clean-moderate-hu',
    ])
    expect(reports.series).toEqual([
      'summary',
      'flashcards',
      'qa',
      CLEAN_SERIES,
      'bloom',
      'notes',
      TRANSLATION_SERIES,
    ])
  })

  it('a három clean-szint költsége egy sorozatba összegződik', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', 'Egy', {
            'clean-mild': { status: 'done', costUsd: 0.1 },
            'clean-deep': { status: 'done', costUsd: 0.2 },
          }),
        ],
      }),
    )
    const channel = reports.channels.find((c) => c.channel === 'Egy')!
    expect(channel.costBySeries[CLEAN_SERIES]).toBeCloseTo(0.3, 10)
  })

  it('fordítás nélküli regiszternél nincs fordítás-sorozat', () => {
    const reports = buildReports(
      input({ registry: recipesFor({ translate: null, configPath: '/p/c.yaml' }) }),
    )
    expect(reports.series).not.toContain(TRANSLATION_SERIES)
  })
})

describe('buildReports — csatornák', () => {
  it('csatornánként összesít: videó, szószám, átiratolt db, nyelvek, feliratforrás', () => {
    const reports = buildReports(
      input({
        discovered: [discovered('a', 'en'), discovered('b', 'hu'), discovered('c', 'en')],
        rows: [
          row('a', 'Egy', {}, { captionSource: 'creator' }),
          row('b', 'Egy', {}, { captionSource: 'auto' }),
          row('c', 'Egy'),
        ],
        items: [itemRow('a', 100), itemRow('b', 50)],
      }),
    )
    expect(reports.channels).toHaveLength(1)
    expect(reports.channels[0]).toMatchObject({
      channel: 'Egy',
      videos: 3,
      words: 150,
      transcribed: 2,
      languages: [
        { code: 'en', count: 2 },
        { code: 'hu', count: 1 },
      ],
      captions: { creator: 1, auto: 1 },
    })
  })

  it('a nyelvkód a felderítésből jön, hiányában az állapottárból', () => {
    const reports = buildReports(
      input({
        discovered: [discovered('a', null)],
        rows: [row('a', 'Egy'), row('b', 'Egy', {}, { discovered: false })],
        items: [itemRow('b', 10, 'de')],
      }),
    )
    expect(reports.channels[0]?.languages).toEqual([{ code: 'de', count: 1 }])
  })

  it('a sorrend: videószám szerint csökkenő, azonos számnál név, a csatorna nélküli a végén', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', null),
          row('b', null),
          row('c', 'B'),
          row('d', 'A'),
          row('e', 'C'),
          row('f', 'C'),
        ],
      }),
    )
    expect(reports.channels.map((c) => c.channel)).toEqual(['C', 'A', 'B', null])
  })

  it('a fordítás költsége a közös sorozatba, típusonként a translationCost-ba kerül', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', 'Egy', {
            summary: { status: 'done', costUsd: 0.1 },
            'summary-hu': { status: 'done', costUsd: 0.02 },
            'clean-moderate-hu': { status: 'done', costUsd: 0.03 },
          }),
        ],
      }),
    )
    const channel = reports.channels[0]!
    expect(channel.costBySeries.summary).toBeCloseTo(0.1, 10)
    expect(channel.costBySeries[TRANSLATION_SERIES]).toBeCloseTo(0.05, 10)
    expect(channel.translationCost['summary-hu']).toBeCloseTo(0.02, 10)
    expect(channel.translationCost['clean-moderate-hu']).toBeCloseTo(0.03, 10)
    expect(channel.costUsd).toBeCloseTo(0.15, 10)
  })

  it('a rögzítetlen költség nem nulla: a csatorna költsége null, a hiány számolva', () => {
    const reports = buildReports(
      input({ rows: [row('a', 'Egy', { flashcards: { status: 'done', costUsd: null } })] }),
    )
    expect(reports.channels[0]?.costUsd).toBeNull()
    expect(reports.kpis.missingCost).toBe(1)
    expect(reports.kpis.vaultCostUsd).toBe(0)
  })

  it('lefedettség típusonként: kész, hibás, összes, és a hiányzók parancsa', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', "O'Brien", { summary: { status: 'done' }, qa: { status: 'done' } }),
          row('b', "O'Brien", { summary: { status: 'failed' }, qa: { status: 'done' } }),
        ],
      }),
    )
    const coverage = reports.channels[0]!.coverage
    expect(coverage.summary).toEqual({
      done: 1,
      failed: 1,
      total: 2,
      command: "refinery run --recipe summary --channel 'O'\\''Brien'",
    })
    expect(coverage.qa).toEqual({ done: 2, failed: 0, total: 2, command: null })
    expect(coverage.transcript).toBeUndefined()
  })

  it('csatorna nélküli csoportnál nincs parancs', () => {
    const reports = buildReports(input({ rows: [row('a', null)] }))
    const commands = Object.values(reports.channels[0]!.coverage).map((c) => c.command)
    expect(commands.every((c) => c === null)).toBe(true)
  })

  it('minőség: átlagpontszám és a küszöb alattiak a kész, pontozott cellákból', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', 'Egy', {
            summary: { status: 'done', score: 0.9 },
            'clean-moderate': { status: 'done', score: 0.6, belowThreshold: true },
            qa: { status: 'failed', score: 0.1 },
          }),
        ],
      }),
    )
    expect(reports.channels[0]?.quality).toEqual({ scored: 2, below: 1, meanScore: 0.75 })
  })

  it('pontozott cella nélkül az átlag null', () => {
    const reports = buildReports(input({ rows: [row('a', 'Egy')] }))
    expect(reports.channels[0]?.quality).toEqual({ scored: 0, below: 0, meanScore: null })
  })

  it('a lefedettség kész száma és a videószám egyezik a refinery list összesítőjével', () => {
    const rows = [
      row('a', 'Egy', { summary: { status: 'done' }, 'clean-moderate-hu': { status: 'done' } }),
      row('b', 'Egy', { summary: { status: 'failed' } }),
      row('c', 'Kettő', { qa: { status: 'done', belowThreshold: true, score: 0.5 } }),
      row('d', null, { notes: { status: 'done' } }),
    ]
    const reports = buildReports(input({ rows }))
    const summaries = summarizeChannels(rows, reports.kinds)
    for (const summary of summaries) {
      const channel = reports.channels.find((c) => c.channel === summary.channel)!
      expect(channel.videos).toBe(summary.videos)
      for (const kind of reports.kinds) {
        expect(channel.coverage[kind]?.done).toBe(summary.done[kind])
      }
    }
  })
})

describe('buildReports — KPI-k', () => {
  it('videó a felderítésből, csatorna a csatorna nélküli csoport nélkül', () => {
    const reports = buildReports(
      input({
        discovered: [discovered('a'), discovered('b')],
        rows: [row('a', 'Egy'), row('b', null), row('c', 'Kettő', {}, { discovered: false })],
        items: [itemRow('a', 30), itemRow('c', 20)],
      }),
    )
    expect(reports.kpis).toMatchObject({ videos: 2, channels: 2, words: 50, transcribed: 2 })
  })

  it('a tényleges költés minden futást összead, a grafikon csak a költséggel járókat kapja', () => {
    const reports = buildReports(
      input({
        runs: [
          run('2026-09-12T10:00:00', { spentUsd: 0.5, estimate: { items: 3, usd: 0.3, limitUsd: 1 } }),
          run('2026-09-11T10:00:00', { spentUsd: 0 }),
          run('2026-09-10T10:00:00', { spentUsd: 0.25, invalid: 2 }),
          run('régi', { spentUsd: 0.1, startedAt: null }),
        ],
      }),
    )
    expect(reports.kpis.spentUsd).toBeCloseTo(0.85, 10)
    expect(reports.runs.map((r) => [r.runId, r.estimateUsd])).toEqual([
      ['2026-09-10T10:00:00', null],
      ['2026-09-12T10:00:00', 0.3],
      ['régi', null],
    ])
    expect(reports.invalidLogLines).toBe(2)
  })
})

describe('buildReports — toplisták', () => {
  it('legdrágább: az elem cellaköltségeinek összege, csökkenő, azonos értéknél cím szerint', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`e${String(i).padStart(2, '0')}`, 'Egy', { summary: { costUsd: i === 11 ? 0.05 : i / 100 } }),
    )
    rows.push(row('nincs', 'Egy'))
    const reports = buildReports(input({ rows }))
    expect(reports.topCost).toHaveLength(10)
    expect(reports.topCost.slice(0, 3).map((r) => r.itemId)).toEqual(['e10', 'e09', 'e08'])
    expect(reports.topCost.map((r) => r.itemId)).not.toContain('nincs')
    const fives = reports.topCost.filter((r) => r.value === 0.05).map((r) => r.itemId)
    expect(fives).toEqual(['e05', 'e11'])
  })

  it('leghosszabb: normalizált szószám szerint, csak átiratolt elem', () => {
    const reports = buildReports(
      input({
        rows: [row('a', 'Egy'), row('b', 'Egy'), row('c', 'Egy')],
        items: [itemRow('a', 10), itemRow('b', 300), itemRow('c', null)],
      }),
    )
    expect(reports.topLong).toEqual([
      { itemId: 'b', title: 'Cím b', channel: 'Egy', value: 300 },
      { itemId: 'a', title: 'Cím a', channel: 'Egy', value: 10 },
    ])
  })
})

describe('readReports', () => {
  let dir: string
  let cfg: Config

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-reports-'))
    const channel = join(dir, 'feliratok', 'youtube', 'Szintetikus Csatorna')
    await mkdir(channel, { recursive: true })
    await writeFile(
      join(channel, 'Első példavideó.info.json'),
      JSON.stringify({ id: 'szint0001', title: 'Első példavideó', channel: 'Szintetikus Csatorna' }),
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
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('állapottár és napló nélkül: hasState hamis, minden hátra, a parancs a csatornára szól', async () => {
    const reports = await readReports(cfg)
    expect(reports.hasState).toBe(false)
    expect(reports.kpis).toMatchObject({ videos: 1, channels: 1, spentUsd: 0, vaultCostUsd: 0 })
    expect(reports.runs).toEqual([])
    expect(reports.channels[0]?.coverage.summary).toEqual({
      done: 0,
      failed: 0,
      total: 1,
      command: "refinery run --recipe summary --channel 'Szintetikus Csatorna'",
    })
  })

  it('az állapottár és a futásnapló adatait fűzi össze', async () => {
    const store = openState(cfg.statePath)
    store.recordItem({
      itemId: 'szint0001',
      source: 'youtube',
      sourceFile: 'Szintetikus Csatorna/Első példavideó.en.srt',
      subtitlePath: join(dir, 'x.srt'),
      baseName: 'Első példavideó',
      title: 'Első példavideó',
      language: 'en',
      metadata: { channel: 'Szintetikus Csatorna' },
    })
    store.recordTranscript('szint0001', 'creator', 12, 10)
    store.recordArtifact('szint0001', 'summary', 'done', '/v/s.md', null, {
      iterations: 1,
      score: 0.9,
      costUsd: 0.02,
      model: 'm',
    })
    store.close()
    await mkdir(cfg.logsDir, { recursive: true })
    await writeFile(
      join(cfg.logsDir, '2026-09-10T08-00-00.jsonl'),
      [
        { at: '2026-09-10T08:00:00.000Z', type: 'run:started', command: 'run --recipe summary', pid: 999_999 },
        { at: '2026-09-10T08:00:01.000Z', type: 'item:refined', itemId: 'szint0001', recipe: 'summary', score: 0.9, generations: 1, usd: 0.03 },
        { at: '2026-09-10T08:00:02.000Z', type: 'run:ended', interrupted: false },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n',
    )

    const reports = await readReports(cfg, () => false)
    expect(reports.hasState).toBe(true)
    expect(reports.kpis).toMatchObject({ words: 10, transcribed: 1 })
    expect(reports.kpis.spentUsd).toBeCloseTo(0.03, 10)
    expect(reports.kpis.vaultCostUsd).toBeCloseTo(0.02, 10)
    expect(reports.runs.map((r) => r.runId)).toEqual(['2026-09-10T08-00-00'])
    expect(reports.channels[0]?.coverage.summary?.command).toBeNull()
    expect(reports.channels[0]?.captions).toEqual({ creator: 1, auto: 0 })
  })
})
