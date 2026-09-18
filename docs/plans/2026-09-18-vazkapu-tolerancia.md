# Terv — Vázkapu-tolerancia

> **A végrehajtónak:** ez a terv lépésről lépésre hajtható végre. Minden lépés
> egy művelet, checkbox jelöli. A spec és a terv együtt olvasandó.

**Cél:** A fordítás vázkapuja engedje át a modell természetes bekezdés- és
fejlécbontását, de továbbra is fogja meg a tartalomvesztést — hogy a
fordításhűség-bíró egyáltalán megszólaljon.

**Megközelítés:** A `checkSkeleton` a puha vázelemeken (bekezdésszám,
fejléc-darabszám) arányos tűrést kap; a kemény elemek (időbélyeg, listaelem,
táblázatsor, kódkerítés, linkcél) bájtra pontosak maradnak. A szigorítást a
forrásrecept adja: a `bloom` recept új `headingsAreContent` mezővel jelöli, hogy
nála a fejlécek darabszáma tartalom (egy `##` fejléc egy kártya).

**Eszközök:** TypeScript (ESM, `.js` importvégződéssel), vitest, evalite, tsx.
Nulla új függőség.

**Spec:** [`2026-09-18-vazkapu-tolerancia-spec.md`](<./2026-09-18-vazkapu-tolerancia-spec.md>)

## Globális megkötések

- Magyar dokumentáció, kódkomment, teszt-leírás, felhasználói kimenet és
  commit-üzenet; **angol** produkciós azonosító, prompt és hiányüzenet.
- **Nulla új függőség.**
- Nincs valódi modellhívás ebben a szeletben: minden teszt és eval offline fut.
- A hiányüzenetek szövege **bájtra változatlan** — a javító promptba mennek
  vissza.
- Ág: `feat/vazkapu-tolerancia`, egy PR. A spec commitja már rajta van
  (`69ee2de`).
- Minden task végén `pnpm test`, `pnpm typecheck` és `pnpm lint` fut.

## A tűrés képlete (minden taskban ugyanez)

```text
tolerance(want) = want < 5 ? 0 : max(1, ceil(want × 0,05))
```

A `want` a **forrás** adott vázeleméből vett darabszám. Mért értékek, amiket a
tervben szereplő tesztek ellenőriznek:

| forrás darabszáma | tűrés |
|---|---|
| 0–4 | 0 |
| 5–20 | 1 |
| 21–40 | 2 |
| 41–60 | 3 |

## Fájlszerkezet

| fájl | mi történik vele |
|---|---|
| `src/rubric/skeleton.ts` | tűrés, `SkeletonStrictness`, `skeletonCriterionFor`; a `skeletonCriterion` konstans megszűnik |
| `src/rubric/skeleton.test.ts` | egy meglévő eset átírása, öt új eset |
| `src/recipe/types.ts` | új, elhagyható `Recipe.headingsAreContent` mező |
| `src/recipe/bloom.ts` | `headingsAreContent: true` |
| `src/recipe/translate.ts` | a rubrika a forrásrecept szigorával építi a kaput |
| `src/recipe/translate.test.ts` | két új eset a forrásfüggő szigorra |
| `evals/fixtures/skeleton.ts` | két hosszabb fixture (`summary`, `bloom`), négy új címkézett eset, egy meglévő eset várt vázeleme, közös recept-map |
| `src/rubric/skeleton-gate.test.ts` | a mérés a recepthez tartozó szigorral fut |
| `evals/translate.eval.ts` | a scorer a forrásrecept szigorával hív; a helyi recept-map megszűnik |
| `evals/measure/calibrate-translate.ts` | a hosszú eset hiánylistája is mentődik |
| `README.md`, `docs/roadmap.md`, `docs/decisions/0012-forditas.md` | a megváltozott viselkedés leírása |

---

## Task 1: A tűrés a vázkapuban

**Fájlok:**
- Módosít: `src/rubric/skeleton.ts:131-219`
- Teszt: `src/rubric/skeleton.test.ts`

**Interfészek:**
- Előállítja: `SkeletonStrictness` (`{ headingsAreContent?: boolean }`),
  `checkSkeleton(output: string, source: string, strictness?: SkeletonStrictness): Score`,
  `skeletonCriterionFor(strictness?: SkeletonStrictness): Criterion`.
- Megszűnik: a `skeletonCriterion` konstans (a Task 2 és a Task 3 már az új
  függvényt használja).

- [ ] **1. lépés: A bukó tesztek megírása**

A `src/rubric/skeleton.test.ts` importsora és a `skeletonCriterion`-t használó
blokkok az új névre állnak. Cseréld a 3. sort:

```ts
import { checkSkeleton, skeletonCriterionFor, skeletonOf } from './skeleton.js'
```

A fájl végén lévő `describe('skeletonCriterion', …)` blokkban a konstans három
előfordulása helyére `skeletonCriterionFor()` kerül:

```ts
describe('skeletonCriterionFor', () => {
  it('blokkoló kapu, skeleton néven, a ScoreContext átiratát veszi forrásnak', async () => {
    const criterion = skeletonCriterionFor()
    expect(criterion.blocking).toBe(true)
    expect(criterion.name).toBe('skeleton')
    const score = await criterion.score({ transcript: FORRAS, output: FORDITAS }, nemHivhatoKliens)
    expect(score.value).toBe(1)
  })

  it('a törött vázú kimenet NULLA bíró-hívásba kerül', async () => {
    let futott = false
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () => {
        futott = true
        return Promise.resolve({ value: 1, gaps: [] })
      },
    }

    const eredmeny = await scoreRubric(
      { criteria: [skeletonCriterionFor(), dragaKriterium], passThreshold: 0.8 },
      { transcript: FORRAS, output: valtoztat('[00:19]', '[00:20]') },
      nemHivhatoKliens,
    )

    expect(futott).toBe(false)
    expect(eredmeny.value).toBe(0)
  })
})
```

