import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import { queueLayout } from './layout.js'
import { isLegacyQueue, migrateLegacy } from './legacy.js'

const LAYOUT = queueLayout(
  recipesFor({ translate: { to: 'hu', recipes: ['clean', 'summary'] }, configPath: '/p/c.yaml' }),
)

const REGI = [
  '# Feldolgozási sor',
  '',
  '  - [x] summary',
  '## forras/a',
  '- Első példavideó %%a%%',
  '  - [ ] summary',
  '  - [x] clean — ✓ 0.95 · $0.5328 · [jegyzet](<forras/a/Elso_clean.md>)',
  '\t- [X] qa',
  'Saját megjegyzés.',
  '  - [ ] clean-hu',
  '  - [x] summary-hu — ✓ 0.90 · $0.0100',
  '  - [ ] notes-hu',
  '',
  '## forras/b',
  '- Második példavideó %%b%% — ⚠ a felirat nem található',
  '  - [ ] nincsilyen',
  '  - [x] summary-hu — ⏸ előbb a summary recept kell',
  '',
].join('\n')

const UJ = [
  '# Feldolgozási sor',
  '',
  '  - [x] summary',
  '## 0. forras/a',
  '### 0. Első példavideó %%a%%',
  '- [ ] summary',
  '  - [x] hu — ✓ 0.90 · $0.0100',
  '- [x] clean — ✓ 0.95 · $0.5328 · [jegyzet](<forras/a/Elso_clean.md>)',
  '  - [ ] hu',
  '- [X] qa',
  'Saját megjegyzés.',
  '- [ ] notes-hu',
  '',
  '## 0. forras/b',
  '### 0. Második példavideó %%b%% — ⚠ a felirat nem található',
  '- [ ] nincsilyen',
  '- [ ] summary',
  '  - [x] hu — ⏸ előbb a summary recept kell',
  '',
].join('\n')

describe('isLegacyQueue', () => {
  it('a régi videósor régi formátumot jelez', () => {
    expect(isLegacyQueue(REGI)).toBe(true)
  })

  it('az új formátum — saját számozatlan fejléccel is — nem régi', () => {
    expect(isLegacyQueue(UJ)).toBe(false)
    expect(isLegacyQueue('## 1. forras/a\n### 1. Első %%a%%\n- [ ] summary\n\n## Jegyzetek\n')).toBe(
      false,
    )
  })

  it('csak számozatlan fejlécek, videó nélkül: régi', () => {
    expect(isLegacyQueue('# Feldolgozási sor\n\n## forras/a\n\n## forras/b\n')).toBe(true)
  })

  it('a pipás sor nem videósor, és a fej magában nem régi', () => {
    expect(isLegacyQueue('- [x] summary — %%nem horgony%%\n')).toBe(false)
    expect(isLegacyQueue('# Feldolgozási sor\n\nPipáld ki…\n')).toBe(false)
  })
})

describe('migrateLegacy', () => {
  it('átalakít: pipa és utótag megmarad, a fordítás a forrása alá kerül, a hiányzó forrás szülősort kap', () => {
    expect(migrateLegacy(REGI, LAYOUT)).toEqual({ text: UJ, migrated: true })
  })

  it('új formátumra bájtra azonos, és nem jelez átalakítást', () => {
    expect(migrateLegacy(UJ, LAYOUT)).toEqual({ text: UJ, migrated: false })
  })

  it('kétszer alkalmazva ugyanaz', () => {
    const egyszer = migrateLegacy(REGI, LAYOUT).text
    expect(migrateLegacy(egyszer, LAYOUT).text).toBe(egyszer)
  })
})
