import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandFetch } from '../command.js'
import type { ProcessResult, ProcessRunner } from '../subtitle/ytdlp.js'
import { commandFetchAudio } from './command.js'

const ID = 'abcdefghijk'
const URL = `https://www.youtube.com/watch?v=${ID}`
const ok = (stdout = ''): ProcessResult => ({ code: 0, stdout, stderr: '' })
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'audio-cmd-'))

function io() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) }
}

const runner: ProcessRunner = async (args) => {
  if (args[0] === '--version') return ok('1')
  if (args.includes('--flat-playlist')) {
    return ok(JSON.stringify({ _type: 'playlist', title: 'Podcast', entries: [{ url: 'https://f.hu/e1.mp3#x', title: 'Első' }, { url: 'https://f.hu/e2.mp3#x', title: 'Második' }] }))
  }
  if (args.includes('-J')) return ok(JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna', language: 'hu', automatic_captions: { hu: [] } }))
  const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
  await mkdir(dest, { recursive: true })
  await writeFile(join(dest, `Cím [${ID}].m4a`), 'a')
  await writeFile(join(dest, `Cím [${ID}].info.json`), '{}')
  return ok()
}

const fetchImpl: typeof fetch = (input) => {
  const url = typeof input === 'string' ? input : input instanceof globalThis.URL ? input.href : input.url
  const feed = url.endsWith('/feed')
  return Promise.resolve(new Response(feed ? '<rss/>' : 'abc', { headers: { 'content-type': feed ? 'application/rss+xml' : 'audio/mpeg' } }))
}

async function configIn(dir: string, audio?: string): Promise<string> {
  const path = join(dir, 'refinery.config.yaml')
  await writeFile(path, `vault:\n  path: ${dir}/vault\nsources:\n  - ${dir}/src\nlogs:\n  dir: ${dir}/logs\n${audio ?? ''}`)
  return path
}

describe('commandFetchAudio', () => {
  it('fetch audio --out: sorok és összesítő, kód 0, napló nélkül', async () => {
    const out = await tmp()
    const streams = io()
    const code = await commandFetchAudio([URL, '--out', out], { ...streams, runner })
    expect(code).toBe(0)
    expect(streams.out).toEqual([`letöltve: Cím [${ID}]`, 'Kész: letöltve 1 db fájl, 0 kihagyva, 0 hibás.'])
  })

  it('--config mellett napló készül a logs.dir alá', async () => {
    const dir = await tmp()
    const out = await tmp()
    const config = await configIn(dir)
    const streams = io()
    expect(await commandFetchAudio([URL, '--out', out, '--config', config], { ...streams, runner })).toBe(0)
    const files = await readdir(join(dir, 'logs'))
    expect(files).toHaveLength(1)
    const lines = (await readFile(join(dir, 'logs', files[0] as string), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { type: string; command?: string; interrupted?: boolean })
    expect(lines[0]).toMatchObject({ type: 'run:started', command: `fetch audio ${URL} --out ${out} --config ${config}` })
    expect(lines[lines.length - 1]).toMatchObject({ type: 'run:ended', interrupted: false })
  })

  it('hibás elem → kód 1', async () => {
    const out = await tmp()
    const streams = io()
    expect(await commandFetchAudio(['szia', '--out', out], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe('hiba: szia: nem URL')
  })

  it('feed --pick nélkül: lista + választási sor, kód 0, a --out mappa üres', async () => {
    const out = await tmp()
    const streams = io()
    expect(await commandFetchAudio(['https://f.hu/feed', '--out', out], { ...streams, runner, fetchImpl })).toBe(0)
    expect(streams.out.at(-1)).toBe('Választás: refinery fetch audio https://f.hu/feed --pick 1,3 (0 = mind)')
    expect(streams.out.some((line) => line.startsWith('Kész:'))).toBe(false)
    expect(await readdir(out)).toEqual([])
  })

  it('config nélkül, --out nélkül → hiba', async () => {
    const dir = await tmp()
    const config = await configIn(dir)
    const streams = io()
    expect(await commandFetchAudio([URL, '--config', config], { ...streams, runner })).toBe(1)
    expect(streams.err[0]).toBe('Nincs hangtároló: adj meg --out kapcsolót vagy audio blokkot a configban.')
  })

  it('config audio.dir: a hang oda kerül', async () => {
    const dir = await tmp()
    const config = await configIn(dir, `audio:\n  dir: ${dir}/audio\n`)
    const streams = io()
    expect(await commandFetchAudio([URL, '--config', config], { ...streams, runner })).toBe(0)
    expect(await readdir(join(dir, 'audio'), { recursive: true })).toContain(`Csatorna/Cím [${ID}].m4a`)
  })

  it('a yt-dlp hiánya: stderr, kód 1', async () => {
    const out = await tmp()
    const streams = io()
    const missing: ProcessRunner = () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' }))
    expect(await commandFetchAudio([URL, '--out', out], { ...streams, runner: missing })).toBe(1)
    expect(streams.err[0]).toContain('A yt-dlp nem található')
  })
})

describe('commandFetch és a hang', () => {
  it('fetch subtitle továbbra is elutasítja a közvetlen URL-t', async () => {
    const out = await tmp()
    const streams = io()
    await commandFetch(['subtitle', 'https://valami.hu/x.mp3', '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(streams.out.join('\n')).toContain('[FAIL] https://valami.hu/x.mp3: nem YouTube-cím')
  })

  it('fetch --help mindkét módot mutatja, fetch audio --help csak a sajátját', async () => {
    const both = io()
    expect(await commandFetch(['--help'], both)).toBe(0)
    expect(both.out.join('\n')).toContain('refinery fetch subtitle')
    expect(both.out.join('\n')).toContain('refinery fetch audio')
    const audio = io()
    expect(await commandFetch(['audio', '--help'], audio)).toBe(0)
    expect(audio.out.join('\n')).toContain('refinery fetch audio')
    expect(audio.out.join('\n')).not.toContain('refinery fetch subtitle')
  })

  it('a fetch audio a commandFetch-en át fut', async () => {
    const out = await tmp()
    const streams = io()
    expect(await commandFetch(['audio', URL, '--out', out], { ...streams, runner })).toBe(0)
  })
})

describe('commandFetchAudio --lang és átírás', () => {
  const noSubRunner: ProcessRunner = (args) =>
    args.includes('-J') ? Promise.resolve(ok(JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna', language: 'hu' }))) : runner(args)

  it('rossz --lang: 1, a runner nem hívódik', async () => {
    const streams = io()
    let called = false
    const spy: ProcessRunner = (args) => {
      called = true
      return runner(args)
    }
    expect(await commandFetchAudio([URL, '--out', await tmp(), '--lang', 'xyz1'], { ...streams, runner: spy })).toBe(1)
    expect(streams.err).toEqual(['A --lang értéke egyetlen nyelvkód, például hu vagy en-US.'])
    expect(called).toBe(false)
  })

  it('--out, config nélkül, felirat nélküli videó: nincs config, kód 0', async () => {
    const streams = io()
    expect(await commandFetchAudio([URL, '--out', await tmp()], { ...streams, runner: noSubRunner })).toBe(0)
    expect(streams.out[0]).toBe(`letöltve, átírás nem elérhető (nincs config): Cím [${ID}]`)
  })

  it('config + whisper-mappa: a felirat nélküli videó leadódik, --lang-gal', async () => {
    const dir = await tmp()
    const whisper = join(dir, 'whisper')
    await mkdir(join(whisper, 'inbox'), { recursive: true })
    const out = join(dir, 'audio')
    const config = await configIn(dir, `audio:\n  dir: ${out}\nwhisper:\n  dir: ${whisper}\n`)
    const streams = io()
    expect(await commandFetchAudio([URL, '--config', config, '--lang', 'en'], { ...streams, runner: noSubRunner })).toBe(0)
    expect(streams.out[0]).toBe(`letöltve, átírásra leadva: Cím [${ID}]`)
    expect(streams.out.at(-1)).toMatch(/^A whisper-figyelő nem fut/)
    expect(streams.out).toContain('Kész: letöltve 1 db fájl, 0 kihagyva, 0 hibás. 1 átírásra leadva.')
    const info = JSON.parse(await readFile(join(whisper, 'inbox', `${ID}.info.json`), 'utf8')) as { refinery_lang: string }
    expect(info.refinery_lang).toBe('en')
  })
})