A `describe('checkSkeleton', …)` blokkban **írd át** a meglévő „az összevont
bekezdést megnevezi" esetet (a mai egy egységnyi összevonást a tűrés immár
átengedi — ez a szelet szándéka), és tedd mellé az új eseteket. A régi eset:

```ts
  it('az összevont bekezdést megnevezi', () => {
    expect(
      checkSkeleton(
        valtoztat('első bekezdése.\n\n## Első rész', 'első bekezdése.\n## Első rész'),
        FORRAS,
      ).gaps,
    ).toEqual([
      'The translation has 7 paragraphs, the source has 8. Do not merge, split or drop paragraphs.',
    ])
  })
```

helyére ez a kettő kerül:

```ts
  it('a tűrésen belüli, egy bekezdésnyi eltérést átengedi', () => {
    expect(
      checkSkeleton(
        valtoztat('első bekezdése.\n\n## Első rész', 'első bekezdése.\n## Első rész'),
        FORRAS,
      ),
    ).toEqual({ value: 1, gaps: [] })
  })

  it('a tűrésen kívüli, két bekezdésnyi összevonást megnevezi', () => {
    const osszevont = valtoztat(
      'első bekezdése.\n\n## Első rész\n\n[00:19]',
      'első bekezdése.\n## Első rész\n[00:19]',
    )
    // Az összevonás a második időbélyeget is elnyeli: a bekezdés a [00:01]-es
    // blokk közepére kerül, tehát a kapu két hiányt nevez meg.
    expect(checkSkeleton(osszevont, FORRAS).gaps).toEqual([
      'The translation has 2 timestamps, the source has 3; the first difference follows [00:01].',
      'The translation has 6 paragraphs, the source has 8. Do not merge, split or drop paragraphs.',
    ])
  })
```

Ugyanebbe a blokkba, a fájl `FORRAS`/`FORDITAS` konstansai **alá** vedd fel a
hosszabb fixture-t (a tűrés csak öt elemtől él, a `FORRAS` ehhez túl rövid):

```ts
/** Hat fejléc, tizenkét blokk: itt már él a tűrés (fejléc 1, bekezdés 1). */
const HOSSZU_FORRAS = [
  '## One',
  '',
  'First paragraph.',
  '',
  '## Two',
  '',
  'Second paragraph.',
  '',
  '## Three',
  '',
  'Third paragraph.',
  '',
  '## Four',
  '',
  'Fourth paragraph.',
  '',
  '## Five',
  '',
  'Fifth paragraph.',
  '',
  '## Six',
  '',
  'Sixth paragraph.',
].join('\n')
```

És a `describe('checkSkeleton', …)` blokk végére a négy új eset:

```ts
  it('a hat fejléces jegyzetben a hetedik fejlécet átengedi', () => {
    expect(checkSkeleton(`${HOSSZU_FORRAS}\n\n## Seven`, HOSSZU_FORRAS)).toEqual({
      value: 1,
      gaps: [],
    })
  })

  it('a hetedik fejlécet megnevezi, ha a fejléc tartalom', () => {
    const score = checkSkeleton(`${HOSSZU_FORRAS}\n\n## Seven`, HOSSZU_FORRAS, {
      headingsAreContent: true,
    })
    expect(score.value).toBe(0)
    expect(score.gaps).toEqual([
      'The translation has 7 headings, the source has 6. Keep every heading at its level.',
    ])
  })

  it('a két kimaradt bekezdést a tűrés nem nyeli el', () => {
    const rovidebb = HOSSZU_FORRAS.replace('\n\nFirst paragraph.', '').replace(
      '\n\nSecond paragraph.',
      '',
    )
    expect(checkSkeleton(rovidebb, HOSSZU_FORRAS).gaps).toEqual([
      'The translation has 10 paragraphs, the source has 12. Do not merge, split or drop paragraphs.',
    ])
  })

  it('öt elem alatt nincs tűrés: a fejléc nélküli forrásban megjelenő fejléc hiba', () => {
    expect(checkSkeleton('Válasz.\n\n## Nem fejléc', 'Answer.\n\nNot a heading').gaps).toEqual([
      'The translation has 1 headings, the source has 0. Keep every heading at its level.',
    ])
  })
```

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtasd: `pnpm exec vitest run src/rubric/skeleton.test.ts`
Várt: fordítási hiba — a `skeletonCriterionFor` nem létezik
(`"skeletonCriterionFor" is not exported by "src/rubric/skeleton.ts"`).

- [ ] **3. lépés: A tűrés bevezetése a `skeleton.ts`-ben**

A `firstDifference` és a `fenceName` segédek **fölé** (a `Skeleton` interfész
után) vedd fel a szigorítás típusát és a tűrést:

```ts
/** Szigorítás a váz összevetésén; hiánya a tűréses alapviselkedés. */
export interface SkeletonStrictness {
  /**
   * A fejlécek darabszáma tartalmi invariáns — a Bloom-jegyzetben egy `##`
   * fejléc egy kártya —, ezért nincs rá tűrés.
   */
  headingsAreContent?: boolean
}

/** A puha vázelemek tűrése: a forrás ekkora hányada, de legalább egy elem. */
const TOLERANCE_SHARE = 0.05

/** Ennél kevesebb elemnél nincs tűrés: ott egy egységnyi eltérés is nagy arány. */
const TOLERANCE_MIN_ITEMS = 5

/**
 * Hány elemnyi eltérést enged a kapu egy puha vázelemen.
 *
 * A modell természetes bekezdés- és fejlécbontása a dokumentum hosszával együtt
 * nő: a kalibrálás mind a négy valós mintáján 1-2 egységnyi volt az eltérés,
 * miközben a fordítások hibátlanok voltak
 * (`docs/measurements/2026-09-17-forditas-kalibralas.md`). Rövid jegyzetben
 * viszont egy egységnyi eltérés is nagy arány — ott a kapu szigorú marad.
 */
