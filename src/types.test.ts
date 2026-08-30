import { describe, expect, it } from 'vitest'
import { CAPTION_SOURCES } from './types.js'

describe('types', () => {
  it('a felirat-eredet két értéket vesz fel', () => {
    expect(CAPTION_SOURCES).toEqual(['creator', 'auto'])
  })
})
