# Spec — Tisztított leirat időbélyegekkel

**Dátum:** 2026-09-16 · **Státusz:** jóváhagyásra vár

Ez a dokumentum **négy új recept közül az elsőt** specifikálja. A másik három —
Bloom-taxonómiás tanulókártya, strukturált jegyzet, fordítás fordítási
memóriával — külön szelet, saját speckel és tervvel. A sorrend nem ízlés
kérdése: ez a szelet hozza az időzítés megőrzését és a receptenkénti kimeneti
arányt, és mindkettőre szüksége lesz a következő kettőnek.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A feliratból olvasható, bekezdésekre és szakaszcímekre tagolt leirat készül,
amelyben minden bekezdés előtt ott áll, hányadik percben hangzott el — a
szöveghűség feláldozása nélkül.

## Amit a tervezés előtt megmértünk

Minden alábbi szám a valós, 154 elemű korpuszon készült, modellhívás nélkül.

### A korpusz alakja

| | |
|---|---|
| feliratfájl | 154, **mind `.srt`**, mind angol (`.en`) |
| dedup utáni sorok / elem | medián **431**, p90 997, max 3261 |
| szó / sor | medián **7**, p90 9 |
| videóhossz | medián 18,7 perc, p90 41,3 perc, max 113,3 perc |
| egy óránál hosszabb elem | **8** |
| metaadatfájl | mind a 154 elem mellett van, `webpage_url`-lel |

### Miért nem lehet az időbélyeget időből számolni

Az egymás utáni sorkezdetek között **74,3%-ban van 2 másodpercnél nagyobb rés**,
96,8%-ban 1 másodpercnél nagyobb. Ezek nem beszédszünetek, hanem a gördülő
feliratablak ritmusa. Szünet-alapú, determinisztikus bekezdésezés tehát a sorok
háromnegyede után bekezdéshatárt tenne — **a bekezdéshatár tartalmi döntés, nem
számítható.**

Ami viszont megbízható: a sorkezdetek **szigorúan növekvők** (nulla visszafelé
lépés a teljes korpuszon), 1,1%-ban egyenlők. A deduplikáció az **első**
előfordulást tartja meg, tehát a megtartott sorhoz tartozó kezdet az, amikor a
szöveg először megjelent.

### Az illesztés pontossága

1783 bekezdésen, 31 fájlon, szimulált enyhe szerkesztéssel (töltelékszó-kiesés,
írásjel-beszúrás, szóvégi javítások), sorrendtartó illesztéssel:

| eltérés a valódi időponttól | arány |
|---|---|
| pontosan 0 mp | **93,0%** |
| ≤ 2 mp | 95,2% |
| ≤ 5 mp | 99,6% |
| > 10 mp | 0,1% (2 eset) |

A medián és a p90 egyaránt 0 másodperc. **A két kiugró eset magas pontszámot és
fölényt kapott**, tehát a magabiztossági kapu sem fogná meg őket.

**A mérés korlátja, kimondva:** a szerkesztést szimuláltuk, nem valódi modell
állította elő. A szám az illesztő képességét mutatja ezen a szerkesztés-modellen,
nem garancia a valódi kimenetre. A küszöbök kalibrálása ezért külön, valós
hívásokkal futó kör.

### Költség

Egy generálással (`maxIterations: 0`), egy bíró-kritériummal:

| | tisztított leirat | a mai becslő ugyanerre |
|---|---|---|
| egy elem | medián **$0,075**, p90 $0,17, max $0,56 | medián $0,024 |
| teljes korpusz (154) | **$12,9** (két bíróval $15,05) | $4,84 |
| 5 dolláros plafonnál elindul | **48 elem** | mind a 154 |

Az utolsó sor a tét: a mai becslő szerint az egész korpusz belefér 5 dollárba,
valójában a harmada sem. A receptenkénti kimeneti arány ezért nem kényelmi
kiegészítés, hanem a [`0004`](<../decisions/0004-koltsegplafon.md>) „a plafon
fölött el sem indul" garanciájának feltétele.

