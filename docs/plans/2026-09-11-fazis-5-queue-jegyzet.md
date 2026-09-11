# Fázis 5 — Az Obsidian queue-jegyzet — implementációs terv

> **Ágenseknek:** KÖTELEZŐ AL-SKILL: `superpowers:executing-plans` — a projekt
> gyakorlata szerint egyetlen munkamenetben, Sonneten — vagy
> `superpowers:subagent-driven-development` a feladatonkénti végrehajtáshoz. A
> lépések jelölőnégyzetes (`- [ ]`) szintaxist használnak.

**Cél:** A vault `_queue.md` feldolgozási sorával videónként és receptenként
lehessen válogatni a korpuszból, és az eredmény Obsidianban, ugyanazokban a
sorokban látszódjon.

**Architektúra:** Egy új, tiszta `src/queue/` modul olvassa, fésüli össze és
írja vissza a jegyzetet — prompt- és csővezeték-logika nélkül. A `run` a
(videó, recept) párokon fut: a párok kiválasztása és a közös becslés a
`src/run/plan.ts`-be kerül, az állványzat (SIGINT, `finish`, riport, git) egy
példányban marad a `commandRun`-ban. Mellette két javítás: szerepenkénti
költségkönyvelés és a hibák (elem, típus) szerinti gyűjtése.

**Tech stack:** TypeScript 5.9, Node 26.2, vitest 4, zod 4, Vercel AI SDK 7.
**Új függőség nincs.**

**Spec:** `docs/plans/2026-09-11-fazis-5-queue-jegyzet-spec.md` — a terv ebből
érvel; a végrehajtó mindkettőt olvassa.

## Globális megkötések

- Egyetlen teszt sem hív modellt; a hamis modellkliens-minta marad.
- Minden parancs `mise exec --` alatt fut (`mise exec -- pnpm test`).
- Magyar a dokumentáció, a kódkomment, a felhasználói kimenet — a
  queue-jegyzet szövege is — és a commit-üzenet; angol a produkciós azonosító.
- Nincs közvetlen munka a `main` ágon. Az ág: `feat/fazis-5-queue-jegyzet`
  (létezik, a spec commitja már rajta van).
- Korpuszrészlet — cím, csatornanév, azonosító, jegyzetszöveg — nem kerülhet a
  repóba, se tesztbe, se dokumentumba. Minden minta szintetikus.
- A `src/queue/` nem tartalmaz prompt- vagy csővezeték-logikát
  (`architecture.md` §3).
- Új futásidejű függőség nincs.
- Minden feladat végén zöld: `mise exec -- pnpm test`,
  `mise exec -- pnpm typecheck`, `mise exec -- pnpm lint`.
- **Commit:** feladatonként egy, a `commit-message` skill-lel, a feladat végén
  javasolt üzenettel és `Refs #26` lábléccel; a 13. feladat `Closes #26`. Push és
  PR csak a végén, a felhasználó jóváhagyásával.
- **Mutációs ellenőrzés** mindig a commit **után** történik, így a
  visszaállítás (`git checkout -- <fájl>`) csak a mutációt dobja el.
- A queue-jegyzet sorvége `\n` (a vault macOS-en, Obsidianból szerkesztődik).

## Amibe a kód beleütközik

- **`noUncheckedIndexedAccess`**: a tömbindexelés és a regex-csoport
  `T | undefined`. A `!` az ESLint-konfigban szándékosan engedélyezett.
- **`recommendedTypeChecked`**: aktív a `require-await` (a teszt `async`
  hamis kliensei ezért `eslint-disable-next-line`-t kapnak, mint a
  meglévők), a `no-floating-promises` és az `unbound-method` — állapottár-
  metódust ne adj át hivatkozásként, hívd közvetlenül.
