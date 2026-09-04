import { describe, expect, it } from 'vitest'
import { checkFormat, formatCriterion } from './format.js'

describe('checkFormat', () => {
  it('a szabályos jegyzetet elfogadja', () => {
    const result = checkFormat('## Main point\n\n- Something the speaker said.\n')
    expect(result.value).toBe(1)
    expect(result.gaps).toEqual([])
  })

  it('az üres kimenetet elutasítja', () => {
    const result = checkFormat('   \n  ')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/empty/i)
  })

  it('a wikilinket elutasítja', () => {
    const result = checkFormat('See [[Another Note]] for details.')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/wikilink/i)
  })

  it('a szögletes zárójel nélküli linkcélt elutasítja', () => {
    const result = checkFormat('See [the docs](https://example.com).')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/angle bracket/i)
  })

  it('a szögletes zárójeles linkcélt elfogadja', () => {
    const result = checkFormat('See [the docs](<https://example.com>).')
    expect(result.value).toBe(1)
  })

  it('a lezáratlan kódblokkot elutasítja', () => {
    const result = checkFormat('Example:\n\n```ts\nconst a = 1\n')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/code fence/i)
  })

  it('a lezárt kódblokkot elfogadja', () => {
    expect(checkFormat('```ts\nconst a = 1\n```\n').value).toBe(1)
  })

  it('a modell által kitett frontmattert elutasítja', () => {
    const result = checkFormat('---\ntitle: Valami\n---\n\n## Pont\n')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/frontmatter/i)
  })

  it('minden hibát felsorol, nem csak az elsőt', () => {
    const result = checkFormat('See [[X]] and [docs](https://example.com).')
    expect(result.gaps.length).toBe(2)
  })
})

describe('formatCriterion', () => {
  it('blokkoló kritérium', () => {
    expect(formatCriterion.blocking).toBe(true)
  })

  it('a kontextus kimenetét pontozza, nem az átiratot', async () => {
    const score = await formatCriterion.score(
      { transcript: 'See [[X]]', output: '## Rendben\n' },
      { generate: () => Promise.reject(new Error('nem hívható')),
        generateObject: () => Promise.reject(new Error('nem hívható')) },
    )
    expect(score.value).toBe(1)
  })
})
