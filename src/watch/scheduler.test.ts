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
    const s = createScheduler({ quietMs: 5000, run: (p) => { batches.push([...(p ?? [])].sort()); return Promise.resolve() }, onError: () => {} })
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
        batches.push([...(p ?? [])])
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

  it('a runNow köre alatt érkező útvonal nem fut vele párhuzamosan, hanem utána, a csend után', async () => {
    const calls: (string[] | null)[] = []
    let release!: () => void
    const s = createScheduler({
      quietMs: 100,
      run: (p) => {
        calls.push(p === null ? null : [...p])
        return calls.length === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve()
      },
      onError: () => {},
    })
    const catchUp = s.runNow(null)
    s.notify('/a.srt')
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual([null])
    release()
    await catchUp
    await vi.advanceTimersByTimeAsync(99)
    expect(calls).toEqual([null])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([null, ['/a.srt']])
  })

  it('a runNow hibáját az onError kapja, az ígéret nem bukik el', async () => {
    const errors: string[] = []
    const s = createScheduler({
      quietMs: 10,
      run: () => Promise.reject(new Error('felzárkózás rossz')),
      onError: (e) => errors.push(e.message),
    })
    await s.runNow(null)
    expect(errors).toEqual(['felzárkózás rossz'])
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
