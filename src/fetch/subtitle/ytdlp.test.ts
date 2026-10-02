import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { folderSource } from '../../source/folder.js'
import { commandFetch } from '../command.js'
import {
  createYtdlpRunner,
  downloadArgs,
  parsePlaylistProbe,
  parseVideoProbe,
  playlistProbeArgs,
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
      '--paths',
      'home:/out/Csatorna',
      '-o',
      '%(title)s [%(id)s].%(ext)s',
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
    expect(videoProbeArgs('https://www.youtube.com/watch?v=abcdefghijk')).toContain('--no-playlist')
  })

  it('a probe a channelt, annak híján az uploadert olvassa', () => {
    expect(parseVideoProbe('{"id":"abcdefghijk","uploader":"Feltöltő","title":"Cím"}')).toEqual({
      id: 'abcdefghijk',
      title: 'Cím',
      channel: 'Feltöltő',
    })
    expect(parseVideoProbe('{"id":"rovid"}')).toBeNull()
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
  process.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Video', channel: 'Chan' }))
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
