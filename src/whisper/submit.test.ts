import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RunEvent } from '../events.js'
import { localAudioStore, type AudioStore } from '../fetch/audio/store.js'
import { listArchive } from './archive.js'
import type { WhisperDirs } from './paths.js'
import { loadConfig } from '../config.js'
import { createHandoff, inboxInfo, parseTranscribeArgs, resolveLang, runTranscribe, submitEntry } from './submit.js'

let archive: string
let sources: string
let dirs: WhisperDirs
let store: AudioStore

async function put(root: string, rel: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

beforeEach(async () => {
  archive = await mkdtemp(join(tmpdir(), 'submit-archive-'))
  sources = await mkdtemp(join(tmpdir(), 'submit-sources-'))
  const root = await mkdtemp(join(tmpdir(), 'submit-whisper-'))
  dirs = { root, inbox: join(root, 'inbox'), work: join(root, 'work'), failed: join(root, 'failed'), cancel: join(root, 'cancel'), heartbeat: join(root, 'heartbeat') }
  await mkdir(dirs.inbox)
  store = localAudioStore(archive)
  await put(archive, 'Csat/Cím [abcdefghijk].m4a', 'hang')
  await put(archive, 'Csat/Cím [abcdefghijk].info.json', JSON.stringify({ title: 'Cím', channel: 'Csat', language: 'hu' }))
})

async function firstEntry() {
  return (await listArchive(store)).entries[0]!
}

describe('submitEntry', () => {
  it('az info.json előbb, a hang utoljára, .partial-on át', async () => {
    let atCopy: string[] = []
    const spy: AudioStore = {
      ...store,
      copyTo: async (path, dest) => {
        await store.copyTo(path, dest)
        atCopy = (await readdir(dirs.inbox)).sort()
      },
    }
    const result = await submitEntry(await firstEntry(), { store: spy, dirs, status: 'archived', lang: 'hu' })
    expect(result).toEqual({ ok: true })
    expect(atCopy).toHaveLength(2)
    expect(atCopy[0]).toBe('abcdefghijk.info.json')
    expect(atCopy[1]).toMatch(/^abcdefghijk\.m4a\..+\.partial$/)
    expect((await readdir(dirs.inbox)).sort()).toEqual(['abcdefghijk.info.json', 'abcdefghijk.m4a'])
    expect(JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8'))).toMatchObject({
      id: 'abcdefghijk', channel: 'Csat', refinery_lang: 'hu', refinery_target: 'whisper/csat',
    })
    expect(await readFile(join(dirs.inbox, 'abcdefghijk.m4a'), 'utf8')).toBe('hang')
  })

  it('megszakadt másolás: nem marad semmi az inboxban, a sor hiba', async () => {
    const broken: AudioStore = {
      ...store,
      copyTo: async (_path, dest) => {
        await writeFile(dest, 'fél')
        throw new Error('megszakadt')
      },
    }
    const result = await submitEntry(await firstEntry(), { store: broken, dirs, status: 'archived', lang: 'hu' })
    expect(result).toEqual({ ok: false, error: 'megszakadt' })
    expect(await readdir(dirs.inbox)).toEqual([])
  })

  it('két egyidejű leadó külön .partial fájlba másol', async () => {
    const targets: string[] = []
    const slow: AudioStore = {
      ...store,
      copyTo: async (path, dest) => {
        targets.push(dest)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await store.copyTo(path, dest)
      },
    }
    const entry = await firstEntry()
    const both = await Promise.all([
      submitEntry(entry, { store: slow, dirs, status: 'archived', lang: 'hu' }),
      submitEntry(entry, { store: slow, dirs, status: 'archived', lang: 'hu' }),
    ])
    expect(both).toEqual([{ ok: true }, { ok: true }])
    expect(new Set(targets).size).toBe(2)
    expect(await readFile(join(dirs.inbox, 'abcdefghijk.m4a'), 'utf8')).toBe('hang')
    expect((await readdir(dirs.inbox)).sort()).toEqual(['abcdefghijk.info.json', 'abcdefghijk.m4a'])
  })

  it('az egy óránál régebbi, félbemaradt .partial-t kitakarítja, a frisset békén hagyja', async () => {
    await put(dirs.inbox, 'abcdefghijk.m4a.regi.partial', 'maradék')
    await put(dirs.inbox, 'abcdefghijk.m4a.friss.partial', 'másik leadó')
    const old = new Date(Date.now() - 2 * 3600_000)
    await utimes(join(dirs.inbox, 'abcdefghijk.m4a.regi.partial'), old, old)
    const result = await submitEntry(await firstEntry(), { store, dirs, status: 'archived', lang: 'hu' })
    expect(result).toEqual({ ok: true })
    expect((await readdir(dirs.inbox)).sort()).toEqual(['abcdefghijk.info.json', 'abcdefghijk.m4a', 'abcdefghijk.m4a.friss.partial'])
  })

  it('kész / vár / átírás alatt → kihagyva, az inbox érintetlen', async () => {
    const entry = await firstEntry()
    expect(await submitEntry(entry, { store, dirs, status: 'done', lang: 'hu' })).toEqual({ ok: false, skip: 'kész' })
    expect(await submitEntry(entry, { store, dirs, status: 'pending', lang: 'hu' })).toEqual({ ok: false, skip: 'vár' })
    expect(await submitEntry(entry, { store, dirs, status: 'working', lang: 'hu' })).toEqual({ ok: false, skip: 'átírás alatt' })
    expect(await readdir(dirs.inbox)).toEqual([])
  })

  it('nyelv nélkül needsLang, az inbox üres, nincs <id>.undefined (pcsontos/issue-tracker#82)', async () => {
    const result = await submitEntry(await firstEntry(), { store, dirs, status: 'archived', lang: null })
    expect(result).toEqual({ ok: false, needsLang: true })
    expect(await readdir(dirs.inbox)).toEqual([])
  })

  it('a kihagyás előbb jön: kész hang nyelv nélkül is „kész” (pcsontos/issue-tracker#82)', async () => {
    const result = await submitEntry(await firstEntry(), { store, dirs, status: 'done', lang: null })
    expect(result).toEqual({ ok: false, skip: 'kész' })
  })
})

