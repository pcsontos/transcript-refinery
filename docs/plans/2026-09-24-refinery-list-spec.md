# Spec — A `refinery list` parancs

**Dátum:** 2026-09-24 · **Státusz:** jóváhagyásra vár · **Issue:** #67

Ez a dokumentum a backlog 2.7 tételét specifikálja, szűkítve: a gépi kimenet
(`--format`) és a rendezés (`--sort`) kimarad, a táblázat a meglévő,
felülethez írt elemlistára épül.

A webes riportoldal (backlog 6) külön spec–terv kört kap.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A `refinery list` SQLite-lekérdezés nélkül, a terminálban megmutatja egy
csatorna vagy forrás videóit receptenkénti állapottal, csatornánként
összesíti a lefedettséget, és megtalálja, min nem futott még (vagy bukott el)
egy recept — pontosan azokkal a számokkal, amiket a felület és a `run`
riportja mutat.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Mire kell | **Egy csatorna áttekintése, csatorna-összesítő, hiányzók megkeresése** | A felhasználó választása; a csővezetékbe kötés nem szerepelt köztük |
| Gépi kimenet (`--format json\|csv\|paths`) | **Kimarad** | YAGNI: egyik kiválasztott használati eset sem kéri |
| Rendezés (`--sort`) | **Kimarad**; a felderítés sorrendje marad | A felület is ezt mutatja; a hiányzók keresése nem igényel mást |
| Adatforrás | **A meglévő `readItems()` (`src/view/items.ts`)**, nem új SQL | A „hátra" állapotú elemek egy része csak a felderítésből ismert, az állapottárban nincs sora; így a számok a felületével azonosak |
| Az elemlista sorképe | **Mátrix jelekkel**: típusonként egy keskeny oszlop, `--recipe` mellett egy recept részletei | A felhasználó választása; 11 típus pontszámmal nem fér ki |
| A csatorna-összesítő lefedettsége | **Típusonként `kész/összes`** | A felhasználó választása; megmutatja, mi hiányzik, nem csak mennyi |
| `--status` `--recipe` nélkül | **Bármely típusra illik** | A felhasználó választása |
| Kimeneti réteg | **Saját oszlopigazító**, függőség nélkül | Egy táblázathoz nem éri meg a `cli-table3` |
| PR-szerkezet | **Két PR egymás után**: előbb spec + terv, majd a kód a friss `main`-ről | A korábbi szeletek mintája |

## Amit a tervezés előtt megmértünk és ellenőriztünk

- **A típusok száma.** A `readItems()` a valós konfiggal 11 típust ad, ebben a
  sorrendben: `transcript`, `summary`, `flashcards`, `qa`, `clean`, `bloom`,
  `notes`, `clean-hu`, `summary-hu`, `notes-hu`, `bloom-hu`
  (`artifactKinds()`: az átirat, a regiszter receptjei, majd a fordítások).
- **A korpusz mérete (2026-09-24).** A felderítés 166 elemet ad 27 csatornával.
  Mindnek van csatornája, és egyiknek sem tűnt el a felirata. Az állapottár
  ugyanekkor 17 elemet ismert. A felhasználó közben futtat, ezért a
  sikerkritériumok nem rögzített élő számokra épülnek, hanem arra, hogy két
  nézet ugyanarra az állapotra ugyanazt mondja.
- **A szűrés.** A `run` szűrése (`matchesFilters`, `src/run/plan.ts:35`)
  pontos, kis- és nagybetűre érzéketlen egyezést vár. Metaadat nélküli elemre
  a `--channel` nem illik.
- **Offline futás.** A `validateConfig` csak helyi mappákat ellenőriz, és a
  `readItems()` sem hív hálózatot. A `list` így `LITELLM_API_KEY` nélkül is
  fut, ahogy a `scan`.
- **Egy régi rekord.** Az állapottárban van egy `–` típusú `done` rekord
  2026-09-11-ről. A `readItems()` csak az ismert típusokat olvassa, ezért a
  listában nem jelenik meg; ezzel nincs teendő.

