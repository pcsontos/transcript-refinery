# Az iteráció megmérése — implementációs terv

> **Ágenseknek:** KÖTELEZŐ AL-SKILL: `superpowers:subagent-driven-development`
> (ajánlott) vagy `superpowers:executing-plans` a feladatonkénti végrehajtáshoz.
> A lépések jelölőnégyzetes (`- [ ]`) szintaxist használnak.

**Cél:** Megmérni valódi modellhívásokkal, javít-e a javító kör, mennyivel és
mennyiért, publikálni az eredményt, és végrehajtani a belőle következő döntést.

**Architektúra:** A `refine` opcionális `stopEarly` kapcsolót és körönkénti,
**csak számokat tartalmazó** nyomvonalat kap, hogy a mérés a produkciós loopot
mérje, ne egy másolatát. A mintavétel, az összesítés, a döntési szabály és a
riport tiszta függvények az `evals/measure/` alatt, teljes teszttel; egyedül a
futtató végez valódi hívást, és az vékony héj.

**Tech stack:** TypeScript 5.9, Node 26.2, pnpm 11.24, vitest 4, zod 4,
Vercel AI SDK LiteLLM gateway mögött. Egyetlen új fejlesztői függőség: `tsx`
(a Feladat 5 indokolja).

**Spec:** `docs/plans/2026-09-09-fazis-3-meres-spec.md`

## Globális megkötések

- **Egyetlen teszt sem hív modellt.** A mérés valódi hívásokat végez, de kézzel
  indítva, a tesztfutáson kívül.
- Minden parancs `mise exec --` alatt fut (`mise exec -- pnpm test`).
- Magyar a dokumentáció, a kódkomment, a felhasználói kimenet és a
  commit-üzenet; **angol** a produkciós azonosító és minden, ami a modellnek megy.
- Nincs közvetlen munka a `main` ágon. Az ág: `feat/fazis-3-meres`.
- A privát réteg (`evals/private/`) és a helyi konfiguráció verziókövetésen
  kívül marad.
- A commit-üzenetek nem tartalmaznak attribúciós láblécet.
- Minden feladat végén zöldnek kell lennie: `pnpm test`, `pnpm typecheck`,
  `pnpm lint`.

## Fájlszerkezet

| fájl | felelősség |
|---|---|
| `src/refine/loop.ts` *(módosít)* | `stopEarly` kapcsoló, `RoundTrace` nyomvonal |
| `src/refine/loop.test.ts` *(módosít)* | a fenti tesztjei |
| `vitest.config.ts` *(módosít)* | az `evals/**/*.test.ts` bevonása |
| `evals/measure/sample.ts` *(új)* | hossz szerint rétegzett, determinisztikus mintavétel |
| `evals/measure/stats.ts` *(új)* | összesítés, zajszint, mentési arány, döntési szabály |
| `evals/measure/report.ts` *(új)* | aggregátum → Markdown, tartalom nélkül |
| `evals/measure/run.ts` *(új)* | a futtató: valódi hívások, költségkapu, kiírás |
| `docs/measurements/` *(új mappa)* | a publikált riport |

A három tiszta modul azért külön fájl, mert külön is elutasítható: a mintavétel
hibája nem érinti a döntési szabályt, és fordítva.

---

## Feladat 1: Motorvarrat — körönkénti nyomvonal

**Fájlok:**
- Módosít: `src/refine/loop.ts`
- Teszt: `src/refine/loop.test.ts`

**Interfészek:**
- Fogyaszt: `ModelUsage` (`src/model/client.ts:8`), `scoreRubric`
  (`src/rubric/types.ts:51`).
- Termel: `RoundTrace`, `RefineOptions.stopEarly`, `RefineResult.rounds` — a
  Feladat 5 futtatója ezekre épül.

- [ ] **1. lépés: A bukó tesztek megírása**

A `src/refine/loop.test.ts` végére, a `describe('refine — strukturált recept')`
blokk **után**:

```ts
describe('refine — mérési mód', () => {
  it('stopEarly: false mellett az elsőre átmenő elem is végigfuttatja a köröket', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'jo', score: 0.95 },
      { text: 'masodik', score: 0.5 },
      { text: 'harmadik', score: 0.6 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client, {
      stopEarly: false,
    })

    // Alapból egyetlen generálás lenne: 0,95 átmegy a 0,8-as küszöbön.
    expect(result.generations).toBe(3)
    expect(generalt).toEqual(['jo', 'masodik', 'harmadik'])
    expect(result.rounds.map((r) => r.score)).toEqual([0.95, 0.5, 0.6])
  })

  it('mérési módban is a legjobb kört tartja meg, nem az utolsót', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'jo', score: 0.95 },
      { text: 'gyenge', score: 0.2 },
      { text: 'kozepes', score: 0.6 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client, {
      stopEarly: false,
    })

    expect(result.output).toBe('jo')
    expect(result.score).toBe(0.95)
  })

  it('a nyomvonal a hiányok SZÁMÁT viszi, nem a szövegét', async () => {
    const { client, pontszamok } = scriptedClient([{ text: 'jo', score: 0.95 }])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    // A teszt-rubrika egyetlen hiányt ad: 'valami hiányzik'.
    expect(result.rounds[0]!.gaps).toBe(1)
    expect(JSON.stringify(result.rounds)).not.toContain('valami hiányzik')
  })

  it('a körök használata összegezve a teljes futás használatát adja', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    const osszeg = result.rounds.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.usage.inputTokens,
        outputTokens: acc.outputTokens + r.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    )
    expect(osszeg).toEqual(result.usage)
  })

  it('produkciós futásban is kitölti a nyomvonalat, körönként egy bejegyzéssel', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.rounds).toHaveLength(result.generations)
  })
})
```

- [ ] **2. lépés: A tesztek futtatása, hogy bukjanak**

Futtasd: `mise exec -- pnpm vitest run src/refine/loop.test.ts`
Várt: FAIL — `stopEarly` és `rounds` nem létezik (typecheck-hiba a `rounds`-ra).

- [ ] **3. lépés: A típusok bővítése**

A `src/refine/loop.ts` elejére, a `RefineOptions` fölé:

```ts
/**
 * Egy generálási kör mérőszámai. **Számokat visz, szöveget nem**: a `gaps` a
 * hiányok száma, nem a listája. Így a nyomvonalon keresztül nem juthat
 * vault-tartalom a mérési adatba vagy a publikált riportba.
 */
export interface RoundTrace {
  score: number
  gaps: number
  /** A kör generálásának és pontozásának együttes felhasználása. */
  usage: ModelUsage
}
```

