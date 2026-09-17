/**
 * Fejléc-alakú sorok egy renderelt mezőben. A Markdown **három szóköz
 * behúzásig** még fejlécnek olvassa az ATX sort, a `---`/`===` aláhúzás pedig
 * az előtte álló szövegsorból csinál fejlécet (setext) — mindkettő ugyanúgy
 * szétrobbantja a renderer szerkezetét (fantomkártya, fantom szakasz), mint egy
 * behúzatlan `##`.
 */
const ATX = /^( {0,3})(#+)/
const SETEXT = /^( {0,3})(-+|=+)[ \t]*$/

/**
 * A fejléc-alakú sorok elfedése. A `\` escape a sort bekezdéssé teszi, a
 * behúzást viszont meghagyja.
 *
 * A kódblokkok belsejét **nem** kímélve escape-elünk: egy lezáratlan
 * kerítéssel a modell különben kikapcsolhatná a védelmet a mező hátralévő
 * részére. A rosszabbik eset így egy látható `\` egy ritka kódrészletben, nem
 * pedig egy szétesett jegyzet.
 */
export function escapeHeadings(text: string): string {
  const lines = text.split('\n')
  return lines
    .map((line, i) => {
      const atx = ATX.exec(line)
      if (atx) return `${atx[1]!}\\${line.slice(atx[1]!.length)}`
      // A setext aláhúzás csak akkor fejléc, ha szövegsor áll fölötte.
      const setext = SETEXT.exec(line)
      if (setext && i > 0 && lines[i - 1]!.trim() !== '') {
        return `${setext[1]!}\\${line.slice(setext[1]!.length)}`
      }
      return line
    })
    .join('\n')
}

/**
 * Többsoros szöveg egyetlen sorba: a sortörés és a körülötte álló szóköz egy
 * szóközzé olvad. Fejlécbe kerülő mezőhöz kell — a sortörés utáni rész a kész
 * szövegben már nem lenne megkülönböztethető a fejléc alatti bekezdéstől.
 */
export function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}
