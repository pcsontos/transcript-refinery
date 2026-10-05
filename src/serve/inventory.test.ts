import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteLocalPair, infoKey, readLocalPair, subtitleKey } from './inventory.js'

const ID = 'abcdefghijk'
let dir: string

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function setup(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'serve-pair-'))
}

describe('readLocalPair', () => {
  it('egy illeszkedő nyelv és az info kész, akkor is, ha en is a listán van', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím' }))
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(true)
    expect(pair.files.map((file) => file.language)).toEqual(['hu'])
    expect(subtitleKey(ID, 'hu', 'vtt')).toBe(`videos/${ID}/hu.vtt`)
    expect(infoKey(ID)).toBe(`videos/${ID}/info.json`)
  })

  it('felirat nélkül vagy üres felirattal a pár nem kész', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím' }))
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), '')
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(false)
  })

  it('hu.vtt és en.srt együtt kész, a cím az info title mezője', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].en.srt`), '1\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím' }))
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(true)
    expect(pair.title).toBe('Cím')
  })

  it('a videó nyelve kész, akkor is, ha a config listáján nincs', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].de.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím', language: 'de' }))
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(true)
    expect(pair.files.map((file) => file.language)).toEqual(['de'])
  })

  it('az info nyelve mellett a fordított sáv nem készít párt', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím', language: 'en' }))
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(false)
    expect(pair.files).toEqual([])
  })

  it('az en kérésre az en-US fájl illik', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].en-US.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: '' }))
    const pair = await readLocalPair(dir, ID, ['en'])
    expect(pair.complete).toBe(true)
    expect(pair.title).toBe(ID)
    expect(pair.files[0]?.language).toBe('en-US')
  })

  it('a deleteLocalPair csak ennek a videónak a fájlját törli', async () => {
    await setup()
    const other = 'z2345678901'
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), '{}')
    await writeFile(join(dir, `Más [${other}].hu.vtt`), 'WEBVTT\n')
    await deleteLocalPair(dir, ID)
    const gone = await readLocalPair(dir, ID, ['hu'])
    const kept = await readLocalPair(dir, other, ['hu'])
    expect(gone.files).toEqual([])
    expect(kept.files).toHaveLength(1)
  })
})
