import { describe, expect, it } from 'vitest'
import { lintVaultMarkdown } from './lint.js'

describe('lintVaultMarkdown', () => {
  it('elfogadja a szögletes zárójeles linket', () => {
    expect(lintVaultMarkdown('lásd [Terv](<./terv.md>)')).toEqual([])
  })

  it('elutasítja a wikilinket', () => {
    const errors = lintVaultMarkdown('lásd [[Terv]]')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/wikilink/i)
  })

  it('elutasítja a szögletes zárójel nélküli linket', () => {
    const errors = lintVaultMarkdown('lásd [Terv](./terv.md)')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/szögletes/i)
  })

  it('a képhivatkozást is ellenőrzi', () => {
    expect(lintVaultMarkdown('![kép](kep.png)')).toHaveLength(1)
  })

  it('több hibát is összegyűjt', () => {
    expect(lintVaultMarkdown('[[A]] és [B](c.md)')).toHaveLength(2)
  })

  it('a nyers URL-t nem tekinti Markdown-linknek', () => {
    expect(lintVaultMarkdown('🌐 <https://example.com>')).toEqual([])
  })

  it('elutasítja az értelmezhetetlen frontmattert', () => {
    // Az 1. tétel hibájának pontos alakja: behúzásjelző nélküli blokk-skalár,
    // aminek első sora maga is behúzott — a YAML ezen eltörik.
    const md =
      '---\ndescription: |-\n   Támogasd a csatornát!\nA linkek a leírásban.\n---\n\nTörzs.'
    const errors = lintVaultMarkdown(md)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/frontmatter.*YAML/)
  })

  it('elfogadja az érvényes frontmattert', () => {
    const md = '---\ntitle: X\nsource: youtube\n---\n\nTörzs.'
    expect(lintVaultMarkdown(md)).toEqual([])
  })

  it('frontmatter nélküli markdownon nem változik a viselkedés', () => {
    expect(lintVaultMarkdown('Csak törzs, frontmatter nélkül.')).toEqual([])
  })
})
