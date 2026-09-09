import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countRunLogs, installSigint, writeReport } from './finish.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-finish-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('writeReport', () => {
  it('létrehozza a mappát és kiírja a riportot', async () => {
    const path = join(work, 'naplok', 'run.md')
    await writeReport(path, '# Futás\n')
    expect(await readFile(path, 'utf8')).toBe('# Futás\n')
  })
})

describe('countRunLogs', () => {
  it('a naplófájlokat számolja, mást nem', async () => {
    await writeFile(join(work, 'a.jsonl'), '')
    await writeFile(join(work, 'b.jsonl'), '')
    await writeFile(join(work, 'b.md'), '')
    expect(countRunLogs(work)).toBe(2)
  })

  it('nem létező mappára nullát ad', () => {
    expect(countRunLogs(join(work, 'nincs'))).toBe(0)
  })
})

describe('installSigint', () => {
  it('a SIGINT-re egyszer futtatja a kezelőt', () => {
    const target = new EventEmitter()
    let calls = 0
    installSigint(() => void calls++, target)

    target.emit('SIGINT')
    target.emit('SIGINT')
    expect(calls).toBe(1)
  })

  it('a visszaadott leiratkozás eltávolítja a kezelőt', () => {
    const target = new EventEmitter()
    let calls = 0
    const uninstall = installSigint(() => void calls++, target)

    uninstall()
    target.emit('SIGINT')

    expect(calls).toBe(0)
  })
})
