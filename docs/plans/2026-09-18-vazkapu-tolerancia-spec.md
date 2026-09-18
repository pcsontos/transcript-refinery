# Spec — Vázkapu-tolerancia

**Dátum:** 2026-09-18 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a [#42](https://github.com/pcsontos/transcript-refinery/issues/42)
issue első felét specifikálja: a fordítás vázkapujának toleranciáját. Az issue
a fordítás szelet kalibrálásából ([#40](https://github.com/pcsontos/transcript-refinery/issues/40),
`docs/measurements/2026-09-17-forditas-kalibralas.md`) született, ahol **mind a
négy sikeresen lefutott valódi fordítás 0 pontot kapott — kizárólag a vázkapu
miatt**, 1-2 egységnyi bekezdés- vagy fejlécszám-eltérésen.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A vázkapu engedje át a modell természetes bekezdés- és fejlécbontását, de
továbbra is fogja meg a tartalomvesztést — hogy a fordításhűség-bíró, amely
eddig **egyetlen valódi fordításon sem futott le**, egyáltalán megszólaljon.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Kiindulás | **Tervezés a meglévő adatból, új mérés nélkül** | Kifejezett kérés; a szabály a 14 elemű címkézett halmazon offline validálható |
| Megközelítés | **Forrásfüggő szigor**: tűrés a puha vázelemeken, de ahol a fejléc tartalom, ott nincs | Az egyetlen mért változat, amely a négy valós mintát átengedi **és** a címkézett halmaz mind a 10 valódi hibáját megfogja |
| A tűrés képlete | **`max(1, ceil(0,05 × forrás))`**, felső plafon nélkül, de **öt elem alatt nincs tűrés** | A mérés szerint az 5% és a 10% azonos eredményt ad a halmazon — a szigorúbb semmit nem veszít; az alsó korlát a rövid jegyzeteket védi (lásd lent) |
| Mire vonatkozik | **Bekezdésszám és fejléc-darabszám**; minden más vázelem változatlan | A mérésben egyedül ez a kettő tért el; időbélyeg, táblázat, kódkerítés, linkcél egyetlen mintában sem |
| A szigor jelölése | **Új, elhagyható `Recipe` mező** (`headingsAreContent`), amit a `bloom` recept állít magáról | A `structured` mező nem alkalmas jelölőnek: a `notes` is sémás, mégis átment; beégetett azonosítólista helyett a recept mondja meg magáról |
| `maxIterations` | **Marad `0`** | Költségdöntés, a #42 nem kéri a felülvizsgálatát; a kapu ritkuló bukásával a javító kör hiánya kevesebbet ront |
| Hosszú fordítás | **Csak diagnosztika**, darabolás nem | Mérés nélkül nem dönthető el; a következő valós futás adjon adatot |
| PR-szerkezet | **Egy ág, egy PR** (spec + terv + kód) | Kifejezett kérés erre a szeletre, tudatos eltérés a #41/#43 két-PR-es mintájától |

## Amit a tervezés előtt megmértünk és ellenőriztünk

### A címkézett halmaz elemenkénti eltérései

A `evals/fixtures/skeleton.ts` 14 esetén (4 `ok`, 10 `broken`) megnéztük,
melyik vázelem tér el ténylegesen:

| eset | címke | mi tér el ma |
|---|---|---|
| `clean-helyes`, `bloom-helyes`, `notes-helyes`, `summary-helyes` | ok | semmi |
| `clean-kimaradt-bekezdes` | broken | időbélyeg 3→2, bekezdés 5→4 |
| `clean-osszevont-bekezdes` | broken | időbélyeg 3→2, bekezdés 5→4 |
| `clean-atirt-idobelyeg` | broken | időbélyeg (érték) |
| `clean-osszefoglalo` | broken | fejléc −2, bekezdés 5→1 |
| `bloom-kimaradt-kartya` | broken | fejléc 2→1, bekezdés 8→4 |
| `bloom-cimkebol-fejlec` | broken | **csak** fejléc 2→3 |
| `notes-kimaradt-tablazatsor` | broken | táblázatsor 3→2 |
| `notes-elveszett-mermaid-jelolo` | broken | kódkerítés `mermaid`→`plain` |
| `summary-kimaradt-listaelem` | broken | listaelem 3→2 |
| `summary-atirt-linkcel` | broken | linkcél |

Ebből: a bekezdésszám lazítása önmagában **egyetlen** valódi hibát sem
engedne át (mindet vagy másik vázelem, vagy jóval nagyobb eltérés fogja meg).
A fejlécszám lazítása viszont pontosan egyet átengedne: a
`bloom-cimkebol-fejlec` esetet.

### A négy valós minta hibamódja

A mérési dokumentum hiánylistái szerint a fordításban **több** fejléc van, mint
a forrásban — soha nem kevesebb:

| minta | fejléc | bekezdés |
|---|---|---|
| `summary-hu` #1 | 6 → 7 | — |
| `summary-hu` #2 | — | 25 → 27 |
| `summary-hu` #3 | 8 → 9 | 9 → 10 |
| `notes-hu` | 10 → 11 | 34 → 35 |

A négy kimenetet a mérés kézzel átolvasta: egyik sem hiányos vagy hibás
fordítás. Ugyanaz a jel (**+1 fejléc**) tehát a `summary`/`notes`
fordításban ártalmatlan, a `bloom`-ban viszont valódi torzulás — ott egy `##`
fejléc egy kártya. Egységes szabály a kettőt nem tudja megkülönböztetni; ez az
oka a forrásfüggő szigornak.

### A javasolt szabály mérése

A forrásfüggő szigor a mai halmazon:

| tűrés | `bloom` szigorú | precision | recall |
|---|---|---|---|
| 5% | igen | **1,000** | **1,000** |
| 5% | nem | 1,000 | 0,900 (`bloom-cimkebol-fejlec` átcsúszik) |
| 10% | igen | 1,000 | 1,000 |
| 10% | nem | 1,000 | 0,900 |

És mind a négy valós minta átmegy, 5% mellett is (a `25 → 27` eltérést a
`ceil(0,05 × 25) = 2` tűrés engedi át, a többit az `1`-es alsó korlát).

### Miért van alsó elemszám-korlát

A `formatCriterion` (`src/rubric/format.ts:17`) csak wikilinket, linkcélt,
páratlan kódkerítést, frontmattert és üres jegyzetet néz — **az escape nélkül
maradt fejlécet nem**. Arra a vázkapu az egyetlen védelem
(`skeleton.test.ts:163`: a forrásban `\## Not a heading`, a fordításban
`## Nem fejléc`). Egy `max(1, …)` alakú tűrés ezt elnyelné, mert nulla fejléc
mellett is engedne egyet.

Az alsó korlát mérve:

| alsó korlát | precision | recall | a négy valós minta | escape nélküli fejléc (0 → 1) |
|---|---|---|---|---|
| nincs | 1,000 | 1,000 | mind átmegy | **átcsúszik** |
| **5 elem** | **1,000** | **1,000** | **mind átmegy** | **megfogva** |
| 8 elem | 1,000 | 1,000 | a `summary-hu` #1 (6 fejléc) elbukik | megfogva |

Öt elem tehát az a korlát, amely a rövid jegyzeteket védi, és a mért valós
eseteket még átengedi.

### Az alsó korlát elrejti a forrásfüggő szigort a mai halmazon

Az alsó korlát bevezetése után a mai 14 elemű halmaz **precision 1,000 /
recall 1,000** a `bloom` szigorával **és** nélküle is: a `bloom` fixture
forrásában mindössze két fejléc van, ott a tűrés amúgy is nulla. A halmaz tehát
a mai alakjában nem méri a `headingsAreContent` értékét.

Egy valósághű Bloom-jegyzet viszont hat kártyából áll (a recept szintenként 3–5
kártyát kér), és ott a mező dönt:

| hatkártyás Bloom-jegyzet, „címkéből fejléc" torzulás (6 → 7 fejléc, a blokkszám változatlan) | eredmény |
|---|---|
| tűréssel (`headingsAreContent` nélkül) | **átcsúszik** |
| szigorral | megfogva, megnevezett hiánnyal |

Ezért a halmaz egy hosszabb Bloom-esettel is bővül — enélkül a mező vakon
maradna.

### Amit nem tudunk

- A mérés **nyers kimenetei elvesztek**: az `evals/private/calibration-translate.json`
  nincs meg a gépen (a repóban és a szokásos helyeken sem). Ezért a hibamód
  *okát* — hogy a modell mitől told el egy fejléchatárt — nem ismerjük, csak a
  hiánylisták számait.
- A hosszú (16 812 szavas) fordítás vázkapu-hibájáról **semmilyen részletünk
  nincs**: a szkript csak a 0/1 ítéletet mentette.

## Kiindulási állapot

- `src/rubric/skeleton.ts:47` — `skeletonOf`; `:131` — `checkSkeleton`; `:163`
  — a bekezdésszám egyenlőség-vizsgálata; `:152` — a fejléc-összevetés; `:215`
  — `skeletonCriterion` (blokkoló).
- `src/rubric/types.ts:63` — a blokkoló kritérium bukása után a pontozók el sem
  indulnak; a végső érték a kapu 0-ja. Ez a 0 pontos valós minták közvetlen oka.
- `src/recipe/translate.ts:5`, `:135` — a `skeletonCriterion` egyetlen
  produkciós fogyasztója; `:95` — `translation: { source, target }`, tehát a
  fordítórecept ismeri a forrásreceptet.
- `src/recipe/types.ts:41` — `Recipe`; `:80` — `structured` (a `notes` is az,
  `src/recipe/notes.ts:128`).
- `src/recipe/bloom.ts:171` — `bloomRecipe`; a `##` fejléc egy kártya.
- `evals/fixtures/skeleton.ts:166` — `SKELETON_LABELS`, 14 eset.
- `src/rubric/skeleton-gate.test.ts:6` — a precision/recall mérése, `≥ 0,9`
  küszöbbel.
- `evals/translate.eval.ts:53` — a `vazkapu` scorer, szigorúság nélkül hívja a
  `checkSkeleton`-t.
- `evals/measure/calibrate-translate.ts:245` — `LongRecord`, `:264` —
  `skeleton: checkSkeleton(...).value`, hiánylista nélkül.
- `src/rubric/format.ts:17` — `checkFormat`: az escape nélkül maradt fejlécet
  **nem** nézi, tehát arra a vázkapu az egyetlen védelem.
- `src/rubric/skeleton.test.ts:117` — az összevont bekezdés esete (a viselkedése
  változik); `:163` — az escape nélkül maradt fejléc esete (változatlan marad).

## 1. A kapu szabálya

`checkSkeleton` új, elhagyható harmadik paramétert kap:

```ts
/** Szigorítás a váz összevetésén; hiánya a tűréses alapviselkedés. */
export interface SkeletonStrictness {
  /**
   * A fejlécek darabszáma tartalmi invariáns — a Bloom-jegyzetben egy `##`
   * fejléc egy kártya —, ezért nincs rá tűrés.
   */
  headingsAreContent?: boolean
}

export function checkSkeleton(
  output: string,
  source: string,
  strictness?: SkeletonStrictness,
): Score
```

A tűrés **az új alapviselkedés**: a paraméter elhagyása a puha elemeken tűrő
kaput jelent, a `headingsAreContent` pedig ezt szigorítja vissza a fejlécekre.
A tűrés a forrás darabszámából számolt, elemenkénti korlát:

```ts
/** A puha vázelemek tűrése: a forrás ekkora hányada, de legalább egy elem. */
const TOLERANCE_SHARE = 0.05
/** Ennél kevesebb elemnél nincs tűrés: ott egy egységnyi eltérés is nagy arány. */
const TOLERANCE_MIN_ITEMS = 5

const tolerance = (want: number): number =>
  want < TOLERANCE_MIN_ITEMS ? 0 : Math.max(1, Math.ceil(want * TOLERANCE_SHARE))
```

| vázelem | ma | ezután |
|---|---|---|
| időbélyeg, listaelem, táblázatsor, kódkerítés, linkcél | bájtra pontos | **változatlan** |
| fejléc, **azonos** darabszámnál | a szintek sorozata pontosan egyezik | **változatlan** (a szintcsere továbbra is hiba) |
| fejléc, **eltérő** darabszámnál | hiba | átmegy, ha `\|Δ\| ≤ tolerance(forrás)` **és** a forrás nem `headingsAreContent` |
| bekezdésszám | hiba, ha eltér | átmegy, ha `\|Δ\| ≤ tolerance(forrás)` |

A hiányüzenetek szövege **változatlan**: a tűrésen kívüli eltérésnél a mai
mondat megy vissza a javító promptba.

### Két tudatos egyszerűsítés

1. **Eltérő fejléc-darabszámnál csak a darabszám számít**, a szintek sorozata
   nem. Elméletileg átcsúszhat egy `1,2,2` → `1,1,1` átrendezés, ha a hossz a
   tűrésen belül van. A halmazon ez nem fordul elő, és a maradék kockázatot a
   fordításhűség-bíró fogja — amely a lazítás után végre lefut.
2. **A tűrés arányos, felső plafon nélkül.** A modell természetes
   bekezdésbontása a dokumentum hosszával együtt nő. A nagy dokumentumokat két
   dolog védi: a `clean` forrású jegyzetekben minden prózabekezdés időbélyeggel
   kezdődik, és az időbélyeg-sorozat szigorú marad (ott a tűrés gyakorlatilag
   nem lazít); a finomabb hiányokra pedig a bíró a védelmi vonal.

### Egy meglévő egységteszt viselkedése változik

`skeleton.test.ts:117` („az összevont bekezdést megnevezi") ma nyolc bekezdésből
hetet állít elő, és hibát vár. A tűrés ezt az egy egységnyi eltérést **immár
átengedi** — ez a szelet szándéka, nem mellékhatás. A tesztet két bekezdés
összevonására kell átírni (Δ=2 > tűrés=1), és mellé kerül egy új eset, amely
azt rögzíti, hogy egy egységnyi eltérés átmegy. A fájl többi esete változatlanul
zöld.

### A kritérium

A `skeletonCriterion` konstans helyére építő függvény lép:

```ts
export function skeletonCriterionFor(strictness?: SkeletonStrictness): Criterion
```

A kritérium neve változatlanul `skeleton`, és továbbra is `blocking: true`.

## 2. A szigor jelölése

Új, elhagyható mező a `Recipe`-n:

```ts
/**
 * Ha igaz, a fejlécek darabszáma tartalmi invariáns: a Bloom-jegyzetben egy
 * `##` fejléc egy kártya. A fordítás vázkapuja ilyenkor nem tűr eltérést a
 * fejlécek számában.
 */
headingsAreContent?: boolean
```

- `src/recipe/bloom.ts`: `headingsAreContent: true`.
- `src/recipe/translate.ts`: a rubrika
  `skeletonCriterionFor({ headingsAreContent: source.headingsAreContent })`-t
  kap. A fordítórecept **nem** örökli a mezőt: a lefordított Bloom-jegyzetet
  nem fordítjuk tovább.
- Minden más recept változatlan; a mező hiánya a tűréses viselkedést jelenti.

## 3. A címkézett halmaz

Az `evals/fixtures/skeleton.ts` három esettel bővül, a mért valós hibamód
alapján:

| új eset | recept | címke | mit kódol |
|---|---|---|---|
| `summary-tobblet-fejlec` | summary | **ok** | a fordítás egy bekezdésből fejlécet csinál (6 → 7): a mérés szerint hibátlan fordítás |
| `notes-bekezdesbontas` | notes | **ok** | egy hosszú bekezdés kettébomlik (9 → 10 blokk), minden tartalom megmarad |
| `summary-kimaradt-bekezdesek` | summary | **broken** | két bekezdés kimarad egy tizenhárom blokkos jegyzetből (Δ=2 > tűrés=1) — a tűrés ne nyeljen el valódi hiányt |
| `bloom-cimkebol-fejlec-hosszu` | bloom | **broken** | hatkártyás Bloom-jegyzetben egy `**Miért:**` címkéből fejléc lesz (6 → 7 fejléc, a blokkszám változatlan) — **csak a `headingsAreContent` szigor fogja meg** |

A mai `summary` és `bloom` fixture-ök ehhez túl rövidek (öt blokk / két
fejléc), ezért a halmaz két hosszabb forrásjegyzettel is bővül: egy hat
fejlécű, tizenhárom blokkos `summary` és egy hatkártyás, huszonnégy blokkos
`bloom` jegyzettel.

A halmaz így **18 eset** (6 `ok`, 12 `broken`). A rövid `bloom-cimkebol-fejlec`
`broken` marad: ott az alsó korlát miatt a tűrés amúgy sem engedné át.

Egy meglévő eset **várt vázeleme** változik: a `clean-osszevont-bekezdes` ma a
bekezdés-hiányt várja (`has 4 paragraphs, the source has 5`), de öt blokknál a
tűrés 1, tehát azt az üzenetet a kapu már nem adja. Az esetet továbbra is
megfogja az időbélyeg — az összevont bekezdés `[00:34]` időbélyege eltűnik —,
ezért a várt elem arra az üzenetre vált. A címke (`broken`) és a fixture
változatlan.

A `skeleton-gate.test.ts` a recepthez tartozó szigorral hívja a kaput
(`bloom` → `headingsAreContent: true`), a küszöb változatlanul `≥ 0,9`
precision és recall.

Az `evals/translate.eval.ts` `vazkapu` scorere ugyanígy a forrásrecept
szigorával hív — enélkül az új `ok` esetek az evalben elbuknának.

## 4. A hosszú eset diagnosztikája

`evals/measure/calibrate-translate.ts`: a `LongRecord` új `gaps: string[]`
mezőt kap, amit a `checkSkeleton` hiánylistájából tölt, és a konzolra is kiír.
A darabolásról **nem** dönt ez a szelet; a következő valós futás így ad majd
nevesített eltérést a #42 második feléhez.

## 5. Amihez nem nyúlunk

- `maxIterations: 0`, a bíró promptja, a `passThreshold`, a becslő (`plan.ts`,
  `budget.ts`), a publikálás, a felület.
- A kemény vázelemek összevetése.
- A `clean` recept időtúllépése (külön ügy, `model/client.ts:52`).
- Darabolás.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom:

1. `pnpm test` zöld, és a `skeleton-gate.test.ts` kiírása a bővített, 18 elemű
   halmazon **precision 1,000, recall 1,000**.
2. Egy `summary` forrású fordítás, amelyben a fejlécszám 6 helyett 7 és minden
   más vázelem egyezik, a kaputól **1**-et kap (ma 0-t).
3. Ugyanez a torzulás egy hatkártyás `bloom` forrású fordításban **0**-t kap, és
   a hiánylista megnevezi a fejlécszám-eltérést — ez az a mérés, amely a
   `headingsAreContent` mező létét igazolja.
4. Egy tíz bekezdéses `summary` jegyzet fordítása, amelyből két bekezdés
   hiányzik, **0**-t kap — a tűrés (1) nem nyeli el.
5. Egy fejléc nélküli forrás fordítása, amelyben megjelenik egy `##` fejléc
   (az escape elvesztése), **0**-t kap: öt elem alatt nincs tűrés.
6. A `skeleton.test.ts` minden esete zöld, köztük az átírt „összevont
   bekezdés" eset (Δ=2) és az új, egy egységnyi eltérést átengedő eset.
7. A `pnpm calibrate:translate --estimate` változatlanul lefut, és a mentett
   nyers adat hosszú rekordja a következő valós futás után hiánylistát is
   tartalmaz.

## Megkötések

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet;
  angol produkciós azonosító, prompt és hiányüzenet.
- **Nulla új függőség.**
- Nincs valódi modellhívás ebben a szeletben.
