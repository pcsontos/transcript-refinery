import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { audioId, createAudioStore, localAudioStore, s3AudioStore, type AudioStore } from './store.js'

async function put(root: string, rel: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

const NOREAD = { get: () => Promise.resolve(null), getFile: () => Promise.resolve(false) }

const S3 = { endpoint: 'http://garage:3900', region: 'garage', bucket: 'audio', prefix: 'hang/', pathStyle: true, accessKeyId: 'GK1' }

async function s3Store(client: Parameters<typeof s3AudioStore>[0]['client']): Promise<{ store: AudioStore; work: string }> {
  const work = await mkdtemp(join(tmpdir(), 'audio-work-'))
  return { store: s3AudioStore({ s3: S3, workDir: work, client }), work }
}

describe('audioId', () => {
  it('hang igen, info.json/.part nem', () => {
    expect(audioId('Cs/A [HD] [abcdefghijk].m4a')).toBe('abcdefghijk')
    expect(audioId('d/ep [1a2b3c4d].mp3')).toBe('1a2b3c4d')
    expect(audioId('Cs/A [abcdefghijk].info.json')).toBeNull()
    expect(audioId('Cs/A [abcdefghijk].m4a.part')).toBeNull()
  })
})

describe('localAudioStore', () => {
  it('existing rekurzív, a commit nem mozgat', async () => {
    const root = await mkdtemp(join(tmpdir(), 'audio-local-'))
    await put(root, 'Cs/A [abcdefghijk].m4a')
    const store = localAudioStore(root)
    expect((await store.existing()).keys).toEqual(['Cs/A [abcdefghijk].m4a'])
    await store.commit(['Cs/A [abcdefghijk].m4a'])
    expect(await exists(join(root, 'Cs/A [abcdefghijk].m4a'))).toBe(true)
    expect(store.remote).toBe(false)
    expect(await store.pending()).toEqual([])
  })
})

describe('s3AudioStore', () => {
  it('commit: előtag + relatív út, sorrendben, utána a helyi fájlok törölve', async () => {
    const calls: string[] = []
    const { store, work } = await s3Store({ ...NOREAD, list: () => Promise.resolve([]), putFile: (key) => { calls.push(key); return Promise.resolve() } })
    await put(work, 'Cs/A [abcdefghijk].m4a')
    await put(work, 'Cs/A [abcdefghijk].info.json')
    await store.commit(['Cs/A [abcdefghijk].m4a', 'Cs/A [abcdefghijk].info.json'])
    expect(calls).toEqual(['hang/Cs/A [abcdefghijk].m4a', 'hang/Cs/A [abcdefghijk].info.json'])
    expect(await exists(join(work, 'Cs/A [abcdefghijk].m4a'))).toBe(false)
    expect(await exists(join(work, 'Cs/A [abcdefghijk].info.json'))).toBe(false)
    expect(store.remote).toBe(true)
  })

  it('commit hibára dob, és a fájlok a stagingben maradnak', async () => {
    const { store, work } = await s3Store({ ...NOREAD, list: () => Promise.resolve([]), putFile: () => Promise.reject(new Error('boom')) })
    await put(work, 'Cs/A [abcdefghijk].m4a')
    await expect(store.commit(['Cs/A [abcdefghijk].m4a'])).rejects.toThrow()
    expect(await exists(join(work, 'Cs/A [abcdefghijk].m4a'))).toBe(true)
  })

  it('pending: a kész hang az info.json-nal, a .part kimarad', async () => {
    const { store, work } = await s3Store({ ...NOREAD, list: () => Promise.resolve([]), putFile: () => Promise.resolve() })
    for (const rel of ['Cs/A [abcdefghijk].m4a', 'Cs/A [abcdefghijk].info.json', 'Cs/B [bcdefghijkl].m4a.part', 'Cs/B [bcdefghijkl].info.json', 'd/ep [1a2b3c4d].mp3']) await put(work, rel)
    const pending = (await store.pending()).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))
    expect(pending).toEqual([['Cs/A [abcdefghijk].m4a', 'Cs/A [abcdefghijk].info.json'], ['d/ep [1a2b3c4d].mp3']])
  })

  it('existing: a lista az előtag nélkül + a staging kész hangjai; lista-hiba → csak staging és figyelmeztetés', async () => {
    const ok = await s3Store({ ...NOREAD, list: () => Promise.resolve(['hang/Cs/A [abcdefghijk].m4a', 'hang/Cs/A [abcdefghijk].info.json']), putFile: () => Promise.resolve() })
    expect((await ok.store.existing()).keys).toContain('Cs/A [abcdefghijk].m4a')
    const bad = await s3Store({ ...NOREAD, list: () => Promise.reject(new Error('down')), putFile: () => Promise.resolve() })
    await put(bad.work, 'd/ep [1a2b3c4d].mp3')
    const result = await bad.store.existing()
    expect(result.keys).toEqual(['d/ep [1a2b3c4d].mp3'])
    expect(result.warning).toContain('S3')
  })

  it('a hiányzó staging-mappa üres listát ad', async () => {
    const work = join(await mkdtemp(join(tmpdir(), 'audio-work-')), 'nincs')
    const store = s3AudioStore({ s3: S3, workDir: work, client: { ...NOREAD, list: () => Promise.resolve([]), putFile: () => Promise.resolve() } })
    expect(await store.pending()).toEqual([])
    expect(await readdir(dirname(work))).toEqual([])
  })
})

describe('read és copyTo', () => {
  it('helyi: read tartalom vagy null, copyTo másol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'audio-local-'))
    await put(root, 'Cs/A [abcdefghijk].info.json', '{"title":"A"}')
    const store = localAudioStore(root)
    expect((await store.read('Cs/A [abcdefghijk].info.json'))?.toString()).toBe('{"title":"A"}')
    expect(await store.read('Cs/nincs.json')).toBeNull()
    const dest = join(await mkdtemp(join(tmpdir(), 'audio-dest-')), 'out')
    await store.copyTo('Cs/A [abcdefghijk].info.json', dest)
    expect(await readFile(dest, 'utf8')).toBe('{"title":"A"}')
  })

  it('S3: read a get-et, copyTo a getFile-t hívja előtaggal; hiányzó hang → dob', async () => {
    const seen: string[] = []
    const { store } = await s3Store({
      ...NOREAD,
      list: () => Promise.resolve([]),
      putFile: () => Promise.resolve(),
      get: (key) => { seen.push(key); return Promise.resolve(key.endsWith('nincs.json') ? null : new TextEncoder().encode('{}')) },
      getFile: (key) => { seen.push(key); return Promise.resolve(!key.endsWith('nincs.m4a')) },
    })
    expect((await store.read('Cs/A.info.json'))?.toString()).toBe('{}')
    expect(await store.read('Cs/nincs.json')).toBeNull()
    await store.copyTo('Cs/A.m4a', '/tmp/ignored')
    await expect(store.copyTo('Cs/nincs.m4a', '/tmp/ignored')).rejects.toThrow('nincs ilyen hang')
    expect(seen).toEqual(['hang/Cs/A.info.json', 'hang/Cs/nincs.json', 'hang/Cs/A.m4a', 'hang/Cs/nincs.m4a'])
  })
})

describe('createAudioStore', () => {
  it('titok nélkül dob', () => {
    const audio = { dir: null, workDir: '/w', s3: S3 }
    expect(() => createAudioStore(audio, {})).toThrow('Hiányzó AUDIO_S3_SECRET_ACCESS_KEY.')
  })
})
