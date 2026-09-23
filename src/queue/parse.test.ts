import { describe, expect, it } from 'vitest'
import { checkedPairs, parseQueue } from './parse.js'

const JEGYZET = [
  '# Feldolgozási sor',
  '',
  '- [x] summary',
  '## 1. feliratok/csatorna-a',
  '### 1. Első példavideó %%abcDEF12345%%',
  '  - [x] hu',
  '- [x] summary — ✓ 0.97 · $0.0512',
  '  - [x] hu — ✓ 0.90 · $0.0100',
  '- [ ] flashcards',
  '- [X] qa',
  'Saját megjegyzés.',
  '  - [ ] hu',
  '### 2. Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található',
  '- [x] summary',
  '',
  '## 2. feliratok/csatorna-b',
  '- [x] qa',
  '### 1. Első példavideó másolata %%abcDEF12345%%',
  '- [x] summary',
  '  - [x] hu',
  '',
].join('\n')

describe('parseQueue', () => {
  it('a sorokat bájtra visszaadja', () => {
    expect(parseQueue(JEGYZET).lines.join('\n')).toBe(JEGYZET)
  })

  it('a fejléceket a soruk indexével és a sorszám nélküli kulccsal adja', () => {
    expect(parseQueue(JEGYZET).headings).toEqual([
      { line: 3, key: 'feliratok/csatorna-a' },
      { line: 15, key: 'feliratok/csatorna-b' },
    ])
  })

  it('a receptsort a videóhoz köti; videó előtt és fejléc után, videó előtt saját sor', () => {
    const { videos } = parseQueue(JEGYZET)
    expect(videos.map((v) => [v.itemId, v.line, v.recipes.map((r) => r.recipeId)])).toEqual([
      ['abcDEF12345', 4, ['summary', 'flashcards', 'qa']],
      ['0123456789abcdef', 12, ['summary']],
      ['abcDEF12345', 17, ['summary']],
    ])
    expect(videos[0]!.head).toBe('### 1. Első példavideó %%abcDEF12345%%')
  })

  it('a fordítássort a legközelebbi megelőző recepthez köti; recept előtt saját sor', () => {
    const [elso] = parseQueue(JEGYZET).videos
    expect(elso!.recipes.map((r) => r.translations)).toEqual([
      [{ line: 7, lang: 'hu', checked: true, head: '  - [x] hu', suffix: ' — ✓ 0.90 · $0.0100' }],
      [],
      [{ line: 11, lang: 'hu', checked: false, head: '  - [ ] hu', suffix: '' }],
    ])
  })

  it('az azonosító második előfordulását duplikátumnak jelöli', () => {
    expect(parseQueue(JEGYZET).videos.map((v) => v.duplicate)).toEqual([false, false, true])
  })
})

describe('checkedPairs', () => {
  it('a kipipált párokat a jegyzet sorrendjében adja, a fordítást <recept>-<nyelv> párként, duplikátum nélkül', () => {
    expect(checkedPairs(parseQueue(JEGYZET))).toEqual([
      { itemId: 'abcDEF12345', recipeId: 'summary' },
      { itemId: 'abcDEF12345', recipeId: 'summary-hu' },
      { itemId: 'abcDEF12345', recipeId: 'qa' },
      { itemId: '0123456789abcdef', recipeId: 'summary' },
    ])
  })
})

describe('saját, számozatlan fejléc', () => {
  const SAJAT = [
    '# Feldolgozási sor',
    '',
    '## 1. feliratok/csatorna-a',
    '### 1. Első példavideó %%abcDEF12345%%',
    '- [ ] summary',
    '',
    '## Jegyzetek',
    '- [x] teendő valami',
    '  - [x] hu',
    '### Megjegyzés',
    '- [x] még egy teendő',
    '',
  ].join('\n')

  it('nem csoport, és megszakítja a láncot: alatta semmi nem kötődik a videóhoz', () => {
    const doc = parseQueue(SAJAT)
    expect(doc.headings).toEqual([{ line: 2, key: 'feliratok/csatorna-a' }])
    expect(doc.videos[0]!.recipes.map((r) => r.recipeId)).toEqual(['summary'])
    expect(checkedPairs(doc)).toEqual([])
  })

  it('a határokat a soruk indexével adja', () => {
    expect(parseQueue(SAJAT).boundaries).toEqual([0, 6, 9])
  })
})
