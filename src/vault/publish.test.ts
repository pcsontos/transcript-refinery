import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { publishNote } from './publish.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-publish-'))
})

describe('publishNote', () => {
  it('létrehozza a hiányzó mappákat és kiírja a fájlt', async () => {
    const target = join(root, 'Csatorna', 'Cím', 'jegyzet.md')
    const result = await publishNote(target, 'tartalom', {})
    expect(result.status).toBe('written')
    expect(await readFile(target, 'utf8')).toBe('tartalom')
  })

  it('létező fájlt nem ír felül, hanem kihagy', async () => {
    const target = join(root, 'jegyzet.md')
    await writeFile(target, 'kézi tartalom', 'utf8')
    const result = await publishNote(target, 'gépi tartalom', {})
    expect(result.status).toBe('skipped')
    expect(await readFile(target, 'utf8')).toBe('kézi tartalom')
  })

  it('--force esetén felülír', async () => {
    const target = join(root, 'jegyzet.md')
    await writeFile(target, 'régi', 'utf8')
    const result = await publishNote(target, 'új', { force: true })
    expect(result.status).toBe('written')
    expect(await readFile(target, 'utf8')).toBe('új')
  })

  it('dry-run módban semmit nem ír ki', async () => {
    const target = join(root, 'uj', 'jegyzet.md')
    const result = await publishNote(target, 'tartalom', { dryRun: true })
    expect(result.status).toBe('written')
    await expect(readFile(target, 'utf8')).rejects.toThrow()
  })

  it('meglévő mappába is ír', async () => {
    await mkdir(join(root, 'meglevo'), { recursive: true })
    const target = join(root, 'meglevo', 'jegyzet.md')
    expect((await publishNote(target, 'x', {})).status).toBe('written')
  })
})
