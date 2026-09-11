import { describe, expect, it } from 'vitest'
import type { RunLogLine } from './logfile.js'
import { isPidAlive, runStatus } from './status.js'

const started: RunLogLine = { type: 'run:started', command: 'run', pid: 4242 }
const ended = (interrupted: boolean): RunLogLine => ({ type: 'run:ended', interrupted })
const aborted: RunLogLine = { type: 'run:aborted', reason: 'plafon', spentUsd: 1, limitUsd: 1 }
const done: RunLogLine = { type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }
const alive = { isAlive: () => true, hasReport: false }
const dead = { isAlive: () => false, hasReport: false }

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

  it('a folyamat élését a run:started pid-jével kérdezi', () => {
    const kerdezett: number[] = []
    runStatus([started], {
      isAlive: (pid) => {
        kerdezett.push(pid)
        return true
      },
      hasReport: false,
    })
    expect(kerdezett).toEqual([4242])
  })
})

describe('runStatus — run:started nélküli (régi) napló', () => {
  it('run:aborted: a plafon miatt megállt', () => {
    expect(runStatus([aborted, done], { isAlive: () => true, hasReport: true })).toBe('capped')
  })

  it('run:done: kész', () => {
    expect(runStatus([done], { isAlive: () => true, hasReport: true })).toBe('done')
  })

  it('egyik sincs, van riport: lezárt', () => {
    expect(runStatus([], { isAlive: () => true, hasReport: true })).toBe('closed')
  })

  it('egyik sincs, nincs riport: ismeretlen', () => {
    expect(runStatus([], { isAlive: () => true, hasReport: false })).toBe('unknown')
  })
})

describe('isPidAlive', () => {
  it('a saját folyamatra igaz', () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it('nem létező folyamatra hamis', () => {
    // A macOS és a Linux pid-tartományán is kívül esik.
    expect(isPidAlive(2 ** 22 + 12_345)).toBe(false)
  })
})
