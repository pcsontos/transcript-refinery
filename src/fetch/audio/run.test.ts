import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectEvents, type RunEvent } from '../../events.js'
import { readRuns } from '../../view/runs.js'
import { audioDownloadArgs, type ProcessRunner } from '../subtitle/ytdlp.js'
import { localAudioStore, s3AudioStore, type AudioStore } from './store.js'
import { feedHash } from './feed.js'
import { directTarget } from './direct.js'
import { audioSummary, openAudioRunLog, rowLine, runAudioFetch, type AudioRunDeps } from './run.js'

const yt = (id: string): string => `https://www.youtube.com/watch?v=${id}`
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'audio-run-'))
const ok = (stdout = ''): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: '' })

interface Fake {
  runner: ProcessRunner
  calls: string[][]
  downloads: () => string[][]
}

/** videos: id → { title, channel, private? }; playlists: id → { title, entries }. */
function fakeYt(input: {
  videos?: Record<string, { title?: string; channel?: string; private?: boolean }>
  playlists?: Record<string, { title: string; entries: { id: string; title: string }[] }>
}): Fake {
  const calls: string[][] = []
  const runner: ProcessRunner = async (args) => {
    calls.push([...args])
    if (args[0] === '--version') return ok('2026.1.1')
    const url = args[args.length - 1] ?? ''
    if (args.includes('--flat-playlist')) {
      const id = /list=([^&]+)/.exec(url)?.[1] ?? ''
      const playlist = input.playlists?.[id]
      if (playlist === undefined) return { code: 1, stdout: '', stderr: 'ERROR: no playlist' }
      return ok(JSON.stringify({ id, title: playlist.title, entries: playlist.entries }))
    }
    const id = /v=([^&]+)/.exec(url)?.[1] ?? ''
    const video = input.videos?.[id]
    if (video === undefined || video.private === true) return { code: 1, stdout: '', stderr: 'ERROR: Private video\nmore' }
    if (args.includes('-J')) return ok(JSON.stringify({ id, title: video.title ?? 'Cím', channel: video.channel ?? 'Csatorna' }))
    const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
    await mkdir(dest, { recursive: true })
    await writeFile(join(dest, `${video.title ?? 'Cím'} [${id}].m4a`), 'audio')
    await writeFile(join(dest, `${video.title ?? 'Cím'} [${id}].info.json`), '{}')
    return ok()
  }
  return { runner, calls, downloads: () => calls.filter((call) => call.includes('-f')) }
}

function deps(store: AudioStore, fake: Fake, extra: Partial<AudioRunDeps> = {}): { deps: AudioRunDeps; lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    deps: { store, runner: fake.runner, overwrite: false, yesPlaylist: false, stopped: () => false, emit: (line) => void lines.push(line), ...extra },
  }
}

const listing = async (root: string): Promise<string[]> => (await readdir(root, { recursive: true }).catch(() => [])).sort()

describe('audioDownloadArgs', () => {
  it('pontos', () => {
    expect(audioDownloadArgs({ url: 'U', dest: '/d', overwrite: false })).toEqual([
      '-f', 'bestaudio[ext=m4a]/bestaudio', '--write-info-json', '--no-playlist', '--no-progress', '--no-overwrites',
      '--js-runtimes', 'node', '--paths', 'home:/d', '-o', '%(title)s [%(id)s].%(ext)s', '--', 'U',
    ])
    expect(audioDownloadArgs({ url: 'U', dest: '/d', overwrite: true })).toContain('--force-overwrites')
  })
})