A leghosszabb elem becsült kimenete **31 861 token**, a `claude-sonnet-5` limitje
128 000 (LiteLLM `/model/info`, 2026-09-16). **Egyetlen hívásba elfér**, darabolás
nem kell — az [`architecture.md` §13](<../architecture.md>) döntése érvényben marad.

## Kiindulási állapot

- `src/normalize/dedupe.ts:11` — a `dedupeLines` a cue-kból **csak szöveget** ad
  vissza; az időzítés itt vész el.
- `src/types.ts:58` — a `NormalizedTranscript` ma `lines`, `wordsRaw`,
  `wordsNormalized`, `captionSource`, `punctuationDensity`.
- `src/pipeline.ts:76` — az **egyetlen éles hely**, ahol `NormalizedTranscript`
  épül. Tesztben egy fixtúra építi (`src/vault/render.test.ts:18`).
- `src/model/budget.ts:11` — `OUTPUT_RATIO = 0.1`, beégetve, minden receptre.
- `src/model/budget.ts:13` — `JUDGE_CRITERIA = 2`, szintén beégetve.
- `src/model/budget.ts:79` — a `BudgetEntry` **már ma is** bejegyzésenként
  hordozza a `maxIterations`-t; a kimeneti arány ugyanezen a mintán fér be.
- `src/run/plan.ts:79` — az `estimateUnits` a bejegyzést a receptből építi, tehát
  már látja a receptet.
- `src/recipe/types.ts:39` — a `Recipe`; a `structured?` a precedens az
  opcionális motorvarratra.
- `src/refine/loop.ts:78` — a generálás egyetlen elágazása; mindkét ág stringet ad
  vissza, és innentől a loop nem tud a különbségről.
- `src/rubric/format.ts:56`, `src/rubric/language.ts:38` — a meglévő két
  blokkoló, nulla tokenes kapu.
- `src/vault/lint.ts:15` — wikilink tilos, minden linkcél szögletes zárójelben.
- `src/queue/merge.ts:93` — a hiányzó receptsort minden videó alá beszúrja. A
  vault sora ma 655 soros, 154 videóval, **nulla pipával**.
- `web/app/utils/format.ts:1` — beégetett magyar címkék; ismeretlen típusnál maga
  az azonosító jelenik meg.

## 1. Időzített sorok a normalizálásban

Új típus a `src/types.ts`-ben, a `Cue` mellett:

```ts
/** Egy megtartott sor és a kezdete másodpercben. */
export interface TimedLine {
  start: number
  text: string
}
```

A `dedupe.ts` a **teljes logikát egy helyen** tartja:

```ts
export function dedupeTimedLines(cues: Cue[]): TimedLine[]
export const dedupeLines = (cues: Cue[]): string[] =>
  dedupeTimedLines(cues).map((l) => l.text)
```

Így a `dedupeLines` három meglévő hívója (`pipeline.ts:70`, `cli.ts:139`,
`evals/summary.eval.ts:39`) és a `dedupe.test.ts` **egyetlen sort sem változik**,
és nem keletkezik két, egymástól elcsúszható deduplikációs szabály.

A `NormalizedTranscript` kap egy **kötelező** `timed: TimedLine[]` mezőt. A mai
`lines: string[]` megmarad mellette, a `timed`-ból származtatva
(`timed.map((l) => l.text)`), mert a `render.ts` és a szószámlálás ezt használja.

Szándékosan **nem** párhuzamos `starts: number[]` tömb: két, egymástól
elcsúszható ábrázolás helyett egyetlen típus (`TimedLine`) utazik végig a
csővezetéken, és a recept pontosan azt az objektumot kapja meg, amit a
normalizálás előállított.

Kötelező, nem opcionális: éles kódban egyetlen hely építi, tehát a fordító
garantálni tudja a meglétét, és nincs szükség futásidejű „hiányzik az időzítés"
ágra.

**Érintett:** `pipeline.ts:76` (éles) és `vault/render.test.ts:18` (fixtúra).

## 2. A `postprocess` varrat

A `Recipe` egy opcionális mezőt kap, a `structured?` mintájára — de a prózaúton:

```ts
export interface Recipe {
  /* ...a mai mezők változatlanul... */
  /** Ha jelen van, a generált szöveg ezen megy át, MIELŐTT a rubrika pontozná. */
  postprocess?(output: string, input: RecipeInput): string
}
```