A `RefineOptions` kiegészítése:

```ts
export interface RefineOptions {
  /** Felülbírálja a recept saját korlátját. Nulla = nincs javító kör. */
  maxIterations?: number
  /**
   * Hamisra állítva a loop minden kört lefuttat: sem a küszöb átlépése, sem a
   * nem-javulási őr nem szakítja meg. Kizárólag a mérés használja — a
   * produkciós út alapértelmezése változatlanul `true`.
   */
  stopEarly?: boolean
}
```

A `RefineResult` kiegészítése, a `usage` mező után:

```ts
  /** Körönkénti mérőszámok, generálásonként egy bejegyzés. */
  rounds: RoundTrace[]
```

- [ ] **4. lépés: A loop átírása**

A `src/refine/loop.ts` törzsében. A `usage` és az `add` deklarációja után:

```ts
  const stopEarly = opts.stopEarly ?? true
  const rounds: RoundTrace[] = []
  const roundUsage = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  })
```

Az első kör pontozása után, a `let best = ...` **elé**:

```ts
  rounds.push({
    score: firstScore.value,
    gaps: firstScore.gaps.length,
    usage: roundUsage(first.usage, firstScore.usage),
  })
```

A ciklus fejének cseréje. Régi:

```ts
  while (best.score < recipe.rubric.passThreshold && generations <= maxIterations) {
```

Új:

```ts
  while (
    generations <= maxIterations &&
    (!stopEarly || best.score < recipe.rubric.passThreshold)
  ) {
```

A ciklusmagban, a `scored` kiszámítása és az `add(scored.usage)` után:

```ts
    rounds.push({
      score: scored.value,
      gaps: scored.gaps.length,
      usage: roundUsage(next.usage, scored.usage),
    })
```

A nem-javulási őr cseréje. Régi:

```ts
    if (scored.value <= best.score) break
```

Új:

```ts
    // Nem-javulási őr. Az azonos pontszám is megállás: ha egy újabb kör nem
    // hozott előrelépést, a következő sem fog, és a loop csak költene. Mérési
    // módban nem állunk meg — a rosszabb kört sem tartjuk meg, de lefuttatjuk,
    // mert a mérés épp arra kíváncsi, mit hoz a kör.
    if (scored.value <= best.score) {
      if (stopEarly) break
      continue
    }
```

A visszatérés kiegészítése:

```ts
  return { ...best, generations, usage, rounds }
```

- [ ] **5. lépés: A tesztek futtatása**

Futtasd: `mise exec -- pnpm test`
Várt: PASS — az **összes** meglévő loop-teszt is, módosítás nélkül. Ez a varrat
regressziós horgonya: ha bármelyik elmozdult, a varrat rossz, és vissza kell
menni a 4. lépéshez.

Futtasd még: `mise exec -- pnpm typecheck && mise exec -- pnpm lint`

- [ ] **6. lépés: Mutációs ellenőrzés**

Az új tesztek zölden születhetnek, ezért igazolni kell, hogy tudnak bukni.
Fájlonkénti mentéssel dolgozz, **ne** `git checkout -- src/`-vel — az a
munkafa többi részét is visszaállítja:

```bash
cp src/refine/loop.ts /tmp/loop.bak
# Mutáció A: a stopEarly figyelmen kívül hagyása
#   a ciklusfejben (!stopEarly || ...) → (best.score < recipe.rubric.passThreshold)
# Mutáció B: a gaps.length helyett gaps.length + 1
# Mutáció C: a rounds.push kihagyása az első körnél
mise exec -- pnpm vitest run
cp /tmp/loop.bak src/refine/loop.ts
```

Várt: mindhárom mutáció legalább egy tesztet bukat. Ha valamelyik túléli, a
hozzá tartozó teszt nem mér semmit — írd meg rendesen, mielőtt továbbmész.

- [ ] **7. lépés: Commit**

```bash
git add src/refine/loop.ts src/refine/loop.test.ts
git commit -F - <<'EOF'
feat(refine): körönkénti nyomvonal és mérési mód a loopban

- A stopEarly kapcsoló kikapcsolja a korai megállást
- A rounds nyomvonal körönként pontszámot, hiányszámot és tokent visz
- A nyomvonal számokat visz, szöveget nem: tartalom nem szivároghat
- A produkciós út viselkedése változatlan

Refs #16
EOF
```

---

## Feladat 2: Rétegzett, determinisztikus mintavétel

**Fájlok:**
- Módosít: `vitest.config.ts`
- Létrehoz: `evals/measure/sample.ts`
- Teszt: `evals/measure/sample.test.ts`

**Interfészek:**
- Termel: `SampleCandidate`, `stratifiedSample(candidates, perStratum, strata?)`
  → `string[]` (elemazonosítók). A Feladat 5 futtatója ezt hívja.

- [ ] **1. lépés: A vitest bevonja az evals tesztjeit**

A `vitest.config.ts` `include` mezője ma csak a `src`-t fedi, tehát az
`evals/` alatti tesztek **némán kimaradnának** a futásból:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
    environment: 'node',
  },
})
```

Az `evals/summary.eval.ts` nem érintett: a minta `*.test.ts`-re illeszkedik.

- [ ] **2. lépés: A bukó tesztek megírása**

Új fájl: `evals/measure/sample.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { stratifiedSample, type SampleCandidate } from './sample.js'

/** 100 jelölt, 100-tól 10 000 szóig egyenletesen. */
const JELOLTEK: SampleCandidate[] = Array.from({ length: 100 }, (_, i) => ({
  itemId: `elem-${String(i).padStart(3, '0')}`,
  words: 100 + i * 100,
}))

