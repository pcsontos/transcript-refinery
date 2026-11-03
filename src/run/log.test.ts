import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openRunLog } from './log.js'
import { HEARTBEAT_MS } from './status.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-log-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('openRunLog', () => {
  it('eseményenként egy önállóan értelmezhető JSON sort ír', async () => {
    const log = openRunLog(join(work, 'naplo', '2026-09-07T02-14-03.jsonl'))
    log.sink({ type: 'scan:found', count: 2 })
    log.sink({ type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat' })
    log.close()

    const lines = (await readFile(log.path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    const parsed = lines.map((line) => JSON.parse(line) as { at: unknown } & Record<string, unknown>)
    expect(parsed.map(({ at, ...event }) => [typeof at, event])).toEqual([
      ['string', { type: 'scan:found', count: 2 }],
      [
        'string',
        { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat' },
      ],
    ])
  })

  it('a sorok lezárás előtt is a lemezen vannak', async () => {
    const log = openRunLog(join(work, 'run.jsonl'))
    log.sink({ type: 'item:published', itemId: 'a', path: '/v/a.md' })

    const content = await readFile(log.path, 'utf8')
    expect(content).toContain('item:published')
    log.close()
  })

  it('létrehozza a hiányzó naplómappát', () => {
    const log = openRunLog(join(work, 'melyen', 'lent', 'run.jsonl'))
    log.close()
    expect(existsSync(log.path)).toBe(true)
  })

  it('a kétszeri lezárás nem dob', () => {
    const log = openRunLog(join(work, 'run.jsonl'))
    log.close()
    expect(() => log.close()).not.toThrow()
  })

  it('minden sor ISO időbélyeget kap', async () => {
    const log = openRunLog(join(work, 'run.jsonl'))
    log.sink({ type: 'scan:found', count: 1 })
    log.close()

    const [line] = (await readFile(log.path, 'utf8')).trim().split('\n')
    const { at } = JSON.parse(line!) as { at: string }
    expect(new Date(at).toISOString()).toBe(at)
  })
})

describe('openRunLog — életjel', () => {
  afterEach(() => vi.useRealTimers())

  it('esemény nélkül is előre viszi a fájlidőt, close() után nem', () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T10:00:00Z') })
    const log = openRunLog(join(work, 'eletjel.jsonl'))
    const old = new Date('2026-11-03T09:00:00Z')
    utimesSync(log.path, old, old)

    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(statSync(log.path).mtimeMs).toBeGreaterThan(old.getTime())

    log.close()
    expect(vi.getTimerCount()).toBe(0)
    utimesSync(log.path, old, old)
    vi.advanceTimersByTime(HEARTBEAT_MS * 2)
    expect(statSync(log.path).mtimeMs).toBe(old.getTime())
  })

  it('az eltűnt fájl nem dob', () => {
    vi.useFakeTimers()
    const log = openRunLog(join(work, 'eltunik.jsonl'))
    rmSync(log.path)
    expect(() => vi.advanceTimersByTime(HEARTBEAT_MS)).not.toThrow()
    log.close()
  })
})
