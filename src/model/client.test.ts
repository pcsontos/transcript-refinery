import { APICallError, type FinishReason } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createModelClient, modelClientFrom } from './client.js'
import { retrying } from './retry.js'
import { toolChoiceFallback } from './tool-fallback.js'
import type { ModelConfig } from '../config.js'
import { structuredOutput } from '../recipe/structured.js'
import { judgeCriterion } from '../rubric/judge.js'

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
/**
 * Fixture-modell adott befejezési okkal. A kapu ezt az okot nézi, nem a
 * szöveget — ezért a szöveg minden ilyen tesztben ép marad.
 */
function vegModell(ok: FinishReason, text: string) {
  return new MockLanguageModelV4({
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: ok, raw: undefined },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  })
}

describe('a nem teljes válasz kapuja', () => {
  it('a csonka szöveget hibaként dobja, nem adja vissza', async () => {
    const client = modelClientFrom({
      draft: vegModell('length', 'Az első mondat után elvág'),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generate('draft', 'Tisztítsd.')).rejects.toThrow(/csonka/)
  })

  it('a csonka válasz hibája megnevezi a szerepet és mindkét kiutat', async () => {
    const client = modelClientFrom({
      draft: vegModell('length', 'elvágva'),
      judge: fixModell('nem hívjuk'),
    })

    const hiba = await client.generate('draft', 'Tisztítsd.').catch((e: Error) => e)

    expect(hiba).toBeInstanceOf(Error)
    const uzenet = (hiba as Error).message
    expect(uzenet).toContain('draft')
    expect(uzenet).toContain('max_tokens')
    expect(uzenet).toMatch(/darabol/)
  })

  it('az objektumútvonalon akkor is dob, ha a csonka válasz véletlenül értelmes JSON', async () => {
    const client = modelClientFrom({
      // Érvényes JSON: ha ez átmenne, a kapu helyett a séma-ellenőrzés
      // döntene — az pedig épp a néma féleredményt engedné a vaultba.
      draft: vegModell('length', '{"score":0.8,"gaps":[]}'),
      judge: fixModell('nem hívjuk'),
    })

    const schema = z.object({ score: z.number(), gaps: z.array(z.string()) })

    await expect(client.generateObject('draft', 'Pontozz.', schema)).rejects.toThrow(
      /csonka/,
    )
  })

  it('a tartalomszűrő megállította választ is elutasítja', async () => {
    const client = modelClientFrom({
      draft: vegModell('content-filter', 'félbehagyott'),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generate('draft', 'Tisztítsd.')).rejects.toThrow(/tartalomszűrő/)
  })

  it('a hibával leállt választ is elutasítja', async () => {
    const client = modelClientFrom({
      draft: vegModell('error', 'félbehagyott'),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generate('draft', 'Tisztítsd.')).rejects.toThrow(/draft/)
  })

  it('a judge eszközhívásra végződő válaszát átengedi', async () => {
    const client = modelClientFrom({
      draft: fixModell('nem hívjuk'),
      judge: vegModell('tool-calls', 'ítélet'),
    })

    expect((await client.generate('judge', 'Pontozz.')).value).toBe('ítélet')
  })

  it('ismeretlen okra (`other`) nem kapuz — az a gateway gyűjtőkategóriája', async () => {
    const client = modelClientFrom({
      draft: vegModell('other', 'teljes válasz'),
      judge: fixModell('nem hívjuk'),
    })

    expect((await client.generate('draft', 'Tisztítsd.')).value).toBe('teljes válasz')
  })

  it('a csonkolást nem próbálja újra — ugyanaz a prompt ugyanúgy levágódna', async () => {
    let hivasok = 0
    const client = retrying(
      modelClientFrom({
        draft: new MockLanguageModelV4({
          // eslint-disable-next-line @typescript-eslint/require-await
          doGenerate: async () => {
            hivasok++
            return {
              content: [{ type: 'text' as const, text: 'elvágva' }],
              finishReason: { unified: 'length' as const, raw: undefined },
              usage: {
                inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 20, text: 20, reasoning: undefined },
              },
              warnings: [],
            }
          },
        }),
        judge: fixModell('nem hívjuk'),
      }),
      { attempts: 3, sleep: () => Promise.resolve() },
    )

    await expect(client.generate('draft', 'Tisztítsd.')).rejects.toThrow(/csonka/)
    expect(hivasok).toBe(1)
  })
})

const CFG: ModelConfig = {
  baseUrl: 'https://gateway.example/v1',
  apiKey: 'teszt-kulcs',
  models: { draft: 'draft-model', judge: 'judge-model' },
  recipeModels: {},
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 1, outputPerMillion: 1 },
    judge: { inputPerMillion: 1, outputPerMillion: 1 },
  },
  modelPricing: {},
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
    const client = createModelClient(CFG, { fetch: elkapo.fetch })

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

const SEMA = z.object({ score: z.number(), gaps: z.array(z.string()) })

const OPUS_400 =
  'litellm.BadRequestError: AnthropicException - {"error":{"message":"claude-opus-5-5 does not support forced tool_choice; use auto or none"}}'

/** Egy kérés lényege: sémás (`json`) volt-e, és milyen tool-beállítással ment. */
interface Latott {
  sema: boolean
  toolChoice: string | undefined
  tools: string[]
}

const HASZNALAT = {
  inputTokens: { total: 90, noCache: 90, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
}

/**
 * Opus-szerű fixture: a sémás (`json`) kérést a gateway 400-ával utasítja el,
 * a tool-os kérésre tool-hívást (`tool`) vagy szöveget (`text`) ad. Ha a
 * `hiba` meg van adva, a sémás kérést azzal utasítja el.
 */
function opusModell(opts: {
  tool?: string
  text?: string
  finish?: FinishReason
  hiba?: string
  modelId?: string
  latott?: Latott[]
}) {
  const latott = opts.latott ?? []
  return new MockLanguageModelV4({
    modelId: opts.modelId ?? 'opus-proba',
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async (options) => {
      const sema = options.responseFormat?.type === 'json'
      latott.push({
        sema,
        toolChoice: options.toolChoice?.type,
        tools: (options.tools ?? []).map((t) => t.name),
      })
      if (sema) {
        throw new APICallError({
          message: opts.hiba ?? OPUS_400,
          url: 'http://localhost:4000/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 400,
          isRetryable: false,
        })
      }
      return {
        content:
          opts.tool !== undefined
            ? [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'hivas-1',
                  toolName: 'submit_result',
                  input: opts.tool,
                },
              ]
            : [{ type: 'text' as const, text: opts.text ?? '' }],
        finishReason: {
          unified: opts.finish ?? (opts.tool !== undefined ? 'tool-calls' : 'stop'),
          raw: undefined,
        },
        usage: HASZNALAT,
        warnings: [],
      }
    },
  })
}

/** Sémát támogató fixture, ami elteszi, sémás kérés jött-e. */
function semaModell(text: string, latott: Latott[]) {
  return new MockLanguageModelV4({
    modelId: 'sonnet-proba',
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async (options) => {
      latott.push({
        sema: options.responseFormat?.type === 'json',
        toolChoice: options.toolChoice?.type,
        tools: (options.tools ?? []).map((t) => t.name),
      })
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: HASZNALAT,
        warnings: [],
      }
    },
  })
}

