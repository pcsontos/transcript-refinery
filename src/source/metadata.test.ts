import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { mapInfoJson, readSidecar } from './metadata.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-meta-'))
})

describe('mapInfoJson', () => {
  it('a felismert mezőket leképezi', () => {
    const data = mapInfoJson({
      id: 'q6p',
      title: 'Agent Orchestration',
      channel: 'Burke Holland',
      upload_date: '20260714',
      webpage_url: 'https://example.com/v',
      duration: 1806,
      tags: ['ai', 'agents'],
      description: 'Első sor\nMásodik sor',
    })
    expect(data.title).toBe('Agent Orchestration')
    expect(data.metadata).toEqual({
      videoId: 'q6p',
      channel: 'Burke Holland',
      uploadedAt: '2026-07-14',
      url: 'https://example.com/v',
      duration: 1806,
      tags: ['ai', 'agents'],
      description: 'Első sor\nMásodik sor',
    })
  })

  it('a csatornát az uploader mezőből is elfogadja', () => {
    expect(mapInfoJson({ uploader: 'Valaki' }).metadata.channel).toBe('Valaki')
  })

  it('a hiányzó mezőket nem tölti ki kitalált értékkel', () => {
    const data = mapInfoJson({ title: 'Cím' })
    expect(data.metadata.videoId).toBeUndefined()
    expect(data.metadata.url).toBeUndefined()
    expect(data.metadata.channel).toBeUndefined()
  })

  it('nem szintetizál URL-t a videóazonosítóból', () => {
    expect(mapInfoJson({ id: 'q6p' }).metadata.url).toBeUndefined()
  })

  it('a nem string dátumot és a rossz típusú mezőket eldobja', () => {
    const data = mapInfoJson({ upload_date: 20260714, duration: 'sok', tags: 'nem tömb' })
    expect(data.metadata.uploadedAt).toBeUndefined()
    expect(data.metadata.duration).toBeUndefined()
    expect(data.metadata.tags).toBeUndefined()
  })

  it('nem objektum bemenetre üres metaadatot ad', () => {
    expect(mapInfoJson(null).metadata).toEqual({})
    expect(mapInfoJson('szöveg').metadata).toEqual({})
  })
})

describe('readSidecar', () => {
  it('beolvassa a metaadatfájlt', async () => {
    const path = join(dir, 'v.info.json')
    await writeFile(path, JSON.stringify({ id: 'abc', title: 'Cím' }), 'utf8')
    const data = await readSidecar(path)
    expect(data?.metadata.videoId).toBe('abc')
  })

  it('hiányzó fájlnál null-t ad, nem dob', async () => {
    expect(await readSidecar(join(dir, 'nincs.info.json'))).toBeNull()
  })

  it('sérült JSON-nál null-t ad, nem dob — a futás nem állhat meg tőle', async () => {
    const path = join(dir, 'rossz.info.json')
    await writeFile(path, '{ ez nem json', 'utf8')
    expect(await readSidecar(path)).toBeNull()
  })
})
