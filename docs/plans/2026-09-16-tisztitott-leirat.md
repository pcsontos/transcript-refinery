# Tisztított leirat időbélyegekkel — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Egy új recept (`clean`), ami a feliratból enyhén szerkesztett, bekezdésekre és `##` szakaszcímekre tagolt leiratot készít, minden bekezdés előtt a valós elhangzási idővel.

**Architecture:** A modell tiszta prózát ír időbélyeg nélkül; egy determinisztikus lépés (`postprocess`) utólag horgonyozza a bekezdéseket az időzített feliratsorokhoz sorrendtartó (LCS-alapú) illesztéssel, és a renderer teszi be az időt. Az illesztés bizonytalansága kivétel, nem néma rossz időbélyeg. A normalizálás ezért megőrzi a soronkénti kezdőidőt, a költségbecslő pedig receptenkénti kimeneti arányt és bírószámot kap.

**Tech Stack:** TypeScript (ESM, `.js` importvégződések), Vitest, Zod, Vercel AI SDK LiteLLM mögött, `node:sqlite`. **Nulla új függőség.**

**Spec:** [`docs/plans/2026-09-16-tisztitott-leirat-spec.md`](<./2026-09-16-tisztitott-leirat-spec.md>)

## Global Constraints

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet; angol produkciós azonosító, prompt és gap-üzenet.
- **Nulla új függőség.** Az illesztő és az LCS saját kód.
- Minden teszt hálózat és API-kulcs nélkül fut; modellhívás egyetlen tesztben sincs.
- A mag nem ír konzolra és nem ír fájlt.
- Recept nem kerülhet be a rubrikája nélkül.
- Az importok `.js` végződésűek (ESM), a fájlok a meglévő mappaszerkezetet követik.
- Futtatás: `mise exec -- pnpm vitest run <útvonal>`, teljes ellenőrzés: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`.
- **A `vitest run` nem típusellenőriz** (transzpilál, nem fordít). Ahol egy lépés típushibára számít bukásként, ott a `pnpm typecheck` az ellenőrzés, nem a teszt.
- **Commit-granularitás:** a spec három commit-csoportot írt elő; ez a terv feladatonként commitol (hét commit). A sorrend a spec csoportjait követi: 1–3. feladat = időzítés és becslő, 4–5. = illesztő és kapu, 6–7. = recept és mérés.

---

### Task 1: Időzített deduplikáció

A deduplikáció ma eldobja a cue-k időzítését. Ez a feladat megőrzi, **egyetlen** logikát tartva: a szöveges változat a időzített változat vetülete lesz.

**Files:**
- Modify: `src/types.ts` (a `Cue` után új `TimedLine`, és a `NormalizedTranscript` bővítése)
- Modify: `src/normalize/dedupe.ts:11-22`
- Modify: `src/pipeline.ts:60-83`
- Test: `src/normalize/dedupe.test.ts` (bővítés)
- Test: `src/vault/render.test.ts:17-23` (fixtúra bővítése)

**Interfaces:**
- Consumes: semmit korábbi feladatból.
- Produces: `TimedLine { start: number; text: string }`, `dedupeTimedLines(cues: Cue[]): TimedLine[]`, `NormalizedTranscript.timed: TimedLine[]`. A 3., 4. és 6. feladat ezekre épül.

- [ ] **Step 1: Írd meg a bukó tesztet**

A `src/normalize/dedupe.test.ts` tetején a `cue` segéd ma fix `start: 0`-t ad; bővítsd, hogy időt is lehessen adni, majd add hozzá az új blokkot a `describe('dedupeLines', ...)` **után**:

```ts
import { countWords, dedupeLines, dedupeTimedLines, toParagraphs } from './dedupe.js'

const timedCue = (start: number, lines: string[]): Cue => ({ start, end: start + 1, lines })

