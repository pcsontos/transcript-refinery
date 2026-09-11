import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEvent } from '../events.js'
import type { RunLogLine } from '../run/logfile.js'
import { readRun, readRuns, summarizeRun } from './runs.js'

const files = {
  runId: '2026-09-07T02-14-03',
  logPath: '/l/2026-09-07T02-14-03.jsonl',
  reportPath: '/l/2026-09-07T02-14-03.md',
}

describe('summarizeRun', () => {
  it('a parancsot, az időt, az egységeket, a becslést és a költést a sorokból veszi', () => {
    const lines: RunLogLine[] = [
      { at: '2026-09-07T02:14:03.000Z', type: 'run:started', command: 'run --queue', pid: 1 },
      { at: '2026-09-07T02:14:04.000Z', type: 'scan:found', count: 2 },
      { at: '2026-09-07T02:14:04.500Z', type: 'run:estimate', items: 2, tokens: 1000, usd: 0.2, limitUsd: 5 },
      { at: '2026-09-07T02:14:05.000Z', type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      {
        at: '2026-09-07T02:14:06.000Z',
        type: 'item:normalized',
        itemId: 'a',
        wordsRaw: 10,
        wordsNormalized: 5,
        captionSource: 'creator',
      },
      {
        at: '2026-09-07T02:14:08.000Z',
        type: 'item:refined',
        itemId: 'a',
        recipe: 'summary',
        score: 0.9,
        generations: 1,
        usd: 0.05,
      },
      { at: '2026-09-07T02:14:08.100Z', type: 'item:published', itemId: 'a', path: '/v/a.md' },
      {
        at: '2026-09-07T02:14:09.000Z',
        type: 'item:failed',
        itemId: 'b',
        source: 'youtube',
        kind: 'summary',
        error: 'szintetikus hiba',
      },
      { at: '2026-09-07T02:14:13.000Z', type: 'run:ended', interrupted: false },
    ]

    expect(summarizeRun(files, lines, 'failed', 0)).toEqual({
      runId: '2026-09-07T02-14-03',
      status: 'failed',
      command: 'run --queue',
      startedAt: '2026-09-07T02:14:03.000Z',
      lastEventAt: '2026-09-07T02:14:13.000Z',
      durationMs: 10_000,
      units: 2,
      estimate: { items: 2, usd: 0.2, limitUsd: 5 },
      succeeded: 1,
      failed: 1,
      spentUsd: 0.05,
      hasReport: true,
      invalid: 0,
    })
  })

  it('a változás előtti, időbélyeg nélküli naplónál a parancs és az idő null', () => {
    const lines: RunLogLine[] = [
      { type: 'scan:found', count: 1 },
      { type: 'run:done', succeeded: 0, skipped: 0, failed: 0 },
    ]

    const view = summarizeRun({ ...files, reportPath: null }, lines, 'done', 3)
    expect([view.command, view.startedAt, view.durationMs, view.hasReport, view.invalid]).toEqual([
      null,
      null,
      null,
      false,
      3,
    ])
  })
})

describe('readRuns és readRun', () => {
  let dir: string
  const line = (event: RunEvent): string => `${JSON.stringify(event)}\n`

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-runs-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a futásokat legújabb elöl, a folyamat élése szerinti állapottal adja', async () => {
    await writeFile(
      join(dir, '2026-09-10T08-00-00.jsonl'),
      line({ type: 'run:started', command: 'run', pid: 11 }) +
        line({ type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }) +
        line({ type: 'run:ended', interrupted: false }),
    )
    await writeFile(
      join(dir, '2026-09-11T09-00-00.jsonl'),
      line({ type: 'run:started', command: 'run --queue', pid: 22 }),
    )

    const runs = await readRuns({ logsDir: dir }, (pid) => pid === 22)
    expect(runs.map((r) => [r.runId, r.status, r.command])).toEqual([
      ['2026-09-11T09-00-00', 'running', 'run --queue'],
      ['2026-09-10T08-00-00', 'done', 'run'],
    ])
  })

  it('egy futás sorait, állapotát és riportját adja', async () => {
    await writeFile(
      join(dir, '2026-09-10T08-00-00.jsonl'),
      line({ type: 'run:started', command: 'run', pid: 11 }) +
        line({ type: 'scan:found', count: 4 }) +
        line({ type: 'run:ended', interrupted: true }),
    )
    await writeFile(join(dir, '2026-09-10T08-00-00.md'), '# Futás\n')

    const run = await readRun({ logsDir: dir }, '2026-09-10T08-00-00', () => false)
    expect(run?.summary.status).toBe('interrupted')
    expect(run?.lines.map((l) => l.type)).toEqual(['run:started', 'scan:found', 'run:ended'])
    expect(run?.state.units).toBe(4)
    expect(run?.report).toBe('# Futás\n')
  })

  it('nem runId alakú azonosítóra null', async () => {
    expect(await readRun({ logsDir: dir }, '../../etc/passwd')).toBeNull()
  })
})
