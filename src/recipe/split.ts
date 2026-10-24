import { countWords } from '../normalize/dedupe.js'

/** A fordítás darabolási küszöbe szóban, ha a config nem mond mást (#259, mérve: `docs/measurements/2026-10-24-forditas-darabolas-kalibralas.md`). */
export const DEFAULT_CHUNK_WORDS = 8000

const FENCE = /^\s*(```|~~~)/
const HEADING = /^#{1,6}\s/
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/
const INDENTED = /^(\s{2,}|\t)\S/

/** Üres sorral elválasztott részek, amelyek között nem vághatunk (kódkerítés, lista, fejléc a bekezdésével). */
interface Block {
  parts: string[]
  words: number
  /** Fejléccel kezdődik: új szakaszt nyit. */
  heading: boolean
  /** Csak egy fejlécsor: a következő résszel együtt marad. */
  headingOnly: boolean
  list: boolean
}

const firstLine = (part: string): string => part.split('\n').find((line) => line.trim() !== '') ?? ''
const isHeadingOnly = (part: string): boolean => HEADING.test(part.trim()) && !part.trim().includes('\n')
/** A rész valamelyik sora listaelem: a lista a rész közepén is kezdődhet (fejléc vagy bevezető mondat után). */
const hasListItem = (part: string): boolean => part.split('\n').some((line) => LIST_ITEM.test(line))

/**
 * A törzs `\n\n` mentén, részekre bontva. A `split`/`join` pár miatt az összefűzés
 * betűre visszaadja a törzset, kettőnél több sortörésnél is. Kódkerítésen belül,
 * lista folytatásánál és fejléc után a rész az előzőhöz tapad. A táblázat sorai
 * között nincs üres sor, tehát egy rész.
 */
function blocksOf(body: string): Block[] {
  const blocks: Block[] = []
  let inFence = false
  for (const part of body.split('\n\n')) {
    const first = firstLine(part)
    const prev = blocks.at(-1)
    const joins =
      prev !== undefined &&
      (inFence || prev.headingOnly || (prev.list && (LIST_ITEM.test(first) || INDENTED.test(first))))
    if (joins) {
      prev.list ||= hasListItem(part)
      prev.parts.push(part)
      prev.words += countWords(part)
      prev.headingOnly = isHeadingOnly(part)
    } else {
      blocks.push({
        parts: [part],
        words: countWords(part),
        heading: HEADING.test(first),
        headingOnly: isHeadingOnly(part),
        list: hasListItem(part),
      })
    }
    for (const line of part.split('\n')) if (FENCE.test(line)) inFence = !inFence
  }
  return blocks
}

/**
 * A fordítás darabjai (#259). A szakaszokat (fejléctől fejlécig) sorban egy darabba
 * gyűjti a küszöbig; a küszöbnél hosszabb szakaszt bekezdéshatáron vágja. Egy darab
 * csak akkor hosszabb a küszöbnél, ha egyetlen oszthatatlan egység az. A darabok
 * `\n\n`-nel összefűzve az eredeti törzset adják.
 */
export function splitForTranslation(body: string, chunkWords: number): string[] {
  const sections: Block[][] = []
  for (const block of blocksOf(body)) {
    if (block.heading || sections.length === 0) sections.push([block])
    else sections.at(-1)!.push(block)
  }
  const units = sections.flatMap((blocks) => {
    const words = blocks.reduce((sum, block) => sum + block.words, 0)
    return words <= chunkWords ? [{ parts: blocks.flatMap((block) => block.parts), words }] : blocks
  })
  const chunks: { parts: string[]; words: number }[] = []
  for (const unit of units) {
    const last = chunks.at(-1)
    // Az üres (szó nélküli) darab sosem marad magában: modellhívás lenne üres szövegre.
    if (last !== undefined && (last.words === 0 || last.words + unit.words <= chunkWords)) {
      last.parts.push(...unit.parts)
      last.words += unit.words
    } else {
      chunks.push({ parts: [...unit.parts], words: unit.words })
    }
  }
  return chunks.map((chunk) => chunk.parts.join('\n\n'))
}
