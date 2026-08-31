import type { Cue } from '../types.js'
import { parseSrt } from './parse-srt.js'
import { parseVtt } from './parse-vtt.js'

/** Kiterjesztés alapján választ értelmezőt. A vaultban mindkét formátum él. */
export function parseSubtitle(input: string, filename: string): Cue[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.srt')) return parseSrt(input)
  if (lower.endsWith('.vtt')) return parseVtt(input)
  throw new Error(`Nem támogatott feliratformátum: ${filename}`)
}