describe('sémás hívás a kényszerített tool_choice elutasítása után', () => {
  it('tool-hívással (auto) adja a validált objektumot', async () => {
    const latott: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":0.7,"gaps":[]}', latott }),
      judge: fixModell('nem hívjuk'),
    })

    const result = await client.generateObject('draft', 'Pontozz.', SEMA)

    expect(result.value).toEqual({ score: 0.7, gaps: [] })
    expect(result.usage).toEqual({ inputTokens: 90, outputTokens: 30 })
    expect(latott).toEqual([
      { sema: true, toolChoice: 'auto', tools: [] },
      { sema: false, toolChoice: 'auto', tools: ['submit_result'] },
    ])
  })

  it('ugyanarra a modellre a következő hívás egyből a tool-úton megy', async () => {
    const latott: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":0.7,"gaps":[]}', latott }),
      judge: fixModell('nem hívjuk'),
    })

    await client.generateObject('draft', 'Első.', SEMA)
    await client.generateObject('draft', 'Második.', SEMA)

    expect(latott.map((l) => l.sema)).toEqual([true, false, false])
  })

  it('a közös emlékezet a kliensek között is él, és modellenként egyszer jelez', async () => {
    const jelzett: string[] = []
    const fallback = toolChoiceFallback((model) => jelzett.push(model))
    const latott2: Latott[] = []
    const elso = modelClientFrom(
      { draft: opusModell({ tool: '{"score":1,"gaps":[]}' }), judge: fixModell('nem hívjuk') },
      { fallback },
    )
    const masodik = modelClientFrom(
      {
        draft: opusModell({ tool: '{"score":1,"gaps":[]}', latott: latott2 }),
        judge: fixModell('nem hívjuk'),
      },
      { fallback },
    )

    await elso.generateObject('draft', 'p', SEMA)
    await masodik.generateObject('draft', 'p', SEMA)

    expect(latott2.map((l) => l.sema)).toEqual([false])
    expect(jelzett).toEqual(['opus-proba'])
  })

  it('más modellre a mai sémás út megy', async () => {
    const latottBiro: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":1,"gaps":[]}' }),
      judge: semaModell('{"score":0.9,"gaps":[]}', latottBiro),
    })

    await client.generateObject('draft', 'p', SEMA)
    const biro = await client.generateObject('judge', 'p', SEMA)

    expect(biro.value).toEqual({ score: 0.9, gaps: [] })
    expect(latottBiro.map((l) => l.sema)).toEqual([true])
  })

  it('kerítéses szöveges JSON-t is elfogad', async () => {
    const client = modelClientFrom({
      draft: opusModell({ text: '```json\n{"score":0.4,"gaps":["x"]}\n```' }),
      judge: fixModell('nem hívjuk'),
    })

    expect((await client.generateObject('draft', 'p', SEMA)).value).toEqual({
      score: 0.4,
      gaps: ['x'],
    })
  })

  it('séma-sértő tool-argumentumra séma-hibát ad, nem új hibautat', async () => {
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":"magas","gaps":[]}' }),
      judge: fixModell('nem hívjuk'),
    })
    const recept = structuredOutput(SEMA, (v) => String(v.score))

    await expect(recept.generate(client, 'draft', 'p')).rejects.toThrow(
      /nem a sémának megfelelő kimenetet adott.*score/s,
    )
  })

  it('se tool-hívás, se JSON: séma-hiba', async () => {
    const client = modelClientFrom({
      draft: opusModell({ text: 'Sajnos ezt nem tudom.' }),
      judge: fixModell('nem hívjuk'),
    })
    const recept = structuredOutput(SEMA, (v) => String(v.score))

    await expect(recept.generate(client, 'draft', 'p')).rejects.toThrow(
      /nem a sémának megfelelő kimenetet adott.*nincs értelmezhető JSON/s,
    )
  })

  it('más szövegű 400-ra nincs második kérés, a hiba továbbmegy', async () => {
    const latott: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":1,"gaps":[]}', hiba: 'context length exceeded', latott }),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generateObject('draft', 'p', SEMA)).rejects.toThrow(/context length/)
    expect(latott).toHaveLength(1)
  })

  it('a tool-úton is elzárja a csonka választ', async () => {
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":1,"gaps":[]}', finish: 'length' }),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generateObject('draft', 'p', SEMA)).rejects.toThrow(/csonka/)
  })

  it('retry mellett is pontosan két kérés megy ki', async () => {
    const latott: Latott[] = []
    const client = retrying(
      modelClientFrom({
        draft: opusModell({ tool: '{"score":1,"gaps":[]}', latott }),
        judge: fixModell('nem hívjuk'),
      }),
      { attempts: 3, sleep: () => Promise.resolve() },
    )

    await client.generateObject('draft', 'p', SEMA)

    expect(latott).toHaveLength(2)
  })

  it('a bíró a visszaesés után is pontoz', async () => {
    const client = modelClientFrom({
      draft: fixModell('nem hívjuk'),
      judge: opusModell({ tool: '{"score":0.6,"gaps":["B hiányzik"]}' }),
    })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    const score = await criterion.score({ transcript: 'A and B.', output: '- A\n' }, client)

    expect(score.value).toBe(0.6)
    expect(score.gaps).toEqual(['B hiányzik'])
  })
})

