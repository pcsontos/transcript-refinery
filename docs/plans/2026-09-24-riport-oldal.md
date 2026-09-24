# A webes riportoldal (`/reports`) — implementációs terv

> **Ágenseknek:** KÖTELEZŐ al-skill: `superpowers:executing-plans` (ennél a
> felhasználónál alapértelmezés: a munkamenet maga hajtja végre a lépéseket,
> alügynök-dispatch nélkül, Sonneten). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** új, csak olvasó `/reports` oldal a Nuxt-felületen: KPI-sor, költés
futásonként, költség csatornánként receptre bontva, minőség csatornánként,
csatorna-katalógus vágólapra másolható `refinery run` paranccsal, toplisták.

**Felépítés:** egy új, tiszta nézetmodul a magban (`src/view/reports.ts`) a
meglévő `buildItemRows()` és `readRuns()` fölött számol mindent; a `web/`
egy egysoros API-útvonalon kapja, és csak kirajzolja. A két grafikon
`@unovis/vue`-val, kliensoldalon (`.client.vue` + `ClientOnly`) rajzol; minden
grafikon alatt ugyanazok a számok táblázatban.

**Technológia:** TypeScript (Node ≥ 26.2, ESM), Vitest, Nuxt 4.5 + Nuxt UI
4.11, `@unovis/vue` + `@unovis/ts` 1.7.0 (új, csak a `web/`-ben).

**Spec:** [`docs/plans/2026-09-24-riport-oldal-spec.md`](<./2026-09-24-riport-oldal-spec.md>)
— a végrehajtó mindkettőt olvassa. Issue: #74.

**Ellenőrzöttség:** a terv teljes kódját egy eldobható worktree-n a
`c8c072c` állapoton (a `main` `6b6dd49` + a spec) lefuttattuk:

- `pnpm test` 1019 zöld (a meglévő 998 + 21 új), `pnpm typecheck`,
  `pnpm lint`, `pnpm web:typecheck`, `pnpm web:lint` tiszta, `pnpm web:test`
  21 zöld (a meglévő 18 + 3 új);
- négy mutáció (a fordítás az alapreceptbe olvad; a `NULL` költség nullaként
  számít; csatorna nélküli csoport parancsot kap; az `/items` nem veszi át a
  `status` paramétert) mind bukó tesztet adott;
- a valós konfiggal az `/api/reports` `spentUsd`-je ($6.9200) egyezett a
  futásnaplók `item:refined` `usd`-összegével (`jq`), a `vaultCostUsd`
  ($5.9997) a `SELECT sum(cost_usd) … WHERE kind NOT IN ('transcript','–')`
  értékével;
