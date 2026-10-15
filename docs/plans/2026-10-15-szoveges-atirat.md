# Szöveges átirat (`.txt`, `.md`) a CLI-ből — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `refinery scan` és a `refinery run` a `--dir`/`--match`/`--file` kapcsolóval időbélyeg nélküli `.txt`/`.md` átiratot is feldolgoz, tartalom-hash azonosítóval, a sorban rejtett útvonallal.

**Architecture:** Egy új, tiszta egység (`src/source/text.ts`) olvassa és ellenőrzi a szöveget, és ebből képzi az azonosítót. A `folder.ts` a meglévő bejárásra épít egy ad hoc felderítést, és a sor horgonyából újraépíti a szöveges tételt. A `SourceItem` egy opcionális `format: 'text'` mezőt kap; a `normalizeItem` ez alapján ágazik el, a horgonyzás üres `timed` mellett nem fut. A sor videósorának horgonya szöveges tételnél `%%azonosító útvonal%%`.

**Tech Stack:** TypeScript, Node 26 (`path.matchesGlob`, `TextDecoder`), Vitest.

**Spec:** `docs/plans/2026-10-14-szoveges-atirat-spec.md`

Az implementáció a `feat/szoveges-atirat` ágon indul a friss `main`-ről, miután ez a terv és a spec (a `docs/szoveges-atirat` ágon, egy docs-PR-ben) bekerült. Issue: #206 (a kód-PR az A szeletet zárja le, az issue a B szelet miatt nyitva marad).

## Eltérések a spectől (a felhasználó jóváhagyására)

1. **`format` opcionális**, és csak `'text'` értéke van; hiánya jelenti a feliratot. Ok: 27 fájl épít `SourceItem` literált, a kötelező mező mindegyiket érintené viselkedésváltozás nélkül.
2. **A `scan --queue` mindig a `sources`-t is bejárja**, ad hoc forrás mellett is, és a sor meglévő szöveges tételeit a horgonyuk útvonalából újraépíti. Ok: az összefésülés (`merge.ts`) minden sorbeli tételt, amely nincs a felderítettek között, `⚠ a felirat nem található` jellel jelöl. Enélkül a `scan --dir x --queue` minden forrásvideót, a sima `scan --queue` pedig minden szöveges tételt hamisan „nem található”-nak jelölne. A `scan` (lista) és a `run` a specnek megfelelően csak az ad hoc forrást nézi.
3. **Link-átírás a szövegben:** `[[cél|felirat]]` → `felirat`, `[[cél]]` → `cél`, `[szöveg](cél)` → `[szöveg](<cél>)`. Ok: a vault lintje (`src/vault/lint.ts`) tiltja a wikilinket és a csúcsos zárójel nélküli link-célt, így egy hétköznapi `.md` átirat jegyzete lint-hibával bukna. A link megmarad, csak vault-biztos alakban.
4. **Olvashatatlan fájl azonosítója:** a felderítés nem tud tartalom-hash-t számolni egy túl nagy vagy nem UTF-8 fájlra, ezért az ilyen tétel útvonal-hash azonosítót kap (`t-` előtaggal). A hibát a `normalizeItem` megnevezve adja, a többi tétel fut tovább.
5. **A sorból újraépített tétel forrásneve** a fájlt tartalmazó mappa neve (mint a `--file`-nál), akkor is, ha a tétel eredetileg `--dir`-rel, almappából került a sorba. A jegyzet így más vault-mappába kerülhet, mint egy közvetlen `run --dir` esetén. Duplikált jegyzet nem keletkezik, mert a „kész” állapot azonosító szerint dől el.

## Global Constraints

- Kiterjesztések: felirat `.srt`, `.vtt`; szöveg `.txt`, `.md`. A konfigurált `sources` bejárása továbbra is csak feliratot vesz fel.
- Fájlméret-kapu: legfeljebb 2 MB (`2 * 1024 * 1024` bájt).
- Azonosító: `t-` + a normalizált szöveg SHA-256 hex kivonatának első 16 jegye.
- Hibaüzenetek, szó szerint:
  - `a fájl túl nagy: <X.Y> MB, legfeljebb 2 MB`
  - `a fájl nem UTF-8 szöveg`
  - `a fájl üres`
  - `a fájl nevében nincs nyelvkód, és a tartalom nyelve sem ismerhető fel biztosan: <sourceFile>` (feliratra is, a korábbi „feliratfájl” szó helyett)
  - `nem található: <út>`
  - `nem található: a fájl tartalma megváltozott a sorba vétel óta (<út>)`
  - `Az útvonalban %% van, a sorba nem vehető fel: <út>`
- Kapcsolóhibák, szó szerint, nem nulla kilépési kóddal, a konfiguráció és az állapottár érintése előtt:
  - `A --dir és a --file együtt nem használható.`
  - `A --source a --dir és a --file mellett nem használható: azok a sources helyére lépnek.`
  - `A --match csak a --dir mellett használható.`
  - `A --file csak .srt, .vtt, .txt vagy .md fájl lehet: <út>`
  - `A --file nem létező fájl: <út>`
  - `A --dir nem létező mappa: <út>`
- A `scan` szöveges részletsora: `<N> szó, szöveg (.txt|.md)`, ütközésnél ` · jegyzet már létezik ezen a néven` utótaggal. Ad hoc fejléc: `<N> feldolgozható fájl`, mintával ` (--match '<minta>')` utótaggal.
- A teszt nem éri el a modellt: a CLI-tesztek hamis klienssel futnak, valós költség nincs.
- Minden feladat végén: `pnpm test` zöld, `pnpm typecheck` és `pnpm lint` hibátlan.
- A kiadás (minor verzió, changelog, tag, `pnpm docker:publish`) a kód-PR merge-e után jön, a bevált menet szerint; nem része a feladatoknak.

## Review Focus

1. Egy hétköznapi Obsidian-jegyzet (`[[wikilink]]`, `[link](https://…)`) mint átirat: a jegyzetnek el kell készülnie, nem bukhat a vault lintjén. (1. feladat: `vaultSafeLinks` teszt lint-ellenőrzéssel.)
2. `scan --dir x --queue` egy olyan sorra, amelyben forrásvideók is vannak: azok nem kaphatnak „nem található” jelet; és utána egy sima `scan --queue` a szöveges tételt sem jelölheti meg. (5. feladat.)
3. A sorba vett szöveges fájl útvonalában szóköz van (`~/Saját átiratok/…`): a horgony olvasása az első szóköznél vág, az útvonal egészben marad. (4. feladat.)
4. Ugyanaz a szöveg két néven a `--dir` mappában: egy tétel lesz, egy jegyzet. (3. feladat.)
5. Az idézőjel nélküli `--match *.md` a zsh-ban: ezt a kód nem látja, ezért a súgó és a doksi minden példája idézőjeles. (6. feladat.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/source/text.ts` (új) | Szöveg beolvasása, ellenőrzése, normalizálása; frontmatter-levágás; link-átírás; azonosító |
| `src/types.ts` | `SourceItem.format?: 'text'` |
| `src/pipeline.ts` | `normalizeItem` szöveges ága, közös nyelvfelismerés; horgonyzási esemény csak `timed` mellett |
| `src/recipe/anchor.ts` | `anchorParagraphs` üres `timed` mellett érintetlenül adja vissza a kimenetet |
| `src/source/folder.ts` | `splitSubtitleName` kiterjesztés-paramétere; `subtitleItems`, `textItem`, `firstById`, `discoverAdHoc`, `queuedTextItem`, `AD_HOC_EXTENSIONS` |
| `src/queue/line.ts` | A videósor horgonya útvonallal; olvasáskor szétválasztás |
| `src/queue/parse.ts` | `QueueVideo.path`, `QueuePair.path` |
| `src/cli.ts` | `--dir`/`--match`/`--file`; `adHocOptions`; `scan`, `scan --queue`, `run`, `run --queue` |
| `src/help.ts`, `docs/usage.md` | Súgó és felhasználói leírás |

---

### Task 1: Szöveges forrás (`src/source/text.ts`) és a `format` mező

**Files:**
- Create: `src/source/text.ts`
- Create: `src/source/text.test.ts`
- Modify: `src/types.ts:55-64` (`SourceItem`)

**Interfaces:**
- Produces:
  - `TEXT_EXTENSIONS: readonly ['.txt', '.md']`
  - `stripFrontmatter(text: string): string`
  - `vaultSafeLinks(text: string): string`
  - `readTextSource(path: string): Promise<string>` — ellenőrzött, normalizált szöveg; hibánál a Global Constraints szerinti üzenettel dob
  - `textItemId(text: string): string`
  - `SourceItem.format?: 'text'`

- [x] **Step 1: Write the failing test**

`src/source/text.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { lintVaultMarkdown } from '../vault/lint.js'
import { readTextSource, stripFrontmatter, textItemId, vaultSafeLinks } from './text.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-text-'))
})

async function file(name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, content)
  return path
}

describe('stripFrontmatter', () => {
  it('a záró ----ig levágja a vezető frontmattert', () => {
    expect(stripFrontmatter('---\ntitle: X\n---\n# Fejezet\nszöveg')).toBe('# Fejezet\nszöveg')
  })

  it('a ... záró sort is elfogadja', () => {
    expect(stripFrontmatter('---\ntitle: X\n...\nszöveg')).toBe('szöveg')
  })

  it('záró sor nélkül nem vág', () => {
    expect(stripFrontmatter('---\nnem frontmatter\nszöveg')).toBe('---\nnem frontmatter\nszöveg')
  })

  it('ha nem ---- sorral kezdődik, nem vág', () => {
    expect(stripFrontmatter('szöveg\n---\nx\n---')).toBe('szöveg\n---\nx\n---')
  })
})

