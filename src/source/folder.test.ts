import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  discoverAdHoc,
  discoverAll,
  folderSource,
  queuedTextItem,
  splitSubtitleName,
  textItem,
} from './folder.js'
import { TEXT_EXTENSIONS } from './text.js'

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

  it('a nagybetűs (pl. római szám) utótagot nem tekinti nyelvkódnak', () => {
    expect(splitSubtitleName('Rész.II.srt')).toEqual({ base: 'Rész.II', language: null })
    expect(splitSubtitleName('Rész.III.srt')).toEqual({ base: 'Rész.III', language: null })
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

  it('a nagybetűs utótagú két rész két külön elem marad', async () => {
    await write('Rész.II.srt')
    await write('Rész.III.srt')
    const items = await folderSource(source(), []).discover()
    expect(items.map((i) => i.baseName).sort()).toEqual(['Rész.II', 'Rész.III'])
  })

  it('a levágott nyelv-utótaggal ellátott metaadatfájlt is megtalálja, ha a levágás nélküli nem létezik', async () => {
    // A "Videó.js" alapnév utolsó szakasza ("js") kisbetűs, két karakteres,
    // tehát a minta nyelvkódnak nézi, és az alapnevet "Videó"-ra vágja — a
    // metaadatfájl viszont a levágás nélküli névvel fekszik a felirat mellett.
    await write('Videó.js.srt')
    await write('Videó.js.info.json', JSON.stringify({ id: 'v-node' }))
    const [item] = await folderSource(source(), []).discover()
    expect(item!.metadata.videoId).toBe('v-node')
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

const SRT = '1\n00:00:00,000 --> 00:00:02,000\nEgy felirat sor.\n'
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nEgy vtt sor.\n'

describe('splitSubtitleName szöveges kiterjesztéssel', () => {
  it('a nyelvkód szabálya ugyanaz', () => {
    expect(splitSubtitleName('átirat.en.md', TEXT_EXTENSIONS)).toEqual({ base: 'átirat', language: 'en' })
    expect(splitSubtitleName('átirat.txt', TEXT_EXTENSIONS)).toEqual({ base: 'átirat', language: null })
  })

  it('alapértelmezésben a szöveg nem felirat', () => {
    expect(splitSubtitleName('átirat.md')).toBeNull()
  })
})

describe('folderSource', () => {
  it('a konfigurált forrásból nem vesz fel .txt és .md fájlt', async () => {
    await write('Cs/A.hu.srt', SRT)
    await write('Cs/README.md', '# Olvass el')
    await write('Cs/jegyzet.txt', 'szöveg')
    const items = await folderSource(source(), []).discover()
    expect(items.map((i) => i.baseName)).toEqual(['A'])
  })
})

describe('discoverAdHoc', () => {
  const x = () => join(root, 'x')

  beforeEach(async () => {
    await write('x/a.hu.srt', SRT)
    await write('x/b.hu.vtt', VTT)
    await write('x/c.hu.txt', 'Szöveg c.')
    await write('x/f.hu.md', '# F')
    await write('x/al/d.hu.md', '# D')
  })

  it('minta nélkül mind a négy fajtát felveszi, az almappából is', async () => {
    const items = await discoverAdHoc({ dir: x() }, [])
    expect(items.map((i) => i.sourceFile).sort()).toEqual(['a.hu.srt', 'al/d.hu.md', 'b.hu.vtt', 'c.hu.txt', 'f.hu.md'])
    expect(new Set(items.map((i) => i.source))).toEqual(new Set(['x']))
    const d = items.find((i) => i.baseName === 'd')!
    expect(d).toMatchObject({ format: 'text', title: 'd', language: 'hu', metadata: {}, subtitlePath: join(x(), 'al', 'd.hu.md') })
    expect(d.itemId).toMatch(/^t-[0-9a-f]{16}$/)
    expect(items.find((i) => i.baseName === 'a')!.format).toBeUndefined()
  })

  it("a / nélküli minta a fájlnévre illik, minden mélységben", async () => {
    const items = await discoverAdHoc({ dir: x(), match: '*.md' }, [])
    expect(items.map((i) => i.sourceFile).sort()).toEqual(['al/d.hu.md', 'f.hu.md'])
  })

  it('a /-t tartalmazó minta a relatív útra illik', async () => {
    const items = await discoverAdHoc({ dir: x(), match: 'al/*.md' }, [])
    expect(items.map((i) => i.sourceFile)).toEqual(['al/d.hu.md'])
  })

  it('a nem támogatott kiterjesztésre illő minta üres eredményt ad', async () => {
    await write('x/g.pdf', '%PDF')
    expect(await discoverAdHoc({ dir: x(), match: '*.pdf' }, [])).toEqual([])
  })

  it('--file: egyetlen tétel, a forrás a fájlt tartalmazó mappa', async () => {
    const items = await discoverAdHoc({ file: join(x(), 'al', 'd.hu.md') }, [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'al', sourceFile: 'd.hu.md', baseName: 'd' })
  })

  it('azonos tartalom két néven: egy tétel', async () => {
    await write('x/c-masolat.hu.txt', 'Szöveg c.')
    const items = await discoverAdHoc({ dir: x(), match: 'c*.txt' }, [])
    expect(items).toHaveLength(1)
  })

  it('átnevezés után ugyanaz az azonosító', async () => {
    const before = await textItem(join(x(), 'c.hu.txt'), { name: 'x', path: x() })
    await rename(join(x(), 'c.hu.txt'), join(x(), 'uj-nev.hu.txt'))
    const after = await textItem(join(x(), 'uj-nev.hu.txt'), { name: 'x', path: x() })
    expect(after.itemId).toBe(before.itemId)
  })

  it('a szöveges tétel címe a mellette lévő info.json-ból jön, a metaadatot nem veszi át', async () => {
    const name = 'Beszéd [t-0123456789abcdef]'
    await write(`x/${name}.txt`, 'Szöveg.')
    await write(`x/${name}.info.json`, JSON.stringify({ id: 't-0123456789abcdef', title: 'Beszéd' }))
    const item = await textItem(join(x(), `${name}.txt`), { name: 'x', path: x() })
    expect(item.title).toBe('Beszéd')
    expect(item.metadata).toEqual({})
  })

  it('info.json nélkül a szöveges tétel címe a fájlnév alapneve', async () => {
    const item = await textItem(join(x(), 'c.hu.txt'), { name: 'x', path: x() })
    expect(item.title).toBe('c')
  })

  it('az olvashatatlan fájl is tétel lesz, t- előtagú azonosítóval', async () => {
    await write('x/ures.hu.txt', '')
    const item = await textItem(join(x(), 'ures.hu.txt'), { name: 'x', path: x() })
    expect(item.itemId).toMatch(/^t-/)
    expect(item.format).toBe('text')
  })
})

describe('queuedTextItem', () => {
  it('a horgony útvonalából újraépíti a tételt', async () => {
    await write('y/átirat.hu.txt', 'Egy szöveg.')
    const path = join(root, 'y', 'átirat.hu.txt')
    const original = await textItem(path, { name: 'y', path: join(root, 'y') })
    const item = await queuedTextItem(original.itemId, path)
    expect(item).toMatchObject({ itemId: original.itemId, source: 'y', sourceFile: 'átirat.hu.txt', format: 'text' })
  })

  it('a hiányzó fájlra és a megváltozott tartalomra okot ad', async () => {
    const path = join(root, 'y', 'átirat.hu.txt')
    expect(await queuedTextItem('t-0000000000000000', path)).toBe(`nem található: ${path}`)
    await write('y/átirat.hu.txt', 'Már más szöveg.')
    expect(await queuedTextItem('t-0000000000000000', path)).toBe(
      `nem található: a fájl tartalma megváltozott a sorba vétel óta (${path})`,
    )
  })
})

describe('queuedTextItem — szélső esetek', () => {
  it('nem .txt/.md fájlra mutató horgonyra okot ad, nem dob', async () => {
    await write('y/x.pdf', '%PDF')
    const path = join(root, 'y', 'x.pdf')
    expect(await queuedTextItem('t-0000000000000000', path)).toBe(
      `nem található: nem .txt vagy .md fájl (${path})`,
    )
  })

  it('az olvashatatlan, almappából jött fájl azonosítója a sorból újraépítve is ugyanaz', async () => {
    await write('x/al/ures.hu.txt', '')
    const [item] = await discoverAdHoc({ dir: join(root, 'x') }, [])
    const rebuilt = await queuedTextItem(item!.itemId, join(root, 'x', 'al', 'ures.hu.txt'))
    expect(typeof rebuilt).not.toBe('string')
  })
})

describe('discoverAdHoc — konfigurált forrás és rejtett fájlok', () => {
  it('a konfigurált forrás almappája ugyanazt az azonosítót és forrásnevet adja, mint a sources bejárása', async () => {
    await write('Cs/A.hu.srt', SRT)
    const [fromSources] = await discoverAll([source()], [])
    const [adHoc] = await discoverAdHoc({ dir: join(root, 'Cs') }, [], [source()])
    expect(adHoc).toMatchObject({ itemId: fromSources!.itemId, source: 'youtube', sourceFile: 'Cs/A.hu.srt' })
  })

  it('a rejtett mappát és fájlt kihagyja, a ./ kezdetű minta működik', async () => {
    await write('x/.obsidian/n.hu.md', '# N')
    await write('x/node_modules/p/r.hu.md', '# R')
    await write('x/.rejtett.hu.md', '# H')
    await write('x/al/d.hu.md', '# D')
    expect((await discoverAdHoc({ dir: join(root, 'x') }, [])).map((i) => i.sourceFile)).toEqual(['al/d.hu.md'])
    const dotted = await discoverAdHoc({ dir: join(root, 'x'), match: './al/*.md' }, [])
    expect(dotted.map((i) => i.sourceFile)).toEqual(['al/d.hu.md'])
  })
})
