import { describe, expect, it } from 'vitest'
import type { RunLogLine } from '../run/logfile.js'
import { liveRunState } from './live.js'

const at = (second: number): string => `2026-09-11T09:00:${String(second).padStart(2, '0')}.000Z`

describe('liveRunState', () => {
  it('üres naplóra kezdeti állapotot ad', () => {
    expect(liveRunState([])).toEqual({
      units: null,
      started: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      estimate: null,
      spentUsd: 0,
      current: null,
      lastScore: null,
      retries: 0,
      recentFailures: [],
      aborted: null,
      ended: null,
      lastEventAt: null,
    })
  })

  it('követi az éppen feldolgozott elemet és a lépését', () => {
    const lines: RunLogLine[] = [
      { at: at(1), type: 'run:started', command: 'run --queue', pid: 1 },
      { at: at(2), type: 'scan:found', count: 2 },
      { at: at(3), type: 'run:estimate', items: 2, tokens: 1000, usd: 0.2, limitUsd: 5 },
      { at: at(4), type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      { at: at(5), type: 'item:generating', itemId: 'a', recipe: 'summary', generation: 1 },
    ]

    const state = liveRunState(lines)
    expect(state.units).toBe(2)
    expect(state.started).toBe(1)
    expect(state.estimate).toEqual({ items: 2, usd: 0.2, limitUsd: 5 })
    expect(state.current).toEqual({
      itemId: 'a',
      title: 'Első példavideó',
      step: 'summary: generálás (1.)',
    })
    expect(state.lastEventAt).toBe(at(5))
  })

  it('összegzi a pontozást, a költést és az újrapróbát', () => {
    const lines: RunLogLine[] = [
      { type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      { type: 'item:retry', itemId: 'a', attempt: 1, delayMs: 1000, reason: 'sebességkorlát' },
      { type: 'item:scored', itemId: 'a', recipe: 'summary', score: 0.62, gaps: 2 },
      { type: 'item:refined', itemId: 'a', recipe: 'summary', score: 0.62, generations: 1, usd: 0.0123 },
      { type: 'item:refined', itemId: 'b', recipe: 'qa', score: 0.9, generations: 1, usd: 0.01 },
    ]

    const state = liveRunState(lines)
    expect(state.retries).toBe(1)
    expect(state.lastScore).toEqual({ itemId: 'a', recipe: 'summary', score: 0.62, gaps: 2 })
    expect(state.current?.step).toBe('summary: pontozva, 0.62')
    expect(state.spentUsd).toBeCloseTo(0.0223, 10)
  })

  it('a legutóbbi öt hibát tartja meg, a legfrissebbet elöl', () => {
    const lines: RunLogLine[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'item:failed' as const,
      itemId: `e${String(i)}`,
      source: 'youtube',
      kind: 'summary',
      error: `szintetikus hiba ${String(i)}`,
    }))

    const state = liveRunState(lines)
    expect(state.failed).toBe(7)
    expect(state.recentFailures.map((f) => f.itemId)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2'])
  })

  it('a futás végén nincs aktuális elem; látszik a lezárás és a plafon', () => {
    const lines: RunLogLine[] = [
      { type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      {
        type: 'run:aborted',
        reason: 'a tényleges költés meghaladta a plafont',
        spentUsd: 5.1,
        limitUsd: 5,
      },
      { type: 'run:done', succeeded: 0, skipped: 0, failed: 0 },
      { type: 'run:ended', interrupted: false },
    ]

    const state = liveRunState(lines)
    expect(state.current).toBeNull()
    expect(state.aborted).toBe('a tényleges költés meghaladta a plafont')
    expect(state.ended).toEqual({ interrupted: false })
  })
})