function tolerance(want: number): number {
  return want < TOLERANCE_MIN_ITEMS ? 0 : Math.max(1, Math.ceil(want * TOLERANCE_SHARE))
}
```

A `checkSkeleton` szignatúrája és két ága változik. A függvény doc-kommentjét
egészítsd ki, a fejléc- és a bekezdés-ágat cseréld:

```ts
/**
 * Determinisztikus vázkapu, nulla token: a fordítás szerkezete a forrásé-e.
 *
 * Azt a hibamódot fogja meg, ami a fordításnál a legvalószínűbb és a bírónak
 * a legdrágább: hogy a modell **összevon, kihagy vagy összefoglal**. Elemenként
 * az első eltérést nevezi meg. A hiányüzenetek angolul szólnak, mert
 * visszamennek a javító promptba.
 *
 * Az időbélyeg, a listaelem, a táblázatsor, a kódkerítés és a linkcél
 * összevetése bájtra pontos. A bekezdés- és a fejléc-darabszám **tűrő**: a
 * természetes átfogalmazás ne buktasson el hibátlan fordítást. A tűrésen belül
 * maradó, valódi hiányokat a fordításhűség-bíró fogja — a kapu olcsó szűrő,
 * nem az egyetlen védelem.
 */
export function checkSkeleton(
  output: string,
  source: string,
  strictness: SkeletonStrictness = {},
): Score {
```

A mai fejléc-blokk (`const heading = firstDifference(…)` … a hozzá tartozó
`gaps.push`) helyére:

```ts
  if (want.headings.length === got.headings.length) {
    const heading = firstDifference(want.headings, got.headings)
    if (heading !== -1) {
      gaps.push(
        `Heading ${String(heading + 1)} is level ${String(want.headings[heading])} in the ` +
          `source but level ${String(got.headings[heading])} in the translation.`,
      )
    }
  } else {
    const allowed = strictness.headingsAreContent === true ? 0 : tolerance(want.headings.length)
    if (Math.abs(want.headings.length - got.headings.length) > allowed) {
      gaps.push(
        `The translation has ${String(got.headings.length)} headings, the source has ` +
          `${String(want.headings.length)}. Keep every heading at its level.`,
      )
    }
  }
```

A mai bekezdés-blokk (`if (want.blocks !== got.blocks) {`) helyére:

```ts
  if (Math.abs(want.blocks - got.blocks) > tolerance(want.blocks)) {
    gaps.push(
      `The translation has ${String(got.blocks)} paragraphs, the source has ` +
        `${String(want.blocks)}. Do not merge, split or drop paragraphs.`,
    )
  }
```

A fájl végén a `skeletonCriterion` konstans helyére építő függvény kerül:

```ts
/**
 * Kapu-kritérium: bukása esetén a bíró-hívás el sem indul. A forrás a
 * `ScoreContext.transcript` — fordításnál a futás a forrásjegyzet törzsét
 * teszi oda. A szigorítás a forrásreceptből jön
 * (`Recipe.headingsAreContent`).
 */
export function skeletonCriterionFor(strictness: SkeletonStrictness = {}): Criterion {
  return {
    name: 'skeleton',
    blocking: true,
    score: (ctx) => Promise.resolve(checkSkeleton(ctx.output, ctx.transcript, strictness)),
  }
}
```

- [ ] **4. lépés: A fordítórecept importjának igazítása**

A `skeletonCriterion` konstans megszűnt, ezért a `src/recipe/translate.ts` nem
fordulna le. Egyelőre a paraméter nélküli hívás kerül bele (a forrásfüggő
szigort a Task 2 adja hozzá) — így a fa a task végén zöld.

`src/recipe/translate.ts:5`:

```ts
import { skeletonCriterionFor } from '../rubric/skeleton.js'
```

és a `rubric.criteria` listában a `skeletonCriterion,` helyére:

```ts
        skeletonCriterionFor(),
```

- [ ] **5. lépés: Futtasd a teljes tesztkészletet**

Futtasd: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld. A `skeleton-gate.test.ts` a mai 14 elemű halmazon fut, és
**precision 1,000 / recall 1,000** marad a szigor nélkül is: a mai `bloom`
fixture forrásában két fejléc van, ahol az alsó korlát miatt a tűrés nulla. (A
szigor értékét egy hosszabb Bloom-eset méri majd a Task 3-ban.)

- [ ] **6. lépés: Commit**

```bash
git add src/rubric/skeleton.ts src/rubric/skeleton.test.ts src/recipe/translate.ts
git commit -m "feat(rubric): tűrés a vázkapu puha elemein

- A bekezdés- és fejlécszám eltérése a forrás 5%-áig, de legalább egy
  elemig elfogadott; öt elem alatt nincs tűrés
- A headingsAreContent szigorítás mellett a fejlécszám bájtra pontos
- Az időbélyeg, listaelem, táblázatsor, kódkerítés és linkcél változatlan

Refs #42"
```

---

## Task 2: A forrásfüggő szigor a recepteknél

**Fájlok:**
- Módosít: `src/recipe/types.ts` (a `Recipe` interfész, a `tags` mező után)
- Módosít: `src/recipe/bloom.ts:179` (a `tags` sor után)
- Módosít: `src/recipe/translate.ts:5`, `:135`
- Teszt: `src/recipe/translate.test.ts`

**Interfészek:**
- Használja: `skeletonCriterionFor` és `SkeletonStrictness` (Task 1).
- Előállítja: `Recipe.headingsAreContent?: boolean`; a `translationOf` ezt a
  forrásreceptből veszi át a kapuba.

- [ ] **1. lépés: A bukó tesztek megírása**

A `src/recipe/translate.test.ts` fájl végére, a `describe('translationOf', …)`
blokkba (a „a rubrika három kapu és egy bíró" eset mellé):

```ts
  it('a bloom forrású fordítás vázkapuja a fejlécszámra szigorú', async () => {
    const { rubric } = translationOf(bloomRecipe, 'hu')
    const kapu = rubric.criteria.find((c) => c.name === 'skeleton')!
    const forras = '## Egy\n\nElső.\n\n## Kettő\n\nMásodik.\n\n## Három\n\nHarmadik.\n\n## Négy\n\nNegyedik.\n\n## Öt\n\nÖtödik.'

    const score = await kapu.score({ transcript: forras, output: `${forras}\n\n## Hat` }, nemHivhatoKliens)

    expect(score.value).toBe(0)
    expect(score.gaps).toEqual([
      'The translation has 6 headings, the source has 5. Keep every heading at its level.',
    ])
  })

  it('a clean forrású fordítás vázkapuja ugyanezt a fejlécet átengedi', async () => {
    const { rubric } = translationOf(cleanRecipe, 'hu')
    const kapu = rubric.criteria.find((c) => c.name === 'skeleton')!
    const forras = '## Egy\n\nElső.\n\n## Kettő\n\nMásodik.\n\n## Három\n\nHarmadik.\n\n## Négy\n\nNegyedik.\n\n## Öt\n\nÖtödik.'

    const score = await kapu.score({ transcript: forras, output: `${forras}\n\n## Hat` }, nemHivhatoKliens)

    expect(score.value).toBe(1)
  })
```

A fájl tetején a `bloomRecipe` importja kell (a `cleanRecipe` már ott van), és
a `nemHivhatoKliens` segédnek léteznie kell a fájlban — ha nincs, vedd fel a
`skeleton.test.ts` mintájára:

```ts
import { bloomRecipe } from './bloom.js'
```

```ts
const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}
```

(a `ModelClient` típus importja: `import type { ModelClient } from '../model/client.js'`)

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtasd: `pnpm exec vitest run src/recipe/translate.test.ts`
Várt: fordítási hiba a `skeletonCriterion` importjára (a Task 1 megszüntette),
majd a javítás után a „bloom … szigorú" eset bukása (`expected 1 to be 0`).

- [ ] **3. lépés: A `Recipe` mező**

`src/recipe/types.ts`, a `tags` mező után:

```ts
  /**
   * Ha igaz, a fejlécek darabszáma tartalmi invariáns: a Bloom-jegyzetben egy
   * `##` fejléc egy kártya. A fordítás vázkapuja ilyenkor nem tűr eltérést a
   * fejlécek számában.
   */
  headingsAreContent?: boolean
```

- [ ] **4. lépés: A `bloom` recept jelöli magát**

`src/recipe/bloom.ts`, a `tags: ['decks'],` sor után:

```ts
  // Egy `##` fejléc egy kártya: a fordítás nem veszíthet és nem nyerhet
  // fejlécet.
  headingsAreContent: true,
```

- [ ] **5. lépés: A fordítórecept átveszi a szigort**

`src/recipe/translate.ts`, az 5. sor importja:

```ts
import { skeletonCriterionFor } from '../rubric/skeleton.js'
```

és a `rubric.criteria` listában a `skeletonCriterion,` helyére:

```ts
        skeletonCriterionFor({ headingsAreContent: source.headingsAreContent }),
```

A fordítórecept maga **nem** kapja meg a mezőt: a lefordított Bloom-jegyzetet
nem fordítjuk tovább.

- [ ] **6. lépés: Futtasd a teljes tesztkészletet**

Futtasd: `pnpm test`
Várt: minden zöld. Ha a `skeleton-gate.test.ts` piros, az a Task 3 tárgya —
ebben a lépésben még a **mai** 14 elemű halmazon fut, aminek a `bloom` eseteit
a szigor nélküli hívás továbbra is megfogja, tehát zöldnek kell lennie.

- [ ] **7. lépés: Típus- és lintellenőrzés**

Futtasd: `pnpm typecheck && pnpm lint`
Várt: hibamentes.

- [ ] **8. lépés: Commit**

```bash
git add src/recipe/types.ts src/recipe/bloom.ts src/recipe/translate.ts src/recipe/translate.test.ts
git commit -m "feat(recipe): a forrásrecept mondja meg, mikor tartalom a fejléc

- Új, elhagyható Recipe.headingsAreContent mező
- A bloom recept jelöli magát: nála egy ## fejléc egy kártya
- A fordítórecept vázkapuja a forrás szigorát veszi át

Refs #42"
```

---

## Task 3: A címkézett halmaz és a mérés

**Fájlok:**
- Módosít: `evals/fixtures/skeleton.ts`
- Módosít: `src/rubric/skeleton-gate.test.ts`
- Módosít: `evals/translate.eval.ts:15-20`, `:53`

**Interfészek:**
- Használja: `SkeletonStrictness`, `checkSkeleton` (Task 1),
  `Recipe.headingsAreContent` (Task 2).
- Előállítja: `SKELETON_SOURCE_RECIPES: Record<SkeletonRecipe, Recipe>` — a
  címkézett eset receptneve és a valódi recept közötti kapcsolat, egy helyen a
  mérőteszt és az eval számára.

- [ ] **1. lépés: A hosszabb `summary` fixture felvétele**

`evals/fixtures/skeleton.ts`, a `SUMMARY_HU` konstans után. A meglévő
`SUMMARY_SOURCE` öt blokkos és két fejléces — ott nincs tűrés, tehát a mért
valós hibamód nem kódolható rajta. Ez a fixture a kalibrálás `summary-hu`
mintáinak alakját követi (hat fejléc, tizenhárom blokk):

```ts
const SUMMARY_LONG_SOURCE = lines(
  'Dan Martell explains how a one-person business finds its first offer.',
  '',
  '## What to sell',
  '',
  'Start from a problem you have already solved for someone else.',
  '',
  '## Who to sell it to',
  '',
  '- People who have the problem today.',
  '- People who can pay for a solution.',
  '',
  '## How to price it',
  '',
  'Price the outcome, not the hours you spend on it.',
  '',
  '## How to deliver it',
  '',
  'Deliver the first version by hand, before you automate anything.',
  '',
  '## What to measure',
  '',
  '- Time to first result.',
  '- Number of customers who renew.',
  '',
  '## What to ignore',
  '',
  'Ignore anything that does not move those two numbers.',
)

const SUMMARY_LONG_HU = lines(
  'Dan Martell elmondja, hogyan találja meg egy egyszemélyes vállalkozás az első ajánlatát.',
  '',
  '## Mit adj el',
  '',
  'Olyan problémából indulj ki, amelyet már megoldottál valaki másnak.',
  '',
  '## Kinek add el',
  '',
  '- Azoknak, akiknek ma is megvan ez a problémájuk.',
  '- Azoknak, akik fizetni is tudnak a megoldásért.',
  '',
  '## Hogyan árazd',
  '',
  'Az eredményt árazd, és ne az órákat, amelyeket ráfordítasz.',
  '',
  '## Hogyan szállítsd',
  '',
  'Az első változatot kézzel szállítsd, mielőtt bármit automatizálnál.',
  '',
  '## Mit mérj',
  '',
  '- Az első eredményig eltelt időt.',
  '- Azoknak az ügyfeleknek a számát, akik meghosszabbítják.',
  '',
  '## Mit hagyj figyelmen kívül',
  '',
  'Hagyj figyelmen kívül mindent, ami nem mozdítja ezt a két számot.',
)
```

- [ ] **2. lépés: A hosszabb `bloom` fixture felvétele**

Ugyanebben a fájlban, a `BLOOM_HU` konstans után. A mai `BLOOM_SOURCE`
kétkártyás, ott a fejléc-tűrés nulla — azon a `headingsAreContent` hatása nem
mérhető. Ez a fixture egy valósághű, **hatkártyás** Bloom-jegyzet (a recept
szintenként 3–5 kártyát kér), hat fejléccel és huszonnégy blokkal:

```ts
const BLOOM_LONG_SOURCE = lines(
  '## What does the first question ask?',
  '',
  'It asks what the business should sell.',
  '',
  '**Why:** Starting from the technology instead of the problem is the common mistake.',
  '',
  '*Remember · Beginner*',
  '',
  '## Why is starting from the technology backwards?',
  '',
  'Because a product needs a problem to solve before it needs a tool.',
  '',
  '**Why:** The speaker failed for a decade by building technology first.',
  '',
  '*Understand · Intermediate*',
  '',
  '## How do you test an idea before building it?',
  '',
  'By delivering the first version by hand to one customer.',
  '',
  '**Why:** Manual delivery shows whether the need is real.',
  '',
  '*Apply · Intermediate*',
  '',
  '## What should you measure in the first month?',
  '',
  'The time it takes a customer to reach the first result.',
  '',
  '**Why:** That number moves every other number.',
  '',
  '*Analyse · Intermediate*',
  '',
  '## What should you ignore?',
  '',
  'Anything that does not move those two numbers.',
  '',
  '**Why:** Attention is the scarcest resource of a one-person business.',
  '',
  '*Evaluate · Advanced*',
  '',
  '## What do you build after validation?',
  '',
  'The smallest solution that delivers the promised result.',
  '',
  '**Why:** Automating early solves the wrong problem.',
  '',
  '*Create · Advanced*',
)

const BLOOM_LONG_HU = lines(
  '## Mit kérdez az első kérdés?',
  '',
  'Azt, hogy mit adjon el a vállalkozás.',
  '',
  '**Miért:** A gyakori hiba az, hogy a technológiából indulunk ki, és nem a problémából.',
  '',
  '*Emlékezés · Kezdő*',
  '',
  '## Miért fordított sorrend a technológiából kiindulni?',
  '',
  'Mert egy terméknek előbb egy megoldandó probléma kell, és csak utána egy eszköz.',
  '',
  '**Miért:** A beszélő egy évtizedig bukott, mert előbb a technológiát építette meg.',
  '',
  '*Megértés · Haladó*',
  '',
  '## Hogyan teszteld az ötletet, mielőtt megépítenéd?',
  '',
  'Úgy, hogy az első változatot kézzel szállítod egyetlen ügyfélnek.',
  '',
  '**Miért:** A kézi szállítás mutatja meg, hogy valódi-e az igény.',
  '',
  '*Alkalmazás · Haladó*',
  '',
  '## Mit mérj az első hónapban?',
  '',
  'Azt az időt, amíg egy ügyfél eljut az első eredményig.',
  '',
  '**Miért:** Ez a szám mozdítja az összes többit.',
  '',
  '*Elemzés · Haladó*',
  '',
  '## Mit hagyj figyelmen kívül?',
  '',
  'Mindent, ami nem mozdítja ezt a két számot.',
  '',
  '**Miért:** A figyelem a legszűkebb erőforrás egy egyszemélyes vállalkozásban.',
  '',
  '*Értékelés · Haladó*',
  '',
  '## Mit építs a validálás után?',
  '',
  'A legkisebb megoldást, amely az ígért eredményt adja.',
  '',
  '**Miért:** A korai automatizálás rossz problémát old meg.',
  '',
  '*Alkotás · Haladó*',
)
```

- [ ] **3. lépés: A négy új címkézett eset**

A `SKELETON_LABELS` tömb végére. Az első kettő a **mért valós hibamódot**
kódolja `ok` címkével (a kalibrálás kézi átolvasása szerint azok a fordítások
hibátlanok voltak); a harmadik azt rögzíti, hogy a tűrés nem nyel el valódi
hiányt; a negyedik pedig az egyetlen eset a halmazban, amelyet **kizárólag** a
`headingsAreContent` szigor fog meg — enélkül a Task 2 mezője mérés nélkül
maradna:

```ts
  {
    id: 'summary-tobblet-fejlec',
    recipe: 'summary',
    source: SUMMARY_LONG_SOURCE,
    // A kalibrálás mért hibamódja: a fordítás egy bekezdésből fejlécet csinál
    // (6 → 7 fejléc), minden tartalom megmarad.
    translation: broken(
      SUMMARY_LONG_HU,
      'Az eredményt árazd, és ne az órákat, amelyeket ráfordítasz.',
      '### Az eredményt árazd, és ne az órákat',
    ),
    label: 'ok',
  },
  {
    id: 'notes-bekezdesbontas',
    recipe: 'notes',
    source: NOTES_SOURCE,
    // Egy hosszú bekezdés kettébomlik (9 → 10 blokk), tartalomvesztés nélkül.
    translation: broken(
      NOTES_HU,
      'A problémából indulj ki, és ne egy eszközből, mert az csak utána jön.',
      'A problémából indulj ki.\n\nEgy eszköz csak ezután jön.',
    ),
    label: 'ok',
  },
  {
    id: 'summary-kimaradt-bekezdesek',
    recipe: 'summary',
    source: SUMMARY_LONG_SOURCE,
    translation: broken(
      broken(
        SUMMARY_LONG_HU,
        '\n\nOlyan problémából indulj ki, amelyet már megoldottál valaki másnak.',
        '',
      ),
      '\n\nAz első változatot kézzel szállítsd, mielőtt bármit automatizálnál.',
      '',
    ),
    label: 'broken',
    expected: /has 11 paragraphs, the source has 13/,
  },
  {
    id: 'bloom-cimkebol-fejlec-hosszu',
    recipe: 'bloom',
    source: BLOOM_LONG_SOURCE,
    // Hat kártya mellett a fejléc-tűrés 1, tehát ezt a torzulást KIZÁRÓLAG a
    // `headingsAreContent` szigor fogja meg: a blokkszám nem változik.
    translation: broken(
      BLOOM_LONG_HU,
      '**Miért:** A gyakori hiba az, hogy a technológiából indulunk ki, és nem a problémából.',
      '## Miért: a gyakori hiba a technológiából kiindulni',
    ),
    label: 'broken',
    expected: /has 7 headings, the source has 6/,
  },
```

Ugyanebben a lépésben **frissítsd egy meglévő eset várt vázelemét**. A
`clean-osszevont-bekezdes` ma ezt várja:

```ts
    expected: /has 4 paragraphs, the source has 5/,
```

A forrásában öt blokk van, tehát a tűrés 1 — az egy blokknyi eltérésre a kapu
immár **nem** ad bekezdés-hiányt. Az esetet továbbra is megfogja az időbélyeg
(az összevont bekezdés `[00:34]` időbélyege eltűnik), ezért a várt elem:

```ts
    expected: /has 2 timestamps, the source has 3; the first difference follows \[00:19\]/,
```

A többi `broken` eset `expected` mezője változatlan: a `clean-osszefoglalo` és a
`bloom-kimaradt-kartya` forrásában két fejléc van (ott a tűrés nulla), a
`clean-kimaradt-bekezdes` pedig már ma is az időbélyegre vár.

- [ ] **4. lépés: A közös recept-map**

Ugyanebben a fájlban, a `SKELETON_LABELS` **fölé**. Ez adja a mérőtesztnek és
az evalnek is a recepthez tartozó szigort, egy helyről:

```ts
/**
 * A címkézett eset receptneve és a valódi recept. A vázkapu szigora a
 * receptből jön (`Recipe.headingsAreContent`), ezért a mérés és az eval is
 * innen veszi.
 */
export const SKELETON_SOURCE_RECIPES: Record<SkeletonRecipe, Recipe> = {
  clean: cleanRecipe,
  summary: summaryRecipe,
  notes: notesRecipe,
  bloom: bloomRecipe,
}
```

és a fájl tetejére az importok:

```ts
import { bloomRecipe } from '../../src/recipe/bloom.js'
import { cleanRecipe } from '../../src/recipe/clean.js'
import { notesRecipe } from '../../src/recipe/notes.js'
import { summaryRecipe } from '../../src/recipe/summary.js'
import type { Recipe } from '../../src/recipe/types.js'
```

- [ ] **5. lépés: A mérőteszt a recept szigorával fut**

`src/rubric/skeleton-gate.test.ts` — az import és a `measure()` függvény:

```ts
import { describe, expect, it } from 'vitest'
import { SKELETON_LABELS, SKELETON_SOURCE_RECIPES } from '../../evals/fixtures/skeleton.js'
import { checkSkeleton } from './skeleton.js'

/** A pozitív osztály a `broken`: ezt kell a kapunak megfognia. */
function measure() {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const { source, translation, label, recipe } of SKELETON_LABELS) {
    const { headingsAreContent } = SKELETON_SOURCE_RECIPES[recipe]
    const caught = checkSkeleton(translation, source, { headingsAreContent }).value === 0
    if (caught && label === 'broken') tp++
    if (caught && label === 'ok') fp++
    if (!caught && label === 'broken') fn++
  }
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  }
}
```

A „minden törött esetet a várt vázelem fog meg" eset is a recept szigorával
hív:

```ts
  it('minden törött esetet a várt vázelem fog meg', () => {
    for (const c of SKELETON_LABELS.filter((l) => l.label === 'broken')) {
      const { headingsAreContent } = SKELETON_SOURCE_RECIPES[c.recipe]
      const { gaps } = checkSkeleton(c.translation, c.source, { headingsAreContent })
      expect(
        gaps.some((gap) => c.expected!.test(gap)),
        `${c.id}: ${JSON.stringify(gaps)}`,
      ).toBe(true)
    }
  })
