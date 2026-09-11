import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { summaryRecipe } from './summary.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Some Channel/Agent orchestration explained.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Agent orchestration explained',
  title: 'Agent orchestration explained',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Some Channel' },
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

  it('alapból nem enged javító kört — a mérés (2026-09-09) szerint nem térül meg', () => {
    expect(summaryRecipe.maxIterations).toBe(0)
  })

  it('rubrikája mind a négy kritériumot tartalmazza, a formátumot elsőként', () => {
    const nevek = summaryRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'language', 'faithfulness', 'coverage'])
    expect(summaryRecipe.rubric.criteria[0]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat és a cím', () => {
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toContain('The speaker explains A, then B.')
    expect(prompt).toContain('Agent orchestration explained')
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

  it('a prompt SOHA nem tartalmaz Channel: sort, metaadattal sem', () => {
    // Ez a hiba magja: a `Channel:` sorból a modell a beszélő nevére, abból
    // pedig kimeneti nyelvre következtetett. Kontrollált A/B igazolta, hogy
    // a sor eltávolítása megszünteti a sodródást (`0009`).
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toContain('Title: Agent orchestration explained')
    expect(prompt).not.toContain('Channel:')
    expect(prompt).not.toContain('Some Channel')

    const repairPrompt = summaryRecipe.repairPrompt({
      ...INPUT,
      previous: 'placeholder',
      gaps: ['placeholder'],
    })
    expect(repairPrompt).toContain('Title: Agent orchestration explained')
    expect(repairPrompt).not.toContain('Channel:')
    expect(repairPrompt).not.toContain('Some Channel')
  })
})