- Sablon-literálban a számot `String(…)`-be csomagold, ahogy a kódbázis.
- **A `cli.test.ts` modul szinten mockolja a `gitCommitPaths`-t úgy, hogy
  kivételt dobjon** (a „törzsben dobott hiba" tesztekhez). A commitot vizsgáló
  új teszt ezért `vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)`-t
  használ — **soha nem tartós `mockResolvedValue`-t**, mert az elrontaná a
  későbbi teszteket. A `gitPullFfOnly` feloldódik; a `gitPush` valódi, és egy
  nem-git ideiglenes mappában csendben `pushed: false`-t ad.
- A `cli.test.ts` feliratmintája magyar, rövid szöveg. A hamis kimeneteknek
  (`## Összefoglaló…`, a meglévő `QA_KIMENET`) át kell menniük a formátum- és
  a nyelvi kapun — ezért a meglévő, bizonyítottan átmenő kimeneteket
  használjuk újra, nem újakat írunk.

## Fájlszerkezet

| fájl | felelősség |
|---|---|
| `src/pipeline.ts` *(módosít)* | szerepenkénti költségkönyvelés; `item:failed` típussal |
| `src/model/budget.ts` *(módosít)* | `BudgetEntry.maxIterations`; `sliceToBudget(entries, cfg)` |
| `src/events.ts` *(módosít)* | `item:failed.kind`, `RunFailure.kind`, hibák (elem, típus) szerint |
| `src/run/report.ts` *(módosít)* | típusonkénti korpusz, típus-oszlop, sor-állapot, figyelmeztetések |
| `src/vault/atomic.ts` *(új)* | atomi fájlírás |
| `src/queue/file.ts` *(új)* | a sor útvonala és beolvasása |
| `src/queue/line.ts` *(új)* | sorfajták felismerése és előállítása, címtisztítás |
| `src/queue/parse.ts` *(új)* | jegyzet → fejlécek, videóblokkok, kipipált párok |
| `src/queue/merge.ts` *(új)* | a `scan --queue` összefésülése |
| `src/queue/status.ts` *(új)* | visszaírási utótagok és alkalmazásuk |
| `src/run/plan.ts` *(új)* | a futás egységei, szűrés, közös becslés |
| `src/cli.ts` *(módosít)* | `scan --queue`; páralapú `run`; `run --queue` |
| `src/e2e.test.ts` *(módosít)* | a sor végponttól végpontig, valódi gittel |
| `docs/decisions/0010-videonkenti-receptvalasztas.md` *(új)* | a §10 felülírása |
| `docs/architecture.md`, `docs/roadmap.md`, `README.md` *(módosít)* | dokumentáció |

A feladatok sorrendje függőségi sorrend: az 1–5. önálló alapozás, a 6–9. a
queue-modul, a 10–11. a mag, a 12–13. a lezárás.

---

## Feladat 1: Szerepenkénti költségkönyvelés

**Fájlok:**
- Módosít: `src/pipeline.ts:128-129` (`runRecipe`)
- Teszt: `src/pipeline.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból — ezért áll elöl.
- Termel: szignatúra nem változik. A `runRecipe` a költségőrbe és a
  `usd`-be **körönként és szerepenként** könyvel: a `generateUsage` a
  `recipe.role`, a `scoreUsage` a `judge` árán. A `pipeline.test.ts` importja
  kiegészül a `type RunEvent`-tel — a 3. feladat erre épít.

> **Miért veszteségmentes a bontás.** A `refine` (`src/refine/loop.ts`) a
> `usage`-et pontosan az első generálás és pontozás, majd minden további kör
> generálása és pontozása összegeként építi, és minden kör `RoundTrace`-e
> ugyanezeket az objektumokat hordozza. A bíró a `judgeCriterion`-ben
> `client.generateObject('judge', …)`-tal pontoz (`src/rubric/judge.ts`), a
> `scoreRubric` pedig a kritériumok `usage`-ét összegzi — a `scoreUsage` tehát
> a bíró felhasználása.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/pipeline.test.ts` — cseréld az events-importot, és vedd fel a bírót:

```ts
import { collectEvents, type RunEvent } from './events.js'
```

```ts
import { faithfulnessCriterion } from './rubric/judge.js'
```

A `describe('processItem recepttel', ...)` blokk **végére**, az utolsó teszt
(`sérült feliratnál recept-futásban MINDKÉT…`) után:

```ts
  it('a bíró tokenjeit a bíró árán könyveli, nem a vázlatmodellén', async () => {
    // Egy generálás és egy bíró-hívás, egyenként egymillió bemeneti tokennel.
    // Helyesen: 1M × 3 $ (draft) + 1M × 0,2 $ (judge) = 3,20 $. A javítás
    // előtt mindkettő a draft árán ment: 2M × 3 $ = 6,00 $.
    const biroRecept: Recipe = {
      ...ATMENO_RECEPT,
      id: 'biros',
      rubric: { criteria: [faithfulnessCriterion], passThreshold: 0.8 },
    }
    const client: ModelClient = {
      generate: () =>
        Promise.resolve({
          value: '## Jegyzet\n',
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
        }),
      generateObject: <T>() =>
        Promise.resolve({
          value: { score: 1, gaps: [] } as T,
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
        }),
    }
    const guard = createCostGuard(100)
    const { sink, events } = collectEvents()
    const deps = { ...alapDeps(), sink }
    const current = item()

    await processItem(current, {
      ...deps,
      recipeDeps: { recipe: biroRecept, client, modelConfig: MODELL_CFG, guard },
    })

    expect(guard.spentUsd()).toBeCloseTo(3.2, 10)
    expect(deps.store.artifactOf(current.itemId, 'biros')!.costUsd).toBeCloseTo(3.2, 10)
    const refined = events.find(
      (e): e is Extract<RunEvent, { type: 'item:refined' }> => e.type === 'item:refined',
    )
    expect(refined!.usd).toBeCloseTo(3.2, 10)
  })
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/pipeline.test.ts -t "bíró tokenjeit"
```

Várt: FAIL, `expected 6 to be close to 3.2`.

- [ ] **3. lépés: Javítsd a könyvelést**

`src/pipeline.ts`, a `runRecipe`-ben cseréld ezt:

```ts
  guard.add('draft', result.usage, modelConfig)
  const usd = costOf(result.usage, modelConfig.pricing.draft)
```

erre:

```ts
  // Körönként és szerepenként könyvelünk: a generálás a recept szerepén, a
  // pontozás a bíróén. Az összevont `result.usage` a bíró tokenjeit is a
  // vázlatmodell árán számolná — a mérő script ezt épp elkerüli.
  let usd = 0
  for (const round of result.rounds) {
    guard.add(recipe.role, round.generateUsage, modelConfig)
    guard.add('judge', round.scoreUsage, modelConfig)
    usd +=
      costOf(round.generateUsage, modelConfig.pricing[recipe.role]) +
      costOf(round.scoreUsage, modelConfig.pricing.judge)
  }
```

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/pipeline.test.ts
```

Várt: PASS, a meglévő tesztekkel együtt.

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Várt: mindhárom zöld.

- [ ] **6. lépés: Commit**

```bash
git add src/pipeline.ts src/pipeline.test.ts
```

Javasolt üzenet (`commit-message` skill): `fix(pipeline): a bíró tokenjei a bíró árán könyvelődnek`, láblécben `Refs #26`.

- [ ] **7. lépés: Mutációs ellenőrzés**

A 3. lépésben beírt ciklust ideiglenesen cseréld vissza az eredeti két sorra
(`guard.add('draft', result.usage, modelConfig)` és
`const usd = costOf(result.usage, modelConfig.pricing.draft)`), majd:

```bash
mise exec -- pnpm vitest run src/pipeline.test.ts -t "bíró tokenjeit"
```

Várt: FAIL (`expected 6 to be close to 3.2`). Utána:

```bash
git checkout -- src/pipeline.ts && mise exec -- pnpm vitest run src/pipeline.test.ts
```

Várt: PASS.

---

## Feladat 2: Bejegyzésenkénti iterációszám a becslésben

**Fájlok:**
- Módosít: `src/model/budget.ts` (`BudgetEntry`, `sliceToBudget`)
- Módosít: `src/cli.ts:290-320` (az egyetlen hívó)
- Teszt: `src/model/budget.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból.
- Termel:
  - `interface BudgetEntry<T> { value: T; words: number; maxIterations: number }`
  - `sliceToBudget<T>(entries: readonly BudgetEntry<T>[], cfg: ModelConfig): BudgetSlice<T>`
    — a közös `maxIterations` paraméter **megszűnik**. Hívója (a
    `grep -rn "sliceToBudget(" src evals` szerint) csak a `cli.ts` és a teszt.

- [ ] **1. lépés: Írd át a teszteket az új alakra, és vedd fel a bukót**

`src/model/budget.test.ts` — cseréld le a **teljes**
`describe('sliceToBudget', ...)` blokkot erre:

```ts
describe('sliceToBudget', () => {
  const limitel = (costLimitUsd: number): ModelConfig => ({ ...CFG, costLimitUsd })

  it('addig vág, amíg a becslés a plafon alá fér', () => {
    const egy = estimateItemUsd(1_000, 0, CFG)
    const cfg = limitel(egy * 2.5)
    const slice = sliceToBudget(
      [
        { value: 'a', words: 1_000, maxIterations: 0 },
        { value: 'b', words: 1_000, maxIterations: 0 },
        { value: 'c', words: 1_000, maxIterations: 0 },
      ],
      cfg,
    )

    expect(slice.planned).toEqual(['a', 'b'])
    expect(slice.deferred).toEqual(['c'])
    expect(slice.usd).toBeLessThanOrEqual(cfg.costLimitUsd)
  })

  it('a plafon alá férő teljes köteget elindítja', () => {
    const slice = sliceToBudget([{ value: 'a', words: 100, maxIterations: 0 }], limitel(1_000))
    expect(slice.planned).toEqual(['a'])
    expect(slice.deferred).toEqual([])
  })

  it('ha az első elem sem fér be, üres tervet ad', () => {
    const slice = sliceToBudget(
      [{ value: 'a', words: 5_000, maxIterations: 0 }],
      limitel(0.000001),
    )
    expect(slice.planned).toEqual([])
    expect(slice.deferred).toEqual(['a'])
    expect(slice.usd).toBe(0)
  })

  it('üres bemenetre üres tervet ad', () => {
    expect(sliceToBudget([], limitel(5))).toEqual({
      planned: [],
      deferred: [],
      usd: 0,
      tokens: 0,
    })
  })

  it('a tokenbecslés ugyanazt adja, mint az estimateRunUsd a tervezett elemekre', () => {
    const cfg = limitel(1_000)
    const slice = sliceToBudget(
      [
        { value: 'a', words: 800, maxIterations: 1 },
        { value: 'b', words: 1_200, maxIterations: 1 },
      ],
      cfg,
    )

    expect(slice.tokens).toBe(estimateRunUsd([800, 1_200], 1, cfg).tokens)
  })

  it('kemény megállás: plafon-túllépés után egy olcsóbb, később jövő elem sem csúszik be', () => {
    const costA = estimateItemUsd(1_000, 0, CFG)
    const costC = estimateItemUsd(200, 0, CFG)
    // A plafon éppen A-ra és C-re elég, bőséges tartalékkal — egy
    // legjobb-illeszkedést kereső (a plafon-túllépés után is tovább
    // kereső) implementáció a b kihagyása után C-t még beengedné. A helyes
    // viselkedés a kemény megállás: a plafon elfogyása után semmi más nem
    // indulhat, még ha önmagában befért volna is.
    const cfg = limitel(costA + costC * 1.5)

    const slice = sliceToBudget(
      [
        { value: 'a', words: 1_000, maxIterations: 0 }, // befér, tölti a keretet
        { value: 'b', words: 5_000, maxIterations: 0 }, // jóval túllépi a plafont — itt kell megállnia
        { value: 'c', words: 200, maxIterations: 0 }, // önmagában beférne, de a plafon már elfogyott
      ],
      cfg,
    )

    expect(slice.planned).toEqual(['a'])
    expect(slice.deferred).toEqual(['b', 'c'])
  })

  it('bejegyzésenként a saját maxIterations-szel becsül', () => {
    const olcso = estimateItemUsd(1_000, 0, CFG)
    const draga = estimateItemUsd(1_000, 2, CFG)
    // A plafon egy olcsó és egy drága elemre elég, egy második olcsóra már
    // nem. Közös iterációszámmal a vágás mást adna: 2-vel már a második elem
    // sem férne be, 0-val a harmadik is befutna.
    const cfg = limitel(olcso + draga + olcso * 0.5)
    const slice = sliceToBudget(
      [
        { value: 'olcso', words: 1_000, maxIterations: 0 },
        { value: 'draga', words: 1_000, maxIterations: 2 },
        { value: 'olcso2', words: 1_000, maxIterations: 0 },
      ],
      cfg,
    )

    expect(slice.planned).toEqual(['olcso', 'draga'])
    expect(slice.deferred).toEqual(['olcso2'])
    expect(slice.usd).toBeCloseTo(olcso + draga, 10)
    expect(slice.tokens).toBe(
      estimateRunUsd([1_000], 0, cfg).tokens + estimateRunUsd([1_000], 2, cfg).tokens,
    )
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/model/budget.test.ts
```

Várt: a `sliceToBudget` tesztjei FAIL-lel buknak (a mai kód a második
argumentumot `maxIterations`-nek veszi, a konfiguráció `undefined` lesz:
`Cannot read properties of undefined`). Az `estimateItemUsd`,
`estimateRunUsd` és `createCostGuard` tesztjei zöldek maradnak.

- [ ] **3. lépés: Az új alak**

`src/model/budget.ts` — cseréld a `BudgetEntry` interfészt és a teljes
`sliceToBudget` függvényt (a docstring marad):

```ts
export interface BudgetEntry<T> {
  value: T
  /** A normalizált átirat szószáma — ebből jön a becslés. */
  words: number
  /**
   * A bejegyzés receptjének javítási korlátja. Bejegyzésenként, mert egy
   * futás több receptet vihet, és azok korlátja eltérhet.
   */
  maxIterations: number
}
```

```ts
export function sliceToBudget<T>(
  entries: readonly BudgetEntry<T>[],
  cfg: ModelConfig,
): BudgetSlice<T> {
  const planned: T[] = []
  const deferred: T[] = []
  let usd = 0
  let tokens = 0
  let full = false

  for (const entry of entries) {
    if (full) {
      deferred.push(entry.value)
      continue
    }
    const itemUsd = estimateItemUsd(entry.words, entry.maxIterations, cfg)
    if (usd + itemUsd > cfg.costLimitUsd) {
      full = true
      deferred.push(entry.value)
      continue
    }
    usd += itemUsd
    tokens += estimateRunUsd([entry.words], entry.maxIterations, cfg).tokens
    planned.push(entry.value)
  }

  return { planned, deferred, usd, tokens }
}
```

- [ ] **4. lépés: A hívó**

`src/cli.ts` — a becslési ciklusban cseréld ezt:

```ts
          entries.push({ value: item, words: (await normalizeItem(item)).wordsNormalized })
```

erre:

```ts
          entries.push({
            value: item,
            words: (await normalizeItem(item)).wordsNormalized,
            maxIterations,
          })
```

ezt:

```ts
      const slice = sliceToBudget(entries, maxIterations, recipeDeps.modelConfig)
```

erre:

```ts
      const slice = sliceToBudget(entries, recipeDeps.modelConfig)
```

és ezt:

```ts
        const firstUsd = estimateItemUsd(first.words, maxIterations, recipeDeps.modelConfig)
```

erre:

```ts
        const firstUsd = estimateItemUsd(first.words, first.maxIterations, recipeDeps.modelConfig)
```

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Várt: mindhárom zöld — a `cli.test.ts` költségkapu- és szeletelés-tesztjei
változatlanul átmennek, ez a regressziós horgony.

- [ ] **6. lépés: Commit**

```bash
git add src/model/budget.ts src/model/budget.test.ts src/cli.ts
```

Javasolt üzenet: `refactor(budget): bejegyzésenkénti iterációszám a szeletelésben`, `Refs #26`.

---

## Feladat 3: A hibák elem és műtermék-típus szerint

**Fájlok:**
- Módosít: `src/events.ts` (`item:failed`, `RunFailure`, `summarize`)
- Módosít: `src/pipeline.ts` (a recept-hiba ága és a külső `catch`)
- Módosít: `src/cli.ts:86-87` (`render`)
- Módosít: `src/run/report.ts:86-98` (hibatábla)
- Teszt: `src/events.test.ts`, `src/pipeline.test.ts`, `src/run/report.test.ts`,
  `src/run/log.test.ts`, `src/cli.test.ts` (a „normalizáláson elbukó elem" teszt)

**Interfészek:**
- Fogyaszt: az 1. feladat `type RunEvent` importját a `pipeline.test.ts`-ben.
- Termel:
  - `RunEvent` hibaága: `{ type: 'item:failed'; itemId: string; source: string; kind: string; error: string }`
  - `interface RunFailure { itemId: string; source: string; kind: string; error: string }`
  - `summarize`: a `failed` továbbra is a hibás **elemek** száma; a
    `failures` (elem, típus) párokra bomlik — az első előfordulás helyén, az
    utolsó hibaszöveggel.
  - Ahol a `processItem` egy hívásban két típust is hibásnak rögzít, **két**
    `item:failed` esemény megy ki.

- [ ] **1. lépés: Írd meg a bukó teszteket**

**`src/events.test.ts`** — a négy meglévő hibaeseménybe és elvárásba kerüljön
`kind`:

- `a hiba erősebb a publikálásnál…`: az eseményben és a `failures`-ben is
  `kind: 'summary'`, a `source: 'youtube'` után.
- `metaadat nélküli, normalizálás előtt elbukott elem…`: `kind: 'transcript'`,
  az eseményben és az elvárásban is.
- `megszámolja a sikeres, kihagyott és hibás elemeket`: a `c` elem eseményében
  és elvárásában `kind: 'transcript'`.
- `a hiba a forrásmappát is megőrzi`: `kind: 'transcript'`, mindkét helyen.

Például az első teszt új alakja:

```ts
  it('a hiba erősebb a publikálásnál: a részben elkészült elem hibás', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'auto' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'summary', error: 'a bíró nem válaszolt' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      failed: 1,
      failures: [{ itemId: 'a', source: 'youtube', kind: 'summary', error: 'a bíró nem válaszolt' }],
    })
  })
```

A `a hiba a forrásmappát is megőrzi` teszt után vedd fel ezt a kettőt:

```ts
  it('egy elem két típusának hibája két hibasor, de egyetlen hibás elem', () => {
    const summary = summarize([
      { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat' },
      { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'summary', error: 'olvashatatlan felirat' },
    ])
    expect(summary.failed).toBe(1)
    expect(summary.failures).toEqual([
      { itemId: 'a', source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat' },
      { itemId: 'a', source: 'youtube', kind: 'summary', error: 'olvashatatlan felirat' },
    ])
  })

  it('ugyanannak a párnak az ismételt hibája az első helyén, az utolsó szöveggel marad', () => {
    const summary = summarize([
      { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'summary', error: 'első' },
      { type: 'item:failed', itemId: 'b', source: 'youtube', kind: 'summary', error: 'b hibája' },
      { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'summary', error: 'második' },
    ])
    expect(summary.failures).toEqual([
      { itemId: 'a', source: 'youtube', kind: 'summary', error: 'második' },
      { itemId: 'b', source: 'youtube', kind: 'summary', error: 'b hibája' },
    ])
  })
```

**`src/pipeline.test.ts`** — a `describe('processItem recepttel', ...)` végére:

```ts
  it('sérült feliratnál recept-futásban típusonként egy hibaeseményt küld', async () => {
    const broken = item({ subtitlePath: join(dir, 'nincs.en.srt') })
    const { sink, events } = collectEvents()

    await processItem(broken, {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const failed = events.filter(
      (e): e is Extract<RunEvent, { type: 'item:failed' }> => e.type === 'item:failed',
    )
    expect(failed.map((e) => e.kind)).toEqual([ARTIFACT_KIND, 'proba'])
  })
```

**`src/run/report.test.ts`** — az `input()` fixture hibasora:

```ts
      failures: [
        { itemId: 'mit-6-042-l14', source: 'youtube', kind: 'summary', error: 'olvashatatlan felirat' },
      ],
```

A hibatábla-teszt:

```ts
  it('a hibát az elemmel, a típussal, a forrásmappával és az okkal együtt nevezi meg', () => {
    const md = renderReport(input())
    expect(md).toContain('| elem | típus | forrás | ok |')
    expect(md).toContain('| `mit-6-042-l14` | summary | youtube | olvashatatlan felirat |')
  })
```

Az escape-teszt hibasorába `kind: 'summary',` a `source` után, az elvárt sor
pedig:

```ts
    expect(md).toContain(
      '| `test-item` | summary | furcsa \\| forrás | YAML parse error at line 5 expected "key" \\| got "\\|" |',
    )
```

**`src/run/log.test.ts`** — a fájlban mindkét előfordulásnál cseréld
`source: 'youtube', error: 'olvashatatlan felirat'` →
`source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat'`.

**`src/cli.test.ts`** — a `a normalizáláson elbukó elem hibaként jelenik meg…`
tesztben cseréld ezt:

```ts
    const failed = events.filter((e) => e.type === 'item:failed')
    expect(failed).toHaveLength(1)
    // A JSONL sor is megnevezi a forrásmappát — ugyanaz a bizonyítékigény
    // egy szinttel a riport alatt.
    expect(failed[0]).toMatchObject({ itemId: 'a2', source: 'downloads' })
```

erre:

```ts
    const failed = events.filter((e) => e.type === 'item:failed')
    // Recept-futásban a normalizáláson elbukó elem mindkét érintett típus
    // alatt hibás: típusonként egy esemény.
    expect(failed).toHaveLength(2)
    // A JSONL sor is megnevezi a forrásmappát — ugyanaz a bizonyítékigény
    // egy szinttel a riport alatt.
    expect(failed[0]).toMatchObject({ itemId: 'a2', source: 'downloads', kind: 'transcript' })
    expect(failed[1]).toMatchObject({ itemId: 'a2', source: 'downloads', kind: 'summary' })
```

és ezt:

```ts
    // A spec §2.2: elemenként az azonosító, a FORRÁSMAPPA NEVE és az ok.
    expect(report).toMatch(/\| `a2` \| downloads \| .+ \|/)
```

erre:

```ts
    // A spec §2.2: elemenként az azonosító, a típus, a FORRÁSMAPPA NEVE és az ok.
    expect(report).toMatch(/\| `a2` \| transcript \| downloads \| .+ \|/)
    expect(report).toMatch(/\| `a2` \| summary \| downloads \| .+ \|/)
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/events.test.ts src/pipeline.test.ts src/run/report.test.ts src/cli.test.ts
```

Várt: FAIL a módosított és az új tesztekben (hiányzó `kind` a
`failures`-ben, egyetlen hibaesemény kettő helyett, a régi táblafejléc).

- [ ] **3. lépés: Az események**

`src/events.ts` — a `RunEvent` hibaága:

```ts
  | {
      type: 'item:failed'
      itemId: string
      /** A forrásmappa neve — a riport „Hibák" táblája ezt is kiírja. */
      source: string
      /**
       * Az elbukott műtermék-típus: `transcript` vagy a recept azonosítója.
       * Egy futás több receptet is vihet ugyanarra az elemre; enélkül a
       * második hiba felülírná az elsőt.
       */
      kind: string
      error: string
    }
```

A `RunFailure`:

```ts
export interface RunFailure {
  itemId: string
  /** A forrásmappa neve: a hiba önmagában, keresés nélkül is elhelyezhető. */
  source: string
  /** Az elbukott műtermék-típus. */
  kind: string
  error: string
}
```

Cseréld le a teljes `summarize` függvényt (a docstringgel együtt):

```ts
/**
 * Az összegzés **elemet** számol, nem eseményt: egy elem két jegyzetet is
 * publikálhat (átirat és recept), és az ugyanaz az egy siker. A hiba erősebb
 * a publikálásnál — ha a recept elbukott, az elem hibás, akkor is, ha az
 * átirata már kiment. A hibalista viszont (elem, típus) párokra bomlik: egy
 * elem két receptjének hibája két sor.
 */
export function summarize(events: readonly RunEvent[]): RunSummary {
  const captionOf = new Map<string, CaptionSource>()
  const titleOf = new Map<string, string>()
  const published = new Set<string>()
  const skipped = new Set<string>()
  const failedItems = new Set<string>()
  // (elem, típus) → hibasor. A Map beszúrási sorrendje az első előfordulásé,
  // az érték az utolsó hibáé.
  const failures = new Map<string, RunFailure>()

  for (const e of events) {
    switch (e.type) {
      case 'item:start':
        titleOf.set(e.itemId, e.title)
        break
      case 'item:normalized':
        captionOf.set(e.itemId, e.captionSource)
        break
      case 'item:published':
        published.add(e.itemId)
        break
      case 'item:skipped':
        skipped.add(e.itemId)
        break
      case 'item:failed':
        failedItems.add(e.itemId)
        failures.set(JSON.stringify([e.itemId, e.kind]), {
          itemId: e.itemId,
          source: e.source,
          kind: e.kind,
          error: e.error,
        })
        break
      default:
        break
    }
  }

  for (const itemId of failedItems) {
    published.delete(itemId)
    skipped.delete(itemId)
  }
  for (const itemId of published) skipped.delete(itemId)

  const byCaptionSource: Record<CaptionSource, number> = { creator: 0, auto: 0 }
  const autoItems: AutoItem[] = []
  for (const itemId of published) {
    const caption = captionOf.get(itemId)
    if (caption === undefined) continue
    byCaptionSource[caption]++
    // Cím nélküli elem (hiányzó `item:start`, üres vagy csupa szóköz cím)
    // az azonosítójával szerepel: a felsorolás sosem marad névtelen.
    if (caption === 'auto') {
      autoItems.push({ itemId, title: titleOf.get(itemId)?.trim() || itemId })
    }
  }
  // Kódpont szerinti összehasonlítás, nem területi beállítás szerinti: a
  // riport sorrendje így minden gépen ugyanaz.
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  autoItems.sort((a, b) =>
    a.title === b.title ? compare(a.itemId, b.itemId) : compare(a.title, b.title),
  )

  return {
    succeeded: published.size,
    skipped: skipped.size,
    failed: failedItems.size,
    byCaptionSource,
    autoItems,
    failures: [...failures.values()],
  }
}
```

- [ ] **4. lépés: A csővezeték hibaágai**

`src/pipeline.ts`, a recept-hiba ágában cseréld ezt:

```ts
        store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
        sink({ type: 'item:failed', itemId: item.itemId, source: item.source, error: message })
```

erre:

```ts
        store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
        sink({
          type: 'item:failed',
          itemId: item.itemId,
          source: item.source,
          kind: recipeDeps.recipe.id,
          error: message,
        })
```

A külső `catch`-ben (a „MINDKÉT érintett típusra rögzítünk" komment alatt)
cseréld ezt:

```ts
    if (kellAtirat) store.recordArtifact(item.itemId, ARTIFACT_KIND, 'failed', null, message)
    if (kellRecept && recipeDeps) {
      store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
    }
    sink({ type: 'item:failed', itemId: item.itemId, source: item.source, error: message })
    return { status: 'failed', error: message }
```

erre:

```ts
    // Típusonként egy esemény is megy: a riport hibalistája (elem, típus)
    // párokra bomlik.
    if (kellAtirat) {
      store.recordArtifact(item.itemId, ARTIFACT_KIND, 'failed', null, message)
      sink({
        type: 'item:failed',
        itemId: item.itemId,
        source: item.source,
        kind: ARTIFACT_KIND,
        error: message,
      })
    }
    if (kellRecept && recipeDeps) {
      store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
      sink({
        type: 'item:failed',
        itemId: item.itemId,
        source: item.source,
        kind: recipeDeps.recipe.id,
        error: message,
      })
    }
    return { status: 'failed', error: message }
```

- [ ] **5. lépés: A konzol és a riport**

`src/cli.ts` `render`:

```ts
    case 'item:failed':
      return `  ✗ ${event.itemId} (${event.kind}): ${event.error}`
```

`src/run/report.ts`, a „Hibák" szakaszban cseréld ezt:

```ts
    lines.push('| elem | forrás | ok |')
    lines.push('|---|---|---|')
    for (const failure of summary.failures) {
      lines.push(
        `| \`${failure.itemId}\` | ${escapeTableCell(failure.source)} | ` +
          `${escapeTableCell(failure.error)} |`,
      )
    }
```

erre:

```ts
    lines.push('| elem | típus | forrás | ok |')
    lines.push('|---|---|---|---|')
    for (const failure of summary.failures) {
      lines.push(
        `| \`${failure.itemId}\` | ${escapeTableCell(failure.kind)} | ` +
          `${escapeTableCell(failure.source)} | ${escapeTableCell(failure.error)} |`,
      )
    }
```

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Várt: mindhárom zöld. Ha a typecheck még egy `item:failed`-et épít `kind`
nélkül, a hibaüzenet megnevezi a fájlt és a sort — a fenti `grep` szerint
nincs több.

- [ ] **7. lépés: Commit**

```bash
git add src/events.ts src/events.test.ts src/pipeline.ts src/pipeline.test.ts src/cli.ts src/cli.test.ts src/run/report.ts src/run/report.test.ts src/run/log.test.ts
```

Javasolt üzenet: `feat(events): a hibák elem és műtermék-típus szerint`, `Refs #26`.

---

## Feladat 4: Típusonkénti korpusz, sor-állapot és figyelmeztetések a riportban

**Fájlok:**
- Módosít: `src/run/report.ts` (`ReportInput`, `renderReport`)
- Módosít: `src/cli.ts` (`finish`: az egyetlen típus átadása)
- Módosít: `src/e2e.test.ts:271-280` (`renderReport` hívás)
- Teszt: `src/run/report.test.ts`

**Interfészek:**
- Fogyaszt: a 3. feladat hibatábláját (`| elem | típus | forrás | ok |`).
- Termel:
  - `interface KindCorpus { kind: string; status: CorpusStatus }`
  - `interface QueueRecipeStatus { recipe: string; selected: number; done: number; failed: number; pending: number; deferred: number }`
  - `ReportInput`: a `corpus: CorpusStatus` helyén `corpora: KindCorpus[]`;
    új, opcionális `queue?: QueueRecipeStatus[]` és `warnings?: string[]`.
  - Kimenet: `## A korpusz állapota — <típus>` típusonként; az összesítő sor
    (kreátori/automatikus · futások · összköltség) egyszer, az első típusból;
    `## A sor állapota` queue-futásnál; `## Figyelmeztetések`, ha van; a
    „Következő lépés" queue-futásnál a sorból számol.

- [ ] **1. lépés: Írd át a fixture-t, és vedd fel a bukó teszteket**

`src/run/report.test.ts` — az `input()` fixture-ben cseréld a teljes
`corpus: { … }` mezőt erre:

```ts
    corpora: [
      {
        kind: 'summary',
        status: {
          bySource: [
            { source: 'meetings', total: 1, done: 1, failed: 0, pending: 0 },
            { source: 'youtube', total: 4, done: 2, failed: 1, pending: 1 },
          ],
          byCaptionSource: { creator: 3, auto: 2 },
          done: 3,
          failed: 1,
          pending: 1,
          totalCostUsd: 11.9,
        },
      },
    ],
```

A `hátralévő elem nélkül nem ajánl folytatást` teszt override-ja:

```ts
        corpora: [{ kind: 'summary', status: { ...input().corpora[0]!.status, pending: 0, done: 4 } }],
```

A `tiszta korpusznál nem említi a hibás elemeket` tesztté:

```ts
        corpora: [
          { kind: 'summary', status: { ...input().corpora[0]!.status, pending: 0, done: 4, failed: 0 } },
        ],
```

A `describe('renderReport', ...)` végére:

```ts
  it('a korpusz-szakasz fejléce megnevezi a műtermék-típust', () => {
    expect(renderReport(input())).toContain('## A korpusz állapota — summary')
  })

  it('több típusnál típusonként külön szakaszt ír, az összesítő sort egyszer', () => {
    const status = input().corpora[0]!.status
    const md = renderReport(
      input({ corpora: [{ kind: 'summary', status }, { kind: 'qa', status }] }),
    )
    expect(md).toContain('## A korpusz állapota — summary')
    expect(md).toContain('## A korpusz állapota — qa')
    expect(md.match(/összköltség:/g)).toHaveLength(1)
  })

  it('queue-futásnál receptenként kiírja a sor állapotát', () => {
    const md = renderReport(
      input({
        queue: [{ recipe: 'summary', selected: 3, done: 1, failed: 1, pending: 0, deferred: 1 }],
      }),
    )
    expect(md).toContain('## A sor állapota')
    expect(md).toContain('| recept | kipipálva | kész | hibás | hátra | plafon miatt maradt |')
    expect(md).toContain('| summary | 3 | 1 | 1 | 0 | 1 |')
  })

  it('queue-futásnál a következő lépés a sorból számol, nem a korpuszból', () => {
    const md = renderReport(
      input({
        queue: [{ recipe: 'summary', selected: 2, done: 0, failed: 0, pending: 0, deferred: 2 }],
        nextCommand: 'run --queue',
      }),
    )
    expect(md).toContain('2 pár hátravan.')
    expect(md).toContain('Folytatás: `run --queue`')
    expect(md).not.toContain('elem hátravan')
  })

  it('queue-futásnál, ha csak hibás pár maradt, újrapróbálást ajánl', () => {
    const md = renderReport(
      input({
        queue: [{ recipe: 'qa', selected: 1, done: 0, failed: 1, pending: 0, deferred: 0 }],
        nextCommand: 'run --queue --retry-failed',
      }),
    )
    expect(md).toContain('A sor feldolgozva, de maradtak hibás párok.')
    expect(md).toContain('Újrapróbálás: `run --queue --retry-failed`')
  })

  it('queue-futásnál minden kész párnál a sort nevezi feldolgozottnak', () => {
    const md = renderReport(
      input({
        queue: [{ recipe: 'qa', selected: 1, done: 1, failed: 0, pending: 0, deferred: 0 }],
        nextCommand: undefined,
      }),
    )
    expect(md).toContain('A sor feldolgozva.')
    expect(md).not.toContain('A korpusz feldolgozva')
  })

  it('a figyelmeztetéseket felsorolja; nélkülük nincs szakasz', () => {
    const md = renderReport(input({ warnings: ['ismeretlen recept a sorban: foo (abcDEF12345)'] }))
    expect(md).toContain('## Figyelmeztetések')
    expect(md).toContain('- ismeretlen recept a sorban: foo (abcDEF12345)')
    expect(renderReport(input())).not.toContain('## Figyelmeztetések')
  })
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/run/report.test.ts
```

Várt: FAIL — a mai `renderReport` a `corpus` mezőt olvassa, a `corpora`-t nem
(`Cannot read properties of undefined (reading 'bySource')`), és az új
szakaszokat nem ismeri.

- [ ] **3. lépés: Az új riport**

`src/run/report.ts` — cseréld a `ReportInput` interfészt erre, és elé vedd fel
a két új típust:

```ts
/** Egy műtermék-típus korpusz-állapota. */
export interface KindCorpus {
  kind: string
  status: CorpusStatus
}

/** A queue-futás kiválasztott párjainak állapota, egy receptre. */
export interface QueueRecipeStatus {
  recipe: string
  /** A kipipált, a szűrőkön átjutott párok — a nem található elemekkel együtt. */
  selected: number
  done: number
  /** Hibás, vagy a felirat nem található. */
  failed: number
  pending: number
  /** A plafon miatt a következő futásra maradt. */
  deferred: number
}

export interface ReportInput {
  runId: string
  startedAt: Date
  finishedAt: Date
  /** A futást indító parancs, kapcsolókkal — a riport reprodukálhatósága. */
  command: string
  summary: RunSummary
  /** A futás minden érintett műtermék-típusának korpusz-állapota, sorrendben. */
  corpora: KindCorpus[]
  /** Csak queue-futásnál: a kipipált párok állapota receptenként. */
  queue?: QueueRecipeStatus[]
  /** Nem végzetes, de jelzendő tények — például ismeretlen recept a sorban. */
  warnings?: string[]
  /** Ennyi futás naplója van a naplómappában, ezt is beleértve. */
  runs: number
  logPath: string
  cost?: ReportCost
  /** A folytatáshoz javasolt parancs; hátralévő elem nélkül hiányzik. */
  nextCommand?: string
}
```

Cseréld le a teljes `renderReport` függvényt (a docstring marad):

```ts
export function renderReport(input: ReportInput): string {
  const { summary, corpora, queue } = input
  const lines: string[] = []

  lines.push(`# Futás — ${stamp(input.startedAt)} → ${stamp(input.finishedAt)}`)
  lines.push('')
  lines.push(`Parancs: \`${input.command}\``)
  lines.push(`Futásazonosító: \`${input.runId}\``)
  if (input.cost) {
    const { spentUsd, limitUsd, capped } = input.cost
    const suffix = capped ? ' — plafon elérve' : ''
    lines.push(`Költés: ${spentUsd.toFixed(2)} $ / ${limitUsd.toFixed(2)} $${suffix}`)
  }
  lines.push(`Napló: \`${input.logPath}\``)
  lines.push('')

  lines.push('## Ez a futás')
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  lines.push(
    `| sikeres | ${String(summary.succeeded)} ` +
      `(kreátori ${String(summary.byCaptionSource.creator)} / ` +
      `automatikus ${String(summary.byCaptionSource.auto)}) |`,
  )
  lines.push(`| kihagyva | ${String(summary.skipped)} |`)
  lines.push(`| hibás | ${String(summary.failed)} |`)
  lines.push('')

  if (summary.autoItems.length > 0) {
    // Felsorolás, nem vessző-lista: a név a lényeg, az azonosító csak azért
    // marad mellette, hogy a naplóval és az állapottárral összeköthető legyen.
    lines.push(`Automatikus feliratból készült (${String(summary.autoItems.length)}):`)
    lines.push('')
    for (const item of summary.autoItems) {
      lines.push(`- ${oneLine(item.title)} (\`${item.itemId}\`)`)
    }
    lines.push('')
  }

  if (input.warnings && input.warnings.length > 0) {
    lines.push('## Figyelmeztetések')
    lines.push('')
    for (const warning of input.warnings) lines.push(`- ${oneLine(warning)}`)
    lines.push('')
  }

  if (summary.failures.length > 0) {
    lines.push('## Hibák')
    lines.push('')
    lines.push('| elem | típus | forrás | ok |')
    lines.push('|---|---|---|---|')
    for (const failure of summary.failures) {
      lines.push(
        `| \`${failure.itemId}\` | ${escapeTableCell(failure.kind)} | ` +
          `${escapeTableCell(failure.source)} | ${escapeTableCell(failure.error)} |`,
      )
    }
    lines.push('')
  }

  if (queue) {
    lines.push('## A sor állapota')
    lines.push('')
    lines.push('| recept | kipipálva | kész | hibás | hátra | plafon miatt maradt |')
    lines.push('|---|---|---|---|---|---|')
    for (const q of queue) {
      lines.push(
        `| ${escapeTableCell(q.recipe)} | ${String(q.selected)} | ${String(q.done)} | ` +
          `${String(q.failed)} | ${String(q.pending)} | ${String(q.deferred)} |`,
      )
    }
    lines.push('')
  }

  for (const { kind, status } of corpora) {
    lines.push(`## A korpusz állapota — ${oneLine(kind)}`)
    lines.push('')
    lines.push('| forrás | összes | kész | hibás | hátra |')
    lines.push('|---|---|---|---|---|')
    for (const s of status.bySource) {
      lines.push(
        `| ${escapeTableCell(s.source)} | ${String(s.total)} | ${String(s.done)} | ` +
          `${String(s.failed)} | ${String(s.pending)} |`,
      )
    }
    lines.push('')
  }

  // A felirat-forrás bontása és az összköltség típustól független: egyszer
  // írjuk ki, az első típus állapotából.
  const first = corpora[0]?.status
  if (first) {
    lines.push(
      `Kreátori ${String(first.byCaptionSource.creator)} / ` +
        `automatikus ${String(first.byCaptionSource.auto)} · ` +
        `${String(input.runs)} futás naplója · ` +
        `összköltség: ${first.totalCostUsd.toFixed(2)} $`,
    )
    lines.push('')
  }

  lines.push('## Következő lépés')
  lines.push('')
  if (queue) {
    // Queue-futásnál a teljes korpusz hátralévő elemei félrevezetnének: a
    // kérdés az, hogy a kipipált párokból mi maradt.
    const pending = queue.reduce((n, q) => n + q.pending + q.deferred, 0)
    const failed = queue.reduce((n, q) => n + q.failed, 0)
    if (pending > 0) {
      lines.push(`${String(pending)} pár hátravan.`)
      if (input.nextCommand) lines.push(`Folytatás: \`${input.nextCommand}\``)
    } else if (failed > 0) {
      lines.push('A sor feldolgozva, de maradtak hibás párok.')
      if (input.nextCommand) lines.push(`Újrapróbálás: \`${input.nextCommand}\``)
    } else {
      lines.push('A sor feldolgozva.')
    }
  } else if (first && first.pending > 0) {
    lines.push(`${String(first.pending)} elem hátravan.`)
    if (input.nextCommand) lines.push(`Folytatás: \`${input.nextCommand}\``)
  } else if (first && first.failed > 0) {
    lines.push('A korpusz feldolgozva, de maradtak hibás elemek.')
    if (input.nextCommand) lines.push(`Újrapróbálás: \`${input.nextCommand}\``)
  } else {
    lines.push('A korpusz feldolgozva.')
  }
  lines.push('')

  return lines.join('\n')
}
```

- [ ] **4. lépés: A hívók**

`src/cli.ts`, a `finish`-ben a `renderReport({ … })` hívásban cseréld a
`corpus,` sort erre (a `nextCommand(commandLine, corpus)` marad):

```ts
      corpora: [{ kind: artifactKind, status: corpus }],
```

`src/e2e.test.ts`, a `renderReport({ … })` hívásban cseréld a `corpus,` sort
erre:

```ts
      corpora: [{ kind: 'transcript', status: corpus }],
```

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Várt: mindhárom zöld. A `cli.test.ts` `toContain('## A korpusz állapota')`
elvárása részszöveg-egyezés, ezért változtatás nélkül átmegy.

- [ ] **6. lépés: Commit**

```bash
git add src/run/report.ts src/run/report.test.ts src/cli.ts src/e2e.test.ts
```

Javasolt üzenet: `feat(report): típusonkénti korpusz, sor-állapot és figyelmeztetések`, `Refs #26`.

---

## Feladat 5: Atomi fájlírás

**Fájlok:**
- Létrehoz: `src/vault/atomic.ts`
- Teszt: `src/vault/atomic.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból.
- Termel: `writeFileAtomic(path: string, content: string): Promise<void>` —
  a 8. és a 11. feladat ezzel írja a `_queue.md`-t.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/vault/atomic.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-atomic-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('létrehozza a fájlt, a hiányzó mappával együtt', async () => {
    const path = join(dir, 'al', '_queue.md')
    await writeFileAtomic(path, 'tartalom\n')
    expect(await readFile(path, 'utf8')).toBe('tartalom\n')
  })

  it('felülírja a meglévő fájlt, és nem hagy maga után ideiglenes fájlt', async () => {
    const path = join(dir, '_queue.md')
    await writeFile(path, 'régi\n', 'utf8')

    await writeFileAtomic(path, 'új\n')

    expect(await readFile(path, 'utf8')).toBe('új\n')
    expect(await readdir(dir)).toEqual(['_queue.md'])
  })

  it('hiba esetén kivételt dob, és az ideiglenes fájlt eltakarítja', async () => {
    // A cél egy MAPPA: az ideiglenes fájl megírható, az átnevezés elhasal.
    const path = join(dir, '_queue.md')
    await mkdir(path)

    await expect(writeFileAtomic(path, 'x')).rejects.toThrow()
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/vault/atomic.test.ts
```

Várt: FAIL, `Failed to load url ./atomic.js` (a modul még nincs).

- [ ] **3. lépés: Az implementáció**

`src/vault/atomic.ts`:

```ts
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Fájl cseréje atomi átnevezéssel.
 *
 * A queue-jegyzet az egyetlen vault-fájl, amit a pipeline helyben frissít —
 * és közben nyitva lehet Obsidianban. Az ideiglenes fájl ugyanabban a
 * mappában születik, így az átnevezés ugyanazon a fájlrendszeren marad, tehát
 * atomi; és nem `.md` kiterjesztésű, hogy az Obsidian ne indexelje.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  const tmp = join(dir, `.${basename(path)}.${String(process.pid)}.tmp`)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}
```

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/vault/atomic.test.ts
```

Várt: PASS, 3 teszt.

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **6. lépés: Commit**

```bash
git add src/vault/atomic.ts src/vault/atomic.test.ts
```

Javasolt üzenet: `feat(vault): atomi fájlírás a helyben frissített jegyzethez`, `Refs #26`.

---

## Feladat 6: A feldolgozási sor sorai és értelmezése

**Fájlok:**
- Létrehoz: `src/queue/file.ts`, `src/queue/line.ts`, `src/queue/parse.ts`
- Teszt: `src/queue/file.test.ts`, `src/queue/line.test.ts`, `src/queue/parse.test.ts`

**Interfészek:**
- Fogyaszt: `SourceItem` (`src/types.ts`), `lintVaultMarkdown` (csak tesztben).
- Termel:
  - `file.ts`: `QUEUE_FILE = '_queue.md'`; `queuePath(notesRoot: string): string`;
    `readQueueFile(path: string): Promise<string | null>` (hiányzó fájlra `null`)
  - `line.ts`: `SEPARATOR = ' — '`;
    `type QueueLine = { kind: 'heading'; key: string } | { kind: 'video'; itemId: string; head: string; suffix: string } | { kind: 'recipe'; recipeId: string; checked: boolean; head: string; suffix: string } | { kind: 'other' }`;
    `classifyLine(line: string): QueueLine`;
    `cleanTitle(title: string, fallback: string): string`;
    `groupKey(item: SourceItem): string`;
    `videoLine(item: SourceItem): string`;
    `recipeLine(recipeId: string): string`;
    `withSuffix(head: string, status: string | null): string`
  - `parse.ts`: `interface QueueRecipe { line: number; recipeId: string; checked: boolean; head: string; suffix: string }`;
    `interface QueueVideo { line: number; itemId: string; head: string; suffix: string; duplicate: boolean; recipes: QueueRecipe[] }`;
    `interface QueueHeading { line: number; key: string }`;
    `interface QueueDoc { lines: string[]; headings: QueueHeading[]; videos: QueueVideo[] }`;
    `interface QueuePair { itemId: string; recipeId: string }`;
    `parseQueue(text: string): QueueDoc`;
    `checkedPairs(doc: QueueDoc): QueuePair[]`

> **A horgony.** A videósor határa az első `%%azonosító%%`, a receptsoré a
> receptId — nem a ` — ` elválasztó. Egy ` — `-t tartalmazó cím így nem zavar,
> és a „fej" (a horgonyig tartó rész) bájtra változatlan maradhat, amikor csak
> az utótag cserélődik.

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/queue/file.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QUEUE_FILE, queuePath, readQueueFile } from './file.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-sor-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('queuePath', () => {
  it('a notes_dir gyökerében lévő _queue.md', () => {
    expect(QUEUE_FILE).toBe('_queue.md')
    expect(queuePath('/v/Inbox/transcript-refinery')).toBe(
      join('/v/Inbox/transcript-refinery', '_queue.md'),
    )
  })
})

describe('readQueueFile', () => {
  it('hiányzó fájlra null-t ad', async () => {
    expect(await readQueueFile(join(dir, '_queue.md'))).toBeNull()
  })

  it('a meglévő fájl szövegét adja', async () => {
    await writeFile(join(dir, '_queue.md'), 'sor\n', 'utf8')
    expect(await readQueueFile(join(dir, '_queue.md'))).toBe('sor\n')
  })

  it('más olvasási hibát továbbad', async () => {
    // Mappa olvasása fájlként: EISDIR, nem ENOENT.
    await expect(readQueueFile(dir)).rejects.toThrow()
  })
})
```

`src/queue/line.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { classifyLine, cleanTitle, groupKey, recipeLine, videoLine, withSuffix } from './line.js'

function elem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    itemId: 'abcDEF12345',
    source: 'feliratok',
    sourceFile: 'csatorna-a/Elso_peldavideo.hu.srt',
    subtitlePath: '/nemletezo/feliratok/csatorna-a/Elso_peldavideo.hu.srt',
    baseName: 'Elso_peldavideo',
    title: 'Első példavideó',
    language: 'hu',
    metadata: {},
    ...overrides,
  }
}

