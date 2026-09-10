import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createModelClient, modelClientFrom } from './client.js'
import type { ModelConfig } from '../config.js'

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

const CFG: ModelConfig = {
  baseUrl: 'https://gateway.example/v1',
  apiKey: 'teszt-kulcs',
  models: { draft: 'draft-model', judge: 'judge-model' },
  pricing: {
    draft: { inputPerMillion: 1, outputPerMillion: 1 },
    judge: { inputPerMillion: 1, outputPerMillion: 1 },
  },
  costLimitUsd: 1,
}

/**
 * Hamis `fetch`: elkapja a kimenő kérés törzsét, és konzerv választ ad.
 *
 * Ez az egyetlen módja annak, hogy a **ténylegesen elküldött** kérésről
 * állítsunk valamit. Egy olyan teszt, ami azt nézi, hogy a kliens
 * `supportsStructuredOutputs: true`-val hívja a providert, a konfigurációt
 * ismételné meg, nem a viselkedést írná le.
 */
function keresElkapo(): {
  torzs: () => Record<string, unknown>
  fetch: typeof globalThis.fetch
} {
  let latott: Record<string, unknown> | undefined
  const fetch: typeof globalThis.fetch = (_input, init) => {
    latott = JSON.parse(init?.body as string) as Record<string, unknown>
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'draft-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"answer":"igen"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
  }
  return { torzs: () => latott!, fetch }
}

describe('createModelClient', () => {
  it('a kimenő kérés a sémát viszi, nem csak „adj JSON-t" utasítást', async () => {
    const elkapo = keresElkapo()
    const client = createModelClient(CFG, elkapo.fetch)

    const result = await client.generateObject(
      'draft',
      'kérdés',
      z.object({ answer: z.string() }),
    )

    expect(result.value).toEqual({ answer: 'igen' })

    const rf = elkapo.torzs().response_format as {
      type: string
      json_schema?: { schema?: { properties?: Record<string, unknown> } }
    }
    // A javítás előtt itt `json_object` áll, séma nélkül: a modell csak annyit
    // tud, hogy „valamilyen JSON-t adj", a mezőket nem.
    expect(rf.type).toBe('json_schema')
    expect(rf.json_schema?.schema?.properties).toHaveProperty('answer')
  })
})