```

A küszöb (`≥ 0,9`) és a harmadik eset (mindkét osztály és mind a négy recept
jelen van) változatlan.

- [ ] **6. lépés: Az eval a közös mapet és a szigort használja**

`evals/translate.eval.ts`: a helyi `SOURCES` konstans (15-20. sor) **törlendő**,
helyette a közös map jön a fixture-ből. Az importsorok:

```ts
import { evalite } from 'evalite'
import { translationOf } from '../src/recipe/translate.js'
import { refine } from '../src/refine/loop.js'
import { checkLanguageIs } from '../src/rubric/language.js'
import { checkSkeleton } from '../src/rubric/skeleton.js'
import type { SourceItem } from '../src/types.js'
import { scriptedClient } from './fixture-model.js'
import { SKELETON_LABELS, SKELETON_SOURCE_RECIPES } from './fixtures/skeleton.js'
```

A `task` a közös mapből veszi a receptet, és a kimenetbe a szigort is átadja:

```ts
  task: async (c) => {
    const result = await refine(
      translationOf(SKELETON_SOURCE_RECIPES[c.recipe], 'hu'),
      { item: ITEM, transcript: c.source, timed: [] },
      // A rubrikában EGY modell-bíró van, tehát generálásonként egy ítélet kell.
      scriptedClient([c.translation], [{ score: 0.95, gaps: [] }]),
    )
    return { recipe: c.recipe, output: result.output, source: c.source, score: result.score }
  },
