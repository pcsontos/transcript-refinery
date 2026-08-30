import type { Cue } from '../types.js'

/**
 * A cue-kat sorfolyammá lapítja, és kiejti az **egymás utáni** ismétlődéseket.
 *
 * Ez a naiv változat szándékos: valós korpuszon az egymás utáni dedup
 * gyakorlatilag azonos eredményt ad a teljes egyedi-sor deduppal
 * (602 744 vs 602 073 szó), tehát okos algoritmus nem indokolt. A nem egymás
 * utáni ismétlődés megőrzése helyes — az a beszélő valódi ismétlése.
 */
export function dedupeLines(cues: Cue[]): string[] {
  const out: string[] = []
  for (const cue of cues) {
    for (const raw of cue.lines) {
      const line = raw.trim()
      if (line === '') continue
      if (out[out.length - 1] === line) continue
      out.push(line)
    }
  }
  return out
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