describe('stratifiedSample', () => {
  it('a kért számú elemet adja: négy réteg × öt elem', () => {
    expect(stratifiedSample(JELOLTEK, 5)).toHaveLength(20)
  })

  it('kétszer futtatva ugyanazt adja', () => {
    expect(stratifiedSample(JELOLTEK, 5)).toEqual(stratifiedSample(JELOLTEK, 5))
  })

  it('a bemenet sorrendjétől független', () => {
    const kevert = [...JELOLTEK].reverse()
    expect(stratifiedSample(kevert, 5)).toEqual(stratifiedSample(JELOLTEK, 5))
  })

  it('mind a négy hossz-negyedből választ', () => {
    const valasztott = new Set(stratifiedSample(JELOLTEK, 5))
    const hosszak = JELOLTEK.filter((c) => valasztott.has(c.itemId)).map((c) => c.words)
    // A negyedek határai a 100 elemű, egyenletes halmazon: 2500, 5000, 7500.
    expect(hosszak.filter((w) => w <= 2500).length).toBe(5)
    expect(hosszak.filter((w) => w > 2500 && w <= 5000).length).toBe(5)
    expect(hosszak.filter((w) => w > 5000 && w <= 7500).length).toBe(5)
    expect(hosszak.filter((w) => w > 7500).length).toBe(5)
  })

  it('azonos szóhossznál az azonosító dönt, tehát stabil marad', () => {
    const egyforma: SampleCandidate[] = [
      { itemId: 'c', words: 500 },
      { itemId: 'a', words: 500 },
      { itemId: 'b', words: 500 },
      { itemId: 'd', words: 500 },
    ]
    expect(stratifiedSample(egyforma, 1)).toEqual(stratifiedSample([...egyforma].reverse(), 1))
  })

  it('kevés jelöltnél hibát dob, nem ad csendben kisebb mintát', () => {
    expect(() => stratifiedSample(JELOLTEK.slice(0, 10), 5)).toThrow(/kevés jelölt/i)
  })
})
```

- [ ] **3. lépés: A tesztek futtatása, hogy bukjanak**

Futtasd: `mise exec -- pnpm vitest run evals/measure/sample.test.ts`
Várt: FAIL — `Cannot find module './sample.js'`.

- [ ] **4. lépés: A mintavétel megírása**

Új fájl: `evals/measure/sample.ts`

```ts
/** Egy mintavételi jelölt: elemazonosító és a normalizált átirat szószáma. */
export interface SampleCandidate {
  itemId: string
  words: number
}

/**
 * Hossz szerint rétegzett, determinisztikus minta.
 *
 * A korpusz hossza két nagyságrendet fog át, ezért egy találomra vett minta
 * kihagyhatja a hosszú elemeket — pedig épp ott érdekes a javító kör, mert ott
 * van a legtöbb lefedni való. A jelölteket ezért szóhossz szerint `strata`
 * egyenlő rétegre osztjuk, és mindegyikből `perStratum` elemet veszünk,
 * egyenletesen szétszórva a rétegen belül.
 *
 * A determinizmus nem kényelmi kérdés: a mérés ismétlései csak akkor
 * ismétlések, ha ugyanazt a halmazt mérik. Ezért rendezünk (hossz, azonosító)
 * szerint — az azonosító a holtverseny feloldása.
 *
 * Kevés jelöltnél **hibát dob**: egy csendben kisebb minta a mérés erejét
 * gyengítené anélkül, hogy bárki észrevenné.
 */
export function stratifiedSample(
  candidates: readonly SampleCandidate[],
  perStratum: number,
  strata = 4,
): string[] {
  const kell = perStratum * strata
  if (candidates.length < kell) {
    throw new Error(
      `túl kevés jelölt a mintavételhez: ${String(candidates.length)} van, ${String(kell)} kellene`,
    )
  }

  const rendezett = [...candidates].sort(
    (a, b) => a.words - b.words || a.itemId.localeCompare(b.itemId),
  )

  const valasztott: string[] = []
  const retegMeret = Math.floor(rendezett.length / strata)
  for (let reteg = 0; reteg < strata; reteg++) {
    const kezdet = reteg * retegMeret
    // Az utolsó réteg viszi a maradékot, hogy egyetlen elem se vesszen el.
    const veg = reteg === strata - 1 ? rendezett.length : kezdet + retegMeret
    const hossz = veg - kezdet
    for (let i = 0; i < perStratum; i++) {
      // Egyenletes szétszórás a rétegen belül, a szélek elkerülésével.
      const eltolas = Math.floor(((i + 0.5) * hossz) / perStratum)
      valasztott.push(rendezett[kezdet + eltolas]!.itemId)
    }
  }
  return valasztott
}
```

- [ ] **5. lépés: A tesztek futtatása**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várt: PASS mindhárom.

- [ ] **6. lépés: Mutációs ellenőrzés**

```bash
cp evals/measure/sample.ts /tmp/sample.bak
# Mutáció A: a rendezésből az azonosítós holtverseny-feloldás törlése
#   (a.words - b.words || a.itemId.localeCompare(b.itemId)) → (a.words - b.words)
# Mutáció B: a hiba eldobása helyett csendes visszatérés a meglévő elemekkel
mise exec -- pnpm vitest run
cp /tmp/sample.bak evals/measure/sample.ts
```

Várt: az A a „bemenet sorrendjétől független" vagy az „azonos szóhossznál"
tesztet bukatja, a B a „kevés jelöltnél hibát dob" tesztet.

- [ ] **7. lépés: Commit**

```bash
git add vitest.config.ts evals/measure/sample.ts evals/measure/sample.test.ts
git commit -F - <<'EOF'
feat(evals): hossz szerint rétegzett, determinisztikus mintavétel

- Négy hossz-negyed, negyedenként azonos számú elem
- A rendezés holtversenyét az azonosító dönti, tehát stabil
- Kevés jelöltnél hibát dob, nem ad csendben kisebb mintát
- A vitest mostantól az evals tesztjeit is futtatja

Refs #16
EOF
```

---

## Feladat 3: Összesítés és az előre rögzített döntési szabály

**Fájlok:**
- Létrehoz: `evals/measure/stats.ts`
- Teszt: `evals/measure/stats.test.ts`

**Interfészek:**
- Termel: `RunRecord`, `RoundStats`, `Aggregate`, `Decision`,
  `aggregate(records, passThreshold)`, `decide(agg, rescueFloor?)`. A Feladat 4
  riportja és a Feladat 5 futtatója ezekre épül.

- [ ] **1. lépés: A bukó tesztek megírása**

Új fájl: `evals/measure/stats.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { aggregate, decide, type RunRecord } from './stats.js'

/** Három elem, három ismétléssel, körönként megadott pontszámmal. */
function rekordok(
  terv: { itemId: string; korok: number[][] }[],
): RunRecord[] {
  return terv.flatMap((elem) =>
    elem.korok.map((scores, repeat) => ({
      itemId: elem.itemId,
      repeat,
      scores,
      usdPerRound: scores.map(() => 0.02),
    })),
  )
}

