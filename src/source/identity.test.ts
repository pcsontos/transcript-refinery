import { describe, expect, it } from 'vitest'
import { itemIdFor } from './identity.js'

describe('itemIdFor', () => {
  it('a videóazonosítót használja, ha van', () => {
    expect(itemIdFor('youtube', 'csatorna/video', 'dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('metaadat nélkül stabil hasht ad ugyanarra a bemenetre', () => {
    const a = itemIdFor('youtube', 'csatorna/video')
    const b = itemIdFor('youtube', 'csatorna/video')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('más forrásban ugyanaz az útvonal más azonosítót kap', () => {
    expect(itemIdFor('youtube', 'a/b')).not.toBe(itemIdFor('meetings', 'a/b'))
  })

  it('más útvonal más azonosítót kap', () => {
    expect(itemIdFor('youtube', 'a/b')).not.toBe(itemIdFor('youtube', 'a/c'))
  })
})
