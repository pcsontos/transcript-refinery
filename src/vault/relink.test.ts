import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openState } from '../state/db.js'
import { findNotes, noteKey, planRelink, relinkNotes, type FoundNote, type Tracked } from './relink.js'

const tracked = (path: string): Tracked => ({ itemId: 'a1', kind: 'transcript', path })
const found = (path: string, fields: Record<string, unknown> = { item_id: 'a1', recipe: 'transcript' }): FoundNote => ({
  path,
  fields,
})

describe('planRelink', () => {
  it('létező tárolt útnál nincs teendő', () => {
    const report = planRelink([tracked('/v/a.md')], [found('/v/b.md')], () => true)
    expect(report).toEqual({ moved: [], missing: [], conflicts: [] })
  })

  it('hiányzó út + egy jelölt: elmozdult', () => {
    const report = planRelink([tracked('/v/a.md')], [found('/v/b.md')], () => false)
    expect(report.moved).toEqual([{ ...tracked('/v/a.md'), to: '/v/b.md' }])
  })

  it('nulla jelölt: eltűnt', () => {
    const report = planRelink([tracked('/v/a.md')], [], () => false)
    expect(report.missing).toEqual([tracked('/v/a.md')])
  })

  it('két jelölt: ütközés, nincs moved', () => {
    const report = planRelink([tracked('/v/a.md')], [found('/v/b.md'), found('/v/c.md')], () => false)
    expect(report.moved).toEqual([])
    expect(report.conflicts).toEqual([{ ...tracked('/v/a.md'), candidates: ['/v/b.md', '/v/c.md'] }])
  })
})

describe('noteKey', () => {
  it('recept nélküli régi jegyzetnél a fájlnév utótagja adja a fajtát', () => {
    expect(noteKey({ item_id: 'a1' }, '/v/Cím_transcript.md')).toBe('a1\u0000transcript')
    expect(noteKey({ item_id: 'a1' }, '/v/Cím_bloom-hu.md')).toBe('a1\u0000bloom-hu')
    expect(noteKey({ item_id: 'a1' }, '/v/Cím_some_title_clean-deep.md')).toBe('a1\u0000clean-deep')
  })
  it('a recept mező elsőbbséget élvez a fájlnévvel szemben', () => {
    expect(noteKey({ item_id: 'a1', recipe: 'notes-hu' }, '/v/Cím_transcript.md')).toBe('a1\u0000notes-hu')
  })
  it('item_id vagy felismerhető fajta nélkül null', () => {
    expect(noteKey({ recipe: 'notes' }, '/v/x_notes.md')).toBeNull()
    expect(noteKey({ item_id: 'a1' }, '/v/utotag-nelkul.md')).toBeNull()
  })
})

describe('findNotes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-relink-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('a pontos mappákat és a frontmatter nélkülit kihagyja', async () => {
    for (const d of ['.obsidian', '.trash', 'a/b']) await mkdir(join(dir, d), { recursive: true })
    const note = '---\nitem_id: x1\n---\ntörzs\n'
    await writeFile(join(dir, '.obsidian/x.md'), note)
    await writeFile(join(dir, '.trash/y.md'), note)
    await writeFile(join(dir, 'a/sima.md'), 'nincs frontmatter\n')
    await writeFile(join(dir, 'a/b/n_transcript.md'), note)
    const notes = await findNotes(dir)
    expect(notes.map((n) => n.path)).toEqual([join(dir, 'a/b/n_transcript.md')])
    expect(notes[0]!.fields.item_id).toBe('x1')
  })
})

describe('relinkNotes', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-relink-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('scan-módban jelent, apply-módban átírja a tárat', async () => {
    const vault = join(dir, 'vault')
    await mkdir(join(vault, 'Uj'), { recursive: true })
    await writeFile(join(vault, 'Uj/a_transcript.md'), '---\nitem_id: a1\n---\n')
    const store = openState(join(dir, 'state.db'), vault)
    store.recordItem({
      itemId: 'a1', source: 's', sourceFile: 'f', subtitlePath: '/s/f', baseName: 'f',
      title: 't', language: 'en', metadata: {},
    })
    store.recordArtifact('a1', 'transcript', 'done', join(vault, 'Regi/a_transcript.md'), null)

    expect(await relinkNotes(store, vault, false)).toEqual(['áthelyezve: Regi/a_transcript.md → Uj/a_transcript.md'])
    expect(store.artifactOf('a1', 'transcript')?.path).toBe(join(vault, 'Regi/a_transcript.md'))

    await relinkNotes(store, vault, true)
    expect(store.artifactOf('a1', 'transcript')?.path).toBe(join(vault, 'Uj/a_transcript.md'))
    expect(await relinkNotes(store, vault, true)).toEqual([])
    store.close()
  })
})
