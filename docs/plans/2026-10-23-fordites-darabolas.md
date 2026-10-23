# A fordítás darabolása és a fordítás közben készülő szójegyzék — megvalósítási terv

> **A végrehajtónak:** a terv natívan, skill és alügynök nélkül fut (Read, Edit, Bash). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** a hosszú forrásjegyzet fordítása darabokban, sorban fut, minden darab megkapja az addig gyűlt szójegyzéket, és a kész darabok bukás után megmaradnak. Minden fordítás (darabolt és nem darabolt) olvassa és bővíti a videó és a célnyelv közös `_glossary-<cél>.md` fájlját (#259).

**Felépítés:**
- **Tiszta függvények:** `src/recipe/split.ts` (darabolás), `src/recipe/glossary.ts` (a válasz szétbontása, a szójegyzék-tábla olvasása és bővítése, összefésülés).
- **Prompt és config:** a `translate.ts` új `translationChunkPrompt`-ot kap. A `Translation` mostantól a `chunkWords`-öt is viszi: a YAML-ban `translate.chunk_words`, alapértéke 4 000.
- **Állapottár:** új `translation_chunks` tábla, három metódus hozzá, és egy `markPendingCommit` a szójegyzékfájl commitjához.
- **Futtató:** `src/recipe/translate-chunks.ts` (`translateChunked`), a `refine` helyett a fordításoknál. Darabonként saját óra, sorban futó darabok, legfeljebb háromszori generálás, utána egy pontozás az összefűzött szövegen.
- **Pipeline:** a recept órája egy `recipeClock` segédbe költözik (a `refine` és a darabok is ezt használják). Fordításnál a futtató hívódik, utána a szójegyzékfájl kiírása, a commit-jelölés és a darabok törlése következik.

**Technológia:** TypeScript, zod, vitest, `node:sqlite`, `node:crypto`.

**Spec:** `docs/plans/2026-10-23-fordites-darabolas-spec.md`

**Ág:** a kód-ág a `main`-ről indul, a docs-PR merge-e után; a nevét a felhasználó adja (javaslat: `feat/forditas-darabolas`). Egy kód-PR, utána kiadás.

## Eltérések a spectől és pontosítások (a tervezés közben dőltek el)

| Spec | Terv | Miért |
|---|---|---|
| Config-kulcs `translate.chunkWords` | A YAML-ban `translate.chunk_words`, a kódban `TranslateConfig.chunkWords` és `Translation.chunkWords` | A YAML-kulcsok snake_case-ek (`reading_wpm`, `recipe_timeout_minutes`) |
| A fájl neve `_glossary-<cél>.md` | `noteFile(…, '_glossary-<cél>.md')`, tehát a lemezen `<alapnév>_glossary-de.md` | Ugyanaz az elhelyezés, mint a recept-jegyzeteké (`<alapnév>_summary-de.md`); a spec ezt kéri („`noteFile`, ugyanaz az elhelyezés”) |
| „A költségkeret minden darab hívása után könyvel” | A futtató hívásonként könyvel (darab, minden újrapróba, pontozás); a pipeline a fordításnál nem könyvel újra | A `CostGuard` lágy kapu, az elemek között nézik. A hívásonkénti könyvelés azért kell, hogy egy bukó darab előtti hívások is a futás költésébe számítsanak |
| A recept `prompt`-ja | A fordítórecept `prompt`/`repairPrompt`-ja **változatlan** marad; a futás a `translationChunkPrompt`-ot hívja | Az `evals/translate.eval.ts` és az `evals/measure/calibrate-translate.ts` a `refine`-on át az egyhívásos promptot használja; az elválasztós kimenet ott a vázkapu pontszámát rontaná |
| `generations` darabolt futásnál | `1` (nincs javító kör); a `rounds` darabonként egy bejegyzés | A `RefineResult.generations` jelentése: „Egy = nem volt javító kör”. A `rounds` hossza a darabszám |
| A `|` jel a kifejezésben | Kiíráskor `\|`; olvasáskor a nem escape-elt `|` választ. Ha egy sor nem pontosan két nem üres cella, **kimarad** (táblában figyelmeztetéssel, `item:glossary-skipped`), a modellválaszban **hibás válasz** (újrakérés) | A spec ezt a végrehajtóra hagyta. A tábla kézzel is szerkeszthető, a válasz nem |
| Elválasztó | `<<<GLOSSARY>>>` egy önálló sorban (a sor körüli szóköz megengedett) | Nem `---`, és fordításban nem fordul elő |
| Élő követés | A mai `item:generating` jön darabonként, `generation` = a darab sorszáma | Igaz marad: ennyiedik generálás fut |
| A tábla akkor marad érintetlen, ha egy darab van | A futtató `chunked: false`-t ad vissza, és ilyenkor sem olvas, sem ír, sem töröl a táblában (a `--force` sem) | A spec: „nincs tábla-írás” |

**A spec ellenőrzendő pontja, a tervezéskor igazolva:** a `run` egy elem receptjeit sorban dolgozza fel (`src/cli.ts`, `for (const [index, unit] of planned.entries())`, benne `await processItem`), a `watch` is (`src/watch/round.ts:59`). A szójegyzékfájlnak tehát egy futáson belül nincs egyidejű írója.

## Globális megkötések

- Új függőség nincs.
- Új fájl csak: `src/recipe/split.ts`, `src/recipe/glossary.ts`, `src/recipe/translate-chunks.ts` és a három tesztjük.
- Magyar kommentek és üzenetek a környező kód sűrűségével. A promptok angolok, mint a `translate.ts`-ben.
- A `RoundTrace` számot visz, szöveget nem: sem a darab szövege, sem a szójegyzék nem kerülhet eseménybe vagy riportba.
- Ellenőrzés minden feladat végén: `pnpm typecheck && pnpm lint && pnpm test`, mind zöld.
- Commit minden feladat végén a `commit-message` skill-lel, `Refs #259`; az utolsó kód-commit `Closes #259`.

## Amire a review figyeljen

1. **A darabok összefűzve betűre az eredeti törzs**, akkor is, ha a törzsben kettőnél több egymást követő sortörés vagy üres sort tartalmazó kódkerítés van. (1. feladat, `join`-teszt.)
2. **Hibás modellválasz** (hiányzó vagy dupla elválasztó, egycellás sor): legfeljebb három generálás, mindegyik költsége könyvelve; utána bukás, a kész darabok a táblában maradnak. (5. feladat.)
3. **A kézzel írt szöveg a szójegyzékfájlban megmarad**, a tábla utáni próza is; új sor csak a tábla végére kerül, a meglévő sor nem duplázódik. (2. és 6. feladat.)
4. **`dryRun` mellett** sem tábla-írás, sem szójegyzékfájl nincs, a write-once kihagyáskor a szójegyzékhez nem nyúl a futás. (5. és 6. feladat.)
5. **Folytatásnál** a lenyomat (forrás, küszöb, célnyelv, draft modell) dönt: egyezésnél a kész darab nem fut újra, eltérésnél minden darab törlődik, és elölről indul. (5. feladat.)

---

### 1. feladat: a darabolás (tiszta függvény)

**Fájlok:**
- Új: `src/recipe/split.ts`
- Teszt: `src/recipe/split.test.ts`

**Interfész:**
- Ad: `DEFAULT_CHUNK_WORDS = 4000`, `splitForTranslation(body: string, chunkWords: number): string[]`

**Kód (`src/recipe/split.ts`):**
```ts
import { countWords } from '../normalize/dedupe.js'

/** A fordítás darabolási küszöbe szóban, ha a config nem mond mást. Becslés; a kalibrálás dönti el (#259). */
export const DEFAULT_CHUNK_WORDS = 4000

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
      prev.parts.push(part)
      prev.words += countWords(part)
      prev.headingOnly = isHeadingOnly(part)
    } else {
      blocks.push({
        parts: [part],
        words: countWords(part),
        heading: HEADING.test(first),
        headingOnly: isHeadingOnly(part),
        list: LIST_ITEM.test(first),
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
```

- [ ] **1. lépés: a bukó tesztek (`src/recipe/split.test.ts`).**
  ```ts
  import { describe, expect, it } from 'vitest'
  import { DEFAULT_CHUNK_WORDS, splitForTranslation } from './split.js'

  const szavak = (n: number): string => Array.from({ length: n }, () => 'szó').join(' ')
  /** `## <cím>` (2 szó) + egy n szavas bekezdés. */
  const szakasz = (cim: string, n: number): string => `## ${cim}\n\n${szavak(n)}`

  describe('splitForTranslation', () => {
    it('a küszöb alatt egy darab, változatlanul', () => {
      const body = szakasz('A', 4)
      expect(splitForTranslation(body, DEFAULT_CHUNK_WORDS)).toEqual([body])
    })

    it('fejlécnél vág, a szakaszokat a küszöbig egy darabba gyűjti', () => {
      const [a, b, c] = [szakasz('A', 4), szakasz('B', 4), szakasz('C', 4)]
      expect(splitForTranslation([a, b, c].join('\n\n'), 12)).toEqual([`${a}\n\n${b}`, c])
    })

    it('a küszöbnél hosszabb szakaszt bekezdéshatáron vágja, a fejléc az első bekezdésével marad', () => {
      const body = ['## Hosszú', szavak(5), szavak(5), szavak(5)].join('\n\n')
      expect(splitForTranslation(body, 8)).toEqual([`## Hosszú\n\n${szavak(5)}`, szavak(5), szavak(5)])
    })

    it('kódkerítés közepén nem vág, akkor sem, ha üres sor van benne', () => {
      const fence = '```mermaid\ngraph TD\n\nA --> B\n```'
      const chunks = splitForTranslation([szavak(3), fence, szavak(3)].join('\n\n'), 2)
      expect(chunks).toContain(fence)
    })

    it('táblázatot és összefüggő listát nem vág szét', () => {
      const table = '| a | b |\n|---|---|\n| c | d |\n| e | f |'
      const list = '- egy kettő három\n\n- négy öt hat\n\n  folytatás hét nyolc'
      const chunks = splitForTranslation([table, list].join('\n\n'), 3)
      expect(chunks).toEqual([table, list])
    })

    it.each([
      ['több üres sor', `${szakasz('A', 5)}\n\n\n\n${szakasz('B', 5)}`],
      ['kódkerítés üres sorral', `${szakasz('A', 5)}\n\n\`\`\`\nx\n\n\ny\n\`\`\`\n\n${szakasz('B', 5)}`],
      ['záró sortörés', `${szakasz('A', 5)}\n`],
    ])('összefűzve betűre az eredeti (%s)', (_, body) => {
      expect(splitForTranslation(body, 4).join('\n\n')).toBe(body)
    })

    it('nem ad szó nélküli darabot', () => {
      const chunks = splitForTranslation(`\n\n${szakasz('A', 6)}\n\n${szakasz('B', 6)}`, 4)
      expect(chunks.every((chunk) => chunk.trim() !== '')).toBe(true)
    })
  })
  ```
- [ ] **2. lépés:** `pnpm vitest run src/recipe/split.test.ts` → FAIL (nincs `split.ts`).
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. Mutációs próba: az `inFence ||` feltétel törlése → a kódkerítéses teszt bukik; a `last.words === 0 ||` törlése → a „szó nélküli darab” teszt bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(translate): Split long notes at headings for translation`, `Refs #259`).