describe('aggregate', () => {
  it('körönként átlagol, és az első kör javulását nullának veszi', () => {
    const agg = aggregate(
      rekordok([{ itemId: 'a', korok: [[0.5, 0.7], [0.5, 0.9]] }]),
      0.8,
    )
    expect(agg.rounds[0]!.meanScore).toBeCloseTo(0.5, 5)
    expect(agg.rounds[0]!.meanGain).toBe(0)
    expect(agg.rounds[1]!.meanScore).toBeCloseTo(0.8, 5)
    expect(agg.rounds[1]!.meanGain).toBeCloseTo(0.3, 5)
  })

  it('a zajszint az elemenkénti első köri szórások mediánja', () => {
    // 'a': 0,4/0,5/0,6 → mintaszórás 0,1. 'b': három egyforma → 0.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4], [0.5], [0.6]] },
        { itemId: 'b', korok: [[0.7], [0.7], [0.7]] },
      ]),
      0.8,
    )
    // Két elem: a medián a két szórás átlaga.
    expect(agg.noise).toBeCloseTo(0.05, 5)
  })

  it('a mentési arány nevezője csak az előző körben megbukott párok száma', () => {
    const agg = aggregate(
      rekordok([
        // Bukott elsőre, a második átvitte.
        { itemId: 'a', korok: [[0.5, 0.9]] },
        // Bukott elsőre, a második sem vitte át.
        { itemId: 'b', korok: [[0.5, 0.6]] },
        // Elsőre átment: nem szerepel a nevezőben.
        { itemId: 'c', korok: [[0.9, 0.95]] },
      ]),
      0.8,
    )
    expect(agg.rounds[1]!.rescueBase).toBe(2)
    expect(agg.rounds[1]!.rescueRate).toBeCloseTo(0.5, 5)
  })
})

describe('decide', () => {
  it('a zaj alatti javulás és az alacsony mentési arány egy generálásra állít', () => {
    // Zaj 0,05; a második kör javulása 0,01; mentés 0/2.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.41], [0.5, 0.51], [0.6, 0.61]] },
        { itemId: 'b', korok: [[0.5, 0.51], [0.5, 0.51], [0.5, 0.51]] },
      ]),
      0.8,
    )
    expect(decide(agg).maxIterations).toBe(0)
  })

  it('a zaj fölötti javulás megtartja a második kört', () => {
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.9], [0.5, 0.95], [0.6, 0.92]] },
        { itemId: 'b', korok: [[0.5, 0.9], [0.5, 0.9], [0.5, 0.9]] },
      ]),
      0.8,
    )
    expect(decide(agg).maxIterations).not.toBe(0)
  })

  it('magas mentési arány önmagában megtartja a második kört', () => {
    // A javulás a zaj alatt van, de minden bukott párt átvisz a küszöbön.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.79, 0.81], [0.78, 0.82], [0.77, 0.83]] },
        { itemId: 'b', korok: [[0.79, 0.81], [0.79, 0.81], [0.79, 0.81]] },
      ]),
      0.8,
    )
    expect(agg.rounds[1]!.rescueRate).toBe(1)
    expect(decide(agg).maxIterations).not.toBe(0)
  })

  it('ha a második kör megéri, de a harmadik nem, két generálásra áll', () => {
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.9, 0.9], [0.5, 0.95, 0.95], [0.6, 0.92, 0.92]] },
        { itemId: 'b', korok: [[0.5, 0.9, 0.9], [0.5, 0.9, 0.9], [0.5, 0.9, 0.9]] },
      ]),
      0.8,
    )
    expect(decide(agg).maxIterations).toBe(1)
  })

  it('a döntés megnevezi az indokot, a három mennyiség értékével', () => {
    const agg = aggregate(rekordok([{ itemId: 'a', korok: [[0.5, 0.51]] }]), 0.8)
    expect(decide(agg).reason).toMatch(/javul/i)
  })
})
```

- [ ] **2. lépés: A tesztek futtatása, hogy bukjanak**

Futtasd: `mise exec -- pnpm vitest run evals/measure/stats.test.ts`
Várt: FAIL — `Cannot find module './stats.js'`.

- [ ] **3. lépés: Az összesítés megírása**

Új fájl: `evals/measure/stats.ts`

```ts
/** Egy `(elem, ismétlés)` pár körönkénti mérőszámai. */
export interface RunRecord {
  itemId: string
  /** Hányadik ismétlés, nullától. */
  repeat: number
  /** Körönkénti pontszám, generálásonként egy. */
  scores: number[]
  /** Körönkénti költség dollárban. */
  usdPerRound: number[]
}

export interface RoundStats {
  /** Hányadik generálás, egytől. */
  round: number
  meanScore: number
  /** Mennyivel magasabb az előző körnél. Az első körnél nulla. */
  meanGain: number
  /** Az előző körben megbukott párok közül hány érte el a küszöböt. */
  rescueRate: number
  /** A mentési arány nevezője: hány pár bukott az előző körben. */
  rescueBase: number
  /** Az addigi körök halmozott átlagköltsége elemenként. */
  meanUsd: number
}

export interface Aggregate {
  /** Az elemenkénti első köri szórások mediánja: amennyit magától ingadozik. */
  noise: number
  rounds: RoundStats[]
}

export interface Decision {
  maxIterations: 0 | 1 | 2
  reason: string
}

/** Mintaszórás (n−1). Egyetlen mintánál nulla. */
function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * A nyers futásokból a döntéshez szükséges három mennyiség.
 *
 * A **zajszint** azért elemenkénti szórások mediánja, és nem egyetlen globális
 * szórás: az elemek nehézsége eltér, és minket az érdekel, mennyit ingadozik
 * ugyanaz az elem önmagához képest.
 *
 * A **mentési arány** nevezője szándékosan szűk: éles futásban a javító kör
 * csak akkor indul, ha az előző kör megbukott, tehát a döntés szempontjából
 * kizárólag ezek a párok számítanak.
 */
export function aggregate(
  records: readonly RunRecord[],
  passThreshold: number,
): Aggregate {
  const korokSzama = Math.max(...records.map((r) => r.scores.length))

  const elemek = new Map<string, number[]>()
  for (const r of records) {
    const elso = r.scores[0]
    if (elso === undefined) continue
    elemek.set(r.itemId, [...(elemek.get(r.itemId) ?? []), elso])
  }
  const noise = median([...elemek.values()].map(stdev))

  const rounds: RoundStats[] = []
  for (let k = 0; k < korokSzama; k++) {
    const jelen = records.filter((r) => r.scores.length > k)
    const scores = jelen.map((r) => r.scores[k]!)

    const elozoBukott = k === 0 ? [] : jelen.filter((r) => r.scores[k - 1]! < passThreshold)
    const mentett = elozoBukott.filter((r) => r.scores[k]! >= passThreshold)

    rounds.push({
      round: k + 1,
      meanScore: mean(scores),
      meanGain: k === 0 ? 0 : mean(jelen.map((r) => r.scores[k]! - r.scores[k - 1]!)),
      rescueRate: elozoBukott.length === 0 ? 0 : mentett.length / elozoBukott.length,
      rescueBase: elozoBukott.length,
      meanUsd: mean(
        jelen.map((r) => r.usdPerRound.slice(0, k + 1).reduce((s, v) => s + v, 0)),
      ),
    })
  }

  return { noise, rounds }
}

