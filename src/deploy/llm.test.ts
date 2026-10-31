import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config, ModelConfig } from '../config.js'
import type { ModelClient } from '../model/client.js'
import { createMdxTransform, mdxPrompt, mdxTransformFor } from './llm.js'
import type { Contract } from './mdx.js'

const CONTRACT: Contract = {
  components: {
    Callout: {
      attributes: {
        type: { type: 'enum', values: ['note', 'tip', 'warning'], required: false },
        title: { type: 'string', required: false },
      },
    },
    Steps: { attributes: {} },
    Step: { attributes: {} },
    Cards: { attributes: {} },
    Card: {
      attributes: {
        title: { type: 'string', required: true },
        href: { type: 'string', required: false },
        description: { type: 'string', required: false },
      },
    },
  },
}

const MODEL: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'd', judge: 'j' },
  recipeModels: {},
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 3, outputPerMillion: 15 },
  },
  modelPricing: {},
  costLimitUsd: 5,
}

const INTRO = '<Callout type="note" title="Röviden">\nÖsszefoglaló.\n</Callout>'

/** Sorban adott válaszokat adó hamis kliens; a promptokat gyűjti. */
function fakeClient(replies: string[]): ModelClient & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    generate: (_role, prompt) => {
      prompts.push(prompt)
      return Promise.resolve({ value: replies[prompts.length - 1]!, usage: { inputTokens: 1000, outputTokens: 1000 } })
    },
    generateObject: () => Promise.reject(new Error('nem használt')),
  }
}

const run = (transform: ReturnType<typeof createMdxTransform>, body: string, language: 'hu' | 'en' = 'hu') =>
  transform.run({ siteKind: 'summary', body, language, contract: CONTRACT })

describe('mdxPrompt', () => {
  const base = { text: 'Szöveg.', language: 'hu' as const, contract: CONTRACT, intro: 'inline' as const }

  it('a prompt a szerződés komponenseit sorolja', () => {
    const contract: Contract = { components: { ...CONTRACT.components, Foo: { attributes: {} } } }
    const prompt = mdxPrompt({ ...base, contract })
    expect(prompt).toContain('Foo')
    expect(prompt).toContain('note, tip, warning')
  })

  it('a bevezető címszavát nyelv szerint kéri', () => {
    expect(mdxPrompt(base)).toContain('title="Röviden"')
    expect(mdxPrompt({ ...base, language: 'en' })).toContain('title="In brief"')
    expect(mdxPrompt({ ...base, intro: 'none' })).not.toContain('Callout type="note"')
  })
})

