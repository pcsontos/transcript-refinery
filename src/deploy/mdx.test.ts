import { compile } from '@mdx-js/mdx'
import { describe, expect, it } from 'vitest'
import { frontmatter } from '../serve/notes.js'
import { type Contract, escapeMdx, frontmatterError, mdxErrors, renderMdx } from './mdx.js'

// A showroom contract/mdx-components.json mai tartalmának másolata (f1d7f0d).
const CONTRACT: Contract = {
  components: {
    Callout: {
      attributes: {
        type: { type: 'enum', values: ['note', 'tip', 'warning'], required: false },
        title: { type: 'string', required: false },
      },
    },
    Cards: { attributes: {} },
    Card: {
      attributes: {
        title: { type: 'string', required: true },
        href: { type: 'string', required: false },
        description: { type: 'string', required: false },
      },
    },
    Steps: { attributes: {} },
    Step: { attributes: {} },
    Accordions: { attributes: { type: { type: 'enum', values: ['single', 'multiple'], required: false } } },
    Accordion: { attributes: { title: { type: 'string', required: true } } },
    Tabs: { attributes: {} },
    Tab: { attributes: { title: { type: 'string', required: true } } },
  },
}

const FIELDS = {
  item_id: 'X',
  title: 'Cím',
  kind: 'summary',
  language: 'hu',
  generated_at: 'T1',
  source: 'youtube',
  origin: 'cli',
}

const check = (body: string) => mdxErrors(renderMdx(FIELDS, body), CONTRACT)

describe('escapeMdx', () => {
  it('kódon kívül escape-el, kódban nem', () => {
    expect(escapeMdx('a < b {x} `if (n < 1) {}`')).toBe('a \\< b \\{x\\} `if (n < 1) {}`')
    expect(escapeMdx('```ts\nif (a < b) {}\n```\nután {')).toBe('```ts\nif (a < b) {}\n```\nután \\{')
    expect(escapeMdx('~~~\n{ <\n~~~\n{')).toBe('~~~\n{ <\n~~~\n\\{')
  })

  it('behúzott kódban is escape-el', () => {
    expect(escapeMdx('    a < b')).toBe('    a \\< b')
  })

  it('a már escape-elt jelet nem duplázza', () => {
    expect(escapeMdx('\\{x\\}')).toBe('\\{x\\}')
  })

  // a lefordított kimenet linkjei: a site ugyanezt rendereli
  const hrefs = async (body: string) =>
    [...String(await compile(escapeMdx(body))).matchAll(/href: "([^"]*)"/g)].map((m) => m[1])

  it('az autolink működő link marad', async () => {
    expect(await hrefs('🌐 <https://www.youtube.com/watch?v=a_b>')).toEqual(['https://www.youtube.com/watch?v=a_b'])
    expect(await hrefs('<https://a.com/{id}*x*>')).toEqual(['https://a.com/%7Bid%7D*x*'])
    // a link szövegében sem lehet kifejezés
    expect(await check(escapeMdx('<https://a.com/{id}*x*>'))).toEqual([])
  })

  it('a <…> link-cél működő link marad', async () => {
    expect(await hrefs('[t](<./f á.md>) és [u](<https://a.com/x>)')).toEqual(['./f%20%C3%A1.md', 'https://a.com/x'])
  })

  it('a soron belüli HTML-komment kimarad', () => {
    expect(escapeMdx('a <!-- rejtett --> b')).toBe('a  b')
  })
})