describe('inboxInfo', () => {
  it('az archív tartalom, felülírva id és channel, plusz a refinery mezői', async () => {
    const entry = { ...(await firstEntry()), info: { id: 'rossz', title: 'T', channel: 'régi' } }
    expect(inboxInfo(entry, 'en')).toEqual({
      id: 'abcdefghijk', title: 'T', channel: 'Csat', refinery_lang: 'en', refinery_target: 'whisper/csat',
    })
  })
})

describe('inboxInfo job', () => {
  it('a refinery_job a leadó munka azonosítója; nélküle nincs mező', async () => {
    const entry = await firstEntry()
    expect(inboxInfo(entry, 'hu', undefined, '12:3')).toMatchObject({ refinery_job: '12:3' })
    expect(inboxInfo(entry, 'hu')).not.toHaveProperty('refinery_job')
  })

  it('a submitEntry a jobot az inbox-info.json-ba írja', async () => {
    await submitEntry(await firstEntry(), { store, dirs, status: 'archived', lang: 'hu', job: '12:3' })
    const info = JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8')) as Record<string, unknown>
    expect(info).toMatchObject({ refinery_job: '12:3' })
  })

  it('egy korábbi megszakítás cancel/<id> jelzését törli, hogy az újraleadás ne szakadjon meg (pcsontos/issue-tracker#137)', async () => {
    await put(dirs.cancel, 'abcdefghijk', '')
    await put(dirs.cancel, 'masikazonos', '')
    expect(await submitEntry(await firstEntry(), { store, dirs, status: 'archived', lang: 'hu' })).toEqual({ ok: true })
    expect(await readdir(dirs.cancel)).toEqual(['masikazonos'])
  })
})

describe('resolveLang', () => {
  it('sorrend és üres languages', () => {
    expect(resolveLang({ flag: 'en', info: { language: 'hu' }, languages: ['hu'] })).toBe('en')
    expect(resolveLang({ info: { language: 'hu' }, languages: ['en'] })).toBe('hu')
    expect(resolveLang({ info: {}, languages: ['hu', 'en'] })).toBe('hu')
    expect(resolveLang({ info: {}, languages: [] })).toBeNull()
    expect(resolveLang({ info: { language: 'hu,en' }, languages: ['de'] })).toBe('de')
    // askLang (Telegram, pcsontos/issue-tracker#82): nincs config-tartalék, a jelző és az info.language marad.
    expect(resolveLang({ info: {}, languages: ['hu'], askLang: true })).toBeNull()
    expect(resolveLang({ info: { language: 'en' }, languages: ['hu'], askLang: true })).toBe('en')
    expect(resolveLang({ flag: 'de', info: {}, languages: ['hu'], askLang: true })).toBe('de')
  })
})

