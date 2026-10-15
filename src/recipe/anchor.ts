import { tokenize } from '../normalize/tokens.js'
import type { TimedLine } from '../types.js'

/** A bekezdés elejéből ennyi szót keresünk vissza. */
const PROBE_LENGTH = 12

/** Ennél rövidebb bekezdést nem lehet magabiztosan illeszteni. */
const MIN_PROBE_LENGTH = 4

/**
 * Előre tekintő ablak szóban. A mért bekezdéshossz 50–85 szó, tehát ez
 * nagyjából hat bekezdésnyi: egy elrontott illesztés után a következő még
 * visszatalál, egy távoli véletlen egyezés viszont kívül esik.
 */
const WINDOW_WORDS = 500

/**
 * Elfogadási küszöbök. **Becsült kezdőértékek, nem mértek** — a kalibrálásuk
 * valós modellhívásokat igényel, és külön körben történik (lásd a specet).
 */
const MIN_SCORE = 0.75
const MIN_MARGIN = 0.1

/** Legalább ennyi szóval távolabbi jelölt számít versenytársnak a fölényhez. */
const RIVAL_DISTANCE = 8

const HEADING = /^ {0,3}#{1,6} /

/** A horgonyzott bekezdés időbélyeggel kezdődik; a fejléc soha. */
const TIMESTAMP = /^\[\d{1,2}:\d{2}(?::\d{2})?\] /

/** Egy szó és a sor, ahonnan származik. */
interface Word {
  text: string
  line: number
}

export class AnchorError extends Error {}

/**
 * Sorrendtartó egyezés aránya: a leghosszabb közös részsorozat hossza a próba
 * hosszához mérve. A puszta szóhalmaz-egyezés nem lenne elég — az ismétlődő
 * fordulatok miatt a rossz jelölt is magas pontot kapna.
 */
export function lcsRatio(probe: readonly string[], hay: readonly string[]): number {
  if (probe.length === 0) return 0
  let prev = new Array<number>(hay.length + 1).fill(0)
  let cur = new Array<number>(hay.length + 1).fill(0)
  for (let i = 1; i <= probe.length; i++) {
    for (let j = 1; j <= hay.length; j++) {
      cur[j] =
        probe[i - 1] === hay[j - 1]
          ? prev[j - 1]! + 1
          : Math.max(prev[j]!, cur[j - 1]!)
    }
    const swap = prev
    prev = cur
    cur = swap
    cur.fill(0)
  }
  return prev[hay.length]! / probe.length
}

function wordStream(timed: readonly TimedLine[]): Word[] {
  const words: Word[] = []
  timed.forEach((line, index) => {
    for (const text of tokenize(line.text)) words.push({ text, line: index })
  })
  return words
}

/**
 * A próba helye a szófolyamban, a kurzortól előrefelé.
 *
 * A jelöltek azok a pozíciók, ahol a szó a próba első **vagy második**
 * tokenjével egyezik: az enyhe szerkesztés kiejthet egy vezető töltelékszót.
 */
function locate(
  words: readonly Word[],
  from: number,
  probe: readonly string[],
): { index: number; score: number; margin: number } {
  const end = Math.min(words.length, from + WINDOW_WORDS)
  const candidates: number[] = []
  for (let p = from; p < end; p++) {
    if (words[p]!.text === probe[0] || words[p]!.text === probe[1]) candidates.push(p)
  }
  if (candidates.length === 0) {
    for (let p = from; p < end; p += 3) candidates.push(p)
  }

  let best = { index: from, score: -1 }
  let rival = 0
  for (const p of candidates) {
    const hay = words.slice(p, p + probe.length + 6).map((w) => w.text)
    const score = lcsRatio(probe, hay)
    if (score > best.score) {
      if (Math.abs(p - best.index) > RIVAL_DISTANCE) rival = Math.max(rival, best.score)
      best = { index: p, score }
    } else if (score > rival && Math.abs(p - best.index) > RIVAL_DISTANCE) {
      rival = score
    }
  }
  return { ...best, margin: best.score - Math.max(rival, 0) }
}

