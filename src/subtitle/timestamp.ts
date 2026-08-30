const TIMESTAMP = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/
const CUE_TIMING = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/

/** `HH:MM:SS,mmm` vagy `HH:MM:SS.mmm` → másodperc. */
export function parseTimestamp(text: string): number {
  const m = TIMESTAMP.exec(text.trim())
  if (!m) throw new Error(`Értelmezhetetlen időbélyeg: ${text}`)
  const [, h, min, s, ms] = m
  return (
    Number(h) * 3600 +
    Number(min) * 60 +
    Number(s) +
    Number(ms!.padEnd(3, '0')) / 1000
  )
}

/**
 * Egy `--> ` sort értelmez. A VTT cue-beállításai (pl. `align:start
 * position:0%`) az időbélyegek után állnak, és figyelmen kívül maradnak.
 */
export function parseCueTiming(
  line: string,
): { start: number; end: number } | null {
  const m = CUE_TIMING.exec(line.trim())
  if (!m) return null
  try {
    return { start: parseTimestamp(m[1]!), end: parseTimestamp(m[2]!) }
  } catch {
    return null
  }
}
