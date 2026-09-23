import { describe, expect, it } from 'vitest'
import type { LanguageTag } from '../lang/identify.js'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import type { QueueLayout } from './layout.js'
import { QUEUE_HEADER, mergeQueue } from './merge.js'
import { renumberQueue } from './renumber.js'

function elem(
  itemId: string,
  sourceFile: string,
  title: string,
  language: string | null = 'en',
): SourceItem {
  return {
    itemId,
    source: 'feliratok',
    sourceFile,
    subtitlePath: `/nemletezo/feliratok/${sourceFile}`,
    baseName: title,
    title,
    language,
    metadata: {},
  }
}

const layout = (
  recipes: string[],
  translations: [string, LanguageTag][] = [],
): QueueLayout => ({ recipes, translations: new Map(translations) })

const ALAP = layout(['summary', 'flashcards', 'qa'])
const FORDITASSAL = layout(['summary', 'flashcards', 'qa'], [['summary', 'hu']])
const NULLA = { addedVideos: 0, addedRecipeLines: 0, removedTranslationLines: 0, changedMarks: 0 }

const A1 = elem('abcDEF12345', 'csatorna-a/Elso.en.srt', 'Első példavideó')
const A2 = elem('0123456789abcdef', 'csatorna-a/Masodik.en.srt', 'Második példavideó')
const B1 = elem('bbbBBB22222', 'csatorna-b/Harmadik.en.srt', 'Harmadik példavideó')

describe('mergeQueue', () => {
  it('friss sort ír: fej, csoportonként a videók, receptenként egy üres pipa, 0-s sorszámmal', () => {
    const { text, stats } = mergeQueue(null, [A1, A2, B1], ALAP)

    expect(text).toBe(
      QUEUE_HEADER +
        [
          '',
          '## 0. feliratok/csatorna-a',
          '### 0. Első példavideó %%abcDEF12345%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '### 0. Második példavideó %%0123456789abcdef%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '',
          '## 0. feliratok/csatorna-b',
          '### 0. Harmadik példavideó %%bbbBBB22222%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '',
        ].join('\n'),
    )
    expect(stats).toEqual({ ...NULLA, addedVideos: 3 })
  })

  it('az újraszámozott sorra újra alkalmazva bájtra azonos, és nincs változás', () => {
    const elso = renumberQueue(mergeQueue(null, [A1, A2, B1], FORDITASSAL).text)
    const masodik = mergeQueue(elso, [A1, A2, B1], FORDITASSAL)

    expect(masodik.text).toBe(elso)
    expect(masodik.stats).toEqual(NULLA)
  })

  it('a pipák, az utótagok, a saját sorok és a kézi sorrend érintetlen marad', () => {
    const kezi = [
      '# Saját fejléc',
      '',
      '## 1. feliratok/csatorna-a',
      'Ezeket nézem meg először.',
      '### 1. Második példavideó %%0123456789abcdef%%',
      '- [x] summary — ✓ 0.97 · $0.0512',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Első példavideó %%abcDEF12345%%',
      '- [X] qa',
      '- [ ] summary',
      '- [ ] flashcards',
      '',
      '## 2. feliratok/csatorna-b',
      '',
    ].join('\n')
    const uj = elem('cccCCC33333', 'csatorna-a/Negyedik.en.srt', 'Negyedik példavideó')

    const { text, stats } = mergeQueue(kezi, [A1, A2, uj], ALAP)

    expect(text).toBe(
      kezi.replace(
        '- [ ] flashcards\n\n## 2.',
        '- [ ] flashcards\n### 0. Negyedik példavideó %%cccCCC33333%%\n' +
          '- [ ] summary\n- [ ] flashcards\n- [ ] qa\n\n## 2.',
      ),
    )
    expect(stats).toEqual({ ...NULLA, addedVideos: 1 })
  })

  it('ismeretlen csoport a jegyzet végére kerül, üres sorral elválasztva', () => {
    const elso = mergeQueue(null, [A1], ALAP).text

    const { text } = mergeQueue(elso, [A1, B1], ALAP)

    expect(text).toBe(
      elso +
        [
          '',
          '## 0. feliratok/csatorna-b',
          '### 0. Harmadik példavideó %%bbbBBB22222%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '',
        ].join('\n'),
    )
  })

  it('az eltűnt videó a fejlécén kap jelölést, és a jelölés lekerül, ha visszajön', () => {
    const elso = mergeQueue(null, [A1, A2], ALAP).text

    const eltunt = mergeQueue(elso, [A1], ALAP)
    expect(eltunt.text).toContain(
      '### 0. Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található\n',
    )
    expect(eltunt.stats.changedMarks).toBe(1)

    const vissza = mergeQueue(eltunt.text, [A1, A2], ALAP)
    expect(vissza.text).toBe(elso)
    expect(vissza.stats.changedMarks).toBe(1)
  })

  it('a duplikátum fejléce jelölést kap, és alá nem kerül receptsor', () => {
    const kezi = [
      '## 1. feliratok/csatorna-a',
      '### 1. Első példavideó %%abcDEF12345%%',
      '- [ ] summary',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Első példavideó újra %%abcDEF12345%%',
      '',
    ].join('\n')

    const { text, stats } = mergeQueue(kezi, [A1], ALAP)

    expect(text).toBe(
      kezi.replace('újra %%abcDEF12345%%', 'újra %%abcDEF12345%% — ⚠ duplikátum'),
    )
    expect(stats).toEqual({ ...NULLA, changedMarks: 1 })
  })

  it('új recept a regiszterben: a meglévő videó alá, az utolsó receptsora után kerül', () => {
    const regi = mergeQueue(null, [A1], layout(['summary', 'qa'])).text.replace(
      '- [ ] summary',
      '- [x] summary — ✓ 1.00',
    )

    const { text, stats } = mergeQueue(regi, [A1], layout(['summary', 'qa', 'flashcards']))

    expect(text).toBe(regi.replace('- [ ] qa', '- [ ] qa\n- [ ] flashcards'))
    expect(stats).toEqual({ ...NULLA, addedRecipeLines: 1 })
  })

  it('szögletes zárójeles cím sem sérti a vault linkszabályait', () => {
    const furcsa = elem('dddDDD44444', 'csatorna-a/Furcsa.en.srt', 'Rész [[1]] és [link](cél)')

    const { text } = mergeQueue(null, [furcsa], ALAP)

    expect(lintVaultMarkdown(text)).toEqual([])
  })
})

