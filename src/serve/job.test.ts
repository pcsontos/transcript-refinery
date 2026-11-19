import { describe, expect, it } from 'vitest'
import { YTDLP_MISSING } from '../fetch/subtitle/ytdlp.js'
import { textItemId } from '../source/text.js'
import type { LocalPair } from './inventory.js'
import type { ObjectStore } from './r2.js'
import { MISSING_NOTE } from './summary.js'
import { cliRerunHint, runJob, subtitleArgv, type CallbackBody, type JobEffects, type ServeJob } from './job.js'

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

  it('nem YouTube-os tétel: az R2-beli info.json puszta id-je a mediaId-vel egyezik (felirat és recept)', async () => {
    const peer = 'peertube-d4VvgzW5m4jaGr9JFVBUCg'
    const info = new TextEncoder().encode(
      JSON.stringify({ extractor_key: 'PeerTube', id: 'd4VvgzW5m4jaGr9JFVBUCg', title: 'Cím', language: 'en' }),
    )
    const store = memoryStore({
      [`videos/${peer}/en.vtt`]: new Uint8Array([1]),
      [`videos/${peer}/info.json`]: info,
    })
    const peerJob = { jobId: 'job-p', videoId: peer, url: 'https://makertube.net/w/d4Vv' }
    const callbacks: CallbackBody[] = []
    await runJob(peerJob, {
      ...emptyEffects(store),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    expect(callbacks).toEqual([{ status: 'ready', title: 'Cím' }])
    const seen: string[] = []
    await runJob({ ...peerJob, recipes: ['summary'] }, {
      ...effectsWith(store, []),
      refine: (videoId) => {
        seen.push(videoId)
        return Promise.resolve({ ok: true, noteUrl: 'a_transcript.md' })
      },
    })
    expect(seen).toEqual([peer])
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

  it('a receptjob a models felülírást a refine-nak adja', async () => {
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' })),
    })
    const seen: unknown[] = []
    await runJob({ ...job, recipes: ['notes'], models: { notes: 'sonnet' } }, {
      ...effectsWith(store, []),
      refine: (_videoId, _recipes, _lang, _signal, _notify, models) => {
        seen.push(models)
        return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_transcript.md' })
      },
    })
    expect(seen).toEqual([{ notes: 'sonnet' }])
  })

  it('a receptjob a signalt a refine-nak adja', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const controller = new AbortController()
    const seen: (AbortSignal | undefined)[] = []
    await runJob(
      { ...job, recipes: ['summary'] },
      {
        ...effectsWith(store, []),
        refine: (_videoId, _recipes, _lang, signal) => {
          seen.push(signal)
          return Promise.resolve({ ok: true, noteUrl: 'a_transcript.md' })
        },
      },
      controller.signal,
    )
    expect(seen).toEqual([controller.signal])
  })
})