### 2. feladat: a szójegyzék formátuma (tiszta függvények + a fájl renderelése)

**Fájlok:**
- Új: `src/recipe/glossary.ts`
- Módosul: `src/vault/render.ts` (`renderGlossaryNote`)
- Teszt: `src/recipe/glossary.test.ts`, `src/vault/render.test.ts`

**Interfész:**
- Ad: `GlossaryPair`, `GLOSSARY_SEPARATOR`, `glossaryOutputFile(target)`, `glossaryKind(target)`, `parseChunkReply`, `mergeGlossary`, `addedPairs`, `glossaryLines`, `glossaryTable`, `readGlossaryTable`, `appendGlossaryRows`, `renderGlossaryNote` (lent).

**Kód (`src/recipe/glossary.ts`):**
```ts
/** Egy szakkifejezés és a fordítása. Ha angolul marad, a kettő ugyanaz. */
export interface GlossaryPair {
  source: string
  target: string
}

/** A darab válaszában a fordítást és az új kifejezéspárokat elválasztó sor. Nem `---`: az Markdown vízszintes vonal. */
export const GLOSSARY_SEPARATOR = '<<<GLOSSARY>>>'

/** A szójegyzékfájl utótagja: videónként és célnyelvenként egy, receptfüggetlenül. */
export const glossaryOutputFile = (target: string): string => `_glossary-${target}.md`

/** A szójegyzékfájl jele a commitra várók között (és a vault-commit üzenetében). */
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

/** Egy darab válasza → fordítás és új párok; `null`, ha a válasz hibás (a darab újragenerálódik). */
export function parseChunkReply(reply: string): { translation: string; pairs: GlossaryPair[] } | null {
  const lines = reply.split('\n')
  const at = lines.flatMap((line, index) => (line.trim() === GLOSSARY_SEPARATOR ? [index] : []))
  if (at.length !== 1) return null
  const translation = lines.slice(0, at[0]).join('\n').trim()
  if (translation === '') return null
  const pairs: GlossaryPair[] = []
  for (const line of lines.slice(at[0]! + 1)) {
    if (line.trim() === '') continue
    const pair = parseRow(line)
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
```