/**
 * Az előre rögzített döntési szabály (spec §5). A szabály a futás **előtt**
 * született; ez a függvény csak alkalmazza.
 *
 * Egy kör akkor „nem éri meg", ha a javulása a zajszint alatt van **és** a
 * mentési aránya a küszöb alatt. A két feltétel kapcsolata `és`: egy kör,
 * ami keveset javít átlagban, de sok bukott elemet átvisz a küszöbön,
 * megéri a pénzét.
 */
export function decide(agg: Aggregate, rescueFloor = 0.2): Decision {
  const nemEriMeg = (k: number): boolean => {
    const r = agg.rounds[k]
    if (!r) return false
    return r.meanGain < agg.noise && r.rescueRate < rescueFloor
  }

  const szam = (n: number): string => n.toFixed(4)
  const alap = `zajszint ${szam(agg.noise)}`

  if (nemEriMeg(1)) {
    const r = agg.rounds[1]!
    return {
      maxIterations: 0,
      reason: `a második kör javulása ${szam(r.meanGain)} < ${alap}, mentési aránya ${szam(r.rescueRate)} — nem éri meg`,
    }
  }
  if (nemEriMeg(2)) {
    const r = agg.rounds[2]!
    return {
      maxIterations: 1,
      reason: `a harmadik kör javulása ${szam(r.meanGain)} < ${alap}, mentési aránya ${szam(r.rescueRate)} — nem éri meg`,
    }
  }
  return {
    maxIterations: 2,
    reason: `mindkét javító kör kifizeti magát a ${alap} mellett`,
  }
}
```

- [ ] **4. lépés: A tesztek futtatása**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várt: PASS mindhárom.

- [ ] **5. lépés: Mutációs ellenőrzés**

```bash
cp evals/measure/stats.ts /tmp/stats.bak
# Mutáció A: az `és` `vagy`-ra cserélése a nemEriMeg-ben
# Mutáció B: a mentési arány nevezője az összes pár (jelen.length)
# Mutáció C: a mintaszórás nevezője n, nem n−1
mise exec -- pnpm vitest run
cp /tmp/stats.bak evals/measure/stats.ts
```

Várt: az A a „magas mentési arány önmagában megtartja" tesztet bukatja, a B a
„nevezője csak a megbukott párok" tesztet, a C a „zajszint mediánja" tesztet.

- [ ] **6. lépés: Commit**

```bash
git add evals/measure/stats.ts evals/measure/stats.test.ts
git commit -F - <<'EOF'
feat(evals): összesítés és az előre rögzített döntési szabály

- A zajszint az elemenkénti első köri szórások mediánja
- A mentési arány nevezője csak az előző körben megbukott párok
- A szabály a javulást ÉS a mentési arányt együtt nézi
- A döntés megnevezi az indokot a három mennyiség értékével

Refs #16
EOF
```

---

## Feladat 4: A riport — aggregátum, tartalom nélkül

**Fájlok:**
- Létrehoz: `evals/measure/report.ts`
- Teszt: `evals/measure/report.test.ts`

**Interfészek:**
- Fogyaszt: `Aggregate`, `Decision` (Feladat 3).
- Termel: `renderMeasurementReport(recipes, meta)` → `string`.

- [ ] **1. lépés: A bukó tesztek megírása**

Új fájl: `evals/measure/report.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { renderMeasurementReport } from './report.js'
import { aggregate, decide, type RunRecord } from './stats.js'

const REKORDOK: RunRecord[] = [
  { itemId: 'TITKOS-AZONOSITO-1', repeat: 0, scores: [0.5, 0.9], usdPerRound: [0.02, 0.02] },
  { itemId: 'TITKOS-AZONOSITO-1', repeat: 1, scores: [0.6, 0.9], usdPerRound: [0.02, 0.02] },
  { itemId: 'TITKOS-AZONOSITO-2', repeat: 0, scores: [0.7, 0.95], usdPerRound: [0.02, 0.02] },
]

const AGG = aggregate(REKORDOK, 0.8)

const META = {
  items: 20,
  repeats: 3,
  generations: 3,
  totalUsd: 7.41,
  draftModel: 'claude-sonnet-5',
  judgeModel: 'grok-4-fast-reasoning',
}

describe('renderMeasurementReport', () => {
  it('receptenként kiírja a döntést és a három mennyiséget', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).toContain('summary')
    expect(md).toMatch(/zajszint/i)
    expect(md).toMatch(/mentési arány/i)
    expect(md).toMatch(/maxIterations/)
  })

  it('egyetlen elemazonosítót sem tartalmaz', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).not.toContain('TITKOS')
  })

  it('kimondja a bíró nem-determinizmusát mint korlátot', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).toMatch(/nem-determinisztikus/i)
  })

  it('a riport átmegy a vault linterén: minden linkcél szögletes zárójelben', async () => {
    const { lintVaultMarkdown } = await import('../../src/vault/lint.js')
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(lintVaultMarkdown(md)).toEqual([])
  })
})
```

- [ ] **2. lépés: A tesztek futtatása, hogy bukjanak**

Futtasd: `mise exec -- pnpm vitest run evals/measure/report.test.ts`
Várt: FAIL — `Cannot find module './report.js'`.

- [ ] **3. lépés: A riport megírása**

Új fájl: `evals/measure/report.ts`

```ts
import type { Aggregate, Decision } from './stats.js'

export interface ReportMeta {
  items: number
  repeats: number
  generations: number
  totalUsd: number
  draftModel: string
  judgeModel: string
}

export interface RecipeResult {
  recipe: string
  agg: Aggregate
  decision: Decision
}

const n = (v: number): string => v.toFixed(4)
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/**
 * Aggregátum → publikálható Markdown.
 *
 * A függvény **szerkezetéből** következik, hogy nem szivárogtat tartalmat:
 * kizárólag számokat, receptneveket és modellneveket kap. Elemazonosító,
 * cím vagy jegyzet-részlet nem is jut el hozzá.
 */
