import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { snapshot } from './refdb.js'

let dir: string
let src: string
let dest: string
let writer: DatabaseSync

// Az éles író mintája (WAL), de checkpoint nélkül: a sorok a -wal-ban maradnak,
// amíg a kapcsolat nyitva van.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refdb-'))
  await mkdir(join(dir, 'state'))
  src = join(dir, 'state', 'refinery.db')
  dest = join(dir, 'tmp', 'refinery.db')
  writer = new DatabaseSync(src)
  writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE t (x INTEGER)')
})

afterEach(async () => {
  writer.close()
  await rm(dir, { recursive: true, force: true })
})

const count = (path: string): unknown => {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT count(*) AS n FROM t').get()?.n
  } finally {
    db.close()
  }
}

describe('snapshot', () => {
  it('a csak a -wal-ban lévő írás is bekerül, a forrás bájtra érintetlen', async () => {
    writer.exec('INSERT INTO t VALUES (1), (2)')
    expect(existsSync(`${src}-wal`)).toBe(true)
    const db = await readFile(src)
    const wal = await readFile(`${src}-wal`)

    await snapshot(src, dest)

    expect(count(dest)).toBe(2)
    expect(await readFile(src)).toEqual(db)
    expect(await readFile(`${src}-wal`)).toEqual(wal)
  })

  it('a pillanatképbe nem lehet írni', async () => {
    await snapshot(src, dest)

    expect((await stat(dest)).mode & 0o777).toBe(0o444)
    const db = new DatabaseSync(dest)
    try {
      expect(() => db.exec('INSERT INTO t VALUES (3)')).toThrow(/readonly/)
    } finally {
      db.close()
    }
  })

  it('az újabb futás lecseréli a pillanatképet, munkamappa nem marad', async () => {
    await snapshot(src, dest)
    writer.exec('INSERT INTO t VALUES (1)')

    await snapshot(src, dest)

    expect(count(dest)).toBe(1)
    expect(await readdir(join(dir, 'tmp'))).toEqual(['refinery.db'])
  })

  it('hiányzó forrásnál ENOENT-tel bukik, és nem hagy maradékot', async () => {
    await expect(snapshot(join(dir, 'nincs.db'), dest)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(dir, 'tmp'))).toEqual([])
  })
})