/** Másodperc → `[MM:SS]`, egy órán túl `[H:MM:SS]`. */
export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `[${String(hours)}:${pad(minutes)}:${pad(secs)}]`
    : `[${pad(minutes)}:${pad(secs)}]`
}

/**
 * Egy bekezdés horgonyzása: a feldolgozott szöveg és az új kurzorpozíció.
 *
 * A kurzort **visszaadja**, nem mellékhatásként állítja: így az
 * `anchorParagraphs` az egyetlen hely, ahol a haladás állapota él.
 */
function anchorOne(
  paragraph: string,
  words: readonly Word[],
  timed: readonly TimedLine[],
  cursor: number,
): { text: string; cursor: number } {
  const probe = tokenize(paragraph).slice(0, PROBE_LENGTH)
  if (probe.length < MIN_PROBE_LENGTH) {
    throw new AnchorError(
      `a bekezdés túl rövid a horgonyzáshoz: "${paragraph.slice(0, 40)}"`,
    )
  }

  const hit = locate(words, cursor, probe)
  if (hit.score < MIN_SCORE || hit.margin < MIN_MARGIN) {
    throw new AnchorError(
      `a bekezdés nem horgonyozható magabiztosan (egyezés ${hit.score.toFixed(2)}, ` +
        `fölény ${hit.margin.toFixed(2)}): "${paragraph.slice(0, 40)}"`,
    )
  }

  const start = timed[words[hit.index]!.line]!.start
  return { text: `${formatTimestamp(start)} ${paragraph}`, cursor: hit.index }
}

/**
 * A modell prózája → ugyanaz, bekezdésenként időbélyeggel.
 *
 * A fejlécek változatlanul mennek át. A bizonytalanul illeszkedő bekezdés is
 * időbélyeg nélkül megy át — **nem dob**: egy rossz időbélyeg némán hibás
 * jegyzetet adna, de az egész jegyzet elvesztése rosszabb, mint egyetlen
 * bekezdés időbélyege. A hívó (`pipeline.runRecipe`) az `unanchoredParagraphs`
 * segítségével naplózza, hány bekezdés maradt így.
 */
export function anchorParagraphs(output: string, timed: readonly TimedLine[]): string {
  const words = wordStream(timed)
  const out: string[] = []
  let cursor = 0

  for (const block of output.split(/\n{2,}/)) {
    const trimmed = block.trim()
    if (trimmed === '') continue

    let paragraph = trimmed
    if (HEADING.test(trimmed)) {
      const [heading, ...rest] = trimmed.split('\n')
      out.push(heading!)
      paragraph = rest.join('\n').trim()
      if (paragraph === '') continue
    }

    try {
      const anchored = anchorOne(paragraph, words, timed, cursor)
      out.push(anchored.text)
      cursor = anchored.cursor
    } catch (error) {
      if (!(error instanceof AnchorError)) throw error
      // A bizonytalan bekezdés időbélyeg nélkül megy át, a kurzor pedig a
      // helyén marad: bukott illesztésnél nincs hiteles új pozíció, az ablak
      // (500 szó) viszont innen a következő bekezdést még eléri. Egy rossz
      // illesztés így egyetlen időbélyeget visz, nem az egész jegyzetet — az
      // pedig eddig a kifizetett modellhívás eredményét dobta el.
      out.push(paragraph)
    }
  }

  return out.join('\n\n')
}

/**
 * Hány prózabekezdés maradt időbélyeg nélkül a horgonyzott kimenetben, és
 * hányból. A fejlécek nem számítanak: azok eleve időbélyeg nélkül mennek át.
 *
 * A naplózás ebből tudja, mennyit veszített a jegyzet — a kihagyás okát
 * szándékosan nem visszük tovább, mert az a bekezdés szövegét tartalmazná.
 */
export function unanchoredParagraphs(anchored: string): { count: number; total: number } {
  let count = 0
  let total = 0
  for (const block of anchored.split(/\n{2,}/)) {
    const trimmed = block.trim()
    if (trimmed === '' || HEADING.test(trimmed)) continue
    total++
    if (!TIMESTAMP.test(trimmed)) count++
  }
  return { count, total }
}
