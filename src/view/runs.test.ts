import { describe, expect, it } from 'vitest'
import type { RunLogLine } from '../run/logfile.js'
import { summarizeRun } from './runs.js'

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
