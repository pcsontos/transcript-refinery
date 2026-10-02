import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandFetch } from './command.js'
import type { ProcessResult, ProcessRunner } from './subtitle/ytdlp.js'

const ID = 'abcdefghijk'
const URL = `https://www.youtube.com/watch?v=${ID}`

function io() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  }
}

function runnerOf(handler: (args: readonly string[], calls: string[][]) => Promise<ProcessResult>): {
  calls: string[][]
  runner: ProcessRunner
} {
  const calls: string[][] = []
  return { calls, runner: (args) => handler(args, calls) }
}

describe('commandFetch mód ellenőrzése', () => {
  it('hiányzó mód esetén indulási hiba', async () => {
    const streams = io()
    const code = await commandFetch(['--out', '/tmp/felirat'], streams)
    expect(code).toBe(1)
    expect(streams.err[0]).toBe('Hiányzó fetch-mód. Ismert: subtitle')
  })

  it('ismeretlen mód esetén indulási hiba', async () => {
    const streams = io()
    const code = await commandFetch(['audio', URL], streams)
    expect(code).toBe(1)
    expect(streams.err[0]).toBe('Ismeretlen fetch-mód: audio. Ismert: subtitle')
  })

  it('--help mód nélkül is kiírja a súgót és 0-val tér vissza', async () => {
    const streams = io()
    const code = await commandFetch(['--help'], streams)
    expect(code).toBe(0)
    expect(streams.out.join('\n')).toContain('refinery fetch subtitle')
  })
})

describe('commandFetch egy videóra', () => {
  it('a probe után letölt, és [OK] sort ír', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('--no-playlist') && args.includes('-J')) {
        return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(0)
    expect(streams.out[0]).toBe(`[OK]   Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 1 letöltve, 0 átugorva, 0 felirat nélkül, 0 hibás.')
    expect(calls.some((args) => args.includes('--write-subs'))).toBe(true)
    expect(calls.some((args) => args.includes('--no-overwrites'))).toBe(true)
  })

  it('kész párnál a letöltő hívás kimarad', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const dest = join(out, 'Csatorna')
    await mkdir(dest)
    await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    const { calls, runner } = runnerOf((args, seen) => {
      seen.push([...args])
      if (args.includes('--write-subs')) {
        return Promise.resolve({ code: 1, stdout: '', stderr: 'nem szabadott letölteni' })
      }
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }),
        stderr: '',
      })
    })
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(0)
    expect(streams.out[0]).toBe(`[SKIP] Cím [${ID}]`)
    expect(calls.some((args) => args.includes('--write-subs'))).toBe(false)
  })

  it('a sérült info.json törlődik, a jó felirat megmarad, a hívás --no-overwrites', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const dest = join(out, 'Csatorna')
    await mkdir(dest)
    await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dest, `Cím [${ID}].info.json`), '{rossz')
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) {
        return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      }
      const home = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      expect(await readFile(join(home, `Cím [${ID}].hu.vtt`), 'utf8')).toBe('WEBVTT\n')
      await expect(readFile(join(home, `Cím [${ID}].info.json`), 'utf8')).rejects.toThrow()
      await writeFile(join(home, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(0)
    expect(calls.some((args) => args.includes('--no-overwrites'))).toBe(true)
    expect(streams.out[0]).toBe(`[OK]   Cím [${ID}]`)
  })

  it('felirat nélkül 1-es kód, a köteg számlálója külön van', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const { runner } = runnerOf((args) => {
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      if (args.includes('-J')) {
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }),
          stderr: '',
        })
      }
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    })
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(1)
    expect(streams.out[0]).toBe(`[SKIP] Nincs felirat: Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 0 letöltve, 0 átugorva, 1 felirat nélkül, 0 hibás.')
  })

  it('a yt-dlp hibája [FAIL], és nem állítja meg a folyamatot egy videónál 1-es kóddal', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const { runner } = runnerOf((args) => {
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      return Promise.resolve({ code: 1, stdout: '', stderr: 'Private video\nWARNING: extra\n' })
    })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe(`[FAIL] ${URL}: Private video`)
  })

  it('ENOENT induláskor a telepítési mondat, további hívás nélkül', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    let calls = 0
    const runner: ProcessRunner = () => {
      calls += 1
      return Promise.reject(Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }))
    }
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.err[0]).toContain('brew install yt-dlp')
    expect(streams.err[0]).toContain('mise use yt-dlp')
    expect(calls).toBe(1)
    expect(streams.out).toEqual([])
  })

  it('a --version nem nulla kilépése indulási hiba', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const runner: ProcessRunner = () => Promise.resolve({ code: 1, stdout: '', stderr: 'dyld: hiányzik\n' })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.err[0]).toBe('dyld: hiányzik')
  })

  it('az idegen cím [FAIL] és 1-es kód, probe nélkül', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    let calls = 0
    const runner: ProcessRunner = () => {
      calls += 1
      return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
    }
    const streams = io()
    expect(await commandFetch(['subtitle', 'https://vimeo.com/1', '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe('[FAIL] https://vimeo.com/1: nem YouTube-cím')
    expect(calls).toBe(1)
  })

  it('a --flat a csatornamappa nélkül, az --overwrite --force-overwrites-szal tölt', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    await mkdir(join(out, 'Csatorna'), { recursive: true })
    await writeFile(join(out, 'Csatorna', `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(out, 'Csatorna', `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      expect(dest).toBe(out)
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    expect(
      await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu', '--flat', '--overwrite'], { ...streams, runner }),
    ).toBe(0)
    expect(calls.some((args) => args.includes('--force-overwrites'))).toBe(true)
  })

  it('üres languages mellett a config forrásmappája és a hu,en a cél', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-cfg-'))
    const source = join(root, 'forras')
    await mkdir(source)
    const config = join(root, 'refinery.config.yaml')
    await writeFile(
      config,
      `vault:\n  path: /tmp/nem-letezo-vault\nsources:\n  - ${source}\nlanguages: []\n`,
    )
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--config', config], { ...streams, runner })).toBe(0)
    const download = calls.find((args) => args.includes('--write-subs'))
    expect(download).toContain('--sub-langs')
    expect(download?.[download.indexOf('--sub-langs') + 1]).toBe('hu,en')
    expect(download).toContain(`home:${join(source, 'Csatorna')}`)
  })
})

