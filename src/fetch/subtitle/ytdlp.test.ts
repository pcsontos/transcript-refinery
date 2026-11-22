import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { folderSource } from '../../source/folder.js'
import { commandFetch } from '../command.js'
import {
  createYtdlpRunner,
  audioDownloadArgs,
  downloadArgs,
  originalSubtitleLang,
  parseYtdlpProgress,
  parseFeedProbe,
  parsePlaylistProbe,
  parseVideoProbe,
  playlistProbeArgs,
  subtitleLang,
  videoProbeArgs,
  YTDLP_MISSING,
} from './ytdlp.js'

describe('yt-dlp argumentumok', () => {
  it('a letöltés a spec kapcsolóival megy, best és convert-subs nélkül', () => {
    const args = downloadArgs({
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      dest: '/out/Csatorna',
      languages: ['hu', 'en'],
      formats: ['srt', 'vtt'],
      overwrite: false,
      id: 'abcdefghijk',
    })
    expect(args).toEqual([
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'hu,en',
      '--sub-format',
      'srt/vtt',
      '--write-info-json',
      '--no-playlist',
      '--no-progress',
      '--no-overwrites',
      '--js-runtimes',
      'node',
      '--paths',
      'home:/out/Csatorna',
      '-o',
      '%(title)s [abcdefghijk].%(ext)s',
      '--',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ])
    expect(args).not.toContain('best')
    expect(args).not.toContain('--convert-subs')
  })

  it('az --overwrite --force-overwrites', () => {
    const args = downloadArgs({
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      dest: '/out',
      languages: ['hu'],
      formats: ['vtt'],
      overwrite: true,
      id: 'abcdefghijk',
    })
    expect(args).toContain('--force-overwrites')
    expect(args).not.toContain('--no-overwrites')
  })

  it('a lista -I kapcsolót kap, a videó-probe --no-playlist', () => {
    expect(playlistProbeArgs('https://www.youtube.com/playlist?list=PLxxx', '1:10')).toEqual([
      '-J',
      '--flat-playlist',
      '--skip-download',
      '--no-progress',
      '-I',
      '1:10',
      '--',
      'https://www.youtube.com/playlist?list=PLxxx',
    ])
    expect(videoProbeArgs('https://www.youtube.com/watch?v=abcdefghijk')).toEqual([
      '-J',
      '--no-playlist',
      '--skip-download',
      '--no-progress',
      '--js-runtimes',
      'node',
      '--',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ])
  })

  it('a probe a channelt, annak híján az uploadert olvassa, és a feliratsávok kulcsait', () => {
    expect(parseVideoProbe('{"id":"abcdefghijk","uploader":"Feltöltő","title":"Cím"}')).toEqual({
      id: 'abcdefghijk',
      title: 'Cím',
      channel: 'Feltöltő',
      manualLangs: [],
      automaticLangs: [],
    })
    expect(
      parseVideoProbe(
        '{"id":"abcdefghijk","language":"en","subtitles":{"en":[{}]},"automatic_captions":{"en-orig":[{}],"hu":[{}]}}',
      ),
    ).toMatchObject({
      language: 'en',
      manualLangs: ['en'],
      automaticLangs: ['en-orig', 'hu'],
    })
  })

  it('a nem YouTube-os próba azonosítója a mediaId, a típus és az oldal URL-je is kijön', () => {
    expect(
      parseVideoProbe(
        '{"extractor_key":"PeerTube","id":"d4VvgzW5m4jaGr9JFVBUCg","webpage_url":"https://makertube.net/w/d4Vv"}',
      ),
    ).toMatchObject({ id: 'peertube-d4VvgzW5m4jaGr9JFVBUCg', webpageUrl: 'https://makertube.net/w/d4Vv' })
    expect(parseVideoProbe('{"_type":"playlist","id":"PLxxx","title":"L"}')).toMatchObject({ type: 'playlist' })
    expect(parseVideoProbe('{"extractor_key":"Youtube","id":"abcdefghijk"}')?.id).toBe('abcdefghijk')
  })

  it('az audio-letöltés fájlneve is a kapott azonosítót viszi', () => {
    const args = audioDownloadArgs({ url: 'U', dest: '/d', overwrite: false, id: 'peertube-x' })
    expect(args[args.indexOf('-o') + 1]).toBe('%(title)s [peertube-x].%(ext)s')
  })

  it('az eredeti nyelv a videó nyelve, a fordított automatikus sáv kimarad', () => {
    expect(
      originalSubtitleLang({
        language: 'en',
        manualLangs: [],
        automaticLangs: ['en', 'en-orig', 'hu'],
      }),
    ).toBe('en-orig')
    expect(
      originalSubtitleLang({
        language: 'en',
        manualLangs: [],
        automaticLangs: ['en', 'hu'],
      }),
    ).toBe('en')
    expect(
      originalSubtitleLang({
        language: 'en',
        manualLangs: ['hu'],
        automaticLangs: ['en-orig', 'hu'],
      }),
    ).toBe('en-orig')
    expect(
      originalSubtitleLang({
        language: 'hu',
        manualLangs: ['hu'],
        automaticLangs: ['en'],
      }),
    ).toBe('hu')
    expect(
      originalSubtitleLang({
        language: 'de',
        manualLangs: [],
        automaticLangs: ['en', 'hu'],
      }),
    ).toBeNull()
    expect(
      originalSubtitleLang({
        language: 'en-US',
        manualLangs: ['en'],
        automaticLangs: ['en', 'en-orig', 'hu'],
      }),
    ).toBe('en')
    expect(
      originalSubtitleLang({
        language: 'en-US',
        manualLangs: [],
        automaticLangs: ['en', 'en-orig', 'hu'],
      }),
    ).toBe('en-orig')
    expect(originalSubtitleLang({ manualLangs: ['en'], automaticLangs: ['en'] })).toBeNull()
    expect(parseVideoProbe('{"title":"nincs id"}')).toBeNull()
    expect(parsePlaylistProbe('{"id":"PLxxx","title":"Kurzus","entries":[{"title":"nincs id"}]}')).toEqual({
      id: 'PLxxx',
      title: 'Kurzus',
      entries: [{ title: 'nincs id' }],
    })
    expect(parsePlaylistProbe('{"title":"nincs id"}')).toBeNull()
  })

  it('a hiányzó bináris mondata rögzített', () => {
    expect(YTDLP_MISSING).toBe(
      'A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp',
    )
  })

  it('a PATH-on álló yt-dlp fájlját a folderSource látja', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-bin-'))
    const bin = join(root, 'bin')
    const out = join(root, 'out')
    await mkdir(bin)
    await writeFile(
      join(bin, 'yt-dlp'),
      `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') process.exit(0)
if (args.includes('-J')) {
  process.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Video', channel: 'Chan', language: 'hu', subtitles: { hu: [{}] } }))
  process.exit(0)
}
const home = args[args.indexOf('--paths') + 1].replace(/^home:/, '')
const fs = await import('node:fs/promises')
await fs.mkdir(home, { recursive: true })
await fs.writeFile(home + '/Video [abcdefghijk].hu.vtt', 'WEBVTT\\n')
await fs.writeFile(home + '/Video [abcdefghijk].info.json', JSON.stringify({ id: 'abcdefghijk', title: 'Video' }))
process.exit(0)
`,
    )
    await chmod(join(bin, 'yt-dlp'), 0o755)
    const previous = process.env.PATH
    process.env.PATH = `${bin}:${previous ?? ''}`
    try {
      const code = await commandFetch(
        ['subtitle', 'abcdefghijk', '--out', out, '--sub-lang', 'hu'],
        { runner: createYtdlpRunner(), stdout: () => {}, stderr: () => {} },
      )
      expect(code).toBe(0)
      const items = await folderSource({ name: 'out', path: out }, ['hu']).discover()
      expect(items).toHaveLength(1)
      expect(items[0]?.metadata.videoId).toBe('abcdefghijk')
      expect(items[0]?.language).toBe('hu')
    } finally {
      process.env.PATH = previous
    }
  })
})

