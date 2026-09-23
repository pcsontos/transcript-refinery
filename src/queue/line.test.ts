import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import {
  classifyLine,
  cleanTitle,
  groupKey,
  headingLine,
  recipeLine,
  translationLine,
  videoLine,
  withSuffix,
} from './line.js'

function elem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    itemId: 'abcDEF12345',
    source: 'feliratok',
    sourceFile: 'csatorna-a/Elso_peldavideo.hu.srt',
    subtitlePath: '/nemletezo/feliratok/csatorna-a/Elso_peldavideo.hu.srt',
    baseName: 'Elso_peldavideo',
    title: 'Első példavideó',
    language: 'hu',
    metadata: {},
    ...overrides,
  }
}

describe('classifyLine', () => {
  it('a számozott csoportfejlécből a sorszám nélküli kulcsot veszi', () => {
    expect(classifyLine('## 1. feliratok/csatorna-a')).toEqual({
      kind: 'heading',
      key: 'feliratok/csatorna-a',
    })
    expect(classifyLine('## 12. x')).toEqual({ kind: 'heading', key: 'x' })
  })

  it('a videófejlécből az azonosítót, a sorszámmal együtti fejet és az utótagot veszi', () => {
    expect(classifyLine('### 3. Első — második rész %%abcDEF12345%% — ⚠ duplikátum')).toEqual({
      kind: 'video',
      itemId: 'abcDEF12345',
      head: '### 3. Első — második rész %%abcDEF12345%%',
      suffix: ' — ⚠ duplikátum',
    })
  })

  it('sorszámmal kezdődő cím is videó', () => {
    expect(classifyLine('### 2. 1. rész: bevezető %%x1%%')).toMatchObject({
      kind: 'video',
      itemId: 'x1',
      head: '### 2. 1. rész: bevezető %%x1%%',
    })
  })

  it('a behúzás nélküli receptsort kis és nagy x-szel is felismeri', () => {
    expect(classifyLine('- [x] summary — ✓ 0.97')).toEqual({
      kind: 'recipe',
      recipeId: 'summary',
      checked: true,
      head: '- [x] summary',
      suffix: ' — ✓ 0.97',
    })
    expect(classifyLine('- [X] qa')).toMatchObject({ kind: 'recipe', recipeId: 'qa', checked: true })
    expect(classifyLine('- [ ] flashcards')).toMatchObject({ kind: 'recipe', checked: false })
  })

  it('a pontosan két szóközzel behúzott kétbetűs nyelvkód fordítássor', () => {
    expect(classifyLine('  - [x] hu — ✓ 0.90')).toEqual({
      kind: 'translation',
      lang: 'hu',
      checked: true,
      head: '  - [x] hu',
      suffix: ' — ✓ 0.90',
    })
    expect(classifyLine('  - [ ] en')).toMatchObject({ kind: 'translation', lang: 'en', checked: false })
  })

  it('ami csak hasonlít, az saját sor', () => {
    for (const line of [
      '## feliratok/csatorna-a',
      '- Első %%abc%%',
      '  - [x] summary',
      '\t- [x] qa',
      '    - [ ] hu',
      '  - [ ] hun',
      '  - [ ] HU',
      '### 1. Horgony nélkül',
      'Saját megjegyzés.',
      '',
      '# Feldolgozási sor',
    ]) {
      expect(classifyLine(line)).toEqual({ kind: 'other' })
    }
  })
})

describe('cleanTitle', () => {
  it('egy sorba fésül, és a %-sorozatot egyetlen %-ra vonja össze', () => {
    expect(cleanTitle('Első\nsor  100%% biztos', 'x')).toBe('Első sor 100% biztos')
  })

  it('a címből nem lehet wikilink vagy zárójel nélküli link-cél', () => {
    const tiszta = cleanTitle('[[Lap]] és [szöveg](cél) [[[x]]]', 'x')
    expect(lintVaultMarkdown(`- ${tiszta} %%x%%`)).toEqual([])
  })

  it('üres cím helyett a tartalékot adja', () => {
    expect(cleanTitle('   ', 'abcDEF12345')).toBe('abcDEF12345')
  })
})

describe('groupKey', () => {
  it('a forrásból és a felirat forráson belüli mappájából áll', () => {
    expect(groupKey(elem())).toBe('feliratok/csatorna-a')
  })

  it('gyökérszintű feliratnál csak a forrás', () => {
    expect(groupKey(elem({ sourceFile: 'Elso_peldavideo.hu.srt' }))).toBe('feliratok')
  })
})

describe('sorgenerálók és withSuffix', () => {
  it('a videósor 0-s sorszámmal, a tisztított címmel és az azonosítóval készül, és visszaolvasható', () => {
    const line = videoLine(elem({ title: 'Első\npéldavideó' }))
    expect(line).toBe('### 0. Első példavideó %%abcDEF12345%%')
    expect(classifyLine(line)).toMatchObject({ kind: 'video', itemId: 'abcDEF12345', suffix: '' })
  })

  it('a csoportfejléc 0-s sorszámmal készül, és visszaolvasható', () => {
    expect(headingLine('feliratok/csatorna-a')).toBe('## 0. feliratok/csatorna-a')
    expect(classifyLine(headingLine('feliratok/csatorna-a'))).toEqual({
      kind: 'heading',
      key: 'feliratok/csatorna-a',
    })
  })

  it('a recept- és a fordítássor üres pipával készül', () => {
    expect(recipeLine('summary')).toBe('- [ ] summary')
    expect(translationLine('hu')).toBe('  - [ ] hu')
    expect(classifyLine(translationLine('hu'))).toMatchObject({ kind: 'translation', lang: 'hu' })
  })

  it('az utótag a fej után, elválasztóval kerül; null esetén csak a fej marad', () => {
    expect(withSuffix('- [x] summary', '✓ 0.97')).toBe('- [x] summary — ✓ 0.97')
    expect(withSuffix('- [x] summary', null)).toBe('- [x] summary')
  })
})
