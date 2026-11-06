import { describe, expect, it } from 'vitest'
import { YTDLP_MISSING } from '../fetch/subtitle/ytdlp.js'
import { textItemId } from '../source/text.js'
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
    expect(requests).toEqual([{ inputs: ['u1', 'u2'] }])
  })

  it('--pick-kel a request pick-et kap; a hibás --pick failed, a fetchAudio nem hívódik', async () => {
    const requests: unknown[] = []
    const ok: CallbackBody[] = []
    await runJob({ ...fetchJob, url: 'https://f/rss --pick 1,3' }, withFetch((request) => (requests.push(request), Promise.resolve('k')), ok))
    expect(requests).toEqual([{ inputs: ['https://f/rss'], pick: [1, 3] }])
    const bad: CallbackBody[] = []
    await runJob({ ...fetchJob, url: 'https://f/rss --pick x' }, withFetch((request) => (requests.push(request), Promise.resolve('k')), bad))
    expect(bad).toEqual([{ status: 'failed', error: 'A --pick értéke 0, vagy vesszővel elválasztott sorszámok (pl. 1,3).' }])
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