describe('parseFeedProbe', () => {
  it('url # nélkül, a raw megmarad, url nélküli elem kimarad', () => {
    const first = { _type: 'url', url: 'https://f.hu/1.mp3#__youtubedl_smuggle=x', title: 'Első', timestamp: 100, duration: 60 }
    const json = JSON.stringify({ _type: 'playlist', title: '', entries: [first, { title: 'url nélkül' }, { url: 'https://f.hu/2.mp3' }] })
    expect(parseFeedProbe(json)).toEqual({
      title: 'névtelen',
      entries: [
        { url: 'https://f.hu/1.mp3', title: 'Első', duration: 60, timestamp: 100, raw: first },
        { url: 'https://f.hu/2.mp3', title: 'névtelen', duration: null, timestamp: null, raw: { url: 'https://f.hu/2.mp3' } },
      ],
    })
    expect(parseFeedProbe('nem json')).toBeNull()
    expect(parseFeedProbe(JSON.stringify({ _type: 'video' }))).toBeNull()
  })
})

describe('subtitleLang', () => {
  const base = { manualLangs: [] as string[], automaticLangs: [] as string[] }
  it('a saját nyelv nyer, a tartalék nem számít', () => {
    expect(subtitleLang({ ...base, language: 'en', automaticLangs: ['en-orig', 'hu'] }, ['hu'])).toBe('en-orig')
  })
  it('language nélkül a tartalék kézi sávja', () => {
    expect(subtitleLang({ ...base, manualLangs: ['en'] }, ['en'])).toBe('en')
  })
  it('régiós egyezés a tartalékban', () => {
    expect(subtitleLang({ ...base, manualLangs: ['en-US'] }, ['en'])).toBe('en-US')
  })
  it('a lista sorrendje dönt', () => {
    expect(subtitleLang({ ...base, manualLangs: ['de', 'en'] }, ['fr', 'en', 'de'])).toBe('en')
  })
  it('a tartalék elfogadja a -orig automatikus sávot', () => {
    expect(subtitleLang({ ...base, language: 'xx', automaticLangs: ['de-orig'] }, ['de'])).toBe('de-orig')
  })
  it('a tartalék gépi fordítást (sima automatikus kulcs) nem választ', () => {
    expect(subtitleLang({ ...base, automaticLangs: ['hu', 'en'] }, ['hu', 'en'])).toBeNull()
  })
  it('tartalék nélkül a mai szabály', () => {
    expect(subtitleLang({ ...base, manualLangs: ['en'] })).toBeNull()
  })
})

