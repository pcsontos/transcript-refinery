import { identifyLanguage, LANGUAGE_NAMES, type LanguageTag } from '../lang/identify.js'
import type { Criterion, Score } from './types.js'

/**
 * A kimenet nyelve, ha **biztosan** más, mint az elvárt; különben `null`.
 *
 * **Bizonytalanságnál átenged.** Egy téves „ez más nyelv" ítélet egy helyes
 * jegyzetet buktatna meg, elköltené rá az összes javító kört, és
 * `item:failed`-del zárná — miközben a jegyzettel semmi baj. A kapu
 * biztonsági háló, nem az egyetlen ellenőrzés.
 */
function wrongLanguage(output: string, expected: LanguageTag): LanguageTag | null {
  const actual = identifyLanguage(output)
  return actual === null || actual === expected ? null : actual
}

/**
 * Determinisztikus nyelvi ellenőrzés: a kimenet nyelve az **átirat**
 * nyelvéhez mérve. Sima függvény, nulla token.
 *
 * A viszonyítási alap azért az átirat, és nem az `item.language`, mert
 * pontosan ez az az invariáns, amit a prompt szabálya kimond — és mert
 * mindkét szöveg amúgy is a `ScoreContext`-ben van, tehát a `refine` loopot
 * nem kell hozzányúlni.
 */
export function checkLanguage(output: string, transcript: string): Score {
  const forras = identifyLanguage(transcript)
  if (forras === null) return { value: 1, gaps: [] }
  const jegyzet = wrongLanguage(output, forras)
  if (jegyzet === null) return { value: 1, gaps: [] }

  // A hiányüzenet angolul szól, mert visszamegy a modellnek a javító
  // promptban — a `format.ts` konvenciója szerint.
  return {
    value: 0,
    gaps: [
      `The output is written in ${LANGUAGE_NAMES[jegyzet]}, but the transcript is in ` +
        `${LANGUAGE_NAMES[forras]}. Rewrite it in ${LANGUAGE_NAMES[forras]}. Keep the ` +
        `same content; only the language must change.`,
    ],
  }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
export const languageCriterion: Criterion = {
  name: 'language',
  blocking: true,
  score: (ctx) => Promise.resolve(checkLanguage(ctx.output, ctx.transcript)),
}

/**
 * A kimenet nyelve egy **megadott** célnyelvhez mérve: a fordítórecept kapuja,
 * ahol a kimenet szándékosan más nyelvű, mint a forrás. Nulla token.
 */
export function checkLanguageIs(output: string, expected: LanguageTag): Score {
  const actual = wrongLanguage(output, expected)
  if (actual === null) return { value: 1, gaps: [] }
  const name = LANGUAGE_NAMES[expected]
  return {
    value: 0,
    gaps: [
      `The output is written in ${LANGUAGE_NAMES[actual]}, but it must be in ${name}. ` +
        `Translate it into ${name} and keep the structure unchanged.`,
    ],
  }
}

/** Kapu-kritérium a megadott célnyelvre: bukása esetén a bíró el sem indul. */
export function targetLanguageCriterion(target: LanguageTag): Criterion {
  return {
    name: 'target-language',
    blocking: true,
    score: (ctx) => Promise.resolve(checkLanguageIs(ctx.output, target)),
  }
}
