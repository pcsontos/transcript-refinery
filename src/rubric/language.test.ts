import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { checkLanguage, languageCriterion } from './language.js'
import { scoreRubric, type Criterion } from './types.js'

const ANGOL_ATIRAT = `The speaker explains how a service mesh handles traffic
between pods. He says that every pod gets a proxy container next to the
application container, and that the application only talks to localhost. He
then argues that the interesting part is not encryption but identity, because
a policy can only reason about addresses if it does not know who is calling.`

const ANGOL_JEGYZET = `## What the sidecar does
The proxy sits next to the application container, and the application talks to
localhost. Because the proxy sees every request, it can report latency without
any change to the code of the application itself.`

const HOLLAND_JEGYZET = `## Wat de sidecar doet
De proxy staat naast de applicatie container, en de applicatie praat met
localhost. Omdat de proxy elk verzoek ziet, kan hij de latentie rapporteren
zonder dat de code van de applicatie zelf verandert.`

/**
 * A kliens, amit ezekben a tesztekben nem szabad meghívni. A `rubric/
 * types.test.ts` idiómája, szándékosan azonos alakban.
 */
const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}

describe('checkLanguage', () => {
  it('az átirattal egyező nyelvű jegyzetet átengedi', () => {
    const score = checkLanguage(ANGOL_JEGYZET, ANGOL_ATIRAT)
    expect(score.value).toBe(1)
    expect(score.gaps).toEqual([])
  })

  it('az eltérő nyelvű jegyzetet megbuktatja — ez a megfigyelt hiba', () => {
    const score = checkLanguage(HOLLAND_JEGYZET, ANGOL_ATIRAT)
    expect(score.value).toBe(0)
    expect(score.gaps).toHaveLength(1)
  })

  it('a hiány MINDKÉT nyelvet megnevezi, angolul', () => {
    // A hiány visszamegy a modellnek a javító promptban, ezért angol. Egy
    // szám nem tud javítást vezérelni: a modellnek tudnia kell, mit írt és
    // mit kellett volna.
    const gap = checkLanguage(HOLLAND_JEGYZET, ANGOL_ATIRAT).gaps[0]!
    expect(gap).toContain('Dutch')
    expect(gap).toContain('English')
    expect(gap).toMatch(/rewrite/i)
  })

  it('ha a jegyzet nyelve ismeretlen, átenged — nem talál ki bukást', () => {
    const csakKod = '```\nkubectl get pods --output=wide\n```\n15001 15006'
    expect(checkLanguage(csakKod, ANGOL_ATIRAT).value).toBe(1)
  })

  it('ha az átirat nyelve ismeretlen, átenged', () => {
    expect(checkLanguage(ANGOL_JEGYZET, '15001 15006 envoy 1.29').value).toBe(1)
  })
})

describe('languageCriterion', () => {
  it('blokkoló kapu, nem pontozott összetevő', () => {
    expect(languageCriterion.blocking).toBe(true)
    expect(languageCriterion.name).toBe('language')
  })

  it('a rossz nyelvű kimenet NULLA bíró-hívásba kerül', async () => {
    // Ez a kapu fő haszna a költség oldalán: a drága kritériumok el sem
    // indulnak. A `futott` jelző bizonyítja, hogy egyik sem fut le.
    let futott = false
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () => {
        futott = true
        return Promise.resolve({ value: 1, gaps: [] })
      },
    }

    const eredmeny = await scoreRubric(
      { criteria: [languageCriterion, dragaKriterium], passThreshold: 0.8 },
      { transcript: ANGOL_ATIRAT, output: HOLLAND_JEGYZET },
      nemHivhatoKliens,
    )

    expect(futott).toBe(false)
    expect(eredmeny.value).toBe(0)
    expect(eredmeny.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})
