import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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

describe('commandServe környezeti változók ellenőrzése', () => {
  it('hiányzó kötelező változóknál 1-gyel tér vissza', async () => {
    const code = await commandServe({})
    expect(code).toBe(1)
  })

  it('érvénytelen SERVE_PORT esetén 1-gyel tér vissza', async () => {
    const code = await commandServe({
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
    expect(seen).toEqual([{ videoId: 'abcdefghijk', outDir, recipes: ['summary'], lang: 'de' }])
    await rm(outDir, { recursive: true })
  })
})