describe('listafájl és köteg', () => {
  it('a megjegyzést és az üres sort kihagyja, az idegen cím nem állítja meg a videót', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-list-'))
    const list = join(root, 'lista.txt')
    const out = join(root, 'out')
    await writeFile(list, '# megjegyzés\n\nhttps://vimeo.com/1\nabcdefghijk\n')
    const seen: string[][] = []
    const runner: ProcessRunner = (args) => {
      seen.push([...args])
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      if (args.includes('-J')) {
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }),
          stderr: '',
        })
      }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      return (async () => {
        await mkdir(dest, { recursive: true })
        await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
        await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
        return { code: 0, stdout: '', stderr: '' }
      })()
    }
    const streams = io()
    const code = await commandFetch(['subtitle', '--list', list, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(1)
    expect(streams.out[0]).toBe('[FAIL] https://vimeo.com/1: nem YouTube-cím')
    expect(streams.out[1]).toBe(`[OK]   Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 1 letöltve, 0 átugorva, 0 felirat nélkül, 1 hibás.')
    expect(seen.filter((args) => args.includes('--write-subs'))).toHaveLength(1)
  })

  it('üres listafájl indulási hiba', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-list-'))
    const list = join(root, 'ures.txt')
    await writeFile(list, '# csak megjegyzés\n\n')
    const streams = io()
    const code = await commandFetch(['subtitle', '--list', list, '--out', join(root, 'out'), '--sub-lang', 'hu'], streams)
    expect(code).toBe(1)
    expect(streams.err[0]).toBe('A listafájl nem tartalmaz címet.')
  })
})

describe('lejátszási lista', () => {
  it('két lista ugyanarra az azonosítóra két letöltést indít', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-pl-'))
    const list = join(out, 'lista.txt')
    await writeFile(
      list,
      'https://www.youtube.com/playlist?list=PLelso\nhttps://www.youtube.com/playlist?list=PLmasodik\n',
    )
    const downloads: string[] = []
    const runner: ProcessRunner = (args) => {
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      if (args.includes('--flat-playlist')) {
        const id = args.at(-1)?.includes('PLelso') ? 'PLelso' : 'PLmasodik'
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ id, title: `Kurzus ${id}`, entries: [{ id: ID, title: 'Első' }] }),
          stderr: '',
        })
      }
      downloads.push(args[args.indexOf('--paths') + 1] ?? '')
      const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
      return (async () => {
        await mkdir(dest, { recursive: true })
        await writeFile(join(dest, `Első [${ID}].hu.vtt`), 'WEBVTT\n')
        await writeFile(join(dest, `Első [${ID}].info.json`), JSON.stringify({ id: ID }))
        return { code: 0, stdout: '', stderr: '' }
      })()
    }
    const streams = io()
    expect(await commandFetch(['subtitle', '--list', list, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(0)
    expect(downloads).toHaveLength(2)
    expect(downloads.some((dest) => dest.includes('Kurzus PLelso [PLelso]'))).toBe(true)
    expect(downloads.some((dest) => dest.includes('Kurzus PLmasodik [PLmasodik]'))).toBe(true)
  })

  it('az azonosító nélküli elem hiba, a következő elem letöltődik', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-pl-'))
    let downloads = 0
    const runner: ProcessRunner = (args) => {
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      if (args.includes('--flat-playlist')) {
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({
            id: 'PLxxx',
            title: 'Kurzus',
            entries: [{ title: 'nincs' }, { id: ID, title: 'Van' }],
          }),
          stderr: '',
        })
      }
      downloads += 1
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      return (async () => {
        await mkdir(dest, { recursive: true })
        await writeFile(join(dest, `Van [${ID}].hu.vtt`), 'WEBVTT\n')
        await writeFile(join(dest, `Van [${ID}].info.json`), JSON.stringify({ id: ID }))
        return { code: 0, stdout: '', stderr: '' }
      })()
    }
    const streams = io()
    const url = 'https://www.youtube.com/playlist?list=PLxxx'
    expect(await commandFetch(['subtitle', url, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe(`[FAIL] ${url}: hiányzó videóazonosító`)
    expect(downloads).toBe(1)
  })

  it('a második tétel ENOENT-je megáll, az első bent van az összesítésben', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-miss-'))
    const list = join(root, 'lista.txt')
    const out = join(root, 'out')
    await writeFile(list, 'abcdefghijk\nzzzzzzzzzzz\n')
    let probes = 0
    const runner: ProcessRunner = (args) => {
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      if (args.includes('-J')) {
        probes += 1
        if (probes === 2) return Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }),
          stderr: '',
        })
      }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      return (async () => {
        await mkdir(dest, { recursive: true })
        await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
        await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
        return { code: 0, stdout: '', stderr: '' }
      })()
    }
    const streams = io()
    const code = await commandFetch(['subtitle', '--list', list, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(1)
    expect(streams.out[0]).toBe(`[OK]   Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 1 letöltve, 0 átugorva, 0 felirat nélkül, 0 hibás.')
    expect(streams.err[0]).toContain('brew install yt-dlp')
  })
})

describe('megszakítás és védelem', () => {
  it('a félbeszakadt letöltés nem kap sort és összesítést', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-stop-'))
    const handlers: Array<() => void> = []
    const runner: ProcessRunner = (args) => {
      if (args[0] === '--version') return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
      if (args.includes('-J')) {
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }),
          stderr: '',
        })
      }
      for (const handler of handlers) handler()
      return Promise.resolve({ code: 1, stdout: '', stderr: 'Interrupted\n' })
    }
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], {
      runner,
      stdout: streams.stdout,
      stderr: streams.stderr,
      signals: { on: (_event, listener) => handlers.push(listener) },
    })
    expect(code).toBe(130)
    expect(streams.out).toEqual([])
  })
})
