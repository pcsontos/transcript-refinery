import { describe, expect, it } from 'vitest'
import { kindLabel } from '../app/utils/format'

describe('kindLabel', () => {
  it('az ismert típus magyar nevét adja', () => {
    expect(kindLabel('clean')).toBe('tisztított leirat')
  })

  it('a fordítás a forrás címkéjét kapja a célnyelvvel', () => {
    expect(kindLabel('clean-hu')).toBe('tisztított leirat (hu)')
  })

  it('ismeretlen típusnál maga az azonosító', () => {
    expect(kindLabel('nincs-hu')).toBe('nincs-hu')
    expect(kindLabel('valami')).toBe('valami')
  })
})
