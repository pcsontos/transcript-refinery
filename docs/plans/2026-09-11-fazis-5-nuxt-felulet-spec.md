# Fázis 5 — A Nuxt-felület

A roadmap Fázis 5-je két felületet sorol. Az első, az Obsidian queue-jegyzet
kész (`plans/2026-09-11-fazis-5-queue-jegyzet-spec.md`). Ez a spec a
**másodikról** szól: a Nuxt-felületről.

## A cél

Egy böngészős felület, ami két kérdésre felel:

- **Áttekintés és átnézés:** hol tart a korpusz, melyik jegyzet gyenge, és
  **miért** — a jegyzet, az átirat és a bíró hiánylistája egymás mellett.
- **Élő követés:** mi történik éppen egy CLI-ből indított futásban — melyik
  elem, melyik lépés, mennyi a költés a plafonhoz mérve.

Három határ, mindhárom a tervezéskor eldöntve:

- **Csak olvas.** Futást nem indít, nem szakít meg, jóváhagyást nem kér. A
  válogatás a queue-jegyzet dolga, az indítás a CLI-é.
- **Csak ezen a gépen, valós adaton.** Publikus vagy telepített demó,
  szintetikus demó-adat és valós adatról készült képernyőkép nincs.
- **A mag fogyasztója** (`architecture.md` §3): se prompt-, se
  csővezeték-logika nincs benne, az adatértelmezés a magban él.

## Kiindulási állapot

Ellenőrizve 2026-09-11-én, a kódon, a pinnelt eszközökön és a
csomagregisztrin.

- **A futásvezérlés nincs a magban.** A becslést, a szeletelést, a sor
  visszaírását, a riportot, a gitet és a SIGINT-et a `commandRun`
  (`src/cli.ts:219`) fogja össze, `console.log`-gal és `process.exit`-tel. Ez
  a szelet nem emeli ki, mert futást nem indít.
- **Az `openState` megnyitáskor ír:** `PRAGMA journal_mode = WAL`,
  `PRAGMA foreign_keys = ON` és `CREATE TABLE IF NOT EXISTS …`.
- **A `node:sqlite` csak olvasó kapcsolata a pinnelt Node 26.2-n** (eldobható
  adatbázison kipróbálva): író nélkül is megnyílik — a `-wal`/`-shm` fájlokat
  létrehozza —, látja egy később induló író beszúrását, az írást
  `attempt to write a readonly database` hibával utasítja el, hiányzó fájlnál
  `unable to open database file` hibát dob.
- **A bíró hiánylistája elvész.** A `RefineResult.gaps` a `runRecipe`-ben még
  megvan, de a `recordArtifact` csak az iterációszámot, a pontszámot, a
  költséget és a modellt kapja. A `RoundTrace` szándékosan csak a hiányok
  **számát** viszi. Az `architecture.md` §8 „Minden revízió perzisztálódik"
  lépése nem igaz a kódra.
- **A küszöb alatti jegyzet is publikálódik.** A `runRecipe` a pontozás után
  nem nézi a `passThreshold`-ot, és a sorban ✓-t kap. Hogy baj van, azt ma
  csak a szám mutatja, hogy mi, azt semmi.
- **Két esemény csak típusként létezik.** Az `item:generating` és az
  `item:scored` szerepel a `RunEvent`-ben (`src/events.ts`), de a kód sehol
  nem bocsátja ki. A modellhívások alatt a naplóban csend van.
- **A futásnapló nem tudja, él-e a futás.** Az `openRunLog` (egyetlen hívója
  `src/cli.ts:288`) időbélyeg nélküli sorokat ír; indulási és lezárási esemény
  nincs. A riport a `finish`-ben készül, így egy riport nélküli napló jelenthet
  futó és keményen leállított futást is. A JSONL-t mezőszinten semmi nem olvassa.
- **A konzol és az összesítő figyelmen kívül hagyja az ismeretlen eseményt:**
  a CLI `render`-e `null`-t ad rá, a `summarize` kihagyja.