describe('vaultSafeLinks', () => {
  it('a wikilinkből a felirat vagy a cél marad, a link célja csúcsos zárójelbe kerül', () => {
    const out = vaultSafeLinks('Lásd [[Cél|felirat]], [[Másik]], [itt](https://pelda.hu/a b) és ![kép](<x.png>).')
    expect(out).toBe('Lásd felirat, Másik, [itt](<https://pelda.hu/a b>) és ![kép](<x.png>).')
    expect(lintVaultMarkdown(out)).toEqual([])
  })
})

describe('readTextSource és textItemId', () => {
  it('a CRLF, a BOM és a szélek whitespace-e nem változtat az azonosítón', async () => {
    const a = await readTextSource(await file('a.txt', 'Első sor.\nMásodik sor.\n'))
    const b = await readTextSource(await file('b.txt', '﻿  Első sor.\r\nMásodik sor.\r\n\r\n'))
    expect(a).toBe('Első sor.\nMásodik sor.')
    expect(textItemId(b)).toBe(textItemId(a))
  })

  it('egy betű eltérés új azonosító', async () => {
    const a = await readTextSource(await file('a.txt', 'Első sor.'))
    const b = await readTextSource(await file('b.txt', 'Elsö sor.'))
    expect(textItemId(a)).not.toBe(textItemId(b))
    expect(textItemId(a)).toMatch(/^t-[0-9a-f]{16}$/)
  })

  it('.md-nél a frontmatter lekerül, és a hash utána készül', async () => {
    const a = await readTextSource(await file('a.md', '---\ntitle: Egy\n---\n# Fejezet\n'))
    const b = await readTextSource(await file('b.md', '---\ntitle: Kettő\n---\n# Fejezet\n'))
    expect(a).toBe('# Fejezet')
    expect(textItemId(a)).toBe(textItemId(b))
  })

  it('.txt-nél a frontmatternek látszó rész marad', async () => {
    expect(await readTextSource(await file('a.txt', '---\nx\n---\ny'))).toBe('---\nx\n---\ny')
  })

  it('megnevezett hibák: üres, csak frontmatter, túl nagy, NUL-bájt, érvénytelen UTF-8', async () => {
    await expect(readTextSource(await file('u.txt', ' \n\n'))).rejects.toThrow('a fájl üres')
    await expect(readTextSource(await file('f.md', '---\na: 1\n---\n'))).rejects.toThrow('a fájl üres')
    await expect(readTextSource(await file('n.txt', 'a'.repeat(2 * 1024 * 1024 + 1)))).rejects.toThrow(
      'a fájl túl nagy: 2.0 MB, legfeljebb 2 MB',
    )
    await expect(readTextSource(await file('z.txt', 'a\0b'))).rejects.toThrow('a fájl nem UTF-8 szöveg')
    await expect(readTextSource(await file('r.txt', Buffer.from([0xc3, 0x28])))).rejects.toThrow(
      'a fájl nem UTF-8 szöveg',
    )
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/source/text.test.ts`
Expected: FAIL — `Failed to resolve import "./text.js"`.

- [x] **Step 3: Write minimal implementation**

`src/source/text.ts`:

```ts
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

/** Az ad hoc úton (`--dir`, `--file`) felvehető szöveges átiratok kiterjesztései. */
export const TEXT_EXTENSIONS = ['.txt', '.md'] as const

/** A véletlen óriásfájl elleni kapu; a költséget a becslés és a költségkeret védi. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * A vezető YAML-frontmatter levágása: `---` nyitó sor, `---` vagy `...` záró
 * sor. Záró sor nélkül nincs levágás — a `---` lehet vízszintes vonal is.
 */
export function stripFrontmatter(text: string): string {
  const lines = text.split('\n')
  if (lines[0] !== '---') return text
  const close = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'))
  return close === -1 ? text : lines.slice(close + 1).join('\n')
}

/**
 * A vault lintje (`vault/lint.ts`) tiltja a wikilinket és a csúcsos zárójel
 * nélküli link-célt. A szöveges átirat ezért így megy tovább: a wikilinkből a
 * felirata (vagy a célja) marad, a link célja csúcsos zárójelbe kerül.
 */
export function vaultSafeLinks(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias: string | undefined) =>
      alias ?? target,
    )
    .replace(/(!?\[[^\]]*\]\()([^)]*)\)/g, (match, open: string, dest: string) =>
      dest.startsWith('<') ? match : `${open}<${dest}>)`,
    )
}

/**
 * Egy `.txt`/`.md` átirat szövege, ellenőrizve és normalizálva: BOM nélkül (a
 * `TextDecoder` levágja), `\n` sorvégekkel, `.md`-nél frontmatter nélkül,
 * vault-biztos linkekkel, levágott szélekkel. Az azonosító ebből készül.
 */
export async function readTextSource(path: string): Promise<string> {
  const { size } = await stat(path)
  if (size > MAX_BYTES) {
    throw new Error(`a fájl túl nagy: ${(size / 1024 / 1024).toFixed(1)} MB, legfeljebb 2 MB`)
  }
  const bytes = await readFile(path)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('a fájl nem UTF-8 szöveg')
  }
  if (text.includes('\0')) throw new Error('a fájl nem UTF-8 szöveg')

  text = text.replace(/\r\n?/g, '\n')
  if (path.toLowerCase().endsWith('.md')) text = stripFrontmatter(text)
  text = vaultSafeLinks(text).trim()
  if (text === '') throw new Error('a fájl üres')
  return text
}

/**
 * A szöveges tétel azonosítója a tartalomból: átnevezés, áthelyezés nem új
 * tétel, szerkesztés igen. A `t-` előtag választja el a videóazonosítótól.
 */
export function textItemId(text: string): string {
  return `t-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`
}
```

`src/types.ts`, a `SourceItem`-ben a `subtitlePath` kommentje és az új mező a `metadata` után:

```ts
  /** A forrásfájl abszolút útvonala: felirat, vagy szöveges átiratnál a `.txt`/`.md`. */
  subtitlePath: string
```

```ts
  /** A metaadatfájl mezői; üres objektum, ha nincs metaadat. */
  metadata: ItemMetadata
  /** `'text'`: időbélyeg nélküli `.txt`/`.md` átirat. Hiányában felirat. */
  format?: 'text'
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/source/text.test.ts && pnpm typecheck`
Expected: PASS, typecheck hibátlan.

- [x] **Step 5: Commit**

```bash
git add src/source/text.ts src/source/text.test.ts src/types.ts
git commit   # a commit-message skillel; tárgy pl. "feat(source): Add text transcript reader"
```

---

### Task 2: Normalizálás és horgonyzás szöveges tételnél

**Files:**
- Modify: `src/pipeline.ts:71-110` (`normalizeItem`), `src/pipeline.ts:258` (horgonyzási esemény)
- Modify: `src/recipe/anchor.ts:159` (`anchorParagraphs`)
- Test: `src/pipeline.test.ts`

**Interfaces:**
- Consumes: `readTextSource(path)` (Task 1), `SourceItem.format`
- Produces: `normalizeItem(item)` szöveges tételre `{ lines, timed: [], wordsRaw === wordsNormalized, … }`

- [x] **Step 1: Write the failing test**

`src/pipeline.test.ts`, a `describe('processItem — horgonyzás kihagyása'` blokkon belül, a meglévő `it` után (ott elérhető a `HORGONYZOTT_RECEPT`):

```ts
  it('szöveges tételen nincs horgonyzás és nincs horgonyzási esemény', async () => {
    await writeFile(join(dir, 'Átirat.en.txt'), 'The speaker explains the idea.\n', 'utf8')
    const { sink, events } = collectEvents()
    const kimenet = 'Completely unrelated sentence about quantum chromodynamics.'
    const outcome = await processItem(
      item({ format: 'text', subtitlePath: join(dir, 'Átirat.en.txt'), sourceFile: 'Átirat.en.txt', baseName: 'Átirat' }),
      {
        ...alapDeps(),
        sink,
        recipeDeps: {
          recipe: HORGONYZOTT_RECEPT,
          client: probaKliens(`${kimenet}\n`),
          modelConfig: MODELL_CFG,
          guard: createCostGuard(5),
        },
      },
    )

    expect(outcome.status).toBe('published')
    expect(events.some((e) => e.type === 'item:anchor-skipped')).toBe(false)
    expect(await readFile(outcome.recipePath!, 'utf8')).toContain(`\n${kimenet}\n`)
  })
```

A fájl végére egy új blokk:

```ts
describe('normalizeItem — szöveges tétel', () => {
  it('a nem üres sorok sorrendben, deduplikálás és időbélyeg nélkül', async () => {
    await writeFile(join(dir, 'Átirat.hu.txt'), 'Első sor.\n\nElső sor.\n  Második sor.  \n', 'utf8')
    const current = item({ format: 'text', subtitlePath: join(dir, 'Átirat.hu.txt'), language: 'hu' })

    const transcript = await normalizeItem(current)

    expect(transcript.lines).toEqual(['Első sor.', 'Első sor.', 'Második sor.'])
    expect(transcript.timed).toEqual([])
    expect(transcript.wordsRaw).toBe(6)
    expect(transcript.wordsNormalized).toBe(6)
  })

  it('nyelvkód nélkül a tartalom dönt', async () => {
    await writeFile(
      join(dir, 'Átirat.txt'),
      'The speaker explains why the problem should always come before the tool, and gives an example.\n',
      'utf8',
    )
    const current = item({ format: 'text', subtitlePath: join(dir, 'Átirat.txt'), language: null })
    await normalizeItem(current)
    expect(current.language).toBe('en')
  })

  it('a fájl hibája megnevezett item:failed, nem csendes kihagyás', async () => {
    await writeFile(join(dir, 'Üres.hu.txt'), '\n', 'utf8')
    const { sink, events } = collectEvents()
    const outcome = await processItem(
      item({ format: 'text', subtitlePath: join(dir, 'Üres.hu.txt'), language: 'hu' }),
      { ...alapDeps(), sink },
    )
    expect(outcome).toMatchObject({ status: 'failed', error: 'a fájl üres' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'item:failed', error: 'a fájl üres' }))
  })
})
```

Ha a `readFile` még nincs importálva a `node:fs/promises`-ból a teszt tetején, add hozzá.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pipeline.test.ts`
Expected: FAIL — a szöveges tételnél a `parseSubtitle` dob: `Nem támogatott feliratformátum`.