## 1. A parancs — `src/cli.ts`

```
refinery list [--config <út>] [--source <név>] [--channel <név>]
              [--recipe <típus>] [--status done|failed|pending]
              [--channels] [--limit <szám>]
```

- A `parseArgs` két új kapcsolót kap: `status` (string) és `channels`
  (boolean, alapból `false`). A többi már megvan.
- A `USAGE` a parancsok közé felveszi a `list` sort, a kapcsolók közé pedig a
  `--status`-t és a `--channels`-t.
- A `commandList(cfg, opts)` meghívja a `readItems(cfg)`-t, a sorokat a
  `src/view/list.ts` függvényeivel szűri és rendereli, majd az eredményt
  egyetlen `console.log`-gal írja ki.
- **Csak olvas.** Nem ír fájlt, nem hoz létre állapotfájlt, nem commitol és
  nem hív modellt. Ha nincs állapottár, a `readItems()` minden cellát
  „hátra"-ként ad.
- **Hibák.** A parancs 1-es kilépési kóddal áll le, a hibaüzenet a
  stderr-re megy:
  - ismeretlen `--recipe` → `Ismeretlen típus: <x>. Ismert típusok: transcript, summary, …`;
  - érvénytelen `--status` → `A --status értéke done, failed vagy pending lehet.`;
  - `--recipe` és `--channels` együtt → `A --channels minden típust mutat; a --recipe mellette nem használható.`;
  - a `--limit` nem pozitív egész szám → `A --limit pozitív egész szám.`
- **Üres eredmény.** Ha a szűrés után nem marad sor, a kimenet
  `Nincs a szűrőnek megfelelő elem.`, a kilépési kód 0.

## 2. A nézet — `src/view/list.ts` (új)

Tiszta függvények. Nem olvasnak fájlt és nem nyitnak állapottárat. Bemenetük
az `ItemListRow[]` és a típusok listája.

### Szűrés

```ts
export interface ListFilters {
  source?: string
  channel?: string
  recipe?: string
  status?: CellStatus
  limit?: number
}

export function filterRows(rows: readonly ItemListRow[], filters: ListFilters): ItemListRow[]
```

- A szűrők sorrendje: forrás → csatorna → státusz → `limit`.
- A forrás és a csatorna a `matchesFilters` szabályát követi: pontos,
  kis- és nagybetűre érzéketlen egyezés. `null` csatornára a `--channel` nem
  illik.
- A státusz:
  - `recipe` mellett a `cells[recipe].status` egyezése dönt;
  - `recipe` nélkül az dönt, hogy **bármely** cella állapota egyezik-e.
- A küszöb alatti kész elem (`belowThreshold`) `done` állapotú.
- A `limit` a szűrt sorok elejét tartja meg.
- A sorrend nem változik: előbb a felderítés sorrendje, utána az eltűnt
  feliratú elemek cím szerint, ahogy a `buildItemRows` adja.

### Oszlopkódok

```ts
export function kindCodes(kinds: readonly string[]): Record<string, string>
```

- Alaprecept: az azonosító első 3 karaktere (`tra`, `sum`, `fla`, `qa`,
  `cle`, `blo`, `not`). A 3 karakternél rövidebb azonosító változatlan
  marad.
- Fordítás (a `-<nyelv>` utótagú típus, amelynek az alapja is szerepel a
  listában): `<alapkód>-<nyelv>` (`cle-hu`).
- Ütközés esetén (két típusnak ugyanaz lenne a kódja) mindkettő a teljes
  azonosítót kapja.

### Az elemlista

```ts
export function renderItemTable(
  rows: readonly ItemListRow[],
  kinds: readonly string[],
  opts: { recipe?: string; showChannel: boolean; titleWidth: number; filterNote: string },
): string
```

- **Első sor:** `<N> elem`. Ha van szűrő, utána zárójelben a `filterNote`,
  pl. `3 elem (csatorna: Sajjaad Khader)`.