export function renderMeasurementReport(
  recipes: readonly RecipeResult[],
  meta: ReportMeta,
): string {
  const sorok: string[] = [
    '# Javít-e a javító kör?',
    '',
    'Mérés a valós korpuszon, valódi modellhívásokkal. A dokumentum kizárólag',
    'aggregátumot közöl: elemcím, csatornanév és jegyzet-részlet nem szerepel benne.',
    '',
    '## A mérés kerete',
    '',
    '| | |',
    '|---|---|',
    `| elem | ${String(meta.items)}, hossz szerint rétegezve |`,
    `| ismétlés | ${String(meta.repeats)} |`,
    `| generálás | ${String(meta.generations)}, korai megállás nélkül |`,
    `| vázlatmodell | ${meta.draftModel} |`,
    `| bírómodell | ${meta.judgeModel} |`,
    `| tényleges költség | $${meta.totalUsd.toFixed(2)} |`,
    '',
  ]

  for (const { recipe, agg, decision } of recipes) {
    sorok.push(
      `## \`${recipe}\``,
      '',
      `Zajszint (az elemenkénti első köri szórások mediánja): **${n(agg.noise)}**`,
      '',
      '| kör | átlagpontszám | javulás | mentési arány | mentés nevezője | átlagköltség |',
      '|---|---|---|---|---|---|',
    )
    for (const r of agg.rounds) {
      sorok.push(
        `| ${String(r.round)} | ${n(r.meanScore)} | ${n(r.meanGain)} | ${pct(r.rescueRate)} | ${String(r.rescueBase)} | $${r.meanUsd.toFixed(4)} |`,
      )
    }
    sorok.push(
      '',
      `**Döntés: \`maxIterations: ${String(decision.maxIterations)}\`** — ${decision.reason}`,
      '',
    )
  }

  sorok.push(
    '## Korlátok',
    '',
    'A bíró maga is **nem-determinisztikus**: ugyanannak a kimenetnek két',
    'pontozása eltérhet. Az ismétlések ezt elnyelik, de nem tüntetik el — ezért',
    'mérjük a javulást a zajszinthez, és nem önmagában.',
    '',
    'A minta a valós korpusz egy rétegzett részhalmaza, nem a teljes korpusz.',
    'Az eredmény erre a korpuszra és ezekre a modellekre vonatkozik.',
    '',
  )

  return sorok.join('\n')
}
```

- [ ] **4. lépés: A tesztek futtatása**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várt: PASS mindhárom.

- [ ] **5. lépés: Mutációs ellenőrzés**

```bash
cp evals/measure/report.ts /tmp/report.bak
# Mutáció A: a „nem-determinisztikus" korlát-bekezdés törlése
# Mutáció B: a döntés sorának törlése
mise exec -- pnpm vitest run
cp /tmp/report.bak evals/measure/report.ts
```

Várt: az A a korlát-tesztet, a B a „receptenként kiírja a döntést" tesztet bukatja.

- [ ] **6. lépés: Commit**

```bash
git add evals/measure/report.ts evals/measure/report.test.ts
git commit -F - <<'EOF'
feat(evals): a mérés riportja aggregátumokból

- Csak számot, receptnevet és modellnevet kap: tartalmat nem is lát
- Receptenként kiírja a döntést és a hozzá vezető három mennyiséget
- Kimondja a bíró nem-determinizmusát mint korlátot

Refs #16
EOF
```

---

## Feladat 5: A futtató

**Fájlok:**
- Létrehoz: `evals/measure/run.ts`

**Interfészek:**
- Fogyaszt: `stratifiedSample` (F2), `aggregate`/`decide` (F3),
  `renderMeasurementReport` (F4), `refine` a `stopEarly: false` opcióval (F1),
  `loadConfig`/`loadModelConfig` (`src/config.ts`), `folderSource`
  (`src/source/folder.ts:116`), `normalizeItem` (`src/pipeline.ts:54`),
  `estimateItemUsd`/`createCostGuard` (`src/model/budget.ts`),
  `createModelClient` (`src/model/client.ts:72`).

Ez a fájl végez valódi modellhívást, ezért **nincs rá egységteszt** — a logikája
a Feladat 2-4 tesztelt moduljaiban él, ez csak összeköti őket. Pontosan ezért
kell vékonynak maradnia: ha ide üzleti logika kerül, az tesztelhetetlen lesz.

- [ ] **1. lépés: A futtató megírása**

Új fájl: `evals/measure/run.ts`

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { loadConfig, loadModelConfig } from '../../src/config.js'
import { createModelClient } from '../../src/model/client.js'
import { createCostGuard, estimateItemUsd } from '../../src/model/budget.js'
import { normalizeItem } from '../../src/pipeline.js'
import { flashcardsRecipe } from '../../src/recipe/flashcards.js'
import { summaryRecipe } from '../../src/recipe/summary.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { folderSource } from '../../src/source/folder.js'
import type { SourceItem } from '../../src/types.js'
import { renderMeasurementReport } from './report.js'
import { stratifiedSample, type SampleCandidate } from './sample.js'
import { aggregate, decide, type RunRecord } from './stats.js'

const RECEPTEK: Recipe[] = [summaryRecipe, flashcardsRecipe]
const MINTA_UTVONAL = join('evals', 'private', 'measurement-items.json')
const NYERS_UTVONAL = join('evals', 'private', 'measurement-raw.json')
const RIPORT_UTVONAL = join('docs', 'measurements', '2026-09-09-iteracio.md')

const { values } = parseArgs({
  options: {
    budget: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    items: { type: 'string', default: '20' },
  },
})

if (!values.budget) {
  console.error(
    'Kötelező a --budget kapcsoló, dollárban. Alapértelmezés szándékosan nincs:\n' +
      'a mérés valódi pénzt költ, ezért a keretet minden futásnál ki kell mondani.\n' +
      'Példa: pnpm measure --budget 10',
  )
  process.exit(2)
}
const keret = Number(values.budget)
const ismetlesek = Number(values.repeats)
const elemszam = Number(values.items)

const raw = parseYaml(await readFile('refinery.config.yaml', 'utf8')) as Record<string, unknown>
const cfg = loadConfig(raw, 'refinery.config.yaml')
const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)

// 1. Jelöltek: minden elem szószáma. Nulla modellhívás.
const items: SourceItem[] = []
for (const forras of cfg.sources) {
  items.push(...(await folderSource(forras, cfg.languages).discover()))
}
const jeloltek: SampleCandidate[] = []
const atiratok = new Map<string, { item: SourceItem; transcript: string }>()
for (const item of items) {
  try {
    const norm = await normalizeItem(item)
    jeloltek.push({ itemId: item.itemId, words: norm.wordsNormalized })
    atiratok.set(item.itemId, { item, transcript: norm.lines.join(' ') })
  } catch {
    // Sérült feliratfájl: kimarad a mintából, nem állítja meg a mérést.
  }
}

// 2. Minta: ha van rögzített, azt használjuk — az ismétlések csak így
//    ismétlések. Ha nincs, most rögzítjük.
let mintaIdk: string[]
try {
  mintaIdk = JSON.parse(await readFile(MINTA_UTVONAL, 'utf8')) as string[]
  console.log(`A rögzített minta betöltve: ${String(mintaIdk.length)} elem.`)
} catch {
  mintaIdk = stratifiedSample(jeloltek, elemszam / 4)
  await mkdir(join('evals', 'private'), { recursive: true })
  await writeFile(MINTA_UTVONAL, JSON.stringify(mintaIdk, null, 2), 'utf8')
  console.log(`Új minta rögzítve ide: ${MINTA_UTVONAL}`)
}

// 3. Költségkapu a becslésből: a keret fölött el sem indulunk.
const maxIterations = RECEPTEK[0]!.maxIterations
let becsult = 0
for (const id of mintaIdk) {
  const szo = jeloltek.find((j) => j.itemId === id)?.words ?? 0
  becsult += estimateItemUsd(szo, maxIterations, modelConfig) * ismetlesek * RECEPTEK.length
}
console.log(`Becsült költség: $${becsult.toFixed(2)} (keret: $${keret.toFixed(2)})`)
if (becsult > keret) {
  console.error('A becslés a keret fölött van — a mérés nem indul el.')
  process.exit(2)
}

// 4. A mérés. A költségőr a TÉNYLEGES használatból összegez, mert a becslés
//    tévedhet (decisions/0004).
const guard = createCostGuard(keret)
const client = createModelClient(modelConfig)
const eredmenyek = new Map<string, RunRecord[]>()

for (const recipe of RECEPTEK) {
  const rekordok: RunRecord[] = []
  for (const id of mintaIdk) {
    const bejegyzes = atiratok.get(id)
    if (!bejegyzes) continue
    for (let repeat = 0; repeat < ismetlesek; repeat++) {
      if (guard.exceeded()) {
        console.error(`A költségkeret elfogyott ($${guard.spentUsd().toFixed(2)}) — a mérés megáll.`)
        process.exit(1)
      }
      const result = await refine(
        recipe,
        { item: bejegyzes.item, transcript: bejegyzes.transcript },
        client,
        { stopEarly: false },
      )
      for (const kor of result.rounds) {
        guard.add(recipe.role, kor.usage, modelConfig)
      }
      rekordok.push({
        itemId: id,
        repeat,
        scores: result.rounds.map((r) => r.score),
        usdPerRound: result.rounds.map(() => 0),
      })
      console.log(
        `${recipe.id} ${id} #${String(repeat + 1)}: ${result.rounds.map((r) => r.score.toFixed(2)).join(' → ')}`,
      )
    }
  }
  eredmenyek.set(recipe.id, rekordok)
}

