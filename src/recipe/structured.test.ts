import { NoObjectGeneratedError, TypeValidationError } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ModelClient } from '../model/client.js'
import { structuredOutput } from './structured.js'

const Schema = z.object({ items: z.array(z.string()) })

/**
 * Az SDK valódi séma-hibája, ahogy a `generateObject` útján érkezik: a felső
 * szintű üzenet általános, a részlet a `cause`-ban van. Az SDK saját
 * osztályát használjuk, nem kézzel gyártott hibanevet — így egy átnevezés
 * ezt a tesztet bukatja, nem pedig csendben más ágra tereli a kódot.
 */
function semaHiba(detail: string): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: 'No object generated: response did not match schema.',
    cause: new TypeValidationError({ value: { b: 1 }, cause: detail }),
    text: '{"b":1}',
    // A konstruktor kötelező mezői. A teszt szempontjából közömbösek — a
    // hibanév és a `cause` számít —, de kitöltve marad típushelyes.
    response: { id: 'r1', timestamp: new Date(0), modelId: 'teszt-modell' },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
    },
    finishReason: 'stop',
  })
}

function kliens(impl: ModelClient['generateObject']): ModelClient {
  return {
    generate: () => Promise.reject(new Error('a strukturált út nem hívhat generate-et')),
    generateObject: impl,
  }
}

describe('structuredOutput', () => {
  it('a sémás választ rendereli, és a használatot változatlanul adja tovább', async () => {
    const so = structuredOutput(Schema, (v) => v.items.join(', '))
    const client = kliens(<T>() =>
      Promise.resolve({
        value: { items: ['egy', 'kettő'] } as T,
        usage: { inputTokens: 100, outputTokens: 20 },
      }),
    )

    const result = await so.generate(client, 'draft', 'PROMPT')

    expect(result.value).toBe('egy, kettő')
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
  })

  it('a sémát és a szerepet változatlanul adja a kliensnek', async () => {
    const hivasok: { role: string; prompt: string; schema: unknown }[] = []
    const so = structuredOutput(Schema, () => 'x')

    await so.generate(
      kliens(<T>(role: string, prompt: string, schema: unknown) => {
        hivasok.push({ role, prompt, schema })
        return Promise.resolve({
          value: { items: [] } as T,
          usage: { inputTokens: 1, outputTokens: 1 },
        })
      }),
      'draft',
      'PROMPT',
    )

    expect(hivasok).toHaveLength(1)
    expect(hivasok[0]!.role).toBe('draft')
    expect(hivasok[0]!.prompt).toBe('PROMPT')
    // Ugyanazt a séma-objektumot kapja, nem másolatot.
    expect(hivasok[0]!.schema).toBe(Schema)
  })

  it('az SDK valódi séma-hibáját becsomagolja, a `cause` részletével együtt', async () => {
    const eredeti = semaHiba('invalid_type at items: expected array')
    const so = structuredOutput(Schema, () => 'x')

    const dobott: unknown = await so
      .generate(kliens(() => Promise.reject(eredeti)), 'draft', 'P')
      .catch((e: unknown) => e)

    expect(dobott).toBeInstanceOf(Error)
    const hiba = dobott as Error
    expect(hiba.message).toMatch(/nem a sémának megfelelő/i)
    // A riport a felső szintű üzenetet kapja, ezért a `cause` részletének is
    // ott kell lennie, különben a hibaüzenet nem nevezi meg az okot.
    expect(hiba.message).toContain('expected array')
    expect(hiba.cause).toBe(eredeti)
  })

  it('a nem séma eredetű hibát változatlanul, ugyanazt az objektumot engedi tovább', async () => {
    const halozati = new Error('socket hang up')
    const so = structuredOutput(Schema, () => 'x')

    // Nem üzenetre illesztünk: a becsomagolt hiba üzenete is tartalmazná a
    // „socket hang up"-ot, tehát csak az azonosság bizonyítja, hogy a szűrő él.
    await expect(
      so.generate(kliens(() => Promise.reject(halozati)), 'draft', 'P'),
    ).rejects.toBe(halozati)
  })
})
