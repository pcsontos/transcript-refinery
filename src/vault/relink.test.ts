import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findNotes, noteKey, planRelink, type FoundNote, type Tracked } from './relink.js'

const tracked = (path: string): Tracked => ({ itemId: 'a1', kind: 'transcript', path })
const found = (path: string, fields: Record<string, unknown> = { item_id: 'a1' }): FoundNote => ({
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
  it('recept nélkül átirat', () => {
    expect(noteKey({ item_id: 'a1' })).toBe('a1\u0000transcript')
  })
  it('a fordítás recept mezője a teljes fajta', () => {
    expect(noteKey({ item_id: 'a1', recipe: 'notes-hu', translation_of: 'notes', language: 'hu' })).toBe(
      'a1\u0000notes-hu',
    )
  })
  it('item_id nélkül null', () => {
    expect(noteKey({ recipe: 'notes' })).toBeNull()
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
    await writeFile(join(dir, 'a/b/n.md'), note)
    const notes = await findNotes(dir)
    expect(notes.map((n) => n.path)).toEqual([join(dir, 'a/b/n.md')])
    expect(notes[0]!.fields.item_id).toBe('x1')
  })
})
