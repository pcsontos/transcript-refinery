import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reserveRunId, runId } from './id.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-id-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

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

describe('reserveRunId', () => {
  it('szabad névre magát a bázist adja vissza', () => {
    expect(reserveRunId(work, '2026-09-07T02-14-03')).toBe('2026-09-07T02-14-03')
  })

  it('foglalt névre a következő szabad utótagot adja', async () => {
    // Két azonos másodpercben induló futás enélkül egyetlen JSONL-be
    // fésülődne, és a második riportja felülírná az elsőt — pont a
    // bizonyíték sérülne.
    await writeFile(join(work, '2026-09-07T02-14-03.jsonl'), '')
    expect(reserveRunId(work, '2026-09-07T02-14-03')).toBe('2026-09-07T02-14-03-2')
  })

  it('több foglalt név után az első szabadat találja meg', async () => {
    await writeFile(join(work, '2026-09-07T02-14-03.jsonl'), '')
    await writeFile(join(work, '2026-09-07T02-14-03-2.jsonl'), '')
    expect(reserveRunId(work, '2026-09-07T02-14-03')).toBe('2026-09-07T02-14-03-3')
  })

  it('még nem létező naplómappára a bázist adja', () => {
    expect(reserveRunId(join(work, 'nincs-meg'), '2026-09-07T02-14-03')).toBe(
      '2026-09-07T02-14-03',
    )
  })
})