- **A relatív útvonalak a munkakönyvtárhoz oldódnak fel:** a `loadConfig` a
  `state.path`-t és a `logs.dir`-t `process.cwd()`-hez képest oldja fel
  (`src/config.ts:121–122`).
- **A mag nem csomagként exportál.** A gyökér `package.json`-nak nincs
  `exports` mezője. A `dist/` tartalmazza a `.d.ts`-eket. Az `index.ts` a sor
  olvasó függvényeit (`parseQueue`, `checkedPairs`, `queuePath`,
  `readQueueFile`) nem exportálja.
- **Az `artifacts.path` abszolút** (`notesRoot` = a vault abszolút útja +
  `notes_dir`).
- **A `discoverAll` olcsó:** mappát jár be és metaadat-JSON-t olvas, feliratot
  nem.
- **A Nitro alapból minden interfészen figyel.** A nitropack 2.13.4
  `node_server` futásideje a `process.env.NITRO_HOST || process.env.HOST`
  címen indul; egyik nélkül a Node minden interfészt használ.
- **A `docs/README.md` döntéstáblájából hiányzik a `0010`.**
- **Verziók** (csomagregisztri): `nuxt` 4.5.2 (motorkövetelmény:
  `^22.19.0 || ^24.11.0 || >=26.0.0`), alatta `nitropack` ^2.13.4 és `h3`
  ^1.15.11; `@nuxt/ui` 4.11.1; `@nuxt/test-utils` 4.3.2 (peer: `vitest ^4 || ^5`);
  `@nuxt/eslint` 1.17.0 (peer: `eslint ^9 || ^10`); `vue-tsc` 3.3.11;
  `markdown-it` 15.0.2.
- **A h3 1.15 SSE-segédje** a `createEventStream(event)`, `@experimental`
  jelöléssel; a folyam `push()`, `close()` és `onClosed()` metódust ad, az
  üzenet mezői `id`, `event`, `retry`, `data`.
