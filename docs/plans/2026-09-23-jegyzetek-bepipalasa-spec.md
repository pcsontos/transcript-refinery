# Spec — A vaultban már meglévő jegyzetek bepipálása

**Dátum:** 2026-09-23 · **Státusz:** jóváhagyásra vár · **Issue:** #63

Ez a dokumentum a backlog 2.4 tételét specifikálja, két kiegészítéssel: a
„kész" forrása az állapottár és a lemez együtt, a futás pedig a modellhívás
előtt megnézi, létezik-e már a célfájl.

A hierarchikus sor (#58, v1.1.0) formátumára épül. A többi tervezett szelet —
a `refinery list` parancs (2.7) és a webes riportoldal (6) — külön spec–terv
kört kap.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A `scan --queue` után minden kész (videó, recept) pár — fordítás is — `[x]`
pipával és `✓` utótaggal áll a sorban, akárhogy készült; és egy már meglévő
jegyzetfájlért a futás nem fizet.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Mi számít késznek | **Az állapottár `done` rekordja, vagy ha az nincs, a lemezen lévő célfájl** | A rekord pontszámot és költséget ad; a fájl a rekord nélküli esetet fedi (törölt állapottár, kézzel odatett jegyzet) |
| A pipa | **Kész párnál `[x]`**, és a scan soha nem veszi le | A backlog kérése; a webes áttekintő csak a pipált párokat számolja |
| Rekord nélküli fájl és a futás | **A futás a modellhívás előtt ellenőrzi a célfájlt**, és ha megvan, `done`-ként rögzíti | Enélkül a bepipált, rekord nélküli pár fizetős futást indítana, amit csak utána dob el a write-once védelem |
| Meglévő `✓` utótag | **Bájtra marad** | A futás saját eredményét a scan nem írja felül; így idempotens |
| Megközelítés | **Új, tiszta lépés (`markDone`) a merge és az újraszámozás között** | A „bájtra érintetlen" garancia megmarad; a 200 soros `mergeQueue` nem nő tovább |
| PR-szerkezet | **Két PR egymás után**: előbb spec + terv, majd a kód a friss `main`-ről | A #60/#61 mintája |

## Amit a tervezés előtt megmértünk és ellenőriztünk

### A „kész" ma

- A sorban a `[x]` azt jelenti: *ezt futtasd*. A kész állapotot a `run
  --queue` által írt `— ✓ 0.97 · $0.0471 · [jegyzet](<…>)` utótag mutatja
  (`applyStatuses`, `doneStatus`).
- A futás a kész párt az állapottár alapján hagyja ki (`store.isDone`,
  `src/cli.ts` és `processItem`), nem a fájl alapján. Egy kész, de pipálva
  hagyott pár tehát ma sem fizetős.
- A `run --recipe` (sor nélküli futás) rögzíti a `done` rekordot, de a sort nem
  írja. Ami így készült, az a sorban üres pipaként látszik.
- Ha a célfájl létezik, de nincs `done` rekord, a futás lefuttatja a receptet
  (valódi költség), és csak a `publishNote` write-once ága dobja el az
  eredményt (`src/pipeline.ts`, `runRecipe` vége).

### Az élő sor

`<vault>/Inbox/transcript-refinery/_queue.md`, a 23:37-es vault-commit után
(már új formátumú), csak olvasó méréssel a repó saját kódjával:

| mérőszám | érték |
|---|---|
| (videó, recept/fordítás) pár a sorban | 1656 |
| kész pár (`done` rekord) | 27 |
| kész pár csak fájl alapján (rekord nélkül) | 0 |
| már `[x]` + `✓` | 15 |
| **javítandó** | **12** |
| — ebből üres pipa, üres utótag | 10 |
| — ebből `[ ]` + `✓` utótag | 2 (`FPg1oNlifJk` `summary`, `qa`) |

A 12 közül egy (`wjZofJX0v4M` `summary`) rekordja a régi
`transcripts/pinchflat-minta/youtube/…` útra mutat; a mai célúton nincs fájl.
A rekord útja a mérvadó: a link oda mutat, és a fájl ott megvan.

A rekord nélküli fájl esete az élő adaton most nem fordul elő; a teszt és a
futásvédelem miatt mégis a spec része.

## 1. Az utótag — `src/queue/status.ts`

A `doneStatus` egy esettel bővül: ha a rekordban **se pontszám, se költség
nincs** (`score === null && costUsd === null`), az utótag

```text
✓ már a vaultban · [jegyzet](<…>)
```

`path === null` esetén link nélkül: `✓ már a vaultban`. Minden más eset
változatlan. Ilyen rekordot a futásvédelem (4.) ír; a scan a rekord nélküli
fájlra ugyanezt az utótagot kéri. Így a scan és a futás
ugyanazt a szöveget írja ugyanarra az állapotra.

## 2. A lépés — `src/queue/done.ts` (új)

```ts
/** A kész pár utótagja, vagy `null`, ha a pár nem kész. */
export type DoneLookup = (itemId: string, kind: string) => string | null

export function markDone(text: string, lookup: DoneLookup): { text: string; marked: number }
```

Tiszta függvény, helyben szerkeszt, a sorok száma nem változik.

- A `parseQueue` videóin megy végig; a **duplikátum** videót kihagyja.
- Minden receptsorra `lookup(itemId, recipeId)`, minden fordítássorra
  `lookup(itemId, '<recept>-<nyelv>')` (`translationId`).
- `null` → a sor bájtra érintetlen.
- Nem `null` →
  - a pipa `[x]` lesz; a `[x]` és `[X]` marad, ahogy van;
  - ha az utótag már `SEPARATOR + '✓'`-vel kezdődik, **bájtra marad**;
    különben a kapott utótag kerül a helyére (`withSuffix`) — ez írja felül az
    üres, `✗`, `⏸` és `⏳` utótagot;
  - a kapott utótag lintelődik (`lintVaultMarkdown`), mint az
    `applyStatuses`-ben.
- `marked` a ténylegesen megváltozott sorok száma.
- Kétszer alkalmazva ugyanazt adja.

A pipa cseréje a sor fején történik (`- [ ] id` → `- [x] id`, illetve
`  - [ ] hu` → `  - [x] hu`); a fej többi része nem változik.

## 3. A lekérdező — `src/queue/done.ts`

```ts
export function doneLookup(deps: {
  items: ReadonlyMap<string, SourceItem>
  registry: Registry
  notesRoot: string
  artifactOf: (itemId: string, kind: string) =>
    Pick<ArtifactRecord, 'status' | 'score' | 'costUsd' | 'path'> | null
  exists: (path: string) => boolean
}): DoneLookup
```

Egy (itemId, kind) párra:

1. Ha az elem nincs a felderítettek között, vagy a `kind` nincs a
   regiszterben → `null`. (Így a `⚠ a felirat nem található` videó és az
   ismeretlen recept érintetlen.)
2. Ha van `done` rekord → `doneStatus(record, notesRoot)`. A rekord útja
   számít, akkor is, ha eltér a mai célúttól.
3. Különben, ha a recept `publishable`, és `exists(noteFile(notesRoot, item,
   recipe.outputFile))` → `doneStatus({ score: null, costUsd: null, path },
   notesRoot)`, azaz `✓ már a vaultban · [jegyzet](<…>)`.
4. Különben `null`. A `failed` rekord nem kész.

Az `exists` és az `artifactOf` befecskendezett; a függvény maga nem végez
I/O-t, így teszthez nem kell fájlrendszer.

## 4. Futásvédelem — `src/pipeline.ts`

A `runRecipe` elején, **minden más előtt** (a fordítás forrásjegyzetének
beolvasása és a modellhívás előtt):

- ha a recept `publishable`, nincs `force`, és a
  `noteFile(notesRoot, item, recipe.outputFile)` létezik:
  - `dryRun` nélkül `recordArtifact(itemId, recipe.id, 'done', target, null,
    undefined, deps.commit)` — ugyanúgy, mint a mai write-once ág;
  - `item:skipped` esemény, oka `a fájl már létezik`;
  - `{ status: 'skipped', recipePath: target }`.

A mai, hívás utáni write-once ág marad biztonsági hálónak (versenyhelyzet,
`dryRun`).

A `--force` viselkedése nem változik: felülírja a fájlt, és fizet érte.

Ismert korlát: a költségbecslés (`estimateUnits`) a futásvédelem előtt fut,
ezért egy ilyen párat még beleszámol. A becslés így felfelé téved; a plafon
szempontjából ez a biztonságos irány.

## 5. A scan — `src/cli.ts`

A `commandScanQueue` lánca:

```text
migrateLegacy → mergeQueue → markDone → renumberQueue
```

- Az állapottárat csak akkor nyitja meg, ha a fájl már létezik
  (`cfg.statePath`); különben az `artifactOf` mindig `null`. A scan nem hoz
  létre állapottárat. A tárat a scan végén lezárja.
- Az `exists` a `node:fs` `existsSync`-je.
- A `lookup` a felderített elemekből (a `withContentLanguage` utáni listából)
  és a `recipesFor(cfg)` regiszteréből épül.
- Konzol: ha `marked > 0`, egy új sor: `N sor késznek jelölve (állapottár vagy
  meglévő jegyzet alapján).`
- `--dry-run`: a számot kiírja, a sort nem írja — mint ma.
- A „csak akkor ír, ha változik" és a `--commit` viselkedése változatlan.

## 6. Kimenet a konzolon — `run`

Változatlan: a futásvédelem ugyanazt az `item:skipped` eseményt küldi, amit a
konzol és a napló ma is ismer.

## Megkötések

- Új függőség nincs.
- Az állapottár sémája nem változik.
- A `mergeQueue`, a `renumberQueue` és a `migrateLegacy` nem változik.
- A sor formátuma nem változik; csak pipa és utótag íródik.
- A scan továbbra sem hív modellt, és `LITELLM_API_KEY` nélkül is fut.

## Sikerkritériumok

A megfigyelhető viselkedés, nem a fájl tartalma:

1. Az élő `_queue.md` **másolatán** egy `scan --queue` után (a vault érintése
   nélkül, a másolatra mutató konfiggal):
   - pontosan a mért 12 sor változik, minden más sor bájtra azonos (a `diff`
     csak ezt a 12 sort mutatja);
   - a 10 üres sor `[x]` pipát és `✓ <pont> · $<költség> · [jegyzet](<…>)`
     utótagot kap;
   - az `FPg1oNlifJk` `summary` és `qa` sora `[x]` lesz, az utótaguk bájtra
     marad;
   - a `wjZofJX0v4M` `summary` linkje a `pinchflat-minta/…` útra mutat, és a
     fájl ott megnyitható;
   - a konzol kiírja: `12 sor késznek jelölve …`.
2. Egy második `scan --queue` ugyanazon a másolaton bájtra ugyanazt hagyja.
3. Egy ideiglenes vaultban, ahol a célfájl létezik, de az állapottárban nincs
   rekord:
   - a `scan --queue` a párt `[x] ✓ már a vaultban · [jegyzet](<…>)`-ként írja;
   - egy utána következő `run --queue` a hamis modellkliensen **egyetlen
     hívást sem** indít erre a párra, a párt `done`-ként rögzíti, a fájl bájtra
     változatlan, és a sor utótagja `✓ már a vaultban · [jegyzet](<…>)` marad.
4. Ugyanez `--force`-szal: a futás hívja a modellt és felülírja a fájlt — mint
   ma.
5. A webes áttekintő (`queueOverview`) a másolaton a 12 új párt „kész"-ként
   számolja.
6. `pnpm test`, `pnpm lint`, `pnpm typecheck` és a CI zöld.

## Tesztelés

TDD, minden új viselkedés előbb bukó teszttel:

- `status.test.ts`: `doneStatus` pontszám és költség nélkül, linkkel és
  anélkül; a meglévő esetek változatlanok.
- `done.test.ts` — `markDone`:
  - üres sor → `[x]` + utótag; `✗`/`⏸`/`⏳` utótag → felülírva;
  - `[ ]` + `✓` → `[x]`, az utótag bájtra marad; `[x]` + `✓` → érintetlen;
  - `[X]` pipa megmarad;
  - fordítássor a saját kulcsával (`clean-hu`), a szülő érintetlen, ha az nem
    kész;
  - duplikátum videó érintetlen;
  - `null` lookup → a teljes szöveg bájtra azonos;
  - saját sorok, fejlécek érintetlenek; kétszeri alkalmazás identitás;
  - a `marked` számláló.
- `done.test.ts` — `doneLookup`:
  - ismeretlen elem, ismeretlen recept → `null`;
  - `done` rekord → a rekord útjával és pontszámával; eltérő út is;
  - `failed` rekord és nincs fájl → `null`; `failed` rekord és van fájl →
    `✓ már a vaultban`;
  - rekord nélkül, van fájl → `✓ már a vaultban`; nincs fájl → `null`;
  - fordítás célútja (`_clean-hu.md`).
- `pipeline.test.ts`: létező célfájl → nincs modellhívás, `done` rekord,
  `item:skipped`; `force` mellett van hívás; `dryRun` mellett nincs rekord;
  fordításnál a forrásjegyzetet sem olvassa.
- `cli.test.ts`: a scan lánca a `markDone`-nal; nem létező állapottár mellett
  nem jön létre fájl; a konzolsor; `--dry-run` nem ír.
- Valódi adat: az 1–2. sikerkritérium az élő sor másolatán.

## Dokumentáció

- `README.md`: a `_queue.md` leírásában egy mondat arról, hogy a scan a kész
  párokat bepipálja, és hogy a futás a már meglévő jegyzetért nem fizet.
- `docs/architecture.md`: a feldolgozási sor szakaszában a lánc a
  `markDone`-nal; a futás szakaszában a modellhívás előtti fájlellenőrzés.
- Döntési jegyzet nem kell: a write-once elv (`publishNote`) nem változik,
  csak korábban érvényesül.

## Amit ez a szelet szándékosan nem tartalmaz

- A meglévő `✓` utótag frissítése újabb állapottár-adatból.
- A pipa levétele, ha a jegyzetfájlt időközben törölték.
- A költségbecslés szűkítése a már meglévő fájlokkal.
- `refinery list` (2.7) és a webes riportoldal (6).