describe('runJob szöveges tétel', () => {
  const TEXT = 'Első sor.\nMásodik sor.'
  const enc = (text: string) => new TextEncoder().encode(text)

  function capture(store: ReturnType<typeof memoryStore>, callbacks: CallbackBody[]): JobEffects {
    return {
      ...emptyEffects(store),
      fetchSubtitle: () => Promise.reject(new Error('yt-dlp nem indulhat')),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    }
  }

  it('a szöveget és az infót az R2-be teszi, yt-dlp nélkül, és a címmel ready', async () => {
    const id = await textItemId(TEXT)
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob(
      { jobId: `5:${id}`, videoId: id, url: '', text: TEXT, title: 'átirat', textLang: 'en' },
      capture(store, callbacks),
    )
    expect(new TextDecoder().decode(store.objects[`documents/${id}/text.txt`])).toBe(TEXT)
    expect(JSON.parse(new TextDecoder().decode(store.objects[`documents/${id}/info.json`]))).toEqual({
      id,
      title: 'átirat',
      language: 'en',
    })
    expect(callbacks).toEqual([{ status: 'ready', title: 'átirat' }])
  })

  it('a szöveges tétel kulcsai a documents/ alatt vannak, a videos/ alatt semmi', async () => {
    const id = await textItemId(TEXT)
    const store = memoryStore()
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', text: TEXT, title: 'átirat' }, capture(store, []))
    expect(Object.keys(store.objects).sort()).toEqual([`documents/${id}/info.json`, `documents/${id}/text.txt`])
  })

  it('a régi, videos/ alatti szöveges párt a recept-futás nem keresi (nincs visszaesés)', async () => {
    const id = 't-0123456789abcdef'
    const store = memoryStore({
      [`videos/${id}/text.txt`]: enc('Szöveg.'),
      [`videos/${id}/info.json`]: enc(JSON.stringify({ id, title: 'Régi' })),
    })
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', recipes: ['summary'] }, capture(store, callbacks))
    expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nincs az R2-ben.' }])
  })

  it('nyelvkód nélkül az info.json-ban nincs language', async () => {
    const id = await textItemId(TEXT)
    const store = memoryStore()
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', text: TEXT, title: 'átirat' }, capture(store, []))
    expect(JSON.parse(new TextDecoder().decode(store.objects[`documents/${id}/info.json`]))).toEqual({
      id,
      title: 'átirat',
    })
  })

  it('a teljes R2-párra azonnal ready, feltöltés nélkül', async () => {
    const id = await textItemId(TEXT)
    const base = memoryStore({
      [`documents/${id}/text.txt`]: enc(TEXT),
      [`documents/${id}/info.json`]: enc(JSON.stringify({ id, title: 'régi' })),
    })
    const puts: string[] = []
    const store = {
      ...base,
      put: (key: string, body: Uint8Array) => {
        puts.push(key)
        return base.put(key, body)
      },
    }
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: `6:${id}`, videoId: id, url: '', text: TEXT, title: 'új név' }, capture(store, callbacks))
    expect(puts).toEqual([])
    expect(callbacks).toEqual([{ status: 'ready', title: 'új név' }])
  })

  it('a recept-futás a SERVE_OUT-ba .txt-t ír, nyelvkóddal vagy anélkül', async () => {
    const id = 't-0123456789abcdef'
    const cases = [
      [undefined, `Kész cím [${id}].txt`],
      ['en', `Kész cím [${id}].en.txt`],
    ] as const
    for (const [language, name] of cases) {
      const info = enc(JSON.stringify({ id, title: 'Kész cím', ...(language === undefined ? {} : { language }) }))
      const store = memoryStore({ [`documents/${id}/text.txt`]: enc('Szöveg.'), [`documents/${id}/info.json`]: info })
      const paths: string[] = []
      const callbacks: CallbackBody[] = []
      await runJob(
        { jobId: `5:${id}`, videoId: id, url: '', recipes: ['summary'] },
        {
          ...effectsWith(store, paths),
          callback: (_id, body) => {
            callbacks.push(body)
            return Promise.resolve()
          },
        },
      )
      expect(paths).toEqual([`/data/telegram/${name}`, `/data/telegram/Kész cím [${id}].info.json`])
      expect(callbacks).toEqual([
        { status: 'ready', title: 'Kész cím', noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' },
      ])
    }
  })

  it('az info.json nem nyelvkód értéke nem kerül a fájlnévbe', async () => {
    const id = 't-0123456789abcdef'
    const store = memoryStore({
      [`documents/${id}/text.txt`]: enc('Szöveg.'),
      [`documents/${id}/info.json`]: enc(JSON.stringify({ id, title: 'Cím', language: '/../../tmp/x' })),
    })
    const paths: string[] = []
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', recipes: ['summary'] }, effectsWith(store, paths))
    expect(paths).toEqual([`/data/telegram/Cím [${id}].txt`, `/data/telegram/Cím [${id}].info.json`])
  })

  it('a hiányzó szövegre a hiányzó pár mondata jön', async () => {
    const id = 't-0123456789abcdef'
    const store = memoryStore({ [`documents/${id}/info.json`]: enc(JSON.stringify({ id, title: 'X' })) })
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', recipes: ['summary'] }, capture(store, callbacks))
    expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nincs az R2-ben.' }])
  })

  it('eltérő azonosítóra failed, és az R2-be nem ír', async () => {
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob(
      { jobId: '5:t-0000000000000000', videoId: 't-0000000000000000', url: '', text: TEXT },
      capture(store, callbacks),
    )
    expect(store.objects).toEqual({})
    expect(callbacks).toEqual([{ status: 'failed', error: 'A szöveg azonosítója nem egyezik.' }])
  })
})

