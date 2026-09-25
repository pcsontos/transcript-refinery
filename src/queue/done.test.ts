import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import type { SourceItem } from '../types.js'
import { noteFile } from '../vault/paths.js'
import { doneLookup, markDone, type DoneLookup } from './done.js'
import { pairKey } from './status.js'

const sor = (...lines: string[]): string => ['# Feldolgozási sor', '', ...lines, ''].join('\n')

/** Lekérdező a megadott párokra: `[itemId, kind] → utótag`. */
function kesz(parok: Record<string, string>): DoneLookup {
  return (itemId, kind) => parok[pairKey(itemId, kind)] ?? null
}

const K = (itemId: string, kind: string): string => pairKey(itemId, kind)

describe('markDone', () => {
  it('az üres sor [x] pipát és utótagot kap', () => {
    const { text, marked } = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary', '- [ ] qa'),
      kesz({ [K('a1', 'summary')]: '✓ 0.97 · $0.0471' }),
    )
    expect(text).toBe(
      sor('## 1. f', '### 1. Első %%a1%%', '- [x] summary — ✓ 0.97 · $0.0471', '- [ ] qa'),
    )
    expect(marked).toBe(1)
  })

  it('a ✗, ⏸ és ⏳ utótagot felülírja', () => {
    const { text, marked } = markDone(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [x] summary — ✗ időtúllépés',
        '- [x] qa — ⏳ a plafon miatt a következő futásra maradt',
        '- [x] clean-moderate — ⏸ előbb a summary recept kell',
      ),
      kesz({
        [K('a1', 'summary')]: '✓ 0.90 · $0.0100',
        [K('a1', 'qa')]: '✓ 0.80 · $0.0200',
        [K('a1', 'clean-moderate')]: '✓ már a vaultban',
      }),
    )
    expect(text).toBe(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [x] summary — ✓ 0.90 · $0.0100',
        '- [x] qa — ✓ 0.80 · $0.0200',
        '- [x] clean-moderate — ✓ már a vaultban',
      ),
    )
    expect(marked).toBe(3)
  })

  it('[ ] + ✓: csak a pipa változik, az utótag bájtra marad', () => {
    const { text, marked } = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary — ✓ 0.00 · $0.0093 · [jegyzet](<./a.md>)'),
      kesz({ [K('a1', 'summary')]: '✓ 0.95 · $0.0500' }),
    )
    expect(text).toBe(
      sor('## 1. f', '### 1. Első %%a1%%', '- [x] summary — ✓ 0.00 · $0.0093 · [jegyzet](<./a.md>)'),
    )
    expect(marked).toBe(1)
  })

  it('[x] + ✓ és [X] + ✓ érintetlen', () => {
    const be = sor(
      '## 1. f',
      '### 1. Első %%a1%%',
      '- [x] summary — ✓ 0.97 · $0.0471',
      '- [X] qa — ✓ 0.98 · $0.0596',
    )
    const { text, marked } = markDone(
      be,
      kesz({ [K('a1', 'summary')]: '✓ 0.10 · $9.0000', [K('a1', 'qa')]: '✓ 0.10 · $9.0000' }),
    )
    expect(text).toBe(be)
    expect(marked).toBe(0)
  })

  it('a fordítássor a saját kulcsával jelölődik; a nem kész szülő érintetlen', () => {
    const { text } = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] clean-moderate', '  - [ ] hu'),
      kesz({ [K('a1', 'clean-moderate-hu')]: '✓ már a vaultban' }),
    )
    expect(text).toBe(sor('## 1. f', '### 1. Első %%a1%%', '- [ ] clean-moderate', '  - [x] hu — ✓ már a vaultban'))
  })

  it('a duplikátum videóblokkhoz nem nyúl', () => {
    const { text } = markDone(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [ ] summary',
        '### 2. Első újra %%a1%% — ⚠ duplikátum',
        '- [ ] summary',
      ),
      kesz({ [K('a1', 'summary')]: '✓ már a vaultban' }),
    )
    expect(text).toBe(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [x] summary — ✓ már a vaultban',
        '### 2. Első újra %%a1%% — ⚠ duplikátum',
        '- [ ] summary',
      ),
    )
  })

  it('null lekérdezőre a szöveg bájtra azonos, saját sorokkal és fejlécekkel együtt', () => {
    const be = sor(
      'Saját megjegyzés.',
      '## 1. f',
      '### 1. Első %%a1%%',
      '- [ ] summary',
      '  - [ ] hu',
      '## Jegyzetek',
      '- [ ] summary',
    )
    expect(markDone(be, () => null)).toEqual({ text: be, marked: 0 })
  })

  it('a saját fejléc alatti pipás sor nem pár: akkor sem nyúl hozzá, ha a lekérdező mindenre igent mond', () => {
    const be = sor('## 1. f', '### 1. Első %%a1%%', '## Jegyzetek', '- [ ] summary')
    expect(markDone(be, () => '✓ már a vaultban').text).toBe(be)
  })

  it('kétszer alkalmazva ugyanazt adja', () => {
    const lookup = kesz({ [K('a1', 'summary')]: '✓ 0.97 · $0.0471', [K('a1', 'clean-moderate-hu')]: '✓ már a vaultban' })
    const elso = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary', '- [ ] clean-moderate', '  - [ ] hu'),
      lookup,
    ).text
    expect(markDone(elso, lookup)).toEqual({ text: elso, marked: 0 })
  })

  it('linksértő utótagot nem ír ki', () => {
    expect(() =>
      markDone(sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary'), () => '✓ [[wikilink]]'),
    ).toThrow('vault írási szabályait')
  })
})

