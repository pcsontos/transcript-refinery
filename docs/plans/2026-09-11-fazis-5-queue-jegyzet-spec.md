# Fázis 5 — Az Obsidian queue-jegyzet

A roadmap Fázis 5-je két felületet sorol, ebben a sorrendben: az Obsidian
queue-jegyzetet és a Nuxt-felületet. Ez a spec **csak az elsőről** szól.

## A cél

A queue-jegyzet egy vault-beli, Obsidianban szerkeszthető lista, amin
keresztül:

- **válogatni** lehet a korpuszból: nem az egész korpuszra fut recept, hanem
  arra, amit kiválasztasz — **videónként és receptenként**;
- **látszik az állapot** Obsidianban: melyik (videó, recept) pár kész, melyik
  bukott el és miért, melyik maradt a plafon miatt a következő futásra.

A folyamat három lépés: a `refinery scan --queue` beírja a jegyzetbe a
felderített videókat receptenként egy-egy üres pipával; Obsidianban
kipipálod, amit kérsz; a `refinery run --queue` feldolgozza a kipipált, még
nem kész párokat, és visszaírja az eredményt ugyanazokba a sorokba.

**Az indítás kézi.** A terminál nélküli, ütemezett indítás tudatosan kimarad:
a rendszer egyetlen gépen fut, a vault szinkronja kézi, tehát az időzítő csak
egy parancs begépelését spórolná meg, cserébe felügyelet nélküli költést,
ütközést a jegyzet szerkesztésével és háttérben elnyelt hibákat hozna. Az
`architecture.md` §10 szerint *„egy ütemezett futtatás később konfigurációs
változás, nem architekturális"* — az ajtó nyitva marad.

## Kiindulási állapot

- **A `scan` semmit nem ír** — a súgó szerint *„Felderíti a feldolgozható
  videókat, és nem ír semmit."* Ez az ígéret marad.
- **Egy futás egy recept.** A `--recipe` egyetlen azonosítót fogad
  (`getRecipe(flags.recipe)`), a `commandRun` egyetlen `recipeDeps`-re és
  egyetlen `artifactKind`-ra épül. Videónként eltérő recept nem kérhető.
- **Ez döntés volt, nem hiány.** Az `architecture.md` §10: *„A per-sor
  felülbírálás (CSV, YAML) szándékosan kimarad: a receptválasztás
  futás-szintű, és a per-elem igény spekulatív."* Az igény most valódinak
  bizonyult — ezt a döntést ez a szelet felülírja.
- **A pipeline alapból csak nem létező fájlba ír** (`publishNote`,
  `--force` nélkül), és atomi írás sincs a kódban: a publisher és a riport is
  sima `writeFile`.
- **Az összesítő videónként számol** (`summarize`: itemId-halmazok), a
  hibalista pedig itemId szerint gyűlik — egy videó második recepthibája
  **felülírja** az elsőt.
- **A korpusz-állapot a teljes korpuszra szól** (`corpusStatus(discovered,
  kind)`). Egy három kipipált párra szűkülő futás után a riport a teljes
  korpusz hátralévő elemeit mutatná, és mindig újrafuttatást javasolna.
- **A költségkönyvelés a bíró tokenjeit a vázlatmodell árán számolja**
  (`pipeline.ts:128–129`: `guard.add('draft', result.usage, …)` és
  `costOf(result.usage, modelConfig.pricing.draft)`). Ez nincs szándékos
  korlátként dokumentálva; a mérő script (`evals/measure/run.ts`) épp ezt
  kerüli el szerepenkénti árazással. Érinti a futás közbeni költségőrt, a
  jegyzetek `cost_usd` mezőjét és az `item:refined` esemény összegét.

## 1. A felület

### Parancsok

| parancs | mit csinál |
|---|---|
| `refinery scan` | változatlan: felderít és kiír, **semmit nem ír** |
| `refinery scan --queue` | összefésüli a felderített videókat a queue-jegyzetbe |
| `refinery run --queue` | a kipipált, még nem kész párokat dolgozza fel, és visszaír |
| `refinery run` (`--queue` nélkül) | változatlan viselkedés, a 4. fejezet költségjavításán és a riport 3. fejezetben leírt változásain kívül |