- a production build headless Chrome-os képernyőképén világos és sötét
  módban mindkét grafikon helyesen kirajzolódott (a próba közben négy
  vizuális hibát javítottunk — ezek már a terv kódjában vannak, lásd
  „Eltérés a spectől");
- böngészőben, a Claude-in-Chrome bővítménnyel (`http://localhost:4311`; a
  `127.0.0.1` alakot a bővítmény nem kezeli) interaktívan is: a futásoszlop
  tooltipje és kattintása, a csatornasáv tooltipje, a 📋 másolás (a
  vágólapon, `pbpaste`-tel ellenőrizve, a pontos parancs) és a katalógus
  cellalinkje (`/items?channel=Sajjaad+Khader&kind=summary` → „3 / 166 elem").
  Közben egy hibát fogtunk, amit sem a teszt, sem a headless kép nem mutatott:
  a `StackedBar` szelete becsomagolva kapja az adatot (`{ datum, stackIndex, … }`),
  a tooltip ezért üres volt — a terv kódja már a javított változat.

## Globális megkötések

- Új függőség csak a `web/package.json`-ban: `@unovis/ts` és `@unovis/vue`,
  `^1.7.0`. A gyökér-csomag nem kap új függőséget.
- Az állapottár sémája, a `src/state/` és a `buildItemRows()` viselkedése nem
  változik. A `src/view/list.ts` két exportot kap (`translationBase`,
  `rowCost`); a `refinery list` kimenete bájtra ugyanaz marad.
- A felület csak olvas (`0011`): futást nem indít, a parancsot csak a
  vágólapra teszi.
- A kliens a `transcript-refinery` csomagból **csak típust** importál
  (`import type`) — a mag futásidejű kódja Node-modulokat húzna a
  böngészőbe. Ezért a `web/app/utils/reports.ts` a `fordítás` szöveget maga
  is rögzíti.
- A parancs alakja: `refinery run --recipe <típus> --channel '<név>'`
  (POSIX-idézőjelezés).
- A kódkommentek és a tesztleírások magyarul, a környező kód stílusában.
- Munkaág: `feat/riport-oldal`, a spec+terv PR merge-e utáni friss `main`-ről.
  Commit a `commit-message` skill formátumában; a kód-PR törzsében
  `Closes #74`.

## Review-fókusz

Azok a bemenetek, amelyekről a spec hallgat, de egy felhasználót a
legvalószínűbben megharapnának — mindegyikre van teszt vagy ellenőrzés a
gazda-taskban:

1. **Aposztrófos csatornanév** (`Dev's Corner`) — a másolt parancs a shellben
   betű szerint ugyanazt a nevet adja át (Task 1, `shellQuote`, `runCommandFor`).
2. **Még semmit nem futtatott csatorna** — a költség cellája `–`, nem
   „nincs adat" és nem `$0.0000`; a `costUsd` `null` (Task 1 teszt, Task 3
   sablon). A valós korpuszban 9 ilyen csatorna van.
3. **Futó futás, illetve csak átiratot készítő ($0) futás** — a futó a
   grafikonon szerepel, a $0-s nem, de a KPI mindkettőt összeadja (Task 1).
4. **Ismeretlen vagy elgépelt URL-paraméter az `/items`-en** — az
   alapértelmezés marad, nem üres lista (Task 2 e2e).
5. **Sok csatorna, hosszú név, sötét mód** — 27 csatorna, a tengelyfelirat 24
   karakterre vágva, a rács és a szöveg a Nuxt UI tokenjeiből (Task 3
   képernyőkép, Task 4 élő ellenőrzés).

## Eltérés a spectől (a Task 4 a specbe is átvezeti)

- **Nyelv:** a spec az állapottár `items.language`-ét írta; a terv a
  felderítés nyelvkódját veszi elsőként (a `ReportsInput` ezért
  `discovered`-et is kap), és csak hiányában az állapottárét. Ok: a 27
  csatornából 8-nak nincs állapottári sora, a nyelv oszlopa különben `–`
  lenne.
- **A becslés színe:** a spec ugyanannak a kéknek világosabb lépését írta; a
  próbán sötét módban a két kék megkülönböztethetetlen volt. A becslés
  semleges szürke (`#a3a3a3` / `#737373`): a hangsúly a tényleges költésen
  van, a becslés kontextus (dataviz: „emphasis").
- **Az unovis témája:** a `--vis-*` változók `:root:root` szelektorral
  kapják a Nuxt UI tokenjeit — az unovis a saját alapértékeit a mieink után
  injektálja a `:root`-ra, és a sima `:root` alulmaradt (világító rácsvonalak).
- **A csatornasáv sorrendje:** vízszintes elrendezésben az unovis az első
  adatot alulra teszi; a komponens megfordítja, hogy a legdrágább csatorna
  legyen felül.
- **A „nincs adat" felirat:** a katalógus költségcellája `null` esetén `–`.
  A „nincs adat" félrevezető volt a még semmit nem futtatott csatornáknál; a
  rögzítetlen költségű kész műterméket a KPI `missingCost` sora jelzi.
- **Tény-javítás:** a spec szerint a 3 `flashcards` műtermék `NULL` költségű
  kész rekord. A valóságban ezek (a `bloom`, `clean`, `notes` 2–3 rekordjával
  együtt) **hibás** (`failed`) rekordok; kész, költség nélküli fizetős
  műtermék jelenleg nincs (`missingCost` 0).
- **Új exportok:** `TOP_LIMIT`, `CoverageCell`, és a `readReports` második,
  opcionális `isAlive` paramétere (a `readOverview` mintájára, teszthez).
- **Új segédfüggvény a felületen:** `escapeHtml` (`web/app/utils/format.ts`):
  a tooltip HTML-szöveget kap, a parancssor és a csatornanév nem lehet
  jelölés.

## Fájlszerkezet

| fájl | szerep |
|---|---|
| `src/view/reports.ts` (új) | a riport nézetmodellje: `buildReports`, `readReports`, `shellQuote`, `runCommandFor` |
| `src/view/reports.test.ts` (új) | a fenti egység- és fájlrendszeres tesztjei |
| `src/view/list.ts` | `translationBase` (a `kindCodes` ezt használja), `rowCost` export |
| `src/index.ts` | a riport exportjai |
| `web/server/api/reports.get.ts` (új) | egysoros API-útvonal |
| `web/app/pages/items/index.vue` | induló szűrők az URL-ből |
| `web/test/e2e/api.test.ts` | három új teszt |
| `web/package.json`, `pnpm-lock.yaml` | az unovis |
| `web/app/assets/css/main.css` | a grafikonszínek és az unovis témája |
| `web/app/utils/reports.ts` (új) | sorozatszín, -címke, cellaszöveg, szám-formázás |
| `web/app/utils/format.ts` | `escapeHtml` |
| `web/app/components/reports/RunCostChart.client.vue` (új) | költés futásonként |
| `web/app/components/reports/ChannelCostChart.client.vue` (új) | költség csatornánként |
| `web/app/pages/reports.vue` (új) | az oldal |
| `web/app/layouts/default.vue` | „Riport" menüpont |
| `README.md`, `docs/architecture.md`, a spec | dokumentáció, eltérések |

---

### Task 1: A riport nézetmodellje a magban

**Fájlok:**
- Módosít: `src/view/list.ts`
- Új: `src/view/reports.ts`
- Új: `src/view/reports.test.ts`
- Módosít: `src/index.ts`

**Interfészek:**
- Használja: `buildItemRows`, `byText`, `ItemListRow`, `ItemCell`
  (`src/view/items.ts`); `summarizeChannels` (`src/view/list.ts`, csak a
  tesztben); `artifactKinds` (`src/view/overview.ts`); `readRuns`,
  `RunSummaryView` (`src/view/runs.ts`); `ARTIFACT_KIND` (`src/pipeline.ts`);
  `RunStatus`, `isPidAlive` (`src/run/status.ts`).
- Adja (Task 2–3 erre épít, a `transcript-refinery` csomagból):
  - `readReports(cfg, isAlive?): Promise<Reports>`
  - `interface Reports { hasState; kpis: { videos; channels; words; transcribed; spentUsd; vaultCostUsd; missingCost }; runs: RunCostPoint[]; invalidLogLines; series: string[]; kinds: string[]; channels: ChannelReport[]; topCost: ItemRank[]; topLong: ItemRank[] }`
  - `interface ChannelReport { channel: string | null; videos; words; transcribed; languages: { code; count }[]; captions: { creator; auto }; costUsd: number | null; costBySeries: Record<string, number>; translationCost: Record<string, number>; coverage: Record<string, CoverageCell>; quality: { scored; below; meanScore: number | null } }`
  - `interface CoverageCell { done; failed; total; command: string | null }`
  - `interface RunCostPoint { runId; startedAt: string | null; command: string | null; status: RunStatus; spentUsd; estimateUsd: number | null }`
  - `interface ItemRank { itemId; title; channel: string | null; value }`
  - `TRANSLATION_SERIES = 'fordítás'`, `TOP_LIMIT = 10`

- [ ] **1. lépés: a `list.ts` két exportja (tiszta refaktor).** A
  `src/view/list.ts`-ben a `kindCodes` elé kerül a `translationBase`, és a
  `kindCodes` ezt használja; a `rowCost` exportot kap. Csere:

```ts
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
```

  helyett:

```ts
/**
 * A fordítási típus alapja (`summary-hu` → `summary`): a `-<nyelv>` utótagú
 * típus, amelynek az alapja is a típusok között van. Más típusra `null`.
 */
export function translationBase(kind: string, kinds: readonly string[]): string | null {
  const translation = /^(.+)-([a-z]{2})$/.exec(kind)
  return translation && kinds.includes(translation[1]!) ? translation[1]! : null
}

/**
 * Rövid oszlopkód típusonként: az alaprecept első 3 karaktere, a fordítás
 * `<alapkód>-<nyelv>`. Ha két típus kódja egyezne, mindkettő a teljes azonosítót
 * kapja — a fejléc sosem lehet kétértelmű.
 */
export function kindCodes(kinds: readonly string[]): Record<string, string> {
  const candidates = kinds.map((kind) => {
    const base = translationBase(kind, kinds)
    return base === null ? kind.slice(0, 3) : `${base.slice(0, 3)}${kind.slice(base.length)}`
  })
```

  és

```ts
/** Az elem összköltsége; `null`, ha egyik cellájának sincs költsége. */
function rowCost(row: ItemListRow): number | null {
```

  helyett

```ts
/** Az elem összköltsége; `null`, ha egyik cellájának sincs költsége. */
export function rowCost(row: ItemListRow): number | null {
```

- [ ] **2. lépés: a regressziós horgony.**

Run: `pnpm vitest run src/view/list.test.ts src/cli.test.ts`
Expected: PASS — a `kindCodes` és a `list` parancs kimenete változatlan.

- [ ] **3. lépés: a bukó teszt.** Hozd létre a `src/view/reports.test.ts`-t:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { recipesFor } from '../recipe/registry.js'
import { openState } from '../state/db.js'
import type { ItemRow } from '../state/queries.js'
import type { SourceItem } from '../types.js'
import type { ItemCell, ItemListRow } from './items.js'
import { summarizeChannels } from './list.js'
import {
  buildReports,
  readReports,
  runCommandFor,
  shellQuote,
  TRANSLATION_SERIES,
  type ReportsInput,
} from './reports.js'
import type { RunSummaryView } from './runs.js'

const REGISTRY = recipesFor({
  translate: { to: 'hu', recipes: ['summary', 'clean'] },
  configPath: '/p/c.yaml',
})

const cell = (overrides: Partial<ItemCell> = {}): ItemCell => ({
  status: 'pending',
  score: null,
  costUsd: null,
  belowThreshold: false,
  ...overrides,
})

/** Egy sor minden típusra „hátra" cellával, a megadottak felülírásával. */
const row = (
  itemId: string,
  channel: string | null,
  cells: Record<string, Partial<ItemCell>> = {},
  overrides: Partial<Omit<ItemListRow, 'cells'>> = {},
): ItemListRow => ({
  itemId,
  title: `Cím ${itemId}`,
  source: 'youtube',
  channel,
  captionSource: null,
  discovered: true,
  updatedAt: null,
  cells: Object.fromEntries(
    ['transcript', ...Object.keys(REGISTRY)].map((kind) => [kind, cell(cells[kind])]),
  ),
  ...overrides,
})

const discovered = (itemId: string, language: string | null = 'en'): SourceItem => ({
  itemId,
  source: 'youtube',
  sourceFile: `${itemId}.en.srt`,
  subtitlePath: `/s/${itemId}.en.srt`,
  baseName: itemId,
  title: `Cím ${itemId}`,
  language,
  metadata: {},
})

const itemRow = (itemId: string, wordsNormalized: number | null, language = 'en'): ItemRow => ({
  itemId,
  source: 'youtube',
  sourceFile: `${itemId}.en.srt`,
  baseName: itemId,
  title: `Cím ${itemId}`,
  language,
  channel: null,
  uploadedAt: null,
  url: null,
  discoveredAt: '2026-09-01T00:00:00.000Z',
  captionSource: wordsNormalized === null ? null : 'auto',
  wordsRaw: wordsNormalized === null ? null : wordsNormalized * 2,
  wordsNormalized,
})

const run = (runId: string, overrides: Partial<RunSummaryView> = {}): RunSummaryView => ({
  runId,
  status: 'done',
  command: 'run --recipe summary',
  startedAt: `${runId}Z`,
  lastEventAt: null,
  durationMs: null,
  units: null,
  estimate: null,
  succeeded: 0,
  failed: 0,
  spentUsd: 0,
  hasReport: false,
  invalid: 0,
  ...overrides,
})

const input = (overrides: Partial<ReportsInput> = {}): ReportsInput => ({
  hasState: true,
  discovered: [],
  rows: [],
  items: [],
  runs: [],
  registry: REGISTRY,
  ...overrides,
})

describe('shellQuote', () => {
  it('egyszeres idézőjelbe tesz, a szóköz és az ékezet betű szerint marad', () => {
    expect(shellQuote('Árvíztűrő Csatorna')).toBe("'Árvíztűrő Csatorna'")
  })

  it('a benne lévő aposztrófot lezárja, escape-eli és újranyitja', () => {
    expect(shellQuote("O'Brien")).toBe("'O'\\''Brien'")
  })
})

describe('runCommandFor', () => {
  it('a recept és a csatorna a run kapcsolóiként, a csatorna idézőjelezve', () => {
    expect(runCommandFor('summary-hu', "Dev's Corner")).toBe(
      "refinery run --recipe summary-hu --channel 'Dev'\\''s Corner'",
    )
  })
})

describe('buildReports — típusok és sorozatok', () => {
  it('a fizetős típusok az átirat nélkül; a fordítások egy közös sorozatba kerülnek', () => {
    const reports = buildReports(input())
    expect(reports.kinds).toEqual([
      'summary',
      'flashcards',
      'qa',
      'clean',
      'bloom',
      'notes',
      'summary-hu',
      'clean-hu',
    ])
    expect(reports.series).toEqual([
      'summary',
      'flashcards',
      'qa',
      'clean',
      'bloom',
      'notes',
      TRANSLATION_SERIES,
    ])
  })

  it('fordítás nélküli regiszternél nincs fordítás-sorozat', () => {
    const reports = buildReports(
      input({ registry: recipesFor({ translate: null, configPath: '/p/c.yaml' }) }),
    )
    expect(reports.series).not.toContain(TRANSLATION_SERIES)
  })
})

describe('buildReports — csatornák', () => {
  it('csatornánként összesít: videó, szószám, átiratolt db, nyelvek, feliratforrás', () => {
    const reports = buildReports(
      input({
        discovered: [discovered('a', 'en'), discovered('b', 'hu'), discovered('c', 'en')],
        rows: [
          row('a', 'Egy', {}, { captionSource: 'creator' }),
          row('b', 'Egy', {}, { captionSource: 'auto' }),
          row('c', 'Egy'),
        ],
        items: [itemRow('a', 100), itemRow('b', 50)],
      }),
    )
    expect(reports.channels).toHaveLength(1)
    expect(reports.channels[0]).toMatchObject({
      channel: 'Egy',
      videos: 3,
      words: 150,
      transcribed: 2,
      languages: [
        { code: 'en', count: 2 },
        { code: 'hu', count: 1 },
      ],
      captions: { creator: 1, auto: 1 },
    })
  })

  it('a nyelvkód a felderítésből jön, hiányában az állapottárból', () => {
    const reports = buildReports(
      input({
        discovered: [discovered('a', null)],
        rows: [row('a', 'Egy'), row('b', 'Egy', {}, { discovered: false })],
        items: [itemRow('b', 10, 'de')],
      }),
    )
    expect(reports.channels[0]?.languages).toEqual([{ code: 'de', count: 1 }])
  })

  it('a sorrend: videószám szerint csökkenő, azonos számnál név, a csatorna nélküli a végén', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', null),
          row('b', null),
          row('c', 'B'),
          row('d', 'A'),
          row('e', 'C'),
          row('f', 'C'),
        ],
      }),
    )
    expect(reports.channels.map((c) => c.channel)).toEqual(['C', 'A', 'B', null])
  })

  it('a fordítás költsége a közös sorozatba, típusonként a translationCost-ba kerül', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', 'Egy', {
            summary: { status: 'done', costUsd: 0.1 },
            'summary-hu': { status: 'done', costUsd: 0.02 },
            'clean-hu': { status: 'done', costUsd: 0.03 },
          }),
        ],
      }),
    )
    const channel = reports.channels[0]!
    expect(channel.costBySeries.summary).toBeCloseTo(0.1, 10)
    expect(channel.costBySeries[TRANSLATION_SERIES]).toBeCloseTo(0.05, 10)
    expect(channel.translationCost['summary-hu']).toBeCloseTo(0.02, 10)
    expect(channel.translationCost['clean-hu']).toBeCloseTo(0.03, 10)
    expect(channel.costUsd).toBeCloseTo(0.15, 10)
  })

  it('a rögzítetlen költség nem nulla: a csatorna költsége null, a hiány számolva', () => {
    const reports = buildReports(
      input({ rows: [row('a', 'Egy', { flashcards: { status: 'done', costUsd: null } })] }),
    )
    expect(reports.channels[0]?.costUsd).toBeNull()
    expect(reports.kpis.missingCost).toBe(1)
    expect(reports.kpis.vaultCostUsd).toBe(0)
  })

  it('lefedettség típusonként: kész, hibás, összes, és a hiányzók parancsa', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', "O'Brien", { summary: { status: 'done' }, qa: { status: 'done' } }),
          row('b', "O'Brien", { summary: { status: 'failed' }, qa: { status: 'done' } }),
        ],
      }),
    )
    const coverage = reports.channels[0]!.coverage
    expect(coverage.summary).toEqual({
      done: 1,
      failed: 1,
      total: 2,
      command: "refinery run --recipe summary --channel 'O'\\''Brien'",
    })
    expect(coverage.qa).toEqual({ done: 2, failed: 0, total: 2, command: null })
    expect(coverage.transcript).toBeUndefined()
  })

  it('csatorna nélküli csoportnál nincs parancs', () => {
    const reports = buildReports(input({ rows: [row('a', null)] }))
    const commands = Object.values(reports.channels[0]!.coverage).map((c) => c.command)
    expect(commands.every((c) => c === null)).toBe(true)
  })

  it('minőség: átlagpontszám és a küszöb alattiak a kész, pontozott cellákból', () => {
    const reports = buildReports(
      input({
        rows: [
          row('a', 'Egy', {
            summary: { status: 'done', score: 0.9 },
            clean: { status: 'done', score: 0.6, belowThreshold: true },
            qa: { status: 'failed', score: 0.1 },
          }),
        ],
      }),
    )
    expect(reports.channels[0]?.quality).toEqual({ scored: 2, below: 1, meanScore: 0.75 })
  })

  it('pontozott cella nélkül az átlag null', () => {
    const reports = buildReports(input({ rows: [row('a', 'Egy')] }))
    expect(reports.channels[0]?.quality).toEqual({ scored: 0, below: 0, meanScore: null })
  })

  it('a lefedettség kész száma és a videószám egyezik a refinery list összesítőjével', () => {
    const rows = [
      row('a', 'Egy', { summary: { status: 'done' }, 'clean-hu': { status: 'done' } }),
      row('b', 'Egy', { summary: { status: 'failed' } }),
      row('c', 'Kettő', { qa: { status: 'done', belowThreshold: true, score: 0.5 } }),
      row('d', null, { notes: { status: 'done' } }),
    ]
    const reports = buildReports(input({ rows }))
    const summaries = summarizeChannels(rows, reports.kinds)
    for (const summary of summaries) {
      const channel = reports.channels.find((c) => c.channel === summary.channel)!
      expect(channel.videos).toBe(summary.videos)
      for (const kind of reports.kinds) {
        expect(channel.coverage[kind]?.done).toBe(summary.done[kind])
      }
    }
  })
})

