import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { QUEUE_HEADER, mergeQueue } from './merge.js'

function elem(itemId: string, sourceFile: string, title: string): SourceItem {
  return {
    itemId,
    source: 'feliratok',
    sourceFile,
    subtitlePath: `/nemletezo/feliratok/${sourceFile}`,
    baseName: title,
    title,
    language: 'hu',
    metadata: {},
  }
}

const RECEPTEK = ['summary', 'flashcards', 'qa']
const A1 = elem('abcDEF12345', 'csatorna-a/Elso.hu.srt', 'Első példavideó')
const A2 = elem('0123456789abcdef', 'csatorna-a/Masodik.hu.srt', 'Második példavideó')
const B1 = elem('bbbBBB22222', 'csatorna-b/Harmadik.hu.srt', 'Harmadik példavideó')

describe('mergeQueue', () => {
  it('friss sort ír: fej, csoportonként a videók, receptenként egy üres pipa', () => {
    const { text, stats } = mergeQueue(null, [A1, A2, B1], RECEPTEK)

    expect(text).toBe(
      QUEUE_HEADER +
        [
          '',
          '## feliratok/csatorna-a',
          '- Első példavideó %%abcDEF12345%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '- Második példavideó %%0123456789abcdef%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '',
          '## feliratok/csatorna-b',
          '- Harmadik példavideó %%bbbBBB22222%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '',
        ].join('\n'),
    )
    expect(stats).toEqual({ addedVideos: 3, addedRecipeLines: 0, changedMarks: 0 })
  })

  it('kétszer alkalmazva bájtra azonos, és nincs változás', () => {
    const elso = mergeQueue(null, [A1, A2, B1], RECEPTEK).text
    const masodik = mergeQueue(elso, [A1, A2, B1], RECEPTEK)

    expect(masodik.text).toBe(elso)
    expect(masodik.stats).toEqual({ addedVideos: 0, addedRecipeLines: 0, changedMarks: 0 })
  })

  it('a pipák, az utótagok, a saját sorok és a kézi sorrend érintetlen marad', () => {
    const kezi = [
      '# Saját fejléc',
      '',
      '## feliratok/csatorna-a',
      'Ezeket nézem meg először.',
      '- Második példavideó %%0123456789abcdef%%',
      '  - [x] summary — ✓ 0.97 · $0.0512',
      '  - [ ] flashcards',
      '  - [ ] qa',
      '- Első példavideó %%abcDEF12345%%',
      '\t- [X] qa',
      '  - [ ] summary',
      '  - [ ] flashcards',
      '',
      '## feliratok/csatorna-b',
      '',
    ].join('\n')
    const uj = elem('cccCCC33333', 'csatorna-a/Negyedik.hu.srt', 'Negyedik példavideó')

    const { text, stats } = mergeQueue(kezi, [A1, A2, uj], RECEPTEK)

    expect(text).toBe(
      [
        '# Saját fejléc',
        '',
        '## feliratok/csatorna-a',
        'Ezeket nézem meg először.',
        '- Második példavideó %%0123456789abcdef%%',
        '  - [x] summary — ✓ 0.97 · $0.0512',
        '  - [ ] flashcards',
        '  - [ ] qa',
        '- Első példavideó %%abcDEF12345%%',
        '\t- [X] qa',
        '  - [ ] summary',
        '  - [ ] flashcards',
        '- Negyedik példavideó %%cccCCC33333%%',
        '  - [ ] summary',
        '  - [ ] flashcards',
        '  - [ ] qa',
        '',
        '## feliratok/csatorna-b',
        '',
      ].join('\n'),
    )
    expect(stats).toEqual({ addedVideos: 1, addedRecipeLines: 0, changedMarks: 0 })
  })

  it('ismeretlen csoport a jegyzet végére kerül, üres sorral elválasztva', () => {
    const elso = mergeQueue(null, [A1], RECEPTEK).text

    const { text } = mergeQueue(elso, [A1, B1], RECEPTEK)

    expect(text).toBe(
      elso +
        [
          '',
          '## feliratok/csatorna-b',
          '- Harmadik példavideó %%bbbBBB22222%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '',
        ].join('\n'),
    )
  })

  it('az eltűnt videó jelölést kap, és a jelölés lekerül, ha visszajön', () => {
    const elso = mergeQueue(null, [A1, A2], RECEPTEK).text

    const eltunt = mergeQueue(elso, [A1], RECEPTEK)
    expect(eltunt.text).toContain(
      '- Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található\n',
    )
    expect(eltunt.stats.changedMarks).toBe(1)

    const vissza = mergeQueue(eltunt.text, [A1, A2], RECEPTEK)
    expect(vissza.text).toBe(elso)
    expect(vissza.stats.changedMarks).toBe(1)
  })

  it('a duplikátum videósora jelölést kap, és alá nem kerül receptsor', () => {
    const kezi = [
      '## feliratok/csatorna-a',
      '- Első példavideó %%abcDEF12345%%',
      '  - [ ] summary',
      '  - [ ] flashcards',
      '  - [ ] qa',
      '- Első példavideó újra %%abcDEF12345%%',
      '',
    ].join('\n')

    const { text, stats } = mergeQueue(kezi, [A1], RECEPTEK)

    expect(text).toBe(
      kezi.replace('újra %%abcDEF12345%%', 'újra %%abcDEF12345%% — ⚠ duplikátum'),
    )
    expect(stats).toEqual({ addedVideos: 0, addedRecipeLines: 0, changedMarks: 1 })
  })

  it('új recept a registryben: a meglévő videó alá, az utolsó receptsora után kerül', () => {
    const regi = mergeQueue(null, [A1], ['summary', 'qa']).text.replace(
      '  - [ ] summary',
      '  - [x] summary — ✓ 1.00',
    )

    const { text, stats } = mergeQueue(regi, [A1], ['summary', 'qa', 'flashcards'])

    expect(text).toBe(regi.replace('  - [ ] qa', '  - [ ] qa\n  - [ ] flashcards'))
    expect(stats).toEqual({ addedVideos: 0, addedRecipeLines: 1, changedMarks: 0 })
  })

  it('szögletes zárójeles cím sem sérti a vault linkszabályait', () => {
    const furcsa = elem('dddDDD44444', 'csatorna-a/Furcsa.hu.srt', 'Rész [[1]] és [link](cél)')

    const { text } = mergeQueue(null, [furcsa], RECEPTEK)

    expect(lintVaultMarkdown(text)).toEqual([])
  })
})