describe('runAudioFetch', () => {
  it('videó → <Csatorna>/<Cím> [id].m4a + info.json; ismételt futás → kihagyva, nincs új letöltés', async () => {
    const root = await tmp()
    const fake = fakeYt({ videos: { abcdefghijk: {} } })
    const first = deps(localAudioStore(root), fake)
    await runAudioFetch([yt('abcdefghijk')], first.deps)
    expect(first.lines[0]).toBe('letöltve: Cím [abcdefghijk]')
    expect(await listing(root)).toEqual(['Csatorna', 'Csatorna/Cím [abcdefghijk].info.json', 'Csatorna/Cím [abcdefghijk].m4a'])
    const before = fake.downloads().length
    const second = deps(localAudioStore(root), fake)
    await runAudioFetch([yt('abcdefghijk')], second.deps)
    expect(second.lines[0]).toBe('kihagyva: Cím [abcdefghijk]')
    expect(fake.downloads().length).toBe(before)
  })

  it('a videó önállóan, majd playlistből → másodszorra kihagyva (globális szűrés)', async () => {
    const root = await tmp()
    const fake = fakeYt({ videos: { abcdefghijk: {} }, playlists: { PLx: { title: 'Lista', entries: [{ id: 'abcdefghijk', title: 'Cím' }] } } })
    await runAudioFetch([yt('abcdefghijk')], deps(localAudioStore(root), fake).deps)
    const second = deps(localAudioStore(root), fake)
    await runAudioFetch(['https://www.youtube.com/playlist?list=PLx'], second.deps)
    expect(second.lines).toEqual(['kihagyva: Cím [abcdefghijk]'])
  })

  it('ugyanaz a videó kétszer egy futásban → az első letöltve, a második kihagyva', async () => {
    const root = await tmp()
    const fake = fakeYt({ videos: { abcdefghijk: {} } })
    const run = deps(localAudioStore(root), fake)
    await runAudioFetch([yt('abcdefghijk'), yt('abcdefghijk')], run.deps)
    expect(run.lines).toEqual(['letöltve: Cím [abcdefghijk]', 'kihagyva: Cím [abcdefghijk]'])
  })

  it('playlist: a privát elem hiba, a következő letöltődik', async () => {
    const root = await tmp()
    const fake = fakeYt({
      videos: { abcdefghijk: { title: 'Egy' }, bcdefghijkl: { private: true }, cdefghijklm: { title: 'Három' } },
      playlists: { PLx: { title: 'Lista', entries: [{ id: 'abcdefghijk', title: 'Egy' }, { id: 'bcdefghijkl', title: 'Kettő' }, { id: 'cdefghijklm', title: 'Három' }] } },
    })
    const run = deps(localAudioStore(root), fake)
    await runAudioFetch(['https://www.youtube.com/playlist?list=PLx'], run.deps)
    expect(run.lines).toEqual(['letöltve: Egy [abcdefghijk]', `hiba: ${yt('bcdefghijkl')}: ERROR: Private video`, 'letöltve: Három [cdefghijklm]'])
    expect(await listing(root)).toContain('Lista [PLx]/Egy [abcdefghijk].m4a')
  })

  it('közvetlen mp3 → <domain>/<név> [hash].mp3', async () => {
    const root = await tmp()
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response('abc', { headers: { 'content-type': 'audio/mpeg' } }))
    const run = deps(localAudioStore(root), fakeYt({}), { fetchImpl })
    await runAudioFetch(['https://valami.hu/pod/ep.mp3'], run.deps)
    expect(run.lines[0]).toMatch(/^letöltve: ep \[[0-9a-f]{8}\]$/)
    expect((await listing(root)).some((name) => /^valami\.hu\/ep \[[0-9a-f]{8}\]\.mp3$/.test(name))).toBe(true)
  })

  it('stopped: az aktuális elem befejeződik, a következő nem indul', async () => {
    const root = await tmp()
    const fake = fakeYt({ videos: { abcdefghijk: {}, bcdefghijkl: {} } })
    const run = deps(localAudioStore(root), fake, { stopped: () => run.lines.length >= 1 })
    await runAudioFetch([yt('abcdefghijk'), yt('bcdefghijkl')], run.deps)
    expect(run.lines).toHaveLength(1)
    expect(fake.calls.some((call) => call.includes(yt('bcdefghijkl')))).toBe(false)
  })

  it('yt-dlp hiányzik → YTDLP_MISSING dob', async () => {
    const runner: ProcessRunner = () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOENT' }))
    const run = deps(localAudioStore(await tmp()), { runner, calls: [], downloads: () => [] })
    await expect(runAudioFetch([yt('abcdefghijk')], run.deps)).rejects.toThrow('A yt-dlp nem található')
  })
})