Ehhez a `RecipeInput` kap egy **kötelező** `timed: readonly TimedLine[]` mezőt a
`transcript` string mellé.

> **Eltérés a szóbeli tervtől.** A tervezés közben úgy fogalmaztam, hogy a
> `postprocess` külön paraméterként kapja az időzítést, „így egyetlen meglévő
> teszt sem törik". A `RecipeInput`-on átadás viszont egységes a `prompt(input)`
> és a `repairPrompt(input)` mai aláírásával, és kötelező mezőként fordítási
> időben garantált. Az ára hat teszt- és két eval-hívás mechanikus bővítése
> (`recipe/*.test.ts`, `refine/loop.test.ts`, `evals/summary.eval.ts`,
> `evals/measure/run.ts`), ahol az időzített sorok amúgy is a cue-kból
> származnak. A típusbiztonság többet ér ennél a churnnél.

A `refine` loop a generálás **egyetlen elágazásában** (`loop.ts:78`) hívja, tehát
az első generálás és a javító kör is rajta megy át:

```ts
const generate = async (prompt: string) => {
  const raw = recipe.structured
    ? await recipe.structured.generate(client, recipe.role, prompt)
    : await client.generate(recipe.role, prompt)
  return recipe.postprocess
    ? { ...raw, value: recipe.postprocess(raw.value, input) }
    : raw
}
```

A sorrend lényeges: a pontozás, a `RepairInput.previous` és a publikálás
egyaránt a **már időbélyegzett** szöveget látja — nem keletkezhet olyan állapot,
ahol a bíró mást olvas, mint ami a vaultba kerül.

## 3. Az illesztő

Fájl: `src/recipe/anchor.ts`. Nulla új függőség, saját kód.

**Bemenet:** a modell prózája és az időzített sorok. **Kimenet:** ugyanaz a
próza, bekezdésenként időbélyeggel.

1. **Blokkokra bontás.** A fejléc-sorok (`^#{2,6} `) változatlanul mennek át,
   időbélyeget nem kapnak. A bekezdés üres sorral határolt blokk.
2. **Próba.** A bekezdés első **12** normalizált tokenje (kisbetűsítés, a
   betűn és számon kívüli karakterek elválasztóvá alakítása).
3. **Jelöltek.** A szófolyamon, az előző találattól indulva, **500 szavas előre
   tekintő ablakban** azok a pozíciók, ahol a szó a próba első vagy második
   tokenjével egyezik. A második token azért kell, mert az enyhe szerkesztés
   kiejthet egy vezető töltelékszót. Ha nincs jelölt, minden harmadik pozíció
   jelöltté válik.
4. **Pontozás.** `LCS(próba, szófolyam[p .. p + próba + 6]) / próba hossza` —
   sorrendtartó, tehát a puszta szóegyezés nem elég.
5. **Fölény.** A legjobb és a tőle legalább 8 szóval távolabbi második legjobb
   pontszám különbsége.
6. **Elfogadás:** pontszám ≥ **0,75** és fölény ≥ **0,10**. A kurzor a találatra
   ugrik. **Ezek becsült kezdőértékek, nem mért küszöbök** — lásd a kalibrálási
   szakaszt.
7. **Elutasítás:** kivétel, a bekezdés első néhány szavával az üzenetben.

Az 500 szavas ablak indoklása: a mért bekezdéshossz 50–85 szó, tehát az ablak
körülbelül hat bekezdésnyi — egy elrontott illesztés után a következő még
visszatalál, egy távoli, véletlen egyezés viszont kívül esik.

**Időbélyeg-formátum:** `[MM:SS]`, egy órán túl `[H:MM:SS]`. A másodperc a
találatot tartalmazó sor `start` mezője, lefelé kerekítve. Link **nem** kerül
bele. Az időbélyegeknek a jegyzeten belül nem csökkenőnek kell lenniük; az
egyenlőség megengedett (a korpuszon a sorkezdetek 1,1%-a egyenlő).

## 4. A recept

Fájl: `src/recipe/clean.ts`.

