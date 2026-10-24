/** Egy szakkifejezés és a fordítása. Ha angolul marad, a kettő ugyanaz. */
export interface GlossaryPair {
  source: string
  target: string
}

/** A darab válaszában a fordítást és az új kifejezéspárokat elválasztó sor. Nem `---`: az Markdown vízszintes vonal. */
export const GLOSSARY_SEPARATOR = '<<<GLOSSARY>>>'

/** A szójegyzékfájl utótagja: videónként és célnyelvenként egy, receptfüggetlenül. */
export const glossaryOutputFile = (target: string): string => `_glossary-${target}.md`

/** A szójegyzékfájl fajtája: az `artifacts` követő sora, a frontmatter `kind` mezője és a vault-commit üzenete. */
export const glossaryKind = (target: string): string => `glossary-${target}`

const TABLE_HEADER = '| forrás | cél |'
const FENCE = /^\s*(```|~~~)/
const SEPARATOR_CELL = /^:?-+:?$/

const escapeCell = (text: string): string => text.replaceAll('|', '\\|')
const key = (term: string): string => term.toLowerCase()

/** `a | b` vagy `| a | b |` → pár; `null`, ha nem pontosan két nem üres cella. A `\|` a cellán belüli jel. */
function parseRow(line: string): GlossaryPair | null {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells = text.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'))
  if (cells.length !== 2 || cells.some((cell) => cell === '' || SEPARATOR_CELL.test(cell))) return null
  return { source: cells[0]!, target: cells[1]! }
}

const BULLET = /^[-*]\s+/
const HEADER_SOURCE = /^(source( term)?|term|forrás)$/i

const cellsOf = (line: string): string[] =>
  line.split('|').map((cell) => cell.trim()).filter((cell) => cell !== '')
const isSeparatorRow = (line: string): boolean => {
  const cells = cellsOf(line)
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell))
}

/**
 * A modell válaszsora, ha nem szójegyzéksor (üres lista jelzése, tábla elválasztója,
 * visszhangozott fejléc): ezek kimaradnak, nem hibásak. Fejléc az ismert első cellájú
 * sor, és bármely sor, amely után a tábla elválasztója jön. A `|`-t tartalmazó, de nem
 * két cellás sor viszont hibás válasz marad.
 */
function isNoise(line: string, next: string | undefined): boolean {
  if (!line.includes('|') || isSeparatorRow(line)) return true
  if (next !== undefined && isSeparatorRow(next)) return true
  const cells = cellsOf(line)
  return cells.length === 2 && HEADER_SOURCE.test(cells[0]!)
}

/**
 * A kódkerítésbe csomagolt fordítás kerítése nélkül: a záró kerítés az elválasztó
 * alá csúszhat (ott zaj), vagy a fordítás végén áll. Más kódkerítéshez nem nyúl.
 */
function unwrapFence(translation: string): string {
  const lines = translation.split('\n')
  if (!FENCE.test(lines[0]!)) return translation
  const fences = lines.filter((line) => FENCE.test(line)).length
  if (fences % 2 === 1) return lines.slice(1).join('\n').trim()
  if (/^\s*(```|~~~)\s*(markdown|md)\s*$/i.test(lines[0]!) && FENCE.test(lines.at(-1)!)) return lines.slice(1, -1).join('\n').trim()
  return translation
}

/** Egy darab válasza → fordítás és új párok; `null`, ha a válasz hibás (a darab újragenerálódik). */
export function parseChunkReply(reply: string): { translation: string; pairs: GlossaryPair[] } | null {
  const lines = reply.split('\n')
  const at = lines.flatMap((line, index) => (line.trim() === GLOSSARY_SEPARATOR ? [index] : []))
  if (at.length !== 1) return null
  const translation = unwrapFence(lines.slice(0, at[0]).join('\n').trim())
  if (translation === '') return null
  const pairs: GlossaryPair[] = []
  const rest = lines
    .slice(at[0]! + 1)
    .map((line) => line.trim().replace(BULLET, ''))
    .filter((text) => text !== '')
  for (const [index, text] of rest.entries()) {
    if (isNoise(text, rest[index + 1])) continue
    const pair = parseRow(text)
    if (pair === null) return null
    pairs.push(pair)
  }
  return { translation, pairs }
}

/** Az új párok a végére, kis-nagybetűtől függetlenül; ha a forrás már szerepel, az első fordítás marad. */
export function mergeGlossary(base: readonly GlossaryPair[], added: readonly GlossaryPair[]): GlossaryPair[] {
  const merged = [...base]
  const seen = new Set(base.map((pair) => key(pair.source)))
  for (const pair of added) {
    if (seen.has(key(pair.source))) continue
    seen.add(key(pair.source))
    merged.push(pair)
  }
  return merged
}

/** Azok a párok, amelyek forrása még nincs a `known`-ban. */
export function addedPairs(known: readonly GlossaryPair[], all: readonly GlossaryPair[]): GlossaryPair[] {
  const seen = new Set(known.map((pair) => key(pair.source)))
  return all.filter((pair) => !seen.has(key(pair.source)))
}

/** A promptba: soronként `forrás | cél`. */
export const glossaryLines = (pairs: readonly GlossaryPair[]): string =>
  pairs.map((pair) => `${escapeCell(pair.source)} | ${escapeCell(pair.target)}`).join('\n')

const tableRow = (pair: GlossaryPair): string => `| ${escapeCell(pair.source)} | ${escapeCell(pair.target)} |`

/** Új Markdown-tábla a párokkal (üres listánál csak a fejléc). */
export const glossaryTable = (pairs: readonly GlossaryPair[]): string =>
  [TABLE_HEADER, '|---|---|', ...pairs.map(tableRow)].join('\n')

/** A kódkerítésen kívüli táblák: soronkénti indexek, táblánként egy tömb. */
function tableBlocks(lines: readonly string[]): number[][] {
  const blocks: number[][] = []
  let inFence = false
  let current: number[] | null = null
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) inFence = !inFence
    if (!inFence && line.trim().startsWith('|')) {
      if (current === null) blocks.push((current = []))
      current.push(index)
    } else {
      current = null
    }
  }
  return blocks
}

/**
 * A szójegyzékfájl párjai: csak a táblák sorai, a fejléc- és az elválasztó sor
 * nélkül. Minden más sor (próza, címsor) nem számít. A két cellára nem bontható
 * sor kimarad, a `skipped` számolja.
 */
export function readGlossaryTable(markdown: string): { pairs: GlossaryPair[]; skipped: number } {
  const lines = markdown.split('\n')
  const pairs: GlossaryPair[] = []
  let skipped = 0
  for (const block of tableBlocks(lines)) {
    for (const index of block.slice(2)) {
      const pair = parseRow(lines[index]!)
      if (pair === null) skipped++
      else pairs.push(pair)
    }
  }
  return { pairs, skipped }
}

/** Az új párok az utolsó tábla végére; a fájl többi része betűre marad. Tábla nélkül a végére egy új. */
export function appendGlossaryRows(markdown: string, pairs: readonly GlossaryPair[]): string {
  if (pairs.length === 0) return markdown
  const lines = markdown.split('\n')
  const last = tableBlocks(lines).at(-1)?.at(-1)
  if (last === undefined) return `${markdown.trimEnd()}\n\n${glossaryTable(pairs)}\n`
  lines.splice(last + 1, 0, ...pairs.map(tableRow))
  return lines.join('\n')
}
