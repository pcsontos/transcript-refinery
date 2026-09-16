import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { cleanRecipe } from './clean.js'

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

const TIMED = [
  { start: 0, text: 'so today we are going to talk about storage' },
  { start: 3, text: 'and why it matters for your home lab setup' },
]
const INPUT = {
  item: ITEM,
  transcript: TIMED.map((l) => l.text).join(' '),
  timed: TIMED,
}

describe('cleanRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(cleanRecipe.id).toBe('clean')
    expect(cleanRecipe.outputFile).toBe('_clean.md')
  })

  it('a kimeneti aránya a bemenet körül van, nem a tizedénél', () => {
    expect(cleanRecipe.outputRatio).toBeGreaterThan(1)
  })

  it('pontosan egy modell-bíró pontoz', () => {
    const judges = cleanRecipe.rubric.criteria.filter((c) => !c.blocking)
    expect(judges).toHaveLength(1)
  })

  it('a prompt megtiltja az összefoglalást és az időbélyeg írását', () => {
    const prompt = cleanRecipe.prompt(INPUT)
    expect(prompt).toContain('Do not summarise')
    expect(prompt).toContain('Do not write timestamps')
    expect(prompt).toContain(INPUT.transcript)
  })

  it('a postprocess időbélyeget tesz a bekezdés elé', () => {
    const output = 'So today we are going to talk about storage and why it matters.'
    expect(cleanRecipe.postprocess?.(output, INPUT)).toBe(
      '[00:00] So today we are going to talk about storage and why it matters.',
    )
  })
})
