import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { discoverAll, folderSource, splitSubtitleName } from './folder.js'

let root: string

const source = () => ({ name: 'youtube', path: root })

async function write(relPath: string, content = ''): Promise<void> {
  const full = join(root, relPath)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-source-'))
})

describe('splitSubtitleName', () => {
  it('levágja a nyelvi utótagot és a kiterjesztést', () => {
    expect(splitSubtitleName('Beszéd.en.srt')).toEqual({ base: 'Beszéd', language: 'en' })
  })

  it('a régiós nyelvkódot is felismeri', () => {
    expect(splitSubtitleName('Beszéd.en-US.vtt')).toEqual({ base: 'Beszéd', language: 'en-US' })
  })

  it('nyelvi utótag nélkül az egész név az alapnév', () => {
    expect(splitSubtitleName('Beszéd.srt')).toEqual({ base: 'Beszéd', language: null })
  })

  it('a nem nyelvkódnak látszó utótagot nem vágja le', () => {
    expect(splitSubtitleName('Some.Talk.srt')).toEqual({ base: 'Some.Talk', language: null })
  })

  it('a korpuszban előforduló dupla pontot is helyesen kezeli', () => {
    expect(splitSubtitleName('A_jovo_fai..en.srt')).toEqual({
      base: 'A_jovo_fai.',
      language: 'en',
    })
  })

  it('nem feliratfájlra null-t ad', () => {
    expect(splitSubtitleName('video.mp4')).toBeNull()
    expect(splitSubtitleName('video.info.json')).toBeNull()
  })
})

describe('folderSource', () => {
  it('metaadatfájl nélküli feliratot is felszed', async () => {
    await write('csatorna/Beszéd.en.srt')
    const [item] = await folderSource(source(), []).discover()
    expect(item!.title).toBe('Beszéd')
    expect(item!.baseName).toBe('Beszéd')
    expect(item!.source).toBe('youtube')
    expect(item!.sourceFile).toBe('csatorna/Beszéd.en.srt')
    expect(item!.metadata).toEqual({})
  })

  it('a metaadatfájlt a felirat mellől veszi', async () => {
    await write('csatorna/Beszéd.en.srt')
    await write(
      'csatorna/Beszéd.info.json',
      JSON.stringify({ id: 'q6p', title: 'Agent Orchestration', channel: 'Burke Holland' }),
    )
    const [item] = await folderSource(source(), []).discover()
    expect(item!.itemId).toBe('q6p')
    expect(item!.title).toBe('Agent Orchestration')
    expect(item!.metadata.channel).toBe('Burke Holland')
  })

  it('a nyelvi preferencia dönt, ha több felirat van', async () => {
    await write('Beszéd.en.srt')
    await write('Beszéd.hu.vtt')
    const [item] = await folderSource(source(), ['hu', 'en']).discover()
    expect(item!.subtitlePath.endsWith('Beszéd.hu.vtt')).toBe(true)
  })

  it('egy alapnévhez akkor is egy elem tartozik, ha három felirat van', async () => {
    await write('Beszéd.en.srt')
    await write('Beszéd.hu.vtt')
    await write('Beszéd.de.vtt')
    expect(await folderSource(source(), ['hu']).discover()).toHaveLength(1)
  })

  it('preferált nyelv híján az .srt nyer a .vtt ellen', async () => {
    await write('Beszéd.de.vtt')
    await write('Beszéd.fr.srt')
    const [item] = await folderSource(source(), ['hu', 'en']).discover()
    expect(item!.subtitlePath.endsWith('Beszéd.fr.srt')).toBe(true)
  })

  it('ugyanazt választja két egymást követő futásban', async () => {
    await write('Beszéd.de.vtt')
    await write('Beszéd.fr.vtt')
    const first = await folderSource(source(), []).discover()
    const second = await folderSource(source(), []).discover()
    expect(first[0]!.subtitlePath.endsWith('Beszéd.de.vtt')).toBe(true)
    expect(first[0]!.subtitlePath).toBe(second[0]!.subtitlePath)
  })

  it('az azonosítót a nyelvváltás nem billenti meg', async () => {
    await write('Beszéd.en.srt')
    const before = (await folderSource(source(), []).discover())[0]!.itemId
    await write('Beszéd.hu.vtt')
    const after = (await folderSource(source(), ['hu']).discover())[0]!.itemId
    expect(after).toBe(before)
  })

  it('a sérült metaadatfájl nem ejti ki az elemet', async () => {
    await write('Beszéd.en.srt')
    await write('Beszéd.info.json', '{ ez nem json')
    const [item] = await folderSource(source(), []).discover()
    expect(item!.title).toBe('Beszéd')
  })

  it('a médiafájlokat és a metaadatfájlokat nem tekinti elemnek', async () => {
    await write('Beszéd.mp4')
    await write('Beszéd.info.json', '{}')
    expect(await folderSource(source(), []).discover()).toHaveLength(0)
  })

  it('nem létező forrásmappára üres listát ad', async () => {
    const items = await folderSource({ name: 'nincs', path: join(root, 'nincs') }, []).discover()
    expect(items).toEqual([])
  })

  it('rögzített sorrendben adja vissza az elemeket', async () => {
    await write('b/Második.en.srt')
    await write('a/Első.en.srt')
    const items = await folderSource(source(), []).discover()
    expect(items.map((i) => i.sourceFile)).toEqual(['a/Első.en.srt', 'b/Második.en.srt'])
  })
})

describe('discoverAll', () => {
  it('minden forrást bejár, és megjelöli, melyikből jött', async () => {
    await write('egy/A.en.srt')
    await mkdir(join(root, 'masodik'), { recursive: true })
    await writeFile(join(root, 'masodik', 'B.en.srt'), '', 'utf8')
    const items = await discoverAll(
      [
        { name: 'egy', path: join(root, 'egy') },
        { name: 'masodik', path: join(root, 'masodik') },
      ],
      [],
    )
    expect(items.map((i) => `${i.source}/${i.baseName}`)).toEqual(['egy/A', 'masodik/B'])
  })

  it('az azonos azonosítójú elemet nem veszi fel kétszer', async () => {
    const info = JSON.stringify({ id: 'ugyanaz' })
    await write('egy/A.en.srt')
    await write('egy/A.info.json', info)
    await write('ketto/A.en.srt')
    await write('ketto/A.info.json', info)
    const items = await discoverAll(
      [
        { name: 'egy', path: join(root, 'egy') },
        { name: 'ketto', path: join(root, 'ketto') },
      ],
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.source).toBe('egy')
  })
})
