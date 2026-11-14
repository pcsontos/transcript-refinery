import { describe, expect, it } from 'vitest'
import { afterMarker } from './after.js'

describe('afterMarker', () => {
  it('utólépés nélkül nincs jelölő', () => {
    expect(afterMarker({ whisperAfter: null }, 'cli')).toBeUndefined()
  })

  it('utólépéssel a leadó azonosítója', () => {
    expect(afterMarker({ whisperAfter: { recipes: ['summary'], notify: true } }, '7:fetch-7')).toBe('7:fetch-7')
  })
})
