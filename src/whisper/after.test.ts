import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { afterMarker, MISSING_TRANSCRIPT, readWhisperPair } from './after.js'

const HASH = 'a1b2c3d4'
let root: string
let sources: string

async function put(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

/** Kész átirat a figyelő alakjában: `sources/whisper/<slug>/<id>.<nyelv>.srt` + `<id>.info.json`. */
async function done(id = HASH, withSrt = true): Promise<void> {
  await put(`src/whisper/npr/${id}.info.json`, JSON.stringify({ id, title: 'Epizod' }))
  if (withSrt) await put(`src/whisper/npr/${id}.en.srt`, '1\n00:00:00,000 --> 00:00:01,000\nszia\n')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'after-'))
  sources = join(root, 'src')
})

describe('afterMarker', () => {
  it('utólépés nélkül nincs jelölő', () => {
    expect(afterMarker({ whisperAfter: null }, 'cli')).toBeUndefined()
  })

  it('utólépéssel a leadó azonosítója', () => {
    expect(afterMarker({ whisperAfter: { recipes: ['summary'], notify: true } }, '7:fetch-7')).toBe('7:fetch-7')
  })
})

describe('readWhisperPair', () => {
  it('a kész pár a csatornamappából: cím az info.json-ból, nyelv a fájlnévből', async () => {
    await done()
    const pair = await readWhisperPair(sources, HASH)
    expect(pair).toMatchObject({ ok: true, title: 'Epizod', language: 'en', extension: 'srt' })
    if (pair.ok) expect(new TextDecoder().decode(pair.subtitle)).toContain('szia')
  })

  it('.srt nélkül hiba', async () => {
    await done(HASH, false)
    expect(await readWhisperPair(sources, HASH)).toEqual({ ok: false, error: MISSING_TRANSCRIPT })
  })
})
