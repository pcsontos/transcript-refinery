import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { modelClientFrom } from './client.js'

/** Fixture-modell: rögzített szöveget ad vissza, rögzített használattal. */
function fixModell(text: string, inputTokens = 100, outputTokens = 20) {
  return new MockLanguageModelV4({
    // A `doGenerate` a `LanguageModelV4` interfészhez igazodva Promise-t vár
    // vissza; itt nincs mire várni, de az `async` a szerződés, nem hiba.
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: {
          total: inputTokens,
          noCache: inputTokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
      },
      warnings: [],
    }),
  })
}

describe('modelClientFrom', () => {
  it('szöveget generál, és visszaadja a token-felhasználást', async () => {
    const client = modelClientFrom({
      draft: fixModell('Ez a vázlat.', 120, 30),
      judge: fixModell('nem hívjuk'),
    })

    const result = await client.generate('draft', 'Írj vázlatot.')

    expect(result.value).toBe('Ez a vázlat.')
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
  })

  it('a szerep dönti el, melyik modell fut', async () => {
    const client = modelClientFrom({
      draft: fixModell('vázlat'),
      judge: fixModell('ítélet'),
    })

    expect((await client.generate('judge', 'Pontozz.')).value).toBe('ítélet')
  })

  it('sémával validált objektumot generál', async () => {
    const client = modelClientFrom({
      draft: fixModell('{"score":0.8,"gaps":["hiányzik a második pont"]}'),
      judge: fixModell('nem hívjuk'),
    })

    const schema = z.object({ score: z.number(), gaps: z.array(z.string()) })
    const result = await client.generateObject('draft', 'Pontozz.', schema)

    expect(result.value).toEqual({ score: 0.8, gaps: ['hiányzik a második pont'] })
    expect(result.usage.inputTokens).toBe(100)
  })
})
