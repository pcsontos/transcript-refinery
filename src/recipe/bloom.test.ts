import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { refine } from '../refine/loop.js'
import type { SourceItem } from '../types.js'
import {
  BLOOM_LEVELS,
  BloomSchema,
  bloomRecipe,
  checkBloom,
  renderBloom,
  type Bloom,
  type BloomLevel,
} from './bloom.js'

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

const INPUT = { item: ITEM, transcript: 'A, majd B.', timed: [] }

const kartya = (level: BloomLevel, n: number) => ({
  level,
  difficulty: 'beginner' as const,
  question: `${level} question ${String(n)}?`,
  answer: `Answer ${level} ${String(n)}.`,
  explanation: `Because ${level} ${String(n)}.`,
})

/** Szabályos pakli: mind a hat szinten három kártya. */
const PAKLI: Bloom = {
  cards: BLOOM_LEVELS.flatMap((level) => [1, 2, 3].map((n) => kartya(level, n))),
}

describe('BloomSchema', () => {
  it('ismeretlen szintet elutasít', () => {
    const rossz = { cards: [{ ...kartya('apply', 1), level: 'memorize' }] }
    expect(BloomSchema.safeParse(rossz).success).toBe(false)
  })

  it('üres paklit elutasít', () => {
    expect(BloomSchema.safeParse({ cards: [] }).success).toBe(false)
  })

  it('csupa szóköz magyarázatot elutasít', () => {
    const rossz = { cards: [{ ...kartya('apply', 1), explanation: '   ' }] }
    expect(BloomSchema.safeParse(rossz).success).toBe(false)
  })

  it('a széli szóközöket levágja', () => {
    const parsed = BloomSchema.parse({ cards: [{ ...kartya('apply', 1), answer: '  Igen.  ' }] })
    expect(parsed.cards[0]!.answer).toBe('Igen.')
  })
})