describe('runJob — leállt recept és életjel', () => {
  async function run(refine: JobEffects['refine']): Promise<CallbackBody[]> {
    const callbacks: CallbackBody[] = []
    const store = memoryStore()
    const effects: JobEffects = {
      ...emptyEffects(store),
      readPair: () => Promise.resolve(pair({})),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
      refine,
    }
    const pairInR2 = {
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' })),
    }
    Object.assign(store.objects, pairInR2)
    await runJob({ ...job, recipes: ['summary'] }, effects)
    return callbacks
  }

  it('a leállt futás záró üzenete viszi az elkészült jegyzeteket', async () => {
    const callbacks = await run(() => Promise.resolve({ ok: false, error: 'leállt', done: ['summary-hu'] }))
    expect(callbacks).toEqual([{ status: 'failed', error: 'leállt', done: ['summary-hu'] }])
  })

  it('a hagyományos hiba nem visz „done” mezőt', async () => {
    const callbacks = await run(() => Promise.resolve({ ok: false, error: 'hiba' }))
    expect(callbacks).toEqual([{ status: 'failed', error: 'hiba' }])
  })

  it('a kész válasz a followUp előtt megy ki', async () => {
    const seen: number[] = []
    const callbacks: CallbackBody[] = []
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' })),
    })
    const effects: JobEffects = {
      ...emptyEffects(store),
      readPair: () => Promise.resolve(pair({})),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
      refine: () =>
        Promise.resolve({
          ok: true,
          noteUrl: 'a.md',
          followUp: () => {
            seen.push(callbacks.length)
            return Promise.resolve()
          },
        }),
    }
    await runJob({ ...job, recipes: ['summary'] }, effects)
    expect(seen).toEqual([1])
    expect(callbacks.map((body) => body.status)).toEqual(['ready'])
  })

  it('a leállt (done-os) kimenet followUp-ja is a záró üzenet után fut', async () => {
    const seen: number[] = []
    const callbacks: CallbackBody[] = []
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' })),
    })
    const effects: JobEffects = {
      ...emptyEffects(store),
      readPair: () => Promise.resolve(pair({})),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
      refine: () =>
        Promise.resolve({
          ok: false,
          error: 'leállt',
          done: ['summary-hu'],
          followUp: () => {
            seen.push(callbacks.length)
            return Promise.resolve()
          },
        }),
    }
    await runJob({ ...job, recipes: ['summary'] }, effects)
    expect(seen).toEqual([1])
    expect(callbacks).toEqual([{ status: 'failed', error: 'leállt', done: ['summary-hu'] }])
  })

  it('a refine közben küldött életjel a Workerhez megy, a záró üzenet előtt', async () => {
    const callbacks = await run((_videoId, _recipes, _lang, _signal, notify) => {
      notify?.({ status: 'progress', text: 'még dolgozik' })
      return Promise.resolve({ ok: true, noteUrl: 'a.md' })
    })
    expect(callbacks.map((body) => body.status)).toEqual(['progress', 'ready'])
  })
})