describe('buildReports — KPI-k', () => {
  it('videó a felderítésből, csatorna a csatorna nélküli csoport nélkül', () => {
    const reports = buildReports(
      input({
        discovered: [discovered('a'), discovered('b')],
        rows: [row('a', 'Egy'), row('b', null), row('c', 'Kettő', {}, { discovered: false })],
        items: [itemRow('a', 30), itemRow('c', 20)],
      }),
    )
    expect(reports.kpis).toMatchObject({ videos: 2, channels: 2, words: 50, transcribed: 2 })
  })

  it('a tényleges költés minden futást összead, a grafikon csak a költséggel járókat kapja', () => {
    const reports = buildReports(
      input({
        runs: [
          run('2026-09-12T10:00:00', { spentUsd: 0.5, estimate: { items: 3, usd: 0.3, limitUsd: 1 } }),
          run('2026-09-11T10:00:00', { spentUsd: 0 }),
          run('2026-09-10T10:00:00', { spentUsd: 0.25, invalid: 2 }),
          run('régi', { spentUsd: 0.1, startedAt: null }),
        ],
      }),
    )
    expect(reports.kpis.spentUsd).toBeCloseTo(0.85, 10)
    expect(reports.runs.map((r) => [r.runId, r.estimateUsd])).toEqual([
      ['2026-09-10T10:00:00', null],
      ['2026-09-12T10:00:00', 0.3],
      ['régi', null],
    ])
    expect(reports.invalidLogLines).toBe(2)
  })
})

describe('buildReports — toplisták', () => {
  it('legdrágább: az elem cellaköltségeinek összege, csökkenő, azonos értéknél cím szerint', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`e${String(i).padStart(2, '0')}`, 'Egy', { summary: { costUsd: i === 11 ? 0.05 : i / 100 } }),
    )
    rows.push(row('nincs', 'Egy'))
    const reports = buildReports(input({ rows }))
    expect(reports.topCost).toHaveLength(10)
    expect(reports.topCost.slice(0, 3).map((r) => r.itemId)).toEqual(['e10', 'e09', 'e08'])
    expect(reports.topCost.map((r) => r.itemId)).not.toContain('nincs')
    const fives = reports.topCost.filter((r) => r.value === 0.05).map((r) => r.itemId)
    expect(fives).toEqual(['e05', 'e11'])
  })

  it('leghosszabb: normalizált szószám szerint, csak átiratolt elem', () => {
    const reports = buildReports(
      input({
        rows: [row('a', 'Egy'), row('b', 'Egy'), row('c', 'Egy')],
        items: [itemRow('a', 10), itemRow('b', 300), itemRow('c', null)],
      }),
    )
    expect(reports.topLong).toEqual([
      { itemId: 'b', title: 'Cím b', channel: 'Egy', value: 300 },
      { itemId: 'a', title: 'Cím a', channel: 'Egy', value: 10 },
    ])
  })
})

