import { escapeMdx, splitHeader } from './mdx.js'

// ponytail: a cím `*`-törlése a szó szerinti csillagot is viszi, ritka
function attribute(title: string): string {
  return title.replace(/\*\*|\*|`/g, '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * A kártya-jegyzet (`flashcards`, `qa`, `bloom`) törzsét `<Accordions>`-szé bontja,
 * kérdésenként egy `<Accordion>`-nal; a kérdés után álló minden bekezdés a válasz.
 * Az Obsidian `%%…%%` soraiból (Decks kártya-azonosító) semmi nem kerül ki.
 * `null`, ha nincs kérdés vagy van üres válaszú kérdés: a hívó a fallbacket írja.
 */
export function cardsMdx(body: string, siteKind: 'flashcards' | 'qa' | 'bloom'): string | null {
  const { header, rest } = splitHeader(body)
  const parts = rest
    .split('\n')
    .filter((line) => !/^\s*%%.*%%\s*$/.test(line))
    .join('\n')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const preamble: string[] = []
  const cards: { title: string; answer: string[] }[] = []
  for (const part of parts) {
    const heading = /^ {0,3}## ([^\n]+)$/.exec(part)?.[1]
    const bold = siteKind === 'qa' ? /^\*\*([^\n]+)\*\*$/.exec(part)?.[1] : undefined
    const question = heading !== undefined ? /^\*\*(.+)\*\*$/.exec(heading)?.[1] ?? heading : bold
    if (question !== undefined) cards.push({ title: question, answer: [] })
    else (cards.at(-1)?.answer ?? preamble).push(part)
  }
  if (cards.length === 0 || cards.some((card) => card.answer.length === 0)) return null
  const items = cards.map(
    (card) => `<Accordion title="${attribute(card.title)}">\n\n${escapeMdx(card.answer.join('\n\n'))}\n\n</Accordion>\n\n`,
  )
  return [
    ...(header ? [escapeMdx(header)] : []),
    ...(preamble.length > 0 ? [escapeMdx(preamble.join('\n\n'))] : []),
    `<Accordions type="multiple">\n\n${items.join('')}</Accordions>\n`,
  ].join('\n\n')
}