- [x] **Step 3: Write minimal implementation**

`src/pipeline.ts`, import:

```ts
import { readTextSource } from './source/text.js'
```

A `normalizeItem` és két új segéd (a nyelvi blokk a feliratágból kiemelve):

```ts
/**
 * A fájlnév nyelvkódja az elsődleges forrás; ha nincs, a tartalom dönt.
 * Csendes angol alapértelmezés helyett megnevezett hiba: egy holland vagy
 * német átiratot angolnak véve a nyelvi kapu rossz alaphoz mérne.
 */
function detectLanguage(item: SourceItem, text: string): void {
  if (item.language !== null) return
  const detected = identifyLanguage(text)
  if (detected === null) {
    throw new Error(
      'a fájl nevében nincs nyelvkód, és a tartalom nyelve sem ' +
        `ismerhető fel biztosan: ${item.sourceFile}`,
    )
  }
  item.language = detected
}

/** Időbélyeg nélküli átirat: a nem üres sorok, változatlan sorrendben, deduplikálás nélkül. */
async function normalizeText(item: SourceItem): Promise<NormalizedTranscript> {
  const lines = (await readTextSource(item.subtitlePath))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const text = lines.join(' ')
  detectLanguage(item, text)
  const words = countWords(text)
  return {
    lines,
    timed: [],
    wordsRaw: words,
    wordsNormalized: words,
    captionSource: classifyCaptions(text),
    punctuationDensity: punctuationDensity(text),
  }
}

/**
 * Forrásfájl → normalizált átirat. A `scan`, a költségbecslés és a
 * feldolgozás ugyanezt hívja, hogy a szószám mindhárom helyen ugyanaz legyen.
 */
export async function normalizeItem(
  item: SourceItem,
): Promise<NormalizedTranscript> {
  if (item.format === 'text') return normalizeText(item)

  const raw = await readFile(item.subtitlePath, 'utf8')
  const cues = parseSubtitle(raw, item.subtitlePath)
  if (cues.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz értelmezhető feliratblokkot')
  }

  const rawText = cues.flatMap((c) => c.lines).join(' ')
  const timed = dedupeTimedLines(cues)
  if (timed.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz szöveget')
  }
  const lines = timed.map((line) => line.text)
  const normalizedText = lines.join(' ')
  detectLanguage(item, normalizedText)

  return {
    lines,
    timed,
    wordsRaw: countWords(rawText),
    wordsNormalized: countWords(normalizedText),
    captionSource: classifyCaptions(normalizedText),
    punctuationDensity: punctuationDensity(normalizedText),
  }
}
```

`src/pipeline.ts`, a `runRecipe`-ben a horgonyzási esemény feltétele:

```ts
  // Csak az időbélyeges receptnél és időbélyeges átiratnál értelmes: egy
  // `summary` vagy egy szöveges átirat jegyzetében az időbélyeg hiánya nem hiány.
  if (recipe.anchored && transcript.timed.length > 0) {
```

`src/recipe/anchor.ts`, az `anchorParagraphs` első sora:

```ts
export function anchorParagraphs(output: string, timed: readonly TimedLine[]): string {
  // Szöveges átiratnál nincs mihez horgonyozni: a kimenet érintetlenül megy át.
  if (timed.length === 0) return output
  const words = wordStream(timed)
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pipeline.test.ts src/recipe && pnpm typecheck`
Expected: PASS. Ha egy meglévő teszt a régi „a feliratfájl nevében nincs nyelvkód” szövegre illeszt, a Global Constraints szerinti új szövegre igazítsd. Ha a „nyelvkód nélkül a tartalom dönt” teszt `identifyLanguage`-a a rövid mondatra `null`-t ad, hosszabbítsd a szöveget (nézd meg a `src/lang/identify.test.ts` mintáit), ne a kódot.

- [x] **Step 5: Commit**

```bash
git add src/pipeline.ts src/pipeline.test.ts src/recipe/anchor.ts
git commit   # commit-message skill; pl. "feat(pipeline): Normalize text transcripts without anchoring"
```

---

### Task 3: Ad hoc felderítés és a sorbeli tétel újraépítése (`src/source/folder.ts`)

**Files:**
- Modify: `src/source/folder.ts`
- Test: `src/source/folder.test.ts`

**Interfaces:**
- Consumes: `TEXT_EXTENSIONS`, `readTextSource`, `textItemId` (Task 1)
- Produces:
  - `splitSubtitleName(fileName: string, extensions?: readonly string[]): SubtitleName | null` (alapérték a feliratkiterjesztések)
  - `AD_HOC_EXTENSIONS: readonly string[]` — `.srt`, `.vtt`, `.txt`, `.md`
  - `interface AdHoc { dir?: string; file?: string; match?: string }`
  - `firstById(items: readonly SourceItem[]): SourceItem[]`
  - `textItem(path: string, source: SourceDir): Promise<SourceItem>`
  - `discoverAdHoc(adHoc: AdHoc, languages: readonly string[]): Promise<SourceItem[]>`
  - `queuedTextItem(itemId: string, path: string): Promise<SourceItem | string>` — siker esetén a tétel, különben a „nem található” üzenet

- [x] **Step 1: Write the failing test**

`src/source/folder.test.ts`, az importok:

```ts
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  discoverAdHoc,
  discoverAll,
  folderSource,
  queuedTextItem,
  splitSubtitleName,
  textItem,
} from './folder.js'
import { TEXT_EXTENSIONS } from './text.js'
```

A fájl végére:

```ts
const SRT = '1\n00:00:00,000 --> 00:00:02,000\nEgy felirat sor.\n'
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nEgy vtt sor.\n'

describe('splitSubtitleName szöveges kiterjesztéssel', () => {
  it('a nyelvkód szabálya ugyanaz', () => {
    expect(splitSubtitleName('átirat.en.md', TEXT_EXTENSIONS)).toEqual({ base: 'átirat', language: 'en' })
    expect(splitSubtitleName('átirat.txt', TEXT_EXTENSIONS)).toEqual({ base: 'átirat', language: null })
  })

  it('alapértelmezésben a szöveg nem felirat', () => {
    expect(splitSubtitleName('átirat.md')).toBeNull()
  })
})

describe('folderSource', () => {
  it('a konfigurált forrásból nem vesz fel .txt és .md fájlt', async () => {
    await write('Cs/A.hu.srt', SRT)
    await write('Cs/README.md', '# Olvass el')
    await write('Cs/jegyzet.txt', 'szöveg')
    const items = await folderSource(source(), []).discover()
    expect(items.map((i) => i.baseName)).toEqual(['A'])
  })
})

describe('discoverAdHoc', () => {
  const x = () => join(root, 'x')

  beforeEach(async () => {
    await write('x/a.hu.srt', SRT)
    await write('x/b.hu.vtt', VTT)
    await write('x/c.hu.txt', 'Szöveg c.')
    await write('x/f.hu.md', '# F')
    await write('x/al/d.hu.md', '# D')
  })

  it('minta nélkül mind a négy fajtát felveszi, az almappából is', async () => {
    const items = await discoverAdHoc({ dir: x() }, [])
    expect(items.map((i) => i.sourceFile).sort()).toEqual(['a.hu.srt', 'al/d.hu.md', 'b.hu.vtt', 'c.hu.txt', 'f.hu.md'])
    expect(new Set(items.map((i) => i.source))).toEqual(new Set(['x']))
    const d = items.find((i) => i.baseName === 'd')!
    expect(d).toMatchObject({ format: 'text', title: 'd', language: 'hu', metadata: {}, subtitlePath: join(x(), 'al', 'd.hu.md') })
    expect(d.itemId).toMatch(/^t-[0-9a-f]{16}$/)
    expect(items.find((i) => i.baseName === 'a')!.format).toBeUndefined()
  })

  it("a / nélküli minta a fájlnévre illik, minden mélységben", async () => {
    const items = await discoverAdHoc({ dir: x(), match: '*.md' }, [])
    expect(items.map((i) => i.sourceFile).sort()).toEqual(['al/d.hu.md', 'f.hu.md'])
  })

  it('a /-t tartalmazó minta a relatív útra illik', async () => {
    const items = await discoverAdHoc({ dir: x(), match: 'al/*.md' }, [])
    expect(items.map((i) => i.sourceFile)).toEqual(['al/d.hu.md'])
  })

  it('a nem támogatott kiterjesztésre illő minta üres eredményt ad', async () => {
    await write('x/g.pdf', '%PDF')
    expect(await discoverAdHoc({ dir: x(), match: '*.pdf' }, [])).toEqual([])
  })

  it('--file: egyetlen tétel, a forrás a fájlt tartalmazó mappa', async () => {
    const items = await discoverAdHoc({ file: join(x(), 'al', 'd.hu.md') }, [])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'al', sourceFile: 'd.hu.md', baseName: 'd' })
  })

  it('azonos tartalom két néven: egy tétel', async () => {
    await write('x/c-masolat.hu.txt', 'Szöveg c.')
    const items = await discoverAdHoc({ dir: x(), match: 'c*.txt' }, [])
    expect(items).toHaveLength(1)
  })

  it('átnevezés után ugyanaz az azonosító', async () => {
    const before = await textItem(join(x(), 'c.hu.txt'), { name: 'x', path: x() })
    await rename(join(x(), 'c.hu.txt'), join(x(), 'uj-nev.hu.txt'))
    const after = await textItem(join(x(), 'uj-nev.hu.txt'), { name: 'x', path: x() })
    expect(after.itemId).toBe(before.itemId)
  })

  it('az olvashatatlan fájl is tétel lesz, t- előtagú azonosítóval', async () => {
    await write('x/ures.hu.txt', '')
    const item = await textItem(join(x(), 'ures.hu.txt'), { name: 'x', path: x() })
    expect(item.itemId).toMatch(/^t-/)
    expect(item.format).toBe('text')
  })
})

describe('queuedTextItem', () => {
  it('a horgony útvonalából újraépíti a tételt', async () => {
    await write('y/átirat.hu.txt', 'Egy szöveg.')
    const path = join(root, 'y', 'átirat.hu.txt')
    const original = await textItem(path, { name: 'y', path: join(root, 'y') })
    const item = await queuedTextItem(original.itemId, path)
    expect(item).toMatchObject({ itemId: original.itemId, source: 'y', sourceFile: 'átirat.hu.txt', format: 'text' })
  })

  it('a hiányzó fájlra és a megváltozott tartalomra okot ad', async () => {
    const path = join(root, 'y', 'átirat.hu.txt')
    expect(await queuedTextItem('t-0000000000000000', path)).toBe(`nem található: ${path}`)
    await write('y/átirat.hu.txt', 'Már más szöveg.')
    expect(await queuedTextItem('t-0000000000000000', path)).toBe(
      `nem található: a fájl tartalma megváltozott a sorba vétel óta (${path})`,
    )
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/source/folder.test.ts`
Expected: FAIL — a `discoverAdHoc`, `queuedTextItem`, `textItem` nincs exportálva.

