import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ModelClient } from '../model/client.js'
import { structuredOutput } from '../recipe/structured.js'
import type { Recipe } from '../recipe/types.js'
import type { Criterion } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { refine } from './loop.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'proba',
  sourceFile: 'Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: {
    channel: 'Csatorna',
    uploadedAt: '2026-07-14',
    url: 'https://example.com',
  },
}

const INPUT = { item: ITEM, transcript: 'az átirat' }

/**
 * Kliens, ami a generáláskor sorban adja vissza a szövegeket, a pontozáskor
 * pedig a szöveghez rendelt pontszámot. Így a loop minden ága vezérelhető.
 */
function scriptedClient(script: { text: string; score: number }[]) {
  let i = 0
  const generalt: string[] = []
  const promptok: string[] = []
  const pontszamok = new Map(script.map((s) => [s.text, s.score]))

  const client: ModelClient = {
    generate: (_role, prompt) => {
      const step = script[Math.min(i, script.length - 1)]!
      i++
      promptok.push(prompt)
      generalt.push(step.text)
      return Promise.resolve({
        value: step.text,
        usage: { inputTokens: 100, outputTokens: 10 },
      })
    },
    generateObject: () => Promise.reject(new Error('a teszt-rubrika nem hív modellt')),
  }

  return { client, generalt, promptok, pontszamok }
}

/** Rubrika, ami a kimenet szövegéhez rendelt pontszámot adja vissza. */
function tablazatosRubrika(pontszamok: Map<string, number>): Criterion[] {
  return [
    {
      name: 'proba',
      score: (ctx) =>
        Promise.resolve({
          value: pontszamok.get(ctx.output) ?? 0,
          gaps: ['valami hiányzik'],
        }),
    },
  ]
}

function recept(criteria: Criterion[], maxIterations = 2): Recipe {
  return {
    id: 'proba',
    outputFile: '_proba.md',
    publishable: true,
    role: 'draft',
    maxIterations,
    prompt: () => 'ELSŐ PROMPT',
    repairPrompt: ({ gaps }) => `JAVÍTÓ PROMPT: ${gaps.join(', ')}`,
    rubric: { criteria, passThreshold: 0.8 },
  }
}

describe('refine', () => {
  it('elsőre átmenő kimenetnél egyetlen generálás történik', async () => {
    const { client, generalt, pontszamok } = scriptedClient([{ text: 'jó', score: 0.9 }])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.generations).toBe(1)
    expect(result.output).toBe('jó')
    expect(result.score).toBe(0.9)
    expect(generalt).toEqual(['jó'])
  })

  it('javuló második körnél a jobbat adja vissza', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.generations).toBe(2)
    expect(result.output).toBe('jobb')
    expect(result.score).toBe(0.9)
  })

  it('a hiányok bekerülnek a javító promptba', async () => {
    const { client, promptok, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(promptok[0]).toBe('ELSŐ PROMPT')
    expect(promptok[1]).toBe('JAVÍTÓ PROMPT: valami hiányzik')
  })

  it('nem-javulási őr: rosszabb kört eldob, és megáll', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'kozepes', score: 0.6 },
      { text: 'rosszabb', score: 0.3 },
      { text: 'sosem-jut-idaig', score: 1 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.output).toBe('kozepes')
    expect(result.score).toBe(0.6)
    expect(generalt).toEqual(['kozepes', 'rosszabb'])
  })

  it('az azonos pontszámú kört is megállásnak veszi', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'a', score: 0.6 },
      { text: 'b', score: 0.6 },
      { text: 'c', score: 1 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.output).toBe('a')
    expect(generalt).toEqual(['a', 'b'])
  })

  it('az iterációkorlát legfeljebb három generálást enged', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'a', score: 0.1 },
      { text: 'b', score: 0.2 },
      { text: 'c', score: 0.3 },
      { text: 'd', score: 0.4 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.generations).toBe(3)
    expect(generalt).toEqual(['a', 'b', 'c'])
    expect(result.output).toBe('c')
  })

  it('a korlát felülbírálható nullára: pontosan egy generálás', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'a', score: 0.1 },
      { text: 'b', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client, {
      maxIterations: 0,
    })

    expect(result.generations).toBe(1)
    expect(generalt).toEqual(['a'])
  })

  it('összegzi a generálások és a pontozások token-felhasználását', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    // Két generálás × (100 be, 10 ki). A teszt-rubrika nem hív modellt.
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 })
  })

  it('a végső hiánylistát a megtartott kimenethez adja vissza', async () => {
    const { client, pontszamok } = scriptedClient([{ text: 'jó', score: 0.9 }])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.gaps).toEqual(['valami hiányzik'])
  })

  it('a pontozás mindig az eredeti átiratot kapja, nem a korábbi kimenetet', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])
    const latottAtiratok: string[] = []
    const criteria: Criterion[] = [
      {
        name: 'proba',
        score: (ctx) => {
          latottAtiratok.push(ctx.transcript)
          return Promise.resolve({ value: pontszamok.get(ctx.output) ?? 0, gaps: [] })
        },
      },
    ]

    await refine(recept(criteria), INPUT, client)

    expect(latottAtiratok).toEqual([INPUT.transcript, INPUT.transcript])
  })
})