**Kód (`src/vault/render.ts`, a `renderRecipeNote` után):**
```ts
/**
 * Egy videó egy célnyelvű szójegyzéke (#259), az első fordításkor. Nincs `generated_at`:
 * a fájl a későbbi fordításokkal bővül, a dátumot a vault pre-commit hookja bélyegzi.
 */
export function renderGlossaryNote(
  item: SourceItem,
  target: string,
  pairs: readonly GlossaryPair[],
  generatorVersion: string,
): string {
  const frontmatter = renderFrontmatter([
    ['item_id', item.itemId],
    ['title', item.title],
    ['language', target],
    ['source_language', item.language ?? undefined],
    ['video_id', item.metadata.videoId],
    ['generator', `transcript-refinery@${generatorVersion}`],
  ])
  return frontmatter + ['', `# ${item.title} — szójegyzék`, '', glossaryTable(pairs), ''].join('\n')
}
```
Import: `import { glossaryTable, type GlossaryPair } from '../recipe/glossary.js'`. A `glossary.ts` semmit nem importál, tehát nincs kör.

- [ ] **1. lépés: a bukó tesztek.**
  - `src/recipe/glossary.test.ts`, `const S = GLOSSARY_SEPARATOR`:
    - `parseChunkReply(\`## Cím\n\nSzöveg.\n${S}\nstream | adatfolyam\nAPI | API\n\`)` → `{ translation: '## Cím\n\nSzöveg.', pairs: [{ source: 'stream', target: 'adatfolyam' }, { source: 'API', target: 'API' }] }`;
    - `\`Szöveg.\n  ${S}  \n\`` → `{ translation: 'Szöveg.', pairs: [] }` (szóköz a sor körül, nincs új pár);
    - `\`a \\| b | c\`` sor → `{ source: 'a | b', target: 'c' }`; `| x | y |` alak is pár;
    - `it.each`, mind `null`: elválasztó nélkül (`'Szöveg.'`), két elválasztóval, üres fordítással (`\`\n${S}\na | b\``), `csak egy cella`, `a | b | c`, `a | ---`.
    - `mergeGlossary([{ source: 'Stream', target: 'adatfolyam' }], [{ source: 'stream', target: 'folyam' }, { source: 'API', target: 'API' }, { source: 'api', target: 'x' }])` → `[Stream/adatfolyam, API/API]`.
    - `addedPairs([{ source: 'Stream', target: 'a' }], [{ source: 'stream', target: 'a' }, { source: 'tool', target: 'eszköz' }])` → `[tool/eszköz]`.
    - `readGlossaryTable`: a bemenet `'# Cím\n\nKézi megjegyzés.\n\n| forrás | cél |\n|---|---|\n| stream | adatfolyam |\n| a | b | c |\n| tool | eszköz |\n\n\`\`\`\n| kód | nem |\n\`\`\`\n'` → `{ pairs: [stream/adatfolyam, tool/eszköz], skipped: 1 }`.
    - `appendGlossaryRows`: a bemenet `'előtte\n\n| forrás | cél |\n|---|---|\n| a | b |\n\nutána kézzel\n'` és `[{ source: 'c', target: 'd' }]` → `'előtte\n\n| forrás | cél |\n|---|---|\n| a | b |\n| c | d |\n\nutána kézzel\n'`. Tábla nélkül: `appendGlossaryRows('csak próza\n', [c/d])` → `'csak próza\n\n| forrás | cél |\n|---|---|\n| c | d |\n'`. Üres párlistánál a bemenet betűre (`toBe`).
  - `src/vault/render.test.ts`, új `describe('renderGlossaryNote')`:
    - `const md = renderGlossaryNote(item(), 'de', [{ source: 'a|b', target: 'c' }], '0.1.0')`: `lintVaultMarkdown(md)` → `[]`; tartalmazza a `\nlanguage: de\n`, `| forrás | cél |`, `| a\\|b | c |` sorokat; nincs benne `generated_at`;
    - oda-vissza: `readGlossaryTable(md).pairs` → `[{ source: 'a|b', target: 'c' }]`.
- [ ] **2. lépés:** `pnpm vitest run src/recipe/glossary.test.ts src/vault/render.test.ts` → FAIL.
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. Mutációs próba: a `block.slice(2)` helyett `block` → a `readGlossaryTable` teszt bukik (a fejléc pár lesz). A `(?<!\\)` törlése → az escape-elt teszt bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(translate): Add glossary reply parsing and the glossary file format`, `Refs #259`).

### 3. feladat: a küszöb a configban, és a darab promptja

**Fájlok:**
- Módosul: `src/recipe/types.ts` (`Translation.chunkWords`)
- Módosul: `src/recipe/translate.ts` (`translationOf` harmadik paraméter, `translationChunkPrompt`)
- Módosul: `src/config.ts` (`TranslateSchema.chunk_words`, `TranslateConfig.chunkWords`)
- Módosul: `src/recipe/registry.ts:82`, `src/serve/summary.ts:124`
- Módosul: `refinery.config.example.yaml`
- Teszt: `src/recipe/translate.test.ts`, `src/config.test.ts`, `src/recipe/registry.test.ts`

**Interfész:**
- Felhasznál: `DEFAULT_CHUNK_WORDS` (1. feladat), `GLOSSARY_SEPARATOR`, `glossaryLines`, `GlossaryPair` (2. feladat).
- Ad: `Translation { source; target; chunkWords: number }`, `translationOf(source, target, chunkWords = DEFAULT_CHUNK_WORDS)`, `translationChunkPrompt(input: ChunkPromptInput): string`.

**`src/recipe/types.ts`, a `Translation` interfész:**
```ts
/** Egy fordítórecept forrása, célnyelve és darabolási küszöbe. */
export interface Translation {
  source: Recipe
  target: LanguageTag
  /** E fölött (szóban) a forrásjegyzet darabokban fordul (`translate.chunk_words`, #259). */
  chunkWords: number
}
```

**`src/recipe/translate.ts`:**
- `translationOf(source: Recipe, target: LanguageTag, chunkWords = DEFAULT_CHUNK_WORDS): Recipe`, és `translation: { source, target, chunkWords }`. A `prompt`/`repairPrompt` nem változik. A doc-komment kiegészül: „A futás (`translateChunked`) nem a `prompt`-ot hívja, hanem a `translationChunkPrompt`-ot; a `prompt` az egyhívásos mérésé (`evals/`).”
- Új, a `translationOf` előtt:
```ts
export interface ChunkPromptInput {
  title: string
  /** A darab szövege, darabolatlan fordításnál a teljes törzs. */
  chunk: string
  /** A szójegyzék eddigi állása. */
  glossary: readonly GlossaryPair[]
  target: LanguageTag
  /** Darabolt fordításnál hányadik darab, hányból; egy darabnál hiányzik. */
  part?: { index: number; total: number }
}

/**
 * Egy darab fordítása a szójegyzékkel (#259). A válasz a fordítás, egy
 * `GLOSSARY_SEPARATOR` sor, majd a darab új kifejezéspárjai (`parseChunkReply`).
 */
export function translationChunkPrompt(input: ChunkPromptInput): string {
  const name = LANGUAGE_NAMES[input.target]
  return [
    `Translate the note below into ${name}.`,
    ...(input.part === undefined
      ? []
      : [
          `This is part ${input.part.index} of ${input.part.total} of a longer note. Translate only this part;`,
          'do not add a heading, an introduction or a summary of your own.',
        ]),
    '',
    'Rules:',
    rules(input.target),
    '- The GLOSSARY below lists terms already decided for this note. Translate every',
    '  listed term exactly as listed there (`source | translation`).',
    '',
    'After the translation, write a line that contains only',
    GLOSSARY_SEPARATOR,
    'and below it every technical term that occurs in this text and is not yet in the',
    `GLOSSARY, one per line, as \`source term | ${name} term\`. List the terms you kept in`,
    'English too (`term | term`). If there is no new term, write nothing below that line.',
    '',
    `Title: ${input.title}`,
    '',
    '--- GLOSSARY ---',
    input.glossary.length === 0 ? '(empty)' : glossaryLines(input.glossary),
    '',
    '--- NOTE ---',
    input.chunk,
  ].join('\n')
}
```

**`src/config.ts`:**
- Import: `import { DEFAULT_CHUNK_WORDS } from './recipe/split.js'`. Előtte ellenőrizd, hogy a `split.ts` és a `normalize/dedupe.ts` nem importál a `config.ts`-ből (ma nem), különben kör lesz.
- `TranslateSchema`, a `recipes` után:
  ```ts
  chunk_words: z
    .number()
    .int('A translate.chunk_words egész szám.')
    .positive('A translate.chunk_words pozitív kell legyen.')
    .default(DEFAULT_CHUNK_WORDS),
  ```
- `TranslateConfig`: `/** E fölött (szóban) darabolva fordít (#259). */ chunkWords: number`
- `loadConfig` (`:204`): `translate: c.translate ? { to: c.translate.to, recipes: c.translate.recipes, chunkWords: c.translate.chunk_words } : null,`

**`src/recipe/registry.ts:82`:** `translationOf(source, cfg.translate.to, cfg.translate.chunkWords)`.

**`src/serve/summary.ts:124`:** a kérés célnyelve a configé helyett jön, a küszöb a configé marad:
```ts
    ...(lang === undefined
      ? {}
      : {
          translate: {
            to: lang,
            recipes: [...input.recipes],
            chunkWords: loaded.cfg.translate?.chunkWords ?? DEFAULT_CHUNK_WORDS,
          },
        }),
```

**`refinery.config.example.yaml`, a `translate` példa (`:56–58`):**
```yaml
# translate:
#   to: hu
#   recipes: [clean-moderate, summary, notes]
#   # E fölött (szóban) a forrásjegyzet darabokban, sorban fordul, a darabok közös
#   # szójegyzékkel (<alapnév>_glossary-<cél>.md a jegyzetek mellett). Elhagyható.
#   chunk_words: 4000
```

- [ ] **1. lépés: a bukó tesztek.**
  - `src/recipe/translate.test.ts`, új `describe('translationChunkPrompt')` (`ITEM`, `FORRAS` a meglévők):
    - `translationChunkPrompt({ title: 'T', chunk: FORRAS, glossary: [{ source: 'stream', target: 'adatfolyam' }], target: 'hu', part: { index: 2, total: 3 } })` tartalmazza: `'part 2 of 3'`, `GLOSSARY_SEPARATOR`, `'stream | adatfolyam'`, `'Treat each such term the same way throughout.'`, és a `FORRAS`-t a `'--- NOTE ---'` után;
    - `part` nélkül nincs benne `'part '`; üres szójegyzéknél a `'--- GLOSSARY ---\n(empty)'` szerepel.
    - `translationOf(cleanRecipeFor('moderate'), 'hu').translation!.chunkWords` → `4000`; `translationOf(…, 'hu', 1500)…chunkWords` → `1500`.
    - A meglévő `prompt` tesztek változatlanul zöldek (a `prompt` nem változott).
  - `src/config.test.ts`: a `:121` elvárása `{ to: 'hu', recipes: ['clean-moderate', 'summary'], chunkWords: 4000 }`; `chunk_words: 1500` → `1500`; `chunk_words: 0` és `1.5` → hiba, `/translate\.chunk_words/`.
  - `src/recipe/registry.test.ts:10`: a segéd `{ to: 'hu' as const, recipes, chunkWords: 1500 }`-at ad; új eset: a `recipesFor` fordítórecepetjének `translation!.chunkWords` → `1500`.
- [ ] **2. lépés:** `pnpm vitest run src/recipe src/config.test.ts` → FAIL.
- [ ] **3. lépés:** a fenti kód. A `pnpm typecheck` megtalálja a `TranslateConfig` többi építőjét is (a tesztekben `{ to, recipes }` literál); mindegyik `chunkWords: 4000`-et kap.
- [ ] **4. lépés:** PASS. Mutációs próba: a registry-ben a harmadik argumentum törlése → a `1500`-as registry-teszt bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(translate): Add translate.chunk_words and the chunk prompt`, `Refs #259`).

