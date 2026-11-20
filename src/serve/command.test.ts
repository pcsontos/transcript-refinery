import { EventEmitter } from 'node:events'
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessRunner } from '../fetch/subtitle/ytdlp.js'
import { loadCliConfig } from '../config.js'
import { openState } from '../state/db.js'
import { commandServe, installIdleExit, serveEffects, serveFetchAudio, serveTranscribe } from './command.js'
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
    if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna', language: 'hu', automatic_captions: { hu: [] } }), stderr: '' }
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
    expect(summary.title).toBe('Kész: letöltve 1 db fájl, 0 kihagyva, 0 hibás.')
    expect(await readdir(join(dir, 'logs'))).toHaveLength(1)
  })

  it('az 1. elem után /cancel: Megszakítva-összesítő a nem indult elemekkel (pcsontos/issue-tracker#43)', async () => {
    const { path } = await config(true)
    const controller = new AbortController()
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']
    const stopping: ProcessRunner = async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: '1', stderr: '' }
      const id = /v=([\w-]{11})/.exec(args.join(' '))?.[1] ?? ''
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id, title: id, channel: 'Csatorna', language: 'hu', automatic_captions: { hu: [] } }), stderr: '' }
      const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `${id} [${id}].m4a`), 'a')
      controller.abort()
      return { code: 0, stdout: '', stderr: '' }
    }
    const summary = await serveFetchAudio(path, { runner: stopping })(
      { inputs: ids.map((id) => `https://www.youtube.com/watch?v=${id}`) },
      controller.signal,
      () => Promise.resolve(),
    )
    expect(summary.title).toBe('Megszakítva: letöltve 1 db fájl, 0 kihagyva, 0 hibás (2 elem nem indult el).')
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
    const fetchAudio = () => Promise.resolve({ title: 'k' })
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

  it('a serveEffects továbbadja a transcribe-ot', () => {
    const transcribe = () => Promise.resolve({ title: 'k' })
    const effects = serveEffects({
      outDir: '/o',
      languages: ['hu'],
      store: fakeStore,
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      transcribe,
    })
    expect(effects.transcribe).toBe(transcribe)
  })
})

