import type { Cue } from '../types.js'
import { parseCueTiming } from './timestamp.js'

/** `<00:00:02.080>` és `<c>…</c>` alakú inline tagek. */
const INLINE_TAG = /<[^>]*>/g

function stripTags(line: string): string {
  return line.replace(INLINE_TAG, '').replace(/\s+/g, ' ').trim()
}

/**
 * WebVTT → cue-k. A fejléc (`WEBVTT`, `Kind:`, `Language:`) és a
 * `NOTE`/`STYLE` blokkok kimaradnak. Az inline időbélyeg-tagek eltávolításra
 * kerülnek, mert a deduplikáció szöveg szerint hasonlít — tagekkel a
 * gördülő ablak ismétlődései nem egyeznének meg.
 */
export function parseVtt(input: string): Cue[] {
  const cues: Cue[] = []
  const blocks = input.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const raw = block.split('\n')
    if (raw.length === 0) continue

    const head = raw[0]!.trim()
    if (head.startsWith('WEBVTT') || head === 'NOTE' || head === 'STYLE') {
      continue
    }

    let timing = parseCueTiming(raw[0]!)
    let textStart = 1
    if (!timing && raw.length > 1) {
      timing = parseCueTiming(raw[1]!)
      textStart = 2
    }
    if (!timing) continue

    const lines = raw
      .slice(textStart)
      .map(stripTags)
      .filter((l) => l !== '')
    if (lines.length === 0) continue

    cues.push({ start: timing.start, end: timing.end, lines })
  }

  return cues
}
