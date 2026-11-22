import { getEventListeners } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AudioEntry } from './archive.js'
import type { WhisperDirs } from './paths.js'
import { abortableSleep, CANCEL_ROUNDS, waitForTranscripts } from './wait.js'

let tmp: string
let dirs: WhisperDirs
let sources: string

async function put(rel: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(tmp, rel)), { recursive: true })
  await writeFile(join(tmp, rel), text)
}

const entry = (id: string, title = id.toUpperCase()): AudioEntry => ({
  id, key: `C/t [${id}].m4a`, ext: 'm4a', title, channel: 'C', duration: null, date: null, info: {},
})

async function queue(id: string): Promise<void> {
  await put(`whisper/inbox/${id}.m4a`)
  await put(`whisper/inbox/${id}.info.json`, '{}')
}

/** A hamis `sleep`: hívásonként a következő lépés fut le (a „figyelő” egy lépést tesz). */
function steps(...list: (() => Promise<void> | void)[]) {
  const calls: number[] = []
  return {
    calls,
    sleep: async (ms: number) => {
      calls.push(ms)
      await list[calls.length - 1]?.()
    },
  }
}

function harness(signal = new AbortController().signal) {
  const emitted: string[] = []
  const progress: string[] = []
  return {
    emitted,
    progress,
    deps: (sleep: (ms: number) => Promise<void>) => ({
      dirs, sourcesRoot: sources, signal, emit: (line: string) => void emitted.push(line), progress: (line: string) => void progress.push(line), sleep,
    }),
  }
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'refinery-wait-'))
  const root = join(tmp, 'whisper')
  dirs = { root, inbox: join(root, 'inbox'), work: join(root, 'work'), failed: join(root, 'failed'), cancel: join(root, 'cancel'), heartbeat: join(root, 'heartbeat') }
  sources = join(tmp, 'src')
  await put('whisper/heartbeat', '')
})

describe('waitForTranscripts', () => {
  it('sorban → futó → kész', async () => {
    await queue('a')
    const h = harness()
    const s = steps(
      () => put('whisper/work/a.working', '{"done":42,"total":100,"unit":"percent","text":"x"}'),
      async () => {
        await put('src/whisper/c/a.hu.srt')
        await rm(join(dirs.inbox, 'a.m4a'))
        await rm(join(dirs.work, 'a.working'))
      },
    )
    expect(await waitForTranscripts([entry('a')], h.deps(s.sleep))).toEqual({ failed: 0, watcherLost: false, interrupted: false })
    expect(h.progress).toEqual(['vár: A', 'átírás: 42% · „x”'])
    expect(h.emitted).toEqual(['kész: A [a]'])
  })

  it('kívülről megszakítva nem hiba', async () => {
    await queue('a')
    const h = harness()
    const s = steps(async () => {
      await rm(join(dirs.inbox, 'a.m4a'))
      await rm(join(dirs.inbox, 'a.info.json'))
    })
    expect(await waitForTranscripts([entry('a')], h.deps(s.sleep))).toEqual({ failed: 0, watcherLost: false, interrupted: false })
    expect(h.emitted).toEqual(['megszakítva: A [a]'])
  })

  it('hiba', async () => {
    await queue('a')
    const h = harness()
    const s = steps(async () => {
      await put('whisper/failed/a.m4a')
      await put('whisper/failed/a.log', 'eleje\nffmpeg: invalid data\n')
      await rm(join(dirs.inbox, 'a.m4a'))
    })
    expect(await waitForTranscripts([entry('a')], h.deps(s.sleep))).toEqual({ failed: 1, watcherLost: false, interrupted: false })
    expect(h.emitted).toEqual(['hiba: A [a]: ffmpeg: invalid data'])
  })

  it('figyelő elveszik', async () => {
    await queue('a')
    const old = new Date(Date.now() - 600_000)
    await utimes(dirs.heartbeat, old, old)
    const h = harness()
    const s = steps()
    expect(await waitForTranscripts([entry('a')], h.deps(s.sleep))).toEqual({ failed: 0, watcherLost: true, interrupted: false })
    expect(h.emitted[0]).toMatch(/^A whisper-figyelő nem fut/)
  })

  it('Ctrl-C: sorban álló törlődik, a futóra cancel jön, időkorlát után figyelmeztet', async () => {
    await queue('a')
    await queue('b')
    await put('whisper/work/b.working', '{"done":10,"total":100,"unit":"percent"}')
    const controller = new AbortController()
    const h = harness(controller.signal)
    const s = steps(() => controller.abort())
    const result = await waitForTranscripts([entry('a'), entry('b')], h.deps(s.sleep))
    expect(result).toEqual({ failed: 0, watcherLost: false, interrupted: true })
    expect(s.calls).toHaveLength(1 + CANCEL_ROUNDS)
    expect(existsSync(join(dirs.inbox, 'a.m4a'))).toBe(false)
    expect(existsSync(join(dirs.cancel, 'a'))).toBe(true)
    expect(existsSync(join(dirs.cancel, 'b'))).toBe(true)
    expect(existsSync(join(dirs.inbox, 'b.m4a'))).toBe(true)
    expect(h.emitted).toEqual(['megszakítva: A [a]', 'A figyelő nem takarította el: b'])
  })
})

describe('abortableSleep', () => {
  it('lejárt várakozás után nem marad abort-figyelő a jelen; abortra azonnal felold', async () => {
    const controller = new AbortController()
    for (let i = 0; i < 5; i += 1) await abortableSleep(1, controller.signal)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    const started = Date.now()
    const pending = abortableSleep(60_000, controller.signal)
    controller.abort()
    await pending
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
