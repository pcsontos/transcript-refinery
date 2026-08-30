import { describe, expect, it } from 'vitest'
import { sanitizeSegment } from './sanitize.js'

describe('sanitizeSegment', () => {
  it('a perjelet nagy törtvonalra cseréli, ahogy a vault meglévő mappái', () => {
    expect(sanitizeSegment('My AI Business Makes Me $362,000/Month')).toBe(
      'My AI Business Makes Me $362,000⧸Month',
    )
  })

  it('az idézőjelet teljes szélességű idézőjelre cseréli', () => {
    expect(sanitizeSegment('"Semmiféle bűntudatuk nincs"')).toBe(
      '＂Semmiféle bűntudatuk nincs＂',
    )
  })

  it('megőrzi az emojit és az ékezetet', () => {
    const cim = 'Ruff MEGDORGÁLTA a Tuzsont 👨‍⚖️ #734'
    expect(sanitizeSegment(cim)).toBe(cim)
  })

  it('idempotens: kétszer futtatva ugyanaz jön ki', () => {
    const once = sanitizeSegment('a/b:c?d')
    expect(sanitizeSegment(once)).toBe(once)
  })

  it('levágja a záró pontot és szóközt, amit a macOS nem szeret', () => {
    expect(sanitizeSegment('Here is What Will. ')).toBe('Here is What Will')
  })

  it('eltávolítja a vezérlőkaraktereket', () => {
    const withBell = 'a' + String.fromCharCode(7) + 'bc'
    expect(sanitizeSegment(withBell)).toBe('abc')
  })

  it('nem üres eredményt ad akkor is, ha minden karakter elveszne', () => {
    expect(sanitizeSegment('...')).toBe('névtelen')
  })
})
