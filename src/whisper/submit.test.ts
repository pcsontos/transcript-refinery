import { mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
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
  dirs = { root, inbox: join(root, 'inbox'), work: join(root, 'work'), failed: join(root, 'failed'), heartbeat: join(root, 'heartbeat') }
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

  it('nyelv nélkül hiba, nincs <id>.undefined', async () => {
    const result = await submitEntry(await firstEntry(), { store, dirs, status: 'archived', lang: null })
    expect(result).toEqual({ ok: false, error: 'nincs nyelv: adj meg --lang kapcsolót' })
    expect(await readdir(dirs.inbox)).toEqual([])
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

describe('resolveLang', () => {
  it('sorrend és üres languages', () => {
    expect(resolveLang({ flag: 'en', info: { language: 'hu' }, languages: ['hu'] })).toBe('en')
    expect(resolveLang({ info: { language: 'hu' }, languages: ['en'] })).toBe('hu')
    expect(resolveLang({ info: {}, languages: ['hu', 'en'] })).toBe('hu')
    expect(resolveLang({ info: {}, languages: [] })).toBeNull()
    expect(resolveLang({ info: { language: 'hu,en' }, languages: ['de'] })).toBe('de')
  })
})

describe('runTranscribe', () => {
  async function run(ids: string[], over: { lang?: string; languages?: string[] } = {}) {
    const lines: string[] = []
    const events: RunEvent[] = []
    const result = await runTranscribe(
      { ids, lang: over.lang },
      { store, dirs, sourcesRoot: sources, languages: over.languages ?? ['hu'], emit: (l) => void lines.push(l), sink: (e) => void events.push(e) },
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
    expect(result).toEqual({ submitted: 1, failed: 1 })
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
    expect(result).toEqual({ submitted: 0, failed: 1 })
    expect(await readdir(dirs.inbox)).toEqual([])
  })

  it('--lang felülírja az archív nyelvet, és eseményeket ír', async () => {
    const { events } = await run(['abcdefghijk'], { lang: 'en' })
    const info = JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8')) as { refinery_lang: string }
    expect(info.refinery_lang).toBe('en')
    expect(events.map((e) => e.type)).toEqual(['scan:found', 'item:start', 'item:step', 'item:published', 'run:done'])
    expect(events.at(-1)).toEqual({ type: 'run:done', succeeded: 1, skipped: 0, failed: 0 })
  })
})

describe('parseTranscribeArgs', () => {
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
    expect(await handoff('abcdefghijk')).toBe('nincs config')
    expect(await warning()).toBeNull()
  })

  it('whisper-mappa nélkül „nincs whisper-mappa”, és nem jön létre', async () => {
    const missing = join(tmpdir(), 'nincs-ilyen-whisper-mappa')
    const { handoff } = await createHandoff({ cfg: cfgFor(missing), store })
    expect(await handoff('abcdefghijk')).toBe('nincs whisper-mappa')
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

  it('a --lang átmegy; ismeretlen azonosító szöveges ok', async () => {
    const { handoff } = await createHandoff({ cfg: cfgFor(dirs.root), store, lang: 'en' })
    await handoff('abcdefghijk')
    const info = JSON.parse(await readFile(join(dirs.inbox, 'abcdefghijk.info.json'), 'utf8')) as { refinery_lang: string }
    expect(info.refinery_lang).toBe('en')
    expect(await handoff('nincsnincsni')).toBe('nincs ilyen hang')
  })
})
