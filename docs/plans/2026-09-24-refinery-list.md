# A `refinery list` parancs — implementációs terv

> **Ágenseknek:** KÖTELEZŐ al-skill: `superpowers:executing-plans` (ennél a
> felhasználónál alapértelmezés: a munkamenet maga hajtja végre a lépéseket,
> alügynök-dispatch nélkül, Sonneten). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** új, csak olvasó `refinery list` parancs, amely a terminálban
receptenkénti állapottal listázza az elemeket, csatornánként összesít, és
megtalálja, min nem futott még egy recept.

**Felépítés:** a meglévő `readItems()` (`src/view/items.ts`) adja a sorokat —
ugyanazt, amiből a webes felület dolgozik. Egy új, tiszta nézetmodul
(`src/view/list.ts`) szűr, összesít és szöveggé alakít; a `src/cli.ts` csak
beköti. SQL, séma és a felület kódja nem változik.

**Technológia:** TypeScript (Node ≥ 26.2, ESM), `node:util` `parseArgs`,
Vitest. Új függőség nincs.

**Spec:** [`docs/plans/2026-09-24-refinery-list-spec.md`](<./2026-09-24-refinery-list-spec.md>)
— a végrehajtó mindkettőt olvassa.

**Ellenőrzöttség:** a terv teljes kódját egy eldobható worktree-n a `main`
`68d9747` állapotán lefuttattuk: `pnpm test` 998 zöld teszt (a meglévő 968 + 30
új), `pnpm typecheck` és `pnpm lint` tiszta; a valós konfiggal a
`list --channels` `Összesen` sorának `sum` oszlopa (18) egyezett a `summary`
`done` rekordjainak számával, és az állapotfájl bájtra változatlan maradt.

## Globális megkötések

- Új függőség nincs.
- Az állapottár sémája és a `src/state/queries.ts` nem változik.
- A `readItems()` és a `buildItemRows()` viselkedése nem változik (a `byText`
  csak exportot kap).
- A `list` nem ír sehova, csak a stdout-ra és a stderr-re; állapotfájlt nem hoz
  létre.
- A `scan`, a `run` és a `check-pricing` kimenete és kapcsolói nem változnak.
- A kódkommentek és a tesztleírások magyarul, a környező kód stílusában.
- Munkaág: `feat/refinery-list`, a spec+terv PR merge-e utáni friss `main`-ről.
  Commit a `commit-message` skill formátumában (semantic subject, magyar
  törzs), a kód-PR törzsében `Closes #67`.

## Review-fókusz

Azok a bemenetek, amelyekről a spec hallgat, de egy felhasználót a
legvalószínűbben megharapnának — mindegyikre van teszt a gazda-taskban:

1. **Csatorna nélküli elem `--channel` mellett** — nem illik rá, akkor sem, ha
   a szűrő szövege `null` (Task 1, `filterRows`).
2. **Nem létező állapotfájl** — a lista minden cellát `·`-ként mutat, és a
   fájl nem jön létre (Task 4).
3. **`--limit abc` vagy `--limit 0`** — a `Number()` `NaN`-t vagy `0`-t ad; 1-es
   kód, megnevezett üzenet (Task 4).
4. **Eltűnt feliratú elem** — `†` a cím előtt; a recept-nézetben csak akkor van
   `†`-magyarázat, ha van ilyen sor (Task 2).
5. **Nagyon hosszú csatornanév** — az elemlistában 16, az összesítőben 24
   karakterre vágva, `…`-lel; a valós korpuszban van egy 50 karakteres
   (Task 2, Task 3).

## Eltérés a spectől (a végrehajtás előtt a specbe is beírva, Task 5)