### 4. feladat: a kész darabok az állapottárban

**Fájlok:**
- Módosul: `src/state/db.ts` (séma, `TranslationChunk`, négy metódus)
- Teszt: `src/state/db.test.ts`

**Interfész:**
- Felhasznál: `GlossaryPair` (2. feladat), `ModelUsage` (`src/model/client.ts`), csak típusként.
- Ad:
  ```ts
  export interface TranslationChunk {
    index: number
    sourceHash: string
    output: string
    /** A szójegyzék teljes állása e darab után; a folytatás ebből indul. */
    glossaryAfter: GlossaryPair[]
    usage: ModelUsage
  }
  // StateStore:
  translationChunks(itemId: string, kind: string): TranslationChunk[]
  saveTranslationChunk(itemId: string, kind: string, chunk: TranslationChunk): void
  clearTranslationChunks(itemId: string, kind: string): void
  markPendingCommit(itemId: string, kind: string, path: string): void
  ```

**Séma (`SCHEMA`, a `pending_commits` után):**
```sql
-- A darabolt fordítás kész darabjai (#259), darabonként egy sor. Egy bukott vagy
-- megszakadt fordítás a következő futásban az első hiányzó darabtól folytatódik.
-- A source_hash a forrás, a küszöb, a célnyelv és a draft modell lenyomata;
-- eltérésnél az elem összes darabja törlődik. Siker után a sorok törlődnek.
-- A glossary_after JSON: [{"source": …, "target": …}]. Új tábla, nem migráció.
CREATE TABLE IF NOT EXISTS translation_chunks (
  item_id        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,
  source_hash    TEXT NOT NULL,
  output         TEXT NOT NULL,
  glossary_after TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (item_id, kind, chunk_index)
);
```

**Metódusok (az `openState` visszaadott objektumában, a `clearPendingCommits` után):**
```ts
    markPendingCommit(itemId, kind, path) {
      db.prepare(
        `INSERT INTO pending_commits (item_id, kind, path) VALUES (?, ?, ?)
         ON CONFLICT(item_id, kind) DO UPDATE SET path = excluded.path`,
      ).run(itemId, kind, toStored(vaultPath, path))
    },

    translationChunks(itemId, kind) {
      return (
        db
          .prepare(
            `SELECT chunk_index, source_hash, output, glossary_after, input_tokens, output_tokens
             FROM translation_chunks WHERE item_id = ? AND kind = ? ORDER BY chunk_index`,
          )
          .all(itemId, kind) as {
          chunk_index: number
          source_hash: string
          output: string
          glossary_after: string
          input_tokens: number
          output_tokens: number
        }[]
      ).map((row) => ({
        index: row.chunk_index,
        sourceHash: row.source_hash,
        output: row.output,
        glossaryAfter: JSON.parse(row.glossary_after) as GlossaryPair[],
        usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
      }))
    },

    saveTranslationChunk(itemId, kind, chunk) {
      db.prepare(
        `INSERT INTO translation_chunks
           (item_id, kind, chunk_index, source_hash, output, glossary_after, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id, kind, chunk_index) DO UPDATE SET
           source_hash = excluded.source_hash,
           output = excluded.output,
           glossary_after = excluded.glossary_after,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           created_at = excluded.created_at`,
      ).run(
        itemId,
        kind,
        chunk.index,
        chunk.sourceHash,
        chunk.output,
        JSON.stringify(chunk.glossaryAfter),
        chunk.usage.inputTokens,
        chunk.usage.outputTokens,
        now(),
      )
    },

    clearTranslationChunks(itemId, kind) {
      db.prepare('DELETE FROM translation_chunks WHERE item_id = ? AND kind = ?').run(itemId, kind)
    },
```
A `StateStore` interfészben a metódusok doc-kommentje a fenti `Interfész` blokk szerint; a `markPendingCommit`-é: „Egy nem műtermék fájl (a szójegyzék) a commitra várók közé; `artifacts`-sor nem készül hozzá.”

- [ ] **1. lépés: a bukó tesztek (`src/state/db.test.ts`, új `describe('StateStore — fordítási darabok')`).**
  - `const chunk = (index: number): TranslationChunk => ({ index, sourceHash: 'h', output: \`d${index}\`, glossaryAfter: [{ source: 'a|b', target: \`c${index}\` }], usage: { inputTokens: 10 * index, outputTokens: index } })`.
  - A `saveTranslationChunk('i1', 'proba-hu', chunk(1))`, majd `chunk(0)` után a `translationChunks('i1', 'proba-hu')` → `[chunk(0), chunk(1)]` (index szerint rendezve, a JSON oda-vissza, a `|` megmarad).
  - Ugyanaz az index másodszor, más `output`-tal → felülírja, a hossz marad 2.
  - A `clearTranslationChunks('i1', 'proba-hu')` után üres; a `('i1', 'proba-de')` és az `('i2', 'proba-hu')` sorai maradnak.
  - `markPendingCommit('i1', 'glossary-hu', '/v/a/B_glossary-hu.md')` (az `openState(path, '/v')`-vel) → a `listPendingCommits()` tartalmazza az utat; a `listPendingNotes()` sorának `kind`-ja `'glossary-hu'`; az `artifactOf('i1', 'glossary-hu')` → `null`.
  - Egy korábbi állapotfájl (tábla nélkül) újranyitása: `openState` kétszer ugyanarra az útra, a második után a `translationChunks` üres listát ad (a `CREATE TABLE IF NOT EXISTS` idempotens).
- [ ] **2. lépés:** `pnpm vitest run src/state/db.test.ts` → FAIL.
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. Mutációs próba: az `ORDER BY chunk_index` törlése → a rendezési teszt bukik (a `chunk(1)` került be előbb). Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(state): Store finished translation chunks`, `Refs #259`).

### 5. feladat: a darabolt fordítás futtatója

**Fájlok:**
- Új: `src/recipe/translate-chunks.ts`
- Teszt: `src/recipe/translate-chunks.test.ts`

**Interfész:**
- Felhasznál: `splitForTranslation` (1.), `parseChunkReply`, `mergeGlossary`, `GlossaryPair` (2.), `translationChunkPrompt`, `Translation` (3.), `StateStore.translationChunks/saveTranslationChunk/clearTranslationChunks` (4.), `scoreRubric` (`src/rubric/types.ts`), `RefineResult`, `RoundTrace` (`src/refine/loop.ts`).
- Ad: `ChunkedDeps`, `ChunkedResult`, `chunkSourceHash`, `translateChunked` (lent). A 6. feladat ezeket hívja.