describe('createMdxTransform', () => {
  const BODY = '# Cím\n\n🌐 <https://x>\n\nSzöveg egy.'

  it('jó kimenet végleges, a fejléc a kódé', async () => {
    const client = fakeClient([`${INTRO}\n\n## Rész\n\nSzöveg egy.`])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('final')
    const body = (result as { body: string }).body
    expect(body.startsWith('# Cím\n\n🌐 [https://x](<https://x>)\n\n<Callout type="note" title="Röviden">')).toBe(true)
    expect(body).toContain('## Rész\n\nSzöveg egy.')
    expect(client.prompts[0]).not.toContain('# Cím')
  })

  it('eltérő kimenet egyszer újrapróbál a hibával', async () => {
    const client = fakeClient([`${INTRO}\n\nSzöveg kettő.`, `${INTRO}\n\nSzöveg egy.`])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('final')
    expect(client.prompts).toHaveLength(2)
    expect(client.prompts[1]).toContain('szónál')
  })

  it('kétszer bukó kimenet failed', async () => {
    const client = fakeClient([`${INTRO}\n\nSzöveg kettő.`, `${INTRO}\n\nSzöveg három.`])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('failed')
    expect((result as { reason: string }).reason).toContain('szónál')
    expect(client.prompts).toHaveLength(2)
  })

  it('hiányzó bevezető bukás', async () => {
    const client = fakeClient(['Szöveg egy.', 'Szöveg egy.'])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('failed')
    expect(client.prompts).toHaveLength(2)
  })

  it('le nem forduló vagy listán kívüli komponens bukás', async () => {
    const client = fakeClient([`${INTRO}\n\n<Foo>Szöveg egy.</Foo>`, `${INTRO}\n\nSzöveg egy.`])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('final')
    expect(client.prompts[1]).toContain('ismeretlen komponens: Foo')
  })

  it('a title és a type mellé tett attribútum (href, description) bukás', async () => {
    const card = `${INTRO}\n\n<Cards>\n\n<Card title="X" description="Kitalált." href="https://x.example">\n\nSzöveg egy.\n\n</Card>\n\n</Cards>`
    const client = fakeClient([card, `${INTRO}\n\nSzöveg egy.`])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('final')
    expect(client.prompts[1]).toContain('nem engedett attribútum: description')
  })

  it('a többszavas, ékezetes title értékének szavai nem attribútumok', async () => {
    const callout = `${INTRO}\n\n<Callout type="warning" title="Mit kell felismerés">\nSzöveg egy.\n</Callout>`
    const client = fakeClient([callout])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
    expect(result.kind).toBe('final')
    expect(client.prompts).toHaveLength(1)
  })

  it('kép vagy link-referencia-definíció, ami az eredetiben nincs, bukás', async () => {
    for (const bad of ['Szöveg egy. ![kép](x.png)', 'Szöveg egy.\n\n[ref]: <https://x.example>']) {
      const client = fakeClient([`${INTRO}\n\n${bad}`, `${INTRO}\n\n${bad}`])
      const result = await run(createMdxTransform({ client, modelConfig: MODEL }), BODY)
      expect(result.kind).toBe('failed')
    }
  })

  it('a bevezető-hívás kimenete a blokkon kívül mást nem tartalmazhat', async () => {
    const body = '# Cím\n\nEgy kettő három négy.\n\n## Rész\n\nÖt hat hét nyolc.'
    const extra = `${INTRO}\n\nValami más.`
    const client = fakeClient(['Egy kettő három négy.', '## Rész\n\nÖt hat hét nyolc.', extra, extra])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL, chunkWords: 5 }), body)
    expect(result).toMatchObject({ kind: 'failed' })
    expect(client.prompts).toHaveLength(4)
  })

  it('a kétszer bukó darab után a transform failed, és nem hív tovább', async () => {
    const body = '# Cím\n\nEgy kettő három négy.\n\n## Rész\n\nÖt hat hét nyolc.'
    const client = fakeClient(['Rossz.', 'Rossz.', 'x', 'x'])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL, chunkWords: 5 }), body)
    expect(result.kind).toBe('failed')
    expect(client.prompts).toHaveLength(2)
  })

  it('hosszú törzs darabokban megy, a bevezető külön hívás', async () => {
    const body = '# Cím\n\nEgy kettő három négy.\n\n## Rész\n\nÖt hat hét nyolc.'
    const client = fakeClient(['Egy kettő három négy.', '## Rész\n\nÖt hat hét nyolc.', INTRO])
    const result = await run(createMdxTransform({ client, modelConfig: MODEL, chunkWords: 5 }), body)
    expect(result.kind).toBe('final')
    expect(client.prompts).toHaveLength(3)
    expect(client.prompts[2]).toContain('Output nothing else')
    expect((result as { body: string }).body).toBe(
      `# Cím\n\n${INTRO}\n\nEgy kettő három négy.\n\n## Rész\n\nÖt hat hét nyolc.\n`,
    )
  })

  it('a plafon után budget', async () => {
    // egy hívás ára: 1000 × 3/M + 1000 × 15/M = 0,018 $
    const client = fakeClient([`${INTRO}\n\nSzöveg egy.`, `${INTRO}\n\nSzöveg egy.`])
    const transform = createMdxTransform({ client, modelConfig: { ...MODEL, costLimitUsd: 0.01 } })
    expect((await run(transform, BODY)).kind).toBe('final')
    expect((await run(transform, BODY)).kind).toBe('budget')
    expect(client.prompts).toHaveLength(1)
    expect(transform.usage()).toMatchObject({ budgetSkipped: 1, inputTokens: 1000, outputTokens: 1000 })
    expect(transform.usage().usd).toBeGreaterThan(0)
  })
})

describe('mdxTransformFor', () => {
  const RAW = {
    model: { base_url: 'http://localhost:4000/v1', draft: 'd', judge: 'j', recipes: { mdx: 'm' } },
    pricing: {
      d: { input_per_million: 3, output_per_million: 15 },
      j: { input_per_million: 1, output_per_million: 1 },
      m: { input_per_million: 3, output_per_million: 15 },
    },
    cost_limit_usd: 5,
  }
  const cfg = { configPath: '/p/c.yaml' } as Config

  afterEach(() => vi.unstubAllEnvs())

  it('kulcs nélkül okot ad', () => {
    vi.stubEnv('LITELLM_API_KEY', '')
    const result = mdxTransformFor(RAW, cfg)
    expect(typeof result === 'string' && result.includes('LITELLM_API_KEY')).toBe(true)
  })

  it('a model.recipes.mdx modelljét használja, nélküle a draftot', () => {
    vi.stubEnv('LITELLM_API_KEY', 'sk-1')
    const seen: string[] = []
    const createClient = (view: ModelConfig) => (seen.push(view.models.draft), fakeClient([]))
    mdxTransformFor(RAW, cfg, createClient)
    const plain = { ...RAW, model: { ...RAW.model, recipes: {} } }
    mdxTransformFor(plain, cfg, createClient)
    expect(seen).toEqual(['m', 'd'])
  })
})
