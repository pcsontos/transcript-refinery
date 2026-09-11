import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEvent } from '../events.js'
import { followRunLog, type FollowOptions } from './follow.js'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-follow-'))
  path = join(dir, 'run.jsonl')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const line = (event: RunEvent): string => `${JSON.stringify(event)}\n`
const started: RunEvent = { type: 'run:started', command: 'run', pid: 77 }
const ended: RunEvent = { type: 'run:ended', interrupted: false }

/** A várakozás helyett a következő sort fűzi a naplóhoz: a követés így determinisztikus. */
function appending(next: string[]): (ms: number) => Promise<void> {
  return async () => {
    const chunk = next.shift()
    if (chunk !== undefined) await appendFile(path, chunk)
  }
}

async function types(opts: Partial<FollowOptions>): Promise<string[]> {
  const seen: string[] = []
  const lines = followRunLog(path, {
    fromOffset: 0,
    intervalMs: 1,
    isAlive: () => true,
    signal: new AbortController().signal,
    sleep: appending([]),
    ...opts,
  })
  for await (const followed of lines) seen.push(followed.line.type)
  return seen
}

describe('followRunLog', () => {
  it('a futó napló új sorait adja, és a run:ended után egy utolsó olvasással zár', async () => {
    await writeFile(path, line(started))
    const got = await types({
      sleep: appending([
        line({ type: 'scan:found', count: 1 }),
        line(ended),
        line({ type: 'run:done', succeeded: 0, skipped: 0, failed: 0 }),
      ]),
    })
    expect(got).toEqual(['run:started', 'scan:found', 'run:ended', 'run:done'])
  })

  it('a fromOffset előtti sorokat nem adja ki, de az állapot beszámítja őket', async () => {
    const head = line(started) + line({ type: 'scan:found', count: 3 })
    await writeFile(path, head + line(ended))

    const got: [string, number | null, number][] = []
    const lines = followRunLog(path, {
      fromOffset: Buffer.byteLength(head),
      intervalMs: 1,
      isAlive: () => true,
      signal: new AbortController().signal,
      sleep: appending([]),
    })
    for await (const followed of lines) {
      got.push([followed.line.type, followed.state.units, followed.end])
    }
    expect(got).toEqual([['run:ended', 3, Buffer.byteLength(head + line(ended))]])
  })

  it('a fájl méreténél nagyobb offsetnél az elejéről kezd', async () => {
    await writeFile(path, line(started) + line(ended))
    expect(await types({ fromOffset: 10_000 })).toEqual(['run:started', 'run:ended'])
  })

  it('leállt folyamat után egy utolsó olvasással zár', async () => {
    await writeFile(path, line(started))
    const got = await types({
      isAlive: () => false,
      sleep: appending([
        line({ type: 'scan:found', count: 1 }),
        line({ type: 'item:start', itemId: 'a', title: 'szintetikus' }),
      ]),
    })
    expect(got).toEqual(['run:started', 'scan:found'])
  })

  it('a run:started nélküli (régi) naplót kiadja és zár', async () => {
    await writeFile(
      path,
      line({ type: 'scan:found', count: 1 }) +
        line({ type: 'run:done', succeeded: 0, skipped: 0, failed: 0 }),
    )
    const got = await types({
      sleep: appending([line({ type: 'item:start', itemId: 'a', title: 'szintetikus' })]),
    })
    expect(got).toEqual(['scan:found', 'run:done'])
  })

  it('a megszakított jelzés után nem ad több sort', async () => {
    await writeFile(path, line(started))
    const controller = new AbortController()
    const got = await types({
      signal: controller.signal,
      sleep: async () => {
        controller.abort()
        await appendFile(path, line({ type: 'scan:found', count: 1 }))
      },
    })
    expect(got).toEqual(['run:started'])
  })
})
