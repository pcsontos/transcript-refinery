# Spec — A webes riportoldal (`/reports`)

**Dátum:** 2026-09-24 · **Státusz:** jóváhagyásra vár · **Issue:** #74

Ez a dokumentum a backlog 6. szakaszának első szeletét specifikálja: a
„Riport és Katalógus oldal" és a „Költségelemzési grafikonok" tételt, **csak a
már rögzített adatokból**. A szakasz többi tétele külön spec–terv kört kap,
vagy kimarad:

| backlog-tétel | sorsa |
|---|---|
| Riport és Katalógus oldal | **ez a spec**, tokenek és draft/judge-bontás nélkül |
| Költségelemzési grafikonok | **ez a spec**: futásonként és csatornánként |
| Recept- és forrásszűrők | az `/items` oldalon nagyrészt megvannak; ez a spec URL-paraméterrel tölthetővé teszi őket |
| Tokenek, draft/judge-arány | későbbi szelet: sémabővítés kell hozzá (az `artifacts` csak `cost_usd`-t és `model`-t tárol) |
| Interaktív queue-menedzsment | későbbi szelet: előbb a `0011`-es döntési rekordot kell felülvizsgálni |
| Diff nézet | későbbi, önálló szelet |

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

Egy csak olvasó oldal, amely megmutatja, **mi van a korpuszban**, **hol megy el
a pénz**, **milyen minőségű jegyzet születik csatornánként**, és **mit kell még
futtatni** — az utóbbihoz csatornánként és receptenként vágólapra másolható
`refinery run` paranccsal.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Mire kell | **Mind a négy**: mit futtassak még, hol megy el a pénz, mi van a korpuszban, minőség csatornánként | A felhasználó választása |
| Tokenek, draft/judge-bontás | **Kimarad** | Nincs rögzítve; a sémabővítés külön szelet |
| Költségbecslés a hiányzókra | **Nincs**, csak darabszám | A felhasználó választása; a `run` indításkor úgyis becsül |
| Grafikonok | **Költés futásonként, időben**; **költség csatornánként receptre bontva** | A felhasználó választása |
| Pontszám csatornánként | **Táblázat**, nem grafikon | 19–27 csatorna; a dataviz-szabály 7 osztály fölött táblázatot kér |
| Fordítások a halmozott sávban | **Egy közös „fordítás" sorozat** (6 alaprecept + 1 = 7 szín) | A felhasználó választása; 10 külön szín a 8-as plafon fölött van |
| Grafikonkönyvtár | **`@unovis/vue` + `@unovis/ts` 1.7.0**, csak a `web/`-ben | A felhasználó választása; a Nuxt UI hivatalos dashboard-sablonja ugyanezt használja ugyanazzal a `@nuxt/ui ^4.11.1`-gyel |
| A logika helye | **A magban** (`src/view/reports.ts`), a felület csak kirajzol | A `0011` mintája: tesztelhető mag, vékony felület |
| Lefedettségi mátrix | **Nem épül újra**; a katalógus cellái az `/items`-re linkelnek szűrve | Az `/items` már videó × recept mátrix |
| A parancs előtagja | **`refinery`** | A felhasználó választása, a #72 utáni globális parancsra készül |
| Videóhossz | **Szószám** helyette | Időtartamot nem tárolunk; becsült percet nem találunk ki |
| PR-szerkezet | **Két PR egymás után**: előbb spec + terv, majd a kód a friss `main`-ről | A korábbi szeletek mintája |

## Amit a tervezés előtt megmértünk és ellenőriztünk

- **A típusok.** A valós konfig (`translate.to: hu`, `recipes: [clean, summary,
  notes, bloom]`) mellett a fizetős típusok: `summary`, `flashcards`, `qa`,
  `clean`, `bloom`, `notes`, `clean-hu`, `summary-hu`, `notes-hu`, `bloom-hu`.
  A `transcript` modellhívás nélkül készül, költsége nincs.