**Kód (`src/recipe/translate-chunks.ts`):**
```ts
import { createHash } from 'node:crypto'
import type { ModelConfig } from '../config.js'
import type { CostGuard } from '../model/budget.js'
import type { ModelClient, ModelUsage } from '../model/client.js'
import type { RefineResult, RoundTrace } from '../refine/loop.js'
import { scoreRubric } from '../rubric/types.js'
import type { StateStore } from '../state/db.js'
import { mergeGlossary, parseChunkReply, type GlossaryPair } from './glossary.js'
import { splitForTranslation } from './split.js'
import { translationChunkPrompt } from './translate.js'
import type { Recipe, RecipeInput, Translation } from './types.js'

/** Egy darab legfeljebb ennyiszer generálódik, ha a válasza nem értelmezhető: egyszer, és kétszer újra (spec). */
const CHUNK_ATTEMPTS = 3

const ZERO: ModelUsage = { inputTokens: 0, outputTokens: 0 }
const plus = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

export interface ChunkedDeps {
  /** A már újrapróbáló (`retrying`) kliens. */
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
  store: StateStore
  /** Hamis (`dryRun`) esetén a tábla érintetlen. */
  persist: boolean
  /** Igaz (`--force`) esetén a tárolt darabok törlődnek, minden darab újra fut. */
  force: boolean
  skipJudge?: boolean
  /** A recept órája egy hívásláncra: darabonként és a pontozásra külön indul. */
  clock: <T>(fn: () => Promise<T>) => Promise<T>
  onGenerate: (generation: number) => void
  onScore: (score: number, gaps: number) => void
}

export interface ChunkedResult extends RefineResult {
  /** A szójegyzék teljes állása a futás végén (a kezdeti párokkal együtt). */
  glossary: GlossaryPair[]
  /** A korábbi futásban kész darabok felhasználása: a `costUsd`-be számít, a költségőrbe nem. */
  resumedUsage: ModelUsage
  /** Igaz, ha egynél több darab volt; csak ekkor van mit törölni a táblából. */
  chunked: boolean
}

/** A tárolt darabok érvényessége. A prompt szövege nincs benne (spec): promptcsere után `--force`. */
export function chunkSourceHash(body: string, chunkWords: number, target: string, model: string): string {
  return createHash('sha256').update(JSON.stringify([body, chunkWords, target, model])).digest('hex')
}

async function generateChunk(
  recipe: Recipe,
  prompt: string,
  deps: ChunkedDeps,
  label: string,
): Promise<{ translation: string; pairs: GlossaryPair[]; usage: ModelUsage }> {
  let usage = ZERO
  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
    const reply = await deps.client.generate(recipe.role, prompt)
    // Hívásonként könyvelünk: a bukó darab előtti hívások is a futás költésébe számítanak.
    deps.guard.add(recipe.role, reply.usage, deps.modelConfig)
    usage = plus(usage, reply.usage)
    const parsed = parseChunkReply(reply.value)
    if (parsed !== null) return { ...parsed, usage }
  }
  throw new Error(
    `a(z) ${label}. darab válasza ${CHUNK_ATTEMPTS} generálás után sem értelmezhető (hiányzó vagy többszörös elválasztó, hibás szójegyzéksor vagy üres fordítás)`,
  )
}

/**
 * Egy fordítás darabokban, sorban (#259). Minden darab az addigi szójegyzéket
 * kapja, és a kész darab a táblába kerül; a folytatás az első hiányzó darabbal
 * indul. A pontozás egyszer, az összefűzött szövegen fut, a teljes forráshoz mérve.
 * Egy darabnál (rövid jegyzet) a tábla érintetlen, a szójegyzék ugyanúgy bemenet és kimenet.
 */
export async function translateChunked(
  recipe: Recipe,
  translation: Translation,
  input: RecipeInput,
  initialGlossary: readonly GlossaryPair[],
  deps: ChunkedDeps,
): Promise<ChunkedResult> {
  const { item } = input
  const chunks = splitForTranslation(input.transcript, translation.chunkWords)
  const chunked = chunks.length > 1
  const useTable = chunked && deps.persist
  const hash = chunkSourceHash(
    input.transcript,
    translation.chunkWords,
    translation.target,
    deps.modelConfig.models[recipe.role],
  )

  let stored = useTable ? deps.store.translationChunks(item.itemId, recipe.id) : []
  // Más lenyomatnál a darabhatárok is mások lehetnek: minden darab elölről.
  if (useTable && (deps.force || stored.some((chunk) => chunk.sourceHash !== hash))) {
    deps.store.clearTranslationChunks(item.itemId, recipe.id)
    stored = []
  }

  const outputs = stored.map((chunk) => chunk.output)
  let glossary = stored.at(-1)?.glossaryAfter ?? [...initialGlossary]
  const resumedUsage = stored.reduce((sum, chunk) => plus(sum, chunk.usage), ZERO)
  const rounds: RoundTrace[] = []

  for (let index = outputs.length; index < chunks.length; index++) {
    deps.onGenerate(index + 1)
    const prompt = translationChunkPrompt({
      title: item.title,
      chunk: chunks[index]!,
      glossary,
      target: translation.target,
      part: chunked ? { index: index + 1, total: chunks.length } : undefined,
    })
    const done = await deps.clock(() => generateChunk(recipe, prompt, deps, `${index + 1}/${chunks.length}`))
    glossary = mergeGlossary(glossary, done.pairs)
    outputs.push(done.translation)
    rounds.push({ score: 0, gaps: 0, generateUsage: done.usage, scoreUsage: ZERO })
    if (useTable) {
      deps.store.saveTranslationChunk(item.itemId, recipe.id, {
        index,
        sourceHash: hash,
        output: done.translation,
        glossaryAfter: glossary,
        usage: done.usage,
      })
    }
  }

  const output = outputs.join('\n\n')
  const scored = await deps.clock(() =>
    scoreRubric(recipe.rubric, { transcript: input.transcript, output }, deps.client, {
      skipJudge: deps.skipJudge,
    }),
  )
  deps.guard.add('judge', scored.usage, deps.modelConfig)
  deps.onScore(scored.value, scored.gaps.length)

  // Minden darab-kör a végső pontszámot viszi; a pontozás felhasználása és hiányszáma az utolsóé.
  // Ha minden darab a korábbi futásból jött, a pontozás egy saját kört kap.
  if (rounds.length === 0) rounds.push({ score: 0, gaps: 0, generateUsage: ZERO, scoreUsage: ZERO })
  for (const round of rounds) round.score = scored.value
  const last = rounds.at(-1)!
  last.gaps = scored.gaps.length
  last.scoreUsage = scored.usage

  const usage = rounds.reduce((sum, round) => plus(plus(sum, round.generateUsage), round.scoreUsage), ZERO)
  return { output, score: scored.value, gaps: scored.gaps, generations: 1, usage, rounds, glossary, resumedUsage, chunked }
}
```