A `run --queue` mellett a meglévő kapcsolók **szűkítenek**, a párokra
alkalmazva:

- `--recipe <id>` — csak az adott recept párjai;
- `--source <név>`, `--channel <név>` — a pár elemére, a mai `applyFilters`
  szabályaival;
- `--retry-failed` — csak azok a párok, amelyek állapota `failed`;
- `--limit N` — a fenti szűrők után legfeljebb N pár, a jegyzet sorrendjében;
- `--dry-run`, `--force`, `--no-commit` — a mai jelentésükkel.

A `scan --queue` **nem igényel** `LITELLM_API_KEY`-t: modellt nem hív, csak a
recept-registry azonosítóit használja. A `run --queue` a `--recipe`-hez
hasonlóan igényli.

### A jegyzet helye

`<notes_dir>/_queue.md` — alapértelmezésben
`Inbox/transcript-refinery/_queue.md`. Új konfigurációs kulcs nincs. A hely
azért itt van, mert így a pipeline továbbra is **kizárólag a
jegyzet-gyűjtemény alá** ír (`architecture.md` §7).

### A jegyzet formátuma

Szintetikus példa:

```markdown
## feliratok/csatorna-a
- Első példavideó %%abcDEF12345%%
  - [x] summary — ✓ 0.97 · $0.0512 · [jegyzet](<feliratok/csatorna-a/Elso_peldavideo_summary.md>)
  - [ ] flashcards
  - [x] qa — ✗ a jegyzet megsérti a vault írási szabályait: wikilink tiltott
- Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található
  - [ ] summary
  - [ ] flashcards
  - [ ] qa
```

A sorfajták — ami egyikre sem illik, az **saját sor**:

| sorfajta | alak | horgony |
|---|---|---|
| csoportfejléc | `## <forrás>/<a felirat forráson belüli mappája>` (gyökérszinten csak `## <forrás>`) | — |
| videósor | `- <cím> %%<azonosító>%%<utótag>`, behúzás nélkül | az `%%azonosító%%` |
| receptsor | szóközzel vagy tabulátorral behúzott `- [ ] <receptId><utótag>` vagy `- [x] <receptId><utótag>` (`x` vagy `X`) | a `<receptId>` |

- A **csoportosítás metaadattól független**: a forrásnévből és a felirat
  forráson belüli mappájából áll, ugyanúgy, ahogy a vault-beli célút
  (`decisions/0008`).
- Az **azonosító** az elem `itemId`-ja, olvasó nézetben rejtett
  Obsidian-megjegyzésben.
- A receptsor a **legközelebbi megelőző videósorhoz** tartozik.
- Az **utótag** a horgony utáni teljes szöveg. A megjelenített elválasztó
  ` — `, de a határ a horgony, nem az elválasztó: egy ` — `-t tartalmazó cím
  így nem zavarja az értelmezést.
- A cím a `scan --queue`-nél egy sorba fésül (újsor → szóköz), és a `%%`
  helyére `%` kerül, hogy az azonosító-horgony egyértelmű maradjon.

### Ki mit ír

| szereplő | amit írhat | amit soha |
|---|---|---|
| **te** | pipák; saját sorok bárhol; a blokkok és csoportok sorrendje | — |
| **`scan --queue`** | új videóblokk; új receptsor meglévő videó alá; a videósor utótagja (`⚠` jelölések) | meglévő videósor címe, receptsor, pipa, saját sor |
| **`run --queue`** | a receptsorok utótagja | minden más |

A jegyzetet létrehozó első `scan --queue` egy rövid használati bekezdést is ír
az elejére; ez onnantól saját sornak számít, és a pipeline többé nem írja.

**A recept neve utáni szöveg a pipeline-é:** egy receptsorba írt saját
megjegyzést a következő visszaírás felülír. Saját megjegyzés külön sorba
kerüljön.