describe('runTranscribe', () => {
  async function run(ids: string[], over: { lang?: string; languages?: string[]; askLang?: boolean } = {}) {
    const lines: string[] = []
    const events: RunEvent[] = []
    const result = await runTranscribe(
      { ids, lang: over.lang },
      {
        store,
        dirs,
        sourcesRoot: sources,
        languages: over.languages ?? ['hu'],
        askLang: over.askLang,
        emit: (l) => void lines.push(l),
        sink: (e) => void events.push(e),
      },
    )
    return { lines, events, result }
  }

  it('kész → kihagyva, ismeretlen → hiba, kétszeres id → egyszer leadva', async () => {
    await put(archive, 'Csat/Kész [kkkkkkkkkkk].m4a')
    await put(sources, 'whisper/csat/kkkkkkkkkkk.hu.srt')
    const { lines, result } = await run(['kkkkkkkkkkk', 'nincs', 'abcdefghijk', 'abcdefghijk'])
    expect(lines.slice(0, 5)).toEqual([
      'kihagyva (kész): Kész [kkkkkkkkkkk]',
      'hiba: nincs: nincs ilyen hang',
      'leadva: Cím [abcdefghijk]',
      'kihagyva (vár): Cím [abcdefghijk]',
      '1 tétel leadva.',
    ])
    expect(result).toMatchObject({ submitted: 1, requested: 0, failed: 1, langPending: [] })
    expect(result.submittedEntries.map((entry) => entry.id)).toEqual(['abcdefghijk'])
    expect((await readdir(dirs.inbox)).sort()).toEqual(['abcdefghijk.info.json', 'abcdefghijk.m4a'])
  })

  it('régi/hiányzó heartbeat mellett a leadás megtörténik, és a figyelmeztetés az utolsó sor', async () => {
    const { lines } = await run(['abcdefghijk'])
    expect(lines[0]).toBe('leadva: Cím [abcdefghijk]')
    expect(lines.at(-1)).toMatch(/^A whisper-figyelő nem fut \(utolsó életjel: nincs\)/)
    expect(await readdir(dirs.inbox)).toContain('abcdefghijk.m4a')
  })

  it('friss heartbeat mellett nincs figyelmeztetés', async () => {
    await writeFile(dirs.heartbeat, '')
    const { lines } = await run(['abcdefghijk'])
    expect(lines).toEqual(['leadva: Cím [abcdefghijk]', '1 tétel leadva.'])
  })

  it('nyelv nélküli podcast: hiba-sor, nem <id>.undefined', async () => {
    await put(archive, 'Feed [0f0f0f0f]/Epi [1a2b3c4d].mp3')
    const { lines, result } = await run(['1a2b3c4d'], { languages: [] })
    expect(lines[0]).toBe('hiba: Epi [1a2b3c4d]: nincs nyelv: adj meg --lang kapcsolót')
    expect(result).toEqual({ submitted: 0, requested: 0, failed: 1, langPending: [], submittedEntries: [] })
    expect(await readdir(dirs.inbox)).toEqual([])
  })

  // pcsontos/issue-tracker#82: a Telegramról érkező, nyelv nélküli hang nem kap config-nyelvet, a felhasználótól kérdezünk.
  it('askLang vegyes válasz: a nyelves leadva, a nyelv nélküli langPending', async () => {
    await put(archive, 'Feed [0f0f0f0f]/Epi [1a2b3c4d].mp3')
    const { lines, result } = await run(['abcdefghijk', '1a2b3c4d'], { languages: ['hu', 'en'], askLang: true })
    expect(result).toMatchObject({ submitted: 1, failed: 0, langPending: ['1a2b3c4d'] })
    expect(lines).toContain('nyelvre vár: Epi [1a2b3c4d]')
    expect(await readdir(dirs.inbox)).toEqual(expect.not.arrayContaining(['1a2b3c4d.mp3']))
  })

  it('askLang nélkül (CLI) a config első nyelvével ad le', async () => {
    await put(archive, 'Feed [0f0f0f0f]/Epi [1a2b3c4d].mp3')
    const { result } = await run(['1a2b3c4d'], { languages: ['hu', 'en'] })
    expect(result).toMatchObject({ submitted: 1, langPending: [] })
  })

  it('askLang esetén a --lang megadva: nincs kérdés', async () => {
    await put(archive, 'Feed [0f0f0f0f]/Epi [1a2b3c4d].mp3')
    const { result } = await run(['1a2b3c4d'], { lang: 'en', askLang: true })
    expect(result).toMatchObject({ submitted: 1, langPending: [] })
  })

  it('--lang felülírja az archív nyelvet, és eseményeket ír', async () => {
    const { events } = await run(['abcdefghijk'], { lang: 'en' })
    const info = JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8')) as { refinery_lang: string }
    expect(info.refinery_lang).toBe('en')
    expect(events.map((e) => e.type)).toEqual(['scan:found', 'item:start', 'item:step', 'item:published', 'run:done'])
    expect(events.at(-1)).toEqual({ type: 'run:done', succeeded: 1, skipped: 0, failed: 0 })
  })
})

