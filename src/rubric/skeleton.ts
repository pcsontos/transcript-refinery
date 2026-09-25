import type { Criterion, Score } from './types.js'

/** Nyitó vagy záró kódkerítés; a második csoport a típusjelölő. */
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/

/** A horgonyzott `clean`-szintek bekezdés eleji időbélyege: `[MM:SS]` vagy `[H:MM:SS]`. */
const TIMESTAMP = /^\[(?:\d+:)?\d{2}:\d{2}\]/

/** ATX-fejléc; a `#decks` hashtag és az escape-elt `\##` nem az. */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/

/** Lista eleje a sor elején; a sor közepén álló „1." nem az. */
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]/

const TABLE_ROW = /^\s*\|/

/** A vault szabálya szerinti linkcél, és a csupasz, szögletes zárójeles URL. */
const LINK_TARGET = /\]\(<([^>\n]*)>\)|<(https?:\/\/[^>\s]+)>/g

/** Egy jegyzet szerkezete, a szövegtől függetlenül. */
export interface Skeleton {
  timestamps: string[]
  /** A fejlécek szintjei, sorrendben. */
  headings: number[]
  /** Üres sorral elválasztott blokkok; egy kódblokk egy blokk. */
  blocks: number
  listItems: number
  /** Táblázatsoronként az oszlopszám. */
  tableRows: number[]
  /** A kódkerítések típusjelölői; jelölő nélkül üres szöveg. */
  fences: string[]
  links: string[]
}

/** Szigorítás a váz összevetésén; hiánya a tűréses alapviselkedés. */
export interface SkeletonStrictness {
  /**
   * A fejlécek darabszáma tartalmi invariáns — a Bloom-jegyzetben egy `##`
   * fejléc egy kártya —, ezért nincs rá tűrés.
   */
  headingsAreContent?: boolean
}

/** A puha vázelemek tűrése: a forrás ekkora hányada, de legalább egy elem. */
const TOLERANCE_SHARE = 0.05

/** Ennél kevesebb elemnél nincs tűrés: ott egy egységnyi eltérés is nagy arány. */
const TOLERANCE_MIN_ITEMS = 5

/**
 * Hány elemnyi eltérést enged a kapu egy puha vázelemen.
 *
 * A modell természetes bekezdés- és fejlécbontása a dokumentum hosszával együtt
 * nő: a kalibrálás mind a négy valós mintáján 1-2 egységnyi volt az eltérés,
 * miközben a fordítások hibátlanok voltak
 * (`docs/measurements/2026-09-17-forditas-kalibralas.md`). Rövid jegyzetben
 * viszont egy egységnyi eltérés is nagy arány — ott a kapu szigorú marad.
 */
function tolerance(want: number): number {
  return want < TOLERANCE_MIN_ITEMS ? 0 : Math.max(1, Math.ceil(want * TOLERANCE_SHARE))
}

/** Egy táblázatsor oszlopszáma; a sor eleji és végi `|` nem nyit új oszlopot. */
function columns(row: string): number {
  const cells = row.trim().replace(/\\\|/g, '').split('|')
  const leading = cells[0]?.trim() === '' ? 1 : 0
  const trailing = cells.length > 1 && cells.at(-1)?.trim() === '' ? 1 : 0
  return cells.length - leading - trailing
}

/**
 * A Markdown váza. A kódblokk belsejét kihagyja: a Mermaid-címkék fordulnak,
 * tehát a tartalmuk eltér — csak a kerítés típusa számít.
 */
export function skeletonOf(markdown: string): Skeleton {
  const skeleton: Skeleton = {
    timestamps: [],
    headings: [],
    blocks: 0,
    listItems: 0,
    tableRows: [],
    fences: [],
    links: [],
  }
  let fence: string | null = null
  let inBlock = false

  for (const line of markdown.split('\n')) {
    const marker = FENCE.exec(line)
    if (fence !== null) {
      if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && marker[2] === '') {
        fence = null
      }
      continue
    }
    if (marker) {
      fence = marker[1]!
      skeleton.fences.push(marker[2]!)
      if (!inBlock) {
        skeleton.blocks++
        inBlock = true
      }
      continue
    }
    if (line.trim() === '') {
      inBlock = false
      continue
    }
    if (!inBlock) {
      skeleton.blocks++
      inBlock = true
      const stamp = TIMESTAMP.exec(line.trimStart())
      if (stamp) skeleton.timestamps.push(stamp[0])
    }
    const heading = HEADING.exec(line)
    if (heading) skeleton.headings.push(heading[1]!.length)
    if (LIST_ITEM.test(line)) skeleton.listItems++
    if (TABLE_ROW.test(line)) skeleton.tableRows.push(columns(line))
    for (const match of line.matchAll(LINK_TARGET)) skeleton.links.push((match[1] ?? match[2])!)
  }

  return skeleton
}

/** Az első index, ahol a két sorozat eltér; `-1`, ha azonosak. */
function firstDifference<T>(a: readonly T[], b: readonly T[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return i
  }
  return -1
}

/** A kódkerítés típusjelölője a hiányüzenetben; jelölő nélkül `plain`. */
function fenceName(info: string | undefined): string {
  return info === undefined || info === '' ? 'plain' : info
}