```

és a `vazkapu` scorer:

```ts
      scorer: ({ output }) =>
        checkSkeleton(output.output, output.source, {
          headingsAreContent: SKELETON_SOURCE_RECIPES[output.recipe].headingsAreContent,
        }).value,
```

- [ ] **7. lépés: Futtasd a mérőtesztet**

Futtasd: `pnpm exec vitest run src/rubric/skeleton-gate.test.ts`
Várt: zöld, és a konzolon **18 címkézett eset**, `precision: 1.000`,
`recall: 1.000`.

- [ ] **8. lépés: Futtasd a teljes tesztkészletet és az evalt**

Futtasd: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld.

Futtasd: `pnpm exec evalite run evals/translate.eval.ts`
Várt: hat `ok` eset fut (a négy régi és a két új), mindegyiknél `vazkapu` és
`celnyelv` 1,0.

- [ ] **9. lépés: Commit**

```bash
git add evals/fixtures/skeleton.ts src/rubric/skeleton-gate.test.ts evals/translate.eval.ts
git commit -m "test(rubric): a mért valós hibamód a címkézett halmazban

- Hosszabb summary és bloom fixture, amelyeken a tűrés egyáltalán él
- Két ok eset a kalibrálás hibamódjából: többlet fejléc, bekezdésbontás
- Egy broken eset arra, hogy a tűrés nem nyel el két kimaradt bekezdést
- Egy broken eset, amit csak a headingsAreContent szigor fog meg
- Az összevont bekezdés esetét immár az időbélyeg fogja meg, nem a blokkszám
- A mérés és az eval a forrásrecept szigorával hívja a kaput

