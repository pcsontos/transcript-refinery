import { identifyLanguage, LANGUAGE_NAMES } from '../lang/identify.js'
import type { Criterion, Score } from './types.js'

/**
 * Determinisztikus nyelvi ellenőrzés: a kimenet nyelve az **átirat**
 * nyelvéhez mérve. Sima függvény, nulla token.
 *
 * A viszonyítási alap azért az átirat, és nem az `item.language`, mert
 * pontosan ez az az invariáns, amit a prompt szabálya kimond — és mert
 * mindkét szöveg amúgy is a `ScoreContext`-ben van, tehát a `refine` loopot
 * nem kell hozzányúlni.
 *
 * **Bizonytalanságnál átenged.** Egy téves „ez más nyelv" ítélet egy helyes
 * jegyzetet buktatna meg, elköltené rá az összes javító kört, és
 * `item:failed`-del zárná — miközben a jegyzettel semmi baj. A kapu
 * biztonsági háló, nem az egyetlen ellenőrzés.
 */
export function checkLanguage(output: string, transcript: string): Score {
  const jegyzet = identifyLanguage(output)
  const forras = identifyLanguage(transcript)

  if (jegyzet === null || forras === null) return { value: 1, gaps: [] }
  if (jegyzet === forras) return { value: 1, gaps: [] }

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