describe('serveFetchAudio átírás és serveTranscribe', () => {
  const ID = 'abcdefghijk'
  const noSubRunner: ProcessRunner = async (args) => {
    if (args[0] === '--version') return { code: 0, stdout: '1', stderr: '' }
    if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csat', language: 'hu' }), stderr: '' }
    const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, `Cím [${ID}].m4a`), 'hang')
    await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ title: 'Cím', channel: 'Csat' }))
    return { code: 0, stdout: '', stderr: '' }
  }

  async function config(withWhisper: boolean): Promise<{ dir: string; path: string; whisper: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'serve-whisper-'))
    const whisper = join(dir, 'whisper')
    if (withWhisper) await mkdir(join(whisper, 'inbox'), { recursive: true })
    const path = join(dir, 'refinery.config.yaml')
    await writeFile(
      path,
      `vault:\n  path: ${dir}/vault\nsources:\n  - ${dir}/src\nlanguages: [hu]\nlogs:\n  dir: ${dir}/logs\naudio:\n  dir: ${dir}/audio\nwhisper:\n  dir: ${whisper}\n`,
    )
    return { dir, path, whisper }
  }

  const collect = () => {
    const lines: string[] = []
    return { lines, emit: (line: string) => { lines.push(line); return Promise.resolve() } }
  }

  it('/fetch_audio: felirat nélküli videó leadódik a --lang nyelvén, a figyelmeztetés kimegy, a napló neve /fetch_audio', async () => {
    const { dir, path, whisper } = await config(true)
    const out = collect()
    const summary = await serveFetchAudio(path, { runner: noSubRunner })(
      { inputs: [`https://www.youtube.com/watch?v=${ID}`], lang: 'en' },
      undefined,
      out.emit,
    )
    expect(out.lines[0]).toBe(`letöltve, átírásra leadva: Cím [${ID}]`)
    expect(out.lines.at(-1)).toMatch(/^A whisper-figyelő nem fut/)
    expect(summary.title).toContain('1 átírásra leadva.')
    const info = JSON.parse(await (await import('node:fs/promises')).readFile(join(whisper, 'inbox', `${ID}.info.json`), 'utf8')) as { refinery_lang: string }
    expect(info.refinery_lang).toBe('en')
    const [file] = await readdir(join(dir, 'logs'))
    const first = (await (await import('node:fs/promises')).readFile(join(dir, 'logs', file as string), 'utf8')).split('\n')[0]
    expect((JSON.parse(first as string) as { command: string }).command).toMatch(/^\/fetch_audio --lang en /)
  })

  // pcsontos/issue-tracker#82: a Telegramról nyelv nélkül érkező hangot nem adjuk le a config nyelvével, a felhasználót kérdezzük.
  it('/fetch_audio: nyelv nélküli videó nyelvre vár, az inbox üres, a válasz a langPending-et és a languages-t adja', async () => {
    const { path, whisper } = await config(true)
    const out = collect()
    const reply = await serveFetchAudio(path, { runner: noSubRunner })({ inputs: [`https://www.youtube.com/watch?v=${ID}`] }, undefined, out.emit)
    expect(out.lines[0]).toBe(`letöltve, nyelvre vár: Cím [${ID}]`)
    expect(reply).toMatchObject({ langPending: [ID], languages: ['hu'] })
    expect(reply.title).toContain('1 nyelvre vár.')
    expect(await readdir(join(whisper, 'inbox'))).toEqual([])
  })

  it('serveTranscribe: nyelv nélküli archív hang nyelvre vár; --lang mellett leadódik', async () => {
    const { dir, path, whisper } = await config(true)
    await mkdir(join(dir, 'audio', 'Csat'), { recursive: true })
    await writeFile(join(dir, 'audio', 'Csat', `Cím [${ID}].m4a`), 'hang')
    const pending = await serveTranscribe(path)({ ids: [ID] }, undefined, collect().emit)
    expect(pending).toMatchObject({ langPending: [ID], languages: ['hu'] })
    expect(await readdir(join(whisper, 'inbox'))).toEqual([])
    const given = await serveTranscribe(path)({ ids: [ID], lang: 'en' }, undefined, collect().emit)
    expect(given.langPending).toEqual([])
    expect(await readdir(join(whisper, 'inbox'))).toContain(`${ID}.m4a`)
  })

  // pcsontos/issue-tracker#90: leadás után a válasz végén egyszer a futások oldalának linkje.
  describe('követési link', () => {
    const LINK = 'Itt lehet a feldolgozást követni: https://web.example/runs'
    const linkLines = (title: string) => title.split('\n').filter((line) => line.includes('/runs'))

    async function withWeb() {
      const c = await config(true)
      await mkdir(join(c.dir, 'audio', 'Csat'), { recursive: true })
      await writeFile(join(c.dir, 'audio', 'Csat', `Cím [${ID}].m4a`), 'hang')
      await appendFile(c.path, 'web:\n  url: https://web.example/\n')
      return c
    }

    it('serveTranscribe leadás után a válasz végén egyszer a /runs link', async () => {
      const { path } = await withWeb()
      const reply = await serveTranscribe(path)({ ids: [ID], lang: 'en' }, undefined, collect().emit)
      expect(linkLines(reply.title)).toEqual([LINK])
      expect(reply.title.endsWith(LINK)).toBe(true)
    })

    it('serveFetchAudio leadás után a válasz végén egyszer a /runs link', async () => {
      const { path } = await withWeb()
      const reply = await serveFetchAudio(path, { runner: noSubRunner })({ inputs: [`https://www.youtube.com/watch?v=${ID}`], lang: 'en' }, undefined, collect().emit)
      expect(linkLines(reply.title)).toEqual([LINK])
    })

    it('leadás nélkül (csak nyelvre vár) nincs link', async () => {
      const { path } = await withWeb()
      const reply = await serveTranscribe(path)({ ids: [ID] }, undefined, collect().emit)
      expect(reply.langPending).toEqual([ID])
      expect(linkLines(reply.title)).toEqual([])
    })

    it('web.url nélkül nincs link', async () => {
      const { dir, path } = await config(true)
      await mkdir(join(dir, 'audio', 'Csat'), { recursive: true })
      await writeFile(join(dir, 'audio', 'Csat', `Cím [${ID}].m4a`), 'hang')
      const reply = await serveTranscribe(path)({ ids: [ID], lang: 'en' }, undefined, collect().emit)
      expect(linkLines(reply.title)).toEqual([])
    })
  })

  it('/fetch_audio whisper.after mellett a leadó jobId-je a jelölő; after nélkül nincs jelölő', async () => {
    const readInfo = async (whisper: string) =>
      JSON.parse(await readFile(join(whisper, 'inbox', `${ID}.info.json`), 'utf8')) as Record<string, unknown>
    const request = { inputs: [`https://www.youtube.com/watch?v=${ID}`], jobId: '7:fetch-7', lang: 'hu' }
    const plain = await config(true)
    await serveFetchAudio(plain.path, { runner: noSubRunner })(request, undefined, () => Promise.resolve())
    expect(await readInfo(plain.whisper)).not.toHaveProperty('refinery_after')
    const marked = await config(true)
    await appendFile(marked.path, '  after:\n    recipes: [summary]\n')
    await serveFetchAudio(marked.path, { runner: noSubRunner })(request, undefined, () => Promise.resolve())
    expect((await readInfo(marked.whisper)).refinery_after).toBe('7:fetch-7')
  })

  it('serveTranscribe whisper-mappa nélkül dob', async () => {
    const { path, whisper } = await config(false)
    await expect(serveTranscribe(path)({ ids: ['a'] }, undefined, () => Promise.resolve())).rejects.toThrow(`nincs whisper-mappa: ${whisper}`)
  })

  it('serveTranscribe lista-mód: üzenetek emit-tel, a vég a használati sor; nincs váró hang → szöveg', async () => {
    const { dir, path } = await config(true)
    const empty = collect()
    expect(await serveTranscribe(path)({ ids: [] }, undefined, empty.emit)).toEqual({ title: 'Nincs átírásra váró hang.' })
    await mkdir(join(dir, 'audio', 'Csat'), { recursive: true })
    await writeFile(join(dir, 'audio', 'Csat', `Cím [${ID}].m4a`), 'hang')
    const out = collect()
    const result = await serveTranscribe(path)({ ids: [] }, undefined, out.emit)
    expect(out.lines[0]).toBe(`Átírásra váró hangok:\n1. Cím [${ID}] — archivált`)
    expect(result.title).toBe(
      'Erre ne válaszolj: a lista üzenetére (amelyik így kezdődik: „Átírásra váró hangok:”) válaszolj a sorszámokkal: 0 = az üzenet összes tétele, vagy pl. 1,3. Nyelv: 1,3 --lang en.',
    )
  })

  it('serveTranscribe leadás: az inboxba kerül, az összesítő a „tétel leadva” sor, futásnapló készül', async () => {
    const { dir, path, whisper } = await config(true)
    await mkdir(join(dir, 'audio', 'Csat'), { recursive: true })
    await writeFile(join(dir, 'audio', 'Csat', `Cím [${ID}].m4a`), 'hang')
    const out = collect()
    const result = await serveTranscribe(path)({ ids: [ID], lang: 'en' }, undefined, out.emit)
    expect(result.title.split('\n')[0]).toBe('1 tétel leadva.')
    expect(out.lines[0]).toBe(`leadva: Cím [${ID}]`)
    // Az összesítő és a figyelmeztetés csak a végső válaszban szerepel, a menet közbeni sorokban nem: nem megy ki kétszer.
    expect(out.lines.filter((line) => / tétel leadva\.$/.test(line) || /^A whisper-figyelő nem fut/.test(line))).toEqual([])
    expect(result.title).toMatch(/\nA whisper-figyelő nem fut/)
    expect(await readdir(join(whisper, 'inbox'))).toContain(`${ID}.m4a`)
    expect(await readdir(join(dir, 'logs'))).toHaveLength(1)
  })

  describe('átírt, recept nélküli tételek (pcsontos/issue-tracker#65)', () => {
    async function withAfter() {
      const c = await config(true)
      await appendFile(c.path, '  after:\n    recipes: [summary]\n')
      await mkdir(join(c.dir, 'audio', 'Csat'), { recursive: true })
      const { cfg } = await loadCliConfig(c.path)
      const store = openState(cfg.statePath, cfg.vaultPath)
      for (const [id, title] of [['aaaaaaaaaaa', 'Átírt'], ['bbbbbbbbbbb', 'Archivált'], ['ccccccccccc', 'Kész']] as const) {
        await writeFile(join(c.dir, 'audio', 'Csat', `${title} [${id}].m4a`), 'hang')
        await writeFile(join(c.dir, 'audio', 'Csat', `${title} [${id}].info.json`), JSON.stringify({ title, channel: 'Csat', duration: 60 }))
        if (id === 'bbbbbbbbbbb') continue
        await mkdir(join(c.dir, 'src', 'whisper', 'csat'), { recursive: true })
        await writeFile(join(c.dir, 'src', 'whisper', 'csat', `${id}.hu.srt`), 'x')
        await writeFile(join(c.dir, 'src', 'whisper', 'csat', `${id}.info.json`), JSON.stringify({ id, title }))
        store.recordItem({ itemId: id, source: 'whisper', sourceFile: `whisper/csat/${id}.hu.srt`, subtitlePath: `/s/${id}.hu.srt`, baseName: id, title, language: 'hu', metadata: {} })
      }
      store.recordArtifact('ccccccccccc', 'summary', 'done', `${cfg.vaultPath}/c.md`, null)
      store.close()
      return c
    }

    it('serveEffects.doneRecipes: a kész receptek és a leirat-jegyzet vault-relatív útja', async () => {
      const { path, dir } = await withAfter()
      const { cfg } = await loadCliConfig(path)
      const store = openState(cfg.statePath, cfg.vaultPath)
      store.recordArtifact('ccccccccccc', 'transcript', 'done', join(cfg.vaultPath, 'Inbox', 'Kész_transcript.md'), null)
      store.close()
      const effects = serveEffects({ outDir: dir, languages: ['hu'], store: memoryStore(), fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }), callback: () => Promise.resolve(), configArg: path })
      expect(await effects.doneRecipes!('ccccccccccc')).toEqual({ recipes: ['summary'], noteUrl: 'Inbox/Kész_transcript.md' })
      expect(await effects.doneRecipes!('aaaaaaaaaaa')).toBeNull()
      expect(await effects.doneRecipes!('nincs')).toBeNull()
    })

    it('a lista az átírt, recept nélküli tételt is mutatja', async () => {
      const { path } = await withAfter()
      const out = collect()
      await serveTranscribe(path)({ ids: [] }, undefined, out.emit)
      const text = out.lines.join('\n')
      expect(text).toContain('[aaaaaaaaaaa] — 0:01:00 — átírva · summary –')
      expect(text).toContain('[bbbbbbbbbbb] — 0:01:00 — archivált')
      expect(text).not.toContain('ccccccccccc')
    })

    it('whisper.after nélkül az átírt tétel nincs a listán', async () => {
      const { path, dir } = await withAfter()
      await writeFile(path, (await readFile(path, 'utf8')).replace('  after:\n    recipes: [summary]\n', ''))
      const out = collect()
      await serveTranscribe(path)({ ids: [] }, undefined, out.emit)
      const text = out.lines.join('\n')
      expect(text).toContain('bbbbbbbbbbb')
      expect(text).not.toContain('aaaaaaaaaaa')
      expect(dir).toBeTruthy()
    })

    it('sorszámos válasz átírt tételre: utólépés kérve, a jelölő a jobId', async () => {
      const { path, dir } = await withAfter()
      const out = collect()
      const result = await serveTranscribe(path)({ ids: ['aaaaaaaaaaa'], jobId: 'j1' }, undefined, out.emit)
      expect(result.title).toContain('1 tételre utólépés kérve.')
      const info = JSON.parse(await readFile(join(dir, 'src', 'whisper', 'csat', 'aaaaaaaaaaa.info.json'), 'utf8')) as Record<string, unknown>
      expect(info.refinery_after).toBe('j1')
    })
  })
})