- [x] **Step 3: Write minimal implementation**

`src/source/folder.ts`, importok:

```ts
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, matchesGlob, relative, resolve, sep } from 'node:path'
import type { SourceDir } from '../config.js'
import type { SourceItem } from '../types.js'
import { itemIdFor } from './identity.js'
import { readSidecar } from './metadata.js'
import { readTextSource, TEXT_EXTENSIONS, textItemId } from './text.js'
import type { Source } from './types.js'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/** Amit a `--dir`/`--file` felvehet. A konfigurált `sources` csak feliratot. */
export const AD_HOC_EXTENSIONS: readonly string[] = [...SUBTITLE_EXTENSIONS, ...TEXT_EXTENSIONS]
```

A `splitSubtitleName` paramétert kap (a törzs többi része változatlan):

```ts
export function splitSubtitleName(
  fileName: string,
  extensions: readonly string[] = SUBTITLE_EXTENSIONS,
): SubtitleName | null {
  const lower = fileName.toLowerCase()
  const ext = extensions.find((candidate) => lower.endsWith(candidate))
  if (!ext) return null
```

A `folderSource.discover` törzse kiemelve egy `subtitleItems` függvénybe; a `discover` azt hívja. A törzs szó szerint a mai, csak a `source.path`/`source.name` paraméterből jön, és a bemenet a `files` lista:

```ts
/**
 * Feliratfájlokból elemek: csoportosítás mappa + alapnév szerint, nyelvválasztás,
 * sidecar-keresés. A nem feliratfájlokat kihagyja.
 */
async function subtitleItems(
  files: readonly string[],
  source: SourceDir,
  languages: readonly string[],
): Promise<SourceItem[]> {
  // Csoportosítás mappa + alapnév szerint: egy alapnévhez egy elem
  // tartozik, akárhány nyelven van hozzá felirat.
  const groups = new Map<string, Candidate[]>()
  for (const path of files) {
    const parsed = splitSubtitleName(basename(path))
    if (!parsed) continue
    const key = join(dirname(path), parsed.base)
    const list = groups.get(key) ?? []
    list.push({ path, language: parsed.language })
    groups.set(key, list)
  }

  const items: SourceItem[] = []
  const keys = [...groups.keys()].sort()
  for (const key of keys) {
    const chosen = chooseSubtitle(groups.get(key)!, languages)
    // A metaadatfájl elsőként a levágott alapnév mellett várt, de ha a
    // nyelvkódnak látszó utótag valójában a cím része (pl. `Node.js`),
    // az info.json a LEVÁGÁS NÉLKÜLI névvel fekszik ott — ezt a tartalék
    // keresés találja meg, ahelyett hogy az elem metaadat nélkül maradna.
    const sidecar =
      (await readSidecar(`${key}.info.json`)) ??
      (chosen.language ? await readSidecar(`${key}.${chosen.language}.info.json`) : null)
    const baseName = basename(key)
    const relBase = toPosix(relative(source.path, key))

    items.push({
      itemId: itemIdFor(source.name, relBase, sidecar?.metadata.videoId),
      source: source.name,
      sourceFile: toPosix(relative(source.path, chosen.path)),
      subtitlePath: chosen.path,
      baseName,
      title: sidecar?.title ?? baseName,
      language: chosen.language,
      metadata: sidecar?.metadata ?? {},
    })
  }

  return items
}

/**
 * Feliratmappából olvas. Offline és determinisztikus: a fejlesztés és a
 * tesztelés nem függ hálózattól.
 *
 * A felderítés a **feliratfájlokon** iterál. A metaadatfájl kiegészítés: ha
 * van, gazdagabb lesz a jegyzet, de a hiánya nem ejt ki elemet.
 */
export function folderSource(source: SourceDir, languages: readonly string[]): Source {
  return {
    id: source.name,
    async discover(): Promise<SourceItem[]> {
      return subtitleItems(await walk(source.path), source, languages)
    },
  }
}
```

A `discoverAll` a közös `firstById`-ra épül (a doc-kommentje marad):

```ts
/** Azonos azonosítóból az első előfordulás marad. */
export function firstById(items: readonly SourceItem[]): SourceItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.itemId)) return false
    seen.add(item.itemId)
    return true
  })
}

export async function discoverAll(
  sources: readonly SourceDir[],
  languages: readonly string[],
): Promise<SourceItem[]> {
  const items: SourceItem[] = []
  for (const source of sources) {
    items.push(...(await folderSource(source, languages).discover()))
  }
  return firstById(items)
}
```

Új függvények a fájl végén:

```ts
/**
 * Egy `.txt`/`.md` átirat eleme. Az azonosító a tartalomból jön. Az
 * olvashatatlan fájl az útvonalból kap azonosítót: így a felderítés nem áll
 * meg miatta, a hibát pedig a `normalizeItem` megnevezve adja.
 */
export async function textItem(path: string, source: SourceDir): Promise<SourceItem> {
  const { base, language } = splitSubtitleName(basename(path), TEXT_EXTENSIONS)!
  const sourceFile = toPosix(relative(source.path, path))
  let itemId: string
  try {
    itemId = textItemId(await readTextSource(path))
  } catch {
    // ponytail: útvonal-hash azonosító; a fájl javítása után új tétel lesz belőle
    itemId = `t-${itemIdFor(source.name, sourceFile)}`
  }
  return {
    itemId,
    source: source.name,
    sourceFile,
    subtitlePath: path,
    baseName: base,
    title: base,
    language,
    metadata: {},
    format: 'text',
  }
}

/** Egy futásra a `sources` helyére lépő forrás: `--dir` (és `--match`) vagy `--file`. */
export interface AdHoc {
  dir?: string
  file?: string
  match?: string
}

/**
 * Az ad hoc forrás elemei. A forrás neve a mappa neve, `--file`-nál a fájlt
 * tartalmazó mappáé. A `/` nélküli minta a fájlnévre illik, mint a
 * `.gitignore`-ban: relatív útra illesztve a `'*.md'` csendben kihagyná az
 * almappákat.
 */
export async function discoverAdHoc(
  adHoc: AdHoc,
  languages: readonly string[],
): Promise<SourceItem[]> {
  const root = resolve(adHoc.file === undefined ? adHoc.dir! : dirname(adHoc.file))
  const source: SourceDir = { name: basename(root), path: root }
  let files = adHoc.file === undefined ? await walk(root) : [resolve(adHoc.file)]
  const pattern = adHoc.match
  if (pattern !== undefined) {
    files = files.filter((path) =>
      matchesGlob(pattern.includes('/') ? toPosix(relative(root, path)) : basename(path), pattern),
    )
  }
  const texts = files.filter((path) => splitSubtitleName(basename(path), TEXT_EXTENSIONS) !== null).sort()
  return firstById([
    ...(await subtitleItems(files, source, languages)),
    ...(await Promise.all(texts.map((path) => textItem(path, source)))),
  ])
}

/**
 * Egy sorbeli szöveges tétel újraépítése a horgony útvonalából. Hiba helyett
 * az okot adja: a hívó a „nem található” listára teszi.
 */
export async function queuedTextItem(itemId: string, path: string): Promise<SourceItem | string> {
  if (!existsSync(path)) return `nem található: ${path}`
  const item = await textItem(path, { name: basename(dirname(path)), path: dirname(path) })
  return item.itemId === itemId
    ? item
    : `nem található: a fájl tartalma megváltozott a sorba vétel óta (${path})`
}
```
- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/source && pnpm typecheck && pnpm lint`
Expected: PASS; a meglévő `folder.test.ts` esetek változatlanul zöldek.

- [x] **Step 5: Commit**

```bash
git add src/source/folder.ts src/source/folder.test.ts
git commit   # commit-message skill; pl. "feat(source): Discover ad hoc text and subtitle files"
```

---

### Task 4: A sor horgonya útvonallal (`src/queue/line.ts`, `src/queue/parse.ts`)

**Files:**
- Modify: `src/queue/line.ts:7-33` (`QueueLine`, `classifyLine`), `src/queue/line.ts:88-90` (`videoLine`)
- Modify: `src/queue/parse.ts` (`QueueVideo`, `QueuePair`, `parseQueue` videóág, `checkedPairs`)
- Test: `src/queue/line.test.ts`, `src/queue/parse.test.ts`

**Interfaces:**
- Consumes: `SourceItem.format` (Task 1)
- Produces:
  - `QueueLine` videó: `{ kind: 'video'; itemId: string; path?: string; head: string; suffix: string }`
  - `QueueVideo.path?: string`, `QueuePair.path?: string`
  - `videoLine(item)` szöveges tételnél `### 0. <cím> %%<itemId> <abszolút út>%%`