describe('dedupeTimedLines', () => {
  it('a megtartott sorhoz az ELSŐ előfordulás kezdetét rendeli', () => {
    const cues = [
      timedCue(10, ['Hey everyone, Brandon Lee here with']),
      timedCue(12, ['Hey everyone, Brandon Lee here with']),
      timedCue(14, ['Hey everyone, Brandon Lee here with', 'Virtualization How To and today']),
    ]
    expect(dedupeTimedLines(cues)).toEqual([
      { start: 10, text: 'Hey everyone, Brandon Lee here with' },
      { start: 14, text: 'Virtualization How To and today' },
    ])
  })

  it('az üres és csak szóközt tartalmazó sorokat kidobja', () => {
    const cues = [timedCue(0, ['alfa']), timedCue(5, ['   ']), timedCue(9, ['béta'])]
    expect(dedupeTimedLines(cues)).toEqual([
      { start: 0, text: 'alfa' },
      { start: 9, text: 'béta' },
    ])
  })

  it('a dedupeLines ennek a vetülete: ugyanaz a szöveg, idő nélkül', () => {
    const cues = [timedCue(0, ['alfa']), timedCue(4, ['béta']), timedCue(8, ['alfa'])]
    expect(dedupeLines(cues)).toEqual(dedupeTimedLines(cues).map((l) => l.text))
    expect(dedupeLines(cues)).toEqual(['alfa', 'béta', 'alfa'])
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/normalize/dedupe.test.ts`
Expected: FAIL — `dedupeTimedLines is not exported` / `is not a function`.

- [ ] **Step 3: Vedd fel a `TimedLine` típust**

A `src/types.ts`-ben, közvetlenül a `Cue` interfész **után**:

```ts
/**
 * Egy megtartott átiratsor a kezdetével. A deduplikáció az ELSŐ előfordulást
 * tartja meg, tehát ez az az időpont, amikor a szöveg először megjelent.
 */
export interface TimedLine {
  /** kezdet másodpercben */
  start: number
  text: string
}
```

Ugyanebben a fájlban a `NormalizedTranscript` kap egy kötelező mezőt:

```ts
export interface NormalizedTranscript {
  lines: string[]
  /** Ugyanaz a szöveg, soronkénti kezdőidővel. A `lines` ennek a vetülete. */
  timed: TimedLine[]
  wordsRaw: number
  wordsNormalized: number
  captionSource: CaptionSource
  punctuationDensity: number
}
```

- [ ] **Step 4: Írd át a deduplikációt**

A `src/normalize/dedupe.ts`-ben a `dedupeLines` helyére:

```ts
import type { Cue, TimedLine } from '../types.js'

/**
 * A cue-kat sorfolyammá lapítja, kiejti az **egymás utáni** ismétlődéseket, és
 * minden megtartott sorhoz az ELSŐ előfordulás kezdetét rendeli.
 *
 * Ez a naiv változat szándékos: valós korpuszon az egymás utáni dedup
 * gyakorlatilag azonos eredményt ad a teljes egyedi-sor deduppal
 * (602 744 vs 602 073 szó), tehát okos algoritmus nem indokolt. A nem egymás
 * utáni ismétlődés megőrzése helyes — az a beszélő valódi ismétlése.
 */
export function dedupeTimedLines(cues: Cue[]): TimedLine[] {
  const out: TimedLine[] = []
  for (const cue of cues) {
    for (const raw of cue.lines) {
      const text = raw.trim()
      if (text === '') continue
      if (out[out.length - 1]?.text === text) continue
      out.push({ start: cue.start, text })
    }
  }
  return out
}

/**
 * A `dedupeTimedLines` szöveges vetülete. Külön függvény, de **nem külön
 * logika**: enélkül két, egymástól elcsúszható deduplikációs szabály lenne.
 */
export function dedupeLines(cues: Cue[]): string[] {
  return dedupeTimedLines(cues).map((line) => line.text)
}
```

A `countWords` és a `toParagraphs` változatlan marad.

- [ ] **Step 5: Futtasd a tesztet**

Run: `mise exec -- pnpm vitest run src/normalize/dedupe.test.ts`
Expected: PASS, a meglévő `dedupeLines` tesztek is.

- [ ] **Step 6: Töltsd ki a `timed` mezőt a csővezetékben**

A `src/pipeline.ts` `normalizeItem` függvényében (a mai 69-82. sor):

```ts
  const rawText = cues.flatMap((c) => c.lines).join(' ')
  const timed = dedupeTimedLines(cues)
  if (timed.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz szöveget')
  }
  const lines = timed.map((line) => line.text)
  const normalizedText = lines.join(' ')

  return {
    lines,
    timed,
    wordsRaw: countWords(rawText),
    wordsNormalized: countWords(normalizedText),
    captionSource: classifyCaptions(normalizedText),
    punctuationDensity: punctuationDensity(normalizedText),
  }
```

Az importsort is írd át: `import { countWords, dedupeTimedLines } from './normalize/dedupe.js'`.

- [ ] **Step 7: Javítsd a fordítási hibát a render tesztben**

A `src/vault/render.test.ts` fixtúrája (17-23. sor) új kötelező mezőt kap:

```ts
const transcript: NormalizedTranscript = {
  lines: ['Első mondat.', 'Második mondat.'],
  timed: [
    { start: 0, text: 'Első mondat.' },
    { start: 7, text: 'Második mondat.' },
  ],
  wordsRaw: 100,
  wordsNormalized: 90,
  captionSource: 'creator',
  punctuationDensity: 4.2,
}
```

- [ ] **Step 8: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS. A `render.ts` és a `cli.ts` egyetlen sort sem változott, mert a `dedupeLines` megmaradt.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/normalize/dedupe.ts src/normalize/dedupe.test.ts src/pipeline.ts src/vault/render.test.ts
git commit -m "feat(normalize): időzített sorok a deduplikációban

- A megtartott sor az első előfordulás kezdetét kapja
- A dedupeLines ennek a vetülete marad, egy logikával

Refs #32"
```

---

### Task 2: Receptenkénti kimeneti arány és bírószám a becslőben

A becslő ma minden receptre a bemenet tizedét feltételezi, és két bírót. A tisztított leiratnál ez 3,1×-es alulbecslés, ami a `decisions/0004` „a plafon fölött el sem indul" garanciáját törné.

**Files:**
- Modify: `src/model/budget.ts:1-126`
- Modify: `src/recipe/types.ts` (a `Recipe` új opcionális mezője)
- Modify: `src/run/plan.ts:61-82`
- Modify: `src/cli.ts:571`
- Test: `src/model/budget.test.ts` (bővítés)

**Interfaces:**
- Consumes: semmit korábbi feladatból.
- Produces: `EstimateShape { outputRatio?: number; judges?: number }`, `estimateItemUsd(words, maxIterations, cfg, shape?)`, `estimateRunUsd(wordCounts, maxIterations, cfg, shape?)`, `BudgetEntry.shape?`, `Recipe.outputRatio?`. A 6. feladat a `Recipe.outputRatio`-t állítja be.

- [ ] **Step 1: Írd meg a bukó tesztet**

Add hozzá a `src/model/budget.test.ts` `describe('estimateItemUsd', ...)` blokkjához:

```ts
  it('a magasabb kimeneti arány drágább', () => {
    const tized = estimateItemUsd(3_000, 0, CFG, { outputRatio: 0.1 })
    const teljes = estimateItemUsd(3_000, 0, CFG, { outputRatio: 1.05 })
    expect(teljes).toBeGreaterThan(tized)
  })

  it('a kevesebb bíró olcsóbb', () => {
    const ketto = estimateItemUsd(3_000, 0, CFG, { judges: 2 })
    const egy = estimateItemUsd(3_000, 0, CFG, { judges: 1 })
    expect(egy).toBeLessThan(ketto)
  })

  it('alak nélkül a mai viselkedést adja', () => {
    expect(estimateItemUsd(3_000, 0, CFG)).toBe(
      estimateItemUsd(3_000, 0, CFG, { outputRatio: 0.1, judges: 2 }),
    )
  })
```

És a `describe('sliceToBudget', ...)` blokkhoz:

```ts
  it('a drágább alakú bejegyzésből kevesebb fér a plafon alá', () => {
    const cfg: ModelConfig = { ...CFG, costLimitUsd: estimateItemUsd(3_000, 0, CFG) * 2.5 }
    const olcso = sliceToBudget(
      [
        { value: 'a', words: 3_000, maxIterations: 0 },
        { value: 'b', words: 3_000, maxIterations: 0 },
      ],
      cfg,
    )
    const draga = sliceToBudget(
      [
        { value: 'a', words: 3_000, maxIterations: 0, shape: { outputRatio: 1.05 } },
        { value: 'b', words: 3_000, maxIterations: 0, shape: { outputRatio: 1.05 } },
      ],
      cfg,
    )
    expect(olcso.planned).toEqual(['a', 'b'])
    expect(draga.planned.length).toBeLessThan(2)
  })
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/model/budget.test.ts`
Expected: FAIL — a negyedik paraméter és a `shape` mező nem létezik (típushiba, illetve a viselkedés azonos marad).

- [ ] **Step 3: Vedd fel az alakot a becslőbe**

A `src/model/budget.ts` elején a konstansok helyére:

```ts
/**
 * A generált kimenet hossza a bemenet arányában, ha a recept nem mond mást.
 * Egy összefoglaló nagyjából a normalizált átirat tizede.
 */
const DEFAULT_OUTPUT_RATIO = 0.1

/** A rubrika modell-bíró kritériumainak száma, ha a hívó nem mond mást. */
const DEFAULT_JUDGES = 2

/**
 * A becslés recept-függő része. Azért külön objektum, mert a két érték
 * együtt jár: egy hosszabb kimenetet dupla áron pontozó bíró kétszer számít.
 */
export interface EstimateShape {
  outputRatio?: number
  judges?: number
}
```

Az `estimateItemUsd` és az `estimateRunUsd` negyedik, opcionális paramétert kap; az alapértelmezések a **mai** értékek, tehát a meglévő hívások változatlanul ugyanazt adják:

```ts
export function estimateItemUsd(
  words: number,
  maxIterations: number,
  cfg: ModelConfig,
  shape: EstimateShape = {},
): number {
  const outputRatio = shape.outputRatio ?? DEFAULT_OUTPUT_RATIO
  const judges = shape.judges ?? DEFAULT_JUDGES

  const transcriptTokens = words * TOKENS_PER_WORD
  const outputTokens = transcriptTokens * outputRatio
  const generations = maxIterations + 1

  const draft = costOf(
    {
      inputTokens: transcriptTokens * generations,
      outputTokens: outputTokens * generations,
    },
    cfg.pricing.draft,
  )

  const judgeCalls = generations * judges
  const judge = costOf(
    {
      inputTokens: (transcriptTokens + outputTokens) * judgeCalls,
      outputTokens: 200 * judgeCalls,
    },
    cfg.pricing.judge,
  )

  return draft + judge
}

export function estimateRunUsd(
  wordCounts: readonly number[],
  maxIterations: number,
  cfg: ModelConfig,
  shape: EstimateShape = {},
): { usd: number; tokens: number } {
  const judges = shape.judges ?? DEFAULT_JUDGES
  let usd = 0
  let tokens = 0
  for (const words of wordCounts) {
    usd += estimateItemUsd(words, maxIterations, cfg, shape)
    tokens += Math.round(
      words * TOKENS_PER_WORD * (maxIterations + 1) * (1 + judges),
    )
  }
  return { usd, tokens }
}
```

- [ ] **Step 4: Vidd át az alakot a bejegyzésen**

Ugyanebben a fájlban a `BudgetEntry` és a `sliceToBudget`:

```ts
export interface BudgetEntry<T> {
  value: T
  words: number
  maxIterations: number
  /** A bejegyzés receptjének becslési alakja. Hiánya a mai alapértelmezés. */
  shape?: EstimateShape
}
```

A `sliceToBudget` ciklusában a két hívás megkapja az alakot:

```ts
    const itemUsd = estimateItemUsd(entry.words, entry.maxIterations, cfg, entry.shape)
    ...
    tokens += estimateRunUsd([entry.words], entry.maxIterations, cfg, entry.shape).tokens
```

- [ ] **Step 5: Futtasd a becslő tesztjét**

Run: `mise exec -- pnpm vitest run src/model/budget.test.ts`
Expected: PASS, a meglévő tesztekkel együtt.

- [ ] **Step 6: Vedd fel a `Recipe.outputRatio` mezőt**

A `src/recipe/types.ts` `Recipe` interfészében, a `maxIterations` után:

```ts
  /**
   * A kimenet várható hossza a bemenet arányában, a költségbecsléshez.
   * Hiánya a becslő alapértelmezését (0,1) hagyja érvényben. A tisztított
   * leirat kimenete nagyjából akkora, mint a bemenet — enélkül a becslés
   * többszörösen alábecsülne, és a plafon nem tartaná meg a kötegét.
   */
  outputRatio?: number
```

- [ ] **Step 7: Töltsd ki az alakot a tervezőben és a CLI-ben**

A `src/run/plan.ts` `estimateUnits` ciklusában a bejegyzés:

```ts
    entries.push({
      value: unit,
      words: count,
      maxIterations: unit.recipe.maxIterations,
      shape: {
        outputRatio: unit.recipe.outputRatio,
        // A bírók számát a rubrikából vesszük, nem külön mezőből: így egy
        // recept nem tud hazudni a saját költségéről.
        judges: unit.recipe.rubric.criteria.filter((c) => !c.blocking).length,
      },
    })
```

A `src/cli.ts:571` hívása az első bejegyzés alakját is átadja:

```ts
        const firstUsd = estimateItemUsd(
          first.words,
          first.maxIterations,
          model.modelConfig,
          first.shape,
        )
```

- [ ] **Step 8: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS. A `plan.test.ts` meglévő állításai változatlanul teljesülnek, mert a mai receptek nem adnak meg `outputRatio`-t, és két nem blokkoló kritériumuk van.

- [ ] **Step 9: Commit**

```bash
git add src/model/budget.ts src/model/budget.test.ts src/recipe/types.ts src/run/plan.ts src/cli.ts
git commit -m "feat(budget): receptenkénti kimeneti arány és bírószám

- A becslés alakja a receptből jön, a bírók száma a rubrikából
- Alapértelmezései a maiak, tehát a meglévő receptek becslése változatlan

Refs #32"
```

---

### Task 3: A `postprocess` varrat

A generált szöveget a pontozás **előtt** kell időbélyegezni, különben a bíró mást olvasna, mint ami a vaultba kerül. Ez a feladat csak a varratot teszi be; az illesztő a 4. feladat.

**Files:**
- Modify: `src/recipe/types.ts` (`RecipeInput.timed`, `Recipe.postprocess`)
- Modify: `src/refine/loop.ts:76-82`
- Modify: `src/pipeline.ts:132`
- Test: `src/refine/loop.test.ts` (bővítés és fixtúra)
- Modify: `src/recipe/summary.test.ts:16`, `src/recipe/qa.test.ts:16`, `src/recipe/rules.test.ts:32`, `src/recipe/flashcards.test.ts:169,178,183-188,195-200`
- Modify: `evals/summary.eval.ts:36-45`, `evals/measure/run.ts:100-104,219-224`

**Interfaces:**
- Consumes: `TimedLine` (1. feladat).
- Produces: `RecipeInput.timed: readonly TimedLine[]` (kötelező), `Recipe.postprocess?(output: string, input: RecipeInput): string`. A 6. feladat receptje ezt használja.

- [ ] **Step 1: Írd meg a bukó tesztet**

A `src/refine/loop.test.ts`-ben a fixtúra bővül, és új teszt kerül a fájl végi `describe` blokkba:

```ts
const INPUT = { item: ITEM, transcript: 'az átirat', timed: [{ start: 0, text: 'az átirat' }] }
```

```ts
  it('a postprocess a pontozás ELŐTT fut, és a javító kör is rajta megy át', async () => {
    const { client, generalt } = scriptedClient([
      { text: 'első', score: 0 },
      { text: 'második', score: 0 },
    ])
    // A rubrika a MÁR feldolgozott szöveget látja, ezért a pontszámok kulcsai
    // az időbélyeges alakok. A `scriptedClient` saját `pontszamok` térképét
    // szándékosan nem használjuk: az a nyers szöveghez rendelne pontot.
    const pontszamok = new Map([
      ['[00:00] első', 0.5],
      ['[00:00] második', 0.9],
    ])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok), 1),
      postprocess: (output) => `[00:00] ${output}`,
    }

    const result = await refine(recipe, INPUT, client, {})

    expect(generalt).toEqual(['első', 'második'])
    expect(result.output).toBe('[00:00] második')
    expect(result.score).toBe(0.9)
  })
```

> A `recept(criteria, maxIterations)` és a `tablazatosRubrika(pontszamok)` a `loop.test.ts`-ben már meglévő segédek (a fájl 53. és 68. sora); a `Recipe` típus importálva van.

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/refine/loop.test.ts`
Expected: FAIL — a `postprocess` mező nem létezik a `Recipe` típuson.

- [ ] **Step 3: Vedd fel a két mezőt**

A `src/recipe/types.ts`-ben:

```ts
import type { TimedLine } from '../types.js'

export interface RecipeInput {
  item: SourceItem
  /** A normalizált átirat teljes szövege. */
  transcript: string
  /** Ugyanaz, soronkénti kezdőidővel. Az időbélyegző receptek alapja. */
  timed: readonly TimedLine[]
}
```

A `Recipe` interfészben, a `structured` után:

```ts
  /**
   * Ha jelen van, a generált szöveg ezen megy át, **mielőtt** a rubrika
   * pontozná. Így a bíró, a javító kör és a publikálás ugyanazt a szöveget
   * látja. Dobhat: a feldolgozhatatlan kimenet `item:failed` lesz, nem néma
   * hiba — ugyanaz a precedens, mint a séma-hibánál (`structured.ts`).
   */
  postprocess?(output: string, input: RecipeInput): string
```

- [ ] **Step 4: Hívd meg a loopban**

A `src/refine/loop.ts` `generate` segédje (a mai 78-81. sor):

```ts
  const generate = async (prompt: string): Promise<ModelResult<string>> => {
    const raw = recipe.structured
      ? await recipe.structured.generate(client, recipe.role, prompt)
      : await client.generate(recipe.role, prompt)
    if (!recipe.postprocess) return raw
    return { value: recipe.postprocess(raw.value, input), usage: raw.usage }
  }
```

A hívási helyek (`await generate(...)`) változatlanok.

- [ ] **Step 5: Futtasd a loop tesztjét**

Run: `mise exec -- pnpm vitest run src/refine/loop.test.ts`
Expected: PASS.

- [ ] **Step 6: Töltsd ki a `timed` mezőt a csővezetékben és a fixtúrákban**

`src/pipeline.ts:132`:

```ts
  const result = await refine(recipe, { item, transcript: text, timed: transcript.timed }, client, {
```

A recept-tesztekben a `timed` üres tömbként elég, mert ezek a receptek nem használják:

- `src/recipe/summary.test.ts:16` és `src/recipe/qa.test.ts:16`:
  ```ts
  const INPUT = { item: ITEM, transcript: 'The speaker explains A, then B.', timed: [] }
  ```
- `src/recipe/rules.test.ts:32`:
  ```ts
    const prompt = summaryRecipe.prompt({ item: ITEM, transcript: 'A, majd B.', timed: [] })
  ```
- `src/recipe/flashcards.test.ts` mind a négy helye (169, 178, és a két `repairPrompt` hívás objektuma) ugyanígy kap egy `timed: []` mezőt.

- [ ] **Step 7: Töltsd ki a `timed` mezőt az evalekben**

`evals/summary.eval.ts` `task` függvényében:

```ts
    const cues = parseSubtitle(fixture.srt, `${fixture.id}.srt`)
    const timed = dedupeTimedLines(cues)
    const transcript = timed.map((l) => l.text).join(' ')

    const result = await refine(
      summaryRecipe,
      { item: itemOf(fixture), transcript, timed },
      fixtureClient(fixture),
    )
```

Az importsor: `import { dedupeTimedLines } from '../src/normalize/dedupe.js'`.

`evals/measure/run.ts`-ben a térkép és a hívás:

```ts
const transcripts = new Map<string, { item: SourceItem; transcript: string; timed: TimedLine[] }>()
...
    transcripts.set(item.itemId, {
      item,
      transcript: normalized.lines.join(' '),
      timed: normalized.timed,
    })
```

```ts
        const result = await refine(
          recipe,
          { item: entry.item, transcript: entry.transcript, timed: entry.timed },
          client,
          { stopEarly: false },
        )
```

A `TimedLine` típust importáld: `import type { SourceItem, TimedLine } from '../../src/types.js'` (a meglévő `SourceItem` import bővítésével).

- [ ] **Step 8: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS. A `summary` promptja bájtra változatlan, tehát a `rules.test.ts` regressziós horgonya is átmegy.

- [ ] **Step 9: Commit**

```bash
git add src/recipe/types.ts src/refine/loop.ts src/pipeline.ts src/refine/loop.test.ts src/recipe/*.test.ts evals/summary.eval.ts evals/measure/run.ts
git commit -m "feat(recipe): postprocess varrat a prózaúton

- A generált szöveg a pontozás előtt megy át a feldolgozáson
- A RecipeInput viszi az időzített sorokat, kötelező mezőként

Refs #32"
```

---

### Task 4: Az illesztő

Ez a feladat teszi be a bekezdések elé az időbélyeget, sorrendtartó illesztéssel. A mért pontosság a valós korpuszon 93,0% pontosan 0 mp, 99,6% öt másodpercen belül.

**Files:**
- Create: `src/normalize/tokens.ts`
- Create: `src/recipe/anchor.ts`
- Test: `src/recipe/anchor.test.ts`

**Interfaces:**
- Consumes: `TimedLine` (1. feladat).
- Produces: `tokenize(text: string): string[]` (a `tokens.ts`-ből, az 5. feladat is használja), `anchorParagraphs(output: string, timed: readonly TimedLine[]): string`, `formatTimestamp(seconds: number): string`, `AnchorError`. A 6. feladat receptje az `anchorParagraphs`-t hívja.

- [ ] **Step 1: Írd meg a bukó tesztet**

Hozd létre a `src/recipe/anchor.test.ts` fájlt:

```ts
import { describe, expect, it } from 'vitest'
import type { TimedLine } from '../types.js'
import { anchorParagraphs, formatTimestamp } from './anchor.js'

/** Nyolc szavas sorok, két másodpercenként — a valós korpusz alakja. */
const TIMED: TimedLine[] = [
  { start: 0, text: 'Hey everyone welcome back to the channel today' },
  { start: 2, text: 'we are going to talk about container storage' },
  { start: 4, text: 'and why it matters for your home lab' },
  { start: 64, text: 'the second thing I want to cover is' },
  { start: 66, text: 'backups because nobody thinks about them until' },
  { start: 68, text: 'the disk finally dies on a Sunday night' },
]

describe('formatTimestamp', () => {
  it('egy óra alatt percet és másodpercet ad', () => {
    expect(formatTimestamp(0)).toBe('[00:00]')
    expect(formatTimestamp(64)).toBe('[01:04]')
    expect(formatTimestamp(3599)).toBe('[59:59]')
  })

  it('egy órán túl órát is ad', () => {
    expect(formatTimestamp(3600)).toBe('[1:00:00]')
    expect(formatTimestamp(3920)).toBe('[1:05:20]')
  })
})

describe('anchorParagraphs', () => {
  it('a bekezdés elé a valódi kezdőidőt teszi', () => {
    const output = [
      'Hey everyone, welcome back to the channel. Today we are going to talk',
      'about container storage and why it matters for your home lab.',
      '',
      'The second thing I want to cover is backups, because nobody thinks about',
      'them until the disk finally dies on a Sunday night.',
    ].join('\n')

    const result = anchorParagraphs(output, TIMED)

    expect(result).toContain('[00:00] Hey everyone, welcome back')
    expect(result).toContain('[01:04] The second thing I want to cover')
  })

  it('a fejlécet változatlanul hagyja, időbélyeg nélkül', () => {
    const output = [
      '## Storage',
      '',
      'Hey everyone, welcome back to the channel. Today we are going to talk',
      'about container storage.',
    ].join('\n')

    const result = anchorParagraphs(output, TIMED)

    expect(result).toContain('## Storage')
    expect(result).not.toContain('[00:00] ## Storage')
    expect(result).toContain('[00:00] Hey everyone')
  })

  it('az enyhe szerkesztést elviseli: írásjel, nagybetű, kiesett töltelékszó', () => {
    const output = 'Welcome back to the channel — today we talk about container storage.'
    const result = anchorParagraphs(output, TIMED)
    expect(result.startsWith('[00:00] ')).toBe(true)
  })

  it('horgonyozhatatlan bekezdésnél dob, a bekezdés elejét megnevezve', () => {
    const output = 'Completely unrelated sentence about quantum chromodynamics and nothing else.'
    expect(() => anchorParagraphs(output, TIMED)).toThrow(/nem horgonyozható/)
  })

  it('a túl rövid bekezdésnél dob, mert nem lehet magabiztosan illeszteni', () => {
    const output = 'Right.'
    expect(() => anchorParagraphs(output, TIMED)).toThrow(/túl rövid/)
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/recipe/anchor.test.ts`
Expected: FAIL — `Cannot find module './anchor.js'`.

- [ ] **Step 3: Írd meg a tokenizálót**

Hozd létre a `src/normalize/tokens.ts` fájlt:

```ts
/**
 * Szavakra bontás összehasonlításhoz: kisbetűsítés, és minden, ami nem betű
 * vagy szám, elválasztó. Az írásjel így nem számít különbségnek — pontosan ez
 * kell, mert az enyhe szerkesztés főleg írásjelet tesz a szövegbe.
 *
 * A `\p{L}` és `\p{N}` — nem `\w` —, mert a `\w` az `u` jelölő mellett is csak
 * ASCII-betűt fed le, az ékezetes betűket elválasztónak vennénk.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}
```

- [ ] **Step 4: Írd meg az illesztőt**

Hozd létre a `src/recipe/anchor.ts` fájlt:

```ts
import { tokenize } from '../normalize/tokens.js'
import type { TimedLine } from '../types.js'

/** A bekezdés elejéből ennyi szót keresünk vissza. */
const PROBE_LENGTH = 12

/** Ennél rövidebb bekezdést nem lehet magabiztosan illeszteni. */
const MIN_PROBE_LENGTH = 4

/**
 * Előre tekintő ablak szóban. A mért bekezdéshossz 50–85 szó, tehát ez
 * nagyjából hat bekezdésnyi: egy elrontott illesztés után a következő még
 * visszatalál, egy távoli véletlen egyezés viszont kívül esik.
 */
const WINDOW_WORDS = 500

/**
 * Elfogadási küszöbök. **Becsült kezdőértékek, nem mértek** — a kalibrálásuk
 * valós modellhívásokat igényel, és külön körben történik (lásd a specet).
 */
const MIN_SCORE = 0.75
const MIN_MARGIN = 0.1

/** Legalább ennyi szóval távolabbi jelölt számít versenytársnak a fölényhez. */
const RIVAL_DISTANCE = 8

const HEADING = /^ {0,3}#{1,6} /

/** Egy szó és a sor, ahonnan származik. */
interface Word {
  text: string
  line: number
}

export class AnchorError extends Error {}

/**
 * Sorrendtartó egyezés aránya: a leghosszabb közös részsorozat hossza a próba
 * hosszához mérve. A puszta szóhalmaz-egyezés nem lenne elég — az ismétlődő
 * fordulatok miatt a rossz jelölt is magas pontot kapna.
 */
export function lcsRatio(probe: readonly string[], hay: readonly string[]): number {
  if (probe.length === 0) return 0
  let prev = new Array<number>(hay.length + 1).fill(0)
  let cur = new Array<number>(hay.length + 1).fill(0)
  for (let i = 1; i <= probe.length; i++) {
    for (let j = 1; j <= hay.length; j++) {
      cur[j] =
        probe[i - 1] === hay[j - 1]
          ? prev[j - 1]! + 1
          : Math.max(prev[j]!, cur[j - 1]!)
    }
    const swap = prev
    prev = cur
    cur = swap
    cur.fill(0)
  }
  return prev[hay.length]! / probe.length
}

function wordStream(timed: readonly TimedLine[]): Word[] {
  const words: Word[] = []
  timed.forEach((line, index) => {
    for (const text of tokenize(line.text)) words.push({ text, line: index })
  })
  return words
}

/**
 * A próba helye a szófolyamban, a kurzortól előrefelé.
 *
 * A jelöltek azok a pozíciók, ahol a szó a próba első **vagy második**
 * tokenjével egyezik: az enyhe szerkesztés kiejthet egy vezető töltelékszót.
 */
function locate(
  words: readonly Word[],
  from: number,
  probe: readonly string[],
): { index: number; score: number; margin: number } {
  const end = Math.min(words.length, from + WINDOW_WORDS)
  const candidates: number[] = []
  for (let p = from; p < end; p++) {
    if (words[p]!.text === probe[0] || words[p]!.text === probe[1]) candidates.push(p)
  }
  if (candidates.length === 0) {
    for (let p = from; p < end; p += 3) candidates.push(p)
  }

  let best = { index: from, score: -1 }
  let rival = 0
  for (const p of candidates) {
    const hay = words.slice(p, p + probe.length + 6).map((w) => w.text)
    const score = lcsRatio(probe, hay)
    if (score > best.score) {
      if (Math.abs(p - best.index) > RIVAL_DISTANCE) rival = Math.max(rival, best.score)
      best = { index: p, score }
    } else if (score > rival && Math.abs(p - best.index) > RIVAL_DISTANCE) {
      rival = score
    }
  }
  return { ...best, margin: best.score - Math.max(rival, 0) }
}

/** Másodperc → `[MM:SS]`, egy órán túl `[H:MM:SS]`. */
export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `[${String(hours)}:${pad(minutes)}:${pad(secs)}]`
    : `[${pad(minutes)}:${pad(secs)}]`
}

/**
 * A modell prózája → ugyanaz, bekezdésenként időbélyeggel.
 *
 * A fejlécek változatlanul mennek át. A bizonytalan illesztés **dob**: egy
 * rossz időbélyeg némán hibás jegyzetet adna, ami rosszabb, mint a hangos
 * bukás. A hívó (`pipeline.runRecipe`) ebből `item:failed`-et csinál.
 */
/**
 * Egy bekezdés horgonyzása: a feldolgozott szöveg és az új kurzorpozíció.
 *
 * A kurzort **visszaadja**, nem mellékhatásként állítja: így az
 * `anchorParagraphs` az egyetlen hely, ahol a haladás állapota él.
 */
function anchorOne(
  paragraph: string,
  words: readonly Word[],
  timed: readonly TimedLine[],
  cursor: number,
): { text: string; cursor: number } {
  const probe = tokenize(paragraph).slice(0, PROBE_LENGTH)
  if (probe.length < MIN_PROBE_LENGTH) {
    throw new AnchorError(
      `a bekezdés túl rövid a horgonyzáshoz: "${paragraph.slice(0, 40)}"`,
    )
  }

  const hit = locate(words, cursor, probe)
  if (hit.score < MIN_SCORE || hit.margin < MIN_MARGIN) {
    throw new AnchorError(
      `a bekezdés nem horgonyozható magabiztosan (egyezés ${hit.score.toFixed(2)}, ` +
        `fölény ${hit.margin.toFixed(2)}): "${paragraph.slice(0, 40)}"`,
    )
  }

  const start = timed[words[hit.index]!.line]!.start
  return { text: `${formatTimestamp(start)} ${paragraph}`, cursor: hit.index }
}

/**
 * A modell prózája → ugyanaz, bekezdésenként időbélyeggel.
 *
 * A fejlécek változatlanul mennek át. A bizonytalan illesztés **dob**: egy
 * rossz időbélyeg némán hibás jegyzetet adna, ami rosszabb, mint a hangos
 * bukás. A hívó (`pipeline.runRecipe`) ebből `item:failed`-et csinál.
 */
export function anchorParagraphs(output: string, timed: readonly TimedLine[]): string {
  const words = wordStream(timed)
  const out: string[] = []
  let cursor = 0

  for (const block of output.split(/\n{2,}/)) {
    const trimmed = block.trim()
    if (trimmed === '') continue

    let paragraph = trimmed
    if (HEADING.test(trimmed)) {
      const [heading, ...rest] = trimmed.split('\n')
      out.push(heading!)
      paragraph = rest.join('\n').trim()
      if (paragraph === '') continue
    }

    const anchored = anchorOne(paragraph, words, timed, cursor)
    out.push(anchored.text)
    cursor = anchored.cursor
  }

  return out.join('\n\n')
}
```

- [ ] **Step 5: Futtasd a teszteket**

Run: `mise exec -- pnpm vitest run src/recipe/anchor.test.ts`
Expected: PASS mind a hat teszt.

- [ ] **Step 6: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/normalize/tokens.ts src/recipe/anchor.ts src/recipe/anchor.test.ts
git commit -m "feat(recipe): bekezdés-horgonyzás időbélyeggel

- Sorrendtartó illesztés a feliratsorokhoz, előre tekintő ablakban
- A bizonytalan illesztés dob, hogy ne néma rossz időbélyeg legyen

Refs #32"
```

---

### Task 5: A hűségkapu

Ez fogja meg a recept legvalószínűbb hibamódját: hogy a modell tisztítás helyett összefoglal.

**Files:**
- Create: `src/rubric/fidelity.ts`
- Test: `src/rubric/fidelity.test.ts`

**Interfaces:**
- Consumes: `tokenize` (4. feladat, `src/normalize/tokens.ts`), `Score` és `Criterion` (`src/rubric/types.ts`).
- Produces: `checkFidelity(output: string, transcript: string): Score`, `fidelityCriterion: Criterion`. A 6. feladat rubrikája ezt használja.

- [ ] **Step 1: Írd meg a bukó tesztet**

Hozd létre a `src/rubric/fidelity.test.ts` fájlt:

```ts
import { describe, expect, it } from 'vitest'
import { checkFidelity, fidelityCriterion } from './fidelity.js'

const TRANSCRIPT = [
  'so today we are going to talk about container storage',
  'and why it matters a lot for your home lab setup',
  'the first thing to understand is that volumes outlive containers',
  'which means your data survives a restart or an upgrade',
].join(' ')

describe('checkFidelity', () => {
  it('az enyhén szerkesztett leiratot elfogadja', () => {
    const output = [
      'So today we are going to talk about container storage, and why it matters',
      'a lot for your home lab setup.',
      '',
      'The first thing to understand is that volumes outlive containers, which',
      'means your data survives a restart or an upgrade.',
    ].join('\n')

    const result = checkFidelity(output, TRANSCRIPT)
    expect(result.value).toBe(1)
    expect(result.gaps).toEqual([])
  })

  it('az összefoglalót elutasítja, és megnevezi az arányt', () => {
    const output = 'The speaker explains that container volumes outlive containers.'
    const result = checkFidelity(output, TRANSCRIPT)
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/0\.\d+/)
    expect(result.gaps.join(' ')).toMatch(/shorter|summar/i)
  })

  it('a tartalmát lecserélő, de hasonló hosszú kimenetet elutasítja', () => {
    const output = TRANSCRIPT.split(' ').map(() => 'lorem').join(' ')
    const result = checkFidelity(output, TRANSCRIPT)
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/cover/i)
  })

  it('az üres átiratra nem oszt nullával', () => {
    expect(checkFidelity('bármi', '').value).toBe(1)
  })
})

describe('fidelityCriterion', () => {
  it('blokkoló kapu', () => {
    expect(fidelityCriterion.blocking).toBe(true)
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/rubric/fidelity.test.ts`
Expected: FAIL — `Cannot find module './fidelity.js'`.

- [ ] **Step 3: Írd meg a kaput**

Hozd létre a `src/rubric/fidelity.ts` fájlt:

```ts
import { tokenize } from '../normalize/tokens.js'
import type { Criterion, Score } from './types.js'

/**
 * A kimenet nem lehet lényegesen rövidebb a forrásnál: az enyhe szerkesztés
 * keveset vesz el. **Becsült küszöb, nem mért** — a kalibrálás külön kör.
 */
const MIN_WORD_RATIO = 0.85

/** A forrás tokenjeinek ekkora részét vissza kell látnunk a kimenetben. */
const MIN_COVERAGE = 0.8

/**
 * Determinisztikus szöveghűség-ellenőrzés: nulla token.
 *
 * Azt a hibamódot fogja meg, ami a tisztított leiratnál a legvalószínűbb:
 * hogy a modell **összefoglal, ahelyett hogy tisztítana**. A lefedettséget
 * multihalmaz-metszettel számoljuk, nem sorrendtartóan: egy 30 ezer tokenes
 * kimeneten az LCS nagyságrendileg milliárd művelet lenne, kapuként
 * futtathatatlan — a sorrendet amúgy is az illesztő monotonitása őrzi.
 *
 * A hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFidelity(output: string, transcript: string): Score {
  const source = tokenize(transcript)
  const result = tokenize(output)
  if (source.length === 0) return { value: 1, gaps: [] }

  const gaps: string[] = []

  const ratio = result.length / source.length
  if (ratio < MIN_WORD_RATIO) {
    gaps.push(
      `The output is ${ratio.toFixed(2)}× the length of the transcript. This is a ` +
        `cleanup task, not a summary: keep every sentence, and only fix punctuation, ` +
        `capitalisation and obvious mishearings.`,
    )
  }

  const counts = new Map<string, number>()
  for (const word of result) counts.set(word, (counts.get(word) ?? 0) + 1)
  let matched = 0
  for (const word of source) {
    const left = counts.get(word) ?? 0
    if (left > 0) {
      counts.set(word, left - 1)
      matched++
    }
  }
  const coverage = matched / source.length
  if (coverage < MIN_COVERAGE) {
    gaps.push(
      `The output only covers ${coverage.toFixed(2)} of the transcript's words. Do not ` +
        `drop or rewrite passages: reproduce the speech, cleaned up.`,
    )
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívás el sem indul. */
export const fidelityCriterion: Criterion = {
  name: 'fidelity',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFidelity(ctx.output, ctx.transcript)),
}
```

- [ ] **Step 4: Futtasd a teszteket**

Run: `mise exec -- pnpm vitest run src/rubric/fidelity.test.ts`
Expected: PASS mind az öt teszt.

- [ ] **Step 5: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/rubric/fidelity.ts src/rubric/fidelity.test.ts
git commit -m "feat(rubric): determinisztikus szöveghűség-kapu

- Szóarány és multihalmaz-lefedettség, nulla tokenből
- Az összefoglaló kimenetet megállítja, mielőtt bíró indulna

Refs #32"
```

---

### Task 6: A `clean` recept

**Files:**
- Create: `src/recipe/clean.ts`
- Test: `src/recipe/clean.test.ts`
- Modify: `src/recipe/registry.ts:1-18`
- Modify: `src/recipe/registry.test.ts:27` (a tételes azonosítólista)
- Modify: `web/app/utils/format.ts:1-6`

**Interfaces:**
- Consumes: `anchorParagraphs` (4. feladat), `fidelityCriterion` (5. feladat), `Recipe.postprocess` és `outputRatio` (2–3. feladat), `languageRule`/`RULE` (`src/recipe/rules.js`), `formatCriterion`, `languageCriterion`, `judgeCriterion`.
- Produces: `cleanRecipe: Recipe` a registryben `clean` néven.

- [ ] **Step 1: Írd meg a bukó tesztet**

Hozd létre a `src/recipe/clean.test.ts` fájlt:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { cleanRecipe } from './clean.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Csatorna/Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Csatorna' },
}

const TIMED = [
  { start: 0, text: 'so today we are going to talk about storage' },
  { start: 3, text: 'and why it matters for your home lab setup' },
]
const INPUT = {
  item: ITEM,
  transcript: TIMED.map((l) => l.text).join(' '),
  timed: TIMED,
}

describe('cleanRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(cleanRecipe.id).toBe('clean')
    expect(cleanRecipe.outputFile).toBe('_clean.md')
  })

  it('a kimeneti aránya a bemenet körül van, nem a tizedénél', () => {
    expect(cleanRecipe.outputRatio).toBeGreaterThan(1)
  })

  it('pontosan egy modell-bíró pontoz', () => {
    const judges = cleanRecipe.rubric.criteria.filter((c) => !c.blocking)
    expect(judges).toHaveLength(1)
  })

  it('a prompt megtiltja az összefoglalást és az időbélyeg írását', () => {
    const prompt = cleanRecipe.prompt(INPUT)
    expect(prompt).toContain('Do not summarise')
    expect(prompt).toContain('Do not write timestamps')
    expect(prompt).toContain(INPUT.transcript)
  })

  it('a postprocess időbélyeget tesz a bekezdés elé', () => {
    const output = 'So today we are going to talk about storage and why it matters.'
    expect(cleanRecipe.postprocess?.(output, INPUT)).toBe(
      '[00:00] So today we are going to talk about storage and why it matters.',
    )
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/recipe/clean.test.ts`
Expected: FAIL — `Cannot find module './clean.js'`.

- [ ] **Step 3: Írd meg a receptet**

Hozd létre a `src/recipe/clean.ts` fájlt:

```ts
import { formatCriterion } from '../rubric/format.js'
import { fidelityCriterion } from '../rubric/fidelity.js'
import { judgeCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { anchorParagraphs } from './anchor.js'
import { languageRule, RULE } from './rules.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító körnek
 * ugyanazokat a megkötéseket kell betartania.
 *
 * A hangsúly az **enyhe** szinten van: ez a recept nem jegyzetet ír, hanem
 * ugyanazt a beszédet adja vissza olvashatóan.
 */
const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    RULE.traceable,
    '- This is a cleanup task. Reproduce the speech in full: fix punctuation,',
    '  capitalisation and obvious mishearings, and nothing else.',
    '- Do not summarise, shorten, reorder or paraphrase. Keep filler words.',
    '- Start a new paragraph when the topic shifts; add a `##` heading at larger',
    '  shifts. The heading must follow from the speech below it.',
    '- Do not write timestamps. They are added separately.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')

/**
 * A tisztításra szabott hűség-bíró. A megfogalmazás szándékosan más, mint az
 * általános `faithfulnessCriterion`-é: itt nem kitalált állítást keresünk — a
 * jegyzet maga az átirat —, hanem azt, hogy a tisztítás megváltoztatta-e
 * valahol az értelmet.
 */
const cleaningFaithfulness = judgeCriterion({
  name: 'cleaning-faithfulness',
  instruction: [
    'You are grading a cleaned-up transcript against the raw transcript it was',
    'made from. The cleaned version should say the same things, only readable:',
    'punctuation, capitalisation and obvious speech-to-text errors fixed.',
    '',
    'Return a score between 0 and 1, where 1 means the meaning is unchanged',
    'everywhere. Report as a gap every place where the cleanup changed what was',
    'said, dropped a passage, or added something that was not spoken. Section',
    'headings are allowed, but each must follow from the speech underneath it;',
    'a heading that introduces a claim of its own is a gap.',
  ].join('\n'),
})

/**
 * Tisztított leirat a normalizált átiratból, bekezdésenkénti időbélyeggel.
 *
 * A modell prózát ír, időbélyeg nélkül; az időt a `postprocess` teszi bele,
 * a feliratfájl időzítéséből. Így az időbélyeg **nem a modell írása**, tehát
 * nem tud elcsúszni vagy kitalált lenni.
 */
export const cleanRecipe: Recipe = {
  id: 'clean',
  outputFile: '_clean.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  // A kimenet nagyjából akkora, mint a bemenet; a mért korpuszon 1,05×.
  outputRatio: 1.05,

  postprocess: (output, input) => anchorParagraphs(output, input.timed),

  prompt: ({ item, transcript }) =>
    [
      'Clean up the transcript of the video below so that it reads well.',
      '',
      'Rules:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the cleaned-up transcript below. A reviewer scored it against the raw',
      'transcript and listed concrete gaps. Fix every gap. Keep what already works —',
      'do not rewrite the text wholesale.',
      '',
      'The original rules still apply:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT TEXT ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [formatCriterion, languageCriterion, fidelityCriterion, cleaningFaithfulness],
    // Egyetlen pontozó kritérium van, tehát a küszöb közvetlenül a bíró
    // ítéletére vonatkozik. A kapuk nem pontoznak, csak átengednek.
    passThreshold: 0.8,
  },
}
```

- [ ] **Step 4: Futtasd a recept tesztjét**

Run: `mise exec -- pnpm vitest run src/recipe/clean.test.ts`
Expected: PASS mind az öt teszt.

- [ ] **Step 5: Vedd fel a registrybe és a felület címkéi közé**

`src/recipe/registry.ts`:

```ts
import { cleanRecipe } from './clean.js'
import { flashcardsRecipe } from './flashcards.js'
import { qaRecipe } from './qa.js'
import { summaryRecipe } from './summary.js'
import type { Recipe } from './types.js'

export const RECIPES: Record<string, Recipe> = {
  [summaryRecipe.id]: summaryRecipe,
  [flashcardsRecipe.id]: flashcardsRecipe,
  [qaRecipe.id]: qaRecipe,
  [cleanRecipe.id]: cleanRecipe,
}
```

A `src/recipe/registry.test.ts` **tételesen felsorolja** az azonosítókat (27. sor), ezért ez kötelező módosítás:

```ts
  it('a receptek azonosítói a regisztráció sorrendjében állnak', () => {
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa', 'clean'])
  })
```

`web/app/utils/format.ts`:

```ts
const KIND_LABELS: Record<string, string> = {
  transcript: 'átirat',
  summary: 'összefoglaló',
  flashcards: 'tanulókártya',
  qa: 'kérdés-felelet',
  clean: 'tisztított leirat',
}
```

- [ ] **Step 6: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS, beleértve a `registry.test.ts` frissített azonosítólistáját.

- [ ] **Step 7: Ellenőrizd a becslést modellhívás nélkül**

A `refinery` bin a `dist/cli.js`, tehát előbb fordítani kell:

Run: `mise exec -- pnpm build && mise exec -- node dist/cli.js run --recipe clean --limit 1`
Expected: a `Becslés:` sor egy elemre a **$0,07 körüli** nagyságrendet mutat, nem $0,02-t.

> **Ez a parancs valódi pénzt költ**, ha hagyod végigfutni: a becslés kiírása után modellhívás következik. A becslés ellenőrzéséhez szakítsd meg (Ctrl+C) közvetlenül a `Becslés:` sor után. A `--dry-run` **nem** véd meg: az csak a fájlírást hagyja ki, a modellhívást nem.

- [ ] **Step 8: Commit**

```bash
git add src/recipe/clean.ts src/recipe/clean.test.ts src/recipe/registry.ts src/recipe/registry.test.ts web/app/utils/format.ts
git commit -m "feat(recipe): tisztított leirat recept

- Enyhe szerkesztés, bekezdésenkénti időbélyeg a felirat időzítéséből
- Egy modell-bíró pontoz; a lefedettség kimarad, teljes leiraton nem mér

Refs #32"
```

---

### Task 7: Eval a szintetikus fixture-ökön

A projekt szabálya: recept nem kerülhet be a rubrikája nélkül, és a mérés egy friss klónon, kulcs nélkül is lefut.

**Files:**
- Create: `evals/clean.eval.ts`
- Modify: `evals/fixture-model.ts:31-46` (felülbírálható rögzített válaszok)

**Interfaces:**
- Consumes: `cleanRecipe` (6. feladat), `dedupeTimedLines` (1. feladat), `fixtureClient` és `PUBLIC_FIXTURES` (`evals/fixture-model.js`, `evals/fixtures/transcripts.js`), `checkFidelity` (5. feladat).
- Produces: `FixtureScript { notes?: string[]; verdicts?: { score: number; gaps: string[] }[] }` és a bővített `fixtureClient(fixture, script?)`.

**Miért kell a fixture-klienst bővíteni:** a `Fixture.verdicts` mezőt a `summary` **generálásonként kettesével** fogyasztja (előbb hűség, aztán lefedettség), a `clean` rubrikájában viszont egyetlen bíró van. A `Fixture.notes` ráadásul összefoglaló alakú jegyzeteket tartalmaz, amiket a blokkoló szöveghűség-kapu megbuktatna — így az eval nulla információt adna.

- [ ] **Step 1: Tedd felülbírálhatóvá a fixture-kliens válaszait**

Az `evals/fixture-model.ts` `fixtureClient` függvénye opcionális második paramétert kap. Alapértelmezés szerint a fixture saját válaszait adja, tehát az `evals/summary.eval.ts` **egyetlen sort sem változik**:

```ts
/** A fixture rögzített válaszainak felülbírálása, receptenként. */
export interface FixtureScript {
  notes?: string[]
  verdicts?: { score: number; gaps: string[] }[]
}

export function fixtureClient(fixture: Fixture, script: FixtureScript = {}): ModelClient {
  const notes = script.notes ?? fixture.notes
  const verdicts = script.verdicts ?? fixture.verdicts
  let draft = 0
  let judge = 0
  return modelClientFrom({
    draft: cannedModel(() => {
      const note = notes[Math.min(draft, notes.length - 1)]
      draft++
      return note ?? ''
    }),
    judge: cannedModel(() => {
      const verdict = verdicts[Math.min(judge, verdicts.length - 1)]
      judge++
      return JSON.stringify(verdict ?? { score: 0, gaps: ['no verdict in fixture'] })
    }),
  })
}
```

- [ ] **Step 2: Írd meg az evalt**

Hozd létre az `evals/clean.eval.ts` fájlt, az `evals/summary.eval.ts` szerkezetét követve:

```ts
import { evalite } from 'evalite'
import { dedupeTimedLines } from '../src/normalize/dedupe.js'
import { cleanRecipe } from '../src/recipe/clean.js'
import { refine } from '../src/refine/loop.js'
import { checkFidelity } from '../src/rubric/fidelity.js'
import { parseSubtitle } from '../src/subtitle/parse.js'
import type { SourceItem } from '../src/types.js'
import { fixtureClient } from './fixture-model.js'
import { PUBLIC_FIXTURES, type Fixture } from './fixtures/transcripts.js'
import { loadPrivateFixtures } from './private-layer.js'

function itemOf(fixture: Fixture): SourceItem {
  return {
    itemId: fixture.id,
    source: 'fixtures',
    sourceFile: `${fixture.id}.srt`,
    subtitlePath: `${fixture.id}.srt`,
    baseName: fixture.id,
    title: fixture.title,
    language: 'en',
    metadata: {
      videoId: fixture.id,
      channel: fixture.channel,
      uploadedAt: '2026-01-01',
      url: `https://example.com/${fixture.id}`,
    },
  }
}

evalite('clean recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    const cues = parseSubtitle(fixture.srt, `${fixture.id}.srt`)
    const timed = dedupeTimedLines(cues)
    const transcript = timed.map((line) => line.text).join(' ')

    // A „megtisztított" vázlatot a fixture SAJÁT szövegéből állítjuk elő,
    // nyolcsoronként bekezdésre bontva. Így a blokkoló szöveghűség-kapu
    // konstrukció szerint átmegy, és az illesztőnek valódi szöveget kell
    // visszakeresnie — kézzel írt második szövegváltozat nélkül.
    const draft = timed
      .reduce<string[][]>((groups, line, index) => {
        if (index % 8 === 0) groups.push([])
        groups[groups.length - 1]!.push(line.text)
        return groups
      }, [])
      .map((group) => {
        const text = group.join(' ')
        return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
      })
      .join('\n\n')

    const result = await refine(
      cleanRecipe,
      { item: itemOf(fixture), transcript, timed },
      // A `clean` rubrikájában EGY modell-bíró van, tehát generálásonként egy
      // ítélet kell — szemben a `summary` kettejével (hűség, lefedettség).
      fixtureClient(fixture, { notes: [draft], verdicts: [{ score: 0.95, gaps: [] }] }),
    )

    return {
      output: result.output,
      score: result.score,
      transcript,
      // Hány bekezdés kapott időbélyeget: ez a recept fő állítása.
      stamped: result.output.split(/\n{2,}/).filter((b) => /^\[\d/.test(b.trim())).length,
    }
  },

  scorers: [
    {
      name: 'szoveghuseg',
      description: 'Determinisztikus: a kimenet nem összefoglaló.',
      scorer: ({ output }) => checkFidelity(output.output, output.transcript).value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Időbélyeges bekezdés', value: output.stamped },
    { label: 'Pontszám', value: output.score },
  ],
})
```

> Az `evals/fixtures/transcripts.ts` **nem változik**: a `clean` recept vázlata a fixture meglévő SRT-jéből származik, nem új, kézzel írt mezőből.

- [ ] **Step 3: Futtasd az evalt**

Run: `mise exec -- pnpm eval`
Expected: lefut hálózat és API-kulcs nélkül, és pontszámokat ír ki; a `szoveghuseg` pontozó 1,00-t ad, az `Időbélyeges bekezdés` oszlop pedig nullánál nagyobb.

- [ ] **Step 4: Futtasd a teljes tesztet és a lintert**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add evals/clean.eval.ts evals/fixture-model.ts
git commit -m "test(evals): eval a tisztított leirat recepthez

- Szintetikus fixture-ökön fut, hálózat és kulcs nélkül
- A szöveghűség és a rubrika-pontszám is pontozóként szerepel

Refs #32"
```

---

## Amit a terv szándékosan nem tartalmaz

- **A küszöbök kalibrálását** valós modellhívásokkal: az illesztés 0,75/0,10-es és a hűségkapu 0,85/0,80-as küszöbe becsült. Külön kör, előzetes becsléssel és kétszeres ráhagyással.
- **A `roadmap.md` és a `README.md` frissítését:** a szelet lezárásakor, a PR-ben.
- **A másik három receptet** (Bloom-kártya, strukturált jegyzet, fordítás).
