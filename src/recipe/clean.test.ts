import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import type { SourceItem } from '../types.js'
import { CLEAN_LEVELS, CLEAN_RECIPES, cleanRecipeFor, type CleanLevel } from './clean.js'

/** A bírónak küldött promptot rögzítő kliens; mindig hibátlan ítéletet ad. */
function biroKliens(prompts: string[]): ModelClient {
  return {
    generate: () => Promise.reject(new Error('a generálás itt nem hívható')),
    generateObject: <T>(_role: unknown, prompt: string) => {
      prompts.push(prompt)
      return Promise.resolve({
        value: { score: 1, gaps: [] } as T,
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    },
  }
}

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
const INPUT = { item: ITEM, transcript: TIMED.map((l) => l.text).join(' '), timed: TIMED }

describe('cleanRecipeFor', () => {
  it('három szint, a vault névkonvenciójába illő azonosítóval és fájlnévvel', () => {
    expect(CLEAN_RECIPES.map((r) => [r.id, r.outputFile])).toEqual([
      ['clean-mild', '_clean-mild.md'],
      ['clean-moderate', '_clean-moderate.md'],
      ['clean-deep', '_clean-deep.md'],
    ])
  })

  it('ugyanarra a szintre ugyanazt az objektumot adja', () => {
    expect(cleanRecipeFor('deep')).toBe(cleanRecipeFor('deep'))
  })

  it('minden szint kéri a töltelékszavak eltávolítását, és egyik sem kéri a megtartásukat', () => {
    for (const level of CLEAN_LEVELS) {
      const prompt = cleanRecipeFor(level).prompt(INPUT)
      expect(prompt).toContain('Remove filler words')
      expect(prompt).not.toContain('Keep filler words')
      expect(prompt).toContain(INPUT.transcript)
    }
  })

  it('a mild nem kér fejlécet és nem enged átfogalmazást', () => {
    const prompt = cleanRecipeFor('mild').prompt(INPUT)
    expect(prompt).toContain('Do not add headings')
    expect(prompt).toContain('Do not summarise')
  })

  it('a moderate a témaváltásnál fejlécet enged', () => {
    expect(cleanRecipeFor('moderate').prompt(INPUT)).toContain('add a `##` heading')
  })

  it('a deep átfogalmaz, de tartalmat nem hagy ki és nem tesz hozzá', () => {
    const prompt = cleanRecipeFor('deep').prompt(INPUT)
    expect(prompt).toContain('rephrase')
    expect(prompt).toContain('Keep every point')
  })

  it('egyik szint promptja sem kér időbélyeget', () => {
    for (const recipe of CLEAN_RECIPES) {
      expect(recipe.prompt(INPUT)).toContain('Do not write timestamps')
    }
  })

  it('a mild és a moderate horgonyzott, a deep nem', () => {
    expect(cleanRecipeFor('mild').anchored).toBe(true)
    expect(cleanRecipeFor('moderate').anchored).toBe(true)
    expect(cleanRecipeFor('deep').anchored).toBeUndefined()
    expect('postprocess' in cleanRecipeFor('deep')).toBe(false)
  })

  it('a horgonyzott szint postprocess-e időbélyeget tesz a bekezdés elé', () => {
    const output = 'So today we are going to talk about storage and why it matters.'
    expect(cleanRecipeFor('moderate').postprocess?.(output, INPUT)).toBe(
      '[00:00] So today we are going to talk about storage and why it matters.',
    )
  })

  it('szintenként pontosan egy modell-bíró pontoz, és a hűségkapu blokkoló', () => {
    for (const recipe of CLEAN_RECIPES) {
      const criteria = recipe.rubric.criteria
      expect(criteria.filter((c) => !c.blocking)).toHaveLength(1)
      expect(criteria.find((c) => c.name === 'fidelity')?.blocking).toBe(true)
    }
  })

  it('a bíró utasítása szintenként más, és a szintre jellemző kitételt tartalmazza', async () => {
    const UNIQUE: Record<CleanLevel, string> = {
      mild: 'Missing headings or sparse paragraphing are NOT gaps',
      moderate: 'Removing a filler word is NOT a gap',
      deep: 'false starts and repetitions are expected',
    }
    const prompts: string[] = []
    for (const level of CLEAN_LEVELS) {
      const judge = cleanRecipeFor(level).rubric.criteria.find((c) => !c.blocking)!
      await judge.score({ transcript: 'NYERS', output: 'TISZTA' }, biroKliens(prompts))
    }
    expect(prompts).toHaveLength(3)
    expect(new Set(prompts).size).toBe(3)
    CLEAN_LEVELS.forEach((level, index) => {
      for (const other of CLEAN_LEVELS) {
        if (other === level) expect(prompts[index]).toContain(UNIQUE[other])
        else expect(prompts[index]).not.toContain(UNIQUE[other])
      }
    })
  })
})