- [ ] **1. lépés: a bukó tesztek (`src/recipe/translate-chunks.test.ts`).**
  ```ts
  import { mkdtemp } from 'node:fs/promises'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import { afterEach, beforeEach, describe, expect, it } from 'vitest'
  import { createCostGuard } from '../model/budget.js'
  import type { ModelClient } from '../model/client.js'
  import { openState, type StateStore } from '../state/db.js'
  import { GLOSSARY_SEPARATOR as S } from './glossary.js'
  import { translationOf } from './translate.js'
  import { translateChunked, type ChunkedDeps } from './translate-chunks.js'
  import type { Recipe, RecipeInput } from './types.js'

  const MODELL_CFG = {
    baseUrl: 'http://localhost:4000/v1',
    apiKey: 'sk-proba',
    models: { draft: 'draft-modell', judge: 'judge-modell' },
    recipeModels: {},
    judgeEnabled: true,
    pricing: {
      draft: { inputPerMillion: 3, outputPerMillion: 15 },
      judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
    },
    modelPricing: {},
    costLimitUsd: 5,
  }

  const PROBA: Recipe = {
    id: 'proba',
    outputFile: '_proba.md',
    publishable: true,
    role: 'draft',
    maxIterations: 0,
    prompt: () => 'generálj',
    repairPrompt: () => 'javíts',
    rubric: { criteria: [], passThreshold: 0.8 },
  }

  /** Fordítórecept kis küszöbbel; a rubrika mindig átengedi (a kapukat a pipeline-teszt nézi). */
  const fordito = (chunkWords: number): Recipe => ({
    ...translationOf(PROBA, 'hu', chunkWords),
    rubric: {
      criteria: [{ name: 'mindig-jo', score: () => Promise.resolve({ value: 1, gaps: [] }) }],
      passThreshold: 0.8,
    },
  })

  // 23 szó: [fejléc + 1. bekezdés = 13], [2. bekezdés = 10] → 10-es küszöbnél két darab.
  const FORRAS = [
    '## Overview',
    '',
    'The speaker explains why a problem should come before a tool.',
    '',
    'The second paragraph adds an example from his first company.',
  ].join('\n')

  const ELSO = `## Áttekintés\n\nElső darab.\n${S}\nproblem | probléma`
  const MASODIK = `Második darab.\n${S}\ntool | eszköz`
  const HIBAS = 'elválasztó nélkül'

  function sorKliens(replies: string[]): ModelClient & { prompts: string[] } {
    const prompts: string[] = []
    return {
      prompts,
      generate: (_role, prompt) => {
        prompts.push(prompt)
        const value = replies.shift()
        if (value === undefined) return Promise.reject(new Error('nincs több válasz'))
        return Promise.resolve({ value, usage: { inputTokens: 100, outputTokens: 20 } })
      },
      generateObject: () => Promise.reject(new Error('nem hívjuk')),
    }
  }

  let store: StateStore
  beforeEach(async () => {
    store = openState(join(await mkdtemp(join(tmpdir(), 'refinery-chunks-')), 'state.db'))
  })
  afterEach(() => store.close())

  const input = (transcript = FORRAS): RecipeInput => ({
    item: { itemId: 'a1', source: 'youtube', sourceFile: 'x', subtitlePath: 'x', baseName: 'B', title: 'Cím', language: 'en', metadata: {} },
    transcript,
    timed: [],
  })

  function deps(client: ModelClient, over: Partial<ChunkedDeps> = {}): ChunkedDeps {
    return {
      client,
      modelConfig: MODELL_CFG,
      guard: createCostGuard(5),
      store,
      persist: true,
      force: false,
      skipJudge: true,
      clock: (fn) => fn(),
      onGenerate: () => {},
      onScore: () => {},
      ...over,
    }
  }

  const run = (recipe: Recipe, client: ModelClient, over: Partial<ChunkedDeps> = {}, glossary = []) =>
    translateChunked(recipe, recipe.translation!, input(), glossary, deps(client, over))

  describe('translateChunked', () => {
    it('a darabok sorban futnak, a második megkapja az első szójegyzékét', async () => {
      const client = sorKliens([ELSO, MASODIK])
      const result = await run(fordito(10), client)

      expect(result.output).toBe('## Áttekintés\n\nElső darab.\n\nMásodik darab.')
      expect(client.prompts[0]).toContain('part 1 of 2')
      expect(client.prompts[1]).toContain('problem | probléma')
      expect(result.glossary).toEqual([
        { source: 'problem', target: 'probléma' },
        { source: 'tool', target: 'eszköz' },
      ])
      expect(result.rounds).toHaveLength(2)
      expect(result.generations).toBe(1)
      expect(result.chunked).toBe(true)
      expect(store.translationChunks('a1', 'proba-hu')).toHaveLength(2)
    })

    it('hibás választ legfeljebb kétszer újrakér; a sikeres darab felhasználása az összes kísérleté', async () => {
      const result = await run(fordito(10), sorKliens([ELSO, HIBAS, MASODIK]))
      expect(result.rounds[1]!.generateUsage).toEqual({ inputTokens: 200, outputTokens: 40 })
    })

    it('három hibás válasz után bukik, a kész darab a táblában marad, minden hívás könyvelve', async () => {
      const guard = createCostGuard(5)
      await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]), { guard })).rejects.toThrow(
        /2\/2\. darab válasza 3 generálás után sem értelmezhető/,
      )
      expect(store.translationChunks('a1', 'proba-hu').map((chunk) => chunk.index)).toEqual([0])
      // 4 hívás × (100 × 3 + 20 × 15) / 1e6
      expect(guard.spentUsd()).toBeCloseTo(0.0024, 10)
    })

    it('folytatáskor a kész darabot nem fordítja újra, és az utolsó szójegyzékből indul', async () => {
      await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]))).rejects.toThrow()
      const client = sorKliens([MASODIK])
      const result = await run(fordito(10), client)

      expect(client.prompts).toHaveLength(1)
      expect(client.prompts[0]).toContain('problem | probléma')
      expect(result.output).toBe('## Áttekintés\n\nElső darab.\n\nMásodik darab.')
      expect(result.resumedUsage).toEqual({ inputTokens: 100, outputTokens: 20 })
      expect(result.rounds).toHaveLength(1)
    })

    it('eltérő lenyomatnál (más draft modell) elölről kezd', async () => {
      await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]))).rejects.toThrow()
      const client = sorKliens([ELSO, MASODIK])
      const masik = { ...MODELL_CFG, models: { ...MODELL_CFG.models, draft: 'masik-modell' } }
      await run(fordito(10), client, { modelConfig: masik })
      expect(client.prompts).toHaveLength(2)
    })

    it('force mellett a tárolt darabokat törli, és mindent újragenerál', async () => {
      await expect(run(fordito(10), sorKliens([ELSO, HIBAS, HIBAS, HIBAS]))).rejects.toThrow()
      const client = sorKliens([ELSO, MASODIK])
      await run(fordito(10), client, { force: true })
      expect(client.prompts).toHaveLength(2)
    })

    it('egy darabnál a táblához nem nyúl, de a szójegyzéket olvassa és bővíti', async () => {
      const client = sorKliens([`Fordítás.\n${S}\ntool | eszköz`])
      const result = await translateChunked(fordito(4000), fordito(4000).translation!, input(), [{ source: 'x', target: 'y' }], deps(client))

      expect(client.prompts[0]).toContain('x | y')
      expect(client.prompts[0]).not.toContain('part ')
      expect(result.glossary).toEqual([{ source: 'x', target: 'y' }, { source: 'tool', target: 'eszköz' }])
      expect(result.chunked).toBe(false)
      expect(store.translationChunks('a1', 'proba-hu')).toEqual([])
    })

    it('persist nélkül (dryRun) nem ír a táblába', async () => {
      await run(fordito(10), sorKliens([ELSO, MASODIK]), { persist: false })
      expect(store.translationChunks('a1', 'proba-hu')).toEqual([])
    })

    it('darabonként saját óra, a pontozásnak külön; a pontozás az összefűzött szövegen', async () => {
      let clocks = 0
      const scored: string[] = []
      const recipe: Recipe = {
        ...fordito(10),
        rubric: {
          criteria: [{ name: 'figyelo', score: (ctx) => (scored.push(ctx.output), Promise.resolve({ value: 0.7, gaps: ['x'] })) }],
          passThreshold: 0.8,
        },
      }
      const result = await run(recipe, sorKliens([ELSO, MASODIK]), {
        clock: (fn) => (clocks++, fn()),
      })
      expect(clocks).toBe(3)
      expect(scored).toEqual(['## Áttekintés\n\nElső darab.\n\nMásodik darab.'])
      expect(result.rounds.map((round) => [round.score, round.gaps])).toEqual([[0.7, 0], [0.7, 1]])
    })
  })
  ```
  A `Criterion.score(ctx: ScoreContext, client)` szignatúra és a `ctx.output` mező a `src/rubric/types.ts:15–33` szerint való. A `MODELL_CFG` szándékosan annotálatlan, mint a `src/pipeline.test.ts:253`-ban.
- [ ] **2. lépés:** `pnpm vitest run src/recipe/translate-chunks.test.ts` → FAIL (nincs `translate-chunks.ts`).
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. Mutációs próbák: a `stored.some(…)` feltétel törlése → a „más draft modell” teszt bukik; a `glossary = mergeGlossary(…)` sor törlése → az első teszt bukik (a második prompt nem kapja a párt); a `CHUNK_ATTEMPTS` 1-re állítása → az újrakérés tesztje bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(translate): Translate long notes chunk by chunk with a shared glossary`, `Refs #259`).

### 6. feladat: bekötés a pipeline-ba, a szójegyzékfájl és az esemény

**Fájlok:**
- Módosul: `src/pipeline.ts` (`recipeClock`, a `runRecipe` fordítási ága, könyvelés, a szójegyzékfájl)
- Módosul: `src/events.ts` (`item:glossary-skipped`), `src/cli.ts` (`render`, `:176` mellé)
- Teszt: `src/pipeline.test.ts`

**Interfész:**
- Felhasznál: `translateChunked`, `ChunkedResult` (5.), `glossaryOutputFile`, `glossaryKind`, `readGlossaryTable`, `appendGlossaryRows`, `addedPairs`, `GlossaryPair` (2.), `renderGlossaryNote` (2.), `StateStore.markPendingCommit/clearTranslationChunks` (4.), `writeFileAtomic` (`src/vault/atomic.ts`).

**`src/pipeline.ts`, új segéd a `placement` után** (a `runRecipe` `:258–292` órája költözik ide, változatlan viselkedéssel):
```ts
/**
 * A recept órája egy hívásláncra: a korlát után a hívás megszakad (a `RecipeTimeout`
 * véglegesnek számít, tehát nincs újrapróba), az életjel addig jelez, amíg a lánc
 * fut. A `refine` egy órát kap; a darabolt fordítás darabonként és a pontozásra
 * külön egyet (#259), mert a 25 perc a teljes recepté volt.
 */
function recipeClock(
  item: SourceItem,
  recipe: Recipe,
  deps: PipelineDeps,
  modelConfig: ModelConfig,
): <T>(fn: () => Promise<T>) => Promise<T> {
  const timeoutMinutes = modelConfig.recipeTimeoutMinutes ?? DEFAULT_RECIPE_TIMEOUT_MINUTES
  const heartbeatMinutes = modelConfig.heartbeatMinutes ?? DEFAULT_HEARTBEAT_MINUTES
  return async (fn) => {
    const controller = new AbortController()
    const scope: CallScope = { signal: controller.signal, text: '' }
    const stop = setTimeout(
      () => controller.abort(new RecipeTimeout(recipe.id, timeoutMinutes)),
      timeoutMinutes * 60_000,
    )
    const beat = setInterval(
      () =>
        deps.sink({ type: 'item:progress', itemId: item.itemId, recipe: recipe.id, words: countWords(scope.text) }),
      heartbeatMinutes * 60_000,
    )
    try {
      return await inScope(scope, fn)
    } finally {
      clearTimeout(stop)
      clearInterval(beat)
    }
  }
}
```