## 2. A `scan --queue` összefésülése

Bemenet: a jegyzet mai szövege (ha van), a `discoverAll` eredménye és a
recept-registry azonosítói, registry-sorrendben. Kimenet: az új szöveg. Tiszta
függvény.

1. **Új videó** (az azonosítója nem szerepel a jegyzetben): új blokk — videósor
   és receptenként egy üres receptsor — a csoportja utolsó blokkja után, azaz
   a következő `## ` fejléc vagy a fájl vége előtt. Ha a csoport még nincs a
   jegyzetben, új csoport kerül a jegyzet végére. Az új blokkok sorrendje a
   felderítés sorrendje: a források a konfiguráció sorrendjében, forráson belül
   rendezve.
2. **Meglévő videó:** ha a registry egy receptjéhez nincs alatta receptsor,
   egy üres receptsor kerül a blokk utolsó receptsora után.
3. **Eltűnt videó** (a jegyzetben ott van, a felderítés nem találja): a
   videósor utótagja ` — ⚠ a felirat nem található` lesz. Ha a felirat
   visszajön, a jelölés lekerül.
4. **Duplikátum:** ugyanaz az azonosító több videósoron. Az **első** a
   kanonikus; a többi videósor utótagja ` — ⚠ duplikátum`.
5. Minden más sor — pipák, saját sorok, sorrend — **bájtra érintetlen**.

**Idempotencia:** az összefésülés kétszer alkalmazva ugyanazt a szöveget adja.
Ha az új szöveg bájtra azonos a meglévővel, **nincs írás és nincs commit**.

**Törölt blokk:** ha kitörölsz egy videóblokkot, a következő `scan --queue`
visszateszi, mert a felirat még megvan. A „nem érdekel" jelzése az üresen
hagyott pipa — az semmibe nem kerül.

**Git:** `git pull --ff-only` → összefésülés → atomi írás → commit
kizárólag a `_queue.md`-re (`docs(videos): feldolgozási sor frissítése`) →
push, a §7 szabályai szerint. `--no-commit` kihagyja a git-lépéseket.

**`--dry-run`:** kiírja, hány videóblokkot és hány receptsort fűzne hozzá, és
hány jelölést változtatna — nem ír és nem commitol.

## 3. A `run --queue`: futás (videó, recept) párokon

### Az egység

A futás egysége a **pár**: `{ item, recipe | null }`. A három indítási mód
ugyanazt a ciklust táplálja:

- `run` — felderített és szűrt elemek × [nincs recept]: csak átirat, mint ma;
- `run --recipe X` — felderített és szűrt elemek × [X], mint ma;
- `run --queue` — a jegyzet kipipált párjai, szűkítve.

A SIGINT-kezelés, az idempotens `finish`, a `finally`-ből írt riport és a
git-lépések **egyetlen példányban** maradnak a `commandRun`-ban. A párok
kiválasztása, szűrése és a becslés szeletelése saját modulba kerül, amit a
`commandRun` hív.

### Kiválasztás

1. `git pull --ff-only` (ha a futás commitolni fog).
2. A jegyzet beolvasása. Ha nincs jegyzet, a futás indulás előtt hibával
   megáll, és a `refinery scan --queue`-t javasolja.
3. **Kipipált pár** = kipipált receptsor, amelynek
   - a receptId-ja a registryben van (ha nincs: figyelmeztetés a riportban),
   - a videósora érvényes azonosítót hordoz, és az azonosító **első**
     előfordulása (a duplikátumok nem futnak).
4. `discoverAll`, és az azonosítók elemhez rendelése. A jegyzetben kipipált,
   de nem felderített elem párja nem fut (a visszaírás táblája szerint
   jelölődik).
5. Szűkítés a kapcsolókkal (1. fejezet).
6. **Hátralévő pár** = amelyik a `(itemId, receptId)` szerint nincs `done`
   állapotban; `--force` mellett minden kiválasztott pár.

### Becslés és feldolgozás