describe('runTranscribe: utólépés kérése (pcsontos/issue-tracker#65)', () => {
  const after = { recipes: ['summary'], notify: true }
  const infoPath = () => join(sources, 'whisper/csat/kkkkkkkkkkk.info.json')

  beforeEach(async () => {
    await put(archive, 'Csat/Kész [kkkkkkkkkkk].m4a')
    await put(sources, 'whisper/csat/kkkkkkkkkkk.hu.srt')
    await put(sources, 'whisper/csat/kkkkkkkkkkk.info.json', JSON.stringify({ id: 'kkkkkkkkkkk', title: 'Kész' }))
  })

  async function run(over: { done?: Map<string, string[]> | undefined; afterRecipes?: typeof after | null; after?: string; ids?: string[] }) {
    const lines: string[] = []
    const events: RunEvent[] = []
    const result = await runTranscribe(
      { ids: over.ids ?? ['kkkkkkkkkkk'] },
      {
        store,
        dirs,
        sourcesRoot: sources,
        languages: ['hu'],
        emit: (l) => void lines.push(l),
        sink: (e) => void events.push(e),
        after: over.after ?? 'cli',
        done: 'done' in over ? over.done : new Map(),
        afterRecipes: over.afterRecipes === undefined ? after : over.afterRecipes,
      },
    )
    return { lines, events, result }
  }

  it('after nélkül a mai „kihagyva (kész)”', async () => {
    const { lines, result } = await run({ afterRecipes: null, after: undefined })
    expect(lines[0]).toBe('kihagyva (kész): Kész [kkkkkkkkkkk]')
    expect(result).toEqual({ submitted: 0, requested: 0, failed: 0, langPending: [], submittedEntries: [] })
  })

  it('done nélkül nincs utólépés-kérés: a mai „kihagyva (kész)”', async () => {
    const { lines, result } = await run({ done: undefined })
    expect(lines[0]).toBe('kihagyva (kész): Kész [kkkkkkkkkkk]')
    expect(result).toEqual({ submitted: 0, requested: 0, failed: 0, langPending: [], submittedEntries: [] })
  })

  it('hiányzó recept: utólépés kérve, a jelölő az info.json-ban', async () => {
    const { lines, result, events } = await run({})
    expect(lines[0]).toBe('utólépés kérve: Kész [kkkkkkkkkkk] (receptek: summary; a serve utólépése futtatja)')
    expect(result).toEqual({ submitted: 0, requested: 1, failed: 0, langPending: [], submittedEntries: [] })
    expect(JSON.parse(await readFile(infoPath(), 'utf8'))).toMatchObject({ refinery_after: 'cli' })
    expect(events).toContainEqual({ type: 'item:step', itemId: 'kkkkkkkkkkk', step: 'utólépés kérve' })
  })

  it('Telegram-jelölő és notify: false: a kész-üzenet nem jön', async () => {
    const { lines } = await run({ after: 'j1', afterRecipes: { recipes: ['summary'], notify: false } })
    expect(lines[0]).toBe('utólépés kérve: Kész [kkkkkkkkkkk] (receptek: summary; a serve utólépése futtatja) — kész-üzenet nem jön (whisper.after.notify: false)')
  })

  it('az info.json eltűnt: hiba-sor, nem dob', async () => {
    await rm(infoPath())
    const { lines, result } = await run({})
    expect(lines[0]).toBe('hiba: Kész [kkkkkkkkkkk]: nincs meg az átirat info.json-ja')
    expect(result).toEqual({ submitted: 0, requested: 0, failed: 1, langPending: [], submittedEntries: [] })
  })

  it('minden recept kész: kihagyva a kész receptekkel', async () => {
    const { lines, result } = await run({ done: new Map([['kkkkkkkkkkk', ['summary']]]) })
    expect(lines[0]).toBe('kihagyva (kész, receptek: summary): Kész [kkkkkkkkkkk]')
    expect(result).toEqual({ submitted: 0, requested: 0, failed: 0, langPending: [], submittedEntries: [] })
  })

  it('a záró sor: utólépés kérve; kétszeres id egyszer kér', async () => {
    const { lines, result } = await run({ ids: ['kkkkkkkkkkk', 'kkkkkkkkkkk'] })
    expect(result.requested).toBe(1)
    const at = lines.indexOf('0 tétel leadva.')
    expect(lines.slice(at, at + 2)).toEqual(['0 tétel leadva.', '1 tételre utólépés kérve.'])
  })
})