/**
 * Kliens, ami **csak** a sémás úton válaszol: a `generate` hívása hiba. Így a
 * teszt bizonyítja, hogy a strukturált recept tényleg a sémás ágon megy.
 */
function strukturaltKliens(valaszok: { cards: string[] }[]): ModelClient {
  let i = 0
  return {
    generate: () => Promise.reject(new Error('prózautat hívott a strukturált recept')),
    generateObject: <T>() => {
      const valasz = valaszok[Math.min(i, valaszok.length - 1)]!
      i++
      return Promise.resolve({
        value: valasz as T,
        usage: { inputTokens: 100, outputTokens: 10 },
      })
    },
  }
}

const Cards = z.object({ cards: z.array(z.string()) })

/** Kártyák → Markdown; a teszt ezen a renderelt alakon méri a pontozást. */
const kartyakRenderelese = structuredOutput(Cards, (v: { cards: string[] }) =>
  v.cards.map((c) => `- ${c}`).join('\n'),
)

describe('refine — strukturált recept', () => {
  it('a sémás úton generál, és a RENDERELT Markdownt pontozza', async () => {
    const pontszamok = new Map([['- egy\n- kettő', 0.9]])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok)),
      structured: kartyakRenderelese,
    }

    const result = await refine(recipe, INPUT, strukturaltKliens([{ cards: ['egy', 'kettő'] }]))

    expect(result.output).toBe('- egy\n- kettő')
    expect(result.score).toBe(0.9)
    expect(result.generations).toBe(1)
  })

  it('a javító kör is a sémás úton megy, és a jobbik kimenetet tartja meg', async () => {
    const pontszamok = new Map([
      ['- gyenge', 0.4],
      ['- jobb', 0.95],
    ])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok)),
      structured: kartyakRenderelese,
    }

    const result = await refine(
      recipe,
      INPUT,
      strukturaltKliens([{ cards: ['gyenge'] }, { cards: ['jobb'] }]),
    )

    expect(result.output).toBe('- jobb')
    expect(result.generations).toBe(2)
  })

  it('a javító prompt a RENDERELT Markdownt kapja előzményként, nem az objektumot', async () => {
    const elozmenyek: string[] = []
    const pontszamok = new Map([
      ['- gyenge', 0.4],
      ['- jobb', 0.95],
    ])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok)),
      structured: kartyakRenderelese,
      repairPrompt: ({ previous }) => {
        elozmenyek.push(previous)
        return 'JAVÍTÓ PROMPT'
      },
    }

    await refine(recipe, INPUT, strukturaltKliens([{ cards: ['gyenge'] }, { cards: ['jobb'] }]))

    expect(elozmenyek).toEqual(['- gyenge'])
  })

  it('a sémás hívások használatát is összegzi', async () => {
    const pontszamok = new Map([
      ['- gyenge', 0.4],
      ['- jobb', 0.95],
    ])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok)),
      structured: kartyakRenderelese,
    }

    const result = await refine(
      recipe,
      INPUT,
      strukturaltKliens([{ cards: ['gyenge'] }, { cards: ['jobb'] }]),
    )

    // Két sémás generálás × {100, 10}; a rubrika itt determinisztikus, nem költ.
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 })
  })
})
