import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { commandServe, serveEffects } from './command.js'
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
})
