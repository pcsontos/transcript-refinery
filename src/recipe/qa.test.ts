import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { qaRecipe } from './qa.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Csatorna/Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Csatorna' },
}

const INPUT = { item: ITEM, transcript: 'The speaker explains A, then B.' }

describe('qaRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(qaRecipe.id).toBe('qa')
    expect(qaRecipe.outputFile).toBe('_qa.md')
  })

  it('publikálható, a draft szerepet kéri, és két javító kört enged', () => {
    expect(qaRecipe.publishable).toBe(true)
    expect(qaRecipe.role).toBe('draft')
    expect(qaRecipe.maxIterations).toBe(2)
  })

  it('prózarecept: nem kér sémás kimenetet', () => {
    expect(qaRecipe.structured).toBeUndefined()
  })

  it('rubrikája a három közös kritériumot tartalmazza, a formátumot elsőként', () => {
    const nevek = qaRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'faithfulness', 'coverage'])
    expect(qaRecipe.rubric.criteria[0]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat, a cím és a csatorna', () => {
    const prompt = qaRecipe.prompt(INPUT)
    expect(prompt).toContain('The speaker explains A, then B.')
    expect(prompt).toContain('Cím')
    expect(prompt).toContain('Csatorna')
  })

  it('a prompt megtiltja a fordítást, a frontmattert és a wikilinket', () => {
    const prompt = qaRecipe.prompt(INPUT)
    expect(prompt).toMatch(/do not translate/i)
    expect(prompt).toMatch(/frontmatter/i)
    expect(prompt).toMatch(/wikilink/i)
  })

  it('a prompt megköveteli, hogy a kérdés az átiratból megválaszolható legyen', () => {
    expect(qaRecipe.prompt(INPUT)).toMatch(/answerable from the transcript/i)
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = qaRecipe.repairPrompt({
      ...INPUT,
      previous: '**Mi az A?** Egy dolog.',
      gaps: ['B is missing'],
    })
    expect(prompt).toContain('B is missing')
    expect(prompt).toContain('**Mi az A?** Egy dolog.')
    expect(prompt).toMatch(/do not rewrite/i)
  })

  it('metaadat nélkül nem ír kitalált csatornát a promptba', () => {
    const prompt = qaRecipe.prompt({ item: { ...ITEM, metadata: {} }, transcript: 'A, majd B.' })
    expect(prompt).toContain('Title: Cím')
    expect(prompt).not.toContain('Channel:')
  })
})
