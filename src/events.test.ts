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
    sink({ type: 'item:published', videoId: 'a', path: '/x/a.md' })
    sink({ type: 'item:skipped', videoId: 'b', reason: 'már feldolgozva' })
    sink({ type: 'item:failed', videoId: 'c', error: 'nincs felirat' })
    sink({ type: 'item:published', videoId: 'd', path: '/x/d.md' })
    expect(summarize(events)).toEqual({ succeeded: 2, skipped: 1, failed: 1 })
  })

  it('üres folyamra nullákat ad', () => {
    expect(summarize([])).toEqual({ succeeded: 0, skipped: 0, failed: 0 })
  })
})
