import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { syncTranscripts, syncTranscriptsFor, transcriptLines } from './garage.js'

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
  /** A `list` hívásait rögzítő, a megadott kulcsokat visszaadó kliens. */
  function fake(keys: string[]) {
    const listed: string[] = []
    const puts: [string, string][] = []
    return {
      listed,
      puts,
      client: {
        list: (prefix: string) => { listed.push(prefix); return Promise.resolve(keys) },
        putFile: (key: string, path: string) => { puts.push([key, path]); return Promise.resolve() },
      },
    }
  }

  it('a hang mappájába tölt, a meglévőt kihagyja; egy listázás a teljes prefixre (pcsontos/issue-tracker#70)', async () => {
    await put('whisper/csat/abcdefghijk.hu.srt')
    const b = await put('whisper/csat/bcdefghijkl.hu.srt')
    await put('whisper/csat/b.info.json')
    const f = fake([
      'audio/Lista [PL1]/Cím [abcdefghijk].m4a',
      'audio/Lista [PL1]/abcdefghijk.hu.srt',
      'audio/Csatorna/Más [bcdefghijkl].m4a',
      'audio/Csatorna/Más [bcdefghijkl].info.json',
    ])
    const result = await syncTranscripts({ sourcesRoot: sources, s3: S3, client: f.client })
    expect(f.listed).toEqual(['audio/'])
    expect(f.puts).toEqual([['audio/Csatorna/bcdefghijkl.hu.srt', b]])
    expect(result).toEqual({ uploaded: ['audio/Csatorna/bcdefghijkl.hu.srt'], skipped: [] })
  })

  it('a gyökérben lévő hang mellé a prefix alá kerül', async () => {
    await put('whisper/csat/abcdefghijk.hu.srt')
    const f = fake(['audio/Cím [abcdefghijk].m4a'])
    expect((await syncTranscripts({ sourcesRoot: sources, s3: S3, client: f.client })).uploaded).toEqual(['audio/abcdefghijk.hu.srt'])
  })

  it('-lel kezdődő azonosító és régiós nyelv', async () => {
    await put('whisper/csat/-QFHIoCo-Ko.en-US.srt')
    const f = fake(['audio/Lista [PL2]/Cím [-QFHIoCo-Ko].m4a'])
    expect((await syncTranscripts({ sourcesRoot: sources, s3: S3, client: f.client })).uploaded).toEqual(['audio/Lista [PL2]/-QFHIoCo-Ko.en-US.srt'])
  })

  it('hang nélkül és több hangmappánál nem tölt fel, kimaradásként jelzi', async () => {
    await put('whisper/csat/xxxxxxxxxxx.hu.srt')
    await put('whisper/csat/abcdefghijk.hu.srt')
    const f = fake(['audio/A [PL1]/Cím [abcdefghijk].m4a', 'audio/B/Cím [abcdefghijk].m4a'])
    const result = await syncTranscripts({ sourcesRoot: sources, s3: S3, client: f.client })
    expect(f.puts).toEqual([])
    expect(result).toEqual({
      uploaded: [],
      skipped: [
        { rel: 'csat/abcdefghijk.hu.srt', reason: 'több hangmappa' },
        { rel: 'csat/xxxxxxxxxxx.hu.srt', reason: 'nincs hang' },
      ],
    })
  })

  it('elérhetetlen Garage: figyelmeztetés, nem dob', async () => {
    await put('whisper/csat/a.hu.srt')
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: { list: () => Promise.reject(new Error('down')), putFile: () => Promise.resolve() },
    })
    expect(result).toEqual({ uploaded: [], skipped: [], warning: 'A Garage-másolat nem sikerült (down); a scan folytatódik.' })
  })

  it('feltöltési hiba is figyelmeztetés, a már feltöltöttek megmaradnak a listában', async () => {
    await put('whisper/csat/aaaaaaaaaaa.hu.srt')
    await put('whisper/csat/bbbbbbbbbbb.hu.srt')
    let n = 0
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: {
        list: () => Promise.resolve(['audio/X/Cím [aaaaaaaaaaa].m4a', 'audio/X/Más [bbbbbbbbbbb].m4a']),
        putFile: () => (++n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve()),
      },
    })
    expect(result.uploaded).toEqual(['audio/X/aaaaaaaaaaa.hu.srt'])
    expect(result.warning).toBe('A Garage-másolat nem sikerült (boom); a scan folytatódik.')
  })

  it('nincs whisper-mappa a sources alatt: semmi, a Garage-hoz sem nyúl', async () => {
    const result = await syncTranscripts({
      sourcesRoot: sources,
      s3: S3,
      client: { list: () => Promise.reject(new Error('nem kellene hívni')), putFile: () => Promise.reject(new Error('nem kellene hívni')) },
    })
    expect(result).toEqual({ uploaded: [], skipped: [] })
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

  it('a kimaradás sorai (transcriptLines)', () => {
    expect(
      transcriptLines({
        uploaded: ['audio/X/a.hu.srt'],
        skipped: [{ rel: 'csat/x.hu.srt', reason: 'nincs hang' }, { rel: 'csat/y.hu.srt', reason: 'több hangmappa' }],
        warning: 'W',
      }),
    ).toEqual([
      'Garage-ba másolva: audio/X/a.hu.srt',
      'A Garage-másolat kimaradt (nincs hozzá hang): csat/x.hu.srt',
      'A Garage-másolat kimaradt (több hangmappa): csat/y.hu.srt',
      'W',
    ])
  })
})
