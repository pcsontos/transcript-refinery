/** Egy kártya a renderelt szövegből visszaolvasva. */
export interface ParsedCard {
  question: string
  body: string
}

/**
 * A renderelt paklit kártyákra bontja. A behúzott `##`-t is kártyakezdetnek
 * veszi, mert Obsidian is annak veszi; az első fejléc előtti szöveg nem kártya.
 */
export function parseCards(output: string): ParsedCard[] {
  const cards: { question: string; body: string[] }[] = []
  for (const line of output.split('\n')) {
    const heading = /^ {0,3}## (.*)$/.exec(line)
    if (heading) {
      cards.push({ question: heading[1]!.trim(), body: [] })
    } else if (cards.length > 0) {
      cards[cards.length - 1]!.body.push(line)
    }
  }
  return cards.map((c) => ({ question: c.question, body: c.body.join('\n').trim() }))
}

/**
 * A kártyapaklik közös, darabszámtól független hibái: válasz nélkül maradt
 * fejléc és ismétlődő kérdés (a modell kedvenc hibája hosszú átiraton).
 *
 * A sorrend — előbb az üres hátoldalak, aztán az ismétlődések — és az üzenetek
 * szövege a `flashcards` kapujáé, bájtra: a hiánylista a javító promptba és a
 * felületre megy. Angolul, mert a modellnek szól.
 */
export function checkCardBasics(cards: readonly ParsedCard[]): string[] {
  const gaps: string[] = []

  for (const card of cards.filter((c) => c.body === '')) {
    gaps.push(`The card "${card.question}" is a heading without an answer below it.`)
  }

  const seen = new Map<string, string>()
  for (const card of cards) {
    const key = card.question.toLocaleLowerCase()
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, card.question)
    } else {
      gaps.push(
        `Two cards ask the same question: "${first}". Ask about a different point instead.`,
      )
    }
  }

  return gaps
}
