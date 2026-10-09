# Spec — Verzió, súgó, indulási üzenet, `/notes` csoportosítás, `serve --config`

**Dátum:** 2026-10-09 · **Státusz:** átnézésre vár

Ez a dokumentum a #177, #178, #179, #181 és #182 issue közös tervezéséből készült. A #180 (a Worker GitHub API-függésének kiváltása) külön kör lesz, de a #177 végpontjai neki is alapul szolgálnak. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

A `serve` lekérdezhetően mondja meg, él-e és melyik verzió fut, és tiszteletben tartja a `--config` kapcsolót. A CLI parancsonkénti súgót ad. A bot szól, amikor egy recept feldolgozása ténylegesen elindul. A `/notes` oldalon pedig egy videó egyszer szerepel, alatta az összes kész fajtával.

## Ezen a körön kívül

A Worker vault-olvasása és a GitHub-függés (#180). A `REFINERY_CONFIG` környezeti változó. Az indulási üzenet a feliratletöltési jobra. A `decideRun` néma `ignore` ága. A `/notes/<jobId>/<fajta>` jegyzetoldal változtatása.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Milyen végpontokat kap a `serve`? (#177) | `GET /ping` és `GET /version` védelem nélkül, `GET /status` Bearer-titokkal. |
| CLI-verzió (#177) | `refinery version` és `refinery --version`, csak a verziószámot írják ki. |
| Súgó (#178) | `refinery <parancs> --help` és `refinery help <parancs>` parancsonkénti súgót ad; a paraméter nélküli forma rövid áttekintést; minden egy parancsleíró táblázatból készül. |
| Telegram-visszajelzés (#179) | Második üzenet, amikor a `serve` 202-vel elfogadja a receptfuttatást. |
| `/notes` (#181) | Videónként egy bejegyzés, YouTube-link a címen, rögzített sorrendű fajták, a legfrissebb kész változatra linkelve. |
| `serve --config` (#182) | Csak `--config`, szigorúan: megadott, de nem betölthető config esetén induláskor hibával leáll. |

## 1. `serve`: kapcsolók és config (#182)

### Ma

A `main()` a `serve` parancsot a `parseArgs` előtt ágaztatja el, és csak a `process.env`-et adja át (`src/cli.ts:929`). A config betöltése két helyen `loadCliConfig(undefined)`-dal történik: indításkor a nyelvekhez (`src/serve/command.ts:88`, a hibát egy `catch` elnyeli), és receptfuttatáskor (`src/serve/summary.ts:120`).

### Új viselkedés

- A `main()` a `serve`-nek is átadja az argv maradékát: `commandServe(argv.slice(1), process.env)`.
- A `commandServe` a `--config <út>` és a `--help`/`-h` kapcsolót ismeri. Ismeretlen kapcsoló vagy pozicionális argumentum esetén hibaüzenet és 1-es kilépési kód.
- **Megadott `--config`:** a fájlt a környezeti változók ellenőrzése után, a szerver indítása előtt egyszer betölti. Ha a betöltés hibát dob, a `serve` kiírja `Hibás konfiguráció: <első sor>`, és 1-es kóddal kilép; a szerver nem indul el.
- **A betöltött config útja** két helyre jut el:
  - a nyelvekhez (`REFINERY_SUB_LANG` továbbra is elsőbbséget élvez);
  - a receptfuttatáshoz a `summary.ts` meglévő `load` paraméterén át, amely ugyanazt a `--config` utat tölti be futásonként (a vault-config szerkesztése így újraindítás nélkül is érvényesül, mint ma).
- **Nincs `--config`:** a mai viselkedés marad (munkakönyvtárbeli fájl, csendes visszaesés a nyelveknél, a Docker-konténer config nélkül indul).

## 2. `serve`: új végpontok (#177)

A `src/serve/http.ts` `handle` függvénye a `POST /jobs` mellett három GET útvonalat ismer:

| Útvonal | Hitelesítés | Válasz |
|---|---|---|
| `GET /ping` | nincs | `200`, `text/plain`, törzs: `ok` |
| `GET /version` | nincs | `200`, `application/json`: `{"version":"1.12.1"}` |
| `GET /status` | `Authorization: Bearer <REFINERY_SERVE_SECRET>`, a `/jobs`-szal azonos `authorized` ellenőrzés | `200`, `application/json`: `{"version":"1.12.1","busy":"<jobId>"}` vagy `"busy":null`; rossz vagy hiányzó titoknál `401` |

- A verzió a meglévő `VERSION` konstans (`src/meta.ts`).
- A `busy` a `gate.current` értéke.
- Minden más útvonal vagy metódus továbbra is `404`. A `POST /jobs` viselkedése nem változik.
- A szerver létrehozásához a `createServeServer` bemenete a verziót paraméterként kapja (tesztelhetőség).

## 3. CLI: verzió és súgó (#177, #178)

### Verzió

`refinery version` és `refinery --version` a `VERSION` értékét egy sorban kiírja, kilépési kód 0. A `--version` bárhol a parancssorban ugyanígy működik, mint ma a `--help`: elsőbbséget élvez a parancs futtatásával szemben.

### Parancsleíró táblázat

Új modul (`src/help.ts`) egy táblázattal, parancsonként: név, egysoros leírás, hosszabb leírás, a kapcsolók listája (név, érték, leírás), egy-két példa. Parancsok: `scan`, `run`, `check-pricing`, `list`, `fetch subtitle`, `serve`, `watch`, `version`, `help`. A kapcsolók szövege a mai `USAGE`-ből jön át, parancsonként szétosztva; a közös kapcsolók (például `--config`) minden olyan parancsnál megjelennek, amely ismeri őket.

A `serve` súgója felsorolja a kötelező és opcionális környezeti változókat is (`REFINERY_SERVE_SECRET`, `SERVE_OUT`, `SERVE_PORT`, `SERVE_HOST`, `WORKER_CALLBACK_URL`, `REFINERY_SUB_LANG`, az R2-változók).

### Megjelenés

- **Áttekintés** — `refinery`, `refinery help`, `refinery --help`, `refinery -h`: a használat sora, parancsonként egy sor (név + egysoros leírás), a végén: `Részletek: refinery help <parancs>`. Paraméter nélküli `refinery` esetén a kilépési kód 1 (mint ma), a többinél 0.
- **Parancsonkénti súgó** — `refinery <parancs> --help`, `refinery <parancs> -h`, `refinery help <parancs>`: a hosszabb leírás, a parancs kapcsolói, a példák. Kilépési kód 0.
- `refinery fetch subtitle --help` és `refinery help fetch subtitle` a `fetch subtitle` súgóját adja.
- `refinery help <ismeretlen>`: `Ismeretlen parancs: <név>`, alatta az áttekintés, kilépési kód 1.
- Ismeretlen parancsnál a mai hibaüzenet marad, de a teljes `USAGE` helyett az áttekintés követi.

A `USAGE` konstans megszűnik; a rá épülő tesztek a táblázatból készült szövegekre állnak át.

## 4. Worker: indulási üzenet (#179)

### Ma

Receptgombra koppintáskor azonnal megy a „Sorba került: summary” üzenet. A kopogtatás 202-es válaszára a `settle()` (`worker/src/handle.ts:78`) szó nélkül `accepted` állapotba teszi a futást.

### Új viselkedés

- Új üzenet a `messages.ts`-ben: `runStartedLine(recipes, lang)` → `Elkezdődött a feldolgozás: <runLabel>. Hamarosan jelzem az eredményt.` (a `runLabel` a meglévő formázó, például `summary` vagy `notes → hu`).
- A `settle()` 202-es ágában, **csak receptfuttatásnál** (`PlannedKnock.recipes` meg van adva), és csak ha a futás előtte nem `accepted` volt: előbb elmenti az `accepted` állapotot, utána küldi az üzenetet.
- Ha az üzenetküldés nem sikerül, az állapot akkor is `accepted` marad; újraküldés nincs.
- A feliratletöltési job (videó-cím beküldése) viselkedése nem változik.

Az üzenetsor egy receptkérésnél tehát: „Sorba került: summary” → „Elkezdődött a feldolgozás: summary. Hamarosan jelzem az eredményt.” → az eredményüzenet. Ha a `serve` foglalt (409), a második üzenet akkor jön, amikor a cron-újrapróbálás elfogadtatja a futást.

## 5. Worker: `/notes` lista (#181)

### Ma

A `notesPage` (`worker/src/reader.ts`) a `notesFor` soraiból (jobonként egy, `accepted_at` szerint csökkenő) jobonként egy `<li>`-t ír: `cím · dátum — fajta · fajta · transcript`. Ugyanaz a videó több jobbal több sorban is megjelenik.

### Új viselkedés

- A `notesFor` sorait `videoId` szerint csoportosítja; a csoportok sorrendje a sorok mai sorrendjét követi (az első előfordulás, azaz a legfrissebb `accepted_at` számít).
- **Csoportonként egy `<li>`:**
  - a cím `<a href="<job url>">` linkként, a csoport legfrissebb jobjának `url`-jére és címére (`title ?? videoId`);
  - mellette a legfrissebb job `accepted_at` napja (`YYYY-MM-DD`), mint ma;
  - alatta egy beágyazott `<ul>` a fajtákkal, mindegyik `<li><a href="/notes/<jobId>/<fajta>">fajta</a></li>`.
- **Melyik jobra linkel egy fajta:** a csoport jobjai közül a legfrissebbre (`accepted_at` szerint), amelyiknek van kész futása ezzel a fajtával. A `transcript` a legfrissebb jobra linkel.
- **A fajták sorrendje:**
  1. a receptek a `RECIPES` sorrendjében (`summary`, `notes`, `qa`, `flashcards`, `bloom`, `clean-mild`, `clean-moderate`, `clean-deep`);
  2. minden recept után közvetlenül a fordításai, a `LANGS` sorrendjében (például `notes`, `notes-hu`);
  3. a táblázatban nem szereplő fajták ábécérendben;
  4. végül a `transcript`.
- A YouTube-cím `escapeHtml`-lel kerül az attribútumba, mint minden más érték.
- A `/notes/<jobId>/<fajta>` útvonal és a `notePage` nem változik.

## Hibakezelés összefoglalva

| Helyzet | Viselkedés |
|---|---|
| `serve --config` nem létező vagy hibás fájlra | `Hibás konfiguráció: …`, kilépési kód 1, a szerver nem indul. |
| `serve` ismeretlen kapcsolóval | Hibaüzenet, kilépési kód 1. |
| `GET /status` rossz titokkal | `401`, a `/jobs`-szal azonos naplózással. |
| Indulási üzenet küldése elbukik | Az `accepted` állapot megmarad, újraküldés nincs. |
| `refinery help <ismeretlen>` | Hibaüzenet + áttekintés, kilépési kód 1. |

## Tesztek

A meglévő tesztfájlok bővülnek (vitest):

- `src/serve/http.test.ts` — `/ping`, `/version`, `/status` (helyes titok, rossz titok, `busy` értéke futó job alatt és után), ismeretlen GET → 404.
- `src/serve/command.test.ts` — `--config` érvényes fájllal (a nyelvek onnan jönnek), nem létező fájllal (kilépési kód 1, a szerver nem indul), ismeretlen kapcsolóval; `--config` nélkül a mai viselkedés.
- `src/serve/summary.test.ts` — a `load` a megadott config úttal hívódik.
- `src/cli.test.ts` — `version`, `--version`, áttekintés (kilépési kódokkal), parancsonkénti súgó minden parancsra mindkét alakban, `fetch subtitle --help`, `help <ismeretlen>`; minden parancs súgója tartalmazza a parancs által ismert összes kapcsolót.
- `worker/src/handle.test.ts` — 202 receptfuttatásra: állapot `accepted` és egy indulási üzenet; feliratjobra nincs üzenet; 409 után a későbbi 202 küld üzenetet; elbukó küldésnél az állapot `accepted`.
- `worker/src/reader.test.ts` — két job ugyanarra a videóra egy bejegyzést ad; a fajták sorrendje; a fajta a legfrissebb jobra linkel; a cím a YouTube-ra linkel; HTML-escape az URL-ben.

## Kiadás

Minor verzióemelés (v1.13.0) a megszokott menettel. A Worker újratelepítése kell (#179, #181), és új Docker-kép (`pnpm docker:publish`), mert a `serve` kódja változik (#177, #182).
