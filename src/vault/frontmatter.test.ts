import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { renderFrontmatter } from './frontmatter.js'

describe('renderFrontmatter', () => {
  it('a mezőket a megadott sorrendben írja ki', () => {
    expect(renderFrontmatter([['a', 'x'], ['b', 'y']])).toBe('---\na: x\nb: y\n---')
  })

  it('a hiányzó mezőt kihagyja, nem null-ozza', () => {
    expect(renderFrontmatter([['a', 'x'], ['b', undefined], ['c', 'z']])).toBe(
      '---\na: x\nc: z\n---',
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
      '---\ndescription: |2-\n  Első\n  Második\n---',
    )
  })

  it('a CRLF-et normalizálja, és a záró üres sorokat levágja', () => {
    expect(renderFrontmatter([['description', 'Első\r\nMásodik\n\n']])).toBe(
      '---\ndescription: |2-\n  Első\n  Második\n---',
    )
  })

  it('a behúzással kezdődő többsoros érték is érvényes YAML marad', () => {
    const md = renderFrontmatter([
      ['title', 'X'],
      ['description', '   Támogasd a csatornát!\nA linkek a leírásban.'],
      ['source', 'youtube'],
    ])
    const body = md.replace(/^---\n/, '').replace(/---$/, '')
    const parsed = parseYaml(body) as Record<string, unknown>
    expect(parsed.description).toBe('   Támogasd a csatornát!\nA linkek a leírásban.')
    expect(parsed.source).toBe('youtube')
  })

  it('a listát folyó alakban írja, elemenként idézve', () => {
    expect(renderFrontmatter([['tags', ['ai', 'két szó', 'a:b']]])).toBe(
      '---\ntags: [ai, két szó, "a:b"]\n---',
    )
  })

  it('üres mezőlistából is érvényes határolókat ad', () => {
    expect(renderFrontmatter([])).toBe('---\n---')
  })

  it('a YAML-indikátorral kezdődő értéket idézőjelezi (- és @)', () => {
    expect(renderFrontmatter([['a', '- dashed item']])).toBe(
      '---\na: "- dashed item"\n---',
    )
    expect(renderFrontmatter([['a', '-']])).toBe('---\na: "-"\n---')
    expect(renderFrontmatter([['a', '@handle']])).toBe('---\na: "@handle"\n---')
  })

  it('az egész számot és a YAML logikai/null szót idézőjelezi, hogy szöveg maradjon', () => {
    expect(renderFrontmatter([['a', '12345']])).toBe('---\na: "12345"\n---')
    expect(renderFrontmatter([['a', 'true']])).toBe('---\na: "true"\n---')
    expect(renderFrontmatter([['a', 'null']])).toBe('---\na: "null"\n---')
    expect(renderFrontmatter([['a', 'yes']])).toBe('---\na: "yes"\n---')
  })

  it('a vezető és záró szóközt idézőjelezi, a szóközöket megőrzi', () => {
    expect(renderFrontmatter([['a', ' szóköz ']])).toBe('---\na: " szóköz "\n---')
  })

  it('a dátum alakú értéket nem idézőjelezi, hogy az Obsidian dátumként olvassa', () => {
    expect(renderFrontmatter([['uploaded', '2026-07-14']])).toBe(
      '---\nuploaded: 2026-07-14\n---',
    )
  })

  it('a lista elemeit is a fenti szabályok szerint idézi', () => {
    expect(renderFrontmatter([['tags', ['- x', '12']]])).toBe(
      '---\ntags: ["- x", "12"]\n---',
    )
  })
})