- **Az állapottár (2026-09-24, `.state/refinery.db`).** 19 különböző csatorna
  az `items` táblában; a felderítés 27-et ad. A `NULL` költségű
  rekordok (a 3 `flashcards` és néhány `bloom`, `clean`, `notes`) mind
  `failed`; kész, költség nélküli fizetős műtermék nincs. Egy régi, `–` típusú rekord is van; a
  `buildItemRows()` csak az ismert típusokat olvassa, ezért nem zavar.
- **A futásnaplók.** 41 `.jsonl` a `logs/` alatt. A `readRuns()`
  (`src/view/runs.ts`) futásonként `spentUsd`-t, `startedAt`-et, `command`-ot
  és — ha volt — `estimate.usd`-t ad; az értelmezhetetlen sorokat `invalid`
  számlálja.
- **A két költségszám különbözik, és ez nem hiba.** A futásnapló
  `spentUsd`-je az `item:refined` események `usd`-összege
  (`src/view/live.ts:79`): minden sikeres finomítás, a `--force`
  újrafuttatásokkal együtt — a hibára futott próbálkozás költsége **nincs**
  benne, mert az `item:failed` nem hordoz összeget. Az `artifacts.cost_usd`
  műtermékenként csak az *utolsó* futás költsége. Az oldal mindkettőt a saját
  nevén mutatja, és egyik sem „a teljes LiteLLM-számla".
- **A `run` szűrése.** `--channel` pontos, kis- és nagybetűre érzéketlen
  egyezés (`matchesFilters`, `src/run/plan.ts:35`), metaadat nélküli elemre nem
  illik. A `run` csak a késznek rögzített párokat hagyja ki
  (`src/cli.ts:784`), a hibásakat újrafuttatja.
- **Fordítás mint `--recipe`.** A `recipesFor()` a fordításokat saját kulccsal
  (`summary-hu`) veszi fel; a `recipeFrom()` ezen a kulcson keres, tehát
  `--recipe summary-hu` érvényes.
- **A `refinery` parancs ma nincs a PATH-on** (`which refinery` → not found).
  A generált parancs a #72 (vagy egy `pnpm link --global`) után futtatható
  közvetlenül; addig a felület figyelmeztet.
- **Az unovis kliensoldali.** A dashboard-sablon `.client.vue` komponensben
  rajzol (`HomeChart.client.vue`); SSR alatt a grafikon nem jelenik meg.
- **A színpaletta.** A dataviz-skill referenciapalettájának első 7 slotja a
  validátoron (`validate_palette.js`) átmegy:
  - világos (`--surface #ffffff`): minden ellenőrzés PASS, a kontraszt WARN
    (`#1baf7a` 2,82, `#eda100` 2,17, `#e87ba4` 2,69 — 3:1 alatt) → a
    táblázatnézet kötelező, és ez a spec része;
  - sötét (`--surface #171717`): minden ellenőrzés PASS.

## 1. Az oldal — `web/app/pages/reports.vue`

Új menüpont a `web/app/layouts/default.vue`-ban, az „Elemek" után: **Riport**
(`i-lucide-chart-column`, `/reports`).

Az oldal blokkjai felülről lefelé:

### 1.1 KPI-sor

Stat-csempék (`UCard`), grafikon nélkül:

- **Videók:** felderített elemek száma.
- **Csatornák:** a csatornák száma (a „(csatorna nélkül)" nem számít bele).
- **Szószám:** a normalizált szavak összege, alatta: „<M> átiratolt elemen".
- **Tényleges költés:** a futásnaplók `spentUsd`-összege, alatta: „a sikeres
  finomítások minden futásban, az újrafuttatásokkal együtt; a hibára futott
  hívások nélkül".
- **A vault-tartalom költsége:** az `artifacts.cost_usd` összege, alatta:
  „műtermékenként az utolsó futás"; ha van `NULL` költségű kész műtermék,
  még egy sor: „<N> műterméknél nincs rögzített költség".

### 1.2 Költés futásonként — `RunCostChart.client.vue`

- Függőleges, csoportosított oszlop (`VisXYContainer` + `VisGroupedBar`),
  futásonként két oszlop: **tényleges** (kék, `#2a78d6` / sötétben `#3987e5`)
  és **becsült** (ugyanaz a kék világosabb lépése, `#86b6ef` / sötétben
  `#5598e7`). Egy y-tengely, dollárban.
- Csak a `spentUsd > 0` futások; időrendben (régi balra). A futó futás is
  szerepel, a tooltip jelzi az állapotát.
- Tooltip: futásazonosító, indulás ideje, parancssor, tényleges és becsült
  összeg, arányuk (pl. `1,76×`), állapot.
- Kattintás egy oszlopra → `/runs/<runId>`.
- Jelmagyarázat (2 sorozat).
- Ha egy futás sincs költséggel: „Még nincs költséggel járó futás." szöveg a
  grafikon helyén.
- Ha a `invalid` összege > 0: „<N> értelmezhetetlen naplósor kimaradt." sor a
  grafikon alatt.

### 1.3 Költség csatornánként — `ChannelCostChart.client.vue`

- Vízszintes, halmozott sáv (`VisXYContainer` + `VisStackedBar`,
  `orientation: horizontal`), csatornánként egy sáv, költség szerint
  csökkenő sorrendben; a nulla költségű csatornák kimaradnak.
- 7 sorozat, **rögzített sorrendben és színnel** (a szín a recepthez tartozik,
  nem a helyezéshez; szűrés nem festi át):

  | sorozat | világos | sötét |
  |---|---|---|
  | `summary` | `#2a78d6` | `#3987e5` |
  | `flashcards` | `#eb6834` | `#d95926` |
  | `qa` | `#1baf7a` | `#199e70` |
  | `clean` | `#eda100` | `#c98500` |
  | `bloom` | `#e87ba4` | `#d55181` |
  | `notes` | `#008300` | `#008300` |
  | fordítás (minden `-<nyelv>` típus) | `#4a3aa7` | `#9085e9` |

  Ha a regiszter egy új alapreceptet kap, a 8. slot (`#e34948` / `#e66767`)
  az övé; a kilencedik alapreceptnél a legkisebb költségű sorozatok „egyéb"
  sorozatba olvadnak. Ez a szelet csak a mai 6 + 1 sorozatot teszteli.
- 2 px-es rés a szeletek között (a dataviz másodlagos kódolása a CVD-párokhoz).
- Tooltip: csatorna, a szelet receptje és költsége; a fordítás szeleténél a
  fordítási típusok egyenként.
- Jelmagyarázat (7 sorozat).

### 1.4 Minőség csatornánként

Táblázat (`UTable`), csatornánként: **átlagpontszám** (a pontozott kész
műtermékek átlaga, minden recepten át), **pontozott db**, **küszöb alatti db**
és **arányuk** (`küszöb alatti / pontozott`). A küszöb receptenként más, ezért
a `belowThreshold` jelzőt használja (`buildItemRows()`). Rendezés: a küszöb
alatti arány szerint csökkenő. Pontozott műtermék nélküli csatorna nem
szerepel.

### 1.5 Csatorna-katalógus és parancsgeneráló

Táblázat csatornánként:

- **Csatorna**, **Videó** (db), **Szószám**, **Nyelv(ek)** (vesszővel,
  előfordulás szerint csökkenő), **Felirat** (`szerzői N · automatikus M`),
  **Költség** (a vault-tartalom költsége a csatornán).
- **Típusonként egy cella** a fizetős típusokra (az `artifactKinds()` sorrendjében,
  a `transcript` nélkül): `<kész>/<összes>`, és ha kevesebb a kész:
  `· <hátra> hátra` (ha van hibás: `(ebből <N> hibás)`).
  - A cellára kattintás → `/items?channel=<név>&kind=<típus>`.
  - Ha `kész < összes`, a cellában 📋 gomb: a generált parancsot a vágólapra
    teszi (`navigator.clipboard.writeText`), visszajelzés `useToast()`-tal
    („Parancs a vágólapon").
- A „(csatorna nélkül)" sor a végén; nála nincs parancs, a 📋 helyén a
  tooltip: „A `--channel` metaadat nélküli elemre nem illik."
- Rendezés: videószám szerint csökkenő, azonos számnál név szerint.
- A táblázat fölött állandó figyelmeztetés (`UAlert`, `warning`):
  „A parancs valódi költséggel fut; a `run` indításkor becslést mutat.
  A `refinery` globális parancsot feltételezi — amíg nincs telepítve,
  cseréld `node dist/cli.js`-re, és a repó gyökeréből futtasd (#72)."

### 1.6 Toplisták

Két kis táblázat egymás mellett (mobilon egymás alatt), 10–10 sor, a cím az
elem oldalára linkel:

- **Legdrágább videók:** a vault-tartalom költsége elemenként (a cellák
  `costUsd`-összege), csökkenő; `NULL`-os elem csak akkor, ha van nem-`NULL`
  cellája.
- **Leghosszabb videók:** normalizált szószám szerint, csökkenő; csak
  átiratolt elemek.

Azonos értéknél a cím szerinti sorrend dönt (`byText`).

### 1.7 Akadálymentesség

- Mindkét grafikon alatt `UCollapsible` „Adatok táblázatban": ugyanazok a
  számok táblázatként (a világos mód kontraszt-WARN-ja miatt kötelező).
- A szövegek (értékek, címkék, jelmagyarázat) a Nuxt UI szövegtokenjeit
  használják, soha a sorozat színét.
- A grafikonkomponens `ClientOnly`-ban van; a `fallback` a „Grafikon
  betöltése…" szöveg. Az SSR-HTML tehát a KPI-kat, a táblázatokat és a
  tartalékszöveget tartalmazza.

## 2. A nézetmodell — `src/view/reports.ts` (új)

```ts
export const TRANSLATION_SERIES = 'fordítás'

export interface RunCostPoint {
  runId: string
  startedAt: string | null
  command: string | null
  status: RunStatus
  spentUsd: number
  estimateUsd: number | null
}

export interface ChannelReport {
  /** `null`: metaadat nélküli elemek. */
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
  /** Sorozatonként (6 alaprecept + `TRANSLATION_SERIES`) a költség. */
  costBySeries: Record<string, number>
  /** Fordítási típusonként a költség (a tooltiphez). */
  translationCost: Record<string, number>
  /** Fizetős típusonként. */
  coverage: Record<string, { done: number; failed: number; total: number; command: string | null }>
  quality: { scored: number; below: number; meanScore: number | null }
}

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
    spentUsd: number
    vaultCostUsd: number
    missingCost: number
  }
  runs: RunCostPoint[]
  invalidLogLines: number
  /** A halmozott sáv sorozatai, rögzített sorrendben. */
  series: string[]
  /** A fizetős típusok, az `artifactKinds()` sorrendjében, `transcript` nélkül. */
  kinds: string[]
  channels: ChannelReport[]
  topCost: ItemRank[]
  topLong: ItemRank[]
}

export interface ReportsInput {
  rows: readonly ItemListRow[]
  items: readonly ItemRow[]
  runs: readonly RunSummaryView[]
  registry: Registry
  hasState: boolean
}

export function buildReports(input: ReportsInput): Reports
export async function readReports(cfg: Pick<Config, 'sources' | 'languages' | 'statePath' | 'translate' | 'configPath' | 'logsDir'>): Promise<Reports>
export function shellQuote(value: string): string
export function runCommandFor(kind: string, channel: string): string
```

- **`buildReports`** tiszta függvény, fájlt nem olvas.
  - A csatorna, a cella-állapot, a pontszám, a költség és a `belowThreshold`
    a `buildItemRows()` soraiból (`rows`) jön — így a számok az `/items`
    oldaléval és a `refinery list`-ével azonosak.
  - A szószám, a nyelv és a feliratforrás az állapottár `items` soraiból
    (`wordsNormalized`, `language`, `captionSource`), `itemId` szerint
    illesztve. Állapottári sor nélküli (csak felderített) elemnek ezek
    hiányoznak; a `words`/`transcribed` csak az átiratolt elemeket számolja,
    a nyelvnél a felderítés metaadata sincs meg, ezért ott nem számít.
  - Fordítási típus: a regiszterben szereplő, `-<nyelv>` utótagú típus,
    amelynek alapja is szerepel (ugyanaz a szabály, mint a `kindCodes`-ban,
    `src/view/list.ts`). Költsége a `TRANSLATION_SERIES` sorozatba kerül.
  - A `NULL` költség nem nulla: az összegekbe nem kerül bele, a
    `missingCost` a kész, `NULL` költségű fizetős cellákat számolja.
  - `spentUsd` a `runs` összes `spentUsd`-jének összege; a `runs` kimenet csak a
    `spentUsd > 0` futásokat tartalmazza, időrendben (`startedAt` szerint,
    `null` a végén).
- **`readReports`**: `discoverAll` + `openStateReader` (items, artifacts) +
  `readRuns(cfg)`, majd `buildItemRows` és `buildReports`. Állapottár
  nélkül `hasState: false`, és minden cella „hátra".
- **`shellQuote`**: POSIX egyszeres idézőjel; a benne lévő `'` → `'\''`.
- **`runCommandFor`**: `refinery run --recipe <kind> --channel <shellQuote(channel)>`.
  A `coverage[kind].command` `null`, ha `done === total`, vagy ha a
  csatorna `null`.
- Az `src/index.ts` exportálja a fenti függvényeket és típusokat.

## 3. Az API és az `/items` változása

- **`web/server/api/reports.get.ts`**:
  `defineEventHandler(() => coreHandler((cfg) => readReports(cfg)))` — a
  meglévő útvonalak mintája; hiba esetén a `coreHandler` 500-at ad, az oldal
  az `ErrorAlert`-et mutatja.
- **`web/app/pages/items/index.vue`**: az induló szűrők a `route.query`-ből
  töltődnek (`source`, `channel`, `kind`, `status`). Csak a létező értéket
  veszi át (a `status` a magyar címkét: `kész`, `hibás`, `hátra`); ismeretlen
  vagy hiányzó paraméternél az eddigi alapértelmezés marad. URL-paraméter
  nélkül a viselkedés nem változik. Az URL-t a szűrők változtatása nem írja
  vissza (YAGNI).

## 4. Függőség

`web/package.json` `dependencies`: `@unovis/vue` és `@unovis/ts`, **1.7.0**
(`^1.7.0`). A gyökér-csomag nem kap új függőséget.

## 5. Tesztelés

### 5.1 Mag — `src/view/reports.test.ts` (Vitest, szintetikus bemenet)

- Csatorna-aggregálás: videó, szószám, átiratolt db, nyelvek sorrendje,
  feliratforrás-megoszlás.
- A fordítási típusok költsége a `fordítás` sorozatba kerül, a
  `translationCost` típusonként bontja.
- A `NULL` költség nem nulla: a `costUsd` `null`, ha minden cella `NULL`; a
  `missingCost` számol.
- A `null` csatornánál minden `command` `null`.
- A kész csatorna/típusnál a `command` `null`; hiányosnál a pontos szöveg.
- `shellQuote`: szóköz, aposztróf (`O'Brien` → `'O'\''Brien'`), ékezet.
- A 0 dolláros futás kimarad, a `spentUsd` KPI viszont minden futást összead;
  az időrend, a `null` `startedAt` a végén.
- A toplisták: sorrend, a 10-es vágás, azonos érték → cím szerint.
- A minőség: átlag, küszöb alatti db a `belowThreshold` alapján.
- **Egyezéspróba:** ugyanarra a bemenetre a `coverage[kind].done` minden
  csatornán megegyezik a `summarizeChannels()` (`src/view/list.ts`)
  `done[kind]` értékével, és a `videos` a `ChannelSummary.videos`-szal.
- Minden feladathoz mutációs ellenőrzés: egy szándékos hiba (pl. a fordítás
  az alapreceptbe olvad, a `NULL` nullaként számít) buktassa el a tesztet.

### 5.2 Web e2e — `web/test/e2e/` (a meglévő fixture bővítésével)

- Az `/api/reports` a szintetikus állapotot adja (KPI-k, egy csatorna
  lefedettsége parancs-szöveggel, egy futás a becsléssel).
- A `/reports` SSR-HTML-je tartalmazza a KPI-kat, a katalógus egy sorát és a
  helyesen idézőjelezett parancsot; a grafikon helyén a tartalékszöveget.
- Az `/items?channel=<név>&kind=<típus>` SSR-HTML-je már szűrve jön (a
  „<N> / <M> elem" sor a szűrt számot mutatja).

### 5.3 Kézi ellenőrzés böngészőben, a valódi korpuszon

Modellhívás nélkül, pénzt nem költ:

1. A `/reports` betölt; mindkét grafikon kirajzolódik, a tooltip működik, a
   futásoszlopra kattintás a futás oldalára visz.
2. Sötét módban a sötét paletta jelenik meg, a szöveg olvasható.
3. A 📋 gomb a vágólapra teszi a parancsot; a toast megjelenik.
4. A katalógus egy cellájára kattintva az `/items` a csatornára és típusra
   szűrve nyílik.
5. A „Tényleges költés" KPI egyezik a futásnaplók `item:refined` sorai
   `usd`-mezőjének független összegével
   (`cat logs/*.jsonl | jq -s '[.[] | select(.type=="item:refined") | .usd] | add'`),
   a „vault-tartalom költsége" a
   `SELECT sum(cost_usd) FROM artifacts WHERE kind IN (<a fizetős típusok>)`
   értékével.
6. A képernyőképen nincs címkeütközés és vízszintes túlcsordulás (dataviz
   7. lépés).

## Sikerkritériumok

1. A `/reports` oldal a menüből elérhető, és a fenti hat blokkot mutatja.
2. A katalógus `kész/összes` számai minden csatornán megegyeznek a
   `refinery list --channels` kimenetével ugyanarra az állapotra.
3. A hiányos cella 📋 gombja a `refinery run --recipe <típus> --channel '<név>'`
   parancsot teszi a vágólapra; aposztrófos névvel is helyesen idézőjelezve.
4. A két költség-KPI külön névvel jelenik meg, és mindkettő egyezik a független
   ellenőrzéssel (5.3/5).
5. A `NULL` költségű műtermék sehol sem jelenik meg $0-ként.
6. Az `/items` URL-paraméter nélkül pontosan úgy viselkedik, mint eddig.
7. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm web:test`,
   `pnpm web:typecheck`, `pnpm web:lint` zöld.

## A szeleten kívül (YAGNI)

Tokenszámok és draft/judge-bontás, becsült költség a hiányzókra, futás
indítása a böngészőből, dátumszűrő, export (CSV/JSON), az `/items` URL-jének
visszaírása szűrésváltáskor, a `refinery` globális telepítése (#72).

## A tervben rögzített eltérések

A terv (`2026-09-24-riport-oldal.md`) próbája alapján: a nyelvkód elsőként a
felderítésből jön; a becslés színe semleges szürke; az unovis témája
`:root:root` szelektorral kapja a Nuxt UI tokenjeit; a vízszintes sáv
megfordítva, a legdrágább felül; a `null` költség a katalógusban `–`; új
exportok: `TOP_LIMIT`, `CoverageCell`, a `readReports` `isAlive` paramétere;
a tooltip szövege `escapeHtml`-lel készül.