- **Egyetlen közös becslés** az összes hátralévő párra. A `BudgetEntry`
  bejegyzésenként saját `maxIterations`-t kap (a recept értékét); ma a
  `sliceToBudget` egyetlen értéket kap az egész kötegre. A szószám elemenként
  egyszer számolódik.
- **Egy közös modellkliens és egy közös költségőr** az összes receptre; a
  receptenkénti `RecipeDeps` ezeket osztja meg. A plafon így az egész
  indításra vonatkozik, nem receptenként.
- Ha már az első hátralévő pár sem fér a plafon alá: nincs feldolgozás, a
  kilépőkód **2**, és a hátralévő párok ` — ⏳ …` utótagot kapnak.
- Páronként a **változatlan** `processItem` fut, a jegyzet sorrendjében. Az
  elem átirata a pár első feldolgozásakor készül el, ha még nincs kész.
- A tényleges költés túllépésekor a ciklus megáll, mint ma.

### Visszaírás

**Normál befejezéskor a visszaírás a commit előtt** történik, hogy a
frissített `_queue.md` ugyanabba a commitba kerüljön. A `finish` csak akkor ír
vissza, ha a futás nem jutott el eddig a pontig — megszakítás, a törzsben
dobott kivétel, vagy a 2-es kilépőkód —; a visszaírás egy futáson belül
legfeljebb egyszer történik. `--dry-run` mellett nincs visszaírás.

A jegyzetet **közvetlenül írás előtt újraolvassa**, és a párokat
**azonosító és receptId szerint** keresi meg, nem sorszám szerint. Az utótag
**az állapottárból** áll elő (`artifactOf(itemId, receptId)`):

| helyzet | utótag |
|---|---|
| `done` | ` — ✓ <pontszám, 2 tizedes> · $<költség, 4 tizedes> · [jegyzet](<relatív út>)` |
| `failed` | ` — ✗ <a hibaüzenet első sora>` |
| a pár eleme nem található (a kiválasztás 4. lépése) | ` — ✗ a felirat nem található` |
| hátralévő, és a plafon miatt nem futott (szeletelés vagy futás közbeni megállás) | ` — ⏳ a plafon miatt a következő futásra maradt` |
| hátralévő, és megszakítás miatt nem került rá sor | változatlan |
| a futás kiválasztásán kívül eső sor (nincs kipipálva, duplikátum, vagy kiszűrte egy kapcsoló) | változatlan |

- A költség **négy tizedes**, mint az `item:refined` és a `run:aborted`
  kiírásában: egyetlen pár nagyságrendjében a két tizedes minden összeget
  `0.00`-nak mutatna.
- A link a `notesRoot`-hoz — a `_queue.md` mappájához — relatív,
  `/`-elválasztós, szögletes zárójelben. Link nélküli (`publishable: false`)
  receptnél a link elmarad.
- A hibaüzenet-kivonat egy sorba fésül, a `[`, `]` és `%%` karaktereket
  elhagyja (ne képezhessen linket vagy azonosító-horgonyt), és legfeljebb 120
  karakter, `…` végződéssel.
- Mivel az utótag az állapottárból áll elő, egy elveszett visszaírás **nem
  adatvesztés**: a következő `run --queue` visszaírja — ha nincs mit
  feldolgozni, nulla költséggel.
- Ha a visszaírt szöveg bájtra azonos a meglévővel, nincs írás.

### Commit

A generált jegyzetek és átiratok útvonalai, valamint a `_queue.md` — ha
változott — egyetlen commitban (`docs(videos): N jegyzet a feldolgozási
sorból`), majd push. Nem queue-futásnál a mai üzenet marad.

A commit — ahogy ma — csak a normál befejezés útján készül. Megszakítás vagy a
2-es kilépőkód után a visszaírt `_queue.md` a munkafában marad, és a következő
sikeres futás commitolja; a generált jegyzetekre ugyanez a rés a `#25`.

### Riport, események, összesítő

