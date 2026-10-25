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

  it('hiányzó kötelező mezőt megnevezi', () => {
    const { title: _t, ...nincs } = FIELDS
    expect(frontmatterError('X/summary.hu.mdx', nincs)).toBe('X/summary.hu.mdx: hiányzik: title')
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
