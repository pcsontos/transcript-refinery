import { describe, expect, it } from 'vitest'
import { YTDLP_MISSING } from '../fetch/subtitle/ytdlp.js'
import type { LocalPair } from './inventory.js'
import type { ObjectStore } from './r2.js'
import { runJob, subtitleArgv, type CallbackBody, type JobEffects, type ServeJob } from './job.js'

const ID = 'abcdefghijk'
const job = { jobId: 'job-1', videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` }

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

function emptyEffects(store: ReturnType<typeof memoryStore>): JobEffects {
  return {
    store,
    languages: ['hu', 'en'],
    outDir: '/data/telegram',
    readPair: () => Promise.resolve(pair({})),
    deletePair: () => Promise.resolve(),
    readFile: () => Promise.resolve(new Uint8Array()),
    writeFile: () => Promise.resolve(),
    fetchSubtitle: () => Promise.reject(new Error('fetch')),
    refine: () => Promise.reject(new Error('summary')),
    callback: () => Promise.resolve(),
  }
}

function effectsWith(store: ReturnType<typeof memoryStore>, paths: string[]): JobEffects {
  return {
    ...emptyEffects(store),
    writeFile: (path) => {
      paths.push(path)
      return Promise.resolve()
    },
    refine: () => Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' }),
  }
}

function pair(partial: Partial<LocalPair>): LocalPair {
  return {
    complete: false,
    title: ID,
    files: [],
    infoPath: null,
    ...partial,
  }
}

describe('subtitleArgv', () => {
  it('flat kimenetet kér, formátumot nem', () => {
    expect(subtitleArgv(job.url, '/out')).toEqual(['subtitle', job.url, '--out', '/out', '--flat'])
  })
})

describe('runJob', () => {
  it('egy illeszkedő R2-felirat és az info elég, a fetch nem indul', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Kész cím' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const calls: string[] = []
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store,
      languages: ['hu', 'en'],
      readPair: () => Promise.resolve(pair({})),
      deletePair: () => {
        calls.push('delete')
        return Promise.resolve()
      },
      readFile: () => Promise.resolve(info),
      fetchSubtitle: () => {
        calls.push('fetch')
        return Promise.resolve({ code: 0, stdout: '', stderr: '' })
      },
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(calls).toEqual([])
    expect(callbacks).toEqual([{ status: 'ready', title: 'Kész cím' }])
  })

  it('az R2-ben a videó nyelve elég, a config lista nélkül is', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Német', language: 'de' }))
    const store = memoryStore({
      [`videos/${ID}/de.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const calls: string[] = []
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store,
      languages: ['hu', 'en'],
      readPair: () => Promise.resolve(pair({})),
      deletePair: () => Promise.resolve(),
      readFile: () => Promise.resolve(info),
      fetchSubtitle: () => {
        calls.push('fetch')
        return Promise.resolve({ code: 0, stdout: '', stderr: '' })
      },
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(calls).toEqual([])
    expect(callbacks).toEqual([{ status: 'ready', title: 'Német' }])
  })

  it('hiányos helyi párt töröl, majd letölt', async () => {
    const store = memoryStore()
    const calls: string[] = []
    let local = pair({
      files: [{ language: 'hu', extension: 'vtt', absolutePath: '/out/a.hu.vtt' }],
      title: 'Fél',
    })
    await runJob(job, {
      store,
      languages: ['hu', 'en'],
      readPair: () => Promise.resolve(local),
      deletePair: () => {
        calls.push('delete')
        local = pair({})
        return Promise.resolve()
      },
      readFile: () => Promise.resolve(new Uint8Array()),
      fetchSubtitle: () => {
        calls.push('fetch')
        local = pair({
          complete: true,
          title: 'Új',
          files: [
            { language: 'hu', extension: 'vtt', absolutePath: '/out/a.hu.vtt' },
            { language: 'en', extension: 'srt', absolutePath: '/out/a.en.srt' },
          ],
          infoPath: '/out/a.info.json',
        })
        return Promise.resolve({ code: 0, stdout: '[OK]   Új', stderr: '' })
      },
      callback: () => Promise.resolve(),
    })
    expect(calls).toEqual(['delete', 'fetch', 'delete'])
    expect(store.objects[`videos/${ID}/hu.vtt`]).toBeDefined()
    expect(store.objects[`videos/${ID}/en.srt`]).toBeDefined()
    expect(store.objects[`videos/${ID}/info.json`]).toBeDefined()
  })

  it('a nulla felirat mondta Nincs felirat, feltöltés nélkül', async () => {
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store,
      languages: ['hu'],
      readPair: () => Promise.resolve(pair({})),
      deletePair: () => Promise.resolve(),
      readFile: () => Promise.resolve(new Uint8Array()),
      fetchSubtitle: () =>
        Promise.resolve({
          code: 1,
          stdout: `[SKIP] Nincs felirat: Cím [${ID}]`,
          stderr: '',
        }),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(Object.keys(store.objects)).toEqual([])
    expect(callbacks).toEqual([{ status: 'failed', error: 'Nincs felirat' }])
  })

  it('a hiányzó yt-dlp a fetch mondatát adja', async () => {
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store: memoryStore(),
      languages: ['hu'],
      readPair: () => Promise.resolve(pair({})),
      deletePair: () => Promise.resolve(),
      readFile: () => Promise.resolve(new Uint8Array()),
      fetchSubtitle: () => Promise.resolve({ code: 1, stdout: '', stderr: YTDLP_MISSING }),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(callbacks).toEqual([{ status: 'failed', error: YTDLP_MISSING }])
  })

  it('a harmadik sikertelen put után a mondat A feltöltés nem sikerült', async () => {
    let puts = 0
    const store = memoryStore()
    store.put = () => {
      puts += 1
      return Promise.reject(new Error('r2'))
    }
    const callbacks: CallbackBody[] = []
    const bytes = new TextEncoder().encode('x')
    await runJob(job, {
      store,
      languages: ['hu'],
      readPair: () =>
        Promise.resolve(
          pair({
            complete: true,
            title: 'Cím',
            files: [{ language: 'hu', extension: 'vtt', absolutePath: '/out/a.hu.vtt' }],
            infoPath: '/out/a.info.json',
          }),
        ),
      deletePair: () => Promise.resolve(),
      readFile: () => Promise.resolve(bytes),
      fetchSubtitle: () => Promise.reject(new Error('nem hívható')),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(puts).toBe(3)
    expect(callbacks).toEqual([{ status: 'failed', error: 'A feltöltés nem sikerült.' }])
  })

  it('a summary teljes R2-készletnél nem hív fetch-et, és a linket visszahívja', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Kész cím', language: 'hu' }))
    const vtt = new TextEncoder().encode('WEBVTT\n')
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: vtt,
      [`videos/${ID}/info.json`]: info,
    })
    const written: { path: string; body: Uint8Array }[] = []
    const callbacks: CallbackBody[] = []
    let summarized = 0
    await runJob({ ...job, recipes: ['summary'] }, {
      store,
      languages: ['hu', 'en'],
      outDir: '/data/telegram',
      readPair: () => Promise.resolve(pair({})),
      deletePair: () => {
        written.push({ path: 'deleted', body: new Uint8Array() })
        return Promise.resolve()
      },
      readFile: () => Promise.resolve(new Uint8Array()),
      writeFile: (path, body) => {
        written.push({ path, body })
        return Promise.resolve()
      },
      fetchSubtitle: () => {
        throw new Error('fetch')
      },
      refine: () => {
        summarized += 1
        return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_summary.md' })
      },
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(summarized).toBe(1)
    expect(written.map((item) => item.path).sort()).toEqual([
      '/data/telegram/Kész cím [abcdefghijk].hu.vtt',
      '/data/telegram/Kész cím [abcdefghijk].info.json',
      'deleted',
    ].sort())
    expect(callbacks).toEqual([
      { status: 'ready', title: 'Kész cím', noteUrl: 'https://github.com/tulaj/repo/blob/main/a_summary.md' },
    ])
  })

  it('a cím perjele egy fájlnév marad', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'A/B', language: 'hu' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const paths: string[] = []
    await runJob({ ...job, recipes: ['summary'] }, effectsWith(store, paths))
    expect(paths).toContain('/data/telegram/A⧸B [abcdefghijk].hu.vtt')
    expect(paths).toContain('/data/telegram/A⧸B [abcdefghijk].info.json')
  })

  it('hiányos R2-nél nincs fetch és nincs summary', async () => {
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob({ ...job, recipes: ['summary'] }, {
      ...emptyEffects(store),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nincs az R2-ben.' }])
  })

  it('az olvashatatlan R2 a saját mondatát adja', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
    const store = memoryStore({ [`videos/${ID}/info.json`]: info, [`videos/${ID}/hu.vtt`]: new Uint8Array([1]) })
    store.get = () => Promise.resolve(null)
    const callbacks: CallbackBody[] = []
    await runJob({ ...job, recipes: ['summary'] }, {
      ...emptyEffects(store),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nem olvasható az R2-ből.' }])
  })

  it('a törlés hibája a kész linket nem cseréli le', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const callbacks: CallbackBody[] = []
    await runJob({ ...job, recipes: ['summary'] }, {
      ...emptyEffects(store),
      refine: () => Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' }),
      deletePair: () => Promise.reject(new Error('a lemez tele')),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(callbacks).toEqual([
      { status: 'ready', title: 'Cím', noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' },
    ])
  })

  it('az ismeretlen recept és nyelv failed, fetch és modell nélkül', async () => {
    const cases: [ServeJob, string][] = [
      [{ ...job, recipes: ['toString'] }, 'Ismeretlen recept.'],
      [{ ...job, recipes: ['summary', 'nincs'] }, 'Ismeretlen recept.'],
      [{ ...job, recipes: ['summary'], lang: 'pl' }, 'Ismeretlen nyelv.'],
      [{ ...job, recipes: ['summary'], lang: '__proto__' }, 'Ismeretlen nyelv.'],
    ]
    for (const [request, error] of cases) {
      const callbacks: CallbackBody[] = []
      await runJob(request, {
        ...emptyEffects(memoryStore()),
        callback: (_id, body) => {
          callbacks.push(body)
          return Promise.resolve()
        },
      })
      expect(callbacks).toEqual([{ status: 'failed', error }])
    }
  })

  it('a recept-út a recepteket és a nyelvet adja a refine-nak', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const seen: unknown[] = []
    await runJob({ ...job, recipes: ['summary', 'notes'], lang: 'de' }, {
      ...effectsWith(store, []),
      refine: (videoId, recipes, lang) => {
        seen.push({ videoId, recipes, lang })
        return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_transcript.md' })
      },
    })
    expect(seen).toEqual([{ videoId: ID, recipes: ['summary', 'notes'], lang: 'de' }])
  })
})
