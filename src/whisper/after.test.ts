import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import type { CallbackBody, ServeJob } from '../serve/job.js'
import { AFTER_WHISPER, afterMarker, afterWhisperTick, failedLine, MISSING_TRANSCRIPT, pendingAfter, readWhisperPair, requestAfter, type AfterDeps } from './after.js'
import type { WhisperDirs } from './paths.js'

const HASH = 'a1b2c3d4'
let root: string
let sources: string
let dirs: WhisperDirs

async function put(rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

/** Kész átirat a figyelő alakjában: `sources/whisper/<slug>/<id>.<nyelv>.srt` + `<id>.info.json`. */
async function done(id = HASH, marker?: string, withSrt = true): Promise<string> {
  const info = `src/whisper/npr/${id}.info.json`
  await put(info, JSON.stringify({ id, title: 'Epizod', ...(marker === undefined ? {} : { refinery_after: marker }) }))
  if (withSrt) await put(`src/whisper/npr/${id}.en.srt`, '1\n00:00:00,000 --> 00:00:01,000\nszia\n')
  return join(root, info)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'after-'))
  sources = join(root, 'src')
  const w = join(root, 'w')
  dirs = { root: w, inbox: join(w, 'inbox'), work: join(w, 'work'), failed: join(w, 'failed'), heartbeat: join(w, 'heartbeat') }
  await mkdir(dirs.failed, { recursive: true })
  await mkdir(dirs.inbox, { recursive: true })
})

describe('afterMarker', () => {
  it('utólépés nélkül nincs jelölő', () => {
    expect(afterMarker({ whisperAfter: null }, 'cli')).toBeUndefined()
  })

  it('utólépéssel a leadó azonosítója', () => {
    expect(afterMarker({ whisperAfter: { recipes: ['summary'], notify: true } }, '7:fetch-7')).toBe('7:fetch-7')
  })
})

describe('readWhisperPair', () => {
  it('a kész pár a csatornamappából: cím az info.json-ból, nyelv a fájlnévből', async () => {
    await done()
    const pair = await readWhisperPair(sources, HASH)
    expect(pair).toMatchObject({ ok: true, title: 'Epizod', language: 'en', extension: 'srt' })
    if (pair.ok) expect(new TextDecoder().decode(pair.subtitle)).toContain('szia')
  })

  it('.srt nélkül hiba', async () => {
    await done(HASH, undefined, false)
    expect(await readWhisperPair(sources, HASH)).toEqual({ ok: false, error: MISSING_TRANSCRIPT })
  })
})

describe('requestAfter', () => {
  it('a jelölő a kész átirat info.json-jába kerül, a többi mező marad, és a pendingAfter felveszi', async () => {
    await put('src/whisper/ch/v1.hu.srt', 'x')
    await put('src/whisper/ch/v1.info.json', JSON.stringify({ id: 'v1', title: 'T' }))
    expect(await requestAfter(sources, 'v1', 'cli')).toBe(true)
    expect(JSON.parse(await readFile(join(sources, 'whisper/ch/v1.info.json'), 'utf8'))).toEqual({ id: 'v1', title: 'T', refinery_after: 'cli' })
    expect(await pendingAfter(sources, dirs)).toEqual([expect.objectContaining({ id: 'v1', marker: 'cli', failed: null })])
  })

  it('pár nélkül false', async () => {
    expect(await requestAfter(sources, 'nincs', 'cli')).toBe(false)
  })
})

describe('pendingAfter', () => {
  it('csak a jelölős, .srt-vel kész tétel; a jelölő nélküli (régi) és a .srt nélküli kimarad', async () => {
    await done('a1b2c3d4', '7:fetch-7')
    await done('b2c3d4e5')
    await done('c3d4e5f6', 'cli', false)
    expect(await pendingAfter(sources, dirs)).toEqual([
      { id: 'a1b2c3d4', title: 'Epizod', marker: '7:fetch-7', infoPath: join(sources, 'whisper/npr/a1b2c3d4.info.json'), failed: null },
    ])
  })

  it('elbukott átírás: a failed/ jelölős info.json-ja, ha a .log már kint van; az ok a .log utolsó sora', async () => {
    await put('w/failed/d4e5f6a7.info.json', JSON.stringify({ title: 'Rossz', refinery_after: '7:fetch-7' }))
    await put('w/failed/e5f6a7b8.info.json', JSON.stringify({ title: 'Mozog', refinery_after: '7:fetch-7' }))
    await put('w/failed/d4e5f6a7.log', 'ffmpeg hiba\nérvénytelen bemenet\n')
    expect(await pendingAfter(sources, dirs)).toEqual([
      { id: 'd4e5f6a7', title: 'Rossz', marker: '7:fetch-7', infoPath: join(dirs.failed, 'd4e5f6a7.info.json'), failed: 'érvénytelen bemenet' },
    ])
  })
})

