import { describe, expect, it } from 'vitest'
import { siteKindOf, variantOf } from './variant.js'

const BASE = { generated_at: 'T1', source: 'youtube', title: 'Cím', language: 'hu-orig' }
const NONE = new Map<string, Record<string, unknown>>()

describe('variantOf', () => {
  it('hu-orig eredeti hu változat lesz', () => {
    const v = variantOf('X', { vaultKind: 'summary', fields: BASE }, NONE, null)
    expect(v).toMatchObject({ ok: true, target: 'X/summary.hu.mdx', siteKind: 'summary', language: 'hu' })
    if (v.ok) expect(v.fields).toMatchObject({ language: 'hu', kind: 'summary', title: 'Cím' })
  })

  it('listás nyelvű eredeti kimegy, a listán kívüli és a hiányzó kimarad', () => {
    expect(variantOf('X', { vaultKind: 'summary', fields: { ...BASE, language: 'nl-orig' } }, NONE, null)).toMatchObject({
      ok: true,
      target: 'X/summary.nl.mdx',
      language: 'nl',
    })
    expect(variantOf('X', { vaultKind: 'summary', fields: { ...BASE, language: 'xx' } }, NONE, null)).toEqual({
      ok: false,
      reason: 'nyelv: xx',
    })
    const { language: _l, ...nincs } = BASE
    expect(variantOf('X', { vaultKind: 'summary', fields: nincs }, NONE, null)).toEqual({
      ok: false,
      reason: 'nyelv: ismeretlen',
    })
  })

  it('nem hu/en fordítás és nem hu/en szójegyzék kimarad (a szójegyzék viselkedése változatlan)', () => {
    const tr = { ...BASE, language: 'de', translation_of: 'summary', source_language: 'hu', source_generated_at: 'T1' }
    expect(variantOf('X', { vaultKind: 'summary-de', fields: tr }, NONE, null)).toEqual({ ok: false, reason: 'nyelv: de' })
    const siblings = new Map([['summary', { source: 'youtube' }]])
    expect(variantOf('X', { vaultKind: 'glossary-nl', fields: { ...BASE, language: 'nl' } }, siblings, 'T2')).toEqual({
      ok: false,
      reason: 'nyelv: nl',
    })
  })

  it('origin nélküli régi jegyzet pótolt origint kap', () => {
    const tg = variantOf('X', { vaultKind: 'summary', fields: { ...BASE, source: 'telegram' } }, NONE, null)
    const cli = variantOf('X', { vaultKind: 'summary', fields: BASE }, NONE, null)
    expect(tg.ok && tg.fields.origin).toBe('telegram')
    expect(cli.ok && cli.fields.origin).toBe('cli')
  })

  it('az url változatlanul átmegy, URL nélküli tétel url nélkül marad', () => {
    const v = variantOf('X', { vaultKind: 'summary', fields: BASE }, NONE, null)
    expect(v.ok && 'url' in v.fields).toBe(false)
    const withUrl = variantOf('X', { vaultKind: 'summary', fields: { ...BASE, url: 'https://a.com/v' } }, NONE, null)
    expect(withUrl.ok && withUrl.fields.url).toBe('https://a.com/v')
  })

  it('nincs generated_at kihagyás', () => {
    const { generated_at: _g, ...nincs } = BASE
    expect(variantOf('X', { vaultKind: 'summary', fields: nincs }, NONE, null)).toEqual({
      ok: false,
      reason: 'nincs generated_at',
    })
  })

  const TR = { ...BASE, language: 'hu', translation_of: 'clean', source_language: 'en-orig', source_generated_at: 'S1' }

  it('clean-moderate-hu fordítás', () => {
    const v = variantOf('X', { vaultKind: 'clean-moderate-hu', fields: TR }, NONE, null)
    expect(v).toMatchObject({ ok: true, target: 'X/clean-moderate.hu.mdx', siteKind: 'clean-moderate' })
    if (v.ok)
      expect(v.fields).toMatchObject({
        kind: 'clean-moderate',
        translation_of: 'clean-moderate',
        source_language: 'en',
        language: 'hu',
      })
  })

  it('a fájlnév nem <fajta>-<nyelv> alakú fordítás kihagyás', () => {
    expect(variantOf('X', { vaultKind: 'summary', fields: TR }, NONE, null)).toEqual({
      ok: false,
      reason: 'a fordítás fájlneve nem <fajta>-<nyelv> alakú',
    })
  })

  it('hiányzó source_generated_at pótlódik az eredetiből', () => {
    const { source_generated_at: _s, ...nincs } = TR
    const sib = new Map([['clean-moderate', { generated_at: 'T9' }]])
    const v = variantOf('X', { vaultKind: 'clean-moderate-hu', fields: nincs }, sib, null)
    expect(v.ok && v.fields.source_generated_at).toBe('T9')
    expect(variantOf('X', { vaultKind: 'clean-moderate-hu', fields: nincs }, NONE, null)).toEqual({
      ok: false,
      reason: 'fordítás: hiányzik a source_generated_at, és az eredeti nincs a vaultban',
    })
  })

  it('hiányzó source_language kihagyás', () => {
    const { source_language: _s, ...nincs } = TR
    expect(variantOf('X', { vaultKind: 'clean-moderate-hu', fields: nincs }, NONE, null)).toEqual({
      ok: false,
      reason: 'fordítás: hiányzik a source_language',
    })
  })

  it('szójegyzék glossary.hu lesz, a vault-commit idejével', () => {
    const gl = { title: 'Cím', language: 'hu', source_language: 'en', kind: 'glossary-hu' }
    const sib = new Map([['summary', { source: 's', origin: 'cli' }]])
    const v = variantOf('X', { vaultKind: 'glossary-hu', fields: gl }, sib, 'T2')
    expect(v).toMatchObject({ ok: true, target: 'X/glossary.hu.mdx', siteKind: 'glossary' })
    if (v.ok) {
      expect(v.fields).toMatchObject({ kind: 'glossary', generated_at: 'T2', source: 's', origin: 'cli', language: 'hu' })
      expect('source_language' in v.fields).toBe(false)
    }
    expect(variantOf('X', { vaultKind: 'glossary-hu', fields: gl }, sib, null)).toEqual({
      ok: false,
      reason: 'a szójegyzék még nincs commitolva',
    })
    expect(variantOf('X', { vaultKind: 'glossary-hu', fields: gl }, NONE, 'T2')).toEqual({
      ok: false,
      reason: 'a tételnek nincs forrás-adata',
    })
  })
})

describe('siteKindOf', () => {
  it('siteKindOf a vault-fajtából a site-fajtát adja', () => {
    expect(siteKindOf('summary', { language: 'hu' })).toBe('summary')
    expect(siteKindOf('summary-de', { language: 'de', translation_of: 'summary' })).toBe('summary')
    expect(siteKindOf('notes-en', { language: 'en-orig', translation_of: 'notes' })).toBe('notes')
    expect(siteKindOf('glossary-hu', { language: 'hu' })).toBe('glossary')
    expect(siteKindOf('clean-deep', { language: 'hu' })).toBe('clean-deep')
  })
})