Refs #42"
```

---

## Task 4: A hosszú fordítás diagnosztikája

**Fájlok:**
- Módosít: `evals/measure/calibrate-translate.ts:245-281`

**Interfészek:**
- Használja: `checkSkeleton` (Task 1), `Recipe.headingsAreContent` (Task 2).
- Előállítja: a mentett nyers adat `long.gaps` mezője.

Ez a szkript valódi modellhívásokat végez, ezért **nem futtatjuk** — csak a
típus- és lintellenőrzés fut rá. A #42 második fele (darabolás) ezzel az adattal
lesz eldönthető.

- [ ] **1. lépés: A `LongRecord` bővítése**

```ts
interface LongRecord {
  itemId: string
  title: string
  words: number
  seconds: number
  outputTokens: number | null
  outputRatio: number | null
  /** A vázkapu ítélete a hosszú fordításon; hiba esetén `null`. */
  skeleton: number | null
  /**
   * A vázkapu megnevezett hiányai. A #42 nyitva hagyott kérdéséhez — miért
   * bukik a hosszú fordítás — a 0/1 ítélet kevés volt.
   */
  gaps: string[]
  error: string | null
}
```

- [ ] **2. lépés: A hiánylista kitöltése**

A `try` ágban a `checkSkeleton` hívás eredményét tartsd meg, és a szigort a
forrásreceptből vedd (a hosszú eset `clean` forrású):

```ts
    const skeleton = checkSkeleton(result.value, long.body, {
      headingsAreContent: cleanRecipe.headingsAreContent,
    })
    longRecord = {
      itemId: long.item.itemId,
      title: long.item.title,
      words: long.words,
      seconds: seconds(),
      outputTokens: result.usage.outputTokens,
      outputRatio: result.usage.outputTokens / (long.words * TOKENS_PER_WORD),
      skeleton: skeleton.value,
      gaps: skeleton.gaps,
      error: null,
    }
