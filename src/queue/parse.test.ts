import { describe, expect, it } from 'vitest'
import { checkedPairs, parseQueue } from './parse.js'

const JEGYZET = [
  '# Feldolgozási sor',
  '',
  '  - [x] summary',
  '## feliratok/csatorna-a',
  '- Első példavideó %%abcDEF12345%%',
  '  - [x] summary — ✓ 0.97 · $0.0512',
  '  - [ ] flashcards',
  '\t- [X] qa',
  'Saját megjegyzés.',
  '- Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található',
  '  - [x] summary',
  '',
  '## feliratok/csatorna-b',
  '- Első példavideó másolata %%abcDEF12345%%',
  '  - [x] summary',
  '',
].join('\n')

describe('parseQueue', () => {
  it('a sorokat bájtra visszaadja', () => {
    expect(parseQueue(JEGYZET).lines.join('\n')).toBe(JEGYZET)
  })

  it('a fejléceket a soruk indexével adja', () => {
    expect(parseQueue(JEGYZET).headings).toEqual([
      { line: 3, key: 'feliratok/csatorna-a' },
      { line: 12, key: 'feliratok/csatorna-b' },
    ])
  })

  it('a receptsort a legközelebbi megelőző videósorhoz köti; videósor előtt saját sor', () => {
    const { videos } = parseQueue(JEGYZET)
    expect(videos.map((v) => [v.itemId, v.line, v.recipes.map((r) => r.recipeId)])).toEqual([
      ['abcDEF12345', 4, ['summary', 'flashcards', 'qa']],
      ['0123456789abcdef', 9, ['summary']],
      ['abcDEF12345', 13, ['summary']],
    ])
  })

  it('az azonosító második előfordulását duplikátumnak jelöli', () => {
    expect(parseQueue(JEGYZET).videos.map((v) => v.duplicate)).toEqual([false, false, true])
  })
})

describe('checkedPairs', () => {
  it('a kipipált párokat a jegyzet sorrendjében adja, a duplikátum-blokk nélkül', () => {
    expect(checkedPairs(parseQueue(JEGYZET))).toEqual([
      { itemId: 'abcDEF12345', recipeId: 'summary' },
      { itemId: 'abcDEF12345', recipeId: 'qa' },
      { itemId: '0123456789abcdef', recipeId: 'summary' },
    ])
  })
})
