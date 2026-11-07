import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localAudioStore } from '../fetch/audio/store.js'
import {
  failedReason,
  listArchive,
  STATUS_LABEL,
  statusContext,
  transcriptStatus,
  type AudioEntry,
  type StatusContext,
} from './archive.js'
import type { WhisperDirs } from './paths.js'

async function put(root: string, rel: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

describe('listArchive', () => {
  it('info.json-ból cím, csatorna, hossz, dátum; info nélkül a fájlnévből', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-'))
    await put(root, 'Csat/Cím [abcdefghijk].m4a')
    await put(
      root,
      'Csat/Cím [abcdefghijk].info.json',
      JSON.stringify({ title: 'Cím', channel: 'Csat', duration: 1062, upload_date: '20260301' }),
    )
    await put(root, 'valami.hu/fajl [1a2b3c4d].mp3')
    const { entries } = await listArchive(localAudioStore(root))
    expect(entries).toMatchObject([
      { id: 'abcdefghijk', title: 'Cím', channel: 'Csat', duration: 1062, date: '2026-03-01', ext: 'm4a' },
      { id: '1a2b3c4d', title: 'fajl', channel: 'valami.hu', duration: null, date: null, info: {} },
    ])
  })

  it('podcast: a csatorna a feed mappaneve a [hash] nélkül', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-'))
    await put(root, 'Feed Címe [0f0f0f0f]/Epizód [1a2b3c4d].mp3')
    await put(root, 'Feed Címe [0f0f0f0f]/Epizód [1a2b3c4d].info.json', JSON.stringify({ title: 'Epizód' }))
    const { entries } = await listArchive(localAudioStore(root))
    expect(entries[0]).toMatchObject({ channel: 'Feed Címe', title: 'Epizód' })
  })

  it('dátum szerint csökkenő, a dátum nélküliek a végén; azonosítónként egy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-'))
    await put(root, 'C/Régi [aaaaaaaaaaa].m4a')
    await put(root, 'C/Régi [aaaaaaaaaaa].info.json', JSON.stringify({ upload_date: '20250101' }))
    await put(root, 'C/Új [bbbbbbbbbbb].m4a')
    await put(root, 'C/Új [bbbbbbbbbbb].info.json', JSON.stringify({ upload_date: '20260101' }))
    await put(root, 'C/Nincs [ccccccccccc].m4a')
    await put(root, 'D/Dup [aaaaaaaaaaa].m4a')
    const { entries } = await listArchive(localAudioStore(root))
    expect(entries.map((e) => e.id)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa', 'ccccccccccc'])
  })
})

describe('transcriptStatus', () => {
  const dirs: WhisperDirs = { root: '/w', inbox: '/w/inbox', work: '/w/work', failed: '/w/failed', heartbeat: '/w/heartbeat' }
  const entry = (id: string, ext = 'm4a'): AudioEntry => ({
    id, key: `C/t [${id}].${ext}`, ext, title: 't', channel: 'C', duration: null, date: null, info: {},
  })
  const ctx = (over: Partial<StatusContext>): StatusContext => ({
    srtIds: new Set(),
    dirs,
    dirFiles: { inbox: [], work: [], failed: [] },
    ...over,
  })

  it('sorrend és a .partial', () => {
    expect(transcriptStatus(entry('a'), ctx({ srtIds: new Set(['a']) }))).toBe('done')
    expect(transcriptStatus(entry('b'), ctx({ dirFiles: { inbox: [], work: ['b.wav'], failed: [] } }))).toBe('working')
    expect(transcriptStatus(entry('c'), ctx({ dirFiles: { inbox: ['c.m4a'], work: [], failed: [] } }))).toBe('pending')
    expect(transcriptStatus(entry('d'), ctx({ dirFiles: { inbox: ['d.m4a.partial'], work: [], failed: [] } }))).toBe('archived')
    expect(transcriptStatus(entry('e'), ctx({ dirFiles: { inbox: [], work: [], failed: ['e.m4a', 'e.log'] } }))).toBe('failed')
  })

  it('whisper-mappa nélkül csak done / archived', () => {
    expect(transcriptStatus(entry('a'), ctx({ dirs: null, srtIds: new Set(['a']) }))).toBe('done')
    expect(transcriptStatus(entry('c'), ctx({ dirs: null, dirFiles: { inbox: ['c.m4a'], work: [], failed: [] } }))).toBe('archived')
  })

  it('címkék', () => {
    expect(STATUS_LABEL).toEqual({ archived: 'archivált', pending: 'vár', working: 'átírás alatt', done: 'kész', failed: 'hibás' })
  })
})

describe('statusContext és failedReason', () => {
  it('az srt-k azonosítói, az almappák listái; hiányzó mappa üres', async () => {
    const sources = await mkdtemp(join(tmpdir(), 'sources-'))
    await put(sources, 'whisper/csat/abcdefghijk.hu.srt')
    await put(sources, 'whisper/csat/abcdefghijk.info.json')
    await put(sources, 'youtube/mas [zzzzzzzzzzz].hu.srt')
    const root = await mkdtemp(join(tmpdir(), 'whisper-'))
    await put(root, 'inbox/x.m4a')
    await put(root, 'failed/y.log', 'eleje\nffmpeg: invalid data\n\n')
    const dirs: WhisperDirs = {
      root, inbox: join(root, 'inbox'), work: join(root, 'work'), failed: join(root, 'failed'), heartbeat: join(root, 'heartbeat'),
    }
    const ctx = await statusContext(sources, dirs)
    expect([...ctx.srtIds]).toEqual(['abcdefghijk'])
    expect(ctx.dirFiles).toEqual({ inbox: ['x.m4a'], work: [], failed: ['y.log'] })
    expect(await failedReason(dirs, 'y')).toBe('ffmpeg: invalid data')
    expect(await failedReason(dirs, 'nincs')).toBeNull()
    expect((await statusContext(sources, null)).dirFiles).toEqual({ inbox: [], work: [], failed: [] })
  })
})
