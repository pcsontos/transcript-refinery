import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduler } from './scheduler.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createScheduler', () => {
  it('a csend után egyetlen körben adja át a közben érkezett útvonalakat', async () => {
    const batches: string[][] = []
    const s = createScheduler({ quietMs: 5000, run: (p) => { batches.push([...p].sort()); return Promise.resolve() }, onError: () => {} })
    s.notify('/a.srt')
    await vi.advanceTimersByTimeAsync(3000)
    s.notify('/b.srt')
    await vi.advanceTimersByTimeAsync(4999)
    expect(batches).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(batches).toEqual([['/a.srt', '/b.srt']])
  })

  it('egyszerre egy kör fut; ami közben jön, a következő körbe kerül', async () => {
    const batches: string[][] = []
    let release!: () => void
    const s = createScheduler({
      quietMs: 100,
      run: (p) => {
        batches.push([...p])
        return batches.length === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve()
      },
      onError: () => {},
    })
    s.notify('/a.srt')
    await vi.advanceTimersByTimeAsync(100)
    s.notify('/b.srt')
    await vi.advanceTimersByTimeAsync(500)
    expect(batches).toEqual([['/a.srt']])
    release()
    await vi.advanceTimersByTimeAsync(100)
    expect(batches).toEqual([['/a.srt'], ['/b.srt']])
  })

  it('a kör hibáját jelenti, és a következő kör lefut', async () => {
    const errors: string[] = []
    let n = 0
    const s = createScheduler({
      quietMs: 10,
      run: () => (++n === 1 ? Promise.reject(new Error('elsőre rossz')) : Promise.resolve()),
      onError: (e) => errors.push(e.message),
    })
    s.notify('/a.srt')
    await vi.advanceTimersByTimeAsync(10)
    s.notify('/b.srt')
    await vi.advanceTimersByTimeAsync(10)
    expect(errors).toEqual(['elsőre rossz'])
    expect(n).toBe(2)
  })

  it('a drain megvárja a futó kört, és a még nem indult kört eldobja', async () => {
    let finished = false
    let release!: () => void
    const run = vi.fn(() => new Promise<void>((r) => (release = () => { finished = true; r() })))
    const s = createScheduler({ quietMs: 10, run, onError: () => {} })
    s.notify('/a.srt')
    await vi.advanceTimersByTimeAsync(10)
    s.notify('/b.srt')
    const drained = s.drain()
    release()
    await drained
    await vi.advanceTimersByTimeAsync(1000)
    expect(finished).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
