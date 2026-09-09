import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ModelClient } from '../model/client.js'
import { structuredOutput } from './structured.js'

const Schema = z.object({ items: z.array(z.string()) })

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

  it('a séma-hibát érthető magyar üzenetbe csomagolja, az okot megtartva', async () => {
    const eredeti = Object.assign(new Error('value did not match schema'), {
      name: 'AI_TypeValidationError',
    })
    const so = structuredOutput(Schema, () => 'x')

    await expect(
      so.generate(kliens(() => Promise.reject(eredeti)), 'draft', 'P'),
    ).rejects.toThrow(/nem a sémának megfelelő/i)
  })

  it('a nem séma eredetű hibát változatlanul engedi tovább', async () => {
    const halozati = new Error('socket hang up')
    const so = structuredOutput(Schema, () => 'x')

    await expect(
      so.generate(kliens(() => Promise.reject(halozati)), 'draft', 'P'),
    ).rejects.toThrow('socket hang up')
  })
})
