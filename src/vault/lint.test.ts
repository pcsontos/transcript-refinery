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
})
