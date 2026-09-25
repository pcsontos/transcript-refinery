import { describe, expect, it } from 'vitest'
import { kindLabel } from '../app/utils/format'

describe('kindLabel', () => {
  it('az ismert típus magyar nevét adja', () => {
    expect(kindLabel('clean')).toBe('tisztított leirat')
  })

  it('a fordítás a forrás címkéjét kapja a célnyelvvel', () => {
    expect(kindLabel('clean-hu')).toBe('tisztított leirat (hu)')
  })

  it('a clean-szintek magyar feliratot kapnak, a fordításuk a célnyelvvel', () => {
    expect(kindLabel('clean-mild')).toBe('tisztított leirat — enyhe')
    expect(kindLabel('clean-moderate')).toBe('tisztított leirat — közepes')
    expect(kindLabel('clean-deep')).toBe('tisztított leirat — erős')
    expect(kindLabel('clean-moderate-hu')).toBe('tisztított leirat — közepes (hu)')
    expect(kindLabel('clean')).toBe('tisztított leirat')
  })

  it('ismeretlen típusnál maga az azonosító', () => {
    expect(kindLabel('nincs-hu')).toBe('nincs-hu')
    expect(kindLabel('valami')).toBe('valami')
  })
})
