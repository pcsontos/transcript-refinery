const PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu
const JSX_TAG = /(?<!\\)<\/?[A-Z][\w.]*(?:\s+[\w-]+(?:="[^"]*")?)*\s*\/?>/g

/** Egy sor szavai a jelölők nélkül: komponenscímke, link, autolink, `>`, listajel, escape. */
function lineWords(line: string): string[] {
  return line
    .replace(JSX_TAG, ' ')
    .replace(/\[([^\]]*)\]\(<?([^)>\s]*)>?\)/g, (_, text: string, url: string) => (text === url ? text : `${text} ${url}`))
    .replace(/<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/g, '$1')
    .replace(/^(?:\s*>)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\\([\p{P}\p{S}])/gu, '$1')
    .split(/\s+/)
    .map((word) => word.replace(PUNCTUATION, ''))
    .filter((word) => word !== '')
}

/**
 * A szöveg szósorozata Markdown-jelölők nélkül; a kódblokk egy egység (a tartalma szóközre normalizálva).
 * A címsor sora és a sor eleji félkövér szöveg a `headings`-be is kerül; ha `keep` meg van adva, az abban nem szereplő cím kimarad (új cím).
 */
function wordsOf(text: string, keep?: Set<string>): { words: string[]; headings: Set<string> } {
  const words: string[] = []
  const headings = new Set<string>()
  let fence: { char: string; length: number; info: string; content: string[] } | null = null
  const closeFence = () => {
    words.push('```' + fence!.info + ' ' + fence!.content.join(' ').split(/\s+/).filter(Boolean).join(' '))
    fence = null
  }
  for (const line of text.normalize('NFC').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence !== null) {
      if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && marker[2]!.trim() === '') closeFence()
      else fence.content.push(line)
    } else if (marker) {
      fence = { char: marker[1]![0]!, length: marker[1]!.length, info: marker[2]!.trim(), content: [] }
    } else {
      const heading = /^ {0,3}#{1,6}\s+(.*)$/.exec(line)?.[1]
      if (heading === undefined) {
        // a sor eleji félkövér bevezető (`**Cím.** Szöveg`) ismert cím is: a modell címmé emelheti
        const lead = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\*\*(.+?)\*\*/.exec(line)?.[1]
        if (lead !== undefined) headings.add(lineWords(lead).join(' '))
        words.push(...lineWords(line))
        continue
      }
      const headingWords = lineWords(heading)
      headings.add(headingWords.join(' '))
      if (keep === undefined || keep.has(headingWords.join(' '))) words.push(...headingWords)
    }
  }
  if (fence !== null) closeFence()
  return { words, headings }
}

/**
 * `null`, ha az átalakított kimenet szósorozata egyezik az eredetiével (a jelölők, a komponensek és az
 * új címek nem számítanak, a kis-nagybetű igen); különben az első eltérés leírása.
 */
export function verbatimError(original: string, output: string): string | null {
  const expected = wordsOf(original)
  const actual = wordsOf(output, expected.headings).words
  const same = (words: string[], i: number) => `„${words.slice(i, i + 6).join(' ')}”`
  const length = Math.min(expected.words.length, actual.length)
  for (let i = 0; i < length; i++) {
    if (expected.words[i] !== actual[i]) {
      return `szó szerinti eltérés a(z) ${i + 1}. szónál: várt ${same(expected.words, i)}, kapott ${same(actual, i)}`
    }
  }
  if (actual.length < expected.words.length) {
    return `szó szerinti eltérés a(z) ${length + 1}. szónál: a kimenetből hiányzik a vége: ${same(expected.words, length)}`
  }
  if (actual.length > expected.words.length) {
    return `szó szerinti eltérés a(z) ${length + 1}. szónál: többlet a kimenet végén: ${same(actual, length)}`
  }
  return null
}

/** A kimenet elején álló `<Callout type="note" title="…">` bevezető blokk és a maradék; `null`, ha nincs vagy üres. */
export function takeIntro(output: string, title: string): { intro: string; rest: string } | null {
  const open = `<Callout type="note" title="${title}">`
  const text = output.trim()
  if (!text.startsWith(open)) return null
  const end = text.indexOf('</Callout>')
  if (end === -1) return null
  const intro = text.slice(open.length, end).trim()
  return intro === '' ? null : { intro, rest: text.slice(end + '</Callout>'.length).trim() }
}