describe('renderBloom', () => {
  it('egy kártyát kérdés, válasz, magyarázat és címkesor alakban ír', () => {
    expect(renderBloom({ cards: [{ ...kartya('apply', 1), difficulty: 'intermediate' }] })).toBe(
      '## apply question 1?\n\nAnswer apply 1.\n\n**Why:** Because apply 1.\n\n*Apply · Intermediate*',
    )
  })

  it('szintsorrendbe rendez, szinten belül megtartja a modell sorrendjét', () => {
    const rendered = renderBloom({
      cards: [kartya('create', 1), kartya('remember', 2), kartya('remember', 1)],
    })
    const kerdesek = [...rendered.matchAll(/^## (.*)$/gm)].map((m) => m[1])
    expect(kerdesek).toEqual(['remember question 2?', 'remember question 1?', 'create question 1?'])
  })

  it('a kérdés sortörését egyetlen sorrá olvasztja', () => {
    const rendered = renderBloom({ cards: [{ ...kartya('apply', 1), question: 'Mi az\nA?' }] })
    expect(rendered).toContain('## Mi az A?')
  })

  it('a válaszban és a magyarázatban lévő `##` sort elfedi', () => {
    const rendered = renderBloom({
      cards: [{ ...kartya('apply', 1), answer: '## Fantom', explanation: 'Első.\n## Fantom' }],
    })
    expect(rendered.match(/^## /gm)).toHaveLength(1)
  })
})

describe('checkBloom', () => {
  it('szabályos paklira 1-et ad, hiányok nélkül', () => {
    expect(checkBloom(renderBloom(PAKLI))).toEqual({ value: 1, gaps: [] })
  })

  it('ha egy szinten kevés a kártya, megnevezi a szintet és a darabszámot', () => {
    const keves = {
      cards: PAKLI.cards.filter((c) => !(c.level === 'apply' && c.question.endsWith('3?'))),
    }
    const score = checkBloom(renderBloom(keves))
    expect(score.value).toBe(0)
    expect(score.gaps).toEqual([
      'The level "Apply" has 2 card(s). Write 3 to 5 cards for every level.',
    ])
  })

  it('ha egy szinten ötnél több kártya van, azt is megfogja', () => {
    const sok = {
      cards: [...PAKLI.cards, kartya('evaluate', 4), kartya('evaluate', 5), kartya('evaluate', 6)],
    }
    expect(checkBloom(renderBloom(sok)).gaps).toEqual([
      'The level "Evaluate" has 6 card(s). Write 3 to 5 cards for every level.',
    ])
  })

  it('a címkesor nélküli kártyát megnevezi', () => {
    const rendered = `${renderBloom(PAKLI)}\n\n## Címke nélkül?\n\nCsak válasz.`
    expect(checkBloom(rendered).gaps).toContain(
      'The card "Címke nélkül?" does not end with a level label.',
    )
  })

  it('az ismétlődő kérdést a közös ellenőrzés megfogja', () => {
    const ismetlodo = {
      cards: [...PAKLI.cards.slice(0, -1), { ...kartya('create', 3), question: 'CREATE question 1?' }],
    }
    expect(checkBloom(renderBloom(ismetlodo)).gaps.join(' ')).toMatch(/same question/)
  })

  it('a gap-üzenetek angolul szólnak, mert visszamennek a modellnek', () => {
    const score = checkBloom(renderBloom({ cards: [kartya('apply', 1)] }))
    expect(score.gaps.join(' ')).not.toMatch(/[áéíóöőúüű]/i)
  })
})

describe('bloomRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(bloomRecipe.id).toBe('bloom')
    expect(bloomRecipe.outputFile).toBe('_bloom.md')
  })

  it('publikálható, draft szerepű, javító kör nélküli, sémás recept', () => {
    expect(bloomRecipe.publishable).toBe(true)
    expect(bloomRecipe.role).toBe('draft')
    expect(bloomRecipe.maxIterations).toBe(0)
    expect(bloomRecipe.structured).toBeDefined()
  })

  it('decks címkét kap, hogy a Decks plugin paklinak ismerje fel', () => {
    expect(bloomRecipe.tags).toEqual(['decks'])
  })

  it('a kimeneti aránya a 0,1-es alapértelmezés fölött van', () => {
    expect(bloomRecipe.outputRatio).toBeGreaterThan(0.1)
  })

  it('rubrikája öt kritérium, az első három blokkoló', () => {
    const nevek = bloomRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual([
      'format',
      'bloom-format',
      'language',
      'pedagogical-faithfulness',
      'coverage',
    ])
    expect(bloomRecipe.rubric.criteria.slice(0, 3).every((c) => c.blocking === true)).toBe(true)
    expect(bloomRecipe.rubric.criteria.slice(3).every((c) => c.blocking === undefined)).toBe(true)
  })

  it('a prompt kéri a szintenkénti 3–5 kártyát, és benne van az átirat és a cím', () => {
    const prompt = bloomRecipe.prompt(INPUT)
    expect(prompt).toContain('3 to 5 cards for every level')
    expect(prompt).toContain('A, majd B.')
    expect(prompt).toContain('Title: Cím')
  })

  it('a prompt a pedagógiai szabályt idézi, nem a RULE.traceable-t', () => {
    const prompt = bloomRecipe.prompt(INPUT)
    expect(prompt).toContain('must never contradict the transcript')
    expect(prompt).not.toContain('Do not add outside')
  })

  it('a prompt SOHA nem tartalmaz Channel: sort', () => {
    expect(bloomRecipe.prompt(INPUT)).not.toContain('Channel:')
    expect(bloomRecipe.prompt(INPUT)).not.toContain('Csatorna')
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = bloomRecipe.repairPrompt({
      ...INPUT,
      previous: '## Régi kérdés?\n\nRégi válasz.',
      gaps: ['The level "Apply" has 2 card(s).'],
    })
    expect(prompt).toContain('The level "Apply" has 2 card(s).')
    expect(prompt).toContain('## Régi kérdés?')
  })

  it('rossz kártyaszámnál a bírók el sem indulnak, és a hiány megnevezi a szintet', async () => {
    const szerepek: string[] = []
    const client: ModelClient = {
      generate: () => Promise.reject(new Error('a recept sémás, szöveges hívás nem lehet')),
      generateObject: (role) => {
        szerepek.push(role)
        // Az első Remember-kártya hiányzik: a szinten csak kettő marad.
        return Promise.resolve({
          value: { cards: PAKLI.cards.slice(1) } as never,
          usage: { inputTokens: 1, outputTokens: 1 },
        })
      },
    }

    const result = await refine(bloomRecipe, INPUT, client)

    expect(szerepek).toEqual(['draft'])
    expect(result.score).toBe(0)
    expect(result.gaps).toEqual([
      'The level "Remember" has 2 card(s). Write 3 to 5 cards for every level.',
    ])
  })
})
