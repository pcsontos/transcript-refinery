import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { syncTranscripts, syncTranscriptsFor } from './garage.js'

const YAML_S3 = { endpoint: 'http://garage:3900', region: 'garage', bucket: 'audio', prefix: 'audio/', access_key_id: 'GK1' }
const S3 = { endpoint: 'http://garage:3900', region: 'garage', bucket: 'audio', prefix: 'audio/', pathStyle: true, accessKeyId: 'GK1' }

let sources: string

async function put(rel: string): Promise<string> {
  const path = join(sources, rel)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '1\n00:00:00,000 --> 00:00:01,000\nszia\n')
  return path
}

beforeEach(async () => {
  sources = await mkdtemp(join(tmpdir(), 'garage-'))
})

describe('syncTranscripts', () => {
  it('csak a hiányzó srt-t tölti fel, a prefix alatt', async () => {
    await put('whisper/csat/a.hu.srt')
    const b = await put('whisper/csat/b.hu.srt')
    await put('whisper/csat/b.info.json')
    const puts: [string, string][] = []
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: {
        list: () => Promise.resolve(['audio/csat/a.hu.srt', 'audio/Csat/Cím [abcdefghijk].m4a']),
        putFile: (key, path) => { puts.push([key, path]); return Promise.resolve() },
      },
    })
    expect(puts).toEqual([['audio/csat/b.hu.srt', b]])
    expect(result).toEqual({ uploaded: ['audio/csat/b.hu.srt'] })
  })

  it('csak az érintett csatorna-mappák prefixét listázza, nem a teljes hang-archívumot', async () => {
    await put('whisper/csat/a.hu.srt')
    await put('whisper/csat/b.hu.srt')
    await put('whisper/masik/c.en.srt')
    const listed: string[] = []
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: {
        list: (prefix) => { listed.push(prefix); return Promise.resolve(prefix === 'audio/csat/' ? ['audio/csat/a.hu.srt'] : []) },
        putFile: () => Promise.resolve(),
      },
    })
    expect(listed).toEqual(['audio/csat/', 'audio/masik/'])
    expect(result.uploaded).toEqual(['audio/csat/b.hu.srt', 'audio/masik/c.en.srt'])
  })

  it('elérhetetlen Garage: figyelmeztetés, nem dob', async () => {
    await put('whisper/csat/a.hu.srt')
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: { list: () => Promise.reject(new Error('down')), putFile: () => Promise.resolve() },
    })
    expect(result).toEqual({ uploaded: [], warning: 'A Garage-másolat nem sikerült (down); a scan folytatódik.' })
  })

  it('feltöltési hiba is figyelmeztetés, a már feltöltöttek megmaradnak a listában', async () => {
    await put('whisper/csat/a.hu.srt')
    await put('whisper/csat/b.hu.srt')
    let n = 0
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: { list: () => Promise.resolve([]), putFile: () => (++n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve()) },
    })
    expect(result.uploaded).toEqual(['audio/csat/a.hu.srt'])
    expect(result.warning).toBe('A Garage-másolat nem sikerült (boom); a scan folytatódik.')
  })

  it('nincs whisper-mappa a sources alatt: semmi, a Garage-hoz sem nyúl', async () => {
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: { list: () => Promise.reject(new Error('nem kellene hívni')), putFile: () => Promise.reject(new Error('nem kellene hívni')) },
    })
    expect(result).toEqual({ uploaded: [] })
  })
})

describe('syncTranscriptsFor', () => {
  const cfgOf = (audio: unknown) => loadConfig({ vault: { path: '/v' }, sources: [sources], audio }, '/p/c.yaml')

  it('s3 nélkül és whisper-mappa nélkül üres', async () => {
    expect(await syncTranscriptsFor(cfgOf({ dir: '/x' }), {})).toEqual([])
    expect(await syncTranscriptsFor(cfgOf({ s3: YAML_S3 }), {})).toEqual([])
  })

  it('hiányzó titok figyelmeztetés, nem hiba', async () => {
    await put('whisper/csat/a.hu.srt')
    const lines = await syncTranscriptsFor(cfgOf({ s3: YAML_S3 }), {})
    expect(lines).toEqual(['A Garage-másolat nem sikerült (hiányzó AUDIO_S3_SECRET_ACCESS_KEY); a scan folytatódik.'])
  })
})