describe('runAudioFetch S3-tárolóval', () => {
  function s3(work: string, options: { failPut?: boolean; failList?: boolean } = {}): AudioStore {
    const uploaded: string[] = []
    return s3AudioStore({
      s3: { endpoint: 'http://g', region: 'r', bucket: 'b', prefix: 'hang/', pathStyle: true, accessKeyId: 'k' },
      workDir: work,
      client: {
        list: () => (options.failList === true ? Promise.reject(new Error('down')) : Promise.resolve([...uploaded])),
        putFile: (key) => {
          if (options.failPut === true) return Promise.reject(new Error('boom'))
          uploaded.push(key)
          return Promise.resolve()
        },
      },
    })
  }

  it('a korábbi letöltés előbb feltöltődik, utána a videó kihagyva', async () => {
    const work = await tmp()
    await mkdir(join(work, 'Csatorna'), { recursive: true })
    await writeFile(join(work, 'Csatorna', 'Cím [abcdefghijk].m4a'), 'a')
    await writeFile(join(work, 'Csatorna', 'Cím [abcdefghijk].info.json'), '{}')
    const fake = fakeYt({ videos: { abcdefghijk: {} } })
    const run = deps(s3(work), fake)
    await runAudioFetch([yt('abcdefghijk')], run.deps)
    expect(run.lines).toEqual(['feltöltve (korábbi letöltés): Cím [abcdefghijk].m4a', 'kihagyva: Cím [abcdefghijk]'])
    expect((await listing(work)).filter((name) => name.includes('['))).toEqual([])
    expect(fake.downloads()).toHaveLength(0)
  })

  it('lista-hiba: figyelmeztetés, a letöltés megy; a feltöltés bukása → hiba sor, a fájl a stagingben', async () => {
    const work = await tmp()
    const run = deps(s3(work, { failList: true, failPut: true }), fakeYt({ videos: { abcdefghijk: {} } }))
    await runAudioFetch([yt('abcdefghijk')], run.deps)
    expect(run.lines[0]).toContain('S3')
    expect(run.lines[1]).toBe('hiba: Cím [abcdefghijk]: a feltöltés nem sikerült; a fájl a munkamappában maradt')
    expect((await listing(work)).some((name) => name.endsWith('.m4a'))).toBe(true)
  })

  it('események: start, letöltés, feltöltés, published; a hibás feltöltés item:failed', async () => {
    const good = collectEvents()
    await runAudioFetch([yt('abcdefghijk')], deps(s3(await tmp()), fakeYt({ videos: { abcdefghijk: {} } }), { sink: good.sink }).deps)
    expect(good.events.map((event) => event.type)).toEqual(['scan:found', 'item:start', 'item:step', 'item:step', 'item:published', 'run:done'])
    const steps = good.events.filter((event): event is Extract<RunEvent, { type: 'item:step' }> => event.type === 'item:step')
    expect(steps.map((event) => event.step)).toEqual(['letöltés', 'feltöltés S3-ba'])
    expect(good.events.find((event) => event.type === 'item:published')).toMatchObject({ path: 'Csatorna/Cím [abcdefghijk].m4a' })

    const bad = collectEvents()
    await runAudioFetch([yt('bcdefghijkl')], deps(s3(await tmp(), { failPut: true }), fakeYt({ videos: { bcdefghijkl: {} } }), { sink: bad.sink }).deps)
    expect(bad.events.find((event) => event.type === 'item:failed')).toMatchObject({ kind: 'audio', error: 'a feltöltés nem sikerült; a fájl a munkamappában maradt' })
  })
})