- A spec a `ChannelSummary.costUsd`-t `number`-nek írta; a terv `number | null`,
  mert a `—` szabály („egyik cellának sincs költsége") máskülönben nem
  különböztethető meg a 0-tól.
- A spec a címszélességet a `commandList`-be tette; a terv a
  `renderItemTable`-be (`lineWidth` opció), hogy tisztán tesztelhető legyen.
  A viselkedés azonos: TTY-n a maradék hely (legalább 20), egyébként 40.
- Az összesítő csatornaneve 24 karakterre vágódik — a spec ezt nem rögzítette,
  a valós korpusz 50 karakteres neve a táblát ~140 karakterre szélesítette.
- Az összesítő első sora `<N> csatorna` (+ szűrőmegjegyzés), az elemlistáé
  mintájára.

## Fájlszerkezet

| fájl | szerep |
|---|---|
| `src/view/list.ts` (új) | tiszta függvények: szűrés, oszlopkódok, elemlista, csatorna-összesítő |
| `src/view/list.test.ts` (új) | a fenti egységtesztjei, kézzel összerakott `ItemListRow[]`-vel |
| `src/view/items.ts` | a `byText` exportja (Task 3) |
| `src/cli.ts` | `commandList`, a `list` ág a `main`-ben, két új kapcsoló, `USAGE` |
| `src/cli.test.ts` | a `commandList` tesztjei a meglévő fixture-mintán |
| `README.md`, `docs/architecture.md` | a parancs leírása |
| `docs/plans/2026-09-24-refinery-list-spec.md` | a fenti eltérések átvezetése |

---

### Task 1: Szűrés és oszlopkódok

**Fájlok:**
- Új: `src/view/list.ts`
- Új: `src/view/list.test.ts`

**Interfészek:**
- Használja: `CellStatus`, `ItemListRow` (`src/view/items.ts`, változatlan).
- Adja: `LIST_STATUSES: readonly CellStatus[]`, `interface ListFilters`,
  `filterRows(rows, filters): ItemListRow[]`, `describeFilters(filters): string`,
  `kindCodes(kinds): Record<string, string>`.

- [ ] **1. lépés: a bukó teszt.** Hozd létre a `src/view/list.test.ts`-t:

```ts
import { describe, expect, it } from 'vitest'
import type { ItemCell, ItemListRow } from './items.js'
import { describeFilters, filterRows, kindCodes } from './list.js'

const KINDS = ['transcript', 'summary', 'clean', 'clean-hu']

const cell = (overrides: Partial<ItemCell> = {}): ItemCell => ({
  status: 'pending',
  score: null,
  costUsd: null,
  belowThreshold: false,
  ...overrides,
})

/** Egy sor; a meg nem adott típusok cellája „hátra". */
const row = (
  itemId: string,
  overrides: Partial<Omit<ItemListRow, 'cells'>> = {},
  cells: Record<string, Partial<ItemCell>> = {},
): ItemListRow => ({
  itemId,
  title: `Videó ${itemId}`,
  source: 'youtube',
  channel: 'Csatorna A',
  captionSource: 'creator',
  discovered: true,
  updatedAt: null,
  ...overrides,
  cells: Object.fromEntries(KINDS.map((k) => [k, cell(cells[k])])),
})

describe('filterRows', () => {
  const rows = [
    row('a', { channel: 'Csatorna A', source: 'youtube' }, { summary: { status: 'done' } }),
    row('b', { channel: 'Csatorna B', source: 'youtube' }, { clean: { status: 'failed' } }),
    row('c', { channel: null, source: 'meetings' }),
    row('d', { channel: 'csatorna a', source: 'youtube' }, {
      summary: { status: 'done', belowThreshold: true },
    }),
  ]
  const ids = (list: ItemListRow[]) => list.map((r) => r.itemId)

  it('szűrő nélkül minden sort, változatlan sorrendben ad', () => {
    expect(ids(filterRows(rows, {}))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a forrás és a csatorna kis- és nagybetű nélkül egyezik', () => {
    expect(ids(filterRows(rows, { source: 'MEETINGS' }))).toEqual(['c'])
    expect(ids(filterRows(rows, { channel: 'CSATORNA A' }))).toEqual(['a', 'd'])
  })

  it('csatorna nélküli elemre a csatornaszűrő nem illik', () => {
    expect(ids(filterRows(rows, { channel: 'null' }))).toEqual([])
  })

  it('recepttel az állapot csak arra a típusra vonatkozik; a küszöb alatti is kész', () => {
    expect(ids(filterRows(rows, { recipe: 'summary', status: 'done' }))).toEqual(['a', 'd'])
    expect(ids(filterRows(rows, { recipe: 'summary', status: 'pending' }))).toEqual(['b', 'c'])
  })

  it('recept nélkül az állapot bármely típusra illik', () => {
    expect(ids(filterRows(rows, { status: 'failed' }))).toEqual(['b'])
    expect(ids(filterRows(rows, { status: 'done' }))).toEqual(['a', 'd'])
    expect(ids(filterRows(rows, { status: 'pending' }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a limit a szűrés után vág', () => {
    expect(ids(filterRows(rows, { status: 'done', limit: 1 }))).toEqual(['a'])
    expect(ids(filterRows(rows, { limit: 3 }))).toEqual(['a', 'b', 'c'])
  })
})

describe('describeFilters', () => {
  it('szűrő nélkül üres, egyébként a megadott szűrőket sorolja', () => {
    expect(describeFilters({})).toBe('')
    expect(
      describeFilters({ source: 'youtube', channel: 'X', recipe: 'clean', status: 'pending', limit: 5 }),
    ).toBe('forrás: youtube, csatorna: X, típus: clean, állapot: pending, legfeljebb 5')
  })
})

describe('kindCodes', () => {
  it('a valós típusok kódjai', () => {
    expect(
      kindCodes([
        'transcript',
        'summary',
        'flashcards',
        'qa',
        'clean',
        'bloom',
        'notes',
        'clean-hu',
        'summary-hu',
        'notes-hu',
        'bloom-hu',
      ]),
    ).toEqual({
      transcript: 'tra',
      summary: 'sum',
      flashcards: 'fla',
      qa: 'qa',
      clean: 'cle',
      bloom: 'blo',
      notes: 'not',
      'clean-hu': 'cle-hu',
      'summary-hu': 'sum-hu',
      'notes-hu': 'not-hu',
      'bloom-hu': 'blo-hu',
    })
  })

  it('ütközésnél mindkét típus a teljes azonosítót kapja', () => {
    expect(kindCodes(['summary', 'summit', 'clean'])).toEqual({
      summary: 'summary',
      summit: 'summit',
      clean: 'cle',
    })
  })

  it('a -xx utótag csak akkor fordítás, ha az alapja is szerepel', () => {
    expect(kindCodes(['cross-en'])).toEqual({ 'cross-en': 'cro' })
  })
})
```

- [ ] **2. lépés: futtasd, és lásd elbukni.**

Futtatás: `pnpm exec vitest run src/view/list.test.ts`
Várt: FAIL — `Failed to resolve import "./list.js"`.

- [ ] **3. lépés: a megvalósítás.** Hozd létre a `src/view/list.ts`-t:

```ts
import type { CellStatus, ItemListRow } from './items.js'

/** A `--status` elfogadott értékei. */
export const LIST_STATUSES: readonly CellStatus[] = ['done', 'failed', 'pending']

export interface ListFilters {
  source?: string
  channel?: string
  /** A típus, amire a `status` vonatkozik; nélküle bármely típus illik. */
  recipe?: string
  status?: CellStatus
  limit?: number
}

const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/**
 * A `list` szűrése: forrás → csatorna → állapot → limit. A forrás és a
 * csatorna a `run` szabályát követi (`matchesFilters`): pontos egyezés, kis- és
 * nagybetű nélkül; csatorna nélküli elemre a csatornaszűrő nem illik. A sorrend
 * nem változik.
 */
export function filterRows(rows: readonly ItemListRow[], filters: ListFilters): ItemListRow[] {
  const kept = rows.filter((row) => {
    if (filters.source && !same(row.source, filters.source)) return false
    if (filters.channel && (row.channel === null || !same(row.channel, filters.channel))) {
      return false
    }
    if (filters.status) {
      const cells = filters.recipe ? [row.cells[filters.recipe]] : Object.values(row.cells)
      if (!cells.some((cell) => cell?.status === filters.status)) return false
    }
    return true
  })
  return filters.limit === undefined ? kept : kept.slice(0, filters.limit)
}

/** A szűrők emberi olvasatra, a táblázat első sorához. Szűrő nélkül üres. */
export function describeFilters(filters: ListFilters): string {
  const parts: string[] = []
  if (filters.source) parts.push(`forrás: ${filters.source}`)
  if (filters.channel) parts.push(`csatorna: ${filters.channel}`)
  if (filters.recipe) parts.push(`típus: ${filters.recipe}`)
  if (filters.status) parts.push(`állapot: ${filters.status}`)
  if (filters.limit !== undefined) parts.push(`legfeljebb ${String(filters.limit)}`)
  return parts.join(', ')
}

/**
 * Rövid oszlopkód típusonként: az alaprecept első 3 karaktere, a fordítás
 * `<alapkód>-<nyelv>`. Ha két típus kódja egyezne, mindkettő a teljes azonosítót
 * kapja — a fejléc sosem lehet kétértelmű.
 */
export function kindCodes(kinds: readonly string[]): Record<string, string> {
  const known = new Set(kinds)
  const candidates = kinds.map((kind) => {
    const translation = /^(.+)-([a-z]{2})$/.exec(kind)
    if (translation && known.has(translation[1]!)) {
      return `${translation[1]!.slice(0, 3)}-${translation[2]!}`
    }
    return kind.slice(0, 3)
  })
  const codes: Record<string, string> = {}
  kinds.forEach((kind, i) => {
    const code = candidates[i]!
    codes[kind] = candidates.filter((c) => c === code).length > 1 ? kind : code
  })
  return codes
}
```

- [ ] **4. lépés: futtasd, és lásd átmenni.**

Futtatás: `pnpm exec vitest run src/view/list.test.ts`
Várt: PASS, 10 teszt.

- [ ] **5. lépés: mutációs próba.** A `filterRows`-ban írd át a
  `cells.some(` hívást `cells.every(`-re → a „recept nélkül az állapot bármely
  típusra illik" tesztnek el kell buknia. Állítsd vissza. Utána a `kindCodes`-ban
  a `> 1`-et írd `> 2`-re → az ütközéses tesztnek kell elbuknia. Állítsd vissza.

- [ ] **6. lépés: typecheck, lint.** `pnpm typecheck && pnpm lint` — tiszta.

- [ ] **7. lépés: commit.**

```bash
git add src/view/list.ts src/view/list.test.ts
git commit -m "feat(list): szűrés és oszlopkódok a list nézethez"
```

---

### Task 2: Az elemlista szöveggé alakítása

**Fájlok:**
- Módosít: `src/view/list.ts` (import sor + hozzáfűzés a fájl végére)
- Módosít: `src/view/list.test.ts` (import sor + hozzáfűzés)

**Interfészek:**
- Használja: `kindCodes` (Task 1), `ItemCell` (`src/view/items.ts`).
- Adja: `PIPE_TITLE_WIDTH = 40`, `interface ItemTableOptions { recipe?: string;
  showChannel: boolean; lineWidth?: number; filterNote: string }`,
  `renderItemTable(rows, kinds, opts): string`, valamint a Task 3 által használt
  modulon belüli segédeket: `truncate`, `Column`, `layout`, `usd`, `rowCost`,
  `codeLegend`.

- [ ] **1. lépés: a bukó teszt.** A `src/view/list.test.ts` import sorát cseréld:

```ts
import { describeFilters, filterRows, kindCodes, renderItemTable } from './list.js'
```

és fűzd a fájl végére:

```ts
describe('renderItemTable', () => {
  it('mátrix: jelek, összköltség, jelmagyarázat, szűrőmegjegyzés', () => {
    const text = renderItemTable(
      [
        row('a', {}, {
          transcript: { status: 'done' },
          summary: { status: 'done', score: 0.9, costUsd: 0.07 },
          clean: { status: 'done', belowThreshold: true, costUsd: 0.2 },
          'clean-hu': { status: 'failed' },
        }),
        row('b'),
      ],
      KINDS,
      { showChannel: false, filterNote: 'csatorna: Csatorna A' },
    )
    expect(text).toBe(
      [
        '2 elem (csatorna: Csatorna A)',
        '',
        '# Cím     tra sum cle cle-hu      $',
        '1 Videó a ✓   ✓   ↓   ✗      0.2700',
        '2 Videó b ·   ·   ·   ·           —',
        '',
        '✓ kész  ↓ küszöb alatt  ✗ hibás  · hátra  † a felirat eltűnt',
        'tra = transcript, sum = summary, cle = clean, cle-hu = clean-hu',
      ].join('\n'),
    )
  })

  it('csatornaoszlop 16 karakterre vágva, null csatorna —, eltűnt felirat †', () => {
    const text = renderItemTable(
      [
        row('a', { channel: 'Egy nagyon hosszú csatornanév' }),
        row('b', { channel: null, discovered: false }),
      ],
      KINDS,
      { showChannel: true, filterNote: '' },
    )
    const lines = text.split('\n')
    expect(lines[0]).toBe('2 elem')
    expect(lines[2]).toBe('# Cím       Csatorna         tra sum cle cle-hu $')
    expect(lines[3]).toBe('1 Videó a   Egy nagyon hoss… ·   ·   ·   ·      —')
    expect(lines[4]).toBe('2 † Videó b —                ·   ·   ·   ·      —')
  })

  it('a cím terminál nélkül 40, terminállal a maradék helyre vágódik, legalább 20-ra', () => {
    const long = row('a', { title: 'x'.repeat(100) })
    const titleOf = (lineWidth?: number) =>
      renderItemTable([long], KINDS, { showChannel: false, filterNote: '', lineWidth })
        .split('\n')[3]!
        .split(' ')[1]!
    expect(titleOf()).toHaveLength(40)
    expect(titleOf()).toMatch(/…$/)
    // A többi oszlop: '#'(1) + tra, sum, cle (3-3) + cle-hu (6) + '$'(1),
    // mindegyik után egy szóköz: 2 + 4·3 + 7 + 2 = 23; plusz egy tartalék.
    expect(titleOf(100)).toHaveLength(76)
    expect(titleOf(30)).toHaveLength(20)
  })

  it('recept nézet: állapot szövegesen, pontszám, költség; † magyarázat csak ha kell', () => {
    const text = renderItemTable(
      [
        row('a', {}, { clean: { status: 'done', score: 0.95, costUsd: 0.19 } }),
        row('b', {}, { clean: { status: 'done', score: 0.71, costUsd: 0.18, belowThreshold: true } }),
        row('c', {}, { clean: { status: 'failed' } }),
        row('d'),
      ],
      KINDS,
      { recipe: 'clean', showChannel: false, filterNote: 'típus: clean' },
    )
    expect(text).toBe(
      [
        '4 elem (típus: clean)',
        '',
        '# Cím     clean  Pont      $',
        '1 Videó a kész   0.95 0.1900',
        '2 Videó b kész ↓ 0.71 0.1800',
        '3 Videó c hibás     —      —',
        '4 Videó d hátra     —      —',
        '',
      ].join('\n'),
    )
    const gone = renderItemTable([row('a', { discovered: false })], KINDS, {
      recipe: 'clean',
      showChannel: false,
      filterNote: '',
    })
    expect(gone.split('\n').at(-1)).toBe('† a felirat eltűnt')
  })
})
```

- [ ] **2. lépés: futtasd, és lásd elbukni.**

Futtatás: `pnpm exec vitest run src/view/list.test.ts`
Várt: FAIL — `renderItemTable is not a function` (vagy a TS-import hibája).

- [ ] **3. lépés: a megvalósítás.** A `src/view/list.ts` első sorát cseréld:

```ts
import type { CellStatus, ItemCell, ItemListRow } from './items.js'
```

és fűzd a fájl végére:

```ts
/** Látható szélesség: kódpontok száma. A széles (CJK, emoji) karaktert nem kezeli. */
const widthOf = (text: string): number => [...text].length

function truncate(text: string, max: number): string {
  return widthOf(text) <= max ? text : `${[...text].slice(0, max - 1).join('')}…`
}

type Align = 'left' | 'right'

interface Column {
  header: string
  cells: string[]
  align: Align
}

function pad(text: string, width: number, align: Align): string {
  const fill = ' '.repeat(Math.max(0, width - widthOf(text)))
  return align === 'left' ? text + fill : fill + text
}

/** Oszlopok egy szóközzel elválasztva; a sorvégi szóközöket levágja. */
function layout(columns: readonly Column[]): string[] {
  const widths = columns.map((c) => Math.max(widthOf(c.header), ...c.cells.map(widthOf)))
  const rowCount = columns[0]?.cells.length ?? 0
  const line = (pick: (c: Column) => string): string =>
    columns
      .map((c, i) => pad(pick(c), widths[i]!, c.align))
      .join(' ')
      .trimEnd()
  const lines = [line((c) => c.header)]
  for (let r = 0; r < rowCount; r++) lines.push(line((c) => c.cells[r]!))
  return lines
}

const usd = (value: number): string => value.toFixed(4)

function mark(cell: ItemCell | undefined): string {
  if (cell?.status === 'failed') return '✗'
  if (cell?.status === 'done') return cell.belowThreshold ? '↓' : '✓'
  return '·'
}

function statusText(cell: ItemCell | undefined): string {
  if (cell?.status === 'failed') return 'hibás'
  if (cell?.status === 'done') return cell.belowThreshold ? 'kész ↓' : 'kész'
  return 'hátra'
}

/** Az elem összköltsége; `null`, ha egyik cellájának sincs költsége. */
function rowCost(row: ItemListRow): number | null {
  const costs = Object.values(row.cells)
    .map((cell) => cell.costUsd)
    .filter((cost): cost is number => cost !== null)
  return costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0)
}

function codeLegend(kinds: readonly string[]): string | null {
  const codes = kindCodes(kinds)
  const pairs = kinds.filter((k) => codes[k] !== k).map((k) => `${codes[k]!} = ${k}`)
  return pairs.length === 0 ? null : pairs.join(', ')
}

const CHANNEL_WIDTH = 16
/** A cím szélessége, ha nincs terminál (csővezeték, fájl). */
export const PIPE_TITLE_WIDTH = 40
const MIN_TITLE_WIDTH = 20
const LEGEND = '✓ kész  ↓ küszöb alatt  ✗ hibás  · hátra  † a felirat eltűnt'

export interface ItemTableOptions {
  /** Ha meg van adva, a jeloszlopok helyett ennek a típusnak a részletei. */
  recipe?: string
  showChannel: boolean
  /** A terminál szélessége; `undefined`, ha nincs terminál. */
  lineWidth?: number
  /** A `describeFilters` kimenete. */
  filterNote: string
}

/** Az elemlista: első sor, táblázat, jelmagyarázat. Legalább egy sort vár. */
export function renderItemTable(
  rows: readonly ItemListRow[],
  kinds: readonly string[],
  opts: ItemTableOptions,
): string {
  const columns: Column[] = [
    { header: '#', cells: rows.map((_, i) => String(i + 1)), align: 'right' },
  ]
  if (opts.showChannel) {
    columns.push({
      header: 'Csatorna',
      cells: rows.map((row) => (row.channel === null ? '—' : truncate(row.channel, CHANNEL_WIDTH))),
      align: 'left',
    })
  }
  if (opts.recipe !== undefined) {
    const recipe = opts.recipe
    columns.push(
      { header: recipe, cells: rows.map((row) => statusText(row.cells[recipe])), align: 'left' },
      {
        header: 'Pont',
        cells: rows.map((row) => row.cells[recipe]?.score?.toFixed(2) ?? '—'),
        align: 'right',
      },
      {
        header: '$',
        cells: rows.map((row) => {
          const cost = row.cells[recipe]?.costUsd ?? null
          return cost === null ? '—' : usd(cost)
        }),
        align: 'right',
      },
    )
  } else {
    const codes = kindCodes(kinds)
    for (const kind of kinds) {
      columns.push({ header: codes[kind]!, cells: rows.map((row) => mark(row.cells[kind])), align: 'left' })
    }
    columns.push({
      header: '$',
      cells: rows.map((row) => {
        const cost = rowCost(row)
        return cost === null ? '—' : usd(cost)
      }),
      align: 'right',
    })
  }

  // A cím a második oszlop; a szélessége a többi oszlop után megmaradó hely,
  // egy karakter tartalékkal, hogy a sor a terminál szélén se törjön.
  const others = columns.reduce(
    (sum, c) => sum + Math.max(widthOf(c.header), ...c.cells.map(widthOf)) + 1,
    0,
  )
  const titleWidth =
    opts.lineWidth === undefined
      ? PIPE_TITLE_WIDTH
      : Math.max(MIN_TITLE_WIDTH, opts.lineWidth - others - 1)
  columns.splice(1, 0, {
    header: 'Cím',
    cells: rows.map((row) => truncate(row.discovered ? row.title : `† ${row.title}`, titleWidth)),
    align: 'left',
  })

  const head = `${String(rows.length)} elem${opts.filterNote ? ` (${opts.filterNote})` : ''}`
  const lines = [head, '', ...layout(columns), '']
  if (opts.recipe === undefined) {
    lines.push(LEGEND)
    const legend = codeLegend(kinds)
    if (legend !== null) lines.push(legend)
  } else if (rows.some((row) => !row.discovered)) {
    lines.push('† a felirat eltűnt')
  }
  return lines.join('\n')
}
```

- [ ] **4. lépés: futtasd, és lásd átmenni.**

Futtatás: `pnpm exec vitest run src/view/list.test.ts`
Várt: PASS, 14 teszt.

- [ ] **5. lépés: mutációs próba.** A `mark`-ban a `'↓'`-t írd `'✓'`-ra → a
  mátrixteszt bukik. A `titleWidth` számításában hagyd el a `- 1`-et → a
  címszélesség-teszt (76) bukik. Mindkettőt állítsd vissza.

- [ ] **6. lépés: typecheck, lint.** `pnpm typecheck && pnpm lint` — tiszta.

- [ ] **7. lépés: commit.**

```bash
git add src/view/list.ts src/view/list.test.ts
git commit -m "feat(list): elemlista jelekkel és recept-nézettel"
```

---

### Task 3: A csatorna-összesítő

**Fájlok:**
- Módosít: `src/view/items.ts:43` (`byText` export)
- Módosít: `src/view/list.ts` (import sor + hozzáfűzés)
- Módosít: `src/view/list.test.ts` (import sor + hozzáfűzés)

**Interfészek:**
- Használja: `byText` (`src/view/items.ts`), `truncate`, `Column`, `layout`,
  `usd`, `rowCost`, `codeLegend`, `kindCodes` (Task 1–2).
- Adja: `interface ChannelSummary { channel: string | null; videos: number;
  done: Record<string, number>; costUsd: number | null }`,
  `summarizeChannels(rows, kinds): ChannelSummary[]`,
  `renderChannelTable(summaries, kinds, filterNote): string`.

- [ ] **1. lépés: a bukó teszt.** A `src/view/list.test.ts` import blokkját
  cseréld:

```ts
import {
  describeFilters,
  filterRows,
  kindCodes,
  renderChannelTable,
  renderItemTable,
  summarizeChannels,
} from './list.js'
```

és fűzd a fájl végére:

```ts
describe('summarizeChannels és renderChannelTable', () => {
  const rows = [
    row('a', { channel: 'Zeta' }, { summary: { status: 'done', costUsd: 0.1 } }),
    row('b', { channel: null }),
    row('c', { channel: 'Alfa' }, {
      summary: { status: 'done', belowThreshold: true, costUsd: 0.05 },
      clean: { status: 'failed' },
    }),
    row('d', { channel: 'Zeta' }, { transcript: { status: 'done' } }),
  ]

  it('csoportosít, név szerint rendez, a csatorna nélküli csoport a végén', () => {
    const summaries = summarizeChannels(rows, KINDS)
    expect(summaries.map((s) => [s.channel, s.videos, s.done.summary, s.done.transcript])).toEqual([
      ['Alfa', 1, 1, 0],
      ['Zeta', 2, 1, 1],
      [null, 1, 0, 0],
    ])
    expect(summaries[0]!.costUsd).toBeCloseTo(0.05)
    expect(summaries[2]!.costUsd).toBeNull()
  })

  it('a csatornanév 24 karakterre vágódik', () => {
    const text = renderChannelTable(
      summarizeChannels([row('a', { channel: 'Egy Kertész Kertje Pilisszentkereszten' })], KINDS),
      KINDS,
      '',
    )
    expect(text.split('\n')[3]).toMatch(/^Egy Kertész Kertje Pili… +1 /)
  })

  it('a táblázat típusonként kész/összes, Összesen sorral', () => {
    const text = renderChannelTable(summarizeChannels(rows, KINDS), KINDS, '')
    expect(text).toBe(
      [
        '3 csatorna',
        '',
        'Csatorna         Videó tra sum cle cle-hu      $',
        'Alfa                 1 0/1 1/1 0/1    0/1 0.0500',
        'Zeta                 2 1/2 1/2 0/2    0/2 0.1000',
        '(nincs csatorna)     1 0/1 0/1 0/1    0/1      —',
        'Összesen             4 1/4 2/4 0/4    0/4 0.1500',
        '',
        'tra = transcript, sum = summary, cle = clean, cle-hu = clean-hu',
      ].join('\n'),
    )
  })
})
```

- [ ] **2. lépés: futtasd, és lásd elbukni.**

Futtatás: `pnpm exec vitest run src/view/list.test.ts`
Várt: FAIL — `summarizeChannels is not a function`.

- [ ] **3. lépés: a `byText` exportja.** A `src/view/items.ts`-ben:

```ts
export const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
```

(Csak az `export` kulcsszó új; a `buildItemRows` változatlanul használja.)

- [ ] **4. lépés: a megvalósítás.** A `src/view/list.ts` első sorát cseréld:

```ts
import { byText, type CellStatus, type ItemCell, type ItemListRow } from './items.js'
```

a `const CHANNEL_WIDTH = 16` sor után szúrd be:

```ts
/** Az összesítőben több hely jut a névnek: ott ez az egyetlen szöveges oszlop. */
const SUMMARY_CHANNEL_WIDTH = 24
```

és fűzd a fájl végére:

```ts
export interface ChannelSummary {
  /** `null`: a csatorna nélküli elemek csoportja. */
  channel: string | null
  videos: number
  /** Típusonként a kész (`done`, a küszöb alattiakkal együtt) elemek száma. */
  done: Record<string, number>
  /** A csoport összköltsége; `null`, ha egyik cellának sincs költsége. */
  costUsd: number | null
}

const addCost = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b

/**
 * Csatornánkénti összesítés a már szűrt sorokból: név szerint (`byText`), a
 * csatorna nélküli csoport a végén.
 */
export function summarizeChannels(
  rows: readonly ItemListRow[],
  kinds: readonly string[],
): ChannelSummary[] {
  const groups = new Map<string | null, ChannelSummary>()
  for (const row of rows) {
    let group = groups.get(row.channel)
    if (!group) {
      group = {
        channel: row.channel,
        videos: 0,
        done: Object.fromEntries(kinds.map((k) => [k, 0])),
        costUsd: null,
      }
      groups.set(row.channel, group)
    }
    group.videos++
    for (const kind of kinds) {
      if (row.cells[kind]?.status === 'done') group.done[kind]!++
    }
    group.costUsd = addCost(group.costUsd, rowCost(row))
  }
  return [...groups.values()].sort((a, b) =>
    a.channel === null ? 1 : b.channel === null ? -1 : byText(a.channel, b.channel),
  )
}

/** A csatorna-összesítő: első sor, táblázat `Összesen` sorral, kódmagyarázat. */
export function renderChannelTable(
  summaries: readonly ChannelSummary[],
  kinds: readonly string[],
  filterNote: string,
): string {
  const total: ChannelSummary = {
    channel: 'Összesen',
    videos: summaries.reduce((sum, s) => sum + s.videos, 0),
    done: Object.fromEntries(
      kinds.map((k) => [k, summaries.reduce((sum, s) => sum + (s.done[k] ?? 0), 0)]),
    ),
    costUsd: summaries.reduce<number | null>((sum, s) => addCost(sum, s.costUsd), null),
  }
  const all = [...summaries, total]
  const codes = kindCodes(kinds)
  const columns: Column[] = [
    {
      header: 'Csatorna',
      cells: all.map((s) => truncate(s.channel ?? '(nincs csatorna)', SUMMARY_CHANNEL_WIDTH)),
      align: 'left',
    },
    { header: 'Videó', cells: all.map((s) => String(s.videos)), align: 'right' },
    ...kinds.map(
      (kind): Column => ({
        header: codes[kind]!,
        cells: all.map((s) => `${String(s.done[kind] ?? 0)}/${String(s.videos)}`),
        align: 'right',
      }),
    ),
    {
      header: '$',
      cells: all.map((s) => (s.costUsd === null ? '—' : usd(s.costUsd))),
      align: 'right',
    },
  ]
  const head = `${String(summaries.length)} csatorna${filterNote ? ` (${filterNote})` : ''}`
  const lines = [head, '', ...layout(columns)]
  const legend = codeLegend(kinds)
  if (legend !== null) lines.push('', legend)
  return lines.join('\n')
}
```

- [ ] **5. lépés: futtasd, és lásd átmenni.**

Futtatás: `pnpm exec vitest run src/view/list.test.ts src/view/items.test.ts`
Várt: PASS, a `list.test.ts` 17 tesztje és az `items.test.ts` változatlanul.

- [ ] **6. lépés: mutációs próba.** A `summarizeChannels` rendezésében cseréld
  fel az `1`-et és a `-1`-et → a „csatorna nélküli csoport a végén" teszt bukik.
  A `SUMMARY_CHANNEL_WIDTH`-et írd 30-ra → a vágásteszt bukik. Állítsd vissza.

- [ ] **7. lépés: typecheck, lint.** `pnpm typecheck && pnpm lint` — tiszta.

- [ ] **8. lépés: commit.**

```bash
git add src/view/items.ts src/view/list.ts src/view/list.test.ts
git commit -m "feat(list): csatornánkénti összesítő kész/összes lefedettséggel"
```

---

### Task 4: A parancs — `commandList` és a `main`

**Fájlok:**
- Módosít: `src/cli.ts` (importok, `USAGE`, új `commandList`, `main`)
- Módosít: `src/cli.test.ts` (importok + új `describe` a fájl végén)

**Interfészek:**
- Használja: `readItems` és `CellStatus` (`src/view/items.ts`),
  `artifactKinds` (`src/view/overview.ts`), `recipesFor` (már importálva),
  a Task 1–3 exportjai.
- Adja: `interface ListOptions`, `commandList(cfg: Config, opts: ListOptions): Promise<number>`.

- [ ] **1. lépés: a bukó teszt.** A `src/cli.test.ts`-ben:

  - az első `node:fs/promises` importba vedd fel a `stat`-ot:

```ts
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
```

  - a `./cli.js` importot cseréld:

```ts
import {
  commandCheckPricing,
  commandList,
  commandRun,
  commandScan,
  commandScanQueue,
  main,
  USAGE,
} from './cli.js'
```

  - a `./source/folder.js` importot cseréld:

```ts
import { discoverAll, folderSource } from './source/folder.js'
```

  - és fűzd a fájl végére:

```ts

describe('commandList', () => {
  let logs: string[]
  let errors: string[]

  beforeEach(() => {
    logs = []
    errors = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Két videó; az elsőn kész summary, a másodikon hibás clean. */
  async function ketVideoAllapottal() {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'b1', 'Második videó', 'Csatorna B')
    const cfg = loadConfig(rawConfig(5), '/p/refinery.config.yaml')
    const items = await discoverAll(cfg.sources, cfg.languages)
    const idOf = (title: string) => items.find((i) => i.title === title)!.itemId
    const store = openState(cfg.statePath)
    try {
      for (const item of items) store.recordItem(item)
      store.recordArtifact(idOf('Első videó'), 'summary', 'done', '/v/a.md', null, {
        iterations: 1,
        score: 0.9,
        costUsd: 0.08,
        model: 'proba-draft',
      })
      store.recordArtifact(idOf('Második videó'), 'clean', 'failed', null, 'szimulált hiba')
    } finally {
      store.close()
    }
    return cfg
  }

  it('állapottár nélkül minden cella hátra, és nem jön létre állapotfájl', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawConfig(5), '/p/refinery.config.yaml')

    expect(await commandList(cfg, { channels: false })).toBe(0)

    expect(existsSync(cfg.statePath)).toBe(false)
    const lines = logs.join('\n').split('\n')
    expect(lines[0]).toBe('1 elem')
    expect(lines[3]).toMatch(/^1 Első videó +Csatorna A /)
    expect(lines[3]).not.toMatch(/[✓↓✗]/)
  })

  it('a --recipe --status pending pontosan azokat adja, amelyeken a típus még nem futott', async () => {
    const cfg = await ketVideoAllapottal()

    expect(await commandList(cfg, { channels: false, recipe: 'summary', status: 'pending' })).toBe(0)

    const out = logs.join('\n')
    expect(out).toContain('1 elem (típus: summary, állapot: pending)')
    expect(out).toContain('Második videó')
    expect(out).not.toContain('Első videó')
  })

  it('a --status failed --recipe nélkül bármely típus hibájára illik', async () => {
    const cfg = await ketVideoAllapottal()

    expect(await commandList(cfg, { channels: false, status: 'failed' })).toBe(0)

    const out = logs.join('\n')
    expect(out).toContain('Második videó')
    expect(out).not.toContain('Első videó')
  })

  it('a --channel kis- és nagybetű nélkül szűr, és elrejti a csatornaoszlopot', async () => {
    const cfg = await ketVideoAllapottal()

    expect(await commandList(cfg, { channels: false, channel: 'csatorna a' })).toBe(0)

    const lines = logs.join('\n').split('\n')
    expect(lines[0]).toBe('1 elem (csatorna: csatorna a)')
    expect(lines[2]).not.toContain('Csatorna')
    expect(lines[3]).toMatch(/^1 Első videó +· +✓ /)
  })

  it('a --channels csatornánként összesít, Összesen sorral', async () => {
    const cfg = await ketVideoAllapottal()

    expect(await commandList(cfg, { channels: true })).toBe(0)

    const lines = logs.join('\n').split('\n')
    expect(lines[0]).toBe('2 csatorna')
    expect(lines[3]).toMatch(/^Csatorna A +1 0\/1 1\/1 /)
    expect(lines[5]).toMatch(/^Összesen +2 0\/2 1\/2 .* 0\.0800$/)
  })

  it('a futás után az állapotfájl bájtra és időbélyegre változatlan', async () => {
    const cfg = await ketVideoAllapottal()
    const elotte = await readFile(cfg.statePath)
    const { mtimeMs } = await stat(cfg.statePath)

    expect(await commandList(cfg, { channels: false })).toBe(0)
    expect(await commandList(cfg, { channels: true })).toBe(0)

    expect((await readFile(cfg.statePath)).equals(elotte)).toBe(true)
    expect((await stat(cfg.statePath)).mtimeMs).toBe(mtimeMs)
  })

  it('üres eredménynél megnevezi, és 0-val tér vissza', async () => {
    const cfg = await ketVideoAllapottal()

    expect(await commandList(cfg, { channels: false, channel: 'Nincsilyen' })).toBe(0)
    expect(logs).toEqual(['Nincs a szűrőnek megfelelő elem.'])
  })

  it.each([
    [{ recipe: 'nincsilyen' }, /^Ismeretlen típus: nincsilyen\. Ismert típusok: transcript, summary, /],
    [{ status: 'kesz' }, /^A --status értéke done, failed vagy pending lehet\.$/],
    [{ recipe: 'summary', channels: true }, /^A --channels minden típust mutat/],
    [{ limit: 0 }, /^A --limit pozitív egész szám\.$/],
    [{ limit: Number.NaN }, /^A --limit pozitív egész szám\.$/],
  ])('hibás kapcsoló (%o) → 1-es kód, megnevezett üzenet', async (opts, message) => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawConfig(5), '/p/refinery.config.yaml')

    expect(await commandList(cfg, { channels: false, ...opts })).toBe(1)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(message)
    expect(logs).toEqual([])
  })

  it('a USAGE felsorolja a list parancsot és az új kapcsolókat', () => {
    expect(USAGE).toContain('  list ')
    expect(USAGE).toContain('--status <érték>')
    expect(USAGE).toContain('--channels')
  })
})
```

- [ ] **2. lépés: futtasd, és lásd elbukni.**

Futtatás: `pnpm exec vitest run src/cli.test.ts -t commandList`
Várt: FAIL — `commandList is not a function` (a `USAGE`-teszt is bukik).

- [ ] **3. lépés: az importok.** A `src/cli.ts`-ben a
  `import { noteFile } from './vault/paths.js'` sor után:

```ts
import { readItems, type CellStatus } from './view/items.js'
import {
  LIST_STATUSES,
  describeFilters,
  filterRows,
  renderChannelTable,
  renderItemTable,
  summarizeChannels,
} from './view/list.js'
import { artifactKinds } from './view/overview.js'
```

- [ ] **4. lépés: a `USAGE`.** A `Parancsok:` blokkban a `check-pricing` sor
  után:

```
  list            Kilistázza az elemeket típusonkénti állapottal; nem ír semmit.
```

  a `Kapcsolók:` blokkban a `--no-judge` bejegyzés után, a `--fix` elé:

```
  --status <érték>  list: done, failed vagy pending; --recipe nélkül
                    bármely típusra illik
  --channels        list: csatornánkénti összesítő
```

- [ ] **5. lépés: a `commandList`.** A `commandScanQueue` függvény után, a
  `commandCheckPricing` doc-kommentje elé:

```ts
export interface ListOptions {
  source?: string
  channel?: string
  recipe?: string
  status?: string
  channels: boolean
  limit?: number
  /** A terminál szélessége; `undefined`, ha a kimenet nem terminálba megy. */
  lineWidth?: number
}

/**
 * Az elemek listája receptenkénti állapottal, vagy (`--channels`) csatornánkénti
 * összesítő. Csak olvas: az állapottárat írásvédett kapcsolaton nyitja, és ha
 * nincs, nem hozza létre.
 */
export async function commandList(cfg: Config, opts: ListOptions): Promise<number> {
  const kinds = artifactKinds(recipesFor(cfg))
  if (opts.status !== undefined && !LIST_STATUSES.includes(opts.status as CellStatus)) {
    console.error('A --status értéke done, failed vagy pending lehet.')
    return 1
  }
  if (opts.recipe !== undefined && !kinds.includes(opts.recipe)) {
    console.error(`Ismeretlen típus: ${opts.recipe}. Ismert típusok: ${kinds.join(', ')}`)
    return 1
  }
  if (opts.recipe !== undefined && opts.channels) {
    console.error('A --channels minden típust mutat; a --recipe mellette nem használható.')
    return 1
  }
  if (opts.limit !== undefined && !(Number.isInteger(opts.limit) && opts.limit > 0)) {
    console.error('A --limit pozitív egész szám.')
    return 1
  }

  const filters = {
    source: opts.source,
    channel: opts.channel,
    recipe: opts.recipe,
    status: opts.status as CellStatus | undefined,
    // Az összesítő a teljes szűrt halmazt számolja: ott a limit nem érvényes.
    limit: opts.channels ? undefined : opts.limit,
  }
  const rows = filterRows(await readItems(cfg), filters)
  if (rows.length === 0) {
    console.log('Nincs a szűrőnek megfelelő elem.')
    return 0
  }
  const note = describeFilters(filters)
  console.log(
    opts.channels
      ? renderChannelTable(summarizeChannels(rows, kinds), kinds, note)
      : renderItemTable(rows, kinds, {
          recipe: opts.recipe,
          showChannel: !opts.channel,
          lineWidth: opts.lineWidth,
          filterNote: note,
        }),
  )
  return 0
}
```

- [ ] **6. lépés: a `main`.** A `parseArgs` `options`-ében a `fix` után:

```ts
      status: { type: 'string' },
      channels: { type: 'boolean', default: false },
```

  és a `check-pricing` ág után, a `run` ág elé:

```ts
  if (command === 'list') {
    return commandList(cfg, {
      source: values.source,
      channel: values.channel,
      recipe: values.recipe,
      status: values.status,
      channels: values.channels,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      lineWidth: process.stdout.isTTY ? process.stdout.columns : undefined,
    })
  }
```

- [ ] **7. lépés: futtasd, és lásd átmenni.**

Futtatás: `pnpm exec vitest run src/cli.test.ts -t commandList`
Várt: PASS, 13 teszt.

- [ ] **8. lépés: mutációs próba.** A `commandList`-ben a
  `showChannel: !opts.channel`-t írd `true`-ra → a `--channel` teszt bukik.
  Állítsd vissza. Utána töröld a `--limit` ellenőrzését (a négysoros `if`-et) →
  a `limit: 0` és a `limit: NaN` eset bukik. Állítsd vissza.

- [ ] **9. lépés: a teljes ellenőrzés.**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint && pnpm web:test`
Várt: minden zöld; a `pnpm test` 998 teszt.

- [ ] **10. lépés: commit.**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat(cli): refinery list parancs"
```

---

### Task 5: Dokumentáció, spec-átvezetés és élő ellenőrzés

**Fájlok:**
- Módosít: `README.md` (a `#### Árazás ellenőrzése (check-pricing)` szakasz elé)
- Módosít: `docs/architecture.md` (a 6. fejezet `openStateReader` bekezdése után)
- Módosít: `docs/plans/2026-09-24-refinery-list-spec.md`

- [ ] **1. lépés: README.** A `#### Árazás ellenőrzése (\`check-pricing\`)`
  sor elé szúrd be:

````markdown
#### Katalógus (`list`)

Terminálos áttekintés a felderített elemekről, típusonkénti állapottal —
csak olvas, modellt nem hív, `LITELLM_API_KEY` nélkül is fut. A jelek:
`✓` kész, `↓` kész, de a recept küszöbe alatt, `✗` hibás, `·` hátra.

```bash
# egy csatorna videói, típusonként egy oszloppal
node dist/cli.js list --channel "Sajjaad Khader"

# csatornánként: videószám, típusonként kész/összes, összköltség
node dist/cli.js list --channels

# amin a clean még nem futott — ezeket érdemes kipipálni a sorban
node dist/cli.js list --recipe clean --status pending
```

A `--status` (`done`, `failed`, `pending`) `--recipe` nélkül bármely típusra
illik: a `list --status failed` minden elemet mutat, amin legalább egy
típus hibára futott. A `--source`, a `--channel` és a `--limit` ugyanúgy
szűr, mint a `run`-nál. A számok ugyanabból az olvasó rétegből jönnek, mint
a webes felületéi.

````

- [ ] **2. lépés: architecture.md.** A 6. fejezetben a
  „…ezért mutatja pontosan azt a korpusz-állapotot, amit a futás riportja."
  bekezdés után új bekezdés:

```markdown
A CLI `list` parancsa ugyanezt az olvasó réteget használja (`readItems()`):
a terminálos lista és a felület elemlistája ugyanarra az állapotra
ugyanazt mutatja.
```

- [ ] **3. lépés: a spec átvezetése.** A `docs/plans/2026-09-24-refinery-list-spec.md`-ben:
  - a `### A csatorna-összesítő` interfészében `costUsd: number` →
    `costUsd: number | null` és egy sor a doc-kommentbe:
    `/** A csoport összköltsége; \`null\`, ha egyik cellának sincs költsége. */`;
  - ugyanott az oszlopok felsorolásában: `Csatorna` (legfeljebb 24 karakter,
    a vágott név végén `…`);
  - ugyanott egy pont: az első sor `<N> csatorna`, szűrő esetén zárójelben a
    szűrőmegjegyzés;
  - a `### A címszélesség` szakaszban: a `commandList` a `lineWidth`-et
    (TTY-n `process.stdout.columns`, egyébként `undefined`) adja át, és a
    `renderItemTable` számolja ki belőle a címszélességet;
  - a `renderItemTable` szignatúrájában a `titleWidth: number` helyett
    `lineWidth?: number`.

- [ ] **4. lépés: build.** `pnpm build` — tiszta.

- [ ] **5. lépés: élő ellenőrzés (csak olvas).** A repó gyökeréből, a valós
  konfiggal:

```bash
B=$(md5 -q .state/refinery.db)
node dist/cli.js list --channels | tail -3
node dist/cli.js scan | head -1
node dist/cli.js list | grep -c ' † ' || true
sqlite3 -readonly .state/refinery.db \
  "SELECT COUNT(*) FROM artifacts WHERE kind='summary' AND status='done'"
node dist/cli.js list --channel "sajjaad khader"
node dist/cli.js list --recipe clean --status pending --limit 3 | cat
node dist/cli.js list --status failed | head -5
node dist/cli.js list --recipe nincsilyen; echo "kód: $?"
[ "$B" = "$(md5 -q .state/refinery.db)" ] && echo "állapotfájl változatlan"
git -C "<a refinery.config.yaml vault.path értéke>" status --short
```

Várt:
- az `Összesen` sor `sum` oszlopának számlálója egyenlő az `sqlite3` számával;
- az `Összesen` sor `Videó` értéke egyenlő a `scan` első sorának számával és a
  `†` jelű sorok számának összegével;
- a `--channel "sajjaad khader"` csak ennek a csatornának a videóit mutatja,
  csatornaoszlop nélkül;
- a csővezetékes kimenet címei legfeljebb 40 karakteresek;
- a `--status failed` minden sorában van `✗`;
- a `nincsilyen` 1-es kóddal és az ismert típusok felsorolásával áll le;
- „állapotfájl változatlan", és a vault `git status` üres.

(A felhasználó közben futtathat: ha a két szám eltér, futtasd újra egymás
után a két parancsot.)

- [ ] **6. lépés: commit.**

```bash
git add README.md docs/architecture.md docs/plans/2026-09-24-refinery-list-spec.md
git commit -m "docs: a list parancs leírása és a spec átvezetése"
```

- [ ] **7. lépés: PR.** Push a `feat/refinery-list` ágra, PR a `main`-re
  `Closes #67`-tel; a merge előtt `gh pr checks` zöld. Utána a záró,
  teljes ágra szóló review Opuson.
