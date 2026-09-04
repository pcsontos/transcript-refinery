import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { summaryRecipe } from './summary.js'

const ITEM: SourceItem = {
  videoId: 'abc123',
  title: 'Agent orchestration explained',
  channel: 'Some Channel',
  uploadedAt: '2026-07-14',
  url: 'https://www.youtube.com/watch?v=abc123',
  subtitlePath: '/nem/szamit.srt',
  mediaPath: null,
}

const INPUT = { item: ITEM, transcript: 'The speaker explains A, then B.' }

describe('summaryRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(summaryRecipe.id).toBe('summary')
    expect(summaryRecipe.outputFile).toBe('_summary.md')
  })

  it('publikálható, és a draft szerepet kéri', () => {
    expect(summaryRecipe.publishable).toBe(true)
    expect(summaryRecipe.role).toBe('draft')
  })

  it('alapból két javító kört enged, tehát három generálást', () => {
    expect(summaryRecipe.maxIterations).toBe(2)
  })

  it('rubrikája mindhárom kritériumot tartalmazza, a formátumot elsőként', () => {
    const nevek = summaryRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'faithfulness', 'coverage'])
    expect(summaryRecipe.rubric.criteria[0]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat, a cím és a csatorna', () => {
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toContain('The speaker explains A, then B.')
    expect(prompt).toContain('Agent orchestration explained')
    expect(prompt).toContain('Some Channel')
  })

  it('a prompt megtiltja a fordítást — a jegyzet nyelve a forrás nyelve', () => {
    expect(summaryRecipe.prompt(INPUT)).toMatch(/do not translate/i)
  })

  it('a prompt megtiltja a frontmattert és a wikilinket', () => {
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toMatch(/frontmatter/i)
    expect(prompt).toMatch(/wikilink/i)
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = summaryRecipe.repairPrompt({
      ...INPUT,
      previous: '## Korábbi jegyzet',
      gaps: ['B is missing', 'Claim X is unsupported'],
    })
    expect(prompt).toContain('B is missing')
    expect(prompt).toContain('Claim X is unsupported')
    expect(prompt).toContain('## Korábbi jegyzet')
    expect(prompt).toContain('The speaker explains A, then B.')
  })

  it('a javító prompt megtartásra utasít, nem újraírásra', () => {
    const prompt = summaryRecipe.repairPrompt({
      ...INPUT,
      previous: 'x',
      gaps: ['y'],
    })
    expect(prompt).toMatch(/do not rewrite/i)
  })
})
