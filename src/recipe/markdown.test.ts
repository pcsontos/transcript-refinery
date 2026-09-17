import { describe, expect, it } from 'vitest'
import { escapeHeadings, singleLine } from './markdown.js'

describe('escapeHeadings', () => {
  it('az ATX fejlécet elfedi', () => {
    expect(escapeHeadings('## Nem fejléc\nszöveg')).toBe('\\## Nem fejléc\nszöveg')
  })

  it('három szóköz behúzásig a behúzott ATX sort is elfedi, a behúzást megtartja', () => {
    expect(escapeHeadings('  ## Fantom')).toBe('  \\## Fantom')
  })

  it('a négy szóközzel behúzott sort nem bántja: az kódblokk, nem fejléc', () => {
    expect(escapeHeadings('    ## kód')).toBe('    ## kód')
  })

  it('a szövegsor alatti setext aláhúzást elfedi', () => {
    expect(escapeHeadings('Cím\n---')).toBe('Cím\n\\---')
  })

  it('az üres sor utáni `---`-t nem bántja: az nem fejléc', () => {
    expect(escapeHeadings('Első.\n\n---\n\nMásodik.')).toBe('Első.\n\n---\n\nMásodik.')
  })
})

describe('singleLine', () => {
  it('a sortörést és a körülötte álló szóközt egyetlen szóközzé olvasztja', () => {
    expect(singleLine('Mi az\n  A fogalom?')).toBe('Mi az A fogalom?')
  })

  it('a széli szóközt levágja', () => {
    expect(singleLine('  kérdés \n')).toBe('kérdés')
  })
})