```

A `catch` ágban a `gaps: [],` sor kerül a `skeleton: null,` mellé.

- [ ] **3. lépés: A hiánylista a konzolon is látszik**

A hosszú esetet kiíró `console.log` hívás első ága:

```ts
  console.log(
    longRecord.error === null
      ? `hosszú forrás ${String(long.words)} szó: ${longRecord.seconds.toFixed(0)} mp, ` +
          `${String(longRecord.outputTokens)} kimeneti token, vázkapu ${String(longRecord.skeleton)}` +
          (longRecord.gaps.length > 0 ? `\n  hiányok: ${longRecord.gaps.join(' | ')}` : '')
      : `hosszú forrás ${String(long.words)} szó: HIBA ${longRecord.seconds.toFixed(0)} mp után — ${longRecord.error}`,
  )
```

- [ ] **4. lépés: Ellenőrzés modellhívás nélkül**

Futtasd: `pnpm typecheck && pnpm lint`
Várt: hibamentes.

Futtasd: `pnpm calibrate:translate --estimate`
Várt: a becslés kiírása és `exit 0`, **modellhívás nélkül** (a `--estimate`
kapcsoló a becslés után kilép). Ha a gépen nincs állapottár vagy konfig, a
szkript beszédes hibával áll meg — ez is elfogadható eredmény, a lényeg, hogy
ne típushibán bukjon el.

- [ ] **5. lépés: Commit**

```bash
git add evals/measure/calibrate-translate.ts
git commit -m "feat(evals): a hosszú fordítás vázkapu-hiányai is mentődnek

- A LongRecord hiánylistát is tárol, nem csak a 0/1 ítéletet
- A szigor a clean forrásreceptből jön
- A konzol kiírja a hiányokat, ha vannak

