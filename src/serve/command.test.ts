import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessRunner } from '../fetch/subtitle/ytdlp.js'
import { commandServe, installIdleExit, serveEffects, serveFetchAudio } from './command.js'
import type { ObjectStore } from './r2.js'

function memoryStore(initial: Record<string, Uint8Array> = {}): ObjectStore & { objects: Record<string, Uint8Array> } {
  const objects = { ...initial }
  return {
    objects,
    list: (prefix) => Promise.resolve(Object.keys(objects).filter((key) => key.startsWith(prefix))),
    put: (key, body) => {
      objects[key] = body
      return Promise.resolve()
    },
    get: (key) => Promise.resolve(objects[key] ?? null),
  }
}

const fakeStore = memoryStore()

const FULL_ENV = {
  REFINERY_SERVE_SECRET: 'test-secret',
  WORKER_CALLBACK_URL: 'http://localhost',
  SERVE_OUT: '/tmp',
  SERVE_PORT: '8799',
  R2_ACCOUNT_ID: 'acc',
  R2_BUCKET: 'bkt',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'sec',
}

describe('commandServe környezeti változók ellenőrzése', () => {
  it('hiányzó kötelező változóknál 1-gyel tér vissza', async () => {
    const code = await commandServe([], {})
    expect(code).toBe(1)
  })

  it('érvénytelen SERVE_PORT esetén 1-gyel tér vissza', async () => {
    const code = await commandServe([], {
      REFINERY_SERVE_SECRET: 'test-secret',
      WORKER_CALLBACK_URL: 'http://localhost',
      SERVE_OUT: '/tmp',
      SERVE_PORT: 'invalid',
      R2_ACCOUNT_ID: 'acc',
      R2_BUCKET: 'bkt',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'sec',
    })
    expect(code).toBe(1)
  })

  it('a recept hatás a SERVE_OUT mappát, a videót, a recepteket és a nyelvet adja tovább', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'refinery-serve-'))
    const seen: unknown[] = []
    const effects = serveEffects({
      outDir,
      languages: ['hu'],
      store: fakeStore,
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      runRecipes: (input) => {
        seen.push(input)
        return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_transcript.md' })
      },
    })
    await effects.writeFile(join(outDir, 'a.vtt'), new Uint8Array([1]))
    await effects.refine('abcdefghijk', ['summary'], 'de')
    expect(seen).toMatchObject([{ videoId: 'abcdefghijk', outDir, recipes: ['summary'], lang: 'de' }])
    await rm(outDir, { recursive: true })
  })

  it('ismeretlen kapcsolóval és pozicionális argumentummal 1, a szerver nem indul', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await commandServe(['--port', '1'], FULL_ENV)).toBe(1)
      expect(await commandServe(['valami'], FULL_ENV)).toBe(1)
      expect(errorSpy).toHaveBeenCalledTimes(2)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('nem betölthető --config esetén Hibás konfiguráció és 1, a szerver nem indul', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await commandServe(['--config', '/nincs/ilyen/refinery.config.yaml'], FULL_ENV)).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith('Hibás konfiguráció: Nincs konfigurációs fájl: /nincs/ilyen/refinery.config.yaml')
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Refinery daemon elindult'))
    } finally {
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('megadott configArg mellett a receptfuttatás a megadott utat tölti be', async () => {
    const seen: { load?: () => Promise<unknown> }[] = []
    const effects = serveEffects({
      outDir: '/tmp',
      languages: ['hu'],
      store: fakeStore,
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      configArg: '/nincs/ilyen/refinery.config.yaml',
      runRecipes: (input) => {
        seen.push(input)
        return Promise.resolve({ ok: true, noteUrl: 'x' })
      },
    })
    await effects.refine('abcdefghijk', ['summary'])
    const load = seen[0]?.load
    expect(load).toBeTypeOf('function')
    // A repó gyökerében van refinery.config.yaml: ha a load a munkakönyvtárét
    // töltené, nem bukna el.
    await expect(load?.()).rejects.toThrow('Nincs konfigurációs fájl: /nincs/ilyen/refinery.config.yaml')
  })


  it('a refine a signalt a receptfuttatásnak adja', async () => {
    const seen: { signal?: AbortSignal }[] = []
    const effects = serveEffects({
      outDir: '/tmp',
      languages: ['hu'],
      store: memoryStore(),
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      runRecipes: (input) => {
        seen.push(input)
        return Promise.resolve({ ok: true, noteUrl: 'x' })
      },
    })
    const controller = new AbortController()
    await effects.refine('abcdefghijk', ['summary'], undefined, controller.signal)
    expect(seen[0]?.signal).toBe(controller.signal)
  })
})