/** Az `a` elemei, amelyekből a `b`-ben nincs ugyanannyi. */
function multisetMinus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>()
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1)
  return a.filter((x) => {
    const n = left.get(x) ?? 0
    if (n === 0) return true
    left.set(x, n - 1)
    return false
  })
}

/**
 * Determinisztikus vázkapu, nulla token: a fordítás szerkezete a forrásé-e.
 *
 * Azt a hibamódot fogja meg, ami a fordításnál a legvalószínűbb és a bírónak
 * a legdrágább: hogy a modell **összevon, kihagy vagy összefoglal**. Elemenként
 * az első eltérést nevezi meg. A hiányüzenetek angolul szólnak, mert
 * visszamennek a javító promptba.
 *
 * Az időbélyeg, a listaelem, a táblázatsor, a kódkerítés és a linkcél
 * összevetése bájtra pontos. A bekezdés- és a fejléc-darabszám **tűrő**: a
 * természetes átfogalmazás ne buktasson el hibátlan fordítást. A tűrésen belül
 * maradó, valódi hiányokat a fordításhűség-bíró fogja — a kapu olcsó szűrő,
 * nem az egyetlen védelem.
 */
export function checkSkeleton(
  output: string,
  source: string,
  strictness: SkeletonStrictness = {},
): Score {
  const want = skeletonOf(source)
  const got = skeletonOf(output)
  const gaps: string[] = []

  const stamp = firstDifference(want.timestamps, got.timestamps)
  if (stamp !== -1) {
    if (want.timestamps.length !== got.timestamps.length) {
      const after = stamp === 0 ? 'the start of the note' : want.timestamps[stamp - 1]!
      gaps.push(
        `The translation has ${String(got.timestamps.length)} timestamps, the source has ` +
          `${String(want.timestamps.length)}; the first difference follows ${after}.`,
      )
    } else {
      gaps.push(
        `Timestamp ${String(stamp + 1)} is ${want.timestamps[stamp]!} in the source but ` +
          `${got.timestamps[stamp]!} in the translation. Keep every timestamp exactly as it is.`,
      )
    }
  }

  if (want.headings.length === got.headings.length) {
    const heading = firstDifference(want.headings, got.headings)
    if (heading !== -1) {
      gaps.push(
        `Heading ${String(heading + 1)} is level ${String(want.headings[heading])} in the ` +
          `source but level ${String(got.headings[heading])} in the translation.`,
      )
    }
  } else {
    const allowed = strictness.headingsAreContent === true ? 0 : tolerance(want.headings.length)
    if (Math.abs(want.headings.length - got.headings.length) > allowed) {
      gaps.push(
        `The translation has ${String(got.headings.length)} headings, the source has ` +
          `${String(want.headings.length)}. Keep every heading at its level.`,
      )
    }
  }

  if (Math.abs(want.blocks - got.blocks) > tolerance(want.blocks)) {
    gaps.push(
      `The translation has ${String(got.blocks)} paragraphs, the source has ` +
        `${String(want.blocks)}. Do not merge, split or drop paragraphs.`,
    )
  }

  if (want.listItems !== got.listItems) {
    gaps.push(
      `The translation has ${String(got.listItems)} list items, the source has ` +
        `${String(want.listItems)}. Keep every list item.`,
    )
  }

  const row = firstDifference(want.tableRows, got.tableRows)
  if (row !== -1) {
    gaps.push(
      want.tableRows.length !== got.tableRows.length
        ? `The translation has ${String(got.tableRows.length)} table rows, the source has ` +
            `${String(want.tableRows.length)}. Keep every table row.`
        : `Table row ${String(row + 1)} has ${String(want.tableRows[row])} columns in the ` +
            `source but ${String(got.tableRows[row])} in the translation.`,
    )
  }

  const fence = firstDifference(want.fences, got.fences)
  if (fence !== -1) {
    gaps.push(
      want.fences.length !== got.fences.length
        ? `The translation has ${String(got.fences.length)} code blocks, the source has ` +
            `${String(want.fences.length)}. Keep every code block.`
        : `Code block ${String(fence + 1)} is marked \`${fenceName(want.fences[fence])}\` in ` +
            `the source but \`${fenceName(got.fences[fence])}\` in the translation.`,
    )
  }

  const missing = multisetMinus(want.links, got.links)
  const added = multisetMinus(got.links, want.links)
  if (missing.length > 0) {
    gaps.push(`A link target changed: <${missing[0]!}> is missing from the translation.`)
  } else if (added.length > 0) {
    gaps.push(`The translation adds a link target that is not in the source: <${added[0]!}>.`)
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/**
 * Kapu-kritérium: bukása esetén a bíró-hívás el sem indul. A forrás a
 * `ScoreContext.transcript` — fordításnál a futás a forrásjegyzet törzsét
 * teszi oda. A szigorítás a forrásreceptből jön
 * (`Recipe.headingsAreContent`).
 */
export function skeletonCriterionFor(strictness: SkeletonStrictness = {}): Criterion {
  return {
    name: 'skeleton',
    blocking: true,
    score: (ctx) => Promise.resolve(checkSkeleton(ctx.output, ctx.transcript, strictness)),
  }
}