- **`item:failed`** új `kind` mezőt kap: az elbukott műtermék-típus
  (`transcript` vagy a receptId). Ahol ma egy hívás két típust is hibásnak
  rögzít, két esemény megy ki.
- **Az összesítő** („Ez a futás") **videónként** számol, mint ma. A
  **hibalista** viszont (videó, típus) párokra bomlik — egy videó második
  hibája többé nem írja felül az elsőt —, és a riport hibatáblája típus-oszlopot
  kap: `| elem | típus | forrás | ok |`.
- **A korpusz-állapot** a futás minden érintett típusára külön szakasz:
  `## A korpusz állapota — <típus>`.
- **Queue-futásnál új szakasz**, `## A sor állapota`, receptenként:
  `| recept | kipipálva | kész | hibás | hátra | plafon miatt maradt |`.
- **A „Következő lépés"** queue-futásnál a sor állapotából számol (hátra +
  plafon miatt maradt, illetve hibás), nem a teljes korpuszból. A meglévő
  `nextCommand` aláírása ehhez elég.

### Kilépőkódok

A mai szerint: **0** minden rendben; **1** legalább egy pár hibás, vagy a
visszaírás nem sikerült; **2** már az első pár sem fér a plafon alá; **130**
megszakítás.

## 4. A költségkönyvelés javítása

A `refine` a `result.usage`-et pontosan a körök felhasználásából összegzi: az
első generálás és pontozás, majd minden további kör generálása és pontozása
(`src/refine/loop.ts`), és minden kör `RoundTrace`-e ugyanezeket az
objektumokat hordozza `generateUsage` és `scoreUsage` néven. A körönkénti
bontás tehát **veszteségmentes**.

A `runRecipe` ezért a teljes összeg helyett körönként és szerepenként könyvel:

- a költségőrbe: a generálás a recept szerepén (`recipe.role`), a pontozás a
  `judge` szerepen;
- a jegyzet `cost_usd` mezőjébe és az `item:refined` összegébe: ugyanezek
  összege, szerepenkénti árral.

A javítás a `run --recipe` útvonalon is érvényes. Ez és a riport 3.
fejezetben leírt változásai (típus-oszlop, típusonkénti korpusz-szakasz) a
szelet szándékos viselkedésváltozásai a `--queue` nélküli futásokban.

## 5. Hibakezelés és kényes esetek

- **Atomi írás.** A `_queue.md` írása ugyanabba a mappába írt ideiglenes,
  **nem `.md`** kiterjesztésű fájlon át, átnevezéssel történik — az Obsidian
  sosem lát félig írt jegyzetet, és az ideiglenes fájlt nem indexeli. Hiba
  esetén az ideiglenes fájl törlődik. Ez új, kis egység.
- **Nyitva lévő jegyzet.** Az újraolvasás és az azonosító szerinti írás miatt
  a futás közben tett pipák és saját sorok megmaradnak. Marad egy kis ablak:
  ha pont az írás pillanatában gépelsz, az Obsidian mentése felülírhatja a
  visszaírást — ezt a következő `run --queue` pótolja (3. fejezet).
- **Ismeretlen tartalom.** Amit a parser nem ismer fel, az érintetlen marad,
  és nem számít bemenetnek.
- **A vault-linter a pipeline által generált részekre fut** (új blokkok,
  utótagok), nem a teljes jegyzetre: egy saját sorba írt wikilink nem
  akaszthatja meg a visszaírást. Ha egy generált rész megbukik a linteren, az
  a renderer hibája, és kivételt dob.
- **Git.** A `_queue.md` commitja a még nem commitolt pipákat is viszi — ezek a
  futás bemenetei, tehát ez szándékos. A jegyzeten kívül soha nem söpör fel
  kézi szerkesztést.
- **`run --queue --dry-run`**: a mai jelentés szerint a modellhívások valós
  költséggel megtörténnek; nem ír se jegyzetet, se állapotot, se
  visszaírást, se commitot.

## Megkötések

