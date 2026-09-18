import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { scoreRubric } from '../rubric/types.js'
import type { ModelRole, SourceItem } from '../types.js'
import { bloomRecipe } from './bloom.js'
import { cleanRecipe } from './clean.js'
import { alreadyInTarget, translationOf } from './translate.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'proba',
  sourceFile: 'Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: {},
}

const FORRAS = [
  '## Overview',
  '',
  '[00:01] The speaker explains why a problem should come before a tool.',
  '',
  '[00:19] He then gives an example from the first company that he built.',
].join('\n')

const FORDITAS = [
  '## Áttekintés',
  '',
  '[00:01] A beszélő elmagyarázza, hogy miért kell a problémának az eszköz előtt lennie.',
  '',
  '[00:19] Utána egy példát is hoz az első cégéből, amelyet ő épített fel.',
].join('\n')

/** Csak bírót szolgáló kliens: a promptokat gyűjti, és a megadott pontszámot adja. */
function biroKliens(score: number, promptok: string[]): ModelClient {
  return {
    generate: () => Promise.reject(new Error('a generálás itt nem hívható')),
    generateObject: <T>(_role: ModelRole, prompt: string) => {
      promptok.push(prompt)
      return Promise.resolve({
        value: { score, gaps: [] } as T,
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    },
  }
}

const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}

describe('translationOf', () => {
  it('a forrásból képzett azonosítót, fájlnevet és öröklött mezőket ad', () => {
    const recipe = translationOf(bloomRecipe, 'hu')
    expect(recipe.id).toBe('bloom-hu')
    expect(recipe.outputFile).toBe('_bloom-hu.md')
    expect(recipe.publishable).toBe(bloomRecipe.publishable)
    expect(recipe.tags).toEqual(bloomRecipe.tags)
    expect(recipe.role).toBe('draft')
    expect(recipe.maxIterations).toBe(0)
    expect(recipe.structured).toBeUndefined()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- csak jelenlétet ellenőrzünk, nem hívjuk.
    expect(recipe.postprocess).toBeUndefined()
    expect(recipe.translation?.source).toBe(bloomRecipe)
    expect(recipe.translation?.target).toBe('hu')
  })

  it('a prompt kimondja a célnyelvet, és a forrásjegyzetet adja át', () => {
    const prompt = translationOf(cleanRecipe, 'hu').prompt({ item: ITEM, transcript: FORRAS, timed: [] })
    expect(prompt.startsWith('Translate the note below into Hungarian.\n')).toBe(true)
    expect(prompt).toContain('- Keep every timestamp such as [03:12] exactly as it is, at the start of the')
    expect(prompt).toContain('- Technical terms that Hungarian professionals usually say in English may stay')
    expect(prompt).toContain('Title: Cím')
    expect(prompt.endsWith(`--- NOTE ---\n${FORRAS}`)).toBe(true)
    expect(prompt).not.toContain('Do not translate')
    expect(prompt).not.toContain('traceable to the transcript')
  })

  it('a célnyelv neve paraméter', () => {
    const prompt = translationOf(cleanRecipe, 'de').prompt({ item: ITEM, transcript: FORRAS, timed: [] })
    expect(prompt.startsWith('Translate the note below into German.\n')).toBe(true)
  })

  it('a javító prompt a hiányokat, a jelenlegi fordítást és a forrást is viszi', () => {
    const prompt = translationOf(cleanRecipe, 'hu').repairPrompt({
      item: ITEM,
      transcript: FORRAS,
      timed: [],
      previous: 'ELŐZŐ',
      gaps: ['HIÁNY'],
    })
    expect(prompt).toContain('--- GAPS TO FIX ---\n- HIÁNY')
    expect(prompt).toContain('--- CURRENT TRANSLATION ---\nELŐZŐ')
    expect(prompt.endsWith(`--- SOURCE NOTE ---\n${FORRAS}`)).toBe(true)
  })

  it('a rubrika három kapu és egy bíró', () => {
    const { rubric } = translationOf(cleanRecipe, 'hu')
    expect(rubric.criteria.map((c) => c.name)).toEqual([
      'format',
      'target-language',
      'skeleton',
      'translation-faithfulness',
    ])
    expect(rubric.criteria.map((c) => c.blocking === true)).toEqual([true, true, true, false])
    expect(rubric.passThreshold).toBe(0.8)
  })

  it('a bloom forrású fordítás vázkapuja a fejlécszámra szigorú', async () => {
    const { rubric } = translationOf(bloomRecipe, 'hu')
    const kapu = rubric.criteria.find((c) => c.name === 'skeleton')!
    const forras =
      '## Egy\n\nElső.\n\n## Kettő\n\nMásodik.\n\n## Három\n\nHarmadik.\n\n## Négy\n\nNegyedik.\n\n## Öt\n\nÖtödik.'

    const score = await kapu.score({ transcript: forras, output: `${forras}\n\n## Hat` }, nemHivhatoKliens)

    expect(score.value).toBe(0)
    expect(score.gaps).toEqual([
      'The translation has 6 headings, the source has 5. Keep every heading at its level.',
    ])
  })

  it('a clean forrású fordítás vázkapuja ugyanezt a fejlécet átengedi', async () => {
    const { rubric } = translationOf(cleanRecipe, 'hu')
    const kapu = rubric.criteria.find((c) => c.name === 'skeleton')!
    const forras =
      '## Egy\n\nElső.\n\n## Kettő\n\nMásodik.\n\n## Három\n\nHarmadik.\n\n## Négy\n\nNegyedik.\n\n## Öt\n\nÖtödik.'

    const score = await kapu.score({ transcript: forras, output: `${forras}\n\n## Hat` }, nemHivhatoKliens)

    expect(score.value).toBe(1)
  })

  it('a helyes fordítás minden kapun átmegy, és a bíró a forrást és a fordítást látja', async () => {
    const promptok: string[] = []
    const result = await scoreRubric(
      translationOf(cleanRecipe, 'hu').rubric,
      { transcript: FORRAS, output: FORDITAS },
      biroKliens(0.9, promptok),
    )
    expect(result.value).toBe(0.9)
    expect(promptok).toHaveLength(1)
    expect(promptok[0]).toContain('You are grading a translation into Hungarian.')
    expect(promptok[0]).toContain(`--- TRANSCRIPT ---\n${FORRAS}`)
    expect(promptok[0]).toContain(`--- NOTES UNDER REVIEW ---\n${FORDITAS}`)
  })

  it('a fordítatlan kimenet nulla bíró-hívással bukik', async () => {
    const promptok: string[] = []
    const result = await scoreRubric(
      translationOf(cleanRecipe, 'hu').rubric,
      { transcript: FORRAS, output: FORRAS },
      biroKliens(0.9, promptok),
    )
    expect(result.value).toBe(0)
    expect(promptok).toEqual([])
    expect(result.gaps[0]).toContain('must be in Hungarian')
  })
})

describe('alreadyInTarget', () => {
  it('a célnyelvű forrásra megnevezi a kihagyás okát', () => {
    expect(alreadyInTarget(FORDITAS, 'hu')).toBe('a forrás már magyar')
  })

  it('más nyelvű vagy bizonytalan forrásra null', () => {
    expect(alreadyInTarget(FORRAS, 'hu')).toBeNull()
    expect(alreadyInTarget('kubectl get pods', 'hu')).toBeNull()
  })
})
