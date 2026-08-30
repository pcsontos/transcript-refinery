import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { openState, type StateStore } from './db.js'

const item = (videoId: string): SourceItem => ({
  videoId,
  title: `Cím ${videoId}`,
  channel: 'Csatorna',
  uploadedAt: '2026-07-14',
  url: `https://www.youtube.com/watch?v=${videoId}`,
  subtitlePath: `/d/${videoId}.srt`,
  mediaPath: null,
})

let store: StateStore

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'refinery-state-'))
  store = openState(join(dir, 'state.db'))
})

afterEach(() => store.close())

describe('StateStore', () => {
  it('egy videó kétszeri rögzítése nem hoz létre duplikátumot', () => {
    store.recordVideo(item('abc'))
    store.recordVideo(item('abc'))
    expect(store.listPending([item('abc')], 'transcript')).toHaveLength(1)
  })

  it('a sikeresen kész elemet kihagyja a függőben lévők közül', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.listPending([item('abc')], 'transcript')).toEqual([])
  })

  it('a hibás elemet nem tekinti késznek, hogy újrapróbálható legyen', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'failed', null, 'nincs felirat')
    expect(store.listPending([item('abc')], 'transcript')).toHaveLength(1)
  })

  it('megkülönbözteti a soha nem próbáltat a hibásan végződőtől', () => {
    store.recordVideo(item('abc'))
    expect(store.isDone('abc', 'transcript')).toBe(false)
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('abc', 'transcript')).toBe(true)
  })

  it('a típusokat külön követi', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('abc', 'summary')).toBe(false)
  })

  it('rögzíti az átirat származását és szószámait', () => {
    store.recordVideo(item('abc'))
    store.recordTranscript('abc', 'auto', 11468, 3939)
    expect(store.transcriptOf('abc')).toEqual({
      source: 'auto',
      wordsRaw: 11468,
      wordsNormalized: 3939,
    })
  })

  it('újranyitás után is emlékszik', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    const path = store.path
    store.close()
    const again = openState(path)
    expect(again.isDone('abc', 'transcript')).toBe(true)
    again.close()
  })
})