describe('események és napló', () => {
  it('helyi tárolónál nincs feltöltés-lépés; a playlist kibontása frissíti a scan:found-ot', async () => {
    const root = await tmp()
    const fake = fakeYt({
      videos: { abcdefghijk: {}, bcdefghijkl: {}, cdefghijklm: {} },
      playlists: { PLx: { title: 'L', entries: [{ id: 'abcdefghijk', title: 'a' }, { id: 'bcdefghijkl', title: 'b' }, { id: 'cdefghijklm', title: 'c' }] } },
    })
    const sink = collectEvents()
    await runAudioFetch(['https://www.youtube.com/playlist?list=PLx'], deps(localAudioStore(root), fake, { sink: sink.sink }).deps)
    const counts = sink.events.flatMap((event) => (event.type === 'scan:found' ? [event.count] : []))
    expect(counts).toEqual([1, 3])
    expect(sink.events.some((event) => event.type === 'item:step' && event.step === 'feltöltés S3-ba')).toBe(false)
  })

  it('openAudioRunLog: run:started a paranccsal; futó, majd megszakított állapot', async () => {
    const logs = await tmp()
    const log = openAudioRunLog(logs, 'fetch audio U')
    const running = await readRuns({ logsDir: logs }, () => Promise.resolve(true))
    expect(running[0]).toMatchObject({ command: 'fetch audio U', status: 'running' })
    log.sink({ type: 'run:ended', interrupted: true })
    log.close()
    const ended = await readRuns({ logsDir: logs }, () => Promise.resolve(false))
    expect(ended[0]?.status).toBe('interrupted')
    expect(dirname(log.path)).toBe(logs)
  })
})

describe('sorok', () => {
  it('rowLine', () => {
    expect(rowLine({ outcome: 'failed', label: 'u', reason: 'x' })).toBe('hiba: u: x')
    expect(rowLine({ outcome: 'uploaded', label: 'n' })).toBe('feltöltve (korábbi letöltés): n')
  })

  it('audioSummary', () => {
    expect(audioSummary([{ outcome: 'downloaded', label: 'a' }, { outcome: 'skipped', label: 'b' }, { outcome: 'failed', label: 'c', reason: 'x' }])).toBe('Kész: letöltve 1 db fájl, 1 kihagyva, 1 hibás.')
    expect(audioSummary([{ outcome: 'uploaded', label: 'a' }])).toBe('Kész: letöltve 0 db fájl, 0 kihagyva, 0 hibás. Korábbi letöltésből feltöltve: 1.')
  })
})