describe('mergeQueue — fordítások', () => {
  it('a fordítássor a forrásrecept alá kerül', () => {
    const { text } = mergeQueue(null, [A1], FORDITASSAL)

    expect(text).toContain(
      '### 0. Első példavideó %%abcDEF12345%%\n- [ ] summary\n  - [ ] hu\n- [ ] flashcards\n- [ ] qa\n',
    )
  })

  it('célnyelvű videó alá nem kerül fordítássor — a címke változataira sem', () => {
    for (const language of ['hu', 'hu-HU', 'HU']) {
      const magyar = elem('hhhHHH55555', 'csatorna-a/Magyar.srt', 'Magyar videó', language)
      expect(mergeQueue(null, [magyar], FORDITASSAL).text).not.toContain('  - [ ] hu')
    }
  })

  it('ismeretlen nyelvű videó alá kerül fordítássor', () => {
    const ismeretlen = elem('nnnNNN66666', 'csatorna-a/Ismeretlen.srt', 'Ismeretlen', null)
    expect(mergeQueue(null, [ismeretlen], FORDITASSAL).text).toContain('- [ ] summary\n  - [ ] hu\n')
  })

  it('meglévő videó: a hiányzó fordítássor közvetlenül a forrásrecept alá kerül', () => {
    const regi = mergeQueue(null, [A1], ALAP).text.replace('- [ ] summary', '- [x] summary — ✓ 1.00')

    const { text, stats } = mergeQueue(regi, [A1], FORDITASSAL)

    expect(text).toBe(regi.replace('- [x] summary — ✓ 1.00', '- [x] summary — ✓ 1.00\n  - [ ] hu'))
    expect(stats).toEqual({ ...NULLA, addedRecipeLines: 1 })
  })

  it('a meglévő recept fordítása előbb jön, mint a hiányzó recept a blokk végén', () => {
    const kezi = ['## 1. feliratok/csatorna-a', '### 1. Első példavideó %%abcDEF12345%%', '- [ ] qa', ''].join(
      '\n',
    )
    const ketto = layout(['summary', 'qa'], [
      ['summary', 'hu'],
      ['qa', 'hu'],
    ])

    const { text, stats } = mergeQueue(kezi, [A1], ketto)

    expect(text).toBe(
      kezi.replace('- [ ] qa', '- [ ] qa\n  - [ ] hu\n- [ ] summary\n  - [ ] hu'),
    )
    expect(stats).toEqual({ ...NULLA, addedRecipeLines: 3 })
  })

  it('célnyelvű videó alól minden ilyen nyelvű fordítássor törlődik, a pipált és az utótagos is', () => {
    const magyar = elem('hhhHHH55555', 'csatorna-a/Magyar.srt', 'Magyar videó', 'hu')
    const kezi = [
      '## 1. feliratok/csatorna-a',
      '### 1. Magyar videó %%hhhHHH55555%%',
      '- [x] summary — ✓ 0.95',
      '  - [x] hu — ✓ 0.90 · [jegyzet](<a/b_summary-hu.md>)',
      '- [ ] flashcards',
      '- [ ] qa',
      '  - [ ] hu',
      '',
    ].join('\n')

    const { text, stats } = mergeQueue(kezi, [magyar], FORDITASSAL)

    expect(text).toBe(
      [
        '## 1. feliratok/csatorna-a',
        '### 1. Magyar videó %%hhhHHH55555%%',
        '- [x] summary — ✓ 0.95',
        '- [ ] flashcards',
        '- [ ] qa',
        '',
      ].join('\n'),
    )
    expect(stats).toEqual({ ...NULLA, removedTranslationLines: 2 })
    expect(mergeQueue(text, [magyar], FORDITASSAL).text).toBe(text)
  })

  it('a nem talált és az ismeretlen nyelvű videó fordítássoraihoz nem nyúl', () => {
    const kezi = [
      '## 1. feliratok/csatorna-a',
      '### 1. Eltűnt videó %%eltunt00001%%',
      '- [ ] summary',
      '  - [x] hu',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Ismeretlen %%nnnNNN66666%%',
      '- [ ] summary',
      '  - [x] hu',
      '- [ ] flashcards',
      '- [ ] qa',
      '',
    ].join('\n')
    const ismeretlen = elem('nnnNNN66666', 'csatorna-a/Ismeretlen.srt', 'Ismeretlen', null)

    const { text, stats } = mergeQueue(kezi, [ismeretlen], FORDITASSAL)

    expect(text).toBe(
      kezi.replace('%%eltunt00001%%', '%%eltunt00001%% — ⚠ a felirat nem található'),
    )
    expect(stats).toEqual({ ...NULLA, changedMarks: 1 })
  })
})