describe('classifyLine', () => {
  it('felismeri a csoportfejlécet', () => {
    expect(classifyLine('## feliratok/csatorna-a')).toEqual({
      kind: 'heading',
      key: 'feliratok/csatorna-a',
    })
  })

  it('a videósorból kiveszi az azonosítót, a horgonyig tartó fejet és az utótagot', () => {
    expect(classifyLine('- Első — második rész %%abcDEF12345%% — ⚠ duplikátum')).toEqual({
      kind: 'video',
      itemId: 'abcDEF12345',
      head: '- Első — második rész %%abcDEF12345%%',
      suffix: ' — ⚠ duplikátum',
    })
  })

  it('a receptsort szóközös és tabos behúzással, kis és nagy x-szel is felismeri', () => {
    expect(classifyLine('  - [x] summary — ✓ 0.97')).toEqual({
      kind: 'recipe',
      recipeId: 'summary',
      checked: true,
      head: '  - [x] summary',
      suffix: ' — ✓ 0.97',
    })
    expect(classifyLine('\t- [X] qa')).toMatchObject({
      kind: 'recipe',
      recipeId: 'qa',
      checked: true,
      suffix: '',
    })
    expect(classifyLine('  - [ ] flashcards')).toMatchObject({ kind: 'recipe', checked: false })
  })

  it('a behúzás nélküli pipás sor, a szabad szöveg és a főcím saját sor', () => {
    expect(classifyLine('- [x] summary')).toEqual({ kind: 'other' })
    expect(classifyLine('Saját megjegyzés.')).toEqual({ kind: 'other' })
    expect(classifyLine('')).toEqual({ kind: 'other' })
    expect(classifyLine('# Feldolgozási sor')).toEqual({ kind: 'other' })
  })
})

describe('cleanTitle', () => {
  it('egy sorba fésül, és a %-sorozatot egyetlen %-ra vonja össze', () => {
    expect(cleanTitle('Első\nsor  100%% biztos', 'x')).toBe('Első sor 100% biztos')
  })

  it('a címből nem lehet wikilink vagy zárójel nélküli link-cél', () => {
    const tiszta = cleanTitle('[[Lap]] és [szöveg](cél) [[[x]]]', 'x')
    expect(lintVaultMarkdown(`- ${tiszta} %%x%%`)).toEqual([])
  })

  it('üres cím helyett a tartalékot adja', () => {
    expect(cleanTitle('   ', 'abcDEF12345')).toBe('abcDEF12345')
  })
})

describe('groupKey', () => {
  it('a forrásból és a felirat forráson belüli mappájából áll', () => {
    expect(groupKey(elem())).toBe('feliratok/csatorna-a')
  })

  it('gyökérszintű feliratnál csak a forrás', () => {
    expect(groupKey(elem({ sourceFile: 'Elso_peldavideo.hu.srt' }))).toBe('feliratok')
  })
})

describe('videoLine, recipeLine, withSuffix', () => {
  it('a videósor a tisztított címet és az azonosítót viszi, és visszaolvasható', () => {
    const line = videoLine(elem({ title: 'Első\npéldavideó' }))
    expect(line).toBe('- Első példavideó %%abcDEF12345%%')
    expect(classifyLine(line)).toMatchObject({ kind: 'video', itemId: 'abcDEF12345', suffix: '' })
  })

  it('a receptsor üres pipával készül', () => {
    expect(recipeLine('summary')).toBe('  - [ ] summary')
  })

  it('az utótag a fej után, elválasztóval kerül; null esetén csak a fej marad', () => {
    expect(withSuffix('  - [x] summary', '✓ 0.97')).toBe('  - [x] summary — ✓ 0.97')
    expect(withSuffix('  - [x] summary', null)).toBe('  - [x] summary')
  })
})
```

`src/queue/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkedPairs, parseQueue } from './parse.js'

const JEGYZET = [
  '# Feldolgozási sor',
  '',
  '  - [x] summary',
  '## feliratok/csatorna-a',
  '- Első példavideó %%abcDEF12345%%',
  '  - [x] summary — ✓ 0.97 · $0.0512',
  '  - [ ] flashcards',
  '\t- [X] qa',
  'Saját megjegyzés.',
  '- Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található',
  '  - [x] summary',
  '',
  '## feliratok/csatorna-b',
  '- Első példavideó másolata %%abcDEF12345%%',
  '  - [x] summary',
  '',
].join('\n')

describe('parseQueue', () => {
  it('a sorokat bájtra visszaadja', () => {
    expect(parseQueue(JEGYZET).lines.join('\n')).toBe(JEGYZET)
  })

  it('a fejléceket a soruk indexével adja', () => {
    expect(parseQueue(JEGYZET).headings).toEqual([
      { line: 3, key: 'feliratok/csatorna-a' },
      { line: 12, key: 'feliratok/csatorna-b' },
    ])
  })

  it('a receptsort a legközelebbi megelőző videósorhoz köti; videósor előtt saját sor', () => {
    const { videos } = parseQueue(JEGYZET)
    expect(videos.map((v) => [v.itemId, v.line, v.recipes.map((r) => r.recipeId)])).toEqual([
      ['abcDEF12345', 4, ['summary', 'flashcards', 'qa']],
      ['0123456789abcdef', 9, ['summary']],
      ['abcDEF12345', 13, ['summary']],
    ])
  })

  it('az azonosító második előfordulását duplikátumnak jelöli', () => {
    expect(parseQueue(JEGYZET).videos.map((v) => v.duplicate)).toEqual([false, false, true])
  })
})

