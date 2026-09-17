import { describe, expect, it } from 'vitest'
import { checkCardBasics, parseCards } from './cards.js'

describe('parseCards', () => {
  it('a `##` fejléceket kártyának, az alattuk lévő szöveget hátoldalnak olvassa', () => {
    expect(parseCards('## A?\n\nVálasz A.\n\n## B?\n\nVálasz B.')).toEqual([
      { question: 'A?', body: 'Válasz A.' },
      { question: 'B?', body: 'Válasz B.' },
    ])
  })

  it('az első fejléc előtti szöveget eldobja', () => {
    expect(parseCards('Bevezető.\n\n## A?\n\nVálasz.')).toEqual([{ question: 'A?', body: 'Válasz.' }])
  })

  it('a behúzott `##`-t is kártyakezdetnek veszi, ahogy Obsidian', () => {
    expect(parseCards('  ## A?\n\nVálasz.')).toHaveLength(1)
  })

  it('az escape-elt `\\##` sort nem veszi kártyakezdetnek', () => {
    expect(parseCards('## A?\n\n\\## nem kártya')).toHaveLength(1)
  })
})

describe('checkCardBasics', () => {
  it('szabályos kártyákra nincs hiány', () => {
    expect(
      checkCardBasics([
        { question: 'A?', body: 'a' },
        { question: 'B?', body: 'b' },
      ]),
    ).toEqual([])
  })

  it('az üres hátoldalt megnevezi', () => {
    expect(checkCardBasics([{ question: 'A?', body: '' }])).toEqual([
      'The card "A?" is a heading without an answer below it.',
    ])
  })

  it('az ismétlődő kérdést kis-nagybetűtől függetlenül megfogja, és az elsőt nevezi meg', () => {
    expect(
      checkCardBasics([
        { question: 'Mi az A?', body: 'a' },
        { question: 'mi az a?', body: 'b' },
      ]),
    ).toEqual(['Two cards ask the same question: "Mi az A?". Ask about a different point instead.'])
  })

  it('előbb az üres hátoldalakat, aztán az ismétlődéseket sorolja — a flashcards mai sorrendje', () => {
    const gaps = checkCardBasics([
      { question: 'A?', body: 'a' },
      { question: 'a?', body: '' },
    ])
    expect(gaps[0]).toMatch(/without an answer/)
    expect(gaps[1]).toMatch(/same question/)
  })
})
