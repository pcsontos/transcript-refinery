import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import { primaryLanguage, queueLayout, splitTranslationId, translationId } from './layout.js'

const FORDITASSAL = queueLayout(
  recipesFor({ translate: { to: 'hu', recipes: ['clean-moderate', 'summary'] }, configPath: '/p/c.yaml' }),
)

describe('queueLayout', () => {
  it('az alapreceptek a regiszter sorrendjében, a fordítások forrás → célnyelv párként', () => {
    expect(FORDITASSAL.recipes).toEqual(['summary', 'flashcards', 'qa', 'clean-mild', 'clean-moderate', 'clean-deep', 'bloom', 'notes'])
    expect([...FORDITASSAL.translations]).toEqual([
      ['clean-moderate', 'hu'],
      ['summary', 'hu'],
    ])
  })

  it('translate kulcs nélkül nincs fordítás', () => {
    const alap = queueLayout(recipesFor({ translate: null, configPath: '/p/c.yaml' }))
    expect(alap.translations.size).toBe(0)
    expect(alap.recipes).toHaveLength(8)
  })
})

describe('translationId és splitTranslationId', () => {
  it('a fordítórecept azonosítója kötőjellel áll össze, és visszabontható', () => {
    expect(translationId('summary', 'hu')).toBe('summary-hu')
    expect(splitTranslationId(FORDITASSAL, 'summary-hu')).toEqual({ source: 'summary', lang: 'hu' })
  })

  it('csak a layoutban szereplő fordítást bontja; alaprecept és ismeretlen fordítás null', () => {
    expect(splitTranslationId(FORDITASSAL, 'qa-hu')).toBeNull()
    expect(splitTranslationId(FORDITASSAL, 'summary')).toBeNull()
    expect(splitTranslationId(FORDITASSAL, 'nincsilyen')).toBeNull()
  })
})

describe('primaryLanguage', () => {
  it('az elsődleges altag kisbetűsítve', () => {
    expect(primaryLanguage('hu')).toBe('hu')
    expect(primaryLanguage('hu-HU')).toBe('hu')
    expect(primaryLanguage('EN')).toBe('en')
    expect(primaryLanguage('pt_BR')).toBe('pt')
  })

  it('hiányzó vagy üres címkére null', () => {
    expect(primaryLanguage(null)).toBeNull()
    expect(primaryLanguage('')).toBeNull()
  })
})