describe('doneLookup', () => {
  const notesRoot = '/v/root'
  const registry = recipesFor({ translate: { to: 'hu', recipes: ['clean-moderate'] }, configPath: '/p/c.yaml' })
  const elem: SourceItem = {
    itemId: 'a1',
    source: 'transcripts',
    sourceFile: 'youtube/Csatorna/Elso.en.srt',
    subtitlePath: '/src/transcripts/youtube/Csatorna/Elso.en.srt',
    baseName: 'Elso',
    title: 'Első',
    language: 'en',
    metadata: {},
  }
  const items = new Map([[elem.itemId, elem]])
  const summaryUt = noteFile(notesRoot, elem, '_summary.md')

  it('ismeretlen elemre és ismeretlen receptre null', () => {
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => ({ status: 'done', score: 1, costUsd: 0.1, path: null }),
      exists: () => true,
    })
    expect(lookup('nincs', 'summary')).toBeNull()
    expect(lookup('a1', 'nincsilyen')).toBeNull()
  })

  it('done rekordnál a rekord pontszáma, költsége és — eltérő — útja számít', () => {
    const regiUt = join(notesRoot, 'transcripts/pinchflat-minta/youtube/Csatorna/Elso_summary.md')
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => ({ status: 'done', score: 0.95, costUsd: 0.0719, path: regiUt }),
      exists: () => false,
    })
    expect(lookup('a1', 'summary')).toBe(
      '✓ 0.95 · $0.0719 · [jegyzet](<transcripts/pinchflat-minta/youtube/Csatorna/Elso_summary.md>)',
    )
  })

  it('rekord nélkül, létező célfájllal: már a vaultban, a célút linkjével', () => {
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => null,
      exists: (path) => path === summaryUt,
    })
    expect(lookup('a1', 'summary')).toBe(
      '✓ már a vaultban · [jegyzet](<transcripts/youtube/Csatorna/Elso_summary.md>)',
    )
    expect(lookup('a1', 'qa')).toBeNull()
  })

  it('failed rekord: fájl nélkül null, fájllal már a vaultban', () => {
    const failed = () => ({ status: 'failed', score: null, costUsd: null, path: null })
    expect(
      doneLookup({ items, registry, notesRoot, artifactOf: failed, exists: () => false })('a1', 'summary'),
    ).toBeNull()
    expect(
      doneLookup({ items, registry, notesRoot, artifactOf: failed, exists: () => true })('a1', 'summary'),
    ).toBe('✓ már a vaultban · [jegyzet](<transcripts/youtube/Csatorna/Elso_summary.md>)')
  })

  it('a fordítás célútja a fordítórecept fájlneve', () => {
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => null,
      exists: (path) => path === noteFile(notesRoot, elem, '_clean-moderate-hu.md'),
    })
    expect(lookup('a1', 'clean-moderate-hu')).toBe(
      '✓ már a vaultban · [jegyzet](<transcripts/youtube/Csatorna/Elso_clean-moderate-hu.md>)',
    )
  })
})
