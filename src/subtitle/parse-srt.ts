import type { Cue } from '../types.js'
import { parseCueTiming } from './timestamp.js'

/**
 * SRT → cue-k. A blokkokat üres sorok választják el; a sorszám opcionális,
 * mert a gyakorlatban nem mindig van jelen.
 */
export function parseSrt(input: string): Cue[] {
  const cues: Cue[] = []
  const blocks = input.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length === 0) continue

    let timing = parseCueTiming(lines[0]!)
    let textStart = 1
    if (!timing && lines.length > 1) {
      timing = parseCueTiming(lines[1]!)
      textStart = 2
    }
    if (!timing) continue

    const text = lines.slice(textStart).map((l) => l.trim())
    if (text.length === 0) continue
    cues.push({ start: timing.start, end: timing.end, lines: text })
  }

  return cues
}
