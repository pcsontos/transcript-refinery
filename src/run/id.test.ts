import { describe, expect, it } from 'vitest'
import { runId } from './id.js'

describe('runId', () => {
  it('fájlnév-biztos azonosítót ad a futás kezdetéből', () => {
    expect(runId(new Date('2026-09-07T02:14:03.512Z'))).toBe('2026-09-07T02-14-03')
  })

  it('két különböző másodperc két különböző azonosítót ad', () => {
    const a = runId(new Date('2026-09-07T02:14:03Z'))
    const b = runId(new Date('2026-09-07T02:14:04Z'))
    expect(a).not.toBe(b)
  })

  it('nem tartalmaz olyan karaktert, ami fájlnévben gondot okoz', () => {
    expect(runId(new Date('2026-01-02T03:04:05Z'))).not.toMatch(/[:/\\]/)
  })
})
