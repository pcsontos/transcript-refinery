import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import type { SourceItem } from '../types.js'
import { queueLayout } from './layout.js'
import { migrateLegacy } from './legacy.js'
import { mergeQueue } from './merge.js'
import { renumberQueue } from './renumber.js'

const LAYOUT = queueLayout(
  recipesFor({ translate: { to: 'hu', recipes: ['summary'] }, configPath: '/p/c.yaml' }),
)

function elem(itemId: string, title: string, language: string | null): SourceItem {
  return {
    itemId,
    source: 'feliratok',
    sourceFile: `csatorna-a/${title}.srt`,
    subtitlePath: `/nemletezo/feliratok/csatorna-a/${title}.srt`,
    baseName: title,
    title,
    language,
    metadata: {},
  }
}

const ITEMS = [elem('a', 'Angol', 'en'), elem('h', 'Magyar', 'hu')]

/** A scan három lépése, ugyanabban a sorrendben, mint a `commandScanQueue`-ban. */
function scan(text: string): string {
  return renumberQueue(mergeQueue(migrateLegacy(text, LAYOUT).text, ITEMS, LAYOUT).text)
}

const REGI = [
  '# Feldolgozási sor',
  '',
  '## feliratok/csatorna-a',
  '- Angol %%a%%',
  '  - [x] summary — ✓ 0.95 · $0.1000',
  '  - [x] summary-hu — ⏸ előbb a summary recept kell',
  '- Magyar %%h%%',
  '  - [ ] summary',
  '  - [x] summary-hu',
  '',
].join('\n')

describe('a scan lánca: átalakítás → összefésülés → újraszámozás', () => {
  it('régi bemenetre az első futás átalakít, a második bájtra azonos', () => {
    const egyszer = scan(REGI)

    expect(egyszer).toContain('### 1. Angol %%a%%\n- [x] summary — ✓ 0.95 · $0.1000\n  - [x] hu — ⏸ előbb a summary recept kell\n')
    expect(egyszer).toContain('### 2. Magyar %%h%%\n- [ ] summary\n- [ ] flashcards')
    expect(egyszer).not.toMatch(/### 2\. Magyar[^#]* {2}- \[.\] hu/)
    expect(scan(egyszer)).toBe(egyszer)
  })

  it('új formátumú bemenetre — az átalakított sorra — bájtra azonos', () => {
    const uj = scan(REGI)

    expect(migrateLegacy(uj, LAYOUT)).toEqual({ text: uj, migrated: false })
    expect(scan(uj)).toBe(uj)
  })
})