describe('checkedPairs', () => {
  it('a kipipált párokat a jegyzet sorrendjében adja, a duplikátum-blokk nélkül', () => {
    expect(checkedPairs(parseQueue(JEGYZET))).toEqual([
      { itemId: 'abcDEF12345', recipeId: 'summary' },
      { itemId: 'abcDEF12345', recipeId: 'qa' },
      { itemId: '0123456789abcdef', recipeId: 'summary' },
    ])
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/queue
```

Várt: FAIL, a három modul még nincs.

- [ ] **3. lépés: `src/queue/file.ts`**

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A feldolgozási sor fájlneve a `notes_dir` gyökerében. */
export const QUEUE_FILE = '_queue.md'

export function queuePath(notesRoot: string): string {
  return join(notesRoot, QUEUE_FILE)
}

/** A sor szövege, vagy `null`, ha még nincs. Minden más olvasási hiba továbbmegy. */
export async function readQueueFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
```

- [ ] **4. lépés: `src/queue/line.ts`**

```ts
import { dirname } from 'node:path'
import type { SourceItem } from '../types.js'

/** A pipeline által írt utótag elválasztója a horgony után. */
export const SEPARATOR = ' — '

export type QueueLine =
  | { kind: 'heading'; key: string }
  | { kind: 'video'; itemId: string; head: string; suffix: string }
  | { kind: 'recipe'; recipeId: string; checked: boolean; head: string; suffix: string }
  | { kind: 'other' }

const HEADING = /^## (.+)$/
// A cím nem-mohó: az ELSŐ `%%…%%` a horgony. A `cleanTitle` gondoskodik róla,
// hogy a címben ne maradjon `%%`.
const VIDEO = /^(- .*? %%(.+?)%%)(.*)$/
const RECIPE = /^([ \t]+- \[([ xX])\] ([A-Za-z0-9_-]+))(.*)$/

/** Egy sor fajtája. Ami egyik mintára sem illik, az saját sor. */
export function classifyLine(line: string): QueueLine {
  const heading = HEADING.exec(line)
  if (heading) return { kind: 'heading', key: heading[1]! }

  const video = VIDEO.exec(line)
  if (video) {
    return { kind: 'video', itemId: video[2]!, head: video[1]!, suffix: video[3]! }
  }

  const recipe = RECIPE.exec(line)
  if (recipe) {
    return {
      kind: 'recipe',
      recipeId: recipe[3]!,
      checked: recipe[2] !== ' ',
      head: recipe[1]!,
      suffix: recipe[4]!,
    }
  }

  return { kind: 'other' }
}

/**
 * A cím egy sorba fésülve, a horgonyt és a vault-linkszabályokat zavaró jelek
 * nélkül: a `%`-sorozat egyetlen `%` lesz, az egymás melletti szögletes
 * zárójelek és a `](` közé szóköz kerül — így a címből nem lehet azonosító-
 * horgony, wikilink vagy zárójel nélküli link-cél.
 */
export function cleanTitle(title: string, fallback: string): string {
  const cleaned = title
    .replace(/\s+/g, ' ')
    .replace(/%+/g, '%')
    .replace(/\[(?=\[)/g, '[ ')
    .replace(/\](?=\])/g, '] ')
    .replace(/\]\(/g, '] (')
    .trim()
  return cleaned === '' ? fallback : cleaned
}

/** A csoport kulcsa: a forrás és a felirat forráson belüli mappája — metaadat nélkül. */
export function groupKey(item: SourceItem): string {
  const relDir = dirname(item.sourceFile)
  return relDir === '.' ? item.source : `${item.source}/${relDir}`
}

export function videoLine(item: SourceItem): string {
  return `- ${cleanTitle(item.title, item.itemId)} %%${item.itemId}%%`
}

export function recipeLine(recipeId: string): string {
  return `  - [ ] ${recipeId}`
}

/** A horgony utáni rész cseréje; a horgonyig minden bájt változatlan marad. */
export function withSuffix(head: string, status: string | null): string {
  return status === null ? head : `${head}${SEPARATOR}${status}`
}
```

- [ ] **5. lépés: `src/queue/parse.ts`**

```ts
import { classifyLine } from './line.js'

export interface QueueRecipe {
  /** A sor indexe a jegyzetben, nullától. */
  line: number
  recipeId: string
  checked: boolean
  head: string
  suffix: string
}

export interface QueueVideo {
  line: number
  itemId: string
  head: string
  suffix: string
  /** Igaz, ha ugyanez az azonosító egy korábbi videósoron már szerepelt. */
  duplicate: boolean
  recipes: QueueRecipe[]
}

export interface QueueHeading {
  line: number
  key: string
}

export interface QueueDoc {
  lines: string[]
  headings: QueueHeading[]
  videos: QueueVideo[]
}

export interface QueuePair {
  itemId: string
  recipeId: string
}

/**
 * A jegyzet szerkezete. Sorvégként `\n`-t feltételez — a vault macOS-en,
 * Obsidianból szerkesztődik. A receptsor a legközelebbi megelőző videósorhoz
 * tartozik; az első videósor előtti receptsor saját sornak számít.
 */
export function parseQueue(text: string): QueueDoc {
  const lines = text.split('\n')
  const headings: QueueHeading[] = []
  const videos: QueueVideo[] = []
  const seen = new Set<string>()
  let current: QueueVideo | undefined

  lines.forEach((raw, line) => {
    const parsed = classifyLine(raw)
    switch (parsed.kind) {
      case 'heading':
        headings.push({ line, key: parsed.key })
        break
      case 'video':
        current = {
          line,
          itemId: parsed.itemId,
          head: parsed.head,
          suffix: parsed.suffix,
          duplicate: seen.has(parsed.itemId),
          recipes: [],
        }
        seen.add(parsed.itemId)
        videos.push(current)
        break
      case 'recipe':
        current?.recipes.push({
          line,
          recipeId: parsed.recipeId,
          checked: parsed.checked,
          head: parsed.head,
          suffix: parsed.suffix,
        })
        break
      default:
        break
    }
  })

  return { lines, headings, videos }
}

/** A kipipált párok a jegyzet sorrendjében — a duplikátum-blokkok nélkül. */
export function checkedPairs(doc: QueueDoc): QueuePair[] {
  return doc.videos
    .filter((video) => !video.duplicate)
    .flatMap((video) =>
      video.recipes
        .filter((recipe) => recipe.checked)
        .map((recipe) => ({ itemId: video.itemId, recipeId: recipe.recipeId })),
    )
}
```

- [ ] **6. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/queue
```

Várt: PASS, mindhárom tesztfájl.

- [ ] **7. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **8. lépés: Commit**

```bash
git add src/queue
```

Javasolt üzenet: `feat(queue): a feldolgozási sor sorfajtái és értelmezése`, `Refs #26`.

---

## Feladat 7: A felderített elemek összefésülése a sorba

**Fájlok:**
- Létrehoz: `src/queue/merge.ts`
- Teszt: `src/queue/merge.test.ts`

**Interfészek:**
- Fogyaszt (6. feladat): `groupKey`, `recipeLine`, `videoLine`, `withSuffix`
  (`./line.js`); `parseQueue`, `type QueueDoc` (`./parse.js`).
- Termel:
  - `NOT_FOUND_MARK = '⚠ a felirat nem található'`, `DUPLICATE_MARK = '⚠ duplikátum'`
  - `QUEUE_HEADER: string` — az első `scan --queue` által írt fej, `\n`-re végződik
  - `interface MergeStats { addedVideos: number; addedRecipeLines: number; changedMarks: number }`
  - `mergeQueue(current: string | null, items: readonly SourceItem[], recipeIds: readonly string[]): { text: string; stats: MergeStats }`

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/queue/merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { QUEUE_HEADER, mergeQueue } from './merge.js'

function elem(itemId: string, sourceFile: string, title: string): SourceItem {
  return {
    itemId,
    source: 'feliratok',
    sourceFile,
    subtitlePath: `/nemletezo/feliratok/${sourceFile}`,
    baseName: title,
    title,
    language: 'hu',
    metadata: {},
  }
}

const RECEPTEK = ['summary', 'flashcards', 'qa']
const A1 = elem('abcDEF12345', 'csatorna-a/Elso.hu.srt', 'Első példavideó')
const A2 = elem('0123456789abcdef', 'csatorna-a/Masodik.hu.srt', 'Második példavideó')
const B1 = elem('bbbBBB22222', 'csatorna-b/Harmadik.hu.srt', 'Harmadik példavideó')

describe('mergeQueue', () => {
  it('friss sort ír: fej, csoportonként a videók, receptenként egy üres pipa', () => {
    const { text, stats } = mergeQueue(null, [A1, A2, B1], RECEPTEK)

    expect(text).toBe(
      QUEUE_HEADER +
        [
          '',
          '## feliratok/csatorna-a',
          '- Első példavideó %%abcDEF12345%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '- Második példavideó %%0123456789abcdef%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '',
          '## feliratok/csatorna-b',
          '- Harmadik példavideó %%bbbBBB22222%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '',
        ].join('\n'),
    )
    expect(stats).toEqual({ addedVideos: 3, addedRecipeLines: 0, changedMarks: 0 })
  })

  it('kétszer alkalmazva bájtra azonos, és nincs változás', () => {
    const elso = mergeQueue(null, [A1, A2, B1], RECEPTEK).text
    const masodik = mergeQueue(elso, [A1, A2, B1], RECEPTEK)

    expect(masodik.text).toBe(elso)
    expect(masodik.stats).toEqual({ addedVideos: 0, addedRecipeLines: 0, changedMarks: 0 })
  })

  it('a pipák, az utótagok, a saját sorok és a kézi sorrend érintetlen marad', () => {
    const kezi = [
      '# Saját fejléc',
      '',
      '## feliratok/csatorna-a',
      'Ezeket nézem meg először.',
      '- Második példavideó %%0123456789abcdef%%',
      '  - [x] summary — ✓ 0.97 · $0.0512',
      '  - [ ] flashcards',
      '  - [ ] qa',
      '- Első példavideó %%abcDEF12345%%',
      '\t- [X] qa',
      '  - [ ] summary',
      '  - [ ] flashcards',
      '',
      '## feliratok/csatorna-b',
      '',
    ].join('\n')
    const uj = elem('cccCCC33333', 'csatorna-a/Negyedik.hu.srt', 'Negyedik példavideó')

    const { text, stats } = mergeQueue(kezi, [A1, A2, uj], RECEPTEK)

    expect(text).toBe(
      [
        '# Saját fejléc',
        '',
        '## feliratok/csatorna-a',
        'Ezeket nézem meg először.',
        '- Második példavideó %%0123456789abcdef%%',
        '  - [x] summary — ✓ 0.97 · $0.0512',
        '  - [ ] flashcards',
        '  - [ ] qa',
        '- Első példavideó %%abcDEF12345%%',
        '\t- [X] qa',
        '  - [ ] summary',
        '  - [ ] flashcards',
        '- Negyedik példavideó %%cccCCC33333%%',
        '  - [ ] summary',
        '  - [ ] flashcards',
        '  - [ ] qa',
        '',
        '## feliratok/csatorna-b',
        '',
      ].join('\n'),
    )
    expect(stats).toEqual({ addedVideos: 1, addedRecipeLines: 0, changedMarks: 0 })
  })

  it('ismeretlen csoport a jegyzet végére kerül, üres sorral elválasztva', () => {
    const elso = mergeQueue(null, [A1], RECEPTEK).text

    const { text } = mergeQueue(elso, [A1, B1], RECEPTEK)

    expect(text).toBe(
      elso +
        [
          '',
          '## feliratok/csatorna-b',
          '- Harmadik példavideó %%bbbBBB22222%%',
          '  - [ ] summary',
          '  - [ ] flashcards',
          '  - [ ] qa',
          '',
        ].join('\n'),
    )
  })

  it('az eltűnt videó jelölést kap, és a jelölés lekerül, ha visszajön', () => {
    const elso = mergeQueue(null, [A1, A2], RECEPTEK).text

    const eltunt = mergeQueue(elso, [A1], RECEPTEK)
    expect(eltunt.text).toContain(
      '- Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található\n',
    )
    expect(eltunt.stats.changedMarks).toBe(1)

    const vissza = mergeQueue(eltunt.text, [A1, A2], RECEPTEK)
    expect(vissza.text).toBe(elso)
    expect(vissza.stats.changedMarks).toBe(1)
  })

  it('a duplikátum videósora jelölést kap, és alá nem kerül receptsor', () => {
    const kezi = [
      '## feliratok/csatorna-a',
      '- Első példavideó %%abcDEF12345%%',
      '  - [ ] summary',
      '  - [ ] flashcards',
      '  - [ ] qa',
      '- Első példavideó újra %%abcDEF12345%%',
      '',
    ].join('\n')

    const { text, stats } = mergeQueue(kezi, [A1], RECEPTEK)

    expect(text).toBe(
      kezi.replace('újra %%abcDEF12345%%', 'újra %%abcDEF12345%% — ⚠ duplikátum'),
    )
    expect(stats).toEqual({ addedVideos: 0, addedRecipeLines: 0, changedMarks: 1 })
  })

  it('új recept a registryben: a meglévő videó alá, az utolsó receptsora után kerül', () => {
    const regi = mergeQueue(null, [A1], ['summary', 'qa']).text.replace(
      '  - [ ] summary',
      '  - [x] summary — ✓ 1.00',
    )

    const { text, stats } = mergeQueue(regi, [A1], ['summary', 'qa', 'flashcards'])

    expect(text).toBe(regi.replace('  - [ ] qa', '  - [ ] qa\n  - [ ] flashcards'))
    expect(stats).toEqual({ addedVideos: 0, addedRecipeLines: 1, changedMarks: 0 })
  })

  it('szögletes zárójeles cím sem sérti a vault linkszabályait', () => {
    const furcsa = elem('dddDDD44444', 'csatorna-a/Furcsa.hu.srt', 'Rész [[1]] és [link](cél)')

    const { text } = mergeQueue(null, [furcsa], RECEPTEK)

    expect(lintVaultMarkdown(text)).toEqual([])
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/queue/merge.test.ts
```

Várt: FAIL, a modul még nincs.

- [ ] **3. lépés: Az implementáció**

`src/queue/merge.ts`:

```ts
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { groupKey, recipeLine, videoLine, withSuffix } from './line.js'
import { parseQueue, type QueueDoc } from './parse.js'

export const NOT_FOUND_MARK = '⚠ a felirat nem található'
export const DUPLICATE_MARK = '⚠ duplikátum'

/**
 * A sor feje, amit az első `scan --queue` ír. Onnantól saját szöveg: a
 * pipeline többé nem írja.
 */
export const QUEUE_HEADER = [
  '# Feldolgozási sor',
  '',
  'Pipáld ki, melyik videóhoz melyik jegyzet készüljön, majd futtasd: `refinery run --queue`.',
  'Új feliratok után: `refinery scan --queue`. A recept neve utáni szöveget a pipeline írja,',
  'saját megjegyzés külön sorba kerüljön.',
  '',
].join('\n')

export interface MergeStats {
  /** Új videóblokkok száma. */
  addedVideos: number
  /** Meglévő videó alá beszúrt receptsorok száma. */
  addedRecipeLines: number
  /** Videósor-jelölések változása: felkerült vagy lekerült `⚠`. */
  changedMarks: number
}

function assertLint(fragment: string): void {
  const errors = lintVaultMarkdown(fragment)
  if (errors.length > 0) {
    throw new Error(
      `a feldolgozási sor generált része megsérti a vault írási szabályait: ${errors.join('; ')}`,
    )
  }
}

/** A fejléc szakaszának utolsó nem üres sora, a következő `## ` fejléc előtt. */
function sectionEnd(doc: QueueDoc, lines: readonly string[], headingLine: number): number {
  const next = doc.headings.find((heading) => heading.line > headingLine)?.line ?? lines.length
  let end = headingLine
  for (let i = headingLine + 1; i < next; i++) {
    if (lines[i]!.trim() !== '') end = i
  }
  return end
}

/**
 * A felderített elemek összefésülése a sorba. Tiszta függvény.
 *
 * Új videó a csoportja szakaszának végére kerül, vagy új csoportként a
 * jegyzet végére; meglévő videóhoz csak a hiányzó receptsor; a videósor
 * utótagja a `⚠` jelölés. Minden más sor — pipák, saját sorok, sorrend —
 * bájtra érintetlen. Kétszer alkalmazva ugyanazt adja.
 */
export function mergeQueue(
  current: string | null,
  items: readonly SourceItem[],
  recipeIds: readonly string[],
): { text: string; stats: MergeStats } {
  const doc = parseQueue(current ?? QUEUE_HEADER)
  const lines = [...doc.lines]
  const stats: MergeStats = { addedVideos: 0, addedRecipeLines: 0, changedMarks: 0 }
  const discovered = new Set(items.map((item) => item.itemId))

  // 1. Jelölések helyben: a sorok száma nem változik, az indexek érvényesek maradnak.
  for (const video of doc.videos) {
    const mark = video.duplicate
      ? DUPLICATE_MARK
      : discovered.has(video.itemId)
        ? null
        : NOT_FOUND_MARK
    const next = withSuffix(video.head, mark)
    if (next !== lines[video.line]) {
      assertLint(next)
      lines[video.line] = next
      stats.changedMarks++
    }
  }

  // 2. Beszúrások: sorindex → utána kerülő sorok. A végén egyszerre fűzzük
  //    össze, hogy a korábbi indexek érvényesek maradjanak.
  const after = new Map<number, string[]>()
  const insertAfter = (line: number, added: readonly string[]): void => {
    after.set(line, [...(after.get(line) ?? []), ...added])
  }

  for (const video of doc.videos) {
    if (video.duplicate) continue
    const present = new Set(video.recipes.map((recipe) => recipe.recipeId))
    const missing = recipeIds.filter((id) => !present.has(id))
    if (missing.length === 0) continue
    insertAfter(video.recipes.at(-1)?.line ?? video.line, missing.map(recipeLine))
    stats.addedRecipeLines += missing.length
  }

  // 3. Új videók, csoportonként, a felderítés sorrendjében.
  const listed = new Set(doc.videos.map((video) => video.itemId))
  const groups = new Map<string, SourceItem[]>()
  for (const item of items) {
    if (listed.has(item.itemId)) continue
    listed.add(item.itemId)
    const key = groupKey(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const tail: string[] = []
  for (const [key, groupItems] of groups) {
    const block = groupItems.flatMap((item) => [videoLine(item), ...recipeIds.map(recipeLine)])
    assertLint([`## ${key}`, ...block].join('\n'))
    stats.addedVideos += groupItems.length
    const heading = doc.headings.find((h) => h.key === key)
    if (heading) {
      insertAfter(sectionEnd(doc, lines, heading.line), block)
    } else {
      tail.push(`## ${key}`, ...block, '')
    }
  }

  const out: string[] = []
  lines.forEach((line, index) => {
    out.push(line)
    const added = after.get(index)
    if (added) out.push(...added)
  })

  if (tail.length > 0) {
    // A fájl végi újsort jelző üres utolsó elem helyére a `tail` kerül, ami
    // maga is üres sorral zár.
    if (out.at(-1) === '') out.pop()
    if (out.length > 0 && out.at(-1)!.trim() !== '') out.push('')
    out.push(...tail)
  }

  return { text: out.join('\n'), stats }
}
```

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/queue/merge.test.ts
```

Várt: PASS, 8 teszt.

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **6. lépés: Commit**

```bash
git add src/queue/merge.ts src/queue/merge.test.ts
```

Javasolt üzenet: `feat(queue): a felderített elemek összefésülése a sorba`, `Refs #26`.

- [ ] **7. lépés: Mutációs ellenőrzés — a saját sorok érintetlensége**

`src/queue/merge.ts`, a záró összefűzésben cseréld ideiglenesen ezt:

```ts
    out.push(line)
```

erre (egy renderer, ami csak a strukturált sorokat írja újra):

```ts
    if (line === '' || /^\s*[-#]/.test(line)) out.push(line)
```

```bash
mise exec -- pnpm vitest run src/queue/merge.test.ts -t "saját sorok"
```

Várt: FAIL — a `Ezeket nézem meg először.` sor eltűnik. Utána:

```bash
git checkout -- src/queue/merge.ts && mise exec -- pnpm vitest run src/queue/merge.test.ts
```

Várt: PASS.

---

## Feladat 8: `refinery scan --queue`

**Fájlok:**
- Módosít: `src/cli.ts` (importok, `commandScan` exportja, új
  `commandScanQueue`, `USAGE`, `main`)
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `writeFileAtomic` (5.); `queuePath`, `readQueueFile` (6.);
  `mergeQueue` (7.); `RECIPE_IDS` (`src/recipe/registry.ts`).
- Termel:
  - `export async function commandScan(cfg: Config): Promise<number>` — változatlan viselkedés, most exportálva
  - `export async function commandScanQueue(cfg: Config, flags: { dryRun: boolean; commit: boolean }): Promise<number>`
  - `main`: `--queue` kapcsoló (`queue: { type: 'boolean', default: false }`); a `scan` ezzel a `commandScanQueue`-t hívja

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/cli.test.ts` — az importok:

```ts
import { existsSync } from 'node:fs'
```

```ts
import { commandCheckPricing, commandRun, commandScan, commandScanQueue } from './cli.js'
```

```ts
import { queuePath } from './queue/file.js'
```

```ts
import { gitCommitPaths } from './vault/git.js'
```

A fájl **végére**:

```ts
describe('commandScanQueue', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  it('friss vaulton létrehozza a sort: minden videó benne, receptenként egy üres pipával', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'b1', 'Második videó', 'Csatorna B')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)

    const note = await readFile(queuePath(cfg.notesRoot), 'utf8')
    expect(note).toContain(
      '## downloads/youtube/Csatorna A\n- Első videó %%a1%%\n  - [ ] summary\n  - [ ] flashcards\n  - [ ] qa\n',
    )
    expect(note).toContain(
      '## downloads/youtube/Csatorna B\n- Második videó %%b1%%\n  - [ ] summary\n  - [ ] flashcards\n  - [ ] qa\n',
    )
  })

  it('másodszor futtatva a sor bájtra azonos, és csak az első futás commitol', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)

    await commandScanQueue(cfg, { dryRun: false, commit: true })
    const elso = await readFile(sor, 'utf8')
    await commandScanQueue(cfg, { dryRun: false, commit: true })

    expect(await readFile(sor, 'utf8')).toBe(elso)
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledWith(
      cfg.vaultPath,
      [sor],
      'docs(videos): feldolgozási sor frissítése',
    )
  })

  it('LITELLM_API_KEY nélkül is lefut: modellt nem hív', async () => {
    delete process.env.LITELLM_API_KEY
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)
    expect(existsSync(queuePath(cfg.notesRoot))).toBe(true)
  })

  it('--dry-run mellett nem ír jegyzetet és nem commitol', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScanQueue(cfg, { dryRun: true, commit: true })).toBe(0)
    expect(existsSync(queuePath(cfg.notesRoot))).toBe(false)
    expect(vi.mocked(gitCommitPaths)).not.toHaveBeenCalled()
  })

  it('a --queue nélküli scan továbbra sem ír semmit', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    expect(await commandScan(cfg)).toBe(0)
    expect(existsSync(queuePath(cfg.notesRoot))).toBe(false)
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/cli.test.ts -t "commandScanQueue"
```

Várt: FAIL — a `commandScanQueue` és a `commandScan` nincs exportálva
(`is not a function`).

- [ ] **3. lépés: Az importok és az export**

`src/cli.ts` — cseréld a registry-importot erre:

```ts
import { RECIPE_IDS, getRecipe } from './recipe/registry.js'
```

Új importok a `./pipeline.js` sora után:

```ts
import { queuePath, readQueueFile } from './queue/file.js'
import { mergeQueue } from './queue/merge.js'
```

és a `./vault/git.js` sora elé:

```ts
import { writeFileAtomic } from './vault/atomic.js'
```

A `async function commandScan(cfg: Config)` elé kerüljön `export`.

- [ ] **4. lépés: A parancs**

`src/cli.ts`, közvetlenül a `commandScan` után:

```ts
/**
 * A felderített elemek összefésülése a vault feldolgozási sorába. Modellt nem
 * hív, ezért `LITELLM_API_KEY` sem kell hozzá. A sort csak akkor írja, ha a
 * tartalma ténylegesen változik — így az ismételt futás nem hagy commitot
 * maga után.
 */
export async function commandScanQueue(
  cfg: Config,
  flags: { dryRun: boolean; commit: boolean },
): Promise<number> {
  const commit = flags.commit && !flags.dryRun
  if (commit) await gitPullFfOnly(cfg.vaultPath)

  const items = await discoverAll(cfg.sources, cfg.languages)
  const path = queuePath(cfg.notesRoot)
  const current = await readQueueFile(path)
  const { text, stats } = mergeQueue(current, items, RECIPE_IDS)

  console.log(
    `${String(items.length)} feldolgozható felirat · ${String(stats.addedVideos)} új videó, ` +
      `${String(stats.addedRecipeLines)} új receptsor meglévő videó alatt, ` +
      `${String(stats.changedMarks)} jelölés-változás`,
  )
  if (flags.dryRun) {
    console.log('Próbafutás: a sor nem íródott.')
    return 0
  }
  if (text === current) {
    console.log(`A sor naprakész: ${path}`)
    return 0
  }

  await writeFileAtomic(path, text)
  console.log(`Sor: ${path}`)
  if (commit && (await gitCommitPaths(cfg.vaultPath, [path], 'docs(videos): feldolgozási sor frissítése'))) {
    const push = await gitPush(cfg.vaultPath)
    if (!push.pushed) console.log('A push nem sikerült, a commit lokálisan maradt.')
  }
  return 0
}
```

- [ ] **5. lépés: A súgó és a `main`**

`USAGE`, a `--retry-failed` sora után:

```
  --queue           scan: a vault _queue.md sorába fésül; run: a sor
                    kipipált (videó, recept) párjait dolgozza fel
```

`main`, a `parseArgs` opciói közé (a `'retry-failed'` után):

```ts
      queue: { type: 'boolean', default: false },
```

és cseréld ezt:

```ts
  if (command === 'scan') return commandScan(cfg)
```

erre:

```ts
  if (command === 'scan') {
    return values.queue
      ? commandScanQueue(cfg, { dryRun: values['dry-run'], commit: !values['no-commit'] })
      : commandScan(cfg)
  }
```

- [ ] **6. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/cli.test.ts
```

Várt: PASS — az új `commandScanQueue` blokk és az összes meglévő teszt.

- [ ] **7. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **8. lépés: Commit**

```bash
git add src/cli.ts src/cli.test.ts
```

Javasolt üzenet: `feat(cli): scan --queue`, `Refs #26`.

---

## Feladat 9: Az állapot visszaírása a sorba

**Fájlok:**
- Létrehoz: `src/queue/status.ts`
- Teszt: `src/queue/status.test.ts`

**Interfészek:**
- Fogyaszt (6. feladat): `withSuffix` (`./line.js`), `parseQueue` (`./parse.js`);
  `type ArtifactRecord` (`src/state/db.ts`).
- Termel:
  - `DEFERRED_STATUS = '⏳ a plafon miatt a következő futásra maradt'`
  - `NOT_FOUND_STATUS = '✗ a felirat nem található'`
  - `pairKey(itemId: string, recipeId: string): string` — `JSON.stringify([itemId, recipeId])`
  - `doneStatus(record: Pick<ArtifactRecord, 'score' | 'costUsd' | 'path'>, notesRoot: string): string`
  - `failedStatus(error: string | null): string`
  - `applyStatuses(text: string, statuses: ReadonlyMap<string, string>): string`

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/queue/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFERRED_STATUS, applyStatuses, doneStatus, failedStatus, pairKey } from './status.js'

describe('doneStatus', () => {
  it('pontszám, négytizedes költség és a notes_dir-hez relatív link', () => {
    expect(
      doneStatus(
        { score: 0.97, costUsd: 0.05123, path: '/v/root/feliratok/csatorna-a/Elso_summary.md' },
        '/v/root',
      ),
    ).toBe('✓ 0.97 · $0.0512 · [jegyzet](<feliratok/csatorna-a/Elso_summary.md>)')
  })

  it('útvonal nélküli receptnél a link elmarad', () => {
    expect(doneStatus({ score: 1, costUsd: 0.1, path: null }, '/v/root')).toBe('✓ 1.00 · $0.1000')
  })
})

describe('failedStatus', () => {
  it('az első sort adja, zárójelek és %%-horgony nélkül', () => {
    expect(failedStatus('wikilink tiltott: [[x]] %%id%%\nmásodik sor')).toBe(
      '✗ wikilink tiltott: x id',
    )
  })

  it('legfeljebb 120 karakter, … végződéssel', () => {
    expect(failedStatus('a'.repeat(300))).toBe(`✗ ${'a'.repeat(119)}…`)
  })

  it('üres vagy hiányzó hibára ismeretlen hibát ír', () => {
    expect(failedStatus(null)).toBe('✗ ismeretlen hiba')
    expect(failedStatus('  \n')).toBe('✗ ismeretlen hiba')
  })
})

const SOR = [
  '## feliratok/csatorna-a',
  '- Első példavideó %%abcDEF12345%%',
  '  - [x] summary — ✗ régi hiba',
  '  - [x] qa',
  'Saját megjegyzés.',
  '- Második példavideó %%0123456789abcdef%%',
  '  - [x] summary',
  '- Első példavideó újra %%abcDEF12345%%',
  '  - [x] summary',
  '',
].join('\n')

describe('applyStatuses', () => {
  it('csak a megadott párok utótagját cseréli; minden más sor bájtra azonos', () => {
    const statuses = new Map([
      [pairKey('0123456789abcdef', 'summary'), DEFERRED_STATUS],
      [pairKey('abcDEF12345', 'summary'), '✓ 1.00 · $0.0100'],
    ])

    expect(applyStatuses(SOR, statuses)).toBe(
      [
        '## feliratok/csatorna-a',
        '- Első példavideó %%abcDEF12345%%',
        '  - [x] summary — ✓ 1.00 · $0.0100',
        '  - [x] qa',
        'Saját megjegyzés.',
        '- Második példavideó %%0123456789abcdef%%',
        `  - [x] summary — ${DEFERRED_STATUS}`,
        '- Első példavideó újra %%abcDEF12345%%',
        '  - [x] summary',
        '',
      ].join('\n'),
    )
  })

  it('azonosító szerint talál: ugyanaz a recept egy másik videónál érintetlen marad', () => {
    const statuses = new Map([[pairKey('0123456789abcdef', 'summary'), '✓ 0.90 · $0.0200']])

    const out = applyStatuses(SOR, statuses).split('\n')

    expect(out[2]).toBe('  - [x] summary — ✗ régi hiba')
    expect(out[6]).toBe('  - [x] summary — ✓ 0.90 · $0.0200')
  })

  it('üres állapotlistára a szöveg bájtra azonos', () => {
    expect(applyStatuses(SOR, new Map())).toBe(SOR)
  })

  it('linkszabályt sértő állapotot nem ír ki', () => {
    const statuses = new Map([[pairKey('abcDEF12345', 'qa'), '✓ [[x]]']])
    expect(() => applyStatuses(SOR, statuses)).toThrow(/vault írási szabályait/)
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/queue/status.test.ts
```

Várt: FAIL, a modul még nincs.

- [ ] **3. lépés: Az implementáció**

`src/queue/status.ts`:

```ts
import { relative, sep } from 'node:path'
import type { ArtifactRecord } from '../state/db.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { withSuffix } from './line.js'
import { parseQueue } from './parse.js'

export const DEFERRED_STATUS = '⏳ a plafon miatt a következő futásra maradt'
export const NOT_FOUND_STATUS = '✗ a felirat nem található'

/** A hibaüzenet-kivonat felső korlátja, a záró `…`-lel együtt. */
const MAX_ERROR = 120

/** Egy (elem, recept) pár kulcsa. JSON-tömb: nincs ütköző elválasztó. */
export function pairKey(itemId: string, recipeId: string): string {
  return JSON.stringify([itemId, recipeId])
}

/**
 * Kész pár utótagja: pontszám, költség és a jegyzet relatív linkje. A költség
 * négy tizedes, mint az `item:refined` kiírásában — egy pár nagyságrendjében a
 * két tizedes minden összeget `0.00`-nak mutatna.
 */
export function doneStatus(
  record: Pick<ArtifactRecord, 'score' | 'costUsd' | 'path'>,
  notesRoot: string,
): string {
  const parts = [
    `✓ ${record.score === null ? '–' : record.score.toFixed(2)}`,
    `$${(record.costUsd ?? 0).toFixed(4)}`,
  ]
  if (record.path !== null) {
    const link = relative(notesRoot, record.path).split(sep).join('/')
    parts.push(`[jegyzet](<${link}>)`)
  }
  return parts.join(' · ')
}

/**
 * Hibás pár utótagja: a hibaüzenet első sora, szögletes zárójelek és `%%`
 * nélkül — ne képezhessen linket vagy azonosító-horgonyt —, legfeljebb 120
 * karakter.
 */
export function failedStatus(error: string | null): string {
  let excerpt = (error ?? '')
    .split('\n')[0]!
    .replace(/[[\]]/g, '')
    .replace(/%{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (excerpt === '') excerpt = 'ismeretlen hiba'
  if (excerpt.length > MAX_ERROR) excerpt = `${excerpt.slice(0, MAX_ERROR - 1)}…`
  return `✗ ${excerpt}`
}

/**
 * A párok utótagjának cseréje **azonosító és receptId szerint**, nem sorszám
 * szerint. Csak a `statuses`-ben szereplő párokhoz nyúl, és csak az azonosító
 * első előfordulásánál; minden más sor bájtra változatlan.
 */
export function applyStatuses(text: string, statuses: ReadonlyMap<string, string>): string {
  const doc = parseQueue(text)
  const lines = [...doc.lines]
  for (const video of doc.videos) {
    if (video.duplicate) continue
    for (const recipe of video.recipes) {
      const status = statuses.get(pairKey(video.itemId, recipe.recipeId))
      if (status === undefined) continue
      const errors = lintVaultMarkdown(status)
      if (errors.length > 0) {
        throw new Error(
          `a visszaírt állapot megsérti a vault írási szabályait: ${errors.join('; ')}`,
        )
      }
      lines[recipe.line] = withSuffix(recipe.head, status)
    }
  }
  return lines.join('\n')
}
```

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/queue/status.test.ts
```

Várt: PASS, 9 teszt.

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **6. lépés: Commit**

```bash
git add src/queue/status.ts src/queue/status.test.ts
```

Javasolt üzenet: `feat(queue): az állapot visszaírása a sorba`, `Refs #26`.

- [ ] **7. lépés: Mutációs ellenőrzés — az azonosító szerinti visszaírás**

`src/queue/status.ts`, az `applyStatuses`-ben cseréld ideiglenesen ezt:

```ts
      const status = statuses.get(pairKey(video.itemId, recipe.recipeId))
```

erre (egy implementáció, ami csak a receptre illeszt):

```ts
      const status = [...statuses].find(([key]) =>
        key.endsWith(`${JSON.stringify(recipe.recipeId)}]`),
      )?.[1]
```

```bash
mise exec -- pnpm vitest run src/queue/status.test.ts -t "azonosító szerint"
```

Várt: FAIL — az első videó `summary` sora is megkapja a másik videó
állapotát. Utána:

```bash
git checkout -- src/queue/status.ts && mise exec -- pnpm vitest run src/queue/status.test.ts
```

Várt: PASS.

---

## Feladat 10: A futás egysége a (videó, recept) pár

Tiszta refaktor: a `run` viselkedése **nem változik**. A regressziós horgony
a meglévő `cli.test.ts`, és egy új karakterizációs teszt, ami a commit
tartalmát rögzíti — ez már a mai kódon is zöld.

**Fájlok:**
- Létrehoz: `src/run/plan.ts`
- Módosít: `src/cli.ts` (importok; az `applyFilters` törlése; a `commandRun`)
- Teszt: `src/run/plan.test.ts`, `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `BudgetEntry.maxIterations`, `sliceToBudget(entries, cfg)` (2.);
  `corpora` a `renderReport`-ban (4.); a `gitCommitPaths` importja a
  `cli.test.ts`-ben (8.).
- Termel (`src/run/plan.ts`):
  - `interface WorkUnit { item: SourceItem; recipe: Recipe | null }`
  - `unitKind(unit: WorkUnit): string` — a recept azonosítója, recept nélkül `'transcript'`
  - `unitKey(unit: WorkUnit): string` — `JSON.stringify([itemId, unitKind(unit)])`
  - `interface ItemFilters { source?: string; channel?: string }`
  - `matchesFilters(item: SourceItem, filters: ItemFilters): boolean`
  - `filterItems(items: readonly SourceItem[], filters: ItemFilters): SourceItem[]`
  - `interface UnitBudget { slice: BudgetSlice<WorkUnit>; first: BudgetEntry<WorkUnit> | undefined }`
  - `estimateUnits(pending: readonly WorkUnit[], cfg: ModelConfig): Promise<UnitBudget>`
- Termel (`src/cli.ts`): `interface ModelRuntime { modelConfig; client; guard }`
  — egy kliens és egy költségőr az egész indításra. A 11. feladat erre épít.

- [ ] **1. lépés: Karakterizációs teszt a commit tartalmára**

`src/cli.test.ts` — az importok közé:

```ts
import { noteFile } from './vault/paths.js'
```

A fájl végére:

```ts
describe('commandRun — a commit tartalma', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  it('--recipe mellett a commit az átiratot és a recept jegyzetét viszi, a mai üzenettel', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: true },
      { createClient: () => hamisKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledWith(
      cfg.vaultPath,
      [noteFile(cfg.notesRoot, item!, '_transcript.md'), noteFile(cfg.notesRoot, item!, '_summary.md')],
      'docs(videos): átirat 2 videóhoz',
    )
  })
})
```

```bash
mise exec -- pnpm vitest run src/cli.test.ts -t "a commit tartalma"
```

Várt: **PASS már most** — ez rögzíti a mai viselkedést, amit a refaktor után
is teljesíteni kell.

- [ ] **2. lépés: Írd meg a `plan.ts` bukó tesztjét**

`src/run/plan.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { estimateItemUsd } from '../model/budget.js'
import { normalizeItem } from '../pipeline.js'
import { getRecipe } from '../recipe/registry.js'
import type { SourceItem } from '../types.js'
import {
  estimateUnits,
  filterItems,
  matchesFilters,
  unitKey,
  unitKind,
  type WorkUnit,
} from './plan.js'

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ez egy első mondat a becsléshez.

2
00:00:02,000 --> 00:00:04,000
Ez pedig egy második, eltérő mondat.
`

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  costLimitUsd: 5,
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-plan-'))
  await writeFile(join(dir, 'Elso.hu.srt'), SRT, 'utf8')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function elem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    itemId: 'abcDEF12345',
    source: 'feliratok',
    sourceFile: 'csatorna-a/Elso.hu.srt',
    subtitlePath: join(dir, 'Elso.hu.srt'),
    baseName: 'Elso',
    title: 'Első példavideó',
    language: 'hu',
    metadata: {},
    ...overrides,
  }
}

describe('unitKind, unitKey', () => {
  it('recepttel a recept azonosítója, nélküle az átirat a típus', () => {
    expect(unitKind({ item: elem(), recipe: getRecipe('summary') })).toBe('summary')
    expect(unitKind({ item: elem(), recipe: null })).toBe('transcript')
  })

  it('a kulcs az elemet és a típust is megkülönbözteti', () => {
    const keys = new Set([
      unitKey({ item: elem(), recipe: getRecipe('summary') }),
      unitKey({ item: elem(), recipe: getRecipe('qa') }),
      unitKey({ item: elem({ itemId: 'masik' }), recipe: getRecipe('summary') }),
    ])
    expect(keys.size).toBe(3)
  })
})

describe('matchesFilters, filterItems', () => {
  it('a forrást kis- és nagybetűtől függetlenül szűri', () => {
    expect(matchesFilters(elem(), { source: 'FELIRATOK' })).toBe(true)
    expect(matchesFilters(elem(), { source: 'masik' })).toBe(false)
  })

  it('a csatornaszűrő a metaadat nélküli elemet kizárja', () => {
    const csatornas = elem({ itemId: 'c1', metadata: { channel: 'Csatorna A' } })
    expect(filterItems([elem(), csatornas], { channel: 'csatorna a' })).toEqual([csatornas])
  })

  it('szűrő nélkül mindent átenged', () => {
    expect(filterItems([elem()], {})).toHaveLength(1)
  })
})

describe('estimateUnits', () => {
  it('csak a recepttel bíró egységet becsüli, a saját iterációszámával', async () => {
    const summary = getRecipe('summary')
    const units: WorkUnit[] = [
      { item: elem(), recipe: null },
      { item: elem(), recipe: summary },
    ]

    const { slice, first } = await estimateUnits(units, CFG)

    const words = (await normalizeItem(elem())).wordsNormalized
    expect(first).toEqual({ value: units[1], words, maxIterations: summary.maxIterations })
    expect(slice.planned).toEqual([units[1]])
    expect(slice.usd).toBeCloseTo(estimateItemUsd(words, summary.maxIterations, CFG), 10)
  })

  it('a normalizáláson elbukó elem kimarad a becslésből', async () => {
    const units: WorkUnit[] = [
      {
        item: elem({ itemId: 'nincs', subtitlePath: join(dir, 'nincs.hu.srt') }),
        recipe: getRecipe('summary'),
      },
    ]

    const { slice, first } = await estimateUnits(units, CFG)

    expect(first).toBeUndefined()
    expect(slice.planned).toEqual([])
    expect(slice.deferred).toEqual([])
  })

  it('a plafon a teljes indításra közös: két recept együtt szeletelődik', async () => {
    const summary = getRecipe('summary')
    const qa = getRecipe('qa')
    const words = (await normalizeItem(elem())).wordsNormalized
    const egy = estimateItemUsd(words, summary.maxIterations, CFG)
    // A plafon egyetlen párra elég. Receptenkénti szeletelésnél mindkét
    // recept első párja befutna — a közös plafon épp ezt tiltja.
    const cfg: ModelConfig = { ...CFG, costLimitUsd: egy * 1.5 }
    const units: WorkUnit[] = [
      { item: elem(), recipe: summary },
      { item: elem(), recipe: qa },
    ]

    const { slice } = await estimateUnits(units, cfg)

    expect(slice.planned).toEqual([units[0]])
    expect(slice.deferred).toEqual([units[1]])
  })
})
```

```bash
mise exec -- pnpm vitest run src/run/plan.test.ts
```

Várt: FAIL, a modul még nincs.

- [ ] **3. lépés: `src/run/plan.ts`**

```ts
import type { ModelConfig } from '../config.js'
import { sliceToBudget, type BudgetEntry, type BudgetSlice } from '../model/budget.js'
import { ARTIFACT_KIND, normalizeItem } from '../pipeline.js'
import type { Recipe } from '../recipe/types.js'
import type { SourceItem } from '../types.js'

/** A futás egysége: egy elem és a rajta futó recept — vagy csak az átirat. */
export interface WorkUnit {
  item: SourceItem
  recipe: Recipe | null
}

/** Az egység műtermék-típusa: a recept azonosítója, recept nélkül az átirat. */
export function unitKind(unit: WorkUnit): string {
  return unit.recipe?.id ?? ARTIFACT_KIND
}

/** Az egység kulcsa. JSON-tömb: nincs ütköző elválasztó. */
export function unitKey(unit: WorkUnit): string {
  return JSON.stringify([unit.item.itemId, unitKind(unit)])
}

export interface ItemFilters {
  source?: string
  channel?: string
}

/** Forrás- és csatornaszűrés: a `run` szabályai, egy helyen. */
export function matchesFilters(item: SourceItem, filters: ItemFilters): boolean {
  if (filters.source && item.source.toLocaleLowerCase() !== filters.source.toLocaleLowerCase()) {
    return false
  }
  // Metaadat nélküli elemnek nincs csatornája: a szűrő ilyenkor kizárja.
  if (
    filters.channel &&
    item.metadata.channel?.toLocaleLowerCase() !== filters.channel.toLocaleLowerCase()
  ) {
    return false
  }
  return true
}

export function filterItems(items: readonly SourceItem[], filters: ItemFilters): SourceItem[] {
  return items.filter((item) => matchesFilters(item, filters))
}

export interface UnitBudget {
  /** A közös szeletelés a modellhívást igénylő egységeken. */
  slice: BudgetSlice<WorkUnit>
  /** Az első becsült egység — a „már az első sem fér be" üzenethez. */
  first: BudgetEntry<WorkUnit> | undefined
}

/**
 * Egyetlen közös becslés az egységekre: a plafon az egész indításra
 * vonatkozik, nem receptenként. Csak a recepttel bíró egység kerül bele — az
 * átirat modellhívás nélkül készül. A szószám elemenként egyszer számolódik;
 * a normalizáláson elbukó elem csak a becslésből marad ki, a feldolgozás sorra
 * veszi, és a hibája ott jelenik meg.
 */
export async function estimateUnits(
  pending: readonly WorkUnit[],
  cfg: ModelConfig,
): Promise<UnitBudget> {
  const words = new Map<string, number | null>()
  const entries: BudgetEntry<WorkUnit>[] = []
  for (const unit of pending) {
    if (unit.recipe === null) continue
    let count = words.get(unit.item.itemId)
    if (count === undefined) {
      try {
        count = (await normalizeItem(unit.item)).wordsNormalized
      } catch {
        count = null
      }
      words.set(unit.item.itemId, count)
    }
    if (count === null) continue
    entries.push({ value: unit, words: count, maxIterations: unit.recipe.maxIterations })
  }
  return { slice: sliceToBudget(entries, cfg), first: entries[0] }
}
```

```bash
mise exec -- pnpm vitest run src/run/plan.test.ts
```

Várt: PASS.

- [ ] **4. lépés: A `cli.ts` importjai**

Cseréld ezt:

```ts
import { createCostGuard, estimateItemUsd, sliceToBudget, type BudgetEntry } from './model/budget.js'
```

erre:

```ts
import { createCostGuard, estimateItemUsd, type CostGuard } from './model/budget.js'
```

ezt:

```ts
import { ARTIFACT_KIND, normalizeItem, processItem, type RecipeDeps } from './pipeline.js'
```

erre (a `normalizeItem` innentől a `plan.ts`-ben él):

```ts
import { ARTIFACT_KIND, processItem, type RecipeDeps } from './pipeline.js'
```

és a `./recipe/registry.js` sora után:

```ts
import type { Recipe } from './recipe/types.js'
```

a `./run/log.js` sora után:

```ts
import { estimateUnits, filterItems, unitKey, unitKind, type WorkUnit } from './run/plan.js'
```

Töröld a teljes `applyFilters` függvényt (a `filterItems` váltja).

- [ ] **5. lépés: A `commandRun` egységeken**

Cseréld le a teljes `commandRun` függvényt — az
`export async function commandRun(` sortól a záró `}`-ig, közvetlenül az
`export async function main` előtt — erre, és elé vedd fel a `ModelRuntime`
interfészt:

```ts
/** A modellréteg egy futásra: egy kliens és egy költségőr, minden receptnek közösen. */
interface ModelRuntime {
  modelConfig: ModelConfig
  client: ModelClient
  guard: CostGuard
}

export async function commandRun(
  cfg: Config,
  raw: unknown,
  flags: {
    source?: string
    channel?: string
    limit?: number
    recipe?: string
    dryRun: boolean
    force: boolean
    commit: boolean
    /** Csak a korábban `failed` állapotú elemeket futtatja újra. */
    retryFailed?: boolean
    /** A riport fejlécében megjelenő parancssor; hiányában „run”. */
    command?: string
  },
  runtime: RunRuntime = {},
): Promise<number> {
  const commandLine = flags.command ?? 'run'
  const recipe = flags.recipe ? getRecipe(flags.recipe) : null

  // Egy kliens és egy költségőr az egész indításra: a plafon így nem
  // receptenként, hanem együtt vonatkozik minden egységre.
  let model: ModelRuntime | undefined
  if (recipe) {
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    model = {
      modelConfig,
      client: (runtime.createClient ?? createModelClient)(modelConfig),
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
  }
  const depsFor = (unitRecipe: Recipe | null): RecipeDeps | undefined =>
    unitRecipe && model
      ? {
          recipe: unitRecipe,
          client: model.client,
          modelConfig: model.modelConfig,
          guard: model.guard,
        }
      : undefined

  // A futás műtermék-típusa: recepttel a recept azonosítója, enélkül az
  // átirat. Egyszer számoljuk ki — a riport és a hibás-szűrő ugyanazt kérdezi.
  const artifactKind = recipe?.id ?? ARTIFACT_KIND

  if (flags.commit && !flags.dryRun) await gitPullFfOnly(cfg.vaultPath)

  const store = openState(cfg.statePath)

  const startedAt = new Date()
  // Ütközésmentes név: két azonos másodpercben induló futás nem írhat
  // egymás naplójába, és nem írhatja felül egymás riportját.
  const id = reserveRunId(cfg.logsDir, runId(startedAt))
  const logPath = join(cfg.logsDir, `${id}.jsonl`)
  const reportPath = join(cfg.logsDir, `${id}.md`)
  const log = openRunLog(logPath)

  const { sink, events } = collectEvents()
  const printing = (e: RunEvent) => {
    sink(e)
    log.sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }

  // A discoverAll teljes, szűretlen eredménye — a korpusz állapota a teljes
  // korpuszról szól, nem a szűrt szeletről. Korán inicializálva, hogy egy
  // korai SIGINT is riportot írjon (üres korpusszal), ne undefined-ra
  // hivatkozzon.
  let discovered: SourceItem[] = []

  // Egyszeri lefutás: a megszakítás és a normál befejezés is meghívja a
  // `finish`-t, és versenyben lehetnek egymással (a `process.exit` a SIGINT
  // ágon csak a riport kiírása UTÁN fut le, addig a fő ág is tovább
  // haladhat). Az őr szinkron, még az első `await` előtt fut le, tehát
  // bármelyik hívás érkezzen is előbb, a másik nem írja felül a riportot.
  let finished = false

  const finish = async (interrupted: boolean): Promise<void> => {
    if (finished) return
    finished = true

    const summary = summarize(events)
    const corpus = store.corpusStatus(discovered, artifactKind)
    const markdown = renderReport({
      runId: id,
      startedAt,
      finishedAt: new Date(),
      command: commandLine,
      summary,
      corpora: [{ kind: artifactKind, status: corpus }],
      runs: countRunLogs(cfg.logsDir),
      logPath,
      cost: model
        ? {
            spentUsd: model.guard.spentUsd(),
            limitUsd: model.modelConfig.costLimitUsd,
            capped: model.guard.exceeded(),
          }
        : undefined,
      nextCommand: nextCommand(commandLine, corpus),
    })
    await writeReport(reportPath, markdown)
    // A naplót SZÁNDÉKOSAN nem itt zárjuk: a `finish(true)` (megszakítás) és
    // a fő ág versenyezhet, és egy itt lezárt napló a fő ág további
    // eseményeit némán elnyelné. A napló lezárása a `finally` dolga —
    // egyszer fut le, akkor, amikor a `commandRun` valóban véget ér.
    console.log(`${interrupted ? '\nMegszakítva. ' : ''}Riport: ${reportPath}`)
  }

  // A kezelő nem zárja az állapottárat. Egy valódi Ctrl+C-nél a
  // process.exit úgyis véget vet a folyamatnak, és az állapottár minden
  // írása már commitolva van; a tesztben pedig a hamis exit után a futás
  // zavartalanul befejeződik, ami egy lezárt adatbázison hibát dobna.
  const uninstallSigint = installSigint(() => {
    void finish(true).then(() => (runtime.exit ?? process.exit)(130))
  }, runtime.signals)

  try {
    discovered = await discoverAll(cfg.sources, cfg.languages)
    // A limitnek a JELÖLTEKET kell határolnia, nem a teljes korpuszt: a
    // forrás/csatorna szűrés és a hibás-szűrő UTÁN vágunk, különben pl.
    // `--retry-failed --limit 1` a felfedezés szerint elöl álló (esetleg kész)
    // elemet nézné meg, nem a hibásak közül az elsőt.
    let items = filterItems(discovered, flags)
    if (flags.retryFailed) items = store.listFailed(items, artifactKind)
    if (flags.limit !== undefined) items = items.slice(0, flags.limit)
    const units: WorkUnit[] = items.map((item) => ({ item, recipe }))
    printing({ type: 'scan:found', count: units.length })

    let planned = units
    if (model) {
      const pending = flags.force
        ? units
        : units.filter((unit) => !store.isDone(unit.item.itemId, unitKind(unit)))
      const { slice, first } = await estimateUnits(pending, model.modelConfig)
      const limitUsd = model.modelConfig.costLimitUsd

      printing({
        type: 'run:estimate',
        items: slice.planned.length,
        tokens: slice.tokens,
        usd: slice.usd,
        limitUsd,
      })

      // Az üres becslés (nincs feldolgozandó egység — a szűrők vagy a már
      // kész elemek miatt) nem plafon-túllépés: a köteg simán, nulla
      // egységgel fut le. A 2-es kilépőkód KIZÁRÓLAG akkor jár, ha VAN
      // jelölt, de az első sem fér a plafon alá.
      if (first !== undefined && slice.planned.length === 0) {
        const firstUsd = estimateItemUsd(first.words, first.maxIterations, model.modelConfig)
        printing({
          type: 'run:aborted',
          reason: `már az első elem becsült költsége (${firstUsd.toFixed(4)} $) meghaladja a plafont`,
          spentUsd: 0,
          limitUsd,
        })
        await finish(false)
        return 2
      }

      if (slice.deferred.length > 0) {
        printing({
          type: 'run:sliced',
          planned: slice.planned.length,
          deferred: slice.deferred.length,
          usd: slice.usd,
          limitUsd,
        })
      }

      // A `planned` a SZŰRT egységlista, csökkentve a plafon miatt
      // elhalasztottakkal. Így a már kész egység a kihagyás ágára jut, a
      // hibás elem a feldolgozás hibaágára — modellhívás egyikkel sem jár,
      // tehát a plafon szemantikája sértetlen.
      const deferred = new Set(slice.deferred.map(unitKey))
      planned = units.filter((unit) => !deferred.has(unitKey(unit)))
    }

    const written = new Set<string>()
    for (const unit of planned) {
      const outcome = await processItem(unit.item, {
        notesRoot: cfg.notesRoot,
        store,
        sink: printing,
        version: VERSION,
        options: { force: flags.force, dryRun: flags.dryRun },
        recipeDeps: depsFor(unit.recipe),
      })
      if (outcome.status === 'published') {
        if (outcome.path) written.add(outcome.path)
        if (outcome.recipePath) written.add(outcome.recipePath)
      }

      if (model?.guard.exceeded()) {
        printing({
          type: 'run:aborted',
          reason: 'a tényleges költés meghaladta a plafont',
          spentUsd: model.guard.spentUsd(),
          limitUsd: model.modelConfig.costLimitUsd,
        })
        break
      }
    }

    const summary = summarize(events)
    printing({
      type: 'run:done',
      succeeded: summary.succeeded,
      skipped: summary.skipped,
      failed: summary.failed,
    })
    console.log(
      `\nKész: ${summary.succeeded} sikeres ` +
        `(kreátori ${summary.byCaptionSource.creator} / automatikus ${summary.byCaptionSource.auto}), ` +
        `${summary.skipped} kihagyva, ${summary.failed} hibás.`,
    )

    if (flags.commit && !flags.dryRun && written.size > 0) {
      const message = `docs(videos): átirat ${String(written.size)} videóhoz`
      if (await gitCommitPaths(cfg.vaultPath, [...written], message)) {
        const push = await gitPush(cfg.vaultPath)
        if (!push.pushed) console.log(`A push nem sikerült, a commit lokálisan maradt.`)
      }
    }

    await finish(false)
    return summary.failed > 0 ? 1 : 0
  } finally {
    // A riport a `finally`-ből is elkészül: a törzsben dobott kivétel
    // (git-hiba, tele lemez) enélkül naplót hagyna maga után, riportot nem.
    // A `finish` idempotens, tehát a normál ág után ez már nem csinál semmit.
    // Saját try/catch-ben, hogy egy riportírási hiba se akadályozza meg a
    // leiratkozást és a lezárásokat — és hogy ne nyelje el a törzs eredeti
    // kivételét sem.
    try {
      await finish(false)
    } catch (error) {
      console.error(`A riport nem készült el: ${(error as Error).message}`)
    }
    // A leiratkozás azért kerül ide, hogy a `commandRun` visszatérte után
    // egy késői jel ne fusson neki egy lent már lezárt állapottárnak.
    uninstallSigint()
    log.close()
    store.close()
  }
}
```

- [ ] **6. lépés: Teljes ellenőrzés — a regressziós horgony**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Várt: mindhárom zöld, **változatlan** `cli.test.ts`-szel — a költségkapuk, a
szűrők, a megszakítás, a `--retry-failed`, a szeletelés és az 1. lépés
karakterizációs tesztje is.

- [ ] **7. lépés: Commit**

```bash
git add src/run/plan.ts src/run/plan.test.ts src/cli.ts src/cli.test.ts
```

Javasolt üzenet: `refactor(run): a futás egysége a (videó, recept) pár`, `Refs #26`.

- [ ] **8. lépés: Mutációs ellenőrzés — a közös plafon**

`src/run/plan.ts`, az `estimateUnits` utolsó sorát cseréld ideiglenesen erre
(receptenként külön szeletelő implementáció):

```ts
  const byRecipe = new Map<string, BudgetEntry<WorkUnit>[]>()
  for (const entry of entries) {
    const recipeId = unitKind(entry.value)
    byRecipe.set(recipeId, [...(byRecipe.get(recipeId) ?? []), entry])
  }
  const parts = [...byRecipe.values()].map((part) => sliceToBudget(part, cfg))
  return {
    slice: {
      planned: parts.flatMap((part) => part.planned),
      deferred: parts.flatMap((part) => part.deferred),
      usd: parts.reduce((n, part) => n + part.usd, 0),
      tokens: parts.reduce((n, part) => n + part.tokens, 0),
    },
    first: entries[0],
  }
```

```bash
mise exec -- pnpm vitest run src/run/plan.test.ts -t "közös"
```

Várt: FAIL — mindkét recept egy-egy párja befut. Utána:

```bash
git checkout -- src/run/plan.ts && mise exec -- pnpm vitest run src/run/plan.test.ts
```

Várt: PASS.

---

## Feladat 11: `refinery run --queue`

**Fájlok:**
- Módosít: `src/cli.ts` (importok, `commandRun`, `main`)
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `writeFileAtomic` (5.); `queuePath`, `readQueueFile`,
  `parseQueue`, `checkedPairs`, `type QueuePair` (6.); `commandScanQueue` (8.);
  `DEFERRED_STATUS`, `NOT_FOUND_STATUS`, `applyStatuses`, `doneStatus`,
  `failedStatus`, `pairKey` (9.); `WorkUnit`, `unitKind`, `unitKey`,
  `matchesFilters`, `filterItems`, `estimateUnits`, `ModelRuntime` (10.);
  `type QueueRecipeStatus`, `warnings` (4.); `RECIPES`, `RECIPE_IDS`.
- Termel: a `commandRun` `flags`-ében `queue?: boolean`; a `main` átadja a
  `--queue`-t a `run`-nak.

> **A visszaírás helye.** Normál befejezéskor a commit **előtt** történik —
> különben a frissített `_queue.md` kimaradna a commitból, mert a mai kód a
> commit után hívja a `finish`-t. A `finish` csak akkor ír vissza, ha a futás
> nem jutott el eddig: megszakítás, kivétel vagy 2-es kilépőkód. A `wroteBack`
> őr garantálja, hogy egy futásban legfeljebb egyszer.

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/cli.test.ts` — a fájl **végére**, a meglévő `QA_KIMENET` konstans után
(a segédfüggvények használják):

```ts
/**
 * Receptenként helyes kimenetet adó hamis kliens: a prompt eleje dönti el,
 * melyik recept hív. A bíró mindig átengedi. A kimenetek a meglévő, a kapukon
 * bizonyítottan átmenő szövegek.
 */
function sorKliens(hivasok: { generate: number }): ModelClient {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async generate(_role: ModelRole, prompt: string) {
      hivasok.generate++
      const value = prompt.startsWith('Write a question-and-answer')
        ? QA_KIMENET
        : '## Összefoglaló\n\nEgy mondat a jegyzetből.\n'
      return { value, usage: { inputTokens: 10, outputTokens: 5 } }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async generateObject<T>() {
      return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }
    },
  }
}

/** Kipipálja a megadott (videó, recept) sorokat a sor szövegében. */
function pipal(text: string, parok: readonly (readonly [string, string])[]): string {
  let video: string | undefined
  return text
    .split('\n')
    .map((line) => {
      const id = /^- .*? %%(.+?)%%/.exec(line)?.[1]
      if (id !== undefined) video = id
      const recipeId = /^\s+- \[ \] (\S+)$/.exec(line)?.[1]
      return recipeId !== undefined && parok.some(([v, r]) => v === video && r === recipeId)
        ? line.replace('- [ ]', '- [x]')
        : line
    })
    .join('\n')
}

/** A futás JSONL naplójának eseményei. */
async function naploEsemenyek(logsDir: string): Promise<RunEvent[]> {
  const jsonl = (await readdir(logsDir)).find((f) => f.endsWith('.jsonl'))!
  return (await readFile(join(logsDir, jsonl), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as RunEvent)
}

describe('commandRun --queue', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  it('a kipipált párokat dolgozza fel, csak azok sorait írja vissza, és egyetlen commitot készít', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    await makeVideo(downloads, 'b1', 'Harmadik videó', 'Csatorna B')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })

    // Kézzel előrehozott blokk és saját megjegyzés: mindkettőnek túl kell élnie.
    const friss = await readFile(sor, 'utf8')
    const blokk = (id: string): string => {
      const lines = friss.split('\n')
      const start = lines.findIndex((line) => line.includes(`%%${id}%%`))
      return lines.slice(start, start + 4).join('\n')
    }
    const kezi = pipal(
      friss
        .replace(`${blokk('a1')}\n${blokk('a2')}`, `${blokk('a2')}\n${blokk('a1')}`)
        .replace(
          '## downloads/youtube/Csatorna B',
          'Saját megjegyzés: ezt nézem meg először.\n\n## downloads/youtube/Csatorna B',
        ),
      [
        ['a1', 'summary'],
        ['a1', 'qa'],
        ['b1', 'summary'],
      ],
    )
    await writeFile(sor, kezi, 'utf8')
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    expect(await readFile(sor, 'utf8')).toBe(kezi)

    const hivasok = { generate: 0 }
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)
    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: true },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    const items = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const elem = (id: string) => items.find((i) => i.itemId === id)!
    const vart = [
      noteFile(cfg.notesRoot, elem('a1'), '_transcript.md'),
      noteFile(cfg.notesRoot, elem('a1'), '_summary.md'),
      noteFile(cfg.notesRoot, elem('a1'), '_qa.md'),
      noteFile(cfg.notesRoot, elem('b1'), '_transcript.md'),
      noteFile(cfg.notesRoot, elem('b1'), '_summary.md'),
    ]
    for (const path of vart) expect(existsSync(path)).toBe(true)
    expect(existsSync(noteFile(cfg.notesRoot, elem('a2'), '_transcript.md'))).toBe(false)

    expect(vi.mocked(gitCommitPaths)).toHaveBeenCalledTimes(1)
    const [, commitolt, uzenet] = vi.mocked(gitCommitPaths).mock.calls[0]!
    expect([...commitolt].sort()).toEqual([...vart, sor].sort())
    expect(uzenet).toBe('docs(videos): 5 jegyzet a feldolgozási sorból')

    const elotte = kezi.split('\n')
    const utana = (await readFile(sor, 'utf8')).split('\n')
    expect(utana).toHaveLength(elotte.length)
    const valtozott = utana.filter((line, i) => line !== elotte[i])
    expect(valtozott).toHaveLength(3)
    for (const line of valtozott) {
      expect(line).toMatch(/^ {2}- \[x\] (summary|qa) — ✓ 1\.00 · \$\d\.\d{4} · \[jegyzet\]\(<.+>\)$/)
    }
  })

  it('másodszor futtatva nulla modellhívás, nincs új commit, és a sor bájtra változatlan', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, pipal(await readFile(sor, 'utf8'), [['a1', 'summary']]), 'utf8')
    const hivasok = { generate: 0 }
    await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )
    const elsoHivasok = hivasok.generate
    const elsoSor = await readFile(sor, 'utf8')
    expect(elsoHivasok).toBeGreaterThan(0)

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: true },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(elsoHivasok)
    expect(vi.mocked(gitCommitPaths)).not.toHaveBeenCalled()
    expect(await readFile(sor, 'utf8')).toBe(elsoSor)
  })

  it('ha a plafon csak az első párra elég, egyetlen közös szeletelés után a többi ⏳-t kap', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const alap = rawWithVault(5)
    const alapCfg = loadConfig(alap, '/p/refinery.config.yaml')
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const words = (await normalizeItem(item!)).wordsNormalized
    const summary = getRecipe('summary')
    // Mindhárom recept maxIterations-e ma 0: egy pár becslése mindegyikre
    // ugyanaz, tehát a plafon pontosan az első párra elég.
    const egyPar = estimateItemUsd(
      words,
      summary.maxIterations,
      loadModelConfig(alap, process.env, alapCfg.configPath),
    )
    const raw = { ...alap, cost_limit_usd: egyPar * 1.5 }
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(
      sor,
      pipal(await readFile(sor, 'utf8'), [
        ['a1', 'summary'],
        ['a1', 'flashcards'],
        ['a1', 'qa'],
      ]),
      'utf8',
    )

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const sliced = (await naploEsemenyek(cfg.logsDir)).filter((e) => e.type === 'run:sliced')
    expect(sliced).toMatchObject([{ planned: 1, deferred: 2 }])
    const note = await readFile(sor, 'utf8')
    expect(note).toMatch(/ {2}- \[x\] summary — ✓ /)
    expect(note).toContain('  - [x] flashcards — ⏳ a plafon miatt a következő futásra maradt')
    expect(note).toContain('  - [x] qa — ⏳ a plafon miatt a következő futásra maradt')
  })

  it('ha már az első pár sem fér a plafon alá, 2-vel lép ki, és a sorba ⏳ kerül', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(0.000001)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, pipal(await readFile(sor, 'utf8'), [['a1', 'summary']]), 'utf8')
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(2)
    expect(hivasok.generate).toBe(0)
    expect(await readFile(sor, 'utf8')).toContain(
      '  - [x] summary — ⏳ a plafon miatt a következő futásra maradt',
    )
  })

  it('sor nélkül indulás előtt hibával megáll, és a scan --queue-t javasolja', async () => {
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(1)
    expect(hiba.mock.calls.flat().join('\n')).toContain('refinery scan --queue')
    expect(existsSync(cfg.logsDir)).toBe(false)
    hiba.mockRestore()
  })

  it('--dry-run mellett nem ír vissza a sorba', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    const kipipalt = pipal(await readFile(sor, 'utf8'), [['a1', 'summary']])
    await writeFile(sor, kipipalt, 'utf8')

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: true, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    expect(await readFile(sor, 'utf8')).toBe(kipipalt)
  })

  it('a --recipe csak az adott recept kipipált párjait viszi', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(
      sor,
      pipal(await readFile(sor, 'utf8'), [
        ['a1', 'summary'],
        ['a1', 'qa'],
      ]),
      'utf8',
    )

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, recipe: 'qa', dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_qa.md'))).toBe(true)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_summary.md'))).toBe(false)
    const note = await readFile(sor, 'utf8')
    expect(note).toContain('  - [x] summary\n')
    expect(note).toMatch(/ {2}- \[x\] qa — ✓ /)
  })

  it('a kipipált, de már nem felderített videó párja ✗-t kap, és a kilépőkód 1', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, pipal(await readFile(sor, 'utf8'), [['a2', 'summary']]), 'utf8')
    await rm(join(downloads, 'youtube', 'Csatorna A', 'Második videó.en.srt'))
    await rm(join(downloads, 'youtube', 'Csatorna A', 'Második videó.info.json'))

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens({ generate: 0 }) },
    )

    expect(code).toBe(1)
    expect(await readFile(sor, 'utf8')).toContain('  - [x] summary — ✗ a felirat nem található')
  })

  it('ismeretlen receptnevű kipipált sor nem fut, és a riport figyelmeztet', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await commandScanQueue(cfg, { dryRun: false, commit: false })
    await writeFile(sor, (await readFile(sor, 'utf8')).replace('  - [ ] qa', '  - [x] nincsilyen'), 'utf8')
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(0)
    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    expect(report).toContain('## Figyelmeztetések')
    expect(report).toContain('- ismeretlen recept a sorban: nincsilyen (a1)')
  })
})
```

```bash
mise exec -- pnpm vitest run src/cli.test.ts -t "commandRun --queue"
```

Várt: FAIL — a `queue` kapcsolót a mai `commandRun` nem ismeri (a futás
átirat-futásként megy le, a sor nem változik).

- [ ] **2. lépés: Az importok**

`src/cli.ts` — cseréld a registry-importot erre:

```ts
import { RECIPES, RECIPE_IDS, getRecipe } from './recipe/registry.js'
```

vedd fel a queue-importokat (a `./queue/file.js` és `./queue/merge.js` sora után):

```ts
import { checkedPairs, parseQueue, type QueuePair } from './queue/parse.js'
import {
  DEFERRED_STATUS,
  NOT_FOUND_STATUS,
  applyStatuses,
  doneStatus,
  failedStatus,
  pairKey,
} from './queue/status.js'
```

cseréld a 10. feladatban felvett `./run/plan.js`-importot és a `renderReport` importját erre:

```ts
import {
  estimateUnits,
  filterItems,
  matchesFilters,
  unitKey,
  unitKind,
  type WorkUnit,
} from './run/plan.js'
import { renderReport, type QueueRecipeStatus } from './run/report.js'
```

- [ ] **3. lépés: A `commandRun` queue-móddal**

Cseréld le a teljes `commandRun` függvényt (a `ModelRuntime` interfész marad
előtte) erre:

```ts
export async function commandRun(
  cfg: Config,
  raw: unknown,
  flags: {
    source?: string
    channel?: string
    limit?: number
    /** Queue nélkül a futás receptje; queue-módban szűrő a kipipált párokra. */
    recipe?: string
    /** A vault `_queue.md` sorának kipipált (videó, recept) párjait dolgozza fel. */
    queue?: boolean
    dryRun: boolean
    force: boolean
    commit: boolean
    /** Csak a korábban `failed` állapotú elemeket — queue-módban párokat — futtatja újra. */
    retryFailed?: boolean
    /** A riport fejlécében megjelenő parancssor; hiányában „run”. */
    command?: string
  },
  runtime: RunRuntime = {},
): Promise<number> {
  const commandLine = flags.command ?? 'run'
  const queueMode = flags.queue === true
  const commit = flags.commit && !flags.dryRun
  const recipe = flags.recipe ? getRecipe(flags.recipe) : null

  // Egy kliens és egy költségőr az egész indításra: a plafon így nem
  // receptenként, hanem együtt vonatkozik minden egységre.
  let model: ModelRuntime | undefined
  if (recipe || queueMode) {
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    model = {
      modelConfig,
      client: (runtime.createClient ?? createModelClient)(modelConfig),
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
  }
  const depsFor = (unitRecipe: Recipe | null): RecipeDeps | undefined =>
    unitRecipe && model
      ? {
          recipe: unitRecipe,
          client: model.client,
          modelConfig: model.modelConfig,
          guard: model.guard,
        }
      : undefined

  // A futás műtermék-típusa queue nélkül: recepttel a recept azonosítója,
  // enélkül az átirat. A riport és a hibás-szűrő ugyanazt kérdezi.
  const artifactKind = recipe?.id ?? ARTIFACT_KIND

  if (commit) await gitPullFfOnly(cfg.vaultPath)

  // A sort a pull UTÁN olvassuk: a pull frissebb változatot hozhat.
  const sorPath = queuePath(cfg.notesRoot)
  const queueText = queueMode ? await readQueueFile(sorPath) : null
  if (queueMode && queueText === null) {
    console.error(`Nincs feldolgozási sor: ${sorPath}\nElőbb: refinery scan --queue`)
    return 1
  }

  const store = openState(cfg.statePath)

  const startedAt = new Date()
  // Ütközésmentes név: két azonos másodpercben induló futás nem írhat
  // egymás naplójába, és nem írhatja felül egymás riportját.
  const id = reserveRunId(cfg.logsDir, runId(startedAt))
  const logPath = join(cfg.logsDir, `${id}.jsonl`)
  const reportPath = join(cfg.logsDir, `${id}.md`)
  const log = openRunLog(logPath)

  const { sink, events } = collectEvents()
  const printing = (e: RunEvent) => {
    sink(e)
    log.sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }

  // A discoverAll teljes, szűretlen eredménye — a korpusz állapota a teljes
  // korpuszról szól, nem a szűrt szeletről. Korán inicializálva, hogy egy
  // korai SIGINT is riportot írjon (üres korpusszal), ne undefined-ra
  // hivatkozzon.
  let discovered: SourceItem[] = []
  /** A szűrés utáni egységek: a visszaírás és a sor-állapot ezekről szól. */
  let selected: WorkUnit[] = []
  /** Kipipált párok, amelyek eleme nem található. */
  let notFound: QueuePair[] = []
  /** A plafon miatt nem futott egységek kulcsai: szeletelés vagy futás közbeni megállás. */
  const capped = new Set<string>()
  const warnings: string[] = []

  let wroteBack = false
  /**
   * A sor visszaírása az állapottárból. Egy futáson belül legfeljebb egyszer:
   * normál befejezéskor a commit előtt, egyébként a `finish`-ben.
   */
  const writeBack = async (): Promise<boolean> => {
    if (!queueMode || flags.dryRun || wroteBack) return false
    wroteBack = true
    const current = await readQueueFile(sorPath)
    if (current === null) return false
    const statuses = new Map<string, string>()
    for (const unit of selected) {
      const kind = unitKind(unit)
      const record = store.artifactOf(unit.item.itemId, kind)
      const key = pairKey(unit.item.itemId, kind)
      if (record?.status === 'done') statuses.set(key, doneStatus(record, cfg.notesRoot))
      else if (record?.status === 'failed') statuses.set(key, failedStatus(record.error))
      else if (capped.has(unitKey(unit))) statuses.set(key, DEFERRED_STATUS)
    }
    for (const pair of notFound) {
      statuses.set(pairKey(pair.itemId, pair.recipeId), NOT_FOUND_STATUS)
    }
    const next = applyStatuses(current, statuses)
    if (next === current) return false
    await writeFileAtomic(sorPath, next)
    return true
  }

  /** A sor állapota receptenként, registry-sorrendben — csak queue-futásnál. */
  const queueStatus = (): QueueRecipeStatus[] | undefined => {
    if (!queueMode) return undefined
    const rows = new Map<string, QueueRecipeStatus>()
    const row = (recipeId: string): QueueRecipeStatus => {
      let r = rows.get(recipeId)
      if (!r) {
        r = { recipe: recipeId, selected: 0, done: 0, failed: 0, pending: 0, deferred: 0 }
        rows.set(recipeId, r)
      }
      return r
    }
    for (const unit of selected) {
      const r = row(unitKind(unit))
      r.selected++
      const status = store.artifactOf(unit.item.itemId, unitKind(unit))?.status
      if (status === 'done') r.done++
      else if (status === 'failed') r.failed++
      else if (capped.has(unitKey(unit))) r.deferred++
      else r.pending++
    }
    for (const pair of notFound) {
      const r = row(pair.recipeId)
      r.selected++
      r.failed++
    }
    return RECIPE_IDS.flatMap((recipeId) => {
      const r = rows.get(recipeId)
      return r ? [r] : []
    })
  }

  // Egyszeri lefutás: a megszakítás és a normál befejezés is meghívja a
  // `finish`-t, és versenyben lehetnek egymással (a `process.exit` a SIGINT
  // ágon csak a riport kiírása UTÁN fut le, addig a fő ág is tovább
  // haladhat). Az őr szinkron, még az első `await` előtt fut le, tehát
  // bármelyik hívás érkezzen is előbb, a másik nem írja felül a riportot.
  let finished = false

  const finish = async (interrupted: boolean): Promise<void> => {
    if (finished) return
    finished = true

    // Megszakításnál, a törzsben dobott kivételnél és a 2-es kilépőkódnál a
    // visszaírás itt történik; a normál ágon már megtörtént, ez pedig nem
    // csinál semmit.
    try {
      await writeBack()
    } catch (error) {
      console.error(`A sor visszaírása nem sikerült: ${(error as Error).message}`)
    }

    const summary = summarize(events)
    const kinds = queueMode
      ? RECIPE_IDS.filter((recipeId) => selected.some((unit) => unitKind(unit) === recipeId))
      : [artifactKind]
    const corpora = kinds.map((kind) => ({ kind, status: store.corpusStatus(discovered, kind) }))
    const queue = queueStatus()
    const remaining = queue
      ? {
          pending: queue.reduce((n, q) => n + q.pending + q.deferred, 0),
          failed: queue.reduce((n, q) => n + q.failed, 0),
        }
      : (corpora[0]?.status ?? { pending: 0, failed: 0 })
    const markdown = renderReport({
      runId: id,
      startedAt,
      finishedAt: new Date(),
      command: commandLine,
      summary,
      corpora,
      queue,
      warnings,
      runs: countRunLogs(cfg.logsDir),
      logPath,
      cost: model
        ? {
            spentUsd: model.guard.spentUsd(),
            limitUsd: model.modelConfig.costLimitUsd,
            capped: model.guard.exceeded(),
          }
        : undefined,
      nextCommand: nextCommand(commandLine, remaining),
    })
    await writeReport(reportPath, markdown)
    // A naplót SZÁNDÉKOSAN nem itt zárjuk: a `finish(true)` (megszakítás) és
    // a fő ág versenyezhet, és egy itt lezárt napló a fő ág további
    // eseményeit némán elnyelné. A napló lezárása a `finally` dolga —
    // egyszer fut le, akkor, amikor a `commandRun` valóban véget ér.
    console.log(`${interrupted ? '\nMegszakítva. ' : ''}Riport: ${reportPath}`)
  }

  // A kezelő nem zárja az állapottárat. Egy valódi Ctrl+C-nél a
  // process.exit úgyis véget vet a folyamatnak, és az állapottár minden
  // írása már commitolva van; a tesztben pedig a hamis exit után a futás
  // zavartalanul befejeződik, ami egy lezárt adatbázison hibát dobna.
  const uninstallSigint = installSigint(() => {
    void finish(true).then(() => (runtime.exit ?? process.exit)(130))
  }, runtime.signals)

  try {
    discovered = await discoverAll(cfg.sources, cfg.languages)

    let units: WorkUnit[]
    if (queueMode) {
      const byId = new Map(discovered.map((item) => [item.itemId, item] as const))
      units = []
      for (const pair of checkedPairs(parseQueue(queueText ?? ''))) {
        const pairRecipe = RECIPES[pair.recipeId]
        if (!pairRecipe) {
          warnings.push(`ismeretlen recept a sorban: ${pair.recipeId} (${pair.itemId})`)
          continue
        }
        const item = byId.get(pair.itemId)
        if (item) units.push({ item, recipe: pairRecipe })
        else notFound.push(pair)
      }
      // A kapcsolók a párokat szűkítik. A nem található pár eleméről nem
      // tudunk forrást vagy csatornát, ezért csak a receptszűrő vonatkozik
      // rá; az újrapróbálás pedig csak állapottárban rögzített hibára értelmes.
      units = units.filter((unit) => matchesFilters(unit.item, flags))
      if (recipe) {
        units = units.filter((unit) => unit.recipe?.id === recipe.id)
        notFound = notFound.filter((pair) => pair.recipeId === recipe.id)
      }
      if (flags.retryFailed) {
        units = units.filter(
          (unit) => store.artifactOf(unit.item.itemId, unitKind(unit))?.status === 'failed',
        )
        notFound = []
      }
      if (flags.limit !== undefined) units = units.slice(0, flags.limit)
    } else {
      // A limitnek a JELÖLTEKET kell határolnia, nem a teljes korpuszt: a
      // forrás/csatorna szűrés és a hibás-szűrő UTÁN vágunk, különben pl.
      // `--retry-failed --limit 1` a felfedezés szerint elöl álló (esetleg
      // kész) elemet nézné meg, nem a hibásak közül az elsőt.
      let items = filterItems(discovered, flags)
      if (flags.retryFailed) items = store.listFailed(items, artifactKind)
      if (flags.limit !== undefined) items = items.slice(0, flags.limit)
      units = items.map((item) => ({ item, recipe }))
    }
    selected = units
    printing({ type: 'scan:found', count: units.length })

    let planned = units
    if (model) {
      const pending = flags.force
        ? units
        : units.filter((unit) => !store.isDone(unit.item.itemId, unitKind(unit)))
      const { slice, first } = await estimateUnits(pending, model.modelConfig)
      const limitUsd = model.modelConfig.costLimitUsd
      for (const unit of slice.deferred) capped.add(unitKey(unit))

      printing({
        type: 'run:estimate',
        items: slice.planned.length,
        tokens: slice.tokens,
        usd: slice.usd,
        limitUsd,
      })

      // Az üres becslés (nincs feldolgozandó egység — a szűrők vagy a már
      // kész elemek miatt) nem plafon-túllépés: a köteg simán, nulla
      // egységgel fut le. A 2-es kilépőkód KIZÁRÓLAG akkor jár, ha VAN
      // jelölt, de az első sem fér a plafon alá.
      if (first !== undefined && slice.planned.length === 0) {
        const firstUsd = estimateItemUsd(first.words, first.maxIterations, model.modelConfig)
        printing({
          type: 'run:aborted',
          reason: `már az első elem becsült költsége (${firstUsd.toFixed(4)} $) meghaladja a plafont`,
          spentUsd: 0,
          limitUsd,
        })
        await finish(false)
        return 2
      }

      if (slice.deferred.length > 0) {
        printing({
          type: 'run:sliced',
          planned: slice.planned.length,
          deferred: slice.deferred.length,
          usd: slice.usd,
          limitUsd,
        })
      }

      // A `planned` a SZŰRT egységlista, csökkentve a plafon miatt
      // elhalasztottakkal. Így a már kész egység a kihagyás ágára jut, a
      // hibás elem a feldolgozás hibaágára — modellhívás egyikkel sem jár,
      // tehát a plafon szemantikája sértetlen.
      planned = units.filter((unit) => !capped.has(unitKey(unit)))
    }

    const written = new Set<string>()
    for (const [index, unit] of planned.entries()) {
      const outcome = await processItem(unit.item, {
        notesRoot: cfg.notesRoot,
        store,
        sink: printing,
        version: VERSION,
        options: { force: flags.force, dryRun: flags.dryRun },
        recipeDeps: depsFor(unit.recipe),
      })
      if (outcome.status === 'published') {
        if (outcome.path) written.add(outcome.path)
        if (outcome.recipePath) written.add(outcome.recipePath)
      }

      if (model?.guard.exceeded()) {
        printing({
          type: 'run:aborted',
          reason: 'a tényleges költés meghaladta a plafont',
          spentUsd: model.guard.spentUsd(),
          limitUsd: model.modelConfig.costLimitUsd,
        })
        // A plafon miatt el sem indult egységek a sorban ⏳-t kapnak.
        for (const rest of planned.slice(index + 1)) capped.add(unitKey(rest))
        break
      }
    }

    const summary = summarize(events)
    printing({
      type: 'run:done',
      succeeded: summary.succeeded,
      skipped: summary.skipped,
      failed: summary.failed,
    })
    console.log(
      `\nKész: ${summary.succeeded} sikeres ` +
        `(kreátori ${summary.byCaptionSource.creator} / automatikus ${summary.byCaptionSource.auto}), ` +
        `${summary.skipped} kihagyva, ${summary.failed} hibás.`,
    )

    // A visszaírás a commit ELŐTT: a frissített sor ugyanabba a commitba kerül.
    const queueChanged = await writeBack()
    const paths = queueChanged ? [...written, sorPath] : [...written]
    if (commit && paths.length > 0) {
      const message = queueMode
        ? `docs(videos): ${String(written.size)} jegyzet a feldolgozási sorból`
        : `docs(videos): átirat ${String(written.size)} videóhoz`
      if (await gitCommitPaths(cfg.vaultPath, paths, message)) {
        const push = await gitPush(cfg.vaultPath)
        if (!push.pushed) console.log(`A push nem sikerült, a commit lokálisan maradt.`)
      }
    }

    await finish(false)
    return summary.failed > 0 || notFound.length > 0 ? 1 : 0
  } finally {
    // A riport a `finally`-ből is elkészül: a törzsben dobott kivétel
    // (git-hiba, tele lemez) enélkül naplót hagyna maga után, riportot nem.
    // A `finish` idempotens, tehát a normál ág után ez már nem csinál semmit.
    // Saját try/catch-ben, hogy egy riportírási hiba se akadályozza meg a
    // leiratkozást és a lezárásokat — és hogy ne nyelje el a törzs eredeti
    // kivételét sem.
    try {
      await finish(false)
    } catch (error) {
      console.error(`A riport nem készült el: ${(error as Error).message}`)
    }
    // A leiratkozás azért kerül ide, hogy a `commandRun` visszatérte után
    // egy késői jel ne fusson neki egy lent már lezárt állapottárnak.
    uninstallSigint()
    log.close()
    store.close()
  }
}
```

- [ ] **4. lépés: A `main`**

A `run` ágon a `commandRun` hívásába, a `recipe: values.recipe,` után:

```ts
      queue: values.queue,
```

- [ ] **5. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/cli.test.ts
```

Várt: PASS — az új `commandRun --queue` blokk, a 10. feladat
karakterizációs tesztje és minden meglévő teszt.

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **7. lépés: Commit**

```bash
git add src/cli.ts src/cli.test.ts
```

Javasolt üzenet: `feat(cli): run --queue`, `Refs #26`.

---

## Feladat 12: A feldolgozási sor végponttól végpontig, valódi gittel

A `cli.test.ts` a git-függvényeket mockolja; itt a teljes út valódi
repóval, valódi `pull --ff-only`-val és valódi pusszal fut — egy csupasz
távoli repó ellen.

**Fájlok:**
- Teszt: `src/e2e.test.ts`

**Interfészek:**
- Fogyaszt: `commandScanQueue` (8.), `commandRun` a `queue` kapcsolóval (11.),
  `queuePath` (6.), `noteFile` (`src/vault/paths.ts`).
- Termel: nincs új kód — ez a feladat a 3. sikerkritériumot bizonyítja a
  valódi git-rétegen.

- [ ] **1. lépés: Írd meg a tesztet**

`src/e2e.test.ts` — az importok:

```ts
import { join, relative } from 'node:path'
```

```ts
import { commandRun, commandScanQueue } from './cli.js'
```

```ts
import type { ModelClient } from './model/client.js'
import { queuePath } from './queue/file.js'
```

```ts
import { noteFile } from './vault/paths.js'
```

A fájl végére:

```ts
describe('végponttól végpontig — a feldolgozási sor valódi gittel', () => {
  it('scan --queue, pipálás, run --queue: pontosan a várt commitok, tiszta és pusholt munkafa', async () => {
    // Csupasz távoli repó, hogy a pull --ff-only és a push is valódi legyen.
    const remote = join(work, 'remote.git')
    const repo = join(work, 'vault-klon')
    await run('git', ['init', '-q', '--bare', remote])
    await run('git', ['clone', '-q', remote, repo])
    await run('git', ['config', 'user.email', 'teszt@pelda.hu'], { cwd: repo })
    await run('git', ['config', 'user.name', 'Teszt'], { cwd: repo })
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'kezdet'], { cwd: repo })
    await run('git', ['push', '-q', '-u', 'origin', 'HEAD'], { cwd: repo })

    await write(join(subsA, 'Cs', 'Elso.en.srt'), SRT)
    await write(join(subsA, 'Cs', 'Masodik.en.srt'), SRT)
    const raw = {
      vault: { path: repo },
      sources: [subsA],
      state: { path: join(work, 'state.db') },
      logs: { dir: join(work, 'logs') },
      model: { base_url: 'http://localhost:4000/v1', draft: 'proba-draft', judge: 'proba-judge' },
      pricing: {
        draft: { input_per_million: 3, output_per_million: 15 },
        judge: { input_per_million: 0.2, output_per_million: 0.5 },
      },
      cost_limit_usd: 5,
    }
    const cfg = loadConfig(raw, join(work, 'refinery.config.yaml'))
    const client: ModelClient = {
      generate: () =>
        Promise.resolve({
          value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      generateObject: <T>() =>
        Promise.resolve({
          value: { score: 1, gaps: [] } as T,
          usage: { inputTokens: 5, outputTokens: 2 },
        }),
    }

    const mentettKulcs = process.env.LITELLM_API_KEY
    process.env.LITELLM_API_KEY = 'sk-proba'
    try {
      expect(await commandScanQueue(cfg, { dryRun: false, commit: true })).toBe(0)
      const sor = queuePath(cfg.notesRoot)
      // Az első videó summary-sora: a felderítés rendezett, az `Elso` áll elöl.
      await writeFile(
        sor,
        (await readFile(sor, 'utf8')).replace('  - [ ] summary', '  - [x] summary'),
        'utf8',
      )

      const code = await commandRun(
        cfg,
        raw,
        { queue: true, dryRun: false, force: false, commit: true },
        { createClient: () => client },
      )
      expect(code).toBe(0)

      const log = await run('git', ['log', '--format=%s'], { cwd: repo })
      expect(log.stdout.trim().split('\n')).toEqual([
        'docs(videos): 2 jegyzet a feldolgozási sorból',
        'docs(videos): feldolgozási sor frissítése',
        'kezdet',
      ])

      const elso = (await discoverAll(cfg.sources, cfg.languages)).find((i) => i.baseName === 'Elso')!
      const show = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
      expect(show.stdout.trim().split('\n').sort()).toEqual(
        [
          relative(repo, noteFile(cfg.notesRoot, elso, '_transcript.md')),
          relative(repo, noteFile(cfg.notesRoot, elso, '_summary.md')),
          relative(repo, sor),
        ].sort(),
      )
      expect(await isDirty(repo)).toBe(false)
      const status = await run('git', ['status', '-sb'], { cwd: repo })
      expect(status.stdout).not.toContain('ahead')
    } finally {
      if (mentettKulcs === undefined) delete process.env.LITELLM_API_KEY
      else process.env.LITELLM_API_KEY = mentettKulcs
    }
  })
})
```

- [ ] **2. lépés: Futtasd**

```bash
mise exec -- pnpm vitest run src/e2e.test.ts
```

Várt: PASS. Ha elbukik, az a 8. vagy a 11. feladat hibája, nem a tesztté —
a `git log`, a `git show` és a `git status -sb` kimenete megnevezi, melyik
commit vagy útvonal tér el.

- [ ] **3. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **4. lépés: Commit**

```bash
git add src/e2e.test.ts
```

Javasolt üzenet: `test(e2e): a feldolgozási sor valódi gittel`, `Refs #26`.

---

## Feladat 13: A döntés és a dokumentáció

**Fájlok:**
- Létrehoz: `docs/decisions/0010-videonkenti-receptvalasztas.md`
- Módosít: `docs/architecture.md` (§7 „Ütközésvédelem", §10 a lista formátuma)
- Módosít: `docs/roadmap.md` (Fázis 5)
- Módosít: `README.md` („Ami már fut")

**Interfészek:**
- Fogyaszt: az 1–12. feladat viselkedését. A dokumentáció csak azt írja le,
  ami tesztelve fut.
- Termel: nincs kód.

- [ ] **1. lépés: Az ADR**

Hozd létre a `docs/decisions/0010-videonkenti-receptvalasztas.md`-t
**pontosan ezzel a tartalommal**:

````markdown
# 0010 — A receptválasztás videónként is lehetséges

**Dátum:** 2026-09-11 · **Státusz:** elfogadva ·
**Felülírja:** az `architecture.md` §10 „a receptválasztás futás-szintű" részét

## A kérdés

Az `architecture.md` §10 a köteg listájáról kimondta: *„A per-sor
felülbírálás (CSV, YAML) szándékosan kimarad: a receptválasztás
futás-szintű, és a per-elem igény spekulatív."* Egy futás egy receptet vitt
végig minden kiválasztott elemen.

A Fázis 5 queue-jegyzetének tervezésekor az igény valódinak bizonyult: az
egyik videóhoz összefoglaló kell, kártya nem; a másikhoz fordítva; a
harmadikhoz mind. Futás-szintű recepttel ez receptenként külön futást és
külön kiválasztást jelentene, ugyanarra a listára.

Maradjon-e futás-szintű a receptválasztás?

## A döntés

**Nem. A feldolgozási sorban (`_queue.md`) a választás videónként és
receptenként történik, és a `run` (videó, recept) párokon fut.**

- A sor videónként receptenként egy pipát ad; a pipa jelentése: „ehhez a
  videóhoz ezt a receptet kérem". A pipeline a pipához nem nyúl.
- A `run --queue` a kipipált, még nem kész párokat dolgozza fel, **egyetlen
  közös becsléssel és költségőrrel** — a plafon az egész indításra vonatkozik,
  nem receptenként.
- A `run --recipe X` a `--queue` nélkül továbbra is futás-szintű.

## Mi döntötte el

**1. A spekuláció helyett valódi igény áll.** A §10 ítélete arra épült, hogy
per-elem igény nincs. Ez a feltétel szűnt meg — nem az érvelés bizonyult
hibásnak.

**2. A formátumnak nem kell CSV-nek vagy YAML-nak lennie.** A §10 azért zárta
ki a per-sor felülbírálást, mert az a kézzel kellemesen bemásolható sima
szöveget cserélte volna le. A pipálható Markdown-lista ezt az árat nem kéri:
Obsidianban natív, és kézzel is szerkeszthető.

**3. A pár a helyes egység, nem a receptenként ismételt futás.** Receptenként
külön indított futás receptenként külön becsülne: a második recept úgy is
elindulhatna, hogy a becslése a teljes plafonba belefér, a már elköltött
maradékba viszont nem. Ez a `decisions/0004` „plafon fölött el sem indul"
garanciáját gyengítené.

## Következmények

- A futás egysége a (videó, recept) pár; a becslés bejegyzésenkénti
  iterációszámmal szeletel.
- A hibalista (videó, típus) párokra bomlik — egy videó második recepthibája
  többé nem írja felül az elsőt.
- A queue-jegyzet az egyetlen vault-fájl, amit a pipeline helyben frissít:
  atomi írással, és csak a saját részeit (`architecture.md` §7).
- A CLI `--recipe` kapcsolója továbbra is egyetlen értéket fogad; több receptet
  egy futásban a sor ad.
- Spec: [`plans/2026-09-11-fazis-5-queue-jegyzet-spec.md`](<../plans/2026-09-11-fazis-5-queue-jegyzet-spec.md>).
````

- [ ] **2. lépés: `architecture.md` §10**

Cseréld ezt:

```markdown
- **A lista formátuma sima szöveg**: soronként egy feliratforrás-elem (forrás +
  alapnév), `#`-kommenttel. A per-sor felülbírálás (CSV, YAML) szándékosan
  kimarad: a receptválasztás futás-szintű, és a per-elem igény spekulatív.
  Cserébe a fájl kézzel is kellemesen bemásolható marad — ami a lényege,
  hiszen ez lesz az Obsidian queue-jegyzet is.
```

erre:

```markdown
- **A lista a vault feldolgozási sora** (`<notes_dir>/_queue.md`): videónként
  receptenként egy pipálható sor. A `scan --queue` fésüli bele a felderített
  elemeket, a `run --queue` a kipipált (videó, recept) párokat dolgozza fel,
  és az eredményt ugyanazokba a sorokba írja vissza. A receptválasztás így
  videónként is lehetséges ([`decisions/0010`](<./decisions/0010-videonkenti-receptvalasztas.md>));
  a `--recipe` kapcsolóval indított futás futás-szintű marad.
```

- [ ] **3. lépés: `architecture.md` §7**

Az „Ütközésvédelem" szakasz bekezdése —

```markdown
Írás csak akkor, ha a célfájl nem létezik. Felülírás kizárólag explicit
`--force`-szal. A vaultban évek kézi munkája van; a pipeline nem írhatja felül.
```

— **után** szúrd be (üres sorral elválasztva):

```markdown
**Egyetlen kivétel a feldolgozási sor** (`_queue.md`): ezt a pipeline helyben
frissíti, mert a kipipált párok eredménye oda íródik vissza. Két szabály védi.
Csak a saját részeit írja — új videóblokk, a videósor jelölése, a receptsor
állapota —, a pipákhoz és a saját sorokhoz soha nem nyúl. És **atomian** ír,
ideiglenes fájlon át, átnevezéssel, mert a jegyzet közben nyitva lehet
Obsidianban.
```

- [ ] **4. lépés: `roadmap.md` Fázis 5**

Futtasd:

```bash
date +%F
```

A Fázis 5 bekezdése —

```markdown
A sorrend nem ízlés kérdése: **egy szép felület egy ki nem értékelt csővezeték
fölött pont az ellenkezőjét üzeni annak, amit ez a projekt állít magáról.** A
mérés előbb.
```

— **után** szúrd be (üres sorral elválasztva), a dátum helyére a `date +%F`
kimenetét írva:

```markdown
**A queue-jegyzet — státusz: kész** (dátum). Spec és terv:
[`plans/2026-09-11-fazis-5-queue-jegyzet-spec.md`](<./plans/2026-09-11-fazis-5-queue-jegyzet-spec.md>),
[`plans/2026-09-11-fazis-5-queue-jegyzet.md`](<./plans/2026-09-11-fazis-5-queue-jegyzet.md>).

**Kész, ha (queue-jegyzet):**

- Friss vaulton a `scan --queue` létrehozza a sort minden felderített
  videóval, receptenként egy üres pipával; másodszor futtatva **bájtra
  azonos**, commit nélkül.
- Kipipált párokra a `run --queue` pontosan azokat a jegyzeteket készíti el,
  pontosan azokat a sorokat írja vissza, és **egyetlen commitot** készít, benne
  csak ezekkel a fájlokkal és a sorral.
- Ugyanaz a `run --queue` másodszor **nulla modellhívással** és commit nélkül
  fut le.
- A plafon az egész indításra vonatkozik: ami nem fér alá, a sorban ⏳-t kap.
- A saját megjegyzéssorok és a kézi átrendezés túlélik a `scan --queue`-t és a
  `run --queue`-t.
```

- [ ] **5. lépés: `README.md`**

A kártya- és Q&A-recept bekezdése —

```markdown
kapu előbb fut, mint a bírók — ismétlődő kérdésnél vagy válasz nélküli
fejlécnél a drága pontozás el sem indul.
```

— **után** szúrd be (üres sorral elválasztva):

```markdown
A feldolgozási sor a válogatást Obsidianba viszi. A `scan --queue` a vault
`_queue.md` jegyzetébe fésüli a felderített videókat, videónként receptenként
egy üres pipával; a `run --queue` a kipipált (videó, recept) párokat dolgozza
fel — egyetlen közös becsléssel és költségplafonnal —, és az eredményt
pontszámmal, költséggel és a jegyzet linkjével ugyanazokba a sorokba írja
vissza. A pipákhoz és a saját sorokhoz nem nyúl, a jegyzetet atomian írja, és
ha nincs mit feldolgozni, nulla modellhívással, commit nélkül fut le.
```

Futtasd:

```bash
mise exec -- pnpm test
```

és a kimenet `Tests … passed` és `Test Files … passed` számával cseréld a
README mondatát — ma így kezdődik: `364 teszttel, 39 tesztfájlban — köztük egy
Fázis 0-ra írt végponttól`. Csak a két szám változik.

- [ ] **6. lépés: Teljes ellenőrzés, build és súgó**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint && mise exec -- pnpm build && mise exec -- node dist/cli.js --help | grep -- '--queue'
```

Várt: mindhárom zöld, a build hibátlan, a `grep` kiírja a `--queue` súgósorát.

Nézd át a módosított dokumentumokat: egyikben sincs cím, csatornanév,
azonosító vagy gépspecifikus útvonal.

- [ ] **7. lépés: Commit**

```bash
git add docs/decisions/0010-videonkenti-receptvalasztas.md docs/architecture.md docs/roadmap.md README.md
```

Javasolt üzenet: `docs: a feldolgozási sor döntése és dokumentációja`, láblécben `Closes #26`.

- [ ] **8. lépés: Az ág lezárása**

A push és a PR **csak a felhasználó jóváhagyásával** történik, a
`superpowers:finishing-a-development-branch` szerint.

---

## Önellenőrzés

**1. Spec-lefedettség.**

| spec | feladat |
|---|---|
| §1 Parancsok és kapcsolók | 8. (`scan --queue`), 11. (`run --queue` és a szűkítő kapcsolók) |
| §1 A jegyzet helye és formátuma | 6. (`queuePath`, sorfajták, horgony, címtisztítás) |
| §1 Ki mit ír | 7. (a scan csak blokkot, receptsort, jelölést ír), 9. (a run csak receptsor-utótagot) |
| §2 Összefésülés, idempotencia, törölt blokk | 7. |
| §2 Git és `--dry-run` | 8. |
| §3 Az egység, kiválasztás, szűkítés | 10., 11. |
| §3 Becslés és feldolgozás — közös plafon | 2., 10., 11. |
| §3 Visszaírás — állapottárból, azonosító szerint, commit előtt, `finish`-ben | 9., 11. |
| §3 Commit | 11., 12. |
| §3 Riport, események, összesítő | 3., 4., 11. |
| §3 Kilépőkódok | 11. (0, 1, 2 tesztelve; a 130 a meglévő megszakítás-teszt) |
| §4 Költségkönyvelés | 1. |
| §5 Atomi írás | 5., 8., 11. |
| §5 Nyitva lévő jegyzet — újraolvasás | 11. (a `writeBack` írás előtt újraolvas) |
| §5 Ismeretlen tartalom, lint a generált részekre | 6., 7., 9. |
| §5 `run --queue --dry-run` | 11. |
| Megkötések | Globális megkötések |
| Sikerkritérium 1–2 | 8. |
| Sikerkritérium 3 | 11. (mockolt git), 12. (valódi git) |
| Sikerkritérium 4 | 11. |
| Sikerkritérium 5 | 10. (egységszinten), 11. (futásszinten) |
| Sikerkritérium 6 | 7., 11. |
| Sikerkritérium 7 | 1. (bíró-ár), 10. (karakterizációs commit-teszt és a változatlan `cli.test.ts`) |
| Sikerkritérium 8 | mutációk: 1. (szerepenkénti ár), 7. (saját sorok), 9. (azonosító szerinti visszaírás), 10. (közös plafon) |
| Sikerkritérium 9 | 13. |

**2. Helykitöltő-vizsgálat.** Nincs „TBD", „később" vagy „mint az N.
feladatban". Két érték szándékosan a végrehajtáskor dől el, pontos paranccsal:
a roadmap dátuma (`date +%F`) és a README tesztszáma (`pnpm test` kimenete) —
mindkettő a 13. feladatban.

**3. Típus- és névkonzisztencia.**

- `BudgetEntry.maxIterations` (2.) — használja: `estimateUnits` (10.),
  `first.maxIterations` (10., 11.).
- `item:failed.kind`, `RunFailure.kind` (3.) — használja: `render` (3.), a
  riport hibatáblája (3., 4.).
- `KindCorpus`, `QueueRecipeStatus`, `ReportInput.corpora` / `queue` /
  `warnings` (4.) — használja: `commandRun` (10., 11.), `e2e.test.ts` (4.).
- `writeFileAtomic` (5.) — 8., 11.
- `QUEUE_FILE`, `queuePath`, `readQueueFile` (6.) — 8., 11., 12.
- `classifyLine`, `cleanTitle`, `groupKey`, `videoLine`, `recipeLine`,
  `withSuffix` (6.) — 7., 9.
- `parseQueue`, `checkedPairs`, `QueueDoc`, `QueuePair` (6.) — 7., 9., 11.
- `mergeQueue`, `QUEUE_HEADER`, `NOT_FOUND_MARK`, `DUPLICATE_MARK` (7.) — 8.
- `pairKey`, `doneStatus`, `failedStatus`, `applyStatuses`, `DEFERRED_STATUS`,
  `NOT_FOUND_STATUS` (9.) — 11.
- `WorkUnit`, `unitKind`, `unitKey`, `matchesFilters`, `filterItems`,
  `estimateUnits`, `ModelRuntime` (10.) — 11.
- A párkulcsok mindenhol `JSON.stringify([itemId, típus])`: a `summarize`
  hibalistája (3.), a `pairKey` (9.) és az `unitKey` (10.).

**4. Egy tudatos pontosítás a spechez képest.** A spec a címből az újsort és a
`%%`-t tisztítja; a terv ezen felül az egymás melletti szögletes zárójeleket és
a `](` párost is szétbontja (6. feladat, `cleanTitle`). Enélkül egy `[[…]]`-t
tartalmazó videócím a spec §5 szerinti lint-kivételt dobná, és megakasztaná a
`scan --queue`-t. A tisztítás a spec szándékát teljesíti — a generált rész
sosem sérti a linkszabályt —, nem módosítja.

## Ami ebbe a tervbe szándékosan nem fér bele

- **Időzítés (launchd).** Kézi indítás; később konfigurációs változás
  (`architecture.md` §10, §12).
- **Végleges elrejtés.** A törölt blokk visszajön; az elrejtéshez az
  állapottárnak kellene nyilvántartania, mi volt már listázva. Valódi igényre.
- **A megszakítás utáni commit-rés** — `#25`.
- **Több érték a `--recipe` kapcsolón.** Az igényt a sor fedi.
- **A prompt-cache tokenek árazása** — önálló téma.
- **A mentett mérési szövegek újrahasznosítása** (`RunRecord.output`) — önálló
  döntés.
- **A `scan:found` konzolszövege.** Queue-futásnál a kiírt szám a párok száma,
  a felirat viszont „feldolgozható videó"; az átfogalmazás minden futás
  konzolszövegét érintené, ezért nem része ennek a szeletnek.
- **A Nuxt-felület** — a Fázis 5 második fele.
