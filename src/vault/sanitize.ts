/**
 * yt-dlp-kompatibilis karaktercsere: fájlrendszer-biztos szegmensnevek
 * (csatornanév, videócím) a tiltott karakterek fullwidth megfelelőire
 * cserélve, hogy a mappa- és fájlnév minden platformon érvényes maradjon.
 */
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\//g, '⧸'], // BIG SOLIDUS
  [/\\/g, '⧹'], // BIG REVERSE SOLIDUS
  [/"/g, '＂'], // FULLWIDTH QUOTATION MARK
  [/:/g, '：'], // FULLWIDTH COLON
  [/\?/g, '？'], // FULLWIDTH QUESTION MARK
  [/\*/g, '＊'], // FULLWIDTH ASTERISK
  [/</g, '＜'], // FULLWIDTH LESS-THAN SIGN
  [/>/g, '＞'], // FULLWIDTH GREATER-THAN SIGN
  [/\|/g, '｜'], // FULLWIDTH VERTICAL LINE
]

/**
 * Vezérlőkarakterek Unicode-kategória szerint (Cc). Szándékosan
 * kategória-escape, nem karaktertartomány: így a forrásban nem kell literál
 * vezérlőkaraktert tárolni.
 */
const CONTROL_CHARS = /\p{Cc}/gu

/**
 * Egyetlen útvonalszegmens (csatornanév vagy videócím) biztonságossá tétele.
 * Idempotens: a helyettesítő karakterek maguk már nem tiltottak.
 */
export function sanitizeSegment(name: string): string {
  let out = name
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement)
  }
  out = out.replace(CONTROL_CHARS, '')
  out = out.replace(/\s+/g, ' ').trim()
  out = out.replace(/[. ]+$/, '')
  return out === '' ? 'névtelen' : out
}