- Egyetlen teszt sem hív modellt; a meglévő hamis modellkliens-minta marad.
- Minden parancs `mise exec --` alatt fut.
- Magyar a dokumentáció, a kódkomment, a felhasználói kimenet — a
  queue-jegyzet szövege is — és a commit-üzenet; angol a produkciós azonosító.
- Nincs közvetlen munka a `main` ágon. Az ág: `feat/fazis-5-queue-jegyzet`.
- Korpuszrészlet — cím, csatornanév, azonosító, jegyzetszöveg — nem kerülhet
  a repóba, se tesztbe, se dokumentumba: a tesztek és ez a spec szintetikus
  példákkal dolgoznak.
- A `src/queue/` nem tartalmaz prompt- vagy csővezeték-logikát
  (`architecture.md` §3): jegyzetet olvas, összefésül és visszaír.
- Új futásidejű függőség nincs.
- Minden feladat végén zöld: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Sikerkritériumok

1. Friss vaulton a `scan --queue` létrehozza a `_queue.md`-t: minden
   felderített videó benne van, receptenként egy üres pipával. Másodszor
   futtatva a jegyzet **bájtra azonos**, és nem keletkezik commit.
2. A `scan` a `--queue` nélkül továbbra sem ír semmit; a `scan --queue`
   `LITELLM_API_KEY` nélkül is lefut.
3. Friss vaulton, egy videónál két, egy másiknál egy receptet kipipálva a
   `run --queue` pontosan **3 receptjegyzetet és 2 átiratot** készít, pontosan
   ezt a 3 receptsort írja vissza, **minden más sor bájtra azonos**, és egyetlen
   commit keletkezik, benne pontosan ezzel az 5 fájllal és a frissített
   `_queue.md`-vel.
4. Ugyanez a `run --queue` másodszor: **nulla modellhívás**, nincs új commit,
   és a `_queue.md` bájtra változatlan.
5. Olyan plafonnal, ami csak az első párba fér bele: a futás egyetlen közös
   szeletelést jelent (1 tervezett, a többi elhalasztott pár), az első pár
   elkészül, a többi ` — ⏳ …` utótagot kap.
6. Egy saját megjegyzéssor és egy kézzel áthelyezett videóblokk változatlanul
   túléli a `scan --queue`-t és a `run --queue`-t.
7. A `run --recipe summary` a `--queue` nélkül ugyanazokat az elemeket,
   ugyanazzal a kilépőkóddal és ugyanazokkal a commitokkal dolgozza fel, mint
   a szelet előtt; a `cost_usd` és a költségőr a bíró tokenjeit a bíró árán
   számolja — teszttel rögzítve, ami a mai kódon megbukik.
8. A következő őrök eltávolítása külön-külön megbuktat legalább egy tesztet
   (mutációval igazolva): az azonosító szerinti visszaírás; a saját sorok
   érintetlensége; a közös plafon; a szerepenkénti árazás.
9. A `docs/decisions/0010` rögzíti a §10 döntésének felülírását; az
   `architecture.md` §7 és §10, a `roadmap.md` Fázis 5 „Kész, ha" kritériumai
   és a `README.md` „Ami már fut" szakasza — a tesztszámmal együtt — frissül.

## Ami kimarad

- **Időzítés (launchd).** Kézi indítás; később konfigurációs változás
  (`architecture.md` §10, §12).
- **Végleges elrejtés.** A törölt blokk visszajön; az elrejtéshez az
  állapottárnak kellene nyilvántartania, mi volt már listázva. Valódi igényre.
- **A megszakítás utáni commit-rés** — `#25`.
- **Több érték a `--recipe` kapcsolón a CLI-n.** A páralapú mag lehetővé
  tenné, de az igényt a queue-jegyzet fedi.
- **A prompt-cache tokenek árazása.** A `ModelUsage` nem különbözteti meg a
  cache-találatot — önálló téma.
- **A mentett mérési szövegek újrahasznosítása** (`RunRecord.output`) —
  önálló döntés.
- **A Nuxt-felület** — a Fázis 5 második fele.