| mező | érték |
|---|---|
| `id` | `clean` |
| `outputFile` | `_clean.md` |
| `publishable` | `true` |
| `role` | `draft` |
| `maxIterations` | `0` |
| `outputRatio` | `1.05` |

A prompt szabályai (angolul, mert a modellnek szólnak) az **enyhe** szintet
kötik meg: csak írásjel, mondatkezdő nagybetű és nyilvánvaló felismerési hiba
javítása; nincs átfogalmazás, nincs tömörítés, nincs kihagyás; a töltelékszavak
maradnak; témaváltásnál új bekezdés, nagyobb váltásnál `##` cím; időbélyeget a
modell **nem** ír. Mellettük a `rules.ts` vault-invariánsai és a
`languageRule(item)`, a többi recept mintájára.

A `repairPrompt` a meglévő receptek alakját követi, noha `maxIterations: 0`
mellett ma nem fut le.

## 5. A hűségkapu

Fájl: `src/rubric/fidelity.ts`, blokkoló kritérium, nulla token. Azt a
hibamódot fogja meg, ami ennél a receptnél a legvalószínűbb: hogy a modell
**tisztítás helyett összefoglal**.

- **Szóarány:** kimenet szavai / forrás szavai ≥ **0,85**.
- **Szólefedettség:** a forrás tokenjeinek hány része jelenik meg a kimenetben,
  **multihalmaz-metszettel** számolva (tokenenként `min(forrás, kimenet)`
  összege osztva a forrás tokenszámával) ≥ **0,80**.

> **Eltérés a szóbeli tervtől.** A tervezés közben „sorrendtartó
> szólefedettséget" mondtam. Egy 30 ezer tokenes kimeneten a sorrendtartó
> (LCS-alapú) összevetés `O(n·m)`, nagyságrendileg 10⁹ művelet — nem futtatható
> kapuként. A multihalmaz-metszet lineáris, és a **sorrendet amúgy is az
> illesztő monotonitása őrzi**, tehát a kapu nem veszít erőt ott, ahol számít.

A hiányüzenetek angolul szólnak, a `format.ts` konvenciója szerint.

## 6. A rubrika

```
[formatCriterion, languageCriterion, fidelityCriterion, cleaningFaithfulness]
passThreshold: 0.8
```

Az első három blokkoló kapu, nulla tokenből. A negyedik az **egyetlen**
modell-bíró: a `judgeCriterion` egy új példánya, a tisztításra szabott
utasítással — nem azt kérdezi, talált-e ki a modell állítást, hanem hogy a
tisztítás **megváltoztatta-e valahol az értelmet**, és hogy a szakaszcímek az
alattuk lévő szövegből következnek-e.

A **lefedettség-bíró kimarad.** Egy teljes tisztított leirat definíció szerint
az egész átiratot tartalmazza, tehát a kritérium gyakorlatilag mindig egyest
adna, miközben elemenként fizetnénk érte: a korpuszra vetítve ez a különbség
$15,05 és $12,9 között.

## 7. Receptenkénti becslés

```ts
export function estimateItemUsd(
  words: number,
  maxIterations: number,
  cfg: ModelConfig,
  shape?: { outputRatio?: number; judges?: number },
): number
```

Az opcionális negyedik paraméter alapértelmezései a **mai értékek** (`0.1` és
`2`), tehát a tizenkét meglévő hívási hely és a `budget.test.ts` változatlanul
fordul és ugyanazt adja. A `BudgetEntry` a `maxIterations` mellé megkapja a
`outputRatio` és `judges` mezőt, az `estimateUnits` (`plan.ts:79`) pedig a
receptből tölti ki: az arányt a `recipe.outputRatio`-ból, a bírók számát a
`recipe.rubric.criteria.filter((c) => !c.blocking).length`-ből — utóbbi azért a
rubrikából, mert így egy recept nem tud hazudni a saját költségéről.

## 8. Vault, sor, felület

- A jegyzet a `noteFile` mai mintáján landol: `<alapnév>_clean.md`.
- `web/app/utils/format.ts`: `clean: 'tisztított leirat'`.
- A `scan --queue` videónként beszúr egy `clean` sort: a vault sora 655-ről
  nagyjából 809 sorra nő. Mivel ma **nulla pipa** van benne, a beszúrás nem tud
  meglévő választást elrontani.

