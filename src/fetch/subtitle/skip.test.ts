import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alreadyFetched, playlistDir, prepareIncomplete, videoDir } from './skip.js'

const ID = 'abcdefghijk'

async function temp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fetch-skip-'))
}

describe('célmappa', () => {
  it('a perjel és a kettőspont egy útvonalszegmens marad', () => {
    expect(playlistDir('/out', 'A/B: C', 'PLxxx', false)).toBe('/out/A\u29f8B\uff1a C [PLxxx]')
  })

  it('üres lista címnél a mappa a listaazonosító', () => {
    expect(playlistDir('/out', '', 'PLxxx', false)).toBe('/out/[PLxxx]')
    expect(playlistDir('/out', 'Cím', 'PLxxx', true)).toBe('/out')
    expect(videoDir('/out', '', false)).toBe('/out/névtelen')
  })
})

describe('alreadyFetched', () => {
  it('a Talk [live] [id].hu.vtt a valódi azonosítót látja', async () => {
    const dir = await temp()
    await writeFile(join(dir, `Talk [live] [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Talk [live] [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(dir, ID, ['hu'])).toBe(true)
  })

  it('az en kérés az en-US fájlra igen, az en-US kérés a puszta en fájlra nem', async () => {
    const dir = await temp()
    await writeFile(join(dir, `Cím [${ID}].en-US.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(dir, ID, ['en'])).toBe(true)
    expect(await alreadyFetched(dir, ID, ['en-US'])).toBe(true)
    await writeFile(join(dir, `Masik [${ID}].en.vtt`), 'WEBVTT\n')
    const onlyEn = await temp()
    await writeFile(join(onlyEn, `Cím [${ID}].en.vtt`), 'WEBVTT\n')
    await writeFile(join(onlyEn, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(onlyEn, ID, ['en-US'])).toBe(false)
  })

  it('üres felirat, rossz id és hiányzó pár nem kész', async () => {
    const dir = await temp()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), '')
    await writeFile(join(dir, `Cím [${ID}].info.json`), '{rossz')
    expect(await alreadyFetched(dir, ID, ['hu'])).toBe(false)
  })

  it('a szomszéd mappa másolata nem számít', async () => {
    const root = await temp()
    const here = join(root, 'itt')
    const there = join(root, 'ott')
    await mkdir(there, { recursive: true })
    await mkdir(here)
    await writeFile(join(there, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(there, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(here, ID, ['hu'])).toBe(false)
  })
})

describe('prepareIncomplete', () => {
  it('a rossz info.json-t törli, a jó feliratot és a másik videót megtartja', async () => {
    const dir = await temp()
    const other = 'zzzzzzzzzzz'
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), '{rossz')
    await writeFile(join(dir, `Masik [${other}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Ures [${ID}].en.srt`), '')
    await prepareIncomplete(dir, ID)
    expect(await readFile(join(dir, `Cím [${ID}].hu.vtt`), 'utf8')).toBe('WEBVTT\n')
    expect(await readFile(join(dir, `Masik [${other}].hu.vtt`), 'utf8')).toBe('WEBVTT\n')
    await expect(readFile(join(dir, `Cím [${ID}].info.json`), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dir, `Ures [${ID}].en.srt`), 'utf8')).rejects.toThrow()
  })
})
