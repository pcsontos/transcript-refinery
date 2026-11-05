import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { directTarget, downloadDirect, extensionFor } from './direct.js'

const sha8 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 8)
const reply = (body: string, status: number, contentType?: string): typeof fetch => () =>
  Promise.resolve(new Response(body, { status, headers: contentType === undefined ? {} : { 'content-type': contentType } }))
const stagingDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'direct-'))
const files = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).sort()

describe('directTarget', () => {
  it('domain www. nélkül, név, 8 jegyű hash', () => {
    const url = 'https://www.valami.hu/podcast/Ep%2012.MP3?x=1'
    expect(directTarget(url)).toEqual({ dir: 'valami.hu', name: 'Ep 12', hash: sha8(url), ext: 'mp3' })
    expect(directTarget('https://x.hu/').name).toBe('névtelen')
    expect(directTarget('https://x.hu/download.php').ext).toBeNull()
  })

  it('két episode.mp3 két útról nem ütközik', () => {
    expect(directTarget('https://a.hu/1/episode.mp3').hash).not.toBe(directTarget('https://a.hu/2/episode.mp3').hash)
  })
})

describe('extensionFor', () => {
  it('csak audio/* típusra, paraméterek nélkül', () => {
    expect(extensionFor('audio/mpeg; charset=x')).toBe('mp3')
    expect(extensionFor('audio/x-m4a')).toBe('m4a')
    expect(extensionFor('text/html')).toBeNull()
    expect(extensionFor(null)).toBeNull()
  })
})

describe('downloadDirect', () => {
  it('kiterjesztés nélküli URL: a Content-Type dönt', async () => {
    const dir = await stagingDir()
    const result = await downloadDirect('https://x.hu/download', dir, reply('abc', 200, 'audio/mpeg'))
    const path = `x.hu/download [${sha8('https://x.hu/download')}].mp3`
    expect(result).toEqual({ ok: true, path })
    expect(await readFile(join(dir, path), 'utf8')).toBe('abc')
    expect(await files(dir)).toEqual(['x.hu', `x.hu/download [${sha8('https://x.hu/download')}].mp3`])
  })

  it('HTML-oldal nem kerül archívumba', async () => {
    const dir = await stagingDir()
    expect(await downloadDirect('https://x.hu/oldal', dir, reply('<html>', 200, 'text/html'))).toEqual({ ok: false, reason: 'nem hangfájl (text/html)' })
    expect(await files(dir)).toEqual([])
  })

  it('hangkiterjesztésű URL-en érkező HTML-oldal sem kerül archívumba', async () => {
    const dir = await stagingDir()
    expect(await downloadDirect('https://x.hu/ep.mp3', dir, reply('<html>lejárt</html>', 200, 'text/html; charset=utf-8'))).toEqual({
      ok: false,
      reason: 'nem hangfájl (text/html)',
    })
    expect(await files(dir)).toEqual([])
  })

  it('404 → hiba, a staging üres', async () => {
    const dir = await stagingDir()
    expect(await downloadDirect('https://x.hu/a.mp3', dir, reply('', 404))).toEqual({ ok: false, reason: 'HTTP 404' })
    expect(await files(dir)).toEqual([])
  })

  it('RSS-válasz target nélkül: feed, a staging üres', async () => {
    const dir = await stagingDir()
    expect(await downloadDirect('https://x.hu/rss', dir, reply('<rss/>', 200, 'application/rss+xml; charset=utf-8'))).toEqual({ ok: false, feed: true })
    expect(await files(dir)).toEqual([])
  })

  it('RSS-válasz targettel (epizódnak hitt URL): nem hangfájl', async () => {
    const dir = await stagingDir()
    expect(await downloadDirect('https://x.hu/rss', dir, reply('<rss/>', 200, 'application/rss+xml'), { dir: 'F', name: 'E' })).toEqual({
      ok: false,
      reason: 'nem hangfájl (application/rss+xml)',
    })
  })

  it('target: a megadott mappa és név, a hash az URL-é # nélkül', async () => {
    const dir = await stagingDir()
    const result = await downloadDirect('https://f.hu/s/1.mp3#__youtubedl_smuggle=x', dir, reply('z', 200, 'audio/mpeg'), { dir: 'Feed [1a2b3c4d]', name: 'Ep' })
    expect(result).toEqual({ ok: true, path: `Feed [1a2b3c4d]/Ep [${sha8('https://f.hu/s/1.mp3')}].mp3` })
    expect(directTarget('https://f.hu/s/1.mp3#x').hash).toBe(directTarget('https://f.hu/s/1.mp3').hash)
  })
})
