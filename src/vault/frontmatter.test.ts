import { describe, expect, it } from 'vitest'
import { renderFrontmatter } from './frontmatter.js'

describe('renderFrontmatter', () => {
  it('a mezőket a megadott sorrendben írja ki', () => {
    expect(renderFrontmatter([['a', '1'], ['b', '2']])).toBe('---\na: 1\nb: 2\n---')
  })

  it('a hiányzó mezőt kihagyja, nem null-ozza', () => {
    expect(renderFrontmatter([['a', '1'], ['b', undefined], ['c', '3']])).toBe(
      '---\na: 1\nc: 3\n---',
    )
  })

  it('a számot idézőjel nélkül írja', () => {
    expect(renderFrontmatter([['duration', 1806]])).toBe('---\nduration: 1806\n---')
  })

  it('a különleges karaktert tartalmazó szöveget idézőjelezi', () => {
    expect(renderFrontmatter([['title', 'Egy: kettő']])).toBe('---\ntitle: "Egy: kettő"\n---')
  })

  it('az idézőjelet és a backslasht escape-eli', () => {
    expect(renderFrontmatter([['t', 'a "b" \\ c']])).toBe('---\nt: "a \\"b\\" \\\\ c"\n---')
  })

  it('a többsoros szöveget blokk-skalárként írja', () => {
    expect(renderFrontmatter([['description', 'Első\nMásodik']])).toBe(
      '---\ndescription: |-\n  Első\n  Második\n---',
    )
  })

  it('a CRLF-et normalizálja, és a záró üres sorokat levágja', () => {
    expect(renderFrontmatter([['description', 'Első\r\nMásodik\n\n']])).toBe(
      '---\ndescription: |-\n  Első\n  Második\n---',
    )
  })

  it('a listát folyó alakban írja, elemenként idézve', () => {
    expect(renderFrontmatter([['tags', ['ai', 'két szó', 'a:b']]])).toBe(
      '---\ntags: [ai, két szó, "a:b"]\n---',
    )
  })

  it('üres mezőlistából is érvényes határolókat ad', () => {
    expect(renderFrontmatter([])).toBe('---\n---')
  })
})