**`runRecipe`, a `:253–292` blokk helyére** (a `dryRun`-ra figyelmeztető komment marad):
```ts
  const clock = recipeClock(item, recipe, deps, modelConfig)
  // Az élő követés ezekből látja, hol tart a loop: enélkül a modellhívások
  // alatt — a futásidő nagyobb részében — nem jönne esemény.
  const onGenerate = (generation: number) =>
    deps.sink({ type: 'item:generating', itemId: item.itemId, recipe: recipe.id, generation })
  const onScore = (score: number, gaps: number) =>
    deps.sink({ type: 'item:scored', itemId: item.itemId, recipe: recipe.id, score, gaps })

  let result: RefineResult
  // Fordításnál a futtató darabol (#259), és a videó célnyelvű szójegyzékéből indul.
  let translated: { run: ChunkedResult; glossaryPath: string; existing: string | null; known: GlossaryPair[] } | null =
    null
  if (recipe.translation) {
    const glossaryPath = noteFile(
      deps.notesRoot,
      item,
      glossaryOutputFile(recipe.translation.target),
      placement(deps, item),
    )
    const existing = (await exists(glossaryPath)) ? await readFile(glossaryPath, 'utf8') : null
    const table = existing === null ? { pairs: [], skipped: 0 } : readGlossaryTable(existing)
    if (table.skipped > 0) {
      deps.sink({ type: 'item:glossary-skipped', itemId: item.itemId, recipe: recipe.id, rows: table.skipped })
    }
    const run = await translateChunked(recipe, recipe.translation, input, table.pairs, {
      client,
      modelConfig,
      guard,
      store: deps.store,
      persist: !deps.options.dryRun,
      force: deps.options.force === true,
      skipJudge: recipeDeps.skipJudge,
      clock,
      onGenerate,
      onScore,
    })
    translated = { run, glossaryPath, existing, known: table.pairs }
    result = run
  } else {
    result = await clock(() => refine(recipe, input, client, { onGenerate, onScore, skipJudge: recipeDeps.skipJudge }))
  }
```

**A könyvelés (`:294–304`):**
```ts
  // Körönként és szerepenként könyvelünk: a generálás a recept szerepén, a
  // pontozás a bíróén. Az összevont `result.usage` a bíró tokenjeit is a
  // vázlatmodell árán számolná — a mérő script ezt épp elkerüli. A darabolt
  // fordítás hívásonként maga könyvel (#259); itt csak a költséget összegezzük,
  // a korábbi futásban kész darabokéval együtt (a jegyzet teljes költsége).
  let usd = translated === null ? 0 : costOf(translated.run.resumedUsage, modelConfig.pricing[recipe.role])
  for (const round of result.rounds) {
    if (translated === null) {
      guard.add(recipe.role, round.generateUsage, modelConfig)
      guard.add('judge', round.scoreUsage, modelConfig)
    }
    usd +=
      costOf(round.generateUsage, modelConfig.pricing[recipe.role]) +
      costOf(round.scoreUsage, modelConfig.pricing.judge)
  }
```

**A jegyzet lintje után (`:368–371` után):**
```ts
  // A szójegyzék a fordítással együtt íródik: új fájl, vagy a meglévő táblájának
  // bővítése; a fájl többi része (kézzel írt szöveg) betűre marad.
  const glossary =
    translated === null || !recipe.translation
      ? null
      : translated.existing === null
        ? renderGlossaryNote(item, recipe.translation.target, translated.run.glossary, deps.version)
        : appendGlossaryRows(translated.existing, addedPairs(translated.known, translated.run.glossary))
  const glossaryErrors = glossary === null ? [] : lintVaultMarkdown(glossary)
  if (glossaryErrors.length > 0) {
    throw new Error(`a szójegyzék megsérti a vault írási szabályait: ${glossaryErrors.join('; ')}`)
  }
```

**A `publishNote` után (`:374` után), a `recordArtifact` elé:**
```ts
  if (translated !== null && glossary !== null && recipe.translation && published.status === 'written' && !deps.options.dryRun) {
    if (glossary !== translated.existing) {
      await writeFileAtomic(translated.glossaryPath, glossary)
      if (deps.commit) {
        deps.store.markPendingCommit(item.itemId, glossaryKind(recipe.translation.target), translated.glossaryPath)
      }
    }
    // Siker: a fordítás és a szójegyzék kint van, a darabokra nincs többé szükség.
    if (translated.run.chunked) deps.store.clearTranslationChunks(item.itemId, recipe.id)
  }
```

**Importok:** `RefineResult` típus a `./refine/loop.js`-ből; `translateChunked`, `type ChunkedResult` a `./recipe/translate-chunks.js`-ből; `addedPairs`, `appendGlossaryRows`, `glossaryKind`, `glossaryOutputFile`, `readGlossaryTable`, `type GlossaryPair` a `./recipe/glossary.js`-ből; `renderGlossaryNote` a `./vault/render.js`-ből; `writeFileAtomic` a `./vault/atomic.js`-ből; `type Recipe` a `./recipe/types.js`-ből (már importált).

**`src/events.ts`, az `item:anchor-skipped` után:**
```ts
  | {
      type: 'item:glossary-skipped'
      itemId: string
      recipe: string
      /** Hány szójegyzéksor maradt ki, mert a `|` miatt nem bontható két cellára. */
      rows: number
    }
```
**`src/cli.ts` `render`, az `item:anchor-skipped` ág után:**
```ts
    case 'item:glossary-skipped':
      return `  ! ${event.itemId}: ${String(event.rows)} szójegyzéksor kimaradt (${event.recipe}): a | miatt nem bontható két cellára`
```
Ha a `pnpm typecheck` egy másik, kimerítő `RunEvent`-switch-et jelez (`never`), ott is egy ág kell, ugyanezzel a szöveggel.

