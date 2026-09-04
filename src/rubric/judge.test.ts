import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { coverageCriterion, faithfulnessCriterion, judgeCriterion } from './judge.js'

/** Rögzített ítéletet adó kliens, ami elteszi a kapott promptot. */
function fixBiro(verdict: { score: number; gaps: string[] }) {
  const promptok: string[] = []
  const client: ModelClient = {
    generate: () => Promise.reject(new Error('a bíró objektumot ad, nem szöveget')),
    generateObject: (_role, prompt) => {
      promptok.push(prompt)
      return Promise.resolve({
        value: verdict as never,
        usage: { inputTokens: 500, outputTokens: 40 },
      })
    },
  }
  return { client, promptok }
}

const CTX = { transcript: 'The speaker said A and B.', output: '- A\n' }

describe('judgeCriterion', () => {
  it('az ítélet pontszámát és hiányait adja vissza', async () => {
    const { client } = fixBiro({ score: 0.5, gaps: ['B is missing'] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    const score = await criterion.score(CTX, client)

    expect(score.value).toBe(0.5)
    expect(score.gaps).toEqual(['B is missing'])
  })

  it('visszaadja a bíró token-felhasználását', async () => {
    const { client } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    const score = await criterion.score(CTX, client)

    expect(score.usage).toEqual({ inputTokens: 500, outputTokens: 40 })
  })

  it('a promptba az átirat és a jegyzet is bekerül', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    await criterion.score(CTX, client)

    expect(promptok[0]).toContain('The speaker said A and B.')
    expect(promptok[0]).toContain('- A')
    expect(promptok[0]).toContain('Grade it.')
  })

  it('a kulcspont-lista bekerül a promptba, ha van', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    await criterion.score({ ...CTX, keyPoints: ['Point one', 'Point two'] }, client)

    expect(promptok[0]).toContain('Point one')
    expect(promptok[0]).toContain('Point two')
  })

  it('kulcspont-lista nélkül nem kerül be üres szakasz', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    await criterion.score(CTX, client)

    expect(promptok[0]).not.toContain('MAIN POINTS')
  })

  it('a bíró a judge szerepet kapja, nem a draftot', async () => {
    const szerepek: string[] = []
    const client: ModelClient = {
      generate: () => Promise.reject(new Error('nem hívható')),
      generateObject: (role) => {
        szerepek.push(role)
        return Promise.resolve({
          value: { score: 1, gaps: [] } as never,
          usage: { inputTokens: 1, outputTokens: 1 },
        })
      },
    }

    await judgeCriterion({ name: 'proba', instruction: 'Grade.' }).score(CTX, client)

    expect(szerepek).toEqual(['judge'])
  })
})

describe('a két szállított kritérium', () => {
  it('egyik sem blokkoló — a modellhívás nem lehet kapu', () => {
    expect(faithfulnessCriterion.blocking).toBeUndefined()
    expect(coverageCriterion.blocking).toBeUndefined()
  })

  it('megkülönböztethető nevük van', () => {
    expect(faithfulnessCriterion.name).toBe('faithfulness')
    expect(coverageCriterion.name).toBe('coverage')
  })
})
