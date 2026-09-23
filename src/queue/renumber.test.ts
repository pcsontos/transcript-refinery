import { describe, expect, it } from 'vitest'
import { renumberQueue } from './renumber.js'

const SOR = [
  '# Feldolgozási sor',
  '',
  '### 7. Árva videó %%z%%',
  '## 3. forras/a',
  '### 5. Első példavideó %%a%%',
  '- [x] summary — ✓ 0.97',
  '  - [ ] hu',
  '### 5. 1. rész: bevezető %%b%%',
  '### 9. Horgony nélküli saját fejléc',
  '## Saját jegyzetek',
  'Szabad szöveg.',
  '## 0. forras/b',
  '### 0. Harmadik példavideó %%c%%',
  '',
].join('\n')

describe('renumberQueue', () => {
  it('a csoportok végig, a videók csoportonként 1-től; csak az előtag változik', () => {
    expect(renumberQueue(SOR)).toBe(
      [
        '# Feldolgozási sor',
        '',
        '### 1. Árva videó %%z%%',
        '## 1. forras/a',
        '### 1. Első példavideó %%a%%',
        '- [x] summary — ✓ 0.97',
        '  - [ ] hu',
        '### 2. 1. rész: bevezető %%b%%',
        '### 9. Horgony nélküli saját fejléc',
        '## Saját jegyzetek',
        'Szabad szöveg.',
        '## 2. forras/b',
        '### 1. Harmadik példavideó %%c%%',
        '',
      ].join('\n'),
    )
  })

  it('idempotens', () => {
    const egyszer = renumberQueue(SOR)
    expect(renumberQueue(egyszer)).toBe(egyszer)
  })

  it('számozott sor nélküli szövegre bájtra azonos', () => {
    const szoveg = '# Feldolgozási sor\n\n## Saját\n- sima listaelem\n'
    expect(renumberQueue(szoveg)).toBe(szoveg)
  })
})