## Megkötések

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet; angol
  produkciós azonosító, prompt és hiányüzenet.
- **Nulla új függőség.** Az illesztő és az LCS saját kód.
- Minden teszt hálózat és API-kulcs nélkül fut, a meglévő hamis kliens mintáján.
- Recept nem kerülhet be a rubrikája nélkül.
- A mag nem ír konzolra és nem ír fájlt.
- Commit-sorrend: (1) időzített sorok és a becslő varrata, (2) illesztő és
  hűségkapu, (3) a recept, a registry sora és a webes címke.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom.

1. `run --recipe clean --limit 1` olyan `_clean.md`-t ír, amiben **minden
   bekezdés** időbélyeggel kezdődik, az időbélyegek nem csökkennek, a
   fejlécek időbélyeg nélküliek, és a vault-linter átengedi a jegyzetet.
2. Egy óránál hosszabb elemen az egy óra utáni bekezdések `[H:MM:SS]` alakot
   kapnak.
3. A futás előtti becslés egy elemre a **$0,075 nagyságrendjében** van, nem
   $0,024-ben; 5 dolláros plafonnal a köteg a korpusz harmada körül szeletel,
   nem engedi át mind a 154 elemet.
4. Ha a modell összefoglal tisztítás helyett, a hűségkapu **nulla
   bíró-hívással** megállítja, és a hiányüzenet megnevezi a mért arányt.
5. Ha egy bekezdés nem horgonyozható magabiztosan, az elem `item:failed` lesz,
   a riport „Hibák" szakasza megnevezi az elemet és a bekezdést, a köteg pedig
   végigmegy.
6. A `summary`, `flashcards` és `qa` **viselkedése** változatlan: az
   összeállított promptjaik bájtra azonosak a maiakkal, és az
   `evals/summary.eval.ts` ugyanazt az eredményt adja. A tesztjeik egyetlen
   ponton bővülnek, a `RecipeInput` új `timed` mezőjével (2. szakasz) — ez
   fordítási kényszer, nem viselkedésváltozás.
7. A `scan --queue` kétszer futtatva másodszorra **bájtra azonos** sort hagy,
   és a meglévő pipákhoz nem nyúl.
8. A teljes teszt- és lint-futás zöld, `--dry-run` mellett a futás fájlt nem ír,
   de a modellhívás és a pontozás valós költséggel lezajlik (a mai szemantika).

## Kalibrálás — külön kör, valódi pénzzel

Négy küszöb szerepel ebben a specben **becsült** értékkel: az illesztés
elfogadási pontszáma (0,75) és fölénye (0,10), valamint a hűségkapu szóaránya
(0,85) és szólefedettsége (0,80). Ezek nem mérésből jöttek, szemben például az
írásjel-kapu 2,0-s küszöbével.

A kalibrálás valós modellhívásokat igényel, ezért **nem része ennek a
szeletnek**: külön kör, előzetes becsléssel, kétszeres biztonsági ráhagyással és
folytatás-képességgel, a mérési dokumentáció mintáján.

## Amit ez a szelet szándékosan nem tartalmaz

- **A másik három receptet** — Bloom-taxonómiás kártya, strukturált jegyzet,
  fordítás fordítási memóriával. Külön szeletek, saját speckel.
- **A küszöbök kalibrálását** valós méréssel (lásd fent).
- **Kattintható időbélyeget.** A metaadat mind a 154 elemnél tartalmaz URL-t,
  tehát megvalósítható lenne; a döntés a sima szöveges alak mellett szólt.
- **Dia- vagy képszinkronizálást** (OCR): új bemenet-típust igényelne, ami
  ütközik a [`0008`](<../decisions/0008-forras-fuggetlen-bemenet.md>) forrásfüggetlen
  bemenet elvével.
- **A `_transcript.md` megváltoztatását.** A Fázis 0 átirata változatlan marad;
  a `_clean.md` mellé kerül, nem helyette.
- **Új webes nézetet.** A felület csak a típus magyar címkéjét kapja meg.