/** Sorban adja a megadott válaszokat, és elteszi a kimenő törzseket. */
function sorosFetch(valaszok: { status: number; body: unknown }[]): {
  torzsek: Record<string, unknown>[]
  fetch: typeof globalThis.fetch
} {
  const torzsek: Record<string, unknown>[] = []
  let i = 0
  const fetch: typeof globalThis.fetch = (_input, init) => {
    torzsek.push(JSON.parse(init?.body as string) as Record<string, unknown>)
    const valasz = valaszok[i++]!
    return Promise.resolve(
      new Response(JSON.stringify(valasz.body), {
        status: valasz.status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { torzsek, fetch }
}

describe('createModelClient — visszaesés a valódi kérésformán', () => {
  it('a 400 után a második kérés tool-t visz auto tool_choice-szal, response_format nélkül', async () => {
    const { torzsek, fetch } = sorosFetch([
      { status: 400, body: { error: { message: OPUS_400, type: null, param: null, code: '400' } } },
      {
        status: 200,
        body: {
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1,
          model: 'draft-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'submit_result', arguments: '{"score":0.5,"gaps":[]}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        },
      },
    ])
    const client = createModelClient(CFG, { fetch })

    const result = await client.generateObject('draft', 'p', SEMA)

    expect(result.value).toEqual({ score: 0.5, gaps: [] })
    expect(torzsek).toHaveLength(2)
    expect(torzsek[0]!.response_format).toMatchObject({ type: 'json_schema' })
    expect(torzsek[1]!.tool_choice).toBe('auto')
    expect(torzsek[1]!.response_format).toBeUndefined()
    const tools = torzsek[1]!.tools as { function: { name: string } }[]
    expect(tools.map((t) => t.function.name)).toEqual(['submit_result'])
  })
})
