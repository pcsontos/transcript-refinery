import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-atomic-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('létrehozza a fájlt, a hiányzó mappával együtt', async () => {
    const path = join(dir, 'al', '_queue.md')
    await writeFileAtomic(path, 'tartalom\n')
    expect(await readFile(path, 'utf8')).toBe('tartalom\n')
  })

  it('felülírja a meglévő fájlt, és nem hagy maga után ideiglenes fájlt', async () => {
    const path = join(dir, '_queue.md')
    await writeFile(path, 'régi\n', 'utf8')

    await writeFileAtomic(path, 'új\n')

    expect(await readFile(path, 'utf8')).toBe('új\n')
    expect(await readdir(dir)).toEqual(['_queue.md'])
  })

  it('hiba esetén kivételt dob, és az ideiglenes fájlt eltakarítja', async () => {
    // A cél egy MAPPA: az ideiglenes fájl megírható, az átnevezés elhasal.
    const path = join(dir, '_queue.md')
    await mkdir(path)

    await expect(writeFileAtomic(path, 'x')).rejects.toThrow()
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
