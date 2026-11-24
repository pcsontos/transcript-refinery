import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { notePlacement, transcriptBase } from './pinned-base.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pinned-base-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (dir: string, name: string, itemId: string, quoted = false): string => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `---\nitem_id: ${quoted ? `'${itemId}'` : itemId}\n---\n\nszöveg\n`)
  return path
}

describe('transcriptBase', () => {
  it('egy találat: az átirat alapneve', () => {
    write(root, 'Régi_cím_transcript.md', 'a1')
    expect(transcriptBase(root, 'a1')).toBe('Régi_cím')
  })

  it('más tétel átirata nem számít', () => {
    write(root, 'Régi_cím_transcript.md', 'a1')
    expect(transcriptBase(root, 'b2')).toBeNull()
  })

  it('nincs mappa: null', () => {
    expect(transcriptBase('/nincs/ilyen', 'a1')).toBeNull()
  })

  it('idézett item_id is találat', () => {
    write(root, 'Régi_cím_transcript.md', '-QFHIoCo-Ko', true)
    expect(transcriptBase(root, '-QFHIoCo-Ko')).toBe('Régi_cím')
  })

  it('több találatnál a régebbi nyer', () => {
    const b = write(root, 'B_transcript.md', 'a1')
    const a = write(root, 'A_transcript.md', 'a1')
    utimesSync(b, new Date('2020-01-01'), new Date('2020-01-01'))
    utimesSync(a, new Date('2025-01-01'), new Date('2025-01-01'))
    expect(transcriptBase(root, 'a1')).toBe('B')
  })

  it('több találatnál a mai alapnévtől eltérő nyer, a fájlidőtől függetlenül', () => {
    const regi = write(root, 'Full_Walkthrough_transcript.md', '-QFHIoCo-Ko', true)
    const uj = write(root, '-QFHIoCo-Ko_transcript.md', '-QFHIoCo-Ko', true)
    // Azonos idő (git-klón), majd a régi az újabb (--force újraírta).
    const t = new Date('2026-01-01')
    utimesSync(regi, t, t)
    utimesSync(uj, t, t)
    expect(transcriptBase(root, '-QFHIoCo-Ko', '-QFHIoCo-Ko')).toBe('Full_Walkthrough')
    utimesSync(regi, new Date('2026-11-24'), new Date('2026-11-24'))
    expect(transcriptBase(root, '-QFHIoCo-Ko', '-QFHIoCo-Ko')).toBe('Full_Walkthrough')
  })

  it('egyetlen találat a mai alapnéven is az marad', () => {
    write(root, 'a1_transcript.md', 'a1')
    expect(transcriptBase(root, 'a1', 'a1')).toBe('a1')
  })
})

describe('notePlacement', () => {
  const item: SourceItem = {
    itemId: 'a1',
    source: 'yt',
    sourceFile: 'a1.srt',
    subtitlePath: '/s/a1.srt',
    baseName: 'a1',
    title: 'T',
    language: 'en',
    metadata: {},
  }

  it('pinnedDir nélkül a sablon szerinti mappában keres', () => {
    write(join(root, 'yt', 'a1'), 'Régi_transcript.md', 'a1')
    expect(notePlacement(root, item, '{item_id}', null)).toEqual({
      layout: '{item_id}',
      pinnedDir: null,
      pinnedBase: 'Régi',
    })
  })

  it('találat nélkül a pinnedBase nincs megadva', () => {
    expect(notePlacement(root, item, '{item_id}', null).pinnedBase).toBeUndefined()
  })
})
