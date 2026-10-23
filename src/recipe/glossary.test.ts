import { describe, expect, it } from 'vitest'
import {
  GLOSSARY_SEPARATOR,
  addedPairs,
  appendGlossaryRows,
  mergeGlossary,
  parseChunkReply,
  readGlossaryTable,
} from './glossary.js'

const S = GLOSSARY_SEPARATOR

describe('parseChunkReply', () => {
  it('a fordítást és az új párokat szétbontja', () => {
    expect(parseChunkReply(`## Cím\n\nSzöveg.\n${S}\nstream | adatfolyam\nAPI | API\n`)).toEqual({
      translation: '## Cím\n\nSzöveg.',
      pairs: [
        { source: 'stream', target: 'adatfolyam' },
        { source: 'API', target: 'API' },
      ],
    })
  })

  it('az elválasztó sor körüli szóköz megengedett, új pár nélkül is érvényes', () => {
    expect(parseChunkReply(`Szöveg.\n  ${S}  \n`)).toEqual({ translation: 'Szöveg.', pairs: [] })
  })

  it('az escape-elt | a cellán belüli jel, a szélső | elhagyható', () => {
    expect(parseChunkReply(`x\n${S}\na \\| b | c\n| x | y |`)?.pairs).toEqual([
      { source: 'a | b', target: 'c' },
      { source: 'x', target: 'y' },
    ])
  })

  it('a | nélküli sort, a tábla elválasztó- és fejlécsorát kihagyja, a felsorolásjelet leveszi', () => {
    const reply = [
      'Szöveg.',
      S,
      '(none)',
      'No new terms.',
      '| source term | Hungarian term |',
      '|---|---|',
      '- stream | adatfolyam',
      '* API | API',
    ].join('\n')
    expect(parseChunkReply(reply)).toEqual({
      translation: 'Szöveg.',
      pairs: [
        { source: 'stream', target: 'adatfolyam' },
        { source: 'API', target: 'API' },
      ],
    })
  })

  it.each([
    ['elválasztó nélkül', 'Szöveg.'],
    ['két elválasztóval', `a\n${S}\nb | c\n${S}\nd | e`],
    ['üres fordítással', `\n${S}\na | b`],
    ['három cella', `a\n${S}\na | b | c`],
    ['elválasztó sor mint cella', `a\n${S}\na | ---`],
  ])('hibás válasz: %s', (_, reply) => {
    expect(parseChunkReply(reply)).toBeNull()
  })
})

describe('mergeGlossary', () => {
  it('kis-nagybetűtől függetlenül, az első fordítás marad', () => {
    expect(
      mergeGlossary(
        [{ source: 'Stream', target: 'adatfolyam' }],
        [
          { source: 'stream', target: 'folyam' },
          { source: 'API', target: 'API' },
          { source: 'api', target: 'x' },
        ],
      ),
    ).toEqual([
      { source: 'Stream', target: 'adatfolyam' },
      { source: 'API', target: 'API' },
    ])
  })
})

describe('addedPairs', () => {
  it('csak a még ismeretlen forrásúakat adja', () => {
    expect(
      addedPairs(
        [{ source: 'Stream', target: 'a' }],
        [
          { source: 'stream', target: 'a' },
          { source: 'tool', target: 'eszköz' },
        ],
      ),
    ).toEqual([{ source: 'tool', target: 'eszköz' }])
  })
})

describe('readGlossaryTable', () => {
  it('csak a táblák sorait olvassa, a próza és a kódkerítés nem számít', () => {
    const md =
      '# Cím\n\nKézi megjegyzés.\n\n| forrás | cél |\n|---|---|\n| stream | adatfolyam |\n| a | b | c |\n| tool | eszköz |\n\n```\n| kód | nem |\n```\n'
    expect(readGlossaryTable(md)).toEqual({
      pairs: [
        { source: 'stream', target: 'adatfolyam' },
        { source: 'tool', target: 'eszköz' },
      ],
      skipped: 1,
    })
  })
})

describe('appendGlossaryRows', () => {
  const cd = [{ source: 'c', target: 'd' }]

  it('az új sor a tábla végére kerül, a többi betűre marad', () => {
    expect(
      appendGlossaryRows('előtte\n\n| forrás | cél |\n|---|---|\n| a | b |\n\nutána kézzel\n', cd),
    ).toBe('előtte\n\n| forrás | cél |\n|---|---|\n| a | b |\n| c | d |\n\nutána kézzel\n')
  })

  it('tábla nélkül a végére egy újat fűz', () => {
    expect(appendGlossaryRows('csak próza\n', cd)).toBe('csak próza\n\n| forrás | cél |\n|---|---|\n| c | d |\n')
  })

  it('üres párlistánál betűre változatlan', () => {
    const md = 'x\n\n\n'
    expect(appendGlossaryRows(md, [])).toBe(md)
  })
})