- [x] **Step 1: Write the failing test**

`src/queue/line.test.ts`, a fájl végére:

```ts
describe('szöveges tétel horgonya', () => {
  const szoveg = elem({
    itemId: 't-0123456789abcdef',
    source: 'Saját átiratok',
    sourceFile: 'átirat.hu.md',
    subtitlePath: '/Users/x/Saját átiratok/átirat.hu.md',
    baseName: 'átirat',
    title: 'átirat',
    format: 'text',
  })

  it('a horgonyban az azonosító után szóközzel az abszolút út áll', () => {
    const line = videoLine(szoveg)
    expect(line).toBe('### 0. átirat %%t-0123456789abcdef /Users/x/Saját átiratok/átirat.hu.md%%')
    expect(lintVaultMarkdown(line)).toEqual([])
  })

  it('olvasáskor az első szóköznél válik ketté, az útvonal egészben marad', () => {
    expect(classifyLine(`${videoLine(szoveg)} — ✓ summary`)).toEqual({
      kind: 'video',
      itemId: 't-0123456789abcdef',
      path: '/Users/x/Saját átiratok/átirat.hu.md',
      head: videoLine(szoveg),
      suffix: ' — ✓ summary',
    })
  })

  it('a státuszutótag frissítése után az útvonal megmarad', () => {
    const parsed = classifyLine(videoLine(szoveg))
    if (parsed.kind !== 'video') throw new Error('videósort vártam')
    expect(classifyLine(withSuffix(parsed.head, '⚠ x'))).toMatchObject({
      path: '/Users/x/Saját átiratok/átirat.hu.md',
    })
  })

  it('a feliratos videósorhoz nem kerül útvonal', () => {
    expect(classifyLine(videoLine(elem()))).not.toHaveProperty('path')
  })
})
```

`src/queue/parse.test.ts`, a fájl végére (az importok közé kell a `checkedPairs` és a `parseQueue`, ha még nincsenek):

```ts
describe('checkedPairs szöveges tétellel', () => {
  it('a pár viszi a horgony útvonalát', () => {
    const doc = parseQueue(
      [
        '## 1. atiratok',
        '### 1. átirat %%t-0123456789abcdef /tmp/a b/átirat.md%%',
        '- [x] summary',
        '### 2. Videó %%abcDEF12345%%',
        '- [x] summary',
        '',
      ].join('\n'),
    )
    expect(checkedPairs(doc)).toEqual([
      { itemId: 't-0123456789abcdef', path: '/tmp/a b/átirat.md', recipeId: 'summary' },
      { itemId: 'abcDEF12345', recipeId: 'summary' },
    ])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/queue/line.test.ts src/queue/parse.test.ts`
Expected: FAIL — a horgonyban nincs útvonal, a `classifyLine` az egész horgonyt azonosítónak veszi.

- [x] **Step 3: Write minimal implementation**

`src/queue/line.ts`:

```ts
export type QueueLine =
  | { kind: 'heading'; key: string }
  | { kind: 'video'; itemId: string; path?: string; head: string; suffix: string }
  | { kind: 'recipe'; recipeId: string; checked: boolean; head: string; suffix: string }
  | { kind: 'translation'; lang: string; checked: boolean; head: string; suffix: string }
  | { kind: 'other' }
```

A `VIDEO` regex előtti komment kiegészül, maga a regex változatlan:

```ts
// A cím nem-mohó: az ELSŐ `%%…%%` a horgony. A `cleanTitle` gondoskodik róla,
// hogy a címben ne maradjon `%%`. A fej a sorszámot is viszi: a `withSuffix`
// ebből írja vissza a sort, a sorszámot csak a `renumberQueue` írja át.
// Szöveges tételnél a horgony `azonosító útvonal`: az azonosítóban nincs
// szóköz, az útvonalban lehet, ezért az első szóköznél válik ketté.
const VIDEO = /^(### \d+\. .*? %%(.+?)%%)(.*)$/
```

A `classifyLine` videóága:

```ts
  const video = VIDEO.exec(line)
  if (video) {
    const anchor = video[2]!
    const space = anchor.indexOf(' ')
    return space === -1
      ? { kind: 'video', itemId: anchor, head: video[1]!, suffix: video[3]! }
      : {
          kind: 'video',
          itemId: anchor.slice(0, space),
          path: anchor.slice(space + 1),
          head: video[1]!,
          suffix: video[3]!,
        }
  }
```

A `videoLine`:

```ts
/**
 * Szöveges tételnél a horgony az útvonalat is viszi: a `run --queue` ebből
 * találja meg a fájlt, ami a `sources`-ban nincs. Rejtett, mert egy látható
 * linket a Better Markdown Links plugin átírhatna.
 */
export function videoLine(item: SourceItem): string {
  const anchor = item.format === 'text' ? `${item.itemId} ${item.subtitlePath}` : item.itemId
  return `### 0. ${cleanTitle(item.title, item.itemId)} %%${anchor}%%`
}
```

`src/queue/parse.ts`, a `QueueVideo`-ban az `itemId` után:

```ts
  /** Szöveges tételnél a forrásfájl abszolút útja a horgonyból. */
  path?: string
```

A `QueuePair`:

```ts
export interface QueuePair {
  itemId: string
  /** Szöveges tételnél a forrásfájl abszolút útja a horgonyból. */
  path?: string
  recipeId: string
}
```

A `parseQueue` videóága:

```ts
      case 'video':
        current = {
          line,
          itemId: parsed.itemId,
          ...(parsed.path === undefined ? {} : { path: parsed.path }),
          head: parsed.head,
          suffix: parsed.suffix,
          duplicate: seen.has(parsed.itemId),
          recipes: [],
        }
