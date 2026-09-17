/**
 * A `render.ts` által írt jegyzet eleje: frontmatter, `# cím`, üres sor, az
 * elhagyható linksor, és a `---` elválasztó. A frontmatter többsoros mezői
 * két szóközzel behúzottak, tehát egy leírásban álló `---` sor nem zárja le.
 */
const NOTE_HEADER = /^---\n([\s\S]*?)\n---\n# [^\n]*\n\n(?:🌐 <[^>\n]*>\n\n)?---\n\n/

const GENERATED_AT = /^generated_at: "?([^"\n]+)"?$/m

/**
 * Egysoros Obsidian-megjegyzés. Nem tartalom, és a Decks ismétlési horgonyai
 * (`%%dk:h:…%%`) is ilyenek: egy fordításba átmásolt horgony két paklit kötne
 * ugyanahhoz az ismétlési állapothoz.
 */
const COMMENT = /[ \t]*%%[^%\n]*%%/g

export interface NoteBody {
  /** A jegyzet tartalma frontmatter, fejléc és megjegyzések nélkül. */
  body: string
  /** A frontmatter `generated_at` mezője; `null`, ha hiányzik. */
  generatedAt: string | null
}

/**
 * Egy publikált jegyzet törzse — a `render.ts` `body()` függvényének pontos
 * megfordítása. A fordítás ebből dolgozik, tehát egy Obsidianban kézzel
 * javított jegyzet javított változata fordul.
 *
 * Fel nem ismerhető fejlécnél **dob**: a rossz bemenet `item:failed` legyen,
 * ne néma, félrefordított jegyzet.
 */
export function noteBody(markdown: string): NoteBody {
  const header = NOTE_HEADER.exec(markdown)
  if (header === null) {
    throw new Error(
      'a forrásjegyzet fejléce nem ismerhető fel — nem a transcript-refinery írta, vagy kézzel átszerkesztették',
    )
  }
  return {
    body: markdown.slice(header[0].length).replace(COMMENT, '').trimEnd(),
    generatedAt: GENERATED_AT.exec(header[1]!)?.[1] ?? null,
  }
}