describe('readReports', () => {
  let dir: string
  let cfg: Config

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-reports-'))
    const channel = join(dir, 'feliratok', 'youtube', 'Szintetikus Csatorna')
    await mkdir(channel, { recursive: true })
    await writeFile(
      join(channel, 'Első példavideó.info.json'),
      JSON.stringify({ id: 'szint0001', title: 'Első példavideó', channel: 'Szintetikus Csatorna' }),
    )
    await writeFile(
      join(channel, 'Első példavideó.en.srt'),
      '1\n00:00:00,000 --> 00:00:02,000\nEgy szintetikus mondat.\n',
    )
    cfg = loadConfig(
      {
        vault: { path: join(dir, 'vault') },
        sources: [join(dir, 'feliratok', 'youtube')],
        state: { path: 'state.db' },
        logs: { dir: 'logs' },
      },
      join(dir, 'refinery.config.yaml'),
      dir,
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('állapottár és napló nélkül: hasState hamis, minden hátra, a parancs a csatornára szól', async () => {
    const reports = await readReports(cfg)
    expect(reports.hasState).toBe(false)
    expect(reports.kpis).toMatchObject({ videos: 1, channels: 1, spentUsd: 0, vaultCostUsd: 0 })
    expect(reports.runs).toEqual([])
    expect(reports.channels[0]?.coverage.summary).toEqual({
      done: 0,
      failed: 0,
      total: 1,
      command: "refinery run --recipe summary --channel 'Szintetikus Csatorna'",
    })
  })

  it('az állapottár és a futásnapló adatait fűzi össze', async () => {
    const store = openState(cfg.statePath)
    store.recordItem({
      itemId: 'szint0001',
      source: 'youtube',
      sourceFile: 'Szintetikus Csatorna/Első példavideó.en.srt',
      subtitlePath: join(dir, 'x.srt'),
      baseName: 'Első példavideó',
      title: 'Első példavideó',
      language: 'en',
      metadata: { channel: 'Szintetikus Csatorna' },
    })
    store.recordTranscript('szint0001', 'creator', 12, 10)
    store.recordArtifact('szint0001', 'summary', 'done', '/v/s.md', null, {
      iterations: 1,
      score: 0.9,
      costUsd: 0.02,
      model: 'm',
    })
    store.close()
    await mkdir(cfg.logsDir, { recursive: true })
    await writeFile(
      join(cfg.logsDir, '2026-09-10T08-00-00.jsonl'),
      [
        { at: '2026-09-10T08:00:00.000Z', type: 'run:started', command: 'run --recipe summary', pid: 999_999 },
        { at: '2026-09-10T08:00:01.000Z', type: 'item:refined', itemId: 'szint0001', recipe: 'summary', score: 0.9, generations: 1, usd: 0.03 },
        { at: '2026-09-10T08:00:02.000Z', type: 'run:ended', interrupted: false },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n',
    )

    const reports = await readReports(cfg, () => false)
    expect(reports.hasState).toBe(true)
    expect(reports.kpis).toMatchObject({ words: 10, transcribed: 1 })
    expect(reports.kpis.spentUsd).toBeCloseTo(0.03, 10)
    expect(reports.kpis.vaultCostUsd).toBeCloseTo(0.02, 10)
    expect(reports.runs.map((r) => r.runId)).toEqual(['2026-09-10T08-00-00'])
    expect(reports.channels[0]?.coverage.summary?.command).toBeNull()
    expect(reports.channels[0]?.captions).toEqual({ creator: 1, auto: 0 })
  })
})
```

- [ ] **4. lépés: futtasd, bukjon.**

Run: `pnpm vitest run src/view/reports.test.ts`
Expected: FAIL — `Failed to resolve import "./reports.js"`.

- [ ] **5. lépés: az implementáció.** Hozd létre a `src/view/reports.ts`-t:

```ts
import type { Config } from '../config.js'
import { ARTIFACT_KIND } from '../pipeline.js'
import { recipesFor, type Registry } from '../recipe/registry.js'
import { isPidAlive, type RunStatus } from '../run/status.js'
import { discoverAll } from '../source/folder.js'
import type { ItemRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'
import type { SourceItem } from '../types.js'
import { buildItemRows, byText, type ItemListRow } from './items.js'
import { rowCost, translationBase } from './list.js'
import { artifactKinds } from './overview.js'
import { readRuns, type RunSummaryView } from './runs.js'

/** A halmozott költségsáv közös sorozata a fordítási típusoknak. */
export const TRANSLATION_SERIES = 'fordítás'

/** A toplisták hossza. */
export const TOP_LIMIT = 10

/** Egy költséggel járó futás a futásonkénti grafikonon. */
export interface RunCostPoint {
  runId: string
  startedAt: string | null
  command: string | null
  status: RunStatus
  spentUsd: number
  estimateUsd: number | null
}

/** Egy típus lefedettsége egy csatornán. */
export interface CoverageCell {
  done: number
  failed: number
  total: number
  /** A hiányzók pótló parancsa; `null`, ha nincs mit pótolni vagy nincs csatorna. */
  command: string | null
}

/** Egy csatorna minden adata a riportoldalhoz. */
export interface ChannelReport {
  /** `null`: a metaadat nélküli elemek csoportja. */
  channel: string | null
  videos: number
  /** A normalizált szavak összege az átiratolt elemeken. */
  words: number
  transcribed: number
  /** Nyelvkód → db, csökkenő sorrendben. */
  languages: { code: string; count: number }[]
  captions: { creator: number; auto: number }
  /** A vault-tartalom költsége; `null`, ha egyik cellának sincs költsége. */
  costUsd: number | null
  /** Sorozatonként (alapreceptek + `TRANSLATION_SERIES`) a költség. */
  costBySeries: Record<string, number>
  /** Fordítási típusonként a költség, a tooltiphez. */
  translationCost: Record<string, number>
  /** Fizetős típusonként. */
  coverage: Record<string, CoverageCell>
  quality: { scored: number; below: number; meanScore: number | null }
}

/** Egy elem egy toplistán. */
export interface ItemRank {
  itemId: string
  title: string
  channel: string | null
  value: number
}

export interface Reports {
  hasState: boolean
  kpis: {
    videos: number
    channels: number
    words: number
    transcribed: number
    /** A futásnaplók `item:refined` költéseinek összege. */
    spentUsd: number
    /** Az állapottár fizetős celláinak költsége. */
    vaultCostUsd: number
    /** Kész fizetős cella rögzített költség nélkül. */
    missingCost: number
  }
  /** Csak a költséggel járó futások, időrendben. */
  runs: RunCostPoint[]
  invalidLogLines: number
  /** A halmozott sáv sorozatai, rögzített sorrendben. */
  series: string[]
  /** A fizetős típusok, az `artifactKinds()` sorrendjében, az átirat nélkül. */
  kinds: string[]
  channels: ChannelReport[]
  topCost: ItemRank[]
  topLong: ItemRank[]
}

export interface ReportsInput {
  hasState: boolean
  /** A felderített elemek: a nyelvkód elsődleges forrása. */
  discovered: readonly SourceItem[]
  rows: readonly ItemListRow[]
  /** Az állapottár elemsorai: szószám, nyelv. */
  items: readonly ItemRow[]
  runs: readonly RunSummaryView[]
  registry: Registry
}

/** POSIX egyszeres idézőjel: a szöveg a shellben betű szerint marad. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** A (csatorna, típus) pár hiányzóit pótló parancs. */
export function runCommandFor(kind: string, channel: string): string {
  return `refinery run --recipe ${kind} --channel ${shellQuote(channel)}`
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

/** Csökkenő érték szerint, azonos értéknél cím szerint, az első `TOP_LIMIT`. */
function top(ranks: ItemRank[]): ItemRank[] {
  return ranks
    .sort((a, b) => b.value - a.value || byText(a.title, b.title))
    .slice(0, TOP_LIMIT)
}

/**
 * A riportoldal nézetmodellje. Tiszta függvény: a cellák a `buildItemRows()`
 * soraiból jönnek, így a számok az elemlistáéval és a `refinery list`-ével
 * azonosak. Rögzítetlen (`null`) költség sehol sem számít nullának.
 */
export function buildReports(input: ReportsInput): Reports {
  const kinds = artifactKinds(input.registry).filter((kind) => kind !== ARTIFACT_KIND)
  const seriesOf = (kind: string): string =>
    translationBase(kind, kinds) === null ? kind : TRANSLATION_SERIES
  const series = [...new Set(kinds.map(seriesOf))]
  const translations = kinds.filter((kind) => seriesOf(kind) === TRANSLATION_SERIES)

  const itemOf = new Map(input.items.map((item) => [item.itemId, item] as const))
  const languageOf = new Map(input.discovered.map((item) => [item.itemId, item.language] as const))

  const groups = new Map<string | null, ItemListRow[]>()
  for (const row of input.rows) {
    const list = groups.get(row.channel) ?? []
    list.push(row)
    groups.set(row.channel, list)
  }

  const channels: ChannelReport[] = [...groups.entries()].map(([channel, rows]) => {
    let words = 0
    let transcribed = 0
    const languages = new Map<string, number>()
    const captions = { creator: 0, auto: 0 }
    let costUsd: number | null = null
    const costBySeries = Object.fromEntries(series.map((s) => [s, 0]))
    const translationCost = Object.fromEntries(translations.map((k) => [k, 0]))
    const coverage: Record<string, CoverageCell> = {}
    const scores: number[] = []
    let below = 0

    for (const row of rows) {
      const item = itemOf.get(row.itemId)
      if (item?.wordsNormalized != null) {
        words += item.wordsNormalized
        transcribed++
      }
      const language = languageOf.get(row.itemId) ?? item?.language ?? null
      if (language !== null) languages.set(language, (languages.get(language) ?? 0) + 1)
      if (row.captionSource !== null) captions[row.captionSource]++
    }

    for (const kind of kinds) {
      const cells = rows.map((row) => row.cells[kind])
      const done = cells.filter((cell) => cell?.status === 'done').length
      coverage[kind] = {
        done,
        failed: cells.filter((cell) => cell?.status === 'failed').length,
        total: rows.length,
        command: channel === null || done === rows.length ? null : runCommandFor(kind, channel),
      }
      for (const cell of cells) {
        if (cell?.costUsd != null) {
          costUsd = (costUsd ?? 0) + cell.costUsd
          costBySeries[seriesOf(kind)]! += cell.costUsd
          if (kind in translationCost) translationCost[kind]! += cell.costUsd
        }
        if (cell?.status === 'done' && cell.score !== null) {
          scores.push(cell.score)
          if (cell.belowThreshold) below++
        }
      }
    }

    return {
      channel,
      videos: rows.length,
      words,
      transcribed,
      languages: [...languages.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || byText(a.code, b.code)),
      captions,
      costUsd,
      costBySeries,
      translationCost,
      coverage,
      quality: {
        scored: scores.length,
        below,
        meanScore: scores.length === 0 ? null : sum(scores) / scores.length,
      },
    }
  })
  channels.sort((a, b) =>
    a.channel === null
      ? 1
      : b.channel === null
        ? -1
        : b.videos - a.videos || byText(a.channel, b.channel),
  )

  const paidCells = input.rows.flatMap((row) => kinds.map((kind) => row.cells[kind]))
  const costs = paidCells.flatMap((cell) => (cell?.costUsd != null ? [cell.costUsd] : []))

  const topCost = top(
    input.rows.flatMap((row) => {
      const cost = rowCost(row)
      return cost === null
        ? []
        : [{ itemId: row.itemId, title: row.title, channel: row.channel, value: cost }]
    }),
  )
  const topLong = top(
    input.rows.flatMap((row) => {
      const words = itemOf.get(row.itemId)?.wordsNormalized ?? null
      return words === null
        ? []
        : [{ itemId: row.itemId, title: row.title, channel: row.channel, value: words }]
    }),
  )

  const runs = input.runs
    .filter((run) => run.spentUsd > 0)
    .map(
      (run): RunCostPoint => ({
        runId: run.runId,
        startedAt: run.startedAt,
        command: run.command,
        status: run.status,
        spentUsd: run.spentUsd,
        estimateUsd: run.estimate?.usd ?? null,
      }),
    )
    .sort((a, b) =>
      a.startedAt === null
        ? 1
        : b.startedAt === null
          ? -1
          : byText(a.startedAt, b.startedAt),
    )

  return {
    hasState: input.hasState,
    kpis: {
      videos: input.discovered.length,
      channels: channels.filter((c) => c.channel !== null).length,
      words: sum(channels.map((c) => c.words)),
      transcribed: sum(channels.map((c) => c.transcribed)),
      spentUsd: sum(input.runs.map((run) => run.spentUsd)),
      vaultCostUsd: sum(costs),
      missingCost: paidCells.filter((cell) => cell?.status === 'done' && cell.costUsd === null)
        .length,
    },
    runs,
    invalidLogLines: sum(input.runs.map((run) => run.invalid)),
    series,
    kinds,
    channels,
    topCost,
    topLong,
  }
}

/**
 * A riport beolvasása: felderítés, állapottár és futásnaplók. Állapottár
 * nélkül minden cella „hátra", a szószám nulla.
 */
export async function readReports(
  cfg: Pick<
    Config,
    'sources' | 'languages' | 'statePath' | 'translate' | 'configPath' | 'logsDir'
  >,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<Reports> {
  const registry = recipesFor(cfg)
  const discovered = await discoverAll(cfg.sources, cfg.languages)
  const reader = openStateReader(cfg.statePath)
  try {
    const items = reader?.items() ?? []
    return buildReports({
      hasState: reader !== null,
      discovered,
      rows: buildItemRows(discovered, items, reader?.artifacts() ?? [], registry),
      items,
      runs: await readRuns(cfg, isAlive),
      registry,
    })
  } finally {
    reader?.close()
  }
}
```

- [ ] **6. lépés: futtasd, menjen át.**

Run: `pnpm vitest run src/view/reports.test.ts`
Expected: PASS, 21 teszt.

- [ ] **7. lépés: az export.** A `src/index.ts`-ben a
  `export { groupFailures, readFailures, type FailureGroup } from './view/failures.js'`
  sor után:

```ts
export {
  buildReports,
  readReports,
  runCommandFor,
  shellQuote,
  TOP_LIMIT,
  TRANSLATION_SERIES,
  type ChannelReport,
  type CoverageCell,
  type ItemRank,
  type Reports,
  type ReportsInput,
  type RunCostPoint,
} from './view/reports.js'
```

- [ ] **8. lépés: mutációs ellenőrzés.** Egyenként, mindegyik után
  visszaállítva (`git checkout src/view/reports.ts` nem jó, mert új fájl —
  előtte `cp src/view/reports.ts /tmp/reports.ts.bak`, utána vissza):
  1. a `seriesOf` törzse legyen `kind` → 2 teszt bukik (a sorozatok listája, a
     fordítás költsége);
  2. `if (cell?.costUsd != null) {` → `if (cell !== undefined) { cell.costUsd ??= 0;`
     → „a rögzítetlen költség nem nulla" bukik;
  3. `command: channel === null || done === rows.length ? null : runCommandFor(kind, channel)`
     → `command: done === rows.length ? null : runCommandFor(kind, channel ?? '')`
     → „csatorna nélküli csoportnál nincs parancs" bukik.

Run (mindháromnál): `pnpm vitest run src/view/reports.test.ts 2>&1 | grep -E "Tests |FAIL"`
Expected: legalább 1 FAIL; visszaállítás után 21 passed.

- [ ] **9. lépés: teljes ellenőrzés.**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 1019 teszt zöld, tiszta typecheck és lint.

- [ ] **10. lépés: commit** (`commit-message` skill, `Refs #74`):

```
feat(view): Add report view model for web UI

- Aggregate channels: coverage, cost by series, quality
- Fold translation kinds into one cost series
- Generate quoted refinery run commands per gap
- Keep null costs distinct from zero
```

---

### Task 2: Az API-útvonal és az `/items` URL-szűrői

**Fájlok:**
- Új: `web/server/api/reports.get.ts`
- Módosít: `web/app/pages/items/index.vue`
- Módosít: `web/test/e2e/api.test.ts`

**Interfészek:**
- Használja: `readReports`, `Reports` (Task 1, a `transcript-refinery`
  csomagból); `coreHandler` (`web/server/utils/refinery.ts`, auto-import).
- Adja: `GET /api/reports` → `Reports`; az `/items?source=&channel=&kind=&status=`
  (a `status` a magyar címke: `kész`, `hibás`, `hátra`).

- [ ] **1. lépés: a bukó e2e-tesztek.** A `web/test/e2e/api.test.ts`
  típus-importjába a `Overview,` sor után kerüljön `Reports,`; majd az
  `it('az oldalak a szerveren renderelve a szintetikus adatot mutatják', …)`
  elé:

```ts
  it('a riport a szintetikus állapotot adja: KPI-k, lefedettség paranccsal, költséggel járó futás', async () => {
    const reports = await $fetch<Reports>('/api/reports')
    expect(reports.hasState).toBe(true)
    expect(reports.kpis).toMatchObject({ videos: 2, channels: 1, words: 10, transcribed: 1 })
    expect(reports.kpis.spentUsd).toBeCloseTo(0.0123, 10)
    expect(reports.kpis.vaultCostUsd).toBeCloseTo(0.0123, 10)
    expect(reports.runs.map((run) => run.runId)).toEqual([FINISHED_RUN])
    const channel = reports.channels[0]
    expect(channel?.channel).toBe('Szintetikus Csatorna')
    expect(channel?.coverage.summary).toEqual({
      done: 1,
      failed: 0,
      total: 2,
      command: "refinery run --recipe summary --channel 'Szintetikus Csatorna'",
    })
    expect(channel?.coverage.qa?.failed).toBe(1)
    expect(channel?.quality).toEqual({ scored: 1, below: 1, meanScore: 0.62 })
  })

  it('az elemlista az URL-ből kapja az induló szűrőt', async () => {
    const html = await $fetch<string>('/items?channel=Szintetikus%20Csatorna&kind=summary&status=k%C3%A9sz')
    expect(html).toContain('1 / 2 elem')
    const all = await $fetch<string>('/items?status=ismeretlen')
    expect(all).toContain('2 / 2 elem')
  })
```

- [ ] **2. lépés: futtasd, bukjon.**

Run: `pnpm web:test 2>&1 | grep -E "Tests |FAIL"`
Expected: 2 FAIL (`/api/reports` 404; az `/items` `2 / 2 elem`-et mutat).

- [ ] **3. lépés: az API-útvonal.** `web/server/api/reports.get.ts`:

```ts
import { readReports } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readReports(cfg)))
```

- [ ] **4. lépés: az `/items` induló szűrői.** A `web/app/pages/items/index.vue`-ban

```ts
const source = ref(ALL)
const channel = ref(ALL)
const kind = ref('summary')
const status = ref(ALL)
```

  helyett:

```ts
// Az induló szűrők az URL-ből (a riport katalógusa így linkel ide); csak a
// létező értéket veszi át, egyébként az alapértelmezés marad.
const query = useRoute().query
const fromQuery = (key: string, allowed: readonly string[], fallback: string): string => {
  const value = query[key]
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

const source = ref(fromQuery('source', sources.value, ALL))
const channel = ref(fromQuery('channel', channels.value, ALL))
const kind = ref(fromQuery('kind', kinds.value, 'summary'))
const status = ref(fromQuery('status', STATUS_LABELS, ALL))
```

- [ ] **5. lépés: futtasd, menjen át.**

Run: `pnpm web:test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: 20 passed.

- [ ] **6. lépés: mutációs ellenőrzés.** `const status = ref(fromQuery('status', STATUS_LABELS, ALL))`
  → `const status = ref(ALL)`: „az elemlista az URL-ből kapja az induló
  szűrőt" bukik. Visszaállítás. (A bukó teszt a teljes HTML-t kiírja —
  a `grep` szűrés itt fontos.)

- [ ] **7. lépés: teljes ellenőrzés.**

Run: `pnpm web:typecheck && pnpm web:lint`
Expected: tiszta.

- [ ] **8. lépés: commit** (`Refs #74`):

```
feat(web): Add reports API and URL filters for items

- Serve the report view model at /api/reports
- Seed /items filters from the query string
- Keep defaults for unknown or missing values
```

---

### Task 3: A riportoldal és a két grafikon

**Fájlok:**
- Módosít: `web/package.json`, `pnpm-lock.yaml` (az unovis)
- Módosít: `web/app/assets/css/main.css`
- Új: `web/app/utils/reports.ts`
- Módosít: `web/app/utils/format.ts`
- Új: `web/app/components/reports/RunCostChart.client.vue`
- Új: `web/app/components/reports/ChannelCostChart.client.vue`
- Új: `web/app/pages/reports.vue`
- Módosít: `web/app/layouts/default.vue`
- Módosít: `web/test/e2e/api.test.ts`

**Interfészek:**
- Használja: `GET /api/reports` (Task 2), a `Reports`, `ChannelReport`,
  `RunCostPoint` típust (Task 1, csak `import type`); a meglévő
  `kindLabel`, `formatUsd`, `formatDate`, `formatScore`, `runStatusLabel`
  (`web/app/utils/format.ts`, auto-import).
- Adja: a `/reports` oldal; a `ReportsRunCostChart` és a
  `ReportsChannelCostChart` komponens (a Nuxt a `components/reports/`
  mappából ezzel az előtaggal regisztrálja).

- [ ] **1. lépés: a bukó SSR-teszt.** A `web/test/e2e/api.test.ts`-ben a
  Task 2 két tesztje után:

```ts
  it('a riportoldal a szerveren renderelve a KPI-kat, a katalógust és a parancsot mutatja', async () => {
    const html = await $fetch<string>('/reports')
    expect(html).toContain('Tényleges költés')
    expect(html).toContain('A vault-tartalom költsége')
    expect(html).toContain('Csatorna-katalógus')
    expect(html).toContain('1/2 · 1 hátra')
    expect(html).toContain('refinery run --recipe summary --channel &#39;Szintetikus Csatorna&#39;')
    expect(html).toContain('Grafikon betöltése…')
  })
```

- [ ] **2. lépés: futtasd, bukjon.**

Run: `pnpm web:test 2>&1 | grep -E "Tests |FAIL"`
Expected: 1 FAIL (a `/reports` 404).

- [ ] **3. lépés: az unovis.**

Run: `pnpm --filter transcript-refinery-web add @unovis/vue@^1.7.0 @unovis/ts@^1.7.0`
Expected: a `web/package.json` `dependencies`-ébe bekerül a két csomag,
`^1.7.0`-val. A `cac` peer-figyelmeztetés már korábban is megvolt, nem ettől
jön.

- [ ] **4. lépés: színek és téma.** A `web/app/assets/css/main.css` végére:

```css
/*
 * A grafikonok színei: a dataviz-skill referenciapalettája, világos és sötét
 * felületre külön lépcsővel, a validátoron ellenőrizve (spec 1.3). A szín a
 * recepthez tartozik, nem a helyezéshez.
 */
:root {
  --viz-1: #2a78d6;
  --viz-2: #eb6834;
  --viz-3: #1baf7a;
  --viz-4: #eda100;
  --viz-5: #e87ba4;
  --viz-6: #008300;
  --viz-7: #4a3aa7;
  --viz-8: #e34948;
  /* A becslés kontextus, nem sorozat: semleges szürke. */
  --viz-estimate: #a3a3a3;
}

.dark {
  --viz-1: #3987e5;
  --viz-2: #d95926;
  --viz-3: #199e70;
  --viz-4: #c98500;
  --viz-5: #d55181;
  --viz-6: #008300;
  --viz-7: #9085e9;
  --viz-8: #e66767;
  --viz-estimate: #737373;
}

/*
 * Az unovis témája a Nuxt UI tokenjeiből. A dupla `:root` a specificitásért kell:
 * az unovis a saját alapértékeit a mieink után, szintén a `:root`-ra injektálja.
 */
:root:root {
  --vis-font-family: inherit;
  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text);
  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-domain-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-muted);
  --vis-axis-label-color: var(--ui-text-muted);
  /* 2 px-es rés a halmozott szeletek között (spec 1.3). */
  --vis-stacked-bar-stroke-color: var(--ui-bg);
  --vis-stacked-bar-stroke-width: 2px;
}
```

  Ha a dataviz-skill elérhető, a palettát a validátorral ellenőrizd újra
  (mindkét módban „ALL CHECKS PASS", világosban a kontraszt-WARN várható és a
  táblázatnézet miatt elfogadott):

```bash
node <dataviz>/scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" --mode light --surface "#ffffff"
node <dataviz>/scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9" --mode dark --surface "#171717"
```

- [ ] **5. lépés: segédfüggvények.** Új `web/app/utils/reports.ts`:

```ts
/**
 * A fordítási típusok közös sorozata. A mag `TRANSLATION_SERIES` értéke; itt
 * szövegként, mert a kliens a mag csomagjából csak típust importál.
 */
export const TRANSLATION_SERIES = 'fordítás'

/** Sorozatonként rögzített szín: az alaprecept sorrendje a regiszteré. */
const SERIES_COLORS: Record<string, string> = {
  summary: 'var(--viz-1)',
  flashcards: 'var(--viz-2)',
  qa: 'var(--viz-3)',
  clean: 'var(--viz-4)',
  bloom: 'var(--viz-5)',
  notes: 'var(--viz-6)',
  [TRANSLATION_SERIES]: 'var(--viz-7)',
}

/** Egy sorozat színe; az ismeretlen (új) alaprecept a 8. slotot kapja. */
export function seriesColor(series: string): string {
  return SERIES_COLORS[series] ?? 'var(--viz-8)'
}

export function seriesLabel(series: string): string {
  return series === TRANSLATION_SERIES ? 'fordítás' : kindLabel(series)
}

/** A katalógus cellájának szövege: `kész/összes`, hiánynál a hátralévők. */
export function coverageText(cell: { done: number; failed: number; total: number }): string {
  const base = `${cell.done}/${cell.total}`
  if (cell.done === cell.total) return base
  const rest = cell.total - cell.done
  return cell.failed > 0
    ? `${base} · ${rest} hátra (ebből ${cell.failed} hibás)`
    : `${base} · ${rest} hátra`
}

/** Ezres tagolás szóközzel; determinisztikus, a szerveren és a böngészőben azonos. */
export function formatWords(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatRatio(part: number, whole: number): string {
  return whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`
}
```

  A `web/app/utils/format.ts` végére:

```ts
/** A tooltipek HTML-szövegébe kerülő érték: a felhasználói szöveg nem lehet jelölés. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
```

- [ ] **6. lépés: a futásgrafikon.** Új
  `web/app/components/reports/RunCostChart.client.vue`:

```vue
<script setup lang="ts">
import { GroupedBar } from '@unovis/ts'
import { VisAxis, VisGroupedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import type { RunCostPoint } from 'transcript-refinery'

const props = defineProps<{ runs: RunCostPoint[] }>()

const x = (_: RunCostPoint, i: number): number => i
const y = [(d: RunCostPoint) => d.spentUsd, (d: RunCostPoint) => d.estimateUsd ?? 0]
const color = (_: RunCostPoint, i: number): string =>
  i === 0 ? 'var(--viz-1)' : 'var(--viz-estimate)'

const tickFormat = (i: number): string => {
  const run = props.runs[Math.round(i)]
  return run?.startedAt ? run.startedAt.slice(5, 10) : ''
}

function tooltip(d: RunCostPoint): string {
  const ratio =
    d.estimateUsd !== null && d.estimateUsd > 0
      ? ` · ${(d.spentUsd / d.estimateUsd).toFixed(2)}×`
      : ''
  return [
    `<strong>${formatDate(d.startedAt)}</strong>`,
    `<code>${escapeHtml(d.command ?? d.runId)}</code>`,
    `tényleges: ${formatUsd(d.spentUsd)}`,
    `becsült: ${d.estimateUsd === null ? '–' : formatUsd(d.estimateUsd)}${ratio}`,
    `állapot: ${runStatusLabel(d.status)}`,
  ].join('<br>')
}

const events = {
  [GroupedBar.selectors.bar]: {
    click: (d: RunCostPoint) => navigateTo(`/runs/${d.runId}`),
  },
}
</script>

<template>
  <div>
    <div class="mb-2 flex gap-4 text-sm text-muted">
      <span class="flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm" style="background: var(--viz-1)" />
        tényleges
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm" style="background: var(--viz-estimate)" />
        becsült
      </span>
    </div>
    <VisXYContainer :data="runs" :height="260">
      <VisGroupedBar
        :x="x"
        :y="y"
        :color="color"
        :rounded-corners="4"
        :group-padding="0.2"
        :bar-padding="0.1"
        :events="events"
        cursor="pointer"
      />
      <VisAxis type="x" :tick-format="tickFormat" :num-ticks="Math.min(runs.length, 10)" :grid-line="false" />
      <VisAxis type="y" :tick-format="(v: number) => `$${v.toFixed(2)}`" />
      <VisTooltip :triggers="{ [GroupedBar.selectors.bar]: tooltip }" />
    </VisXYContainer>
  </div>
</template>
```

- [ ] **7. lépés: a csatornagrafikon.** Új
  `web/app/components/reports/ChannelCostChart.client.vue`:

```vue
<script setup lang="ts">
import { StackedBar } from '@unovis/ts'
import { VisAxis, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import type { ChannelReport } from 'transcript-refinery'

const props = defineProps<{ channels: ChannelReport[]; series: string[] }>()

// A vízszintes sáv az első elemet alulra teszi: fordítva a legdrágább kerül felülre.
const rows = computed(() => [...props.channels].reverse())

const x = (_: ChannelReport, i: number): number => i
const y = computed(() => props.series.map((s) => (d: ChannelReport) => d.costBySeries[s] ?? 0))
const color = (_: ChannelReport, i: number): string => seriesColor(props.series[i] ?? '')

const tickFormat = (i: number): string => {
  const name = rows.value[Math.round(i)]?.channel ?? ''
  return name.length > 24 ? `${name.slice(0, 23)}…` : name
}

/**
 * A halmozott sáv szelete becsomagolva kapja az adatot: a sor a `datum`, a
 * rámutatott sorozat indexe a `stackIndex`.
 */
interface StackedDatum {
  datum: ChannelReport
  stackIndex: number
}

function tooltip({ datum: d, stackIndex }: StackedDatum): string {
  const hovered = props.series[stackIndex]
  const lines = props.series
    .filter((s) => (d.costBySeries[s] ?? 0) > 0)
    .map((s) => {
      const line = `${seriesLabel(s)}: ${formatUsd(d.costBySeries[s] ?? 0)}`
      return s === hovered ? `<strong>${line}</strong>` : line
    })
  const translations = Object.entries(d.translationCost)
    .filter(([, cost]) => cost > 0)
    .map(([kind, cost]) => `&nbsp;&nbsp;${escapeHtml(kind)}: ${formatUsd(cost)}`)
  return [`<strong>${escapeHtml(d.channel ?? '')}</strong>`, ...lines, ...translations].join('<br>')
}
</script>

<template>
  <div>
    <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <span v-for="s in series" :key="s" class="flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm" :style="{ background: seriesColor(s) }" />
        {{ seriesLabel(s) }}
      </span>
    </div>
    <VisXYContainer :data="rows" :height="Math.max(160, channels.length * 28 + 40)">
      <VisStackedBar
        :x="x"
        :y="y"
        :color="color"
        orientation="horizontal"
        :rounded-corners="4"
        :bar-padding="0.25"
      />
      <VisAxis type="y" :tick-format="tickFormat" :num-ticks="channels.length" :grid-line="false" />
      <VisAxis type="x" :tick-format="(v: number) => `$${v.toFixed(2)}`" />
      <VisTooltip :triggers="{ [StackedBar.selectors.bar]: tooltip }" />
    </VisXYContainer>
  </div>
</template>
```

- [ ] **8. lépés: az oldal.** Új `web/app/pages/reports.vue`:

```vue
<script setup lang="ts">
import type { ChannelReport } from 'transcript-refinery'

const { data, error } = await useFetch('/api/reports')
const toast = useToast()

const channelsWithCost = computed(() =>
  (data.value?.channels ?? [])
    .filter((c) => c.channel !== null && (c.costUsd ?? 0) > 0)
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)),
)

const quality = computed(() =>
  (data.value?.channels ?? [])
    .filter((c) => c.quality.scored > 0)
    .sort(
      (a, b) =>
        b.quality.below / b.quality.scored - a.quality.below / a.quality.scored ||
        b.quality.scored - a.quality.scored,
    ),
)

const channelName = (c: ChannelReport): string => c.channel ?? '(csatorna nélkül)'

const itemsLink = (c: ChannelReport, kind: string): string =>
  `/items?${new URLSearchParams({ channel: c.channel ?? '', kind }).toString()}`

async function copy(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    toast.add({ title: 'Parancs a vágólapon', description: command, color: 'success' })
  } catch {
    toast.add({ title: 'A vágólapra másolás nem sikerült', description: command, color: 'error' })
  }
}

const captionText = (c: ChannelReport): string =>
  `szerzői ${c.captions.creator} · automatikus ${c.captions.auto}`
</script>

<template>
  <div class="space-y-8">
    <h1 class="text-2xl font-semibold">Riport</h1>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <UAlert
        v-if="!data.hasState"
        color="neutral"
        variant="subtle"
        title="Még nincs feldolgozott elem"
        :description="`${data.kpis.videos} felderített elem vár feldolgozásra.`"
      />

      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <UCard>
          <p class="text-xs text-muted uppercase">Videók</p>
          <p class="text-2xl font-semibold">{{ data.kpis.videos }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Csatornák</p>
          <p class="text-2xl font-semibold">{{ data.kpis.channels }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Szószám</p>
          <p class="text-2xl font-semibold">{{ formatWords(data.kpis.words) }}</p>
          <p class="text-xs text-muted">{{ data.kpis.transcribed }} átiratolt elemen</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Tényleges költés</p>
          <p class="text-2xl font-semibold">{{ formatUsd(data.kpis.spentUsd) }}</p>
          <p class="text-xs text-muted">
            a sikeres finomítások minden futásban, az újrafuttatásokkal együtt; a hibára futott
            hívások nélkül
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">A vault-tartalom költsége</p>
          <p class="text-2xl font-semibold">{{ formatUsd(data.kpis.vaultCostUsd) }}</p>
          <p class="text-xs text-muted">műtermékenként az utolsó futás</p>
          <p v-if="data.kpis.missingCost > 0" class="text-xs text-muted">
            {{ data.kpis.missingCost }} műterméknél nincs rögzített költség
          </p>
        </UCard>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Költés futásonként</h2>
        <p v-if="data.runs.length === 0" class="text-muted">Még nincs költséggel járó futás.</p>
        <template v-else>
          <ClientOnly>
            <ReportsRunCostChart :runs="data.runs" />
            <template #fallback>
              <p class="text-muted">Grafikon betöltése…</p>
            </template>
          </ClientOnly>
          <UCollapsible>
            <UButton variant="link" label="Adatok táblázatban" icon="i-lucide-table" />
            <template #content>
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left">
                    <th class="py-1 pr-4">indulás</th>
                    <th class="py-1 pr-4">parancs</th>
                    <th class="py-1 pr-4">tényleges</th>
                    <th class="py-1 pr-4">becsült</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="run in data.runs" :key="run.runId" class="border-t border-default">
                    <td class="py-1 pr-4">
                      <NuxtLink :to="`/runs/${run.runId}`" class="underline">
                        {{ formatDate(run.startedAt) }}
                      </NuxtLink>
                    </td>
                    <td class="py-1 pr-4 font-mono">{{ run.command ?? '–' }}</td>
                    <td class="py-1 pr-4">{{ formatUsd(run.spentUsd) }}</td>
                    <td class="py-1 pr-4">
                      {{ run.estimateUsd === null ? '–' : formatUsd(run.estimateUsd) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </UCollapsible>
        </template>
        <p v-if="data.invalidLogLines > 0" class="text-sm text-muted">
          {{ data.invalidLogLines }} értelmezhetetlen naplósor kimaradt.
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Költség csatornánként</h2>
        <p v-if="channelsWithCost.length === 0" class="text-muted">
          Még nincs rögzített költség.
        </p>
        <template v-else>
          <ClientOnly>
            <ReportsChannelCostChart :channels="channelsWithCost" :series="data.series" />
            <template #fallback>
              <p class="text-muted">Grafikon betöltése…</p>
            </template>
          </ClientOnly>
          <UCollapsible>
            <UButton variant="link" label="Adatok táblázatban" icon="i-lucide-table" />
            <template #content>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left">
                      <th class="py-1 pr-4">csatorna</th>
                      <th v-for="s in data.series" :key="s" class="py-1 pr-4">
                        {{ seriesLabel(s) }}
                      </th>
                      <th class="py-1 pr-4">összesen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="c in channelsWithCost"
                      :key="channelName(c)"
                      class="border-t border-default"
                    >
                      <td class="py-1 pr-4">{{ channelName(c) }}</td>
                      <td v-for="s in data.series" :key="s" class="py-1 pr-4">
                        {{ formatUsd(c.costBySeries[s] ?? 0) }}
                      </td>
                      <td class="py-1 pr-4">{{ formatUsd(c.costUsd ?? 0) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </UCollapsible>
        </template>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Minőség csatornánként</h2>
        <p v-if="quality.length === 0" class="text-muted">Még nincs pontozott jegyzet.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="py-1 pr-4">csatorna</th>
                <th class="py-1 pr-4">átlagpontszám</th>
                <th class="py-1 pr-4">pontozott</th>
                <th class="py-1 pr-4">küszöb alatt</th>
                <th class="py-1 pr-4">arány</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in quality" :key="channelName(c)" class="border-t border-default">
                <td class="py-1 pr-4">{{ channelName(c) }}</td>
                <td class="py-1 pr-4">{{ formatScore(c.quality.meanScore) }}</td>
                <td class="py-1 pr-4">{{ c.quality.scored }}</td>
                <td class="py-1 pr-4">{{ c.quality.below }}</td>
                <td class="py-1 pr-4">{{ formatRatio(c.quality.below, c.quality.scored) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Csatorna-katalógus</h2>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="A parancs valódi költséggel fut; a run indításkor becslést mutat."
          description="A refinery globális parancsot feltételezi — amíg nincs telepítve, cseréld node dist/cli.js-re, és a repó gyökeréből futtasd (#72)."
        />
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="py-1 pr-4">csatorna</th>
                <th class="py-1 pr-4">videó</th>
                <th class="py-1 pr-4">szószám</th>
                <th class="py-1 pr-4">nyelv</th>
                <th class="py-1 pr-4">felirat</th>
                <th class="py-1 pr-4">költség</th>
                <th v-for="kind in data.kinds" :key="kind" class="py-1 pr-4">
                  {{ kindLabel(kind) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in data.channels" :key="channelName(c)" class="border-t border-default">
                <td class="py-1 pr-4">{{ channelName(c) }}</td>
                <td class="py-1 pr-4">{{ c.videos }}</td>
                <td class="py-1 pr-4">{{ formatWords(c.words) }}</td>
                <td class="py-1 pr-4">
                  {{ c.languages.map((l) => l.code).join(', ') || '–' }}
                </td>
                <td class="py-1 pr-4 whitespace-nowrap">{{ captionText(c) }}</td>
                <td class="py-1 pr-4">{{ c.costUsd === null ? '–' : formatUsd(c.costUsd) }}</td>
                <td v-for="kind in data.kinds" :key="kind" class="py-1 pr-4 whitespace-nowrap">
                  <template v-if="c.coverage[kind]">
                    <NuxtLink
                      v-if="c.channel !== null"
                      :to="itemsLink(c, kind)"
                      class="underline"
                    >
                      {{ coverageText(c.coverage[kind]) }}
                    </NuxtLink>
                    <span v-else>{{ coverageText(c.coverage[kind]) }}</span>
                    <UButton
                      v-if="c.coverage[kind].command"
                      size="xs"
                      variant="ghost"
                      icon="i-lucide-clipboard-copy"
                      :aria-label="`Parancs másolása: ${c.coverage[kind].command}`"
                      :title="c.coverage[kind].command"
                      @click="copy(c.coverage[kind].command)"
                    />
                    <UTooltip
                      v-else-if="c.channel === null && c.coverage[kind].done < c.coverage[kind].total"
                      text="A --channel metaadat nélküli elemre nem illik."
                    >
                      <UIcon name="i-lucide-info" class="ml-1 align-middle text-muted" />
                    </UTooltip>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="grid gap-6 md:grid-cols-2">
        <div class="space-y-3">
          <h2 class="text-lg font-semibold">Legdrágább videók</h2>
          <p v-if="data.topCost.length === 0" class="text-muted">Még nincs rögzített költség.</p>
          <ol v-else class="space-y-1 text-sm">
            <li v-for="item in data.topCost" :key="item.itemId" class="flex justify-between gap-3">
              <NuxtLink :to="`/items/${encodeURIComponent(item.itemId)}`" class="underline">
                {{ item.title }}
              </NuxtLink>
              <span class="whitespace-nowrap text-muted">{{ formatUsd(item.value) }}</span>
            </li>
          </ol>
        </div>
        <div class="space-y-3">
          <h2 class="text-lg font-semibold">Leghosszabb videók</h2>
          <p v-if="data.topLong.length === 0" class="text-muted">Még nincs átiratolt elem.</p>
          <ol v-else class="space-y-1 text-sm">
            <li v-for="item in data.topLong" :key="item.itemId" class="flex justify-between gap-3">
              <NuxtLink :to="`/items/${encodeURIComponent(item.itemId)}`" class="underline">
                {{ item.title }}
              </NuxtLink>
              <span class="whitespace-nowrap text-muted">{{ formatWords(item.value) }} szó</span>
            </li>
          </ol>
        </div>
      </section>
    </template>
  </div>
</template>
```

- [ ] **9. lépés: a menüpont.** A `web/app/layouts/default.vue`-ban az
  `{ label: 'Elemek', icon: 'i-lucide-list', to: '/items' },` sor után:

```ts
  { label: 'Riport', icon: 'i-lucide-chart-column', to: '/reports' },
```

- [ ] **10. lépés: futtasd, menjen át.**

Run: `pnpm web:test 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: 21 passed.

- [ ] **11. lépés: teljes ellenőrzés.**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm web:typecheck && pnpm web:lint`
Expected: minden zöld, tiszta.

- [ ] **12. lépés: képernyőkép a valódi korpuszon.** A Claude-in-Chrome
  bővítménynek a próbán nem volt engedélye a `localhost`/`127.0.0.1`
  oldalra, és a fejlesztői szerver HMR-je a headless Chrome-ot megakasztja —
  ezért production build + headless Chrome:

```bash
pnpm build && pnpm --filter transcript-refinery-web exec nuxt build
(cd web && HOST=127.0.0.1 PORT=4311 node .output/server/index.mjs &)
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
perl -e 'alarm 60; exec @ARGV' "$C" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1400,1900 --virtual-time-budget=6000 --user-data-dir=/tmp/rr-light \
  --blink-settings=preferredColorScheme=1 --screenshot=/tmp/reports-light.png http://127.0.0.1:4311/reports
perl -e 'alarm 60; exec @ARGV' "$C" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1400,1900 --virtual-time-budget=6000 --user-data-dir=/tmp/rr-dark \
  --blink-settings=preferredColorScheme=0 --screenshot=/tmp/reports-dark.png http://127.0.0.1:4311/reports
pkill -f "web/.output/server/index.mjs"
```

Expected (a képet nézd meg, Read-del): mindkét módban a két grafikon
kirajzolódik; a rács halvány, nem világít; a „tényleges" kék és a „becsült"
szürke jól elválik; a csatornasáv legdrágábbja felül van; a tengelyfeliratok
nem ütköznek; nincs vízszintes túlcsordulás. (A `.output` build-kimenet, a
`.gitignore` fedi.)

- [ ] **13. lépés: commit** (`Refs #74`):

```
feat(web): Add reports page with cost charts

- Show KPIs, run and channel cost charts with unovis
- Add channel quality table and catalog with copy buttons
- List most expensive and longest videos
- Mirror each chart as a data table
```

---

### Task 4: Dokumentáció, spec-átvezetés és élő ellenőrzés

**Fájlok:**
- Módosít: `README.md`
- Módosít: `docs/architecture.md`
- Módosít: `docs/plans/2026-09-24-riport-oldal-spec.md`

- [ ] **1. lépés: README.** A „A felület (`mise exec -- pnpm web`, …) csak
  olvas." bekezdés végére (a „…SSE-n." mondat után) új mondat:

```markdown
A riportoldal (`/reports`) csatornánként összesíti a korpuszt, a költést és a
jegyzetek minőségét, két grafikonnal (költés futásonként, költség csatornánként
receptre bontva); a hiányzó (csatorna, recept) párokhoz vágólapra másolható
`refinery run` parancsot ad — elindítani a CLI-ből kell.
```

  A „### Webes felület (Web UI)" szakaszban a „A felület a
  `http://127.0.0.1:4310` címen érhető el." sor után:

```markdown
Oldalai: áttekintő, elemek (szűrők URL-ből is: `/items?channel=<név>&kind=<típus>`),
riport, hibák, futások.
```

- [ ] **2. lépés: architektúra.** A `docs/architecture.md`-ben a „A CLI `list`
  parancsa ugyanezt az olvasó réteget használja (`readItems()`): …" bekezdés
  után:

```markdown
A felület riportoldala is erre épül (`readReports()`, `src/view/reports.ts`):
a `buildItemRows()` celláiból csatornánként összesít, a futásnaplókból
(`readRuns()`) a tényleges költést adja. A két költségszám szándékosan
különbözik: a futásnapló az `item:refined` események összege, minden
újrafuttatással; az állapottár műtermékenként csak az utolsó futás költségét
tartja.
```

- [ ] **3. lépés: a spec átvezetése.** A spec „Amit a tervezés előtt
  megmértünk" részében a `flashcards`-mondatot javítsd a valóságra („a `NULL`
  költségű rekordok mind `failed`; kész, költség nélküli fizetős műtermék
  nincs"), és a spec végére új szakasz:

```markdown
## A tervben rögzített eltérések

A terv (`2026-09-24-riport-oldal.md`) próbája alapján: a nyelvkód elsőként a
felderítésből jön; a becslés színe semleges szürke; az unovis témája
`:root:root` szelektorral kapja a Nuxt UI tokenjeit; a vízszintes sáv
megfordítva, a legdrágább felül; a `null` költség a katalógusban `–`; új
exportok: `TOP_LIMIT`, `CoverageCell`, a `readReports` `isAlive` paramétere;
a tooltip szövege `escapeHtml`-lel készül.
```

- [ ] **4. lépés: élő számellenőrzés (pénzt nem költ).** A repó gyökeréből
  (#72: más mappából a relatív útvonalak mást jelentenek), a production
  szerver futása mellett (Task 3, 12. lépés):

```bash
curl -s http://127.0.0.1:4311/api/reports | jq '.kpis'
cat logs/*.jsonl | jq -s '[.[] | select(.type=="item:refined") | .usd] | add'
sqlite3 -readonly .state/refinery.db "SELECT sum(cost_usd) FROM artifacts WHERE kind NOT IN ('transcript','–')"
node dist/cli.js list --channels | tail -3
```

Expected: a `spentUsd` = a `jq`-összeg, a `vaultCostUsd` = az `sqlite`-összeg
(lebegőpontos kerekítésen belül); a katalógus `summary` oszlopának
`kész`-összege = a `list --channels` `Összesen` sorának `sum` értéke.

- [ ] **5. lépés: interaktív ellenőrzés böngészőben.** A headless kép a
  tooltipet, a kattintást és a vágólapot nem fedi. A Claude-in-Chrome
  bővítménnyel **`http://localhost:4311/reports`** (a `127.0.0.1` alakot a
  bővítmény „browser-internal URL"-ként elutasítja), vagy ha a bővítmény nem
  elérhető, a felhasználóval:
  1. a futásoszlop tooltipje a parancssort, a tényleges/becsült összeget és az
     arányt mutatja; kattintásra a `/runs/<id>` oldal nyílik;
  2. a csatornasáv tooltipje a csatornát, a rámutatott sorozatot félkövéren
     és a fordítást típusonként bontva mutatja (ha üres, a `StackedDatum`
     kicsomagolása hiányzik);
  3. egy 📋 gomb után „Parancs a vágólapon" toast jelenik meg, és a
     `pbpaste` pontosan a `refinery run --recipe … --channel '…'` parancsot
     adja. **A vágólapot ne a böngészőből olvasd vissza**
     (`navigator.clipboard.readText()` engedélykérést nyit, ami a lapot
     megakasztja);
  4. egy katalóguscellára kattintva az `/items` a csatornára és típusra
     szűrve nyílik, és az „N / M elem" sor egyezik a cella összesével.

- [ ] **6. lépés: commit** (`Refs #74`):

```
docs: Document reports page and plan deviations

- Describe /reports in README and architecture
- Record plan deviations in the spec
```
