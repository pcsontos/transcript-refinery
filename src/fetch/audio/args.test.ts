import { describe, expect, it } from 'vitest'
import { parseAudioArgs, parsePick } from './args.js'

describe('parseAudioArgs', () => {
  it('több URL elfogadott', () => {
    expect(parseAudioArgs(['a', 'b'])).toMatchObject({ ok: true, args: { inputs: ['a', 'b'] } })
  })
  it('URL és --list együtt hiba', () => {
    expect(parseAudioArgs(['a', '--list', '/l.txt']).ok).toBe(false)
  })
  it('relatív --out hiba', () => {
    expect(parseAudioArgs(['a', '--out', 'rel'])).toEqual({ ok: false, error: 'A --out abszolút útvonal kell legyen.' })
  })
  it('a --sub-lang ismeretlen kapcsoló', () => {
    expect(parseAudioArgs(['a', '--sub-lang', 'hu'])).toEqual({ ok: false, error: 'Ismeretlen kapcsoló: --sub-lang' })
  })
  it('parsePick', () => {
    expect(parsePick('0')).toBe('all')
    expect(parsePick(' 3, 1,3 ')).toEqual([1, 3])
    expect(parsePick('0,2')).toBeNull()
    expect(parsePick('1-3')).toBeNull()
    expect(parsePick('')).toBeNull()
  })
  it('--pick egy címmel elfogadott, többel vagy --listtel hiba', () => {
    expect(parseAudioArgs(['https://f/rss', '--pick', '1,3'])).toMatchObject({ ok: true, args: { inputs: ['https://f/rss'], pick: [1, 3] } })
    expect(parseAudioArgs(['a', 'b', '--pick', '1'])).toEqual({ ok: false, error: 'A --pick csak egyetlen címmel adható meg.' })
    expect(parseAudioArgs(['a', '--pick', 'x'])).toEqual({ ok: false, error: 'A --pick értéke 0, vagy vesszővel elválasztott sorszámok (pl. 1,3).' })
  })
})