// 5. Kiírás: a nyers adat privát, a riport publikus.
await writeFile(NYERS_UTVONAL, JSON.stringify([...eredmenyek], null, 2), 'utf8')

const receptEredmenyek = RECEPTEK.map((recipe) => {
  const agg = aggregate(eredmenyek.get(recipe.id) ?? [], recipe.rubric.passThreshold)
  return { recipe: recipe.id, agg, decision: decide(agg) }
})

await mkdir(join('docs', 'measurements'), { recursive: true })
await writeFile(
  RIPORT_UTVONAL,
  renderMeasurementReport(receptEredmenyek, {
    items: mintaIdk.length,
    repeats: ismetlesek,
    generations: maxIterations + 1,
    totalUsd: guard.spentUsd(),
    draftModel: modelConfig.models.draft,
    judgeModel: modelConfig.models.judge,
  }),
  'utf8',
)

console.log(`\nKész. Tényleges költés: $${guard.spentUsd().toFixed(2)}`)
console.log(`Riport: ${RIPORT_UTVONAL}`)
for (const r of receptEredmenyek) {
  console.log(`  ${r.recipe}: maxIterations: ${String(r.decision.maxIterations)} — ${r.decision.reason}`)
}
```

- [ ] **2. lépés: A `usdPerRound` kitöltése**

A fenti vázban a `usdPerRound` nullákkal van feltöltve, ami a riport
átlagköltség-oszlopát értelmetlenné tenné. A költséget **ne** számold kézzel:
a `src/model/pricing.ts` `costOf(usage, pricing)` függvénye pontosan ezt teszi,
és már tesztelt. Egészítsd ki az importokat:

```ts
import { costOf } from '../../src/model/pricing.js'
```

és cseréld a rekord összeállítását erre:

```ts
      rekordok.push({
        itemId: id,
        repeat,
        scores: result.rounds.map((r) => r.score),
        usdPerRound: result.rounds.map((r) =>
          costOf(r.usage, modelConfig.pricing[recipe.role]),
        ),
      })
```

A `ModelConfig.pricing` a betöltés után **camelCase** mezőket visz
(`inputPerMillion`, `outputPerMillion`), nem a YAML `input_per_million`
alakját — a `costOf` ezt már helyesen kezeli.

- [ ] **3. lépés: Futtató és parancs a `package.json`-be**

A futtatáshoz **kell egy új fejlesztői függőség**. A Node 26 natívan futtat
TypeScriptet, de a típuslehántás **nem oldja fel a `.js` → `.ts` importokat** —
márpedig a repó végig `.js` kiterjesztéssel hivatkozik (NodeNext feloldás),
tehát a `node evals/measure/run.ts` `ERR_MODULE_NOT_FOUND`-dal áll el. Ez
ellenőrizve van, nem feltételezés. A `tsx` ezt megoldja:

```bash
mise exec -- pnpm add -D tsx
```

A `scripts` blokkba, az `eval:watch` után:

```json
    "measure": "tsx evals/measure/run.ts",