describe('createYtdlpRunner megszakítás (pcsontos/issue-tracker#133)', () => {
  it('abortnál a gyerek SIGTERM-et kap, a promise feloldódik', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ytdlp-abort-'))
    await writeFile(join(dir, 'yt-dlp'), '#!/bin/sh\nexec sleep 30\n')
    await chmod(join(dir, 'yt-dlp'), 0o755)
    const oldPath = process.env.PATH
    process.env.PATH = `${dir}:${oldPath ?? ''}`
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 100)
      const started = Date.now()
      const result = await createYtdlpRunner()(['x'], { signal: controller.signal })
      expect(Date.now() - started).toBeLessThan(2000)
      expect(result.code).not.toBe(0)
    } finally {
      process.env.PATH = oldPath
    }
  })

  it('abortnál a yt-dlp gyereke (pl. ffmpeg-utófeldolgozás) is leáll', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ytdlp-group-'))
    const pidFile = join(dir, 'grandchild.pid')
    await writeFile(join(dir, 'yt-dlp'), `#!/bin/sh\nsleep 30 >/dev/null 2>&1 &\necho $! > "${pidFile}"\nwait\n`)
    await chmod(join(dir, 'yt-dlp'), 0o755)
    const oldPath = process.env.PATH
    process.env.PATH = `${dir}:${oldPath ?? ''}`
    try {
      const controller = new AbortController()
      const running = createYtdlpRunner()(['x'], { signal: controller.signal })
      let text = ''
      for (let i = 0; i < 100 && !/^\d+\n$/.test(text); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        text = await readFile(pidFile, 'utf8').catch(() => '')
      }
      controller.abort()
      await running
      const pid = Number(text)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const alive = (): boolean => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      const survived = alive()
      if (survived) process.kill(pid, 'SIGKILL')
      expect(survived).toBe(false)
    } finally {
      process.env.PATH = oldPath
    }
  })
})

describe('parseYtdlpProgress (pcsontos/issue-tracker#135)', () => {
  it('total_bytes, különben total_bytes_estimate, különben null', () => {
    expect(parseYtdlpProgress('refinery-progress 1000 2000 NA')).toEqual({ done: 1000, total: 2000 })
    expect(parseYtdlpProgress('refinery-progress 1000 NA 3000.5')).toEqual({ done: 1000, total: 3000 })
    expect(parseYtdlpProgress('refinery-progress 1000 NA NA')).toEqual({ done: 1000, total: null })
    expect(parseYtdlpProgress('[download] 5%')).toBeNull()
  })

  it('a letöltő argumentumok haladást kérnek', () => {
    const args = audioDownloadArgs({ url: 'U', dest: '/d', overwrite: false, id: 'ID' })
    expect(args).toContain('--newline')
    expect(args).not.toContain('--no-progress')
  })

  it('az onLine a stdout és a stderr sorait is megkapja', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ytdlp-lines-'))
    await writeFile(join(dir, 'yt-dlp'), '#!/bin/sh\nprintf "egy\\nket"\nprintf "hiba\\n" >&2\nprintf "ketto\\n"\n')
    await chmod(join(dir, 'yt-dlp'), 0o755)
    const oldPath = process.env.PATH
    process.env.PATH = `${dir}:${oldPath ?? ''}`
    try {
      const lines: string[] = []
      const result = await createYtdlpRunner()(['x'], { onLine: (line) => void lines.push(line) })
      expect([...lines].sort()).toEqual(['egy', 'hiba', 'ketketto'])
      expect(result.stdout).toBe('egy\nketketto\n')
    } finally {
      process.env.PATH = oldPath
    }
  })
})