describe('installIdleExit', () => {
  it('tétlen kapunál SIGTERM-re 143-mal kilép', () => {
    const target = new EventEmitter()
    const codes: number[] = []
    installIdleExit({ current: null }, target, (code) => void codes.push(code))

    target.emit('SIGTERM')

    expect(codes).toEqual([143])
  })

  it('foglalt kapunál nem lép ki: a futás saját kezelője zár le', () => {
    const target = new EventEmitter()
    const codes: number[] = []
    installIdleExit({ current: 'job-1' }, target, (code) => void codes.push(code))

    target.emit('SIGTERM')

    expect(codes).toEqual([])
  })
})

describe('serveFetchAudio', () => {
  const ID = 'abcdefghijk'
  const runner: ProcessRunner = async (args) => {
    if (args[0] === '--version') return { code: 0, stdout: '1', stderr: '' }
    if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
    const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, `Cím [${ID}].m4a`), 'a')
    return { code: 0, stdout: '', stderr: '' }
  }

  async function config(audio: boolean): Promise<{ dir: string; path: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'serve-audio-'))
    const path = join(dir, 'refinery.config.yaml')
    await writeFile(path, `vault:\n  path: ${dir}/vault\nsources:\n  - ${dir}/src\nlogs:\n  dir: ${dir}/logs\n${audio ? `audio:\n  dir: ${dir}/audio\n` : ''}`)
    return { dir, path }
  }

  it('audio blokk nélkül dob', async () => {
    const { path } = await config(false)
    await expect(serveFetchAudio(path, { runner })({ inputs: [`https://www.youtube.com/watch?v=${ID}`] }, undefined, () => Promise.resolve())).rejects.toThrow('Nincs audio blokk a configban.')
  })

  it('letölt, soronként emitál, összesítőt ad, és futásnaplót ír', async () => {
    const { dir, path } = await config(true)
    const lines: string[] = []
    const summary = await serveFetchAudio(path, { runner })({ inputs: [`https://www.youtube.com/watch?v=${ID}`] }, undefined, (line) => {
      lines.push(line)
      return Promise.resolve()
    })
    expect(lines).toEqual([`letöltve: Cím [${ID}]`])
    expect(summary).toBe('Kész: letöltve 1 db fájl, 0 kihagyva, 0 hibás.')
    expect(await readdir(join(dir, 'logs'))).toHaveLength(1)
  })

  it('megszakított jelre a napló interrupted-ként zárul', async () => {
    const { dir, path } = await config(true)
    const controller = new AbortController()
    controller.abort()
    await serveFetchAudio(path, { runner })({ inputs: [`https://www.youtube.com/watch?v=${ID}`] }, controller.signal, () => Promise.resolve())
    const { readFile } = await import('node:fs/promises')
    const [file] = await readdir(join(dir, 'logs'))
    const last = (await readFile(join(dir, 'logs', file as string), 'utf8')).trim().split('\n').at(-1)
    expect(JSON.parse(last as string)).toMatchObject({ type: 'run:ended', interrupted: true })
  })

  it('a serveEffects továbbadja a fetchAudio-t', () => {
    const fetchAudio = () => Promise.resolve('k')
    const effects = serveEffects({
      outDir: '/o',
      languages: ['hu'],
      store: fakeStore,
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      fetchAudio,
    })
    expect(effects.fetchAudio).toBe(fetchAudio)
  })
})