```

A `checkedPairs`:

```ts
export function checkedPairs(doc: QueueDoc): QueuePair[] {
  return doc.videos
    .filter((video) => !video.duplicate)
    .flatMap((video) => {
      const at = video.path === undefined ? {} : { path: video.path }
      return video.recipes.flatMap((recipe) => [
        ...(recipe.checked ? [{ itemId: video.itemId, ...at, recipeId: recipe.recipeId }] : []),
        ...recipe.translations
          .filter((translation) => translation.checked)
          .map((translation) => ({
            itemId: video.itemId,
            ...at,
            recipeId: translationId(recipe.recipeId, translation.lang),
          })),
      ])
    })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/queue && pnpm typecheck`
Expected: PASS; a meglévő sorformátum-tesztek változtatás nélkül zöldek.

- [x] **Step 5: Commit**

```bash
git add src/queue/line.ts src/queue/line.test.ts src/queue/parse.ts src/queue/parse.test.ts
git commit   # commit-message skill; pl. "feat(queue): Keep text item path in hidden anchor"
```

---

### Task 5: CLI-kapcsolók, `scan`, `scan --queue`, `run`, `run --queue` (`src/cli.ts`)

**Files:**
- Modify: `src/cli.ts` (`commandScan`, `commandScanQueue`, `commandRun`, `main`; új `adHocOptions`, `discover`, `textDetail`, `queuedTextItems`)
- Test: `src/cli.test.ts` (kapcsolóhibák), `src/e2e.test.ts` (végponttól végpontig)

**Interfaces:**
- Consumes: `AdHoc`, `AD_HOC_EXTENSIONS`, `discoverAdHoc`, `firstById`, `queuedTextItem` (Task 3); `QueuePair.path`, `QueueVideo.path` (Task 4); `normalizeItem` (Task 2)
- Produces:
  - `adHocOptions(values: { dir?: string; file?: string; match?: string; source?: string }): Promise<AdHoc | string | undefined>`
  - `commandScan(cfg: Config, adHoc?: AdHoc): Promise<number>`
  - `commandScanQueue(cfg, flags: { dryRun: boolean; commit: boolean; adHoc?: AdHoc })`
  - `commandRun(cfg, raw, flags: { …; adHoc?: AdHoc }, runtime)`

- [ ] **Step 1: Write the failing tests**

`src/cli.test.ts`, új `describe` a fájl végén (a fájl már importálja a `main`-t, `vi`-t, `existsSync`-et; ha nem, add hozzá):

```ts
describe('ad hoc forrás — kapcsolóhibák', () => {
  it.each([
    [['scan', '--match', '*.md'], 'A --match csak a --dir mellett használható.'],
    [['run', '--dir', 'D', '--file', 'F'], 'A --dir és a --file együtt nem használható.'],
    [['run', '--dir', 'D', '--source', 'x'], 'A --source a --dir és a --file mellett nem használható: azok a sources helyére lépnek.'],
    [['run', '--file', 'PDF'], 'A --file csak .srt, .vtt, .txt vagy .md fájl lehet: PDF'],
    [['run', '--file', 'NINCS'], 'A --file nem létező fájl: NINCS'],
    [['scan', '--dir', 'NINCSDIR'], 'A --dir nem létező mappa: NINCSDIR'],
  ])('%j → hiba a futás előtt', async (args, message) => {
    const pdf = join(work, 'a.pdf')
    await writeFile(pdf, '%PDF')
    const subst: Record<string, string> = {
      D: downloads,
      F: pdf,
      PDF: pdf,
      NINCS: join(work, 'nincs.txt'),
      NINCSDIR: join(work, 'nincs'),
    }
    const real = args.map((arg) => subst[arg] ?? arg)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await main(real)).toBe(1)
      expect(String(errorSpy.mock.calls[0]?.[0])).toBe(
        message.replace(/PDF|NINCSDIR|NINCS/, (key) => subst[key]!),
      )
      expect(existsSync(join(work, 'state.db'))).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
```

`src/e2e.test.ts`, az importok bővítése:

```ts
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRun, commandScan, commandScanQueue } from './cli.js'
import { NOT_FOUND_MARK } from './queue/merge.js'
import { discoverAdHoc, discoverAll } from './source/folder.js'
```

A fájl végére:

```ts
describe('szöveges átirat (--dir, --file)', () => {
  let atiratok: string
  let mentettKulcs: string | undefined

  const raw = () => ({
    vault: { path: vault },
    sources: [subsA],
    state: { path: join(work, 'state.db') },
    logs: { dir: join(work, 'logs') },
    model: { base_url: 'http://localhost:4000/v1', draft: 'proba-draft', judge: 'proba-judge' },
    pricing: {
      'proba-draft': { input_per_million: 3, output_per_million: 15 },
      'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: 5,
  })
  const cfgOf = () => loadConfig(raw(), join(work, 'refinery.config.yaml'))

  /** Hamis kliens, amely a generáló promptokat gyűjti. */
  function kliens(promptok: string[]): ModelClient {
    return {
      generate: (_role, prompt) => {
        promptok.push(prompt)
        return Promise.resolve({
          value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
          usage: { inputTokens: 10, outputTokens: 5 },
        })
      },
      generateObject: <T>() =>
        Promise.resolve({ value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }),
    }
  }

  const summary = (adHoc: { dir?: string; file?: string; match?: string }) => ({
    adHoc,
    recipe: 'summary',
    dryRun: false,
    force: false,
    commit: false,
  })

  beforeEach(async () => {
    atiratok = join(work, 'atiratok')
    await mkdir(atiratok, { recursive: true })
    mentettKulcs = process.env.LITELLM_API_KEY
    process.env.LITELLM_API_KEY = 'sk-proba'
  })

  afterEach(() => {
    process.env.LITELLM_API_KEY = mentettKulcs
  })

  it('run --file: jegyzet, done állapot, költség a riportban; átnevezve újra: nincs új hívás', async () => {
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van, írásjelekkel.\n')
    const cfg = cfgOf()
    const promptok: string[] = []

    expect(await commandRun(cfg, raw(), summary({ file: txt }), { createClient: () => kliens(promptok) })).toBe(0)

    const [item] = await discoverAdHoc({ file: txt }, cfg.languages)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_transcript.md'))).toBe(true)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_summary.md'))).toBe(true)
    const store = openState(cfg.statePath)
    expect(store.isDone(item!.itemId, 'summary')).toBe(true)
    store.close()
    const riport = (await readdir(join(work, 'logs'))).find((f) => f.endsWith('.md'))!
    expect(await readFile(join(work, 'logs', riport), 'utf8')).toContain('összköltség')

    const hivasok = promptok.length
    const atnevezett = join(atiratok, 'más-név.hu.txt')
    await rename(txt, atnevezett)
    expect(
      await commandRun(cfg, raw(), summary({ file: atnevezett }), { createClient: () => kliens(promptok) }),
    ).toBe(0)
    expect(promptok.length).toBe(hivasok)
  })

  it('.md frontmatterrel: a promptban nincs frontmatter, a fejléc igen', async () => {
    const md = join(atiratok, 'jegyzet.hu.md')
    await write(md, '---\ntitle: Titkos mező\n---\n# Fejezet\n\nSzöveg itt, mondatokkal.\n')
    const promptok: string[] = []

    expect(await commandRun(cfgOf(), raw(), summary({ file: md }), { createClient: () => kliens(promptok) })).toBe(0)

    expect(promptok[0]).not.toContain('Titkos mező')
    expect(promptok[0]).toContain('# Fejezet')
  })

  it('hibás fájlok: megnevezett hiba, a jó tétel elkészül', async () => {
    await write(join(atiratok, 'ures.hu.txt'), '\n')
    await write(join(atiratok, 'nagy.hu.txt'), 'a'.repeat(2 * 1024 * 1024 + 1))
    await write(join(atiratok, 'nul.hu.txt'), 'a\0b')
    await writeFile(join(atiratok, 'rossz.hu.txt'), Buffer.from([0xc3, 0x28]))
    await write(join(atiratok, 'jo.hu.txt'), 'Ez egy jó átirat, rendes mondatokkal.\n')
    const cfg = cfgOf()

    const code = await commandRun(cfg, raw(), { adHoc: { dir: atiratok }, dryRun: false, force: false, commit: false })

    expect(code).toBe(1)
    const items = await discoverAdHoc({ dir: atiratok }, cfg.languages)
    const by = (base: string) => items.find((i) => i.baseName === base)!
    const store = openState(cfg.statePath)
    expect(store.artifactOf(by('ures').itemId, 'transcript')?.error).toBe('a fájl üres')
    expect(store.artifactOf(by('nagy').itemId, 'transcript')?.error).toBe('a fájl túl nagy: 2.0 MB, legfeljebb 2 MB')
    expect(store.artifactOf(by('nul').itemId, 'transcript')?.error).toBe('a fájl nem UTF-8 szöveg')
    expect(store.artifactOf(by('rossz').itemId, 'transcript')?.error).toBe('a fájl nem UTF-8 szöveg')
    expect(store.isDone(by('jo').itemId, 'transcript')).toBe(true)
    store.close()
  })

  it('scan --dir --match: fejléc, részletsor, almappa, ütközés, üres eredmény', async () => {
    await write(join(atiratok, 'a.hu.srt'), SRT)
    await write(join(atiratok, 'f.hu.md'), '# F\n\nEgy mondat.\n')
    await write(join(atiratok, 'al', 'd.hu.md'), '# D\n\nMásik mondat.\n')
    const cfg = cfgOf()
    // Egy másik, azonos nevű fájl jegyzete már ott van.
    const [f] = await discoverAdHoc({ dir: atiratok, match: 'f.*' }, cfg.languages)
    await write(noteFile(cfg.notesRoot, f!, '_transcript.md'), '---\nitem_id: t-masik\n---\n')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const out = () => logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    try {
      expect(await commandScan(cfg, { dir: atiratok, match: '*.md' })).toBe(0)
      expect(out()).toContain("2 feldolgozható fájl (--match '*.md')")
      expect(out()).toContain('al/d.hu.md')
      expect(out()).toMatch(/\d+ szó, szöveg \(\.md\) · jegyzet már létezik ezen a néven/)
      expect(out()).toMatch(/\d+ szó, szöveg \(\.md\)$/m)
      logSpy.mockClear()

      expect(await commandScan(cfg, { dir: atiratok })).toBe(0)
      expect(out()).toContain('3 feldolgozható fájl')
      logSpy.mockClear()

      expect(await commandScan(cfg, { dir: atiratok, match: '*.pdf' })).toBe(0)
      expect(out()).toContain("0 feldolgozható fájl (--match '*.pdf')")
    } finally {
      logSpy.mockRestore()
    }
  })

  it('scan --queue --dir, majd run --queue: a sources-ban nem lévő tétel is feldolgozódik', async () => {
    await write(join(subsA, 'Cs', 'Video.en.srt'), SRT)
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van.\n')
    const cfg = cfgOf()
    const sor = queuePath(cfg.notesRoot)

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { dir: atiratok } })).toBe(0)
    const [item] = await discoverAdHoc({ dir: atiratok }, cfg.languages)
    const text = await readFile(sor, 'utf8')
    expect(text).toContain(`%%${item!.itemId} ${txt}%%`)
    expect(text).not.toContain(NOT_FOUND_MARK)

    // A sima scan --queue a szöveges tételt sem jelöli „nem található”-nak.
    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)
    expect(await readFile(sor, 'utf8')).not.toContain(NOT_FOUND_MARK)

    const sorok = (await readFile(sor, 'utf8')).split('\n')
    const horgony = sorok.findIndex((l) => l.includes(item!.itemId))
    const pipa = sorok.findIndex((l, n) => n > horgony && l === '- [ ] summary')
    sorok[pipa] = '- [x] summary'
    await writeFile(sor, sorok.join('\n'), 'utf8')

    expect(
      await commandRun(
        cfg,
        raw(),
        { queue: true, dryRun: false, force: false, commit: false },
        { createClient: () => kliens([]) },
      ),
    ).toBe(0)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_summary.md'))).toBe(true)
  })

  it.each([
    ['törölve', (path: string) => rm(path), (path: string) => `nem található: ${path}`],
    [
      'módosítva',
      (path: string) => writeFile(path, 'Teljesen más szöveg.\n', 'utf8'),
      (path: string) => `nem található: a fájl tartalma megváltozott a sorba vétel óta (${path})`,
    ],
  ])('run --queue, a fájl közben %s: a nem található listára kerül, okkal', async (_name, change, reason) => {
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van.\n')
    const cfg = cfgOf()
    const sor = queuePath(cfg.notesRoot)
    expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { file: txt } })).toBe(0)
    await writeFile(sor, (await readFile(sor, 'utf8')).replace('- [ ] summary', '- [x] summary'), 'utf8')
    await change(txt)

    const code = await commandRun(
      cfg,
      raw(),
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => kliens([]) },
    )

    expect(code).toBe(1)
    const riport = (await readdir(join(work, 'logs'))).find((f) => f.endsWith('.md'))!
    expect(await readFile(join(work, 'logs', riport), 'utf8')).toContain(reason(txt))
  })

  it('scan --queue: a %%-t tartalmazó útvonal megnevezett hiba, a sor nem kapja meg', async () => {
    const furcsa = join(work, 'a%%b')
    await write(join(furcsa, 'c.hu.txt'), 'Egy mondat.\n')
    const cfg = cfgOf()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { dir: furcsa } })).toBe(1)
      expect(String(errorSpy.mock.calls[0]?.[0])).toBe(
        `Az útvonalban %% van, a sorba nem vehető fel: ${join(furcsa, 'c.hu.txt')}`,
      )
    } finally {
      errorSpy.mockRestore()
    }
    const sor = await readFile(queuePath(cfg.notesRoot), 'utf8').catch(() => '')
    expect(sor).not.toContain('c.hu.txt')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/cli.test.ts src/e2e.test.ts`
Expected: FAIL — `parseArgs` ismeretlen kapcsolót kap (`--dir`), a `commandRun` nem ismeri az `adHoc`-ot.

- [ ] **Step 3: Write minimal implementation**

`src/cli.ts`, importok (a meglévők mellé; a `readFile`/`existsSync` már importálva van):

```ts
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseQueue } from './queue/parse.js'
import {
  AD_HOC_EXTENSIONS,
  discoverAdHoc,
  discoverAll,
  firstById,
  queuedTextItem,
  type AdHoc,
} from './source/folder.js'
import { transcriptFile } from './vault/paths.js'
```

(A `parseQueue`, `readQueueFile`, `queuePath` közül ami már importálva van, ne duplikáld.)

Új segédek a `commandScan` elé:

```ts
/**
 * A `--dir`/`--file`/`--match` ellenőrzése a futás előtt: hibánál az üzenet,
 * ad hoc forrás nélkül `undefined`.
 */