describe('afterWhisperTick', () => {
  function scene(after: { recipes: string[]; notify?: boolean } | null) {
    const cfg = loadConfig(
      { vault: { path: '/v' }, sources: [sources], whisper: { dir: dirs.root, ...(after === null ? {} : { after }) } },
      '/p/c.yaml',
    )
    const calls: { jobId: string; body: CallbackBody }[] = []
    const local: ServeJob[] = []
    let busy = false
    let failCallback = false
    const deps: AfterDeps = {
      load: () => Promise.resolve({ cfg }),
      claim: () => (busy ? null : () => undefined),
      callback: (jobId, body) => {
        if (failCallback) return Promise.reject(new Error('a visszahívás 503'))
        calls.push({ jobId, body })
        return Promise.resolve()
      },
      runLocal: (job) => {
        local.push(job)
        return Promise.resolve()
      },
    }
    return {
      deps,
      calls,
      local,
      setBusy: (value: boolean) => (busy = value),
      setFail: (value: boolean) => (failCallback = value),
    }
  }

  const markerOf = async (path: string) => (JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>).refinery_after

  it('Telegram-leadás + notify: transcribed a leadó munkának, a jelölő törlődik, a második kör nem küld újra', async () => {
    const info = await done(HASH, '7:fetch-7')
    const s = scene({ recipes: ['summary'], notify: true })
    await afterWhisperTick(s.deps)
    await afterWhisperTick(s.deps)
    expect(s.calls).toEqual([{ jobId: '7:fetch-7', body: { status: 'transcribed', videoId: HASH, title: 'Epizod', recipes: ['summary'] } }])
    expect(await markerOf(info)).toBeUndefined()
    expect(s.local).toEqual([])
  })

  it('CLI-jelölőnél a runLocal job origin: cli, Telegram-jelölőnél (notify: false) nincs origin (pcsontos/issue-tracker#85)', async () => {
    await done(HASH, 'cli')
    await done('c3d4e5f6', '7:fetch-7')
    const s = scene({ recipes: ['summary'], notify: false })
    await afterWhisperTick(s.deps)
    expect(s.local.map((job) => [job.videoId, job.origin])).toEqual(
      expect.arrayContaining([
        [HASH, 'cli'],
        ['c3d4e5f6', undefined],
      ]),
    )
    expect(s.local).toHaveLength(2)
  })

  it('ha a visszahívás dob, a jelölő marad, és a következő kör elküldi', async () => {
    const info = await done(HASH, '7:fetch-7')
    const s = scene({ recipes: ['summary'], notify: true })
    s.setFail(true)
    await afterWhisperTick(s.deps)
    expect(await markerOf(info)).toBe('7:fetch-7')
    s.setFail(false)
    await afterWhisperTick(s.deps)
    expect(s.calls).toHaveLength(1)
    expect(await markerOf(info)).toBeUndefined()
  })

  it('CLI-leadás: helyi futás az after-whisper url-lel, üzenet nélkül; utána a jelölő törlődik', async () => {
    const info = await done(HASH, 'cli')
    const s = scene({ recipes: ['summary', 'notes'], notify: true })
    await afterWhisperTick(s.deps)
    expect(s.local).toEqual([{ jobId: `after-whisper:${HASH}`, videoId: HASH, url: AFTER_WHISPER, recipes: ['summary', 'notes'], origin: 'cli' }])
    expect(s.calls).toEqual([])
    expect(await markerOf(info)).toBeUndefined()
  })

  it('foglalt kapu: nincs futás, a jelölő marad', async () => {
    const info = await done(HASH, 'cli')
    const s = scene({ recipes: ['summary'] })
    s.setBusy(true)
    await afterWhisperTick(s.deps)
    expect(s.local).toEqual([])
    expect(await markerOf(info)).toBe('cli')
  })

  it('notify: false mellett a Telegram-leadás is helyben fut, üzenet nélkül', async () => {
    await done(HASH, '7:fetch-7')
    const s = scene({ recipes: ['summary'], notify: false })
    await afterWhisperTick(s.deps)
    expect(s.local).toHaveLength(1)
    expect(s.calls).toEqual([])
  })

  it('elbukott átírás: Telegramnál progress az okkal; CLI-nél csak a jelölő törlődik', async () => {
    await put('w/failed/d4e5f6a7.info.json', JSON.stringify({ title: 'Rossz', refinery_after: '7:fetch-7' }))
    await put('w/failed/d4e5f6a7.log', 'érvénytelen bemenet\n')
    await put('w/failed/e5f6a7b8.info.json', JSON.stringify({ title: 'Cli', refinery_after: 'cli' }))
    await put('w/failed/e5f6a7b8.log', 'x\n')
    const s = scene({ recipes: ['summary'], notify: true })
    await afterWhisperTick(s.deps)
    expect(s.calls).toEqual([{ jobId: '7:fetch-7', body: { status: 'progress', text: failedLine('Rossz', 'érvénytelen bemenet') } }])
    expect(s.local).toEqual([])
    expect(await markerOf(join(dirs.failed, 'e5f6a7b8.info.json'))).toBeUndefined()
    await afterWhisperTick(s.deps)
    expect(s.calls).toHaveLength(1)
  })

  it('after nélkül semmi, a jelölős tétel sem', async () => {
    await done(HASH, '7:fetch-7')
    const s = scene(null)
    await afterWhisperTick(s.deps)
    expect(s.calls).toEqual([])
    expect(s.local).toEqual([])
  })
})
