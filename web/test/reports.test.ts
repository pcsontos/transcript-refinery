import { describe, expect, it } from 'vitest'
import { barTickLabel } from '../app/utils/reports'

describe('barTickLabel', () => {
  it('egész osztásjelre az oszlop feliratát adja', () => {
    expect(barTickLabel(['első', 'második'], 1)).toBe('második')
  })

  it('két-három oszlopnál a d3 tört osztásjelei üres feliratot kapnak, nem a szomszéd oszlopét', () => {
    expect(barTickLabel(['első', 'második'], 0.5)).toBe('')
    expect(barTickLabel(['a', 'b', 'c'], 1.5)).toBe('')
  })

  it('tartományon kívüli osztásjelre üres', () => {
    expect(barTickLabel(['első'], 3)).toBe('')
  })
})