describe('podcast-feed', () => {
  const FEED = 'https://f.hu/rss'
  const E1 = 'https://f.hu/e1.mp3'
  const E2 = 'https://f.hu/e2.mp3'
  const raw1 = { _type: 'url', url: `${E1}#__youtubedl_smuggle=x`, title: 'Első', timestamp: 1552480285, duration: 6024 }
  const raw2 = { _type: 'url', url: `${E2}#__youtubedl_smuggle=x`, title: 'Második' }
  const feedJson = JSON.stringify({ _type: 'playlist', title: 'Podcast', entries: [raw1, raw2] })
  const feedRunner: ProcessRunner = (args) =>
    Promise.resolve(args[0] === '--version' ? ok('1') : args.includes('--flat-playlist') ? ok(feedJson) : { code: 1, stdout: '', stderr: 'váratlan hívás' })
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return Promise.resolve(new Response(url === FEED ? '<rss/>' : 'abc', { headers: { 'content-type': url === FEED ? 'application/rss+xml' : 'audio/mpeg' } }))
  }
  const hash = (url: string): string => directTarget(url).hash
  const feedRun = async (inputs: string[], extra: Partial<AudioRunDeps> = {}) => {
    const root = await tmp()
    const events = collectEvents()
    const run = deps(localAudioStore(root), { runner: feedRunner, calls: [], downloads: () => [] }, { fetchImpl, sink: events.sink, ...extra })
    const rows = await runAudioFetch(inputs, run.deps)
    return { root, lines: run.lines, rows, events: events.events }
  }

  it('feed pick nélkül: a lista kimegy, listed sor, a tároló üres, nincs item:* esemény', async () => {
    const { root, lines, rows, events } = await feedRun([FEED])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(`Podcast\nFeed: ${FEED}\n1. Első — 2019-03-13, 1:40:24\n2. Második`)
    expect(rows).toEqual([{ outcome: 'listed', label: FEED }])
    expect(await listing(root)).toEqual([])
    expect(events.some((event) => event.type.startsWith('item:'))).toBe(false)
  })

  it('feed --pick 2: csak a 2. epizód, <Feed> [hash]/<Ep> [hash].mp3 + info.json', async () => {
    const { root, lines } = await feedRun([FEED], { pick: [2] })
    const dir = `Podcast [${feedHash(FEED)}]`
    expect(lines).toEqual([`letöltve: Második [${hash(E2)}]`])
    expect(await listing(root)).toEqual([dir, `${dir}/Második [${hash(E2)}].info.json`, `${dir}/Második [${hash(E2)}].mp3`])
    expect(JSON.parse(await readFile(join(root, dir, `Második [${hash(E2)}].info.json`), 'utf8'))).toEqual(raw2)
  })

  it('feed --pick 0: mind; --pick 9 két epizódra: hiba, nincs letöltés', async () => {
    const all = await feedRun([FEED], { pick: 'all' })
    expect(all.lines).toEqual([`letöltve: Első [${hash(E1)}]`, `letöltve: Második [${hash(E2)}]`])
    const bad = await feedRun([FEED], { pick: [9] })
    expect(bad.lines).toEqual([`hiba: ${FEED}: érvénytelen sorszám: 9 (a feedben 2 epizód van)`])
    expect(await listing(bad.root)).toEqual([])
  })

  it('feed más linkkel együtt: hiba, a másik link letöltődik', async () => {
    const { lines } = await feedRun([FEED, 'https://f.hu/x.mp3'])
    expect(lines[0]).toBe(`hiba: ${FEED}: a feedet egyedül add meg`)
    expect(lines[1]).toMatch(/^letöltve: x \[/)
  })

  it('egy értelmezhetetlen epizód-URL hibasor, a többi epizód letöltődik', async () => {
    const odd = JSON.stringify({ _type: 'playlist', title: 'Podcast', entries: [{ url: 'nem-url', title: 'Rossz' }, { url: E2 + '#x', title: 'Második' }] })
    const oddRunner: ProcessRunner = (args) => Promise.resolve(args[0] === '--version' ? ok('1') : ok(odd))
    const root = await tmp()
    const run = deps(localAudioStore(root), { runner: oddRunner, calls: [], downloads: () => [] }, { fetchImpl, pick: 'all' })
    await runAudioFetch([FEED], run.deps)
    expect(run.lines[0]).toMatch(/^hiba: nem-url: /)
    expect(run.lines[1]).toBe(`letöltve: Második [${hash(E2)}]`)
  })

  it('--pick nem feedre: hiba, nincs letöltés', async () => {
    const { root, lines } = await feedRun(['https://f.hu/x.mp3'], { pick: [1] })
    expect(lines).toEqual(['hiba: https://f.hu/x.mp3: a --pick csak feedhez adható meg'])
    expect(await listing(root)).toEqual([])
  })

  it('előbb közvetlen mp3-linkként, majd a feedből → kihagyva', async () => {
    const root = await tmp()
    const store = localAudioStore(root)
    const fake = { runner: feedRunner, calls: [], downloads: () => [] }
    await runAudioFetch([E1], deps(store, fake, { fetchImpl }).deps)
    const second = deps(store, fake, { fetchImpl, pick: [1] })
    await runAudioFetch([FEED], second.deps)
    expect(second.lines).toEqual([`kihagyva: Első [${hash(E1)}]`])
  })
})
