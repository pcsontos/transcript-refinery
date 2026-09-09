import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRunLog } from './log.js'

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
    log.sink({ type: 'item:failed', itemId: 'a', source: 'youtube', error: 'olvashatatlan felirat' })
    log.close()

    const lines = (await readFile(log.path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: 'scan:found', count: 2 },
      { type: 'item:failed', itemId: 'a', source: 'youtube', error: 'olvashatatlan felirat' },
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
})