Refs #42"
```

---

## Task 5: Dokumentáció

**Fájlok:**
- Módosít: `README.md:124`
- Módosít: `docs/roadmap.md:193`
- Módosít: `docs/decisions/0012-forditas.md` (a Következmények lista vége)

- [ ] **1. lépés: README**

A fordítás bekezdésében a vázkaput leíró mondat végére (a „…és a kódblokkok
megmaradtak." után) kerül egy mondat:

```markdown
A bekezdések és a fejlécek számában kis eltérést tűr — a természetes
átfogalmazás ne buktasson el hibátlan fordítást —, a Bloom-kártyák fejléceiben
viszont nem, mert ott egy fejléc egy kártya.
```

- [ ] **2. lépés: Roadmap**

A „Kész, ha (fordítás)" lista mai pontja:

```markdown
- Ha a fordításból kimarad egy bekezdés, a jegyzet nulla bíró-hívással,
  megnevezett hiánnyal kerül ki.
```

helyére (a tűrés óta egyetlen bekezdés eltérése egy hosszú jegyzetben már
átmehet, az időbélyeges bekezdés viszont nem):

```markdown
- Ha a fordításból kimarad egy időbélyeges bekezdés, a jegyzet nulla
  bíró-hívással, megnevezett hiánnyal kerül ki.
```

- [ ] **3. lépés: ADR 0012 kiegészítése**

A `docs/decisions/0012-forditas.md` Következmények listájának végére, a
`Spec:` sor **elé**:

```markdown
- A vázkapu a [#42](https://github.com/pcsontos/transcript-refinery/issues/42)
  nyomán **tűrő** lett a puha vázelemeken: a bekezdés- és a fejlécszám a forrás
  5%-áig, de legalább egy elemig eltérhet, öt elem alatt viszont nincs tűrés. A
  Bloom-forrású fordításnál a fejléc szigorú marad (`Recipe.headingsAreContent`),
  mert ott egy `##` fejléc egy kártya. Az így átengedett, finomabb hiányokat a
  fordításhűség-bíró fogja — a kapu olcsó szűrő, nem az egyetlen védelem. Spec:
  [`plans/2026-09-18-vazkapu-tolerancia-spec.md`](<../plans/2026-09-18-vazkapu-tolerancia-spec.md>).
```

- [ ] **4. lépés: A vault-lint ellenőrzése**

Futtasd: `pnpm test && pnpm lint`
Várt: zöld — a repó Markdown-linkszabálya (`<>` a linkcél körül) a docs
fájlokra is él.

- [ ] **5. lépés: Commit**

```bash
git add README.md docs/roadmap.md docs/decisions/0012-forditas.md
git commit -m "docs: a vázkapu toleranciája a READMEban, a roadmapben és az ADRben

Refs #42"
```

---

## Záró ellenőrzés

- [ ] **1. lépés: Teljes ellenőrzés**

Futtasd: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld.

- [ ] **2. lépés: A spec sikerkritériumainak végigmérése**

A spec hét kritériuma közül ötöt a tesztek fednek; a hatodikat és a hetediket
kézzel nézd meg:

| kritérium | hol látszik |
|---|---|
| 1. precision 1,000 / recall 1,000 a 18 elemű halmazon | `pnpm exec vitest run src/rubric/skeleton-gate.test.ts` konzolkiírása |
| 2. `summary` forrás, 6 → 7 fejléc: **1** | `skeleton-gate` `summary-tobblet-fejlec` esete `ok`-ként átmegy |
| 3. ugyanaz hatkártyás `bloom` forrással: **0**, megnevezett hiánnyal | `skeleton-gate` `bloom-cimkebol-fejlec-hosszu` esete + `translate.test.ts` „a bloom forrású fordítás vázkapuja a fejlécszámra szigorú" |
| 4. két kimaradt bekezdés: **0** | `skeleton.test.ts` „a két kimaradt bekezdést a tűrés nem nyeli el" |
| 5. fejléc nélküli forrásban megjelenő fejléc: **0** | `skeleton.test.ts` „öt elem alatt nincs tűrés…" |
| 6. a `skeleton.test.ts` minden esete zöld | `pnpm test` |
| 7. `pnpm calibrate:translate --estimate` lefut | Task 4, 4. lépés |

- [ ] **3. lépés: PR nyitása**

```bash
git push -u origin feat/vazkapu-tolerancia
gh pr create --title "Vázkapu-tolerancia (#42)" --body "$(cat <<'EOF'
A #42 első fele: a fordítás vázkapuja tűr a puha vázelemeken.

## Mi változott

- A bekezdés- és a fejlécszám eltérése a forrás 5%-áig, de legalább egy elemig
  elfogadott; **öt elem alatt nincs tűrés** (ott egy egységnyi eltérés is nagy
  arány, és a `formatCriterion` nem véd az escape nélkül maradt fejléc ellen).
- A `bloom` recept új `headingsAreContent` mezővel jelöli, hogy nála a fejlécek
  darabszáma tartalom; a fordítórecept ezt veszi át a kapuba.
- Az időbélyeg, a listaelem, a táblázatsor, a kódkerítés és a linkcél
  összevetése bájtra pontos maradt, és a hiányüzenetek szövege sem változott.
- A címkézett halmaz három új esettel bővült a kalibrálás mért hibamódjából.
- A kalibráló szkript a hosszú fordítás hiánylistáját is menti.

## Mért eredmény

A 17 elemű címkézett halmazon **precision 1,000, recall 1,000**, és a
kalibrálás mind a négy valós mintája (amely eddig 0 pontot kapott) átmegy a
kapun. Valódi modellhívás nem volt: minden mérés offline, a meglévő adatból.

## Ami nyitva marad

A #42 második fele, a hosszú fordítások darabolása: arról mérés nélkül nem
lehet dönteni, és a most bevezetett diagnosztika adja majd hozzá az adatot.

Refs #42
EOF
)"
```

A PR **ne** zárja le a #42-t automatikusan — az issue a darabolás miatt nyitva
marad, ezért `Refs #42` szerepel benne, nem `Closes #42`.