describe('runJob fetch ág', () => {
  const fetchJob = { jobId: 'fetch-1', videoId: 'fetch-1', url: 'u1 u2', fetch: true }

  function withFetch(
    fetchAudio: NonNullable<JobEffects['fetchAudio']> | undefined,
    callbacks: CallbackBody[],
  ): JobEffects {
    return {
      ...emptyEffects(memoryStore()),
      fetchAudio,
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    }
  }

  it('a sorok progressként sorrendben, a végén az összesítő readyként', async () => {
    const callbacks: CallbackBody[] = []
    const requests: unknown[] = []
    await runJob(
      fetchJob,
      withFetch(async (request, _signal, emit) => {
        requests.push(request)
        await emit('letöltve: A')
        await emit('kihagyva: B')
        return 'Kész: x'
      }, callbacks),
    )
    expect(callbacks).toEqual([
      { status: 'progress', text: 'letöltve: A' },
      { status: 'progress', text: 'kihagyva: B' },
      { status: 'ready', title: 'Kész: x' },
    ])
    expect(requests).toEqual([{ inputs: ['u1', 'u2'], jobId: 'fetch-1' }])
  })

  it('--pick-kel a request pick-et kap; a hibás --pick failed, a fetchAudio nem hívódik', async () => {
    const requests: unknown[] = []
    const ok: CallbackBody[] = []
    await runJob({ ...fetchJob, url: 'https://f/rss --pick 1,3' }, withFetch((request) => (requests.push(request), Promise.resolve('k')), ok))
    expect(requests).toEqual([{ inputs: ['https://f/rss'], pick: [1, 3], jobId: 'fetch-1' }])
    const bad: CallbackBody[] = []
    await runJob({ ...fetchJob, url: 'https://f/rss --pick x' }, withFetch((request) => (requests.push(request), Promise.resolve('k')), bad))
    expect(bad).toEqual([{ status: 'failed', error: 'A --pick értéke 0, vagy vesszővel elválasztott sorszámok (pl. 1,3).' }])
    expect(requests).toHaveLength(1)
  })

  it('--lang eljut a fetchAudio-hoz; rossz --lang failed, nincs hívás', async () => {
    const requests: unknown[] = []
    const ok: CallbackBody[] = []
    await runJob({ ...fetchJob, url: 'https://y/v --lang en' }, withFetch((request) => (requests.push(request), Promise.resolve('k')), ok))
    expect(requests).toEqual([{ inputs: ['https://y/v'], lang: 'en', jobId: 'fetch-1' }])
    const bad: CallbackBody[] = []
    await runJob({ ...fetchJob, url: 'https://y/v --lang xyz1' }, withFetch((request) => (requests.push(request), Promise.resolve('k')), bad))
    expect(bad).toEqual([{ status: 'failed', error: 'A --lang értéke egyetlen nyelvkód, például hu vagy en-US.' }])
    expect(requests).toHaveLength(1)
  })

  it('a signal továbbmegy a fetchAudio-nak', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    await runJob(fetchJob, withFetch((_request, signal) => ((seen = signal), Promise.resolve('k')), []), controller.signal)
    expect(seen).toBe(controller.signal)
  })

  it('kivétel → failed az üzenet első sorával; fetchAudio nélkül is failed', async () => {
    const thrown: CallbackBody[] = []
    await runJob(fetchJob, withFetch(() => Promise.reject(new Error('elsö sor\nmásik')), thrown))
    expect(thrown).toEqual([{ status: 'failed', error: 'elsö sor' }])
    const none: CallbackBody[] = []
    await runJob(fetchJob, withFetch(undefined, none))
    expect(none).toEqual([{ status: 'failed', error: 'A hangletöltés nincs beállítva.' }])
  })
})

