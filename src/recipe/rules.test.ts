import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { RULE } from './rules.js'
import { summaryRecipe } from './summary.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'proba',
  sourceFile: 'Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: {},
}

/** A mai `summary` szabályblokkja, szó szerint. Ez a regressziós horgony. */
const EXPECTED = [
  '- Write in the same language as the transcript. Do not translate.',
  '- Every statement must be traceable to the transcript. Do not add outside',
  '  knowledge, and do not speculate about what the speaker meant.',
  '- Open with a short paragraph on what the video is about, then use `##`',
  '  sections with bullet points for the substance.',
  '- Do not emit YAML frontmatter; it is added separately.',
  '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
  '  brackets: `[Name](<https://example.com>)`.',
  "- Aim for roughly a tenth of the transcript's length.",
].join('\n')

describe('vault-invariáns szabályok', () => {
  it('a summary szabályblokkja bájtra változatlan a kiemelés után', () => {
    const prompt = summaryRecipe.prompt({ item: ITEM, transcript: 'A, majd B.' })
    expect(prompt).toContain(EXPECTED)
  })

  it('a szabályok angolul szólnak, mert a promptba mennek', () => {
    expect(RULE.language).toMatch(/do not translate/i)
    expect(RULE.noWikilinks).toMatch(/wikilink/i)
  })

  it('a nem-invariáns szabályokat nem tartalmazza', () => {
    const osszes = Object.values(RULE).join('\n')
    expect(osszes).not.toMatch(/tenth of the transcript/i)
    expect(osszes).not.toMatch(/bullet points/i)
  })
})
