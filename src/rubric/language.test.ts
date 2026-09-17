import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import {
  checkLanguage,
  checkLanguageIs,
  languageCriterion,
  targetLanguageCriterion,
} from './language.js'
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

const MAGYAR_JEGYZET = `## Mit csinál az oldalkocsi
A proxy az alkalmazás konténere mellett fut, és az alkalmazás csak a localhosttal
beszél. Mivel a proxy minden kérést lát, a késleltetést is jelenteni tudja, és
ehhez nem kell az alkalmazás kódját módosítani.`

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

  it('a hiányüzenet szövege bájtra a mai', () => {
    expect(checkLanguage(HOLLAND_JEGYZET, ANGOL_ATIRAT).gaps).toEqual([
      'The output is written in Dutch, but the transcript is in English. Rewrite it in English. Keep the same content; only the language must change.',
    ])
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

describe('checkLanguageIs', () => {
  it('a célnyelvű kimenetet átengedi', () => {
    expect(checkLanguageIs(MAGYAR_JEGYZET, 'hu')).toEqual({ value: 1, gaps: [] })
  })

  it('a más nyelvű kimenetet megbuktatja, és mindkét nyelvet megnevezi', () => {
    expect(checkLanguageIs(ANGOL_JEGYZET, 'hu')).toEqual({
      value: 0,
      gaps: [
        'The output is written in English, but it must be in Hungarian. Translate it into Hungarian and keep the structure unchanged.',
      ],
    })
  })

  it('ha a kimenet nyelve ismeretlen, átenged — nem talál ki bukást', () => {
    expect(checkLanguageIs('```\nkubectl get pods --output=wide\n```', 'hu').value).toBe(1)
  })
})

describe('targetLanguageCriterion', () => {
  it('blokkoló kapu, target-language néven', () => {
    const criterion = targetLanguageCriterion('hu')
    expect(criterion.blocking).toBe(true)
    expect(criterion.name).toBe('target-language')
  })

  it('az átirat nyelvét nem nézi: angol átiraton a magyar kimenet átmegy, az angol bukik', async () => {
    const criterion = targetLanguageCriterion('hu')
    const magyar = await criterion.score(
      { transcript: ANGOL_ATIRAT, output: MAGYAR_JEGYZET },
      nemHivhatoKliens,
    )
    const angol = await criterion.score(
      { transcript: ANGOL_ATIRAT, output: ANGOL_JEGYZET },
      nemHivhatoKliens,
    )
    expect(magyar.value).toBe(1)
    expect(angol.value).toBe(0)
  })
})