- [ ] **1. lépés: a bukó tesztek (`src/pipeline.test.ts`).**
  - Új segéd a `fixModell` mellé, ugyanazzal a válaszalakkal, de soronként más szöveggel:
    ```ts
    /** Fixture-modell, amely hívásonként a következő szöveget adja (az utolsót ismétli). */
    function sorModell(texts: string[], inputTokens = 100, outputTokens = 20) {
      let call = 0
      return streamingMock({
        // eslint-disable-next-line @typescript-eslint/require-await
        doGenerate: async () => ({
          content: [{ type: 'text' as const, text: texts[Math.min(call++, texts.length - 1)]! }],
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: {
            inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
          },
          warnings: [],
        }),
      })
    }
    const S = GLOSSARY_SEPARATOR
    const VALASZ = `${MAGYAR_FORDITAS}\n${S}\nproblem | probléma`
    const glossaryPath = () => noteFile(notesRoot, item(), '_glossary-hu.md')
    ```
  - **Meglévő teszt átírása** („a forrásjegyzet törzsét fordítja”, `:881`): a `draft` = `fixModell(VALASZ)`. Új elvárások: a fordítás fájlja nem tartalmazza az elválasztót (`not.toContain(S)`); a `glossaryPath()` létezik, és benne van a `| problem | probléma |` sor; a `deps.store.translationChunks(item().itemId, 'proba-hu')` → `[]`.
  - **Meglévő teszt kiegészítése** („fordításnál a forrásjegyzetet sem keresi”, `:1062`): a `glossaryPath()` nem létezik (`exists` → `false`).
  - **Új `describe('processItem — darabolt fordítás és szójegyzék (#259)')`**, `const FORDITO10 = translationOf(ATMENO_RECEPT, 'hu', 10)` (az `ANGOL_FORRAS` 23 szava két darab), `const DARABOK = ['## Áttekintés\n\nA beszélő elmagyarázza, hogy miért kell a problémának az eszköz előtt lennie.\n' + S + '\nproblem | probléma', 'A második bekezdés egy példát is hoz az első cégéből.\n' + S + '\ntool | eszköz']`:
    - *darabolva fut, a szójegyzék commitra vár, a darabok törlődnek:* `commit: true`, `draft = sorModell(DARABOK)`, `biro()`; a fordítás fájlja tartalmazza a teljes `MAGYAR_FORDITAS`-t; a szójegyzékben `| problem | probléma |` és `| tool | eszköz |`; a `listPendingCommits()` tartalmazza a `glossaryPath()`-ot; a `translationChunks` → `[]`; az `item:refined` esemény `rounds` hossza 2; az artifact `score` 0,9, a `costUsd` `toBeCloseTo(0.00123, 6)` (2 draft-hívás × 0,0006 $ + 1 bíró-hívás × 0,00003 $).
    - *a második fordítás a meglévő szójegyzékből indul, a kézzel írt szöveg marad:* előtte `writeFile(glossaryPath(), '# Kézi\n\nSaját megjegyzés.\n\n| forrás | cél |\n|---|---|\n| Problem | probléma |\n\nZáró megjegyzés.\n')` (a mappát `mkdir`-rel). A `FORDITO` egy darab, a `draft = fixModell(\`${MAGYAR_FORDITAS}\n${S}\nproblem | gond\ntool | eszköz\`)`. A draft promptja tartalmazza a `'Problem | probléma'`-t; utána a fájl tartalmazza a `'Saját megjegyzés.'` és a `'Záró megjegyzés.'` sort, a `| tool | eszköz |` sort, és a `probléma`/`gond` közül csak a régit (a `'| problem | gond |'` nincs benne).
    - *darab bukása után az újraindítás a kész darabtól folytat:* első `processItem` a `sorModell([DARABOK[0], 'rossz', 'rossz', 'rossz'])`-szel → az artifact `failed`, az `error` tartalmazza a `'2/2. darab'`-ot, a `translationChunks` hossza 1, a szójegyzékfájl nincs. Második `processItem` egy új `sorModell([DARABOK[1]])`-gyel → `published`, a második draft `doGenerateCalls` hossza 1, a `translationChunks` → `[]`.
    - *dryRun mellett sem tábla, sem szójegyzékfájl:* `options: { dryRun: true }`, `sorModell(DARABOK)` → a `translationChunks` üres, a `glossaryPath()` nem létezik.
    - *nem értelmezhető szójegyzéksor:* előtte a fájlban `| a | b | c |` sor egy táblában; a futás után az események közt `{ type: 'item:glossary-skipped', itemId: item().itemId, recipe: 'proba-hu', rows: 1 }`, és a fájl `| a | b | c |` sora megmaradt.
  - A meglévő időtúllépés-tesztek (a `RecipeTimeout` és az `item:progress`, `currentScope`) változatlanul zöldek: ez a regressziós horgony a `recipeClock` kiemelésére.
- [ ] **2. lépés:** `pnpm vitest run src/pipeline.test.ts` → FAIL (a fordítás még a `refine`-on fut, nincs szójegyzékfájl).
- [ ] **3. lépés:** a fenti kód.
  - Egy könyvelési eset a „darabolva fut” tesztben: a `guard = createCostGuard(5)` a `recipeDeps`-ben, a futás után `guard.spentUsd()` → `toBeCloseTo(0.00123, 6)`, ugyanannyi, mint a `costUsd` (nincs dupla könyvelés).
- [ ] **4. lépés:** PASS, a `src/cli.test.ts` fordítási esetei is. A `forditoKliens` (`src/cli.test.ts:1677`) ma elválasztó nélkül válaszol, ezért a fordítás háromszori kérés után bukna. A `value = MAGYAR_FORDITAS` helyett: `value = \`${MAGYAR_FORDITAS}\n${GLOSSARY_SEPARATOR}\``. A `hivasok.translate` számai nem változnak, fordításonként egy hívás. Ha egy CLI-teszt a kiírt vagy commitolt fájlok pontos listáját várja, abban mostantól a `_glossary-hu.md` is szerepel. Ez a kívánt viselkedés, ezért az elvárás bővül, a kód nem változik. Mutációs próbák: a könyvelésben az `if (translated === null)` feltétel törlése → a `guard.spentUsd()` elvárás bukik (duplázódik); a `clearTranslationChunks` sor törlése → a „darabolva fut” teszt bukik; az `addedPairs(…)` helyett `translated.run.glossary` → a „kézzel írt szöveg marad” teszt bukik (a `Problem` sor duplázódik). Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(translate): Wire chunked translation and the glossary file into the pipeline`, `Refs #259`).

### 7. feladat: dokumentáció

**Fájlok:**
- Módosul: `docs/architecture.md` (§4, `:103–106`)
- Módosul: `docs/usage.md` (a fordításról szóló rész; `grep -n "fordít" docs/usage.md`)

- [ ] **1. lépés:** `docs/architecture.md` §4: a „A darabolás és a map-reduce összefűzés … teljes egészében kimarad — legfeljebb egy védőkorlát marad a kiugró esetekre.” mondat után új bekezdés: `Ez a fordításra 2026 őszén megfordult: a webináriumok forrásjegyzetei (44 ezer szó fölött) egy hívásban időtúllépésbe futottak (#258). A fordítás ezért \`translate.chunk_words\` (4 000 szó) fölött fejlécnél vágott darabokban, sorban fut, egy közös szójegyzékkel (#259, \`docs/plans/2026-10-23-fordites-darabolas-spec.md\`). A többi recept továbbra is egy hívásban dolgozik.`
- [ ] **2. lépés:** `docs/usage.md`, a fordítás leírásánál: `A fordítás mellett a jegyzetek mappájában egy \`<alapnév>_glossary-<cél>.md\` szójegyzék is készül: videónként és célnyelvenként egy, minden fordítás ebből indul, és ezt bővíti. A fájlt kézzel is lehet szerkeszteni: a futás csak a táblázat sorait olvassa (\`| forrás | cél |\`), a többi szöveget nem írja át. A \`translate.chunk_words\` (alapértelmezés 4 000) fölötti forrásjegyzet darabokban fordul; egy bukott darab után az újraindítás a kész darabokat nem fizeti ki újra, a \`--force\` mindent újrakezd.`
- [ ] **3. lépés:** `pnpm lint` zöld (a Markdown-lint is), commit (`docs: Document chunked translation and the glossary`, `Closes #259`).

### 8. feladat: kalibrálás (valódi pénz, külön jóváhagyással)

A spec „Kalibrálás” szakasza szerint, a kód-PR előtt vagy mellett, a felhasználó jóváhagyásával.
- [ ] **1. lépés:** a `zgWUhE6HjrI` forrásjegyzetének szószáma és a becslés (`refinery run --dry-run …` a fordítórecepttel): a becslésre legalább kétszeres ráhagyás, a felhasználó jóváhagyja a keretet.
- [ ] **2. lépés:** a futás a lokális configgal; a darabolás folytatható, tehát egy megszakadt futás nem fizetődik ki kétszer. Mérendő: lefut-e, átmegy-e a vázkapun (ha nem, az a #42 dolga, nem ennek a szeletnek a bukása), hány darab lett és mekkora a szójegyzék, a bíró (ha be van kapcsolva) elfér-e, nincs-e időtúllépés, és a tényleges költség a `/key/info` szerint.
- [ ] **3. lépés:** az eredmény a `docs/measurements/` alá, és ha a 4 000-es küszöb nem jó, a `DEFAULT_CHUNK_WORDS` módosítása ugyanebben a PR-ben.

### 9. feladat: kód-PR, kiadás

Külön kérésre.
- `gh pr checks`, a PR a felhasználó jóváhagyásával.
- Kiadás: minor (`bumpp`, changelog-generator, kiadási PR, tag). Kép kell (`pnpm docker:publish`), mert a `src/` változott. Worker-deploy nem kell.
- A peter-mba frissítése a felhasználó lépése (compose képverzió). Az állapottár új táblája az első megnyitáskor jön létre, migráció nélkül.

## Ismert korlátok (ponytail)

- A szójegyzékfájl nincs az `artifacts` táblában, tehát a `relinkNotes` (mappaáthelyezés `vault.layout`-változáskor) nem viszi magával. Ha ez előjön, a `pending_commits` mintájára kap egy követő sort.
- Egy egyidejű második fordító (két külön folyamat ugyanarra a videóra és nyelvre) a szójegyzékfájl olvasás–bővítés–írás ciklusában elveszíthet sorokat. A `run` és a `watch` sorban dolgozik (lásd fent); zárolás akkor kell, ha a serve és a CLI ugyanarra a vaultra párhuzamosan fordít.
- A modellválaszban a `|`-t tartalmazó kifejezés hibás válasznak számít, és újrakérést okoz. Ha a kalibrálás szerint ez gyakori, a prompt kérheti a `\|` alakot.