describe('parseTranscribeArgs', () => {
  it.each([
    [['--', '-QFHIoCo-Ko']],
    [['--lang', 'en', '--', '-QFHIoCo-Ko']],
    [['-QFHIoCo-Ko', '--lang', 'en']],
  ])('a felhasználó saját -- szava nem azonosító: %j', (argv) => {
    const parsed = parseTranscribeArgs(argv)
    expect(parsed.ok && parsed.args.ids).toEqual(['-QFHIoCo-Ko'])
  })
  it('hibák és normalizálás', () => {
    expect(parseTranscribeArgs(['a', '--lang', 'hu,en'])).toEqual({ ok: false, error: 'A --lang értéke egyetlen nyelvkód, például hu vagy en-US.' })
    expect(parseTranscribeArgs(['a', 'b', 'a', '--lang', 'EN'])).toMatchObject({ ok: true, args: { ids: ['a', 'b'], lang: 'en' } })
    expect(parseTranscribeArgs([])).toEqual({
      ok: false,
      error: 'Adj meg legalább egy hangot (videó-azonosító vagy a list --audios kulcsa).',
    })
    expect(parseTranscribeArgs(['a', '--bogus'])).toEqual({ ok: false, error: 'Ismeretlen kapcsoló: --bogus' })
    expect(parseTranscribeArgs(['a', '--config', '/c.yaml'])).toMatchObject({ ok: true, args: { config: '/c.yaml' } })
  })

  it('a --jellel kezdődő azonosító (YouTube-id) azonosító, nem kapcsoló', () => {
    expect(parseTranscribeArgs(['-abc123def4', 'b', '--lang', 'en'])).toMatchObject({
      ok: true,
      args: { ids: ['-abc123def4', 'b'], lang: 'en' },
    })
    expect(parseTranscribeArgs(['--lang', 'hu', '-Xyz_123456'])).toMatchObject({ ok: true, args: { ids: ['-Xyz_123456'], lang: 'hu' } })
    expect(parseTranscribeArgs(['a', '--lang=en', '-a-b'])).toMatchObject({ ok: true, args: { ids: ['a', '-a-b'], lang: 'en' } })
    expect(parseTranscribeArgs(['a', '--bogus'])).toEqual({ ok: false, error: 'Ismeretlen kapcsoló: --bogus' })
  })
})