- **Az Obsidian URI** `obsidian://open?path=<abszolút út>` alakja megnyitja a
  fájlt abban a legszűkebb vaultban, amelyik az utat tartalmazza (Obsidian
  súgó, „Obsidian URI").

## 1. Szerkezet és határok

```
transcript-refinery/        ← a mag a mostani helyén, egyben a workspace gyökere
├── src/                    ← mag; új: csak olvasó réteg, futásnapló-olvasás
├── web/                    ← Nuxt 4.5 + Nuxt UI 4.11, saját package.json
│   ├── app/                ← oldalak, komponensek
│   └── server/             ← vékony API-útvonalak és az SSE
└── pnpm-workspace.yaml     ← packages: [web]; az allowBuilds és az overrides marad
```

| réteg | felelősség | amit nem tehet |
|---|---|---|
| **mag** (`src/`) | minden adatértelmezés: állapottár olvasása, futásnaplók listázása, olvasása és állapota, a sor állapota | nem tud a felületről |
| **`web/` szerver** | HTTP-útvonalak és SSE; egy útvonal a mag egy függvényét hívja, és JSON-t ad | adatlogika, írás bárhova |
| **`web/` kliens** | megjelenítés | a magból csak típust importál |

- **Behúzás:** a `web/package.json` a magot `"transcript-refinery": "workspace:*"`
  függőségként kapja, a lefordított `dist/`-ből. A gyökér `package.json`
  `exports` mezőt kap: `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`.
  A `bin` marad. A típusok — köztük a `RunEvent` — a `.d.ts`-eken át közösek.
- **Nem ír:** az állapottárat csak olvasó kapcsolattal nyitja; a vaultba, a
  sorba, a naplóba és a gitbe nem ír; modellt nem hív, `LITELLM_API_KEY` nem
  kell neki.
- **Csak helyi cím:** fejlesztéskor és élesben is kifejezetten `127.0.0.1`.
- **Konfiguráció:** ugyanaz a `refinery.config.yaml`, mint a CLI-é.
  - A repó gyökerét a `web/nuxt.config.ts` build-időben számolja ki (a `web/`
    szülőmappája), és a `runtimeConfig`-ba teszi.
  - A konfigurációs fájl alapból `<gyökér>/refinery.config.yaml`; a
    `REFINERY_CONFIG` környezeti változó (abszolút útvonal) felülírja. Ez a CLI
    `--config` kapcsolójának megfelelője, beállítási értéket nem ír felül.
  - A relatív `state.path` és `logs.dir` **mindig a repó gyökeréhez** oldódik
    fel — pontosan úgy, mint a gyökérből futtatott CLI-nél.
  - A felület a `loadConfig`-ot hívja, a `validateConfig`-ot nem: a vault
    git-ellenőrzése íráshoz kell, olvasáshoz nem.
- **Eszközök:** a gyökér `tsc`, `vitest` és `eslint` a magra szól; az ESLint
  `ignores` listája a `web/`-et kihagyja. A `web/` saját typechecket
  (`nuxi typecheck`, `vue-tsc`), lintet (`@nuxt/eslint`) és tesztet
  (`@nuxt/test-utils`) kap.
- **A három kockázatot a terv írásakor kipróbáltuk** (2026-09-11, a repó
  eldobható klónjában), ezért a terv a mag feladataival kezd:
  - a `workspace:*` a gyökércsomagra működik
    (`web/node_modules/transcript-refinery` → a gyökér);
  - a Nitro build lefordítja a mag `dist/`-jét; a `node:sqlite`-ot a
    `nitro.rollupConfig.external` jelöli külsőnek, figyelmeztetés nélkül;
  - a `createEventStream` a `node_server` presettel darabonként eljuttatja az
    eseményeket, `id`-vel és `Last-Event-ID`-vel;
  - a szerver a `127.0.0.1`-en válaszol, a gép hálózati címén nem;
  - a `@nuxt/test-utils` e2e-tesztje fájlonként egyetlen `setup()`-ot enged, a
    szerver környezetét a `setup({ env })` adja;
  - a pnpm 11 az új build scriptekre helykitöltőt ír az `allowBuilds`-ba
    (`unrs-resolver`, `vue-demi` → `false`); a Nuxt UI `ui.fonts: false`-szal
    és helyi `@iconify-json/lucide`-dal kifelé nem hív.

## 2. Nézetek és adatfolyam

### Oldalak

**Áttekintő — `/`**

- Forrásonként és műtermék-típusonként (`transcript` és a registry receptjei):
  kész / hibás / hátra.
- Receptenként a pontszámok eloszlása tized-sávokban, és hány jegyzet van a
  recept `rubric.passThreshold`-ja alatt (a küszöb a registryből jön).
- Az eddigi teljes költés (`SUM(cost_usd)`, minden típuson).
- Ha van `_queue.md`: receptenként kipipálva / kész / hibás / hátra, a
  kipipált párok és az állapottár alapján.
- Ha van futó futás: sáv, ami a futás oldalára visz.
- Forrás: `discoverAll` (a sosem feldolgozott elemek miatt), állapottár,
  `_queue.md`, naplómappa.

**Elemek — `/items`**

- Táblázat: cím, forrás, csatorna, felirat-eredet, és típusonként egy
  állapotcella (`✓ 0.84` / `✗` / `–`).
- Szűrés forrásra, csatornára, receptre, állapotra és „küszöb alatt"-ra;
  rendezés pontszám, költség és dátum szerint. A szűrés a kliensen fut: a
  szerver a teljes listát adja (a korpusz nagyságrendje százas).

**Elem — `/items/[itemId]`**

- Fejléc: cím, forrás, csatorna, felirat-eredet, szószámok.
- Típusonként egy fül. Receptfülön: pontszám, iterációszám, költség, modell,
  időpont; a bíró hiánylistája, vagy „ehhez a jegyzethez nincs rögzített
  hiánylista" a változás előtt készülteknél.
- Két oszlop: balra a jegyzet renderelve, jobbra a normalizált átirat — az
  átirat-jegyzet törzse, ugyanaz a szöveg, amihez a bíró mért.
- „Megnyitás Obsidianban": `obsidian://open?path=<az artifacts.path URL-kódolva>`.
- Hibás műterméknél a hibaüzenet.

**Hibák — `/failures`**

- Minden `failed` állapotú (elem, típus), a hibaüzenet első sora szerint
  csoportosítva: csoportonként a darabszám és az érintett elemek.

**Futások — `/runs` és `/runs/[runId]`**

- A lista a naplómappa futásai, legújabb elöl: indulás, parancs (a
  `run:started`-ből; régi naplónál `–`), állapot (4. fejezet), egységszám (a
  `scan:found`-ból), költés (az `item:refined` összegei), időtartam (az `at`
  mezőkből; régi naplónál `–`).
- A futás oldala: az események idővonala és — ha van — a renderelt riport.
- **Futó futásnál ugyanez az oldal az élő nézet:** az események SSE-n
  érkeznek; látszik a becslés és a plafon, a haladás (tervezett / kész /
  hibás), az éppen feldolgozott elem és lépése (generálás, pontozás,
  újrapróba), a költés a plafonhoz mérve, a friss hibák, és az utolsó esemény
  óta eltelt idő.

### API-útvonalak

| útvonal | a mag hívása |
|---|---|
| `GET /api/overview` | `discoverAll`, olvasó, sor-állapot, futáslista |
| `GET /api/items` | `discoverAll`, olvasó |
| `GET /api/items/[itemId]` | olvasó, a jegyzetfájlok beolvasása az állapottárban rögzített útról |
| `GET /api/failures` | olvasó |
| `GET /api/runs` | futáslista és -állapot |
| `GET /api/runs/[runId]` | napló és riport |
| `GET /api/runs/[runId]/events` | SSE (4. fejezet) |

- Szerveroldali gyorsítótár nincs.
- **Renderelés a szerveren:** `markdown-it`, kifejezetten `html: false`-szal —
  a jegyzet modell írta szöveg, abból nem kerülhet HTML az oldalba. A
  frontmatter-blokk levágva; az adatai a fejlécben jelennek meg.

## 3. A mag adatváltozásai

### A hiánylista az állapottárban

```sql
CREATE TABLE IF NOT EXISTS artifact_gaps (
  item_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  gaps    TEXT NOT NULL,
  PRIMARY KEY (item_id, kind),
  FOREIGN KEY (item_id, kind) REFERENCES artifacts(item_id, kind)
);
```

- **Műtermékenként egy sor**, a hiánylista JSON-tömbként. A sor megléte
  jelenti, hogy a lista rögzítve van; az üres tömb azt, hogy a bíró nem
  nevezett meg hiányt. Soronként egy hiánnyal a kettő nem volna
  megkülönböztethető, pedig az elem oldalának a változás előtti jegyzeteknél
  ki kell írnia: „nincs rögzített hiánylista". (Pontosítás a terv írásakor.)
- A meglévő `SCHEMA`-ba kerül; a `CREATE TABLE IF NOT EXISTS` miatt egy régi
  állapotfájl megnyitáskor megkapja. Oszlop nem változik, migráció nincs.
- Az `ArtifactMetrics` új, opcionális mezője: `gaps?: string[]`. A `runRecipe`
  mindkét rögzítő ágon (publikálható és `publishable: false`) a
  `RefineResult.gaps`-t adja át.
- A `recordArtifact` egyetlen tranzakcióban frissíti a műterméket és a
  hiánylistáját: `done` állapotnál megadott listával lecseréli, minden más
  esetben (`failed`, lista nélküli rögzítés) törli. Így egy `--force`
  újrafuttatás után nem marad régi hiány.
- A `RoundTrace`, a mérés és az események nem változnak: az események
  továbbra is csak a hiányok **számát** viszik.

### Csak olvasó hozzáférés

- `openStateReader(path): StateReader | null` — `new DatabaseSync(path, { readOnly: true })`.
  Hiányzó fájlnál `null` (az áttekintő üres állapotot mutat), régi sémánál
  ugyanaz a hibaüzenet, mint az `openState`-é.
- A lekérdezések SQL-je közös modulba kerül, amit az `openState` és az
  `openStateReader` is használ; a `corpusStatus` egyetlen helyen él.
- A `StateReader` a felület igényeire szabott olvasó felület: az elemek sorai
  (az `items` és a `transcripts` összekapcsolva), a műtermékek sorai minden
  típusra, egy (elem, típus) hiánylistája (`null`, ha nincs rögzítve, vagy ha a
  régi állapotfájlban még nincs meg a tábla), a `corpusStatus` — benne a teljes
  költéssel — és a `close()`.

### Konfiguráció és export

- `loadConfig(raw, configPath, baseDir = process.cwd())`: a relatív
  `state.path` és `logs.dir` a `baseDir`-hez oldódik fel. A CLI a paramétert
  nem adja át, a viselkedése nem változik.
- A gyökér `package.json` `exports` mezőt kap (1. fejezet).
- Az `index.ts` új exportjai: az olvasó réteg, a futásnapló-olvasás és
  -állapot (4. fejezet), a sor-állapot, valamint a `parseQueue`, a
  `checkedPairs`, a `queuePath` és a `readQueueFile`.

## 4. Élő követés

### Időbélyeg a naplóban

- Az `openRunLog` minden sort `{ at: <ISO időpont>, ...esemény }` alakban ír.
- A `RunEvent` típus **nem** kap időt: a mag tesztjei determinisztikusak
  maradnak. A naplósor típusa `RunLogLine = RunEvent & { at?: string }` — a
  változás előtti naplókban nincs `at`.
- A naplóíró saját tesztje (`src/run/log.test.ts`) ennek megfelelően
  szándékosan frissül.

### Új és bekötött események

| esemény | hol | mikor |
|---|---|---|
| `run:started { command: string; pid: number }` | `commandRun` | közvetlenül a napló megnyitása után |
| `run:ended { interrupted: boolean }` | `finish` | a sor visszaírása után, a riport írása előtt; megszakításkor is |
| `item:generating` (meglévő típus) | `refine` → `runRecipe` | minden generálás előtt |
| `item:scored` (meglévő típus) | `refine` → `runRecipe` | minden pontozás után |

- A `RefineOptions` két opcionális visszahívást kap: `onGenerate(generation)`
  és `onScore(score, gaps)`. A `runRecipe` ezeket fordítja eseménnyé; a többi
  hívót (`evals/summary.eval.ts`, `evals/measure/run.ts`) nem érinti.
- A CLI konzolkimenete nem változik: a `render` az új típusokra `null`-t ad.

### A futás állapota

Tiszta függvény a magban: `runStatus(lines, { pidAlive, hasReport })`.

**Van `run:started`:**

| feltétel, sorrendben | állapot |
|---|---|
| nincs `run:ended`, a `pid` él | fut |
| nincs `run:ended`, a `pid` nem él | nyom nélkül leállt |
| `run:ended`, `interrupted: true` | megszakítva |
| `run:ended`, van `run:aborted` | a plafon miatt megállt |
| `run:ended`, van `run:done` | kész |
| `run:ended`, egyik sem | hibával ért véget |

A plafonos megállásnál a kód a `run:aborted` után `run:done`-t is kibocsát,
ezért a `run:aborted` vizsgálata jön előbb.

**Nincs `run:started`** (a változás előtti napló):

| feltétel, sorrendben | állapot |
|---|---|
| van `run:aborted` | a plafon miatt megállt |
| van `run:done` | kész |
| van riport | lezárt |
| egyik sem | ismeretlen |

- A `pid` élését a `process.kill(pid, 0)` dönti el: `ESRCH` → nem él, siker vagy
  `EPERM` → él.
- **Ismert korlát:** egy újrahasznosított PID ritkán hamis „fut"-ot adhat. Ezért
  a nézet mindig kiírja az utolsó esemény óta eltelt időt.

### Futásnaplók a magban

- `isRunId(value)`: `^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?$` — a `runId` és
  a `reserveRunId` által előállítható alak.
- `listRuns(logsDir)`: a mappa `<runId>.jsonl` fájljai (a nem `runId` alakú
  nevek kimaradnak), a párjuk riportjával, ha van; legújabb elöl. Hiányzó
  mappánál üres lista.
- `readRunEvents(path, offset) → { lines: { line, end }[], nextOffset, invalid }`:
  az `offset`-től csak az újsorral lezárt sorokat adja vissza; a félig kiírt
  sort a következő olvasásra hagyja; az értelmezhetetlen sort kihagyja, és az
  `invalid` számlálóban jelzi.
- `followRunLog(path, …)`: a napló követése az SSE-útvonal lépései szerint;
  soronként a sort, az offsetet és a `liveRunState`-et adja. A követés logikája
  így a magban, tesztelve él; a szerverútvonal csak továbbítja.

### Az SSE-útvonal

`GET /api/runs/[runId]/events`, h3 `createEventStream`:

1. A `runId`-t az `isRunId` ellenőrzi; nem illeszkedő vagy nem létező futásra 404.
2. A kezdő offset a `Last-Event-ID` fejléc, ha az nemnegatív egész és nem
   nagyobb a fájl méreténél; különben 0.
3. Minden sor egy üzenet: `data` = `{ line, state }` — a naplósor és a futás
   állapota a napló elejétől számolva (a mag `liveRunState`-je) —, `id` = a sor
   utáni offset. Újracsatlakozáskor a böngésző ezt küldi vissza, így esemény
   nem marad ki és nem ismétlődik. Az állapot a magban számolódik, a kliens
   csak megjeleníti.
4. Az eddigi tartalom elküldése után 500 ms-onként megnézi, nőtt-e a fájl, és
   az új sorokat továbbítja.
5. Lezárás: ha megjött a `run:ended`, vagy a `pid` már nem él — előtte még
   egyszer kiolvassa a fájlt. Ha a futás a csatlakozáskor már nem fut, a teljes
   tartalom után azonnal zár. Zárás előtt egy `end` nevű eseményt küld: enélkül
   a böngésző `EventSource`-a a lezárt folyamra újra és újra csatlakozna.
6. A kliens bontásakor (`onClosed`) a figyelés leáll.

Méretfigyelés, nem fájlfigyelő: egyetlen fájl méretének ellenőrzése egyszerű
és kiszámítható; az `architecture.md` §10 a fájlfigyelőt eleve kerüli.

## 5. Hibakezelés

| helyzet | viselkedés |
|---|---|
| hiányzó vagy érvénytelen `refinery.config.yaml` | a szerver elindul; minden oldal a konfigurációs hibát mutatja, a CLI-vel azonos szöveggel |
| nincs állapotfájl | üres áttekintő; a felderített elemek „hátra" |
| régi sémájú állapotfájl | a mag meglévő hibaüzenete az oldalon |
| a műtermék `done`, de a jegyzetfájl hiányzik | az elem oldala: „a jegyzet nem található: <út>"; a többi adat látszik |
| hiányzó átirat-jegyzet | a jobb oszlop: „nincs átirat-jegyzet" |
| nincs `logs/` mappa | üres futáslista |
| félig írt vagy sérült naplósor | kimarad; a futás oldala jelzi, hány sor volt értelmezhetetlen |
| nem `runId` alakú futásazonosító | 404 |
| ismeretlen `itemId` | 404 |

Őrök:

- **Futásazonosító:** fájlútvonal csak `isRunId`-n átjutott értékből képződik,
  így URL-ből nem olvastatható a naplómappán kívüli fájl.
- **Jegyzetfájl:** csak az állapottárban rögzített útról olvasható, URL-ből
  soha. Az `itemId` kizárólag előkészített SQL-paraméter.
- **Renderelés:** `html: false`.
- **Futás közbeni olvasás:** a csak olvasó WAL-kapcsolat nem zárolja az írót.

## 6. Tesztelés

**A mag** — a gyökér `pnpm test` alatt, ideiglenes mappákkal és szintetikus
adattal, modellhívás nélkül:

- hiánylista: rögzítés; csere `--force`-os újrarögzítésnél; törlés hibánál;
  egy `artifact_gaps` nélküli állapotfájl megnyitása után a tábla létezik;
- olvasó: az írási kísérlet hibát dob; hiányzó fájl → `null`; régi séma →
  a meglévő hiba;
- `loadConfig`: `baseDir`-rel és anélkül;
- `readRunEvents`: félig írt sor, értelmezhetetlen sor, folytatás offsetről;
- `runStatus`: a 4. fejezet mindkét táblájának minden sora egy eset;
- `isRunId` és `listRuns`: a `..`-t vagy más alakot tartalmazó név kimarad;
- események: `run:started` és `run:ended` a normál, a megszakított és a
  plafonos úton; az `item:generating` és `item:scored` sorrendje egy
  javítókörös futásban; a konzolkimenet változatlan (a meglévő
  `src/e2e.test.ts` stdout-állítása őrzi);
- mutációs ellenőrzés: a `readOnly` kapcsoló, a hiánylista cseréje, az
  `isRunId` őr és a `run:aborted` előbb-vizsgálata egyenként eltávolítva
  legalább egy tesztet megbuktat.

**A `web/`** — `pnpm web:test`, a `@nuxt/test-utils` e2e segédeivel
(`setup`, `$fetch`), szintetikus konfigurációval (`REFINERY_CONFIG` egy
ideiglenes vaultra, állapottárra és naplómappára):

- az API-útvonalak a várt JSON-t adják a szintetikus állapotra;
- a `..`-t tartalmazó futásazonosító 404;
- a renderelt jegyzetben a nyers `<script>` szövegként jelenik meg
  (a `html: false` mutációja megbuktatja);
- a naplóhoz hozzáfűzött sor megjelenik az SSE-folyamban;
- külön tesztfájlban, hiányzó konfigurációval: az API és az oldal is a
  konfigurációs hibát mutatja (fájlonként egyetlen `setup()`).

A Vue-komponensek nem kapnak egységtesztet: megjelenítenek, a typecheck és a
lint védi őket.

## 7. Futtatás és dokumentáció

### Parancsok

Mind a gyökérből, `mise exec --` alatt:

| parancs | mit csinál |
|---|---|
| `pnpm web` | lefordítja a magot és a felületet, és elindítja a szervert: `127.0.0.1:4310` |
| `pnpm web:dev` | fejlesztői szerver, `127.0.0.1:4310`; a mag változásához `pnpm build` kell |
| `pnpm web:test` | a `web/` e2e tesztjei |
| `pnpm web:typecheck` | `nuxi typecheck` |
| `pnpm web:lint` | a `web/` lintje |

- A cím mindig `127.0.0.1`; a port a `NITRO_PORT`-tal (élesben), illetve a
  `--port`-tal (fejlesztéskor) írható felül. A 4310 a LiteLLM 4000-es portjától
  eltér, és a gyakori fejlesztői 3000-től is.
- Háttérszolgáltatás (launchd) nincs: kézzel indítod, amikor nézni akarod
  (`architecture.md` §12).

### Dokumentáció

- **`docs/decisions/0011`** — a felület csak olvas (futásindítás és jóváhagyás
  nélkül); az adatot a mag olvasó rétegén át kapja; a hiánylista az
  állapottárba kerül. Az elvetett változatok: `refinery serve` + statikus
  kliens; a Nuxt a CLI JSON-kimenetén át; a hiánylista a frontmatterben.
- **`architecture.md`** — §3: a felület tényleges alakja; §6: az új tábla és a
  csak olvasó hozzáférés; §8: a „Minden revízió perzisztálódik" lépés javítása;
  §12: a felület indítása, csak helyi cím.
- **`roadmap.md`** — a Fázis 5 Nuxt-felületének „Kész, ha" kritériumai és
  státusza.
- **`README.md`** — „Ami már fut" (a tesztszámmal) és „Beállítás".
- **`docs/README.md`** — a döntéstáblába a hiányzó `0010` és az új `0011`.

## Megkötések

- Egyetlen teszt sem hív modellt.
- Minden parancs `mise exec --` alatt fut.
- Magyar a dokumentáció, a kódkomment, a felület szövege és a commit-üzenet;
  angol a produkciós azonosító.
- Nincs közvetlen munka a `main` ágon. Az ág: `feat/fazis-5-nuxt-felulet`.
- Korpuszrészlet — cím, csatornanév, azonosító, jegyzetszöveg — nem kerülhet a
  repóba, se tesztbe, se dokumentumba, se képernyőképre: a tesztek és ez a spec
  szintetikus példákkal dolgoznak.
- A `web/` nem tartalmaz prompt- vagy csővezeték-logikát, és nem ír: se
  állapottárba, se vaultba, se naplóba, se gitbe.
- A mag új futásidejű függőséget nem kap; a felület függőségei a
  `web/package.json`-ban vannak.
- Minden feladat végén zöld: `pnpm test`, `pnpm typecheck`, `pnpm lint`, és
  amint a `web/` létezik, `pnpm web:test`, `pnpm web:typecheck`,
  `pnpm web:lint`.

## Sikerkritériumok

1. A `pnpm web` után a felület a `127.0.0.1:4310`-en válaszol, a gép hálózati
   címén nem.
2. Az áttekintő típusonkénti kész / hibás / hátra számai megegyeznek egy
   ugyanarra az állapotra futtatott `run` riportjának korpusz-állapotával.
3. Egy a változás után generált receptjegyzet oldalán megjelenik a bíró
   hiánylistája, egymás mellett a jegyzet és a normalizált átirat, és az
   Obsidian-link Obsidianban nyitja meg a jegyzetet.
4. Nyitott felület mellett egy `run --recipe summary` hibátlanul lefut és
   commitol; a felület használata után a vault munkafája tiszta.
5. Egy CLI-ből indított futás élőben látszik: az éppen generált elem, a
   pontszám és a költés az esemény naplóba írása után legfeljebb egy
   másodperccel megjelenik. Ctrl+C után az állapot „megszakítva", `kill -9`
   után „nyom nélkül leállt".
6. A böngésző frissítése után az élő nézet folytatódik, és egyetlen esemény
   sem jelenik meg kétszer.
7. A `run` konzolkimenete és kilépőkódjai nem változnak.
8. A 6. fejezet mutációs őreinek eltávolítása külön-külön megbuktat legalább
   egy tesztet.
9. A 7. fejezet dokumentációs pontjai frissülnek, a `README.md` tesztszámával
   együtt.

## Ami kimarad

- **Futásindítás és -megszakítás a böngészőből** — ehhez a futásvezérlést ki
  kellene emelni a `cli.ts`-ből.
- **Jóváhagyás publikálás előtt** (a brief B5 kérdése).
- **Publikus vagy telepített demó**, szintetikus demó-adat, képernyőkép.
- **Hitelesítés és elérés más gépről.**
- **Keresés a jegyzetek szövegében, szerkesztés, export.**
- **Kritériumonkénti pontszám** — a `scoreRubric` csak az átlagot adja vissza.
- **A változás előtti jegyzetek hiánylistája** — csak `--force` újrafuttatással
  pótolható, valós költséggel.
- **A relatív linkek feloldása a renderelt jegyzetben.**
- **Háttérszolgáltatásként futtatás** (launchd).
- **Erősebb védelem a PID-újrahasznosítás ellen** (például a folyamat
  parancssorának ellenőrzése).
- **Külön issue-t érdemel:** az állapotfájl törlése után a `run --recipe`
  minden meglévő jegyzetre újra meghívja a modellt, mert a `processItem` az
  állapottárból dönti el, kell-e recept, és a `refine` a `publishNote`
  létezés-ellenőrzése előtt fut — miközben a konfigurációs minta az
  állapotfájlt „eldobható"-nak nevezi.
