import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { folderSource } from './folder.js'

let root: string

async function makeVideo(
  channelDir: string,
  base: string,
  info: Record<string, unknown>,
  extras: { srt?: boolean; vtt?: boolean; mp4?: boolean } = { srt: true },
): Promise<void> {
  const dir = join(root, 'youtube', channelDir)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${base}.info.json`), JSON.stringify(info), 'utf8')
  if (extras.srt) await writeFile(join(dir, `${base}.en.srt`), '', 'utf8')
  if (extras.vtt) await writeFile(join(dir, `${base}.hu.vtt`), '', 'utf8')
  if (extras.mp4) await writeFile(join(dir, `${base}.mp4`), '', 'utf8')
}

const INFO = {
  id: 'q6p-_W6_VoM',
  title: 'Agent Orchestration',
  channel: 'Burke Holland',
  upload_date: '20260714',
  webpage_url: 'https://www.youtube.com/watch?v=q6p-_W6_VoM',
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-source-'))
})

describe('folderSource', () => {
  it('a metaadatot az .info.json-ból veszi, nem a mappanévből', async () => {
    await makeVideo('Burke_Holland', 'Agent Orchestration', INFO)
    const [item] = await folderSource(root).discover()
    expect(item!.videoId).toBe('q6p-_W6_VoM')
    expect(item!.channel).toBe('Burke Holland')
    expect(item!.title).toBe('Agent Orchestration')
  })

  it('a feltöltési dátumot ISO alakra hozza', async () => {
    await makeVideo('Burke_Holland', 'Agent Orchestration', INFO)
    const [item] = await folderSource(root).discover()
    expect(item!.uploadedAt).toBe('2026-07-14')
  })

  it('megtalálja az azonos alapnevű feliratot', async () => {
    await makeVideo('Burke_Holland', 'Agent Orchestration', INFO)
    const [item] = await folderSource(root).discover()
    expect(item!.subtitlePath.endsWith('Agent Orchestration.en.srt')).toBe(true)
  })

  it('a .vtt feliratot is elfogadja', async () => {
    await makeVideo('C', 'V', INFO, { vtt: true })
    const [item] = await folderSource(root).discover()
    expect(item!.subtitlePath.endsWith('.vtt')).toBe(true)
  })

  it('rögzíti a médiafájl útvonalát, ha van', async () => {
    await makeVideo('C', 'V', INFO, { srt: true, mp4: true })
    const [item] = await folderSource(root).discover()
    expect(item!.mediaPath).not.toBeNull()
  })

  it('kihagyja a felirat nélküli videót', async () => {
    await makeVideo('C', 'V', INFO, {})
    expect(await folderSource(root).discover()).toEqual([])
  })

  it('a uploader mezőre esik vissza, ha nincs channel', async () => {
    const { channel: _drop, ...rest } = INFO
    await makeVideo('C', 'V', { ...rest, uploader: 'Feltöltő' })
    const [item] = await folderSource(root).discover()
    expect(item!.channel).toBe('Feltöltő')
  })

  it('átugorja az értelmezhetetlen .info.json fájlt, nem áll le', async () => {
    await mkdir(join(root, 'youtube', 'C'), { recursive: true })
    await writeFile(join(root, 'youtube', 'C', 'rossz.info.json'), '{', 'utf8')
    await writeFile(join(root, 'youtube', 'C', 'rossz.en.srt'), '', 'utf8')
    await makeVideo('C', 'jo', INFO)
    expect(await folderSource(root).discover()).toHaveLength(1)
  })

  it('nem létező gyökérre üres listát ad', async () => {
    expect(await folderSource(join(root, 'nincs')).discover()).toEqual([])
  })
})