export async function adHocOptions(values: {
  dir?: string
  file?: string
  match?: string
  source?: string
}): Promise<AdHoc | string | undefined> {
  const { dir, file, match } = values
  if (match !== undefined && dir === undefined) return 'A --match csak a --dir mellett használható.'
  if (dir === undefined && file === undefined) return undefined
  if (dir !== undefined && file !== undefined) return 'A --dir és a --file együtt nem használható.'
  if (values.source !== undefined) {
    return 'A --source a --dir és a --file mellett nem használható: azok a sources helyére lépnek.'
  }
  if (file !== undefined) {
    if (!AD_HOC_EXTENSIONS.includes(extname(file).toLowerCase())) {
      return `A --file csak .srt, .vtt, .txt vagy .md fájl lehet: ${file}`
    }
    const isFile = await stat(file).then((s) => s.isFile(), () => false)
    return isFile ? { file } : `A --file nem létező fájl: ${file}`
  }
  const isDir = await stat(dir!).then((s) => s.isDirectory(), () => false)
  if (!isDir) return `A --dir nem létező mappa: ${dir!}`
  return match === undefined ? { dir: dir! } : { dir: dir!, match }
}

/** Az ad hoc forrás erre a futásra a `sources` helyére lép. */
function discover(cfg: Config, adHoc: AdHoc | undefined): Promise<SourceItem[]> {
  return adHoc ? discoverAdHoc(adHoc, cfg.languages) : discoverAll(cfg.sources, cfg.languages)
}

/** A szöveges tétel részletsora; jelzi, ha a jegyzet neve már egy másik tételé. */
async function textDetail(cfg: Config, item: SourceItem): Promise<string> {
  const words = (await normalizeItem({ ...item })).wordsNormalized
  let taken = false
  try {
    const existing = await readFile(transcriptFile(cfg.notesRoot, item), 'utf8')
    taken = !existing.includes(`item_id: ${item.itemId}\n`)
  } catch {
    // Nincs ilyen jegyzet: a név szabad.
  }
  const ext = extname(item.subtitlePath).toLowerCase()
  return `${String(words)} szó, szöveg (${ext})${taken ? ' · jegyzet már létezik ezen a néven' : ''}`
}

/**
 * A sor szöveges tételei a horgonyuk útvonalából. Enélkül az összefésülés
 * minden szöveges tételt „nem található”-nak jelölne, mert a `sources` nem
 * tartalmazza őket. Ami már nincs meg, kimarad — azt a merge jelöli.
 */
