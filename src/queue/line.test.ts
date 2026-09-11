import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { classifyLine, cleanTitle, groupKey, recipeLine, videoLine, withSuffix } from './line.js'

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
  it('felismeri a csoportfejlécet', () => {
    expect(classifyLine('## feliratok/csatorna-a')).toEqual({
      kind: 'heading',
      key: 'feliratok/csatorna-a',
    })
  })

  it('a videósorból kiveszi az azonosítót, a horgonyig tartó fejet és az utótagot', () => {
    expect(classifyLine('- Első — második rész %%abcDEF12345%% — ⚠ duplikátum')).toEqual({
      kind: 'video',
      itemId: 'abcDEF12345',
      head: '- Első — második rész %%abcDEF12345%%',
      suffix: ' — ⚠ duplikátum',
    })
  })

  it('a receptsort szóközös és tabos behúzással, kis és nagy x-szel is felismeri', () => {
    expect(classifyLine('  - [x] summary — ✓ 0.97')).toEqual({
      kind: 'recipe',
      recipeId: 'summary',
      checked: true,
      head: '  - [x] summary',
      suffix: ' — ✓ 0.97',
    })
    expect(classifyLine('\t- [X] qa')).toMatchObject({
      kind: 'recipe',
      recipeId: 'qa',
      checked: true,
      suffix: '',
    })
    expect(classifyLine('  - [ ] flashcards')).toMatchObject({ kind: 'recipe', checked: false })
  })

  it('a behúzás nélküli pipás sor, a szabad szöveg és a főcím saját sor', () => {
    expect(classifyLine('- [x] summary')).toEqual({ kind: 'other' })
    expect(classifyLine('Saját megjegyzés.')).toEqual({ kind: 'other' })
    expect(classifyLine('')).toEqual({ kind: 'other' })
    expect(classifyLine('# Feldolgozási sor')).toEqual({ kind: 'other' })
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

describe('videoLine, recipeLine, withSuffix', () => {
  it('a videósor a tisztított címet és az azonosítót viszi, és visszaolvasható', () => {
    const line = videoLine(elem({ title: 'Első\npéldavideó' }))
    expect(line).toBe('- Első példavideó %%abcDEF12345%%')
    expect(classifyLine(line)).toMatchObject({ kind: 'video', itemId: 'abcDEF12345', suffix: '' })
  })

  it('a receptsor üres pipával készül', () => {
    expect(recipeLine('summary')).toBe('  - [ ] summary')
  })

  it('az utótag a fej után, elválasztóval kerül; null esetén csak a fej marad', () => {
    expect(withSuffix('  - [x] summary', '✓ 0.97')).toBe('  - [x] summary — ✓ 0.97')
    expect(withSuffix('  - [x] summary', null)).toBe('  - [x] summary')
  })
})
