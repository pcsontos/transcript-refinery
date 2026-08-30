import type { CaptionSource } from '../types.js'
import { countWords } from './dedupe.js'

/** Mondatzáró és tagoló írásjelek. */
const PUNCTUATION = /[.,!?;:]/g

/**
 * A mért szakadék közepe. 153 valós feliratfájlon az 1,0 és 4,0 közötti
 * sávban egyetlen fájl található, tehát a küszöb megbízhatóan oszt.
 */
export const PUNCTUATION_THRESHOLD = 2

/** Írásjelek száma 100 szóra vetítve. */
export function punctuationDensity(text: string): number {
  const words = countWords(text)
  if (words === 0) return 0
  const marks = text.match(PUNCTUATION)?.length ?? 0
  return (marks / words) * 100
}

/**
 * Eldönti, hogy a felirat szerzői-e vagy automatikus. Modellhívás nélkül.
 */
export function classifyCaptions(
  text: string,
  threshold = PUNCTUATION_THRESHOLD,
): CaptionSource {
  return punctuationDensity(text) < threshold ? 'auto' : 'creator'
}