- **Oszlopok, balról jobbra:**
  - `#`: egytől számozva, jobbra igazítva;
  - `Cím`: `titleWidth` karakterre vágva, a vágott cím végén `…`; az eltűnt
    feliratú elem (`discovered: false`) címe elé `† ` kerül;
  - `Csatorna`: csak ha `showChannel` igaz (vagyis nincs `--channel`),
    legfeljebb 16 karakter, a vágott név végén `…`, `null` csatornánál `—`;
  - típusonként egy jeloszlop a kódjával: `✓` kész, `↓` kész, de a recept
    küszöbe alatt, `✗` hibás, `·` hátra;
  - `$`: az elem összes cellájának `costUsd`-összege 4 tizedessel; ha egyik
    cellának sincs költsége, `—`.
- **`--recipe X` mellett** a jeloszlopok helyett három oszlop áll:
  - `X`: `kész`, `kész ↓`, `hibás` vagy `hátra`;
  - `Pont`: a pontszám 2 tizedessel, vagy `—`;
  - `$`: X költsége 4 tizedessel, vagy `—`.
- **Jelmagyarázat** a táblázat alatt:
  - `✓ kész  ↓ küszöb alatt  ✗ hibás  · hátra  † a felirat eltűnt`;
  - a kódok feloldása, pl. `tra = transcript, sum = summary, …, cle-hu = clean-hu`.
  A `--recipe` nézetben csak a `†` magyarázata marad, és csak akkor, ha van
  eltűnt feliratú sor.
- Az oszlopokat egy szóköz választja el. A szélesség a látható karakterek
  száma (`[...str].length`); a széles (CJK, emoji) karaktereket ez a szelet
  nem kezeli külön.

### A csatorna-összesítő

```ts
export interface ChannelSummary {
  channel: string | null
  videos: number
  /** Típusonként a kész (`done`, a küszöb alattiakkal együtt) elemek száma. */
  done: Record<string, number>
  costUsd: number
}

export function summarizeChannels(rows: readonly ItemListRow[], kinds: readonly string[]): ChannelSummary[]
export function renderChannelTable(summaries: readonly ChannelSummary[], kinds: readonly string[]): string
```

- A `summarizeChannels` a már szűrt sorokat csoportosítja csatorna szerint.
  A `--limit` itt nem érvényes: a `commandList` `--channels` mellett a limit
  nélkül szűr.
- A sorrend: a csatornák név szerint (`byText`, mint a `buildItemRows`-ban),
  a `null` csatorna `(nincs csatorna)` néven a végén.
- **Oszlopok:** `Csatorna`, `Videó`, típusonként `<kész>/<videó>` a kódjával,
  `$` (összköltség 4 tizedessel; `—`, ha a csoportban egyik cellának sincs költsége).
- Az utolsó sor `Összesen`: a videók, a típusonkénti kész számok és a
  költség összege.
- Alatta a kódok feloldása, mint az elemlistánál.

### A címszélesség

A `commandList` számolja ki:

- TTY-n (`process.stdout.isTTY`): `process.stdout.columns` mínusz a többi
  oszlop szélessége, legalább 20;
- nem TTY-n (csővezeték, fájl): 40.

## Megkötések

- Új függőség nincs.
- Az állapottár sémája és a `src/state/queries.ts` nem változik.
- A `readItems()` és a `buildItemRows()` viselkedése nem változik; a webes
  felület kimenete bájtra azonos.
- A `list` nem ír sehova, csak a stdout-ra és a stderr-re.
- A `scan`, a `run` és a `check-pricing` kimenete és kapcsolói nem változnak.

## Sikerkritériumok

A megfigyelhető viselkedés, nem a fájl tartalma:

1. A valós konfiggal a `list --channels` `Összesen` sorában a `sum` oszlop
   kész száma egyenlő a `summary` típusú `done` rekordok számával, amit
   ugyanarra az állapotra egy csak olvasó `sqlite3` lekérdezés ad. A `Videó`
   összesen egyenlő a `scan` által jelzett elemszám és a `†` jelű (eltűnt
   feliratú) sorok számának összegével.
2. A `list --recipe clean --status pending` pontosan azokat a videókat
   sorolja fel, amelyekre a felület elemlistáján a `clean` cella „hátra"
   állapotú. Mindkettő a `readItems()`-ből dolgozik, ugyanarra az állapotra.
3. A `list --channel "Sajjaad Khader"` csak ennek a csatornának a videóit
   mutatja, csatornaoszlop nélkül. A `--channel "sajjaad khader"` ugyanazt adja.
4. A `list --status failed` minden olyan videót mutat, amelynek legalább egy
   cellája `✗`, és csak azokat.
5. A `list` futtatása után a vault munkafája tiszta, és az állapotfájl
   módosítási ideje és tartalma bájtra változatlan. Nem létező állapotfájlnál
   sem jön létre fájl, és minden cella `·`.
6. A `list --recipe nincsilyen`, a `list --status kesz`, a
   `list --recipe summary --channels` és a `list --limit 0` 1-es kóddal áll le,
   a megnevezett üzenettel.
7. Csővezetékben (`list | cat`) a címek 40 karakteresek, a kimenet
   ANSI-vezérlőkód nélküli.
8. `pnpm test`, `pnpm lint`, `pnpm typecheck` és a CI zöld.

## Tesztelés

TDD, minden új viselkedés előbb bukó teszttel.

`src/view/list.test.ts`, kézzel összerakott `ItemListRow[]` bemenettel:

- `filterRows`:
  - forrás- és csatornaszűrés, kis- és nagybetű nélkül; `null` csatorna
    kiesik;
  - `--status` `recipe`-pel és nélküle („bármely cella");
  - a küszöb alatti kész sor `done`-ra illik;
  - a `limit` a szűrés után vág; a sorrend megmarad.
- `kindCodes`: a 11 valós típus kódjai; 3 karakternél rövidebb azonosító;
  ütközés esetén a teljes azonosító.
- `renderItemTable`:
  - a jelek és a `↓`; a költségösszeg és a `—`;
  - a `showChannel` ki és be; a címvágás `…`-lel; a `†` eltűnt feliratnál;
  - a `--recipe` nézet három oszlopa;
  - az első sor a szűrőmegjegyzéssel; a jelmagyarázat.
- `summarizeChannels` és `renderChannelTable`: csoportosítás, `byText`
  sorrend, `(nincs csatorna)` a végén, az `Összesen` sor összegei.

`src/cli.test.ts`, a meglévő fixture-minta szerint (ideiglenes forrásmappa,
vault és állapottár):

- a `list` kimenete a fixture-elemekkel;
- a négy hibaág üzenete és 1-es kódja;
- nem létező állapottár mellett nem jön létre fájl;
- az üres eredmény üzenete 0-s kóddal.

Valódi adat: az 1–5. sikerkritérium a valós konfiggal, csak olvasva.

## Dokumentáció

- `README.md`: rövid szakasz a `list` parancsról, egy-egy példával a három
  használati esetre (csatorna, `--channels`, `--recipe X --status pending`).
- `docs/architecture.md`: a nézetréteg leírásában egy mondat arról, hogy a CLI
  `list` parancsa ugyanabból a `readItems()`-ből dolgozik, mint a felület.
- Döntési jegyzet nem kell: új elv nem születik, a meglévő olvasó réteg kap
  egy második fogyasztót.

## Amit ez a szelet szándékosan nem tartalmaz

- Gépi kimenet (`--format json|csv|paths`) és rendezés (`--sort`).
- Színezés.
- Széles (CJK, emoji) karakterek pontos szélességkezelése.
- Csatornánkénti szó- vagy óraszám, modell-eloszlás.
- A webes riportoldal (backlog 6).
