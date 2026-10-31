import { describe, expect, it } from 'vitest'
import { cardsMdx } from './cards.js'
import { type Contract, mdxErrors } from './mdx.js'

// A showroom contract/mdx-components.json kártyákhoz szükséges része.
const CONTRACT: Contract = {
  components: {
    Accordions: { attributes: { type: { type: 'enum', values: ['single', 'multiple'], required: false } } },
    Accordion: { attributes: { title: { type: 'string', required: true } } },
  },
}

const HEADER = '# Cím\n\n🌐 [https://x](<https://x>)'

describe('cardsMdx', () => {
  it('flashcards: kérdésenként egy Accordion, a fejléc elöl', () => {
    const out = cardsMdx(`${HEADER}\n\n## K1\n\nV1\n\n## K2\n\nV2`, 'flashcards')!
    expect(out).toContain('<Accordions type="multiple">')
    expect(out).toContain('<Accordion title="K1">\n\nV1\n\n</Accordion>')
    expect(out).toContain('<Accordion title="K2">')
    expect(out.startsWith(`${HEADER}\n\n<Accordions`)).toBe(true)
  })

  it('bloom: a Why és a szintsor a válaszhoz tartozik', () => {
    const out = cardsMdx('# Cím\n\n## K\n\nV\n\n**Miért:** M\n\n*Megjegyzés · Kezdő*', 'bloom')!
    expect(out).toContain('<Accordion title="K">\n\nV\n\n**Miért:** M\n\n*Megjegyzés · Kezdő*\n\n</Accordion>')
  })

  it('qa: félkövér kérdés-bekezdés', () => {
    const out = cardsMdx('# Cím\n\n**Mi ez?**\n\nV1\n\nV2', 'qa')!
    expect(out).toContain('<Accordion title="Mi ez?">\n\nV1\n\nV2\n\n</Accordion>')
  })

  it('qa: ## **kérdés** alak is', () => {
    expect(cardsMdx('# Cím\n\n## **Mi ez?**\n\nV', 'qa')).toContain('<Accordion title="Mi ez?">')
  })

  it('a válaszban álló félkövér bekezdés nem kérdés flashcardsnál', () => {
    const out = cardsMdx('# Cím\n\n## K\n\n**Teljesen félkövér.**\n\nV', 'flashcards')!
    expect(out.match(/<Accordion title=/g)).toHaveLength(1)
    expect(out).toContain('**Teljesen félkövér.**')
  })

  it('fordítás második címsora a kérdések előtt marad', () => {
    const out = cardsMdx('# Eredeti\n\n🌐 <https://u>\n\n# Fordított cím\n\n## K\n\nV', 'flashcards')!
    expect(out.indexOf('# Fordított cím')).toBeGreaterThan(out.indexOf('🌐'))
    expect(out.indexOf('# Fordított cím')).toBeLessThan(out.indexOf('<Accordions'))
  })

  it('idézőjel és & a címben', async () => {
    const out = cardsMdx('# Cím\n\n## A "b" & {c} <d> *e* `f`\n\nV', 'flashcards')!
    expect(out).toContain('title="A &quot;b&quot; &amp; {c} <d> e f"')
    expect(await mdxErrors(out, CONTRACT)).toEqual([])
  })

  it('%%…%% sor kimarad', () => {
    const out = cardsMdx('# Cím\n\n## K\n\nV\n\n%%dk:h:abc%%', 'flashcards')!
    expect(out).not.toContain('%%')
  })

  it('pontos kimenet (golden)', () => {
    expect(cardsMdx('# C\n\n## K\n\nV', 'flashcards')).toBe(
      '# C\n\n<Accordions type="multiple">\n\n<Accordion title="K">\n\nV\n\n</Accordion>\n\n</Accordions>\n',
    )
  })

  it('bájtra azonos kétszer', () => {
    for (const [body, kind] of [
      ['# C\n\n## K\n\nV', 'flashcards'],
      ['# C\n\n**K**\n\nV', 'qa'],
      ['# C\n\n## K\n\nV\n\n**Why:** M', 'bloom'],
    ] as const) {
      expect(cardsMdx(body, kind)).toBe(cardsMdx(body, kind))
    }
  })

  it('nem bontható törzs null', () => {
    expect(cardsMdx('# Cím\n\nCsak szöveg', 'flashcards')).toBeNull()
    expect(cardsMdx('# Cím\n\n## K', 'flashcards')).toBeNull()
  })
})
