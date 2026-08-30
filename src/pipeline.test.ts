import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectEvents } from './events.js'
import { processItem } from './pipeline.js'
import { openState, type StateStore } from './state/db.js'
import type { SourceItem } from './types.js'

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ez egy sor.

2
00:00:01,000 --> 00:00:03,000
Ez egy sor.

3
00:00:02,000 --> 00:00:04,000
Ez egy másik sor.
`

let vault: string
let work: string
let store: StateStore
let item: SourceItem

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-pipe-'))
  vault = join(work, 'vault')
  await mkdir(vault, { recursive: true })
  const srtPath = join(work, 'video.en.srt')
  await writeFile(srtPath, SRT, 'utf8')
  store = openState(join(work, 'state.db'))
  item = {
    videoId: 'abc123',
    title: 'A cím',
    channel: 'A csatorna',
    uploadedAt: '2026-07-14',
    url: 'https://www.youtube.com/watch?v=abc123',
    subtitlePath: srtPath,
    mediaPath: null,
  }
})

afterEach(() => store.close())

describe('processItem', () => {
  it('jegyzetet ír, és a tartalomban nincs duplikált sor', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(outcome.status).toBe('published')
    const { readFile } = await import('node:fs/promises')
    const md = await readFile(outcome.path!, 'utf8')
    expect(md.match(/Ez egy sor\./g)).toHaveLength(1)
    expect(md).toContain('Ez egy másik sor.')
  })

  it('a fájlt a vault konvenciója szerint nevezi el', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(outcome.path).toContain(join('A csatorna', 'A cím', 'Youtube - A cím_transcript.md'))
  })

  it('másodszor futtatva kihagy, és nem ír semmit', async () => {
    const { sink } = collectEvents()
    await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    const second = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(second.status).toBe('skipped')
  })

  it('sérült feliratnál hibát ad, de nem dob kivételt', async () => {
    const broken = { ...item, subtitlePath: join(work, 'nincs.en.srt') }
    const { sink } = collectEvents()
    const outcome = await processItem(broken, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toBeTruthy()
  })

  it('a kiírt jegyzet átmegy a vault linterén', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    const { readFile } = await import('node:fs/promises')
    const { lintVaultMarkdown } = await import('./vault/lint.js')
    expect(lintVaultMarkdown(await readFile(outcome.path!, 'utf8'))).toEqual([])
  })

  it('eseményeket bocsát ki, nem ír a konzolra', async () => {
    const { sink, events } = collectEvents()
    await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(events.map((e) => e.type)).toContain('item:normalized')
    expect(events.map((e) => e.type)).toContain('item:published')
  })
})