describe('runJob transcribe ág', () => {
  const job = (url: string) => ({ jobId: 'fetch-2', videoId: 'fetch-2', url, fetch: true })

  function withTranscribe(
    transcribe: NonNullable<JobEffects['transcribe']> | undefined,
    callbacks: CallbackBody[],
  ): JobEffects {
    return {
      ...emptyEffects(memoryStore()),
      transcribe,
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    }
  }

  it('"transcribe" lista-mód, azonosítókkal leadás, a sorok progressként, az összesítő readyként', async () => {
    const requests: unknown[] = []
    const callbacks: CallbackBody[] = []
    const effects = withTranscribe(async (request, _signal, emit) => {
      requests.push(request)
      await emit('sor')
      return 'zárás'
    }, callbacks)
    await runJob(job('transcribe'), effects)
    await runJob(job('transcribe a b --lang en'), effects)
    expect(requests).toEqual([{ ids: [], jobId: 'fetch-2' }, { ids: ['a', 'b'], lang: 'en', jobId: 'fetch-2' }])
    expect(callbacks.map((body) => body.status)).toEqual(['progress', 'ready', 'progress', 'ready'])
  })

  it('rossz --lang vagy csak kapcsoló: failed, a transcribe nem hívódik', async () => {
    const calls: unknown[] = []
    const spy = (request: unknown) => (calls.push(request), Promise.resolve('k'))
    const bad: CallbackBody[] = []
    await runJob(job('transcribe a --lang hu,en'), withTranscribe(spy, bad))
    expect(bad).toEqual([{ status: 'failed', error: 'A --lang értéke egyetlen nyelvkód, például hu vagy en-US.' }])
    expect(calls).toEqual([])
  })

  it('kivétel → failed az első sorral; beállítás nélkül is failed', async () => {
    const thrown: CallbackBody[] = []
    await runJob(job('transcribe a'), withTranscribe(() => Promise.reject(new Error('nincs whisper-mappa: /x\nrészlet')), thrown))
    expect(thrown).toEqual([{ status: 'failed', error: 'nincs whisper-mappa: /x' }])
    const none: CallbackBody[] = []
    await runJob(job('transcribe'), withTranscribe(undefined, none))
    expect(none).toEqual([{ status: 'failed', error: 'Az átírás nincs beállítva.' }])
  })
})

