import { utimesSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RunLogLine } from './logfile.js'
import { isWriterAlive, runStatus, STALE_MS } from './status.js'

const started: RunLogLine = { type: 'run:started', command: 'run', pid: 4242 }
const ended = (interrupted: boolean): RunLogLine => ({ type: 'run:ended', interrupted })
const aborted: RunLogLine = { type: 'run:aborted', reason: 'plafon', spentUsd: 1, limitUsd: 1 }
const done: RunLogLine = { type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }
const alive = { writerAlive: true, hasReport: false }
const dead = { writerAlive: false, hasReport: false }

describe('runStatus — run:started-es napló', () => {
  it('lezárás nélkül, élő folyamattal: fut', () => {
    expect(runStatus([started], alive)).toBe('running')
  })

  it('lezárás nélkül, leállt folyamattal: nyom nélkül leállt', () => {
    expect(runStatus([started], dead)).toBe('died')
  })

  it('megszakított lezárás: megszakítva', () => {
    expect(runStatus([started, aborted, done, ended(true)], dead)).toBe('interrupted')
  })

  it('a plafonos megállás a run:done mellett is: a plafon miatt megállt', () => {
    expect(runStatus([started, aborted, done, ended(false)], dead)).toBe('capped')
  })

  it('run:done-nal lezárva: kész', () => {
    expect(runStatus([started, done, ended(false)], dead)).toBe('done')
  })

  it('run:done nélkül lezárva: hibával ért véget', () => {
    expect(runStatus([started, ended(false)], dead)).toBe('failed')
  })

})

describe('runStatus — run:started nélküli (régi) napló', () => {
  it('run:aborted: a plafon miatt megállt', () => {
    expect(runStatus([aborted, done], { writerAlive: true, hasReport: true })).toBe('capped')
  })

  it('run:done: kész', () => {
    expect(runStatus([done], { writerAlive: true, hasReport: true })).toBe('done')
  })

  it('egyik sincs, van riport: lezárt', () => {
    expect(runStatus([], { writerAlive: true, hasReport: true })).toBe('closed')
  })

  it('egyik sincs, nincs riport: ismeretlen', () => {
    expect(runStatus([], { writerAlive: true, hasReport: false })).toBe('unknown')
  })
})

describe('isWriterAlive', () => {
  const now = Date.parse('2026-11-03T10:00:00Z')
  let file: string
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'refinery-status-')), 'run.jsonl')
    await writeFile(file, '')
  })
  const touch = (msAgo: number) => utimesSync(file, new Date(now - msAgo), new Date(now - msAgo))

  it('89 mp-es fájlidővel él', async () => {
    touch(89_000)
    expect(await isWriterAlive(file, now)).toBe(true)
  })
  it('pontosan 90 mp-esnél még él', async () => {
    touch(STALE_MS)
    expect(await isWriterAlive(file, now)).toBe(true)
  })
  it('91 mp-es fájlidővel halott', async () => {
    touch(91_000)
    expect(await isWriterAlive(file, now)).toBe(false)
  })
  it('jövőbeli fájlidővel él', async () => {
    touch(-60_000)
    expect(await isWriterAlive(file, now)).toBe(true)
  })
  it('hiányzó fájlra halott, nem dob', async () => {
    expect(await isWriterAlive(join(tmpdir(), 'nincs-ilyen-refinery.jsonl'), now)).toBe(false)
  })
})
