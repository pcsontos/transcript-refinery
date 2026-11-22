import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WhisperDirs } from './paths.js'
import { cancelTranscript, listQueue, readAdvance } from './queue.js'

let tmp: string
let dirs: WhisperDirs

async function put(rel: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(tmp, rel)), { recursive: true })
  await writeFile(join(tmp, rel), text)
}

async function putItem(id: string, job?: string, title = id.toUpperCase()): Promise<void> {
  await put(`inbox/${id}.m4a`, 'hang')
  await put(`inbox/${id}.info.json`, JSON.stringify({ title, ...(job === undefined ? {} : { refinery_job: job }) }))
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'refinery-queue-'))
  dirs = {
    root: tmp,
    inbox: join(tmp, 'inbox'),
    work: join(tmp, 'work'),
    failed: join(tmp, 'failed'),
    cancel: join(tmp, 'cancel'),
    heartbeat: join(tmp, 'heartbeat'),
  }
})

describe('listQueue', () => {
  it('sorban álló, futó; a cancel-lel jelöltet kihagyja', async () => {
    await putItem('a', '12:3')
    await putItem('b')
    await put('work/b.working', '{"done":42,"total":100,"unit":"percent","text":"x"}')
    await putItem('c')
    await put('cancel/c', '')
    await put('inbox/d.info.json.123.partial', '{}')
    expect(await listQueue(dirs)).toEqual([
      { id: 'a', title: 'A', state: 'queued', job: '12:3' },
      { id: 'b', title: 'B', state: 'working', job: null },
    ])
  })

  it('hiányzó mappa → üres', async () => {
    expect(await listQueue(dirs)).toEqual([])
  })
})

describe('readAdvance', () => {
  it('a .working JSON-ja; üres, hibás vagy hiányzó → null', async () => {
    await put('work/b.working', '{"done":42,"total":100,"unit":"percent","text":"x"}')
    await put('work/d.working', '')
    await put('work/e.working', '{nem json')
    expect(await readAdvance(dirs, 'b')).toEqual({ done: 42, total: 100, unit: 'percent', text: 'x' })
    expect(await readAdvance(dirs, 'd')).toBeNull()
    expect(await readAdvance(dirs, 'e')).toBeNull()
    expect(await readAdvance(dirs, 'nincs')).toBeNull()
  })
})

describe('cancelTranscript', () => {
  it('sorban álló: removed, az inbox és a failed maradékai törlődnek, a cancel megmarad', async () => {
    await putItem('a')
    await put('failed/a.log', 'régi')
    await put('failed/b.log', 'másé')
    expect(await cancelTranscript(dirs, 'a')).toBe('removed')
    expect(await readdir(dirs.inbox)).toEqual([])
    expect(await readdir(dirs.failed)).toEqual(['b.log'])
    expect(existsSync(join(dirs.cancel, 'a'))).toBe(true)
  })

  it('futó: signalled, a .working érintetlen, a cancel létezik', async () => {
    await putItem('b')
    await put('work/b.working', '{"done":1}')
    expect(await cancelTranscript(dirs, 'b')).toBe('signalled')
    expect(existsSync(join(dirs.work, 'b.working'))).toBe(true)
    expect(existsSync(join(dirs.cancel, 'b'))).toBe(true)
    expect(existsSync(join(dirs.inbox, 'b.m4a'))).toBe(true)
  })

  it('érvénytelen azonosító: unknown, a whisper-mappán kívül nem jön létre fájl', async () => {
    await putItem('a')
    expect(await cancelTranscript(dirs, '../x')).toBe('unknown')
    expect(await cancelTranscript(dirs, 'a/b')).toBe('unknown')
    expect(await cancelTranscript(dirs, '')).toBe('unknown')
    expect(existsSync(join(tmp, '..', 'x'))).toBe(false)
    expect(existsSync(dirs.cancel)).toBe(false)
  })

  it('ismeretlen: unknown, cancel-fájl nem készül', async () => {
    expect(await cancelTranscript(dirs, 'nincs')).toBe('unknown')
    expect(existsSync(dirs.cancel)).toBe(false)
  })
})