```

- [ ] **4. lépés: Szárazpróba modellhívás nélkül**

Futtasd: `mise exec -- pnpm measure`
Várt: kilépés 2-es kóddal, a `--budget` hiányát magyarázó üzenettel. **Nulla
modellhívás.**

Futtasd: `mise exec -- pnpm measure --budget 0.01`
Várt: a becslés kiírása, majd „A becslés a keret fölött van" és kilépés 2-vel.
**Nulla modellhívás.** Ez igazolja a spec 5. sikerkritériumát.

- [ ] **5. lépés: Typecheck és lint**

Futtasd: `mise exec -- pnpm typecheck && mise exec -- pnpm lint && mise exec -- pnpm test`
Várt: PASS mindhárom.

- [ ] **6. lépés: Commit**

```bash
git add evals/measure/run.ts package.json
git commit -F - <<'EOF'
feat(evals): a mérés futtatója valódi modellhívásokkal

- Kötelező --budget kapcsoló, alapértelmezés nélkül
- A becslés a keret fölött el sem indítja a mérést
- A futás közbeni költségőr a tényleges használatból összegez
- A minta rögzítve marad, hogy az ismétlések ugyanazt mérjék

Refs #16
EOF
```

---

## Feladat 6: A mérés lefuttatása, a publikálás és a döntés végrehajtása

**Fájlok:**
- Létrehoz: `docs/measurements/2026-09-09-iteracio.md` (a futtató generálja)
- Módosít: `docs/evaluation.md` (§6), `docs/roadmap.md` (Fázis 3),
  `src/recipe/summary.ts:51`, `src/recipe/flashcards.ts:181`,
  `src/recipe/qa.ts:46` és a hozzájuk tartozó tesztek

Ez a feladat **valódi pénzt költ**. A futtatás előtt kérj megerősítést a
felhasználótól a keretre.

- [ ] **1. lépés: A mérés lefuttatása**

```bash
mise exec -- pnpm measure --budget 10
```

Várt: a becslés a keret alatt van, a mérés lefut, a riport elkészül, a konzol
receptenként kiírja a döntést. Jegyezd fel a tényleges költést.

- [ ] **2. lépés: A riport ellenőrzése publikálás előtt**

```bash
grep -nE "[A-Za-z0-9_-]{11}" docs/measurements/2026-09-09-iteracio.md | head
```

Nézd át: szerepel-e bármi, ami elemazonosítóra, videócímre vagy csatornanévre
hasonlít. Ha igen, **ne commitolj** — a riport generálása hibás, vissza a
Feladat 4-hez.

- [ ] **3. lépés: A döntés végrehajtása a recepteken**

A futtató által kiírt `maxIterations` értéket állítsd be receptenként:

- `src/recipe/summary.ts:51` — a `summary` döntése szerint
- `src/recipe/flashcards.ts:181` — a `flashcards` döntése szerint
- `src/recipe/qa.ts:46` — **a `summary` döntését követi.** A spec a `qa`-t
  azért hagyta ki a mérésből, mert alakja a `summary`-é; ugyanezen az alapon
  örökli annak döntését. Ezt a riportban is mondd ki egy mondatban.

A hozzájuk tartozó teszteket is át kell írni, mert ma mindhárom kettőt vár:

- `src/recipe/summary.test.ts:30`
- `src/recipe/flashcards.test.ts:153`
- `src/recipe/qa.test.ts:27`

Ha a döntés mindhárom receptnél `maxIterations: 2`, ez a lépés kimarad — de
akkor is írd le a riportban, hogy a mérés a mai alapértelmezést igazolta.

- [ ] **4. lépés: A dokumentáció frissítése**

A `docs/evaluation.md` §6-ban az első felsorolásponton („Segít-e a második
iteráció, és mennyiért?") cseréld az ígéretet a válaszra: a mért javulás, a
zajszint, a mentési arány és a belőle következő alapértelmezés, egy mondatban
receptenként, hivatkozva a riportra:
`[a mérés](<./measurements/2026-09-09-iteracio.md>)`.

A `docs/roadmap.md` Fázis 3 harmadik sikerkritériuma elé tedd a kipipálást a
fájl meglévő jelölési konvenciója szerint (nézd meg, hogyan van jelölve a
Fázis 0-2 kész állapota, és kövesd azt).

- [ ] **5. lépés: Teljes ellenőrzés**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várt: PASS mindhárom.

- [ ] **6. lépés: Commit**

```bash
git add docs/measurements docs/evaluation.md docs/roadmap.md src/recipe
git commit -F - <<'EOF'
feat: az iteráció mérése lefutott, a döntés végrehajtva

- A publikált riport csak aggregátumot közöl
- A receptek maxIterations értéke a mért döntés szerint áll
- Az evaluation.md §6-ban az ígéret helyén a válasz áll
- A roadmap Fázis 3 harmadik kritériuma teljesült

Closes #16
EOF
```

---

## Önellenőrzés

**1. Spec-lefedettség.** A spec minden szakaszához tartozik feladat: §1
motorvarrat → F1; §2 mérőhalmaz → F2; §3 keret és költségkapu → F5; §4
mérőszámok → F3; §5 döntési szabály → F3 (`decide`) és F6 (végrehajtás); §6
publikált eredmény → F4 és F6. A hét sikerkritérium mind ellenőrizve van:
1 → F1/5. lépés, 2 → F1 első teszt, 3 → F2 determinizmus-teszt, 4 → F3
„zaj alatti javulás" teszt, 5 → F5/4. lépés, 6 → F4 „egyetlen azonosítót sem",
7 → F6/3. lépés.

**2. Helykitöltő-vizsgálat.** Nincs „TBD" vagy „később". Az első változatban a
Feladat 5 a `ModelConfig.pricing` mezőneveit a végrehajtóra bízta volna; ez
helykitöltő lett volna, ezért ellenőriztem: a betöltött alak camelCase
(`src/config.ts:191`), és a `costOf` (`src/model/pricing.ts:15`) már helyesen
számol vele. A terv most ezt írja elő, találgatás nélkül.

**3. Típusegyezés.** A `RunRecord.scores` a `RoundTrace.score` értékeiből épül;
az `Aggregate.rounds[k].round` egytől számoz, míg a tömbindex nullától — ezt a
`stats.ts` kommentje és a riport `String(r.round)` hívása is tükrözi. A
`Decision.maxIterations` típusa `0 | 1 | 2`, ami közvetlenül a
`Recipe.maxIterations` mezőbe írható.

**4. Egy tudatos eltérés a spectől.** A spec nem rendelkezik a `qa` recept
`maxIterations` értékéről, mert a receptet kihagyta a mérésből. A terv ezt a
Feladat 6/3. lépésben lezárja: a `qa` a `summary` döntését örökli, ugyanazon
az alapon, amiért kimaradt — az alakja a `summary`-é. Ha ez nem kívánatos, a
`qa` értékét kell változatlanul hagyni, és ezt a riportban kimondani.
