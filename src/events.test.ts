import { describe, expect, it } from 'vitest'
import { collectEvents, summarize } from './events.js'

describe('collectEvents', () => {
  it('sorrendben gyűjti az eseményeket', () => {
    const { sink, events } = collectEvents()
    sink({ type: 'scan:start', source: 'folder' })
    sink({ type: 'scan:found', count: 3 })
    expect(events.map((e) => e.type)).toEqual(['scan:start', 'scan:found'])
  })
})

describe('summarize', () => {
  it('megszámolja a sikeres, kihagyott és hibás elemeket', () => {
    const { sink, events } = collectEvents()
    sink({ type: 'item:published', itemId: 'a', path: '/x/a.md' })
    sink({ type: 'item:skipped', itemId: 'b', reason: 'már feldolgozva' })
    sink({ type: 'item:failed', itemId: 'c', error: 'nincs felirat' })
    sink({ type: 'item:published', itemId: 'd', path: '/x/d.md' })
    expect(summarize(events)).toEqual({ succeeded: 2, skipped: 1, failed: 1 })
  })

  it('üres folyamra nullákat ad', () => {
    expect(summarize([])).toEqual({ succeeded: 0, skipped: 0, failed: 0 })
  })

  it('az új események nem torzítják az összegzést', () => {
    const summary = summarize([
      { type: 'run:estimate', items: 3, tokens: 1000, usd: 0.2, limitUsd: 5 },
      { type: 'item:generating', itemId: 'a', recipe: 'summary', generation: 1 },
      { type: 'item:scored', itemId: 'a', recipe: 'summary', score: 0.9, gaps: 0 },
      { type: 'item:refined', itemId: 'a', recipe: 'summary', score: 0.9, generations: 1, usd: 0.08 },
      { type: 'item:published', itemId: 'a', path: '/vault/a.md' },
    ])
    expect(summary).toEqual({ succeeded: 1, skipped: 0, failed: 0 })
  })
})