describe('mdxErrors', () => {
  it('HTML-komment és <br> lefordul', async () => {
    expect(await check(escapeMdx('<!-- x -->\n\nsor<br>'))).toEqual([])
  })

  it('tipikus vault-jegyzet lefordul', async () => {
    const body = [
      '# Cím',
      '',
      '- egy {x}',
      '- kettő <y>',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '[link](https://example.com?a=1&b=2) és <https://example.com>',
      '',
      '```ts',
      'if (a < b) { f() }',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
    ].join('\n')
    expect(await check(escapeMdx(body))).toEqual([])
  })

  it('ismeretlen komponens hibát ad', async () => {
    for (const body of ['<Foo />', '<div>x</div>', '<>x</>']) expect((await check(body)).length).toBeGreaterThan(0)
  })

  it('tiltott attribútumérték hibát ad', async () => {
    expect((await check('<Callout type="danger">x</Callout>')).length).toBeGreaterThan(0)
    expect(await check('<Callout type="note">x</Callout>')).toEqual([])
    expect((await check('<Card />')).length).toBeGreaterThan(0)
    expect((await check('<Tab title={x}>y</Tab>')).length).toBeGreaterThan(0)
  })

  it('a prototípus kulcsai nem engedett nevek', async () => {
    expect(await check('<Callout constructor="x">y</Callout>')).toEqual(['Callout: nem engedett attribútum: constructor'])
    expect(await check('<constructor />')).toEqual(['ismeretlen komponens: constructor'])
  })

  it('kifejezés és import hibát ad', async () => {
    expect((await check('{1 + 1}')).length).toBeGreaterThan(0)
    expect((await check('import X from "y"\n\nszöveg')).length).toBeGreaterThan(0)
  })

  it('le nem forduló MDX hibát ad', async () => {
    expect((await check('<Callout>')).length).toBeGreaterThan(0)
  })
})

describe('frontmatterError', () => {
  const TR = { ...FIELDS, translation_of: 'summary', source_language: 'en', source_generated_at: 'S1' }

  it('jó eredeti és jó fordítás null', () => {
    expect(frontmatterError('X/summary.hu.mdx', FIELDS)).toBeNull()
    expect(frontmatterError('X/summary.hu.mdx', TR)).toBeNull()
  })

  it('a site szabályait érvényesíti', () => {
    expect(frontmatterError('X/summary.de.mdx', FIELDS)).toMatch(/nyelvi suffix/)
    expect(frontmatterError('X/clean.hu.mdx', FIELDS)).toMatch(/kind/)
    expect(frontmatterError('X/summary.hu.mdx', { ...FIELDS, source_language: 'en' })).toMatch(/csak együtt/)
    expect(frontmatterError('X/summary.hu.mdx', { ...TR, translation_of: 'clean' })).toMatch(/translation_of/)
  })

  it('a site sémájának opcionális mezőit típus szerint nézi', () => {
    expect(frontmatterError('X/summary.hu.mdx', { ...FIELDS, url: 'u', description: 'd', icon: 'i', full: true })).toBeNull()
    expect(frontmatterError('X/summary.hu.mdx', { ...FIELDS, url: null })).toBe('X/summary.hu.mdx: nem szöveg: url')
    expect(frontmatterError('X/summary.hu.mdx', { ...FIELDS, description: 1 })).toBe('X/summary.hu.mdx: nem szöveg: description')
    expect(frontmatterError('X/summary.hu.mdx', { ...FIELDS, icon: [] })).toBe('X/summary.hu.mdx: nem szöveg: icon')
    expect(frontmatterError('X/summary.hu.mdx', { ...TR, source_generated_at: new Date() })).toBe(
      'X/summary.hu.mdx: nem szöveg: source_generated_at',
    )
    expect(frontmatterError('X/summary.hu.mdx', { ...FIELDS, full: 'igen' })).toBe('X/summary.hu.mdx: nem logikai: full')
  })

  it('hiányzó kötelező mezőt megnevezi', () => {
    for (const field of Object.keys(FIELDS)) {
      const { [field]: _f, ...nincs } = FIELDS as Record<string, unknown>
      expect(frontmatterError('X/summary.hu.mdx', nincs)).toBe(`X/summary.hu.mdx: hiányzik: ${field}`)
      expect(frontmatterError('X/summary.hu.mdx', { ...nincs, [field]: '' })).toBe(`X/summary.hu.mdx: hiányzik: ${field}`)
    }
  })
})

describe('renderMdx', () => {
  it('kettőspontos, idézőjeles cím a site-szabálynak megfelel', () => {
    const title = 'A: "b" #c'
    const out = renderMdx({ ...FIELDS, title }, 'törzs')
    expect(frontmatter(out)?.title).toBe(title)
    expect(out.endsWith('\n\ntörzs')).toBe(true)
  })
})
