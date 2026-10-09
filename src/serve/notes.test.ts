import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { createNotesSource, NotesUnavailable, originOf } from './notes.js'

const ID = 'abcdefghijk'
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-notes-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function note(path: string, fields: Record<string, string>, body = '# Cím\n\nSzöveg.\n'): Promise<void> {
  const head = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), `---\n${head}\n---\n${body}`)
}

function source(options: { busy?: boolean; pull?: (repo: string) => Promise<void> } = {}) {
  const pulls: string[] = []
  const notes = createNotesSource({
    load: () => Promise.resolve({ cfg: { vaultPath: root, notesRoot: root } as Config }),
    busy: () => options.busy ?? false,
    pull: (repo) => {
      pulls.push(repo)
      return options.pull ? options.pull(repo) : Promise.resolve()
    },
  })
  return { notes, pulls }
}

describe('originOf', () => {
  it('az origin mező dönt, hiányában a serve-out telegram, minden más cli', () => {
    expect(originOf({ source: 'serve-out' })).toBe('telegram')
    expect(originOf({ source: 'youtube' })).toBe('cli')
    expect(originOf({ source: 'serve-out', origin: 'cli' })).toBe('cli')
    expect(originOf({ source: 'youtube', origin: 'telegram' })).toBe('telegram')
    expect(originOf({ source: 'youtube', origin: 'web' })).toBe('cli')
  })
})

describe('createNotesSource.list', () => {
  it('két mappában ugyanaz az item_id egy elem; fajtánként a frissebb generated_at nyer', async () => {
    const yt = { item_id: ID, title: 'Beszéd', source: 'youtube', url: `"https://www.youtube.com/watch?v=${ID}"` }
    const tg = { ...yt, source: 'serve-out' }
    await note('youtube/csatorna/Beszéd_transcript.md', { ...yt, generated_at: '2026-10-01T10:00:00.000Z' })
    await note('youtube/csatorna/Beszéd_summary.md', { ...yt, generated_at: '2026-10-01T11:00:00.000Z' }, '# Cím\n\nrégi összefoglaló\n')
    await note('youtube/csatorna/Beszéd_notes-hu.md', { ...yt, generated_at: '2026-10-01T12:00:00.000Z' })
    await note(`serve-out/Beszéd [${ID}]_transcript.md`, { ...tg, generated_at: '2026-10-05T09:00:00.000Z' })
    await note(`serve-out/Beszéd [${ID}]_summary.md`, { ...tg, generated_at: '2026-10-05T10:00:00.000Z' }, '# Cím\n\núj összefoglaló\n')
    const { notes } = source()
    const list = await notes.list()
    expect(list.stale).toBe(false)
    expect(list.items).toHaveLength(1)
    const item = list.items[0]!
    expect(item).toMatchObject({
      itemId: ID,
      title: 'Beszéd',
      url: `https://www.youtube.com/watch?v=${ID}`,
      origin: 'telegram',
      generatedAt: '2026-10-05T10:00:00.000Z',
    })
    expect([...item.kinds].sort()).toEqual(['notes-hu', 'summary', 'transcript'])
    const view = await notes.note(ID, 'summary')
    expect(view?.html).toContain('új összefoglaló')
    expect(view?.html).not.toContain('régi összefoglaló')
  })

  it('az elemek a legfrissebb jegyzetük szerint csökkenőek; url nélkül null', async () => {
    await note('felvetel/a_transcript.md', { item_id: 'a1b2c3d4e5f6a7b8', title: 'Régi', source: 'recording', generated_at: '2026-10-01T10:00:00.000Z' })
    await note('felvetel/b_transcript.md', { item_id: 'b1b2c3d4e5f6a7b8', title: 'Új', source: 'recording', generated_at: '2026-10-03T10:00:00.000Z' })
    const { items } = await source().notes.list()
    expect(items.map((item) => item.title)).toEqual(['Új', 'Régi'])
    expect(items[0]!.url).toBeNull()
    expect(items[0]!.origin).toBe('cli')
  })

  it('a _queue.md, a frontmatter nélküli, a hibás YAML-ű és az item_id nélküli fájl kimarad, a lista nem bukik', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube', generated_at: '2026-10-01T10:00:00.000Z' })
    await writeFile(join(root, '_queue.md'), '---\nitem_id: q\n---\n')
    await writeFile(join(root, 'nincs_transcript.md'), '# Csak törzs\n')
    await writeFile(join(root, 'torott_transcript.md'), '---\ntitle: [\n---\n')
    await note('azonosito-nelkul_transcript.md', { title: 'Névtelen', source: 'youtube' })
    await note('jo_Rossz.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const { items } = await source().notes.list()
    expect(items.map((item) => item.itemId)).toEqual([ID])
    expect(items[0]!.kinds).toEqual(['transcript'])
  })

  it('pullol a vaultban; a pull hibájánál a helyi állapotból, stale: true', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const ok = source()
    expect((await ok.notes.list()).stale).toBe(false)
    expect(ok.pulls).toEqual([root])
    const failing = source({ pull: () => Promise.reject(new Error('timeout')) })
    const list = await failing.notes.list()
    expect(list.stale).toBe(true)
    expect(list.items).toHaveLength(1)
  })

  it('amíg a serve dolgozik, nem pullol, és stale: true', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const busy = source({ busy: true })
    const list = await busy.notes.list()
    expect(busy.pulls).toEqual([])
    expect(list.stale).toBe(true)
    expect(list.items).toHaveLength(1)
  })

  it('hiányzó jegyzetmappánál üres lista', async () => {
    const notes = createNotesSource({
      load: () => Promise.resolve({ cfg: { vaultPath: root, notesRoot: join(root, 'nincs') } as Config }),
      busy: () => false,
      pull: () => Promise.resolve(),
    })
    expect(await notes.list()).toEqual({ stale: false, items: [] })
  })

  it('a config hibája NotesUnavailable', async () => {
    const notes = createNotesSource({ load: () => Promise.reject(new Error('nincs config')), busy: () => false })
    await expect(notes.list()).rejects.toBeInstanceOf(NotesUnavailable)
    await expect(notes.note(ID, 'summary')).rejects.toBeInstanceOf(NotesUnavailable)
  })
})

describe('createNotesSource.note', () => {
  it('a törzs HTML-je frontmatter nélkül, a nyers HTML szövegként', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'serve-out', generated_at: '2026-10-01T10:00:00.000Z' })
    await note('jo_summary.md', { item_id: ID, title: 'Jó', source: 'youtube', origin: 'cli', generated_at: '2026-10-02T10:00:00.000Z' }, '# Jó\n\n<script>alert(1)</script>\n')
    const view = await source().notes.note(ID, 'summary')
    expect(view).toMatchObject({ title: 'Jó', url: null, origin: 'cli', generatedAt: '2026-10-02T10:00:00.000Z' })
    expect(view!.html).toContain('<h1>Jó</h1>')
    expect(view!.html).toContain('&lt;script&gt;')
    expect(view!.html).not.toContain('<script>')
    expect(view!.html).not.toContain('item_id')
  })

  it('rossz fajta, ..-s fajta, ismeretlen elem és hiányzó fajta: null', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const { notes } = source()
    expect(await notes.note(ID, 'Summary')).toBeNull()
    expect(await notes.note(ID, '../../kint')).toBeNull()
    expect(await notes.note('../kint', 'transcript')).toBeNull()
    expect(await notes.note('ismeretlen', 'transcript')).toBeNull()
    expect(await notes.note(ID, 'summary')).toBeNull()
    expect(await notes.note(ID, 'transcript')).not.toBeNull()
  })
})