describe('runJob — átírás utáni futás (pcsontos/issue-tracker#45)', () => {
  const HASH = 'a1b2c3d4'
  const afterJob = { jobId: `7:${HASH}:summary`, videoId: HASH, url: 'after-whisper', recipes: ['summary'] }
  const pairOk = { ok: true as const, title: 'Epizod', language: 'en', extension: 'srt', subtitle: new Uint8Array([1]), info: new Uint8Array([2]) }

  function afterEffects(callbacks: CallbackBody[], over: Partial<JobEffects> = {}): JobEffects {
    return {
      ...emptyEffects(memoryStore()),
      whisperPair: () => Promise.resolve(pairOk),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
      ...over,
    }
  }

  it('a bemenet a helyi pár (nem az R2), a futás outDir-jébe másolva; a parancs after-whisper <id>; deploy nélkül deployError: null', async () => {
    const callbacks: CallbackBody[] = []
    const paths: string[] = []
    const commands: (string | undefined)[] = []
    await runJob(
      afterJob,
      afterEffects(callbacks, {
        writeFile: (path) => {
          paths.push(path)
          return Promise.resolve()
        },
        refine: (_v, _r, _l, _s, _n, _m, command) => {
          commands.push(command)
          return Promise.resolve({ ok: true, noteUrl: 'a.md' })
        },
      }),
    )
    expect(paths).toEqual([`/data/telegram/Epizod [${HASH}].en.srt`, `/data/telegram/Epizod [${HASH}].info.json`])
    expect(commands).toEqual([`after-whisper ${HASH}`])
    expect(callbacks).toEqual([{ status: 'ready', title: 'Epizod', noteUrl: 'a.md', deployError: null }])
  })

  it('auto deploy: előbb a deploy, utána a kész üzenet; sikeres deploynál nincs deployError', async () => {
    const order: string[] = []
    const callbacks: CallbackBody[] = []
    await runJob(
      afterJob,
      afterEffects(callbacks, {
        callback: (_id, body) => {
          order.push(body.status)
          callbacks.push(body)
          return Promise.resolve()
        },
        refine: () =>
          Promise.resolve({
            ok: true,
            noteUrl: 'a.md',
            followUp: () => {
              order.push('deploy')
              return Promise.resolve()
            },
          }),
      }),
    )
    expect(order).toEqual(['deploy', 'ready'])
    expect(callbacks).toEqual([{ status: 'ready', title: 'Epizod', noteUrl: 'a.md' }])
  })

  it('deploy-hiba: a kész üzenet viszi az okát', async () => {
    const callbacks: CallbackBody[] = []
    await runJob(
      afterJob,
      afterEffects(callbacks, {
        refine: () => Promise.resolve({ ok: true, noteUrl: 'a.md', followUp: () => Promise.resolve('a klón nem a main ágon áll') }),
      }),
    )
    expect(callbacks).toEqual([{ status: 'ready', title: 'Epizod', noteUrl: 'a.md', deployError: 'a klón nem a main ágon áll' }])
  })

  it('hiányzó helyi pár: failed, a refine nem fut', async () => {
    const callbacks: CallbackBody[] = []
    let refined = false
    await runJob(
      afterJob,
      afterEffects(callbacks, {
        whisperPair: () => Promise.resolve({ ok: false, error: 'Az átirat nincs meg a sources/whisper alatt.' }),
        refine: () => {
          refined = true
          return Promise.resolve({ ok: true, noteUrl: 'a.md' })
        },
      }),
    )
    expect(refined).toBe(false)
    expect(callbacks).toEqual([{ status: 'failed', error: 'Az átirat nincs meg a sources/whisper alatt.' }])
  })

  it('CLI-leadott utólépés, hiányzó jegyzet: a hibaszöveg a pontos paranccsal (#84)', async () => {
    const callbacks: CallbackBody[] = []
    const path = '/data/sources/whisper/Up First/abc.en.srt'
    await runJob(
      { ...afterJob, origin: 'cli' },
      afterEffects(callbacks, {
        whisperPair: () => Promise.resolve({ ...pairOk, sourcePath: path }),
        refine: () => Promise.resolve({ ok: false, error: MISSING_NOTE, missing: true }),
      }),
    )
    expect(callbacks).toEqual([
      {
        status: 'failed',
        error: `${MISSING_NOTE}\n${cliRerunHint(path, ['summary'])}`,
        missing: true,
      },
    ])
    expect(cliRerunHint(path, ['summary'])).toBe(`Újrafuttatás: refinery run --file "${path}" --recipe summary --force`)
  })

  it('Telegram-leadásnál a callback missing: true, tipp nélkül (#84)', async () => {
    const callbacks: CallbackBody[] = []
    await runJob(
      afterJob,
      afterEffects(callbacks, {
        whisperPair: () => Promise.resolve({ ...pairOk, sourcePath: '/x.srt' }),
        refine: () => Promise.resolve({ ok: false, error: MISSING_NOTE, missing: true }),
      }),
    )
    expect(callbacks).toEqual([{ status: 'failed', error: MISSING_NOTE, missing: true }])
  })

  it('recepthiba: failed, a followUp utána fut (mint ma)', async () => {
    const order: string[] = []
    await runJob(
      afterJob,
      afterEffects([], {
        callback: (_id, body) => {
          order.push(body.status)
          return Promise.resolve()
        },
        refine: () =>
          Promise.resolve({
            ok: false,
            error: 'elérhetetlen modell',
            followUp: () => {
              order.push('deploy')
              return Promise.resolve()
            },
          }),
      }),
    )
    expect(order).toEqual(['failed', 'deploy'])
  })
})