describe('createHandoff', () => {
  const cfgFor = (whisperDir: string) =>
    loadConfig(
      { vault: { path: '/v' }, sources: [sources], languages: ['hu'], whisper: { dir: whisperDir }, audio: { dir: archive } },
      '/p/c.yaml',
    )

  it('config nélkül mindig „nincs config”', async () => {
    const { handoff, warning } = await createHandoff({ cfg: null, store })
    expect(await handoff('abcdefghijk')).toEqual({ error: 'nincs config' })
    expect(await warning()).toBeNull()
  })

  it('whisper-mappa nélkül „nincs whisper-mappa”, és nem jön létre', async () => {
    const missing = join(tmpdir(), 'nincs-ilyen-whisper-mappa')
    const { handoff } = await createHandoff({ cfg: cfgFor(missing), store })
    expect(await handoff('abcdefghijk')).toEqual({ error: 'nincs whisper-mappa' })
  })

  it('leadás: submitted, másodszor skipped; a friss letöltés is megtalálható; a figyelmeztetés csak leadás után', async () => {
    const { handoff, warning } = await createHandoff({ cfg: cfgFor(dirs.root), store })
    expect(await warning()).toBeNull()
    expect(await handoff('abcdefghijk')).toBe('submitted')
    expect(await handoff('abcdefghijk')).toBe('skipped')
    await put(archive, 'Csat/Új [bbbbbbbbbbb].m4a')
    expect(await handoff('bbbbbbbbbbb')).toBe('submitted')
    expect((await readdir(dirs.inbox)).sort()).toEqual(['abcdefghijk.info.json', 'abcdefghijk.m4a', 'bbbbbbbbbbb.info.json', 'bbbbbbbbbbb.m4a'])
    expect(await warning()).toMatch(/^A whisper-figyelő nem fut/)
  })

  it('askLang: nyelv nélküli hangnál needs-lang, a langPending tömbben az id (pcsontos/issue-tracker#82)', async () => {
    await put(archive, 'Feed [0f0f0f0f]/Epi [1a2b3c4d].mp3')
    const { handoff, langPending } = await createHandoff({ cfg: cfgFor(dirs.root), store, askLang: true })
    expect(await handoff('1a2b3c4d')).toBe('needs-lang')
    expect(langPending).toEqual(['1a2b3c4d'])
    expect(await readdir(dirs.inbox)).toEqual([])
  })

  it('askLang nélkül a nyelv nélküli hang a mai szöveges okot adja, és nincs langPending', async () => {
    await put(archive, 'Feed [0f0f0f0f]/Epi [1a2b3c4d].mp3')
    const cfg = loadConfig({ vault: { path: '/v' }, sources: [sources], languages: [], whisper: { dir: dirs.root }, audio: { dir: archive } }, '/p/c.yaml')
    const { handoff, langPending } = await createHandoff({ cfg, store })
    expect(await handoff('1a2b3c4d')).toEqual({ error: 'nincs nyelv: adj meg --lang kapcsolót' })
    expect(langPending).toEqual([])
  })

  it('a --lang átmegy; ismeretlen azonosító szöveges ok', async () => {
    const { handoff } = await createHandoff({ cfg: cfgFor(dirs.root), store, lang: 'en' })
    await handoff('abcdefghijk')
    const info = JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8')) as { refinery_lang: string }
    expect(info.refinery_lang).toBe('en')
    expect(await handoff('nincsnincsni')).toEqual({ error: 'nincs ilyen hang' })
  })
})

describe('jelölő (pcsontos/issue-tracker#45)', () => {
  const infoOf = async () => JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8')) as Record<string, unknown>

  it('jelölő nélkül nincs refinery_after', async () => {
    expect(inboxInfo(await firstEntry(), 'hu')).not.toHaveProperty('refinery_after')
  })

  it('submitEntry a jelölőt az inbox-info.json-ba írja', async () => {
    await submitEntry(await firstEntry(), { store, dirs, status: 'archived', lang: 'hu', after: '7:fetch-7' })
    expect(await infoOf()).toMatchObject({ refinery_after: '7:fetch-7' })
  })

  it('runTranscribe továbbadja', async () => {
    await runTranscribe({ ids: ['abcdefghijk'] }, { store, dirs, sourcesRoot: sources, languages: ['hu'], emit: () => undefined, after: 'cli' })
    expect(await infoOf()).toMatchObject({ refinery_after: 'cli' })
  })

  it('createHandoff továbbadja', async () => {
    const cfg = loadConfig(
      { vault: { path: '/v' }, sources: [sources], languages: ['hu'], whisper: { dir: dirs.root }, audio: { dir: archive } },
      '/p/c.yaml',
    )
    const { handoff } = await createHandoff({ cfg, store, after: '9:fetch-9' })
    expect(await handoff('abcdefghijk')).toBe('submitted')
    expect(await infoOf()).toMatchObject({ refinery_after: '9:fetch-9' })
  })
})
