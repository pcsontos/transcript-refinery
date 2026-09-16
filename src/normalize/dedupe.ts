import type { Cue, TimedLine } from '../types.js'

/**
 * A cue-kat sorfolyammá lapítja, kiejti az **egymás utáni** ismétlődéseket, és
 * minden megtartott sorhoz az ELSŐ előfordulás kezdetét rendeli.
 *
 * Ez a naiv változat szándékos: valós korpuszon az egymás utáni dedup
 * gyakorlatilag azonos eredményt ad a teljes egyedi-sor deduppal
 * (602 744 vs 602 073 szó), tehát okos algoritmus nem indokolt. A nem egymás
 * utáni ismétlődés megőrzése helyes — az a beszélő valódi ismétlése.
 */
export function dedupeTimedLines(cues: Cue[]): TimedLine[] {
  const out: TimedLine[] = []
  for (const cue of cues) {
    for (const raw of cue.lines) {
      const text = raw.trim()
      if (text === '') continue
      if (out[out.length - 1]?.text === text) continue
      out.push({ start: cue.start, text })
    }
  }
  return out
}

/**
 * A `dedupeTimedLines` szöveges vetülete. Külön függvény, de **nem külön
 * logika**: enélkül két, egymástól elcsúszható deduplikációs szabály lenne.
 */
export function dedupeLines(cues: Cue[]): string[] {
  return dedupeTimedLines(cues).map((line) => line.text)
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length
}

/** Sorokból olvasható bekezdések, alapértelmezetten 8 soronként. */
export function toParagraphs(lines: string[], linesPerParagraph = 8): string {
  const paragraphs: string[] = []
  for (let i = 0; i < lines.length; i += linesPerParagraph) {
    paragraphs.push(lines.slice(i, i + linesPerParagraph).join(' '))
  }
  return paragraphs.join('\n\n')
}