describe('runJob resolve', () => {
  const rjob = { jobId: 'r-1', videoId: 'r-1', url: 'https://makertube.net/w/d4Vv', resolve: true }
  const out = (stdout: string, over: { code?: number; stderr?: string } = {}) => () =>
    Promise.resolve({ code: over.code ?? 0, stdout, stderr: over.stderr ?? '' })

  async function resolveWith(resolve: JobEffects['resolve'], j = rjob): Promise<CallbackBody[]> {
    const callbacks: CallbackBody[] = []
    await runJob(j, {
      ...emptyEffects(memoryStore()),
      resolve,
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    })
    return callbacks
  }

  it('egy videó: playlist false, a tétel azonosítója a mediaId, az URL a webpage_url', async () => {
    const probe = JSON.stringify({ extractor_key: 'PeerTube', id: 'd4Vv', title: 'Cím', webpage_url: 'https://makertube.net/w/d4Vv' })
    expect(await resolveWith(out(probe, { stderr: 'WARNING: valami\n' }))).toEqual([
      { status: 'resolved', title: 'Cím', playlist: false, items: [{ videoId: 'peertube-d4Vv', url: 'https://makertube.net/w/d4Vv', title: 'Cím' }] },
    ])
  })

  it('lista: a duplikátum és az azonosító nélküli kimarad, a sorrend marad', async () => {
    const entry = (id: string | undefined, title: string) => ({ ie_key: 'Youtube', ...(id === undefined ? {} : { id }), url: `https://www.youtube.com/watch?v=${id ?? 'x'}`, title })
    const list = JSON.stringify({ _type: 'playlist', title: 'L', entries: [entry('aaaaaaaaaaa', 'A'), entry('bbbbbbbbbbb', 'B'), entry('aaaaaaaaaaa', 'A újra'), entry(undefined, 'Névtelen')] })
    expect(await resolveWith(out(list))).toEqual([
      {
        status: 'resolved',
        title: 'L',
        playlist: true,
        items: [
          { videoId: 'aaaaaaaaaaa', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'A' },
          { videoId: 'bbbbbbbbbbb', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'B' },
        ],
      },
    ])
  })

  it('csatorna: a fülek beágyazott listáit egy szinttel kibontja (mért yt-dlp-alak)', async () => {
    const video = (id: string) => ({ _type: 'url', ie_key: 'Youtube', id, url: `https://www.youtube.com/watch?v=${id}`, title: id })
    const tab = (title: string, ids: string[]) => ({ _type: 'playlist', id: 'UCx', title, entries: ids.map(video) })
    const channel = JSON.stringify({ _type: 'playlist', title: 'Csatorna', entries: [tab('Videos', ['aaaaaaaaaaa', 'bbbbbbbbbbb']), tab('Live', ['ccccccccccc', 'aaaaaaaaaaa'])] })
    const [body] = await resolveWith(out(channel))
    expect(body).toMatchObject({ status: 'resolved', title: 'Csatorna', playlist: true })
    expect((body as { items: { videoId: string }[] }).items.map((i) => i.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
  })

  it('hibák: nem nulla kilépés, olvashatatlan JSON, üres lista, nincs resolve', async () => {
    expect(await resolveWith(out('', { code: 1, stderr: '\nERROR: Unsupported URL: x\nmás' }))).toEqual([{ status: 'failed', error: 'ERROR: Unsupported URL: x' }])
    expect(await resolveWith(out('nem json'))).toEqual([{ status: 'failed', error: 'A link nem oldható fel.' }])
    expect(await resolveWith(out(JSON.stringify({ _type: 'playlist', title: 'L', entries: [] })))).toEqual([{ status: 'failed', error: 'a lista üres' }])
    expect(await resolveWith(undefined)).toEqual([{ status: 'failed', error: 'A link nem oldható fel.' }])
  })

  it('hiányzó yt-dlp (ENOENT) a YTDLP_MISSING hibát adja', async () => {
    const missing = () => Promise.reject(Object.assign(new Error('spawn yt-dlp'), { code: 'ENOENT' }))
    expect(await resolveWith(missing)).toEqual([{ status: 'failed', error: YTDLP_MISSING }])
  })
})