async function queuedTextItems(notesRoot: string): Promise<SourceItem[]> {
  const text = await readQueueFile(queuePath(notesRoot))
  if (text === null) return []
  const items: SourceItem[] = []
  for (const video of parseQueue(text).videos) {
    if (video.path === undefined) continue
    const item = await queuedTextItem(video.itemId, video.path)
    if (typeof item !== 'string') items.push(item)
  }
  return items
}
```

A `commandScan`:

```ts
export async function commandScan(cfg: Config, adHoc?: AdHoc): Promise<number> {
  const items = await discover(cfg, adHoc)
  const filter = adHoc?.match === undefined ? '' : ` (--match '${adHoc.match}')`
  console.log(
    adHoc ? `${String(items.length)} feldolgozható fájl${filter}\n` : `${String(items.length)} feldolgozható felirat\n`,
  )
  for (const item of items) {
    let detail: string
    try {
      if (item.format === 'text') {
        detail = await textDetail(cfg, item)
      } else {
        const raw = await readFile(item.subtitlePath, 'utf8')
        const cues = parseSubtitle(raw, item.subtitlePath)
        const rawText = cues.flatMap((c) => c.lines).join(' ')
        const normalized = dedupeLines(cues).join(' ')
        detail = `${countWords(rawText)} → ${countWords(normalized)} szó, ${classifyCaptions(normalized)}`
      }
    } catch (error) {
      detail = `olvashatatlan ${item.format === 'text' ? 'fájl' : 'felirat'}: ${(error as Error).message}`
    }
    console.log(`  ${item.source}  ${item.itemId}  ${item.title}`)
    console.log(`      ${item.sourceFile}`)
    console.log(`      ${detail}`)
  }
  return 0
}
```

A `commandScanQueue` aláírása és felderítése (a többi sor változatlan, csak a három `return 0` helyére `return code` kerül):

```ts
export async function commandScanQueue(
  cfg: Config,
  flags: { dryRun: boolean; commit: boolean; adHoc?: AdHoc },
): Promise<number> {
  // A regiszter a felderítés és a sor írása előtt épül: egy hibás translate
  // kulcs így nem hagy félig frissített sort maga után.
  const registry = recipesFor(cfg)
  const commit = flags.commit && !flags.dryRun
  if (commit) await gitPullFfOnly(cfg.vaultPath)

  // Az ad hoc forrás itt NEM lép a sources helyére: az összefésülés minden
  // sorbeli, de fel nem derített tételt „nem található”-nak jelölne.
  const adHoc = flags.adHoc ? await discoverAdHoc(flags.adHoc, cfg.languages) : []
  const unsafe = adHoc.filter((item) => item.format === 'text' && item.subtitlePath.includes('%%'))
  for (const item of unsafe) {
    console.error(`Az útvonalban %% van, a sorba nem vehető fel: ${item.subtitlePath}`)
  }
  const code = unsafe.length > 0 ? 1 : 0
  const items = await withContentLanguage(
    firstById([
      ...(await discoverAll(cfg.sources, cfg.languages)),
      ...(await queuedTextItems(cfg.notesRoot)),
      ...adHoc.filter((item) => !unsafe.includes(item)),
    ]),
  )
  const { path, current, text, stats, migrated, marked } = await refreshQueue(cfg, registry, items)
```

A `commandRun` `flags` típusa egy mezővel bővül:

```ts
    /** Erre a futásra a `sources` helyére lépő forrás (`--dir`/`--file`). */
    adHoc?: AdHoc
```

A felderítés és a queue-feloldás a `try` elején:

```ts
  try {
    discovered = await discover(cfg, flags.adHoc)

    let units: WorkUnit[]
    if (queueMode) {
      const byId = new Map(discovered.map((item) => [item.itemId, item] as const))
      /** A horgony útvonalából feloldott szöveges tételek; a hiba oka egyszer kerül a riportba. */
      const resolved = new Map<string, SourceItem | string>()
      units = []
      for (const pair of checkedPairs(parseQueue(queueText ?? ''))) {
        const pairRecipe = registry[pair.recipeId]
        if (!pairRecipe) {
          warnings.push(`ismeretlen recept a sorban: ${pair.recipeId} (${pair.itemId})`)
          continue
        }
        let item = byId.get(pair.itemId)
        if (item === undefined && pair.path !== undefined) {
          if (!resolved.has(pair.itemId)) {
            const queued = await queuedTextItem(pair.itemId, pair.path)
            resolved.set(pair.itemId, queued)
            if (typeof queued === 'string') warnings.push(queued)
          }
          const queued = resolved.get(pair.itemId)
          if (typeof queued !== 'string') item = queued
        }
        if (item) units.push({ item, recipe: pairRecipe })
        else notFound.push(pair)
      }
```

(A blokk többi része — a szűrők, a `--retry-failed`, a `--limit` — változatlan.)

A `main`-ben a `parseArgs` `options`-ába:

```ts
      dir: { type: 'string' },
      file: { type: 'string' },
      match: { type: 'string' },
```

A `parseArgs` után, a watch-ellenőrzés előtt — a konfiguráció betöltése és az állapottár megnyitása előtt:

```ts
  // A kapcsolóütközés a konfiguráció és az állapottár érintése előtt áll meg.
  let adHoc: AdHoc | undefined
  if (command === 'scan' || command === 'run') {
    const checked = await adHocOptions(values)
    if (typeof checked === 'string') {
      console.error(checked)
      return 1
    }
    adHoc = checked
  }
```

A `scan` és a `run` ága:

```ts
  if (command === 'scan') {
    return values.queue
      ? commandScanQueue(cfg, { dryRun: values['dry-run'], commit: !values['no-commit'], adHoc })
      : commandScan(cfg, adHoc)
  }
```

```ts
  if (command === 'run') {
    return commandRun(cfg, raw, {
      source: values.source,
      channel: values.channel,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      recipe: values.recipe,
      queue: values.queue,
      dryRun: values['dry-run'],
      force: values.force,
      commit: !values['no-commit'],
      retryFailed: values['retry-failed'],
      noJudge: values['no-judge'],
      command: argv.join(' '),
      adHoc,
    })
  }
```

A watch az új kapcsolókat magától elutasítja: a `WATCH_OPTIONS` engedélylista, ehhez nem kell nyúlni.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/cli.test.ts src/e2e.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. Ha az `e2e` queue-teszt `existsSync(noteFile(…))` állítása bukik, nézd meg, hová írta a jegyzetet: a sorból feloldott tétel forrásneve a fájl mappája (`atiratok`), lásd az „Eltérések” 5. pontját.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts src/e2e.test.ts
git commit   # commit-message skill; pl. "feat(cli): Add --dir, --match, --file to scan and run"
```

---

### Task 6: Súgó és felhasználói leírás

**Files:**
- Modify: `src/help.ts:15-65`
- Modify: `docs/usage.md` (2. fejezet)
- Test: `src/cli.test.ts` (`OPTIONS` táblázat, példák)

**Interfaces:**
- Consumes: a Task 5 kapcsolói

- [ ] **Step 1: Write the failing test**

`src/cli.test.ts`, az `OPTIONS` táblázatban a `scan` és a `run` sora:

```ts
    scan: ['--config', '--dir', '--match', '--file', '--queue', '--dry-run', '--no-commit'],
    run: [
      '--config',
      '--dir',
      '--match',
      '--file',
      '--source',
```

(A `run` többi eleme változatlan.) A súgó-`describe` végére:

```ts
  it('a scan és a run súgója idézőjeles mintát és szöveges példát mutat', () => {
    expect(helpText('scan')).toContain("refinery scan --dir ~/atiratok --match '*.md'")
    expect(helpText('run')).toContain('refinery run --file ~/atiratok/átirat.txt')
    expect(overview()).not.toContain('videókat')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/cli.test.ts -t súgó`
Expected: FAIL — a súgóban nincs `--dir`.

- [ ] **Step 3: Write minimal implementation**

`src/help.ts`, az állandók közé:

```ts
const DIR = ['--dir <mappa>', 'ad hoc mappa a sources helyett, rekurzívan: .srt, .vtt, .txt, .md'] as const
const MATCH = [
  "--match '<glob>'",
  "--dir mellett: csak a mintára illő fájlok; / nélkül a fájlnévre illik. Idézőjelben, különben a shell bontja ki",
] as const
const FILE = ['--file <út>', 'egyetlen .srt, .vtt, .txt vagy .md fájl a sources helyett'] as const
const AD_HOC_NOTE =
  'A --dir vagy a --file erre a futásra a sources helyére lép; .txt és .md átirat csak így jön be.'
```

A `scan`:

```ts
  {
    name: 'scan',
    summary: 'Felderíti a feldolgozható tételeket, és nem ír semmit.',
    usage: 'refinery scan [kapcsolók]',
    description:
      'Felderíti a forrásmappák feldolgozható videóit, és kiírja őket.\n' +
      `${AD_HOC_NOTE}\n` +
      'A --queue mellett a vault _queue.md sorába fésüli az új tételeket.',
    options: [
      CONFIG,
      DIR,
      MATCH,
      FILE,
      ['--queue', 'a vault _queue.md sorába fésül'],
      ['--dry-run', '--queue mellett: nem írja a sort, csak kiírja a változást'],
      ['--no-commit', '--queue mellett: nem commitol és nem pushol a vault repójába'],
      HELP,
    ],
    examples: ['refinery scan', "refinery scan --dir ~/atiratok --match '*.md'", 'refinery scan --queue --dry-run'],
  },
```

A `run` `description`-je egy sorral, az `options` a `CONFIG` után a hárommal, az `examples` egy elemmel bővül:

```ts
    description:
      'Átiratot készít a feldolgozható videókból, és a vaultba írja.\n' +
      `${AD_HOC_NOTE}\n` +
      'A --recipe receptet is futtat; a --queue a vault _queue.md sorának kipipált párjait dolgozza fel.\n' +
      'A futás naplója és riportja a konfigurációban megadott logs.dir alá kerül.',
    options: [
      CONFIG,
      DIR,
      MATCH,
      FILE,
      SOURCE,
```

```ts
    examples: [
      'refinery run --limit 3',
      'refinery run --recipe summary --limit 1',
      'refinery run --file ~/atiratok/átirat.txt',
      'refinery run --queue',
    ],
```

`docs/usage.md`, a 2. fejezet végére, a `---` elválasztó elé:

````markdown
### Szöveges átirat (`--dir`, `--match`, `--file`)

Időbélyeg nélküli `.txt` vagy `.md` átiratból is készül jegyzet. Ezek csak
ezekkel a kapcsolókkal jönnek be; a konfigurált `sources` továbbra is csak
feliratot (`.srt`, `.vtt`) vesz fel. A kapcsoló erre az egy futásra a
`sources` helyére lép, a `scan` és a `run` ugyanúgy érti:

```bash
# előnézet: egy mappa .md fájljai, az almappákból is
refinery scan --dir ~/atiratok --match '*.md'
# csak egy almappa
refinery scan --dir ~/atiratok --match 'eloadasok/*.md'
# egyetlen fájl feldolgozása recepttel
refinery run --file ~/atiratok/átirat.txt --recipe summary
# a sorba vétel, majd a kipipált párok feldolgozása
refinery scan --dir ~/atiratok --queue
refinery run --queue
```

- A mintát mindig idézőjelbe tedd: a zsh az idézetlen `*.md`-t maga bontja ki,
  és találat nélkül el sem indítja a parancsot. A `/` nélküli minta a
  fájlnévre illik, a `/`-t tartalmazó a mappához képesti útra.
- A cím és a jegyzet neve a fájlnévből jön; a nyelvkód a fájlnévből
  (`átirat.en.md`), hiányában a tartalomból.
- Az `.md` vezető frontmattere lekerül; a wikilinkből a felirata marad, a
  linkek célja csúcsos zárójelbe kerül (a vault írási szabálya).
- Az azonosság a tartalomé: átnevezett vagy áthelyezett fájlért nem fizetsz
  újra, a szerkesztett fájl új tétel. Ha a jegyzet neve már foglalt, a
  write-once miatt kimarad (a `scan` jelzi); újrafeldolgozás `--force`-szal.
- Legfeljebb 2 MB, UTF-8 szöveg. A sorban a tétel horgonya rejtve az
  útvonalat is viszi; ha a fájl közben eltűnik vagy megváltozik, a
  `run --queue` „nem található”-nak jelöli.
- Nem használható együtt: `--dir` és `--file`; `--source` ezek mellett;
  `--match` `--dir` nélkül.
````

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, a teljes készlet zöld.

- [ ] **Step 5: Commit**

```bash
git add src/help.ts src/cli.test.ts docs/usage.md
git commit   # commit-message skill; pl. "docs(cli): Document text transcript options"
```

---

## Spec-lefedettség

| Spec | Feladat |
|---|---|
| 1. Szöveges forrás (méret, UTF-8, NUL, frontmatter, üres, hash, név/nyelv, `format`) | 1, 3 |
| 2. Ad hoc felderítés (`--file`, `--dir`, `--match`, forrásnév, duplikátum) | 3 |
| 3. Normalizálás, horgonyzás | 2 |
| 4. A sor (írás, olvasás, `%%`, `withSuffix`) | 4, 5 |
| 5. CLI és súgó (kapcsolók, `scan`, `scan --queue`, `run`, `run --queue`, kapcsolóhibák, súgó, `usage.md`) | 5, 6 |
| 6. Hibakezelés | 2, 5 |
| 7. Tesztek | 1–6 (a `clean-light` eset a 2. feladatban, horgonyzott hamis recepttel, pipeline-szinten) |
| 8. Kiadás | a kód-PR után, nem feladat |
