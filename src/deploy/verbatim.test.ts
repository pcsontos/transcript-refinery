import { describe, expect, it } from 'vitest'
import { takeIntro, verbatimError } from './verbatim.js'

const ORIGINAL = 'Az első mondat. A második mondat. A harmadik mondat.'

describe('verbatimError', () => {
  it('tagolt, kiemelt kimenet egyezik', () => {
    const output = '## Új cím\n\nAz első mondat. **A második mondat.**\n\nA *harmadik* mondat.'
    expect(verbatimError(ORIGINAL, output)).toBeNull()
  })

  it('komponens és címe nem számít', () => {
    const output = '<Callout type="tip" title="Bármi">\nAz első mondat.\n</Callout>\n\n<Steps>\n<Step>\nA második mondat. A harmadik mondat.\n</Step>\n</Steps>'
    expect(verbatimError(ORIGINAL, output)).toBeNull()
  })

  it('felsorolásból számozott lista vagy Steps lesz', () => {
    expect(verbatimError('- a\n- b', '1. a\n2. b')).toBeNull()
  })

  it('eredeti cím szintje változhat, szövege nem', () => {
    expect(verbatimError('## Példa\n\nSzöveg', '### Példa\n\nSzöveg')).toBeNull()
    expect(verbatimError('## Példa\n\nSzöveg', '### Egy példa\n\nSzöveg')).not.toBeNull()
  })

  it('kicserélt szó bukik', () => {
    expect(verbatimError(ORIGINAL, 'Az első mondat. A második szöveg. A harmadik mondat.')).toContain('szónál')
  })

  it('törölt mondat bukik', () => {
    expect(verbatimError(ORIGINAL, 'Az első mondat. A harmadik mondat.')).toContain('szónál')
  })

  it('felcserélt két szó bukik', () => {
    expect(verbatimError(ORIGINAL, 'Az első mondat. A mondat második. A harmadik mondat.')).toContain('szónál')
  })

  it('escape-elt kapcsos és kacsacsőr nem eltérés', () => {
    expect(verbatimError('a {b} < c', 'a \\{b\\} \\< c')).toBeNull()
  })

  it('autolinkből lett link nem eltérés', () => {
    expect(verbatimError('lásd <https://x.hu>', 'lásd [https://x.hu](<https://x.hu>)')).toBeNull()
    expect(verbatimError('[szöveg](https://y)', '[szöveg](https://y)')).toBeNull()
    expect(verbatimError('[szöveg](https://y)', '[szöveg](https://z)')).not.toBeNull()
  })

  it('kódblokk egy egység', () => {
    const code = '```mermaid\ngraph TD\n  A --> B\n```'
    expect(verbatimError(`Előtte.\n\n${code}`, `Előtte.\n\n${code}`)).toBeNull()
    expect(verbatimError(code, code.replace('B', 'C'))).not.toBeNull()
    expect(verbatimError(code, '```mermaid\ngraph TD\nA --> B\n\n```')).toBeNull()
  })

  it('kódkerítésbe csomagolt kimenet bukik', () => {
    expect(verbatimError(ORIGINAL, `\`\`\`mdx\n${ORIGINAL}\n\`\`\``)).not.toBeNull()
  })

  it('kis- és nagybetű számít', () => {
    expect(verbatimError('alma', 'Alma')).not.toBeNull()
  })

  it('NFC', () => {
    expect(verbatimError('ég', 'ég')).toBeNull()
  })

  it('hiányzó vég és többlet', () => {
    expect(verbatimError(ORIGINAL, 'Az első mondat.')).toContain('hiányzik')
    expect(verbatimError('Az első mondat.', ORIGINAL)).toContain('többlet')
  })
})

describe('takeIntro', () => {
  const title = 'Röviden'

  it('helyes blokk', () => {
    expect(takeIntro(`<Callout type="note" title="Röviden">\nÖsszefoglaló.\n</Callout>\n\n## Rész\n\nSzöveg.`, title)).toEqual({
      intro: 'Összefoglaló.',
      rest: '## Rész\n\nSzöveg.',
    })
  })

  it('más cím, üres blokk, nem a blokkal kezdődő kimenet null', () => {
    expect(takeIntro('<Callout type="note" title="Más">\nX.\n</Callout>', title)).toBeNull()
    expect(takeIntro('<Callout type="note" title="Röviden">\n \n</Callout>\n\nSzöveg', title)).toBeNull()
    expect(takeIntro('Szöveg\n\n<Callout type="note" title="Röviden">\nX.\n</Callout>', title)).toBeNull()
  })
})
