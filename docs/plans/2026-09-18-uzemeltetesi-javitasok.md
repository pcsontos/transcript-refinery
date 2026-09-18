# Terv — Üzemeltetési javítások

> **A végrehajtónak:** ez a terv lépésről lépésre hajtható végre. Minden lépés
> egy művelet, checkbox jelöli. A spec és a terv együtt olvasandó. **A taskok
> függetlenek**: a PR-csoportok külön ágra, külön PR-be mennek, a lenti
> sorrendben.

**Cél:** A napi használatban felgyűlt hét súrlódási pont megszüntetése úgy, hogy
egyetlen kifizetett modellkimenet se vesszen el, és a csendes alapértelmezések
helyére megnevezett hiba vagy tudatos kapcsoló kerüljön.

**Megközelítés:** Hét egymástól független változtatás, mindegyik a meglévő
határokon vág. A horgonyzás bekezdésenként esik vissza ahelyett, hogy az egész
jegyzetet eldobná; a bíró kikapcsolása a `scoreRubric` már meglévő kapu/pontozó
szétválasztását használja; a nyelvazonosítás a már megírt, determinisztikus
`identifyLanguage`-et hívja; a `--fix` a forrás YAML-on szerkeszt, hogy a
megjegyzések megmaradjanak.

**Eszközök:** TypeScript (ESM, `.js` importvégződéssel), vitest, `yaml` (már
függőség). Nulla új függőség.

**Spec:** [`2026-09-18-uzemeltetesi-javitasok-spec.md`](<./2026-09-18-uzemeltetesi-javitasok-spec.md>)

## Globális megkötések

- Magyar dokumentáció, kódkomment, teszt-leírás, felhasználói kimenet és
  commit-üzenet; **angol** produkciós azonosító, prompt és hiányüzenet.
- **Nulla új függőség.**
- Nincs valódi modellhívás: minden teszt offline fut.
- **Vault-tartalom nem kerül naplóba** — a bővített események számot visznek,
  szöveget nem.
- Minden task végén `pnpm test`, `pnpm typecheck` és `pnpm lint` fut.
- A commit-üzenetek a repó szokását követik: magyar, conventional commits,
  pontokba szedett törzs, `Refs #<szám>` footer. **Attribúciós trailer nincs**
  (`Co-Authored-By`, `Claude-Session`) — a `commit-message` skill és a
  meglévő git-előzmény is így kívánja.

## PR-szerkezet

A felhasználó döntése: **egy spec + egy terv, a kód több PR-ben, kockázat
szerint**. A sorrend kötött — a naplózás (PR 4) a horgonyzás (PR 5) **előtt**
megy, mert a Task 6 ugyanabba az eseményunióba és ugyanabba a `switch`-be nyúl.

| PR | ág | taskok | kockázat |
|---|---|---|---|
| 0 | `docs/uzemeltetesi-javitasok` | spec + terv (ez a dokumentum) | — |
| 1 | `fix/commit-scope-es-cimkek` | Task 1, Task 2 | kicsi: szövegcsere és egy tisztító függvény |
| 2 | `feat/nyelvazonositas-fallback` | Task 3 | közepes: új hibaút a csővezetéken |
| 3 | `feat/biro-kikapcsolas` | Task 4 | közepes: config, CLI és a rubrika is érintett |
| 4 | `feat/reszletesebb-naplozas` | Task 5 | közepes: eseménytípusok bővítése |
| 5 | `fix/anchor-visszaeses` | Task 6 | **nagy**: két meglévő teszt viselkedése megfordul |
| 6 | `feat/check-pricing-fix` | Task 7 | **nagy**: a config fájlba ír vissza |

## Fájlszerkezet

| fájl | mi történik vele | task |
|---|---|---|
| `src/cli.ts` | `COMMIT_SCOPE` konstans; `render` négy új esete; `--no-judge` és `--fix` kapcsoló; `skipJudge` feloldása; `commandCheckPricing` bővítése | 1, 4, 5, 6, 7 |
| `src/vault/render.ts` | `sanitizeTag`, a `mergeTags` átírása | 2 |
| `src/pipeline.ts` | nyelvazonosítás a `normalizeItem`-ben; `RecipeDeps.skipJudge`; `stack` és `rounds` az eseményekben; `item:anchor-skipped` | 3, 4, 5, 6 |
| `src/rubric/types.ts` | `scoreRubric` negyedik, elhagyható paramétere | 4 |
| `src/refine/loop.ts` | `RefineOptions.skipJudge` átadása | 4 |
| `src/config.ts` | `model.judge_enabled`, `ModelConfig.judgeEnabled`, `readConfigText` | 4, 7 |
| `src/events.ts` | `item:failed.stack`, `item:refined.rounds`, `item:anchor-skipped` | 5, 6 |
| `src/recipe/anchor.ts` | bekezdésenkénti visszaesés, `unanchoredParagraphs` | 6 |
| `src/recipe/types.ts` | új, elhagyható `Recipe.anchored` mező | 6 |
| `src/recipe/clean.ts` | `anchored: true` | 6 |
| `src/model/pricing-check.ts` | `applyPricingFix` | 7 |
| `README.md` | `--no-judge`, `check-pricing --fix`, a horgonyzás megváltozott viselkedése | 4, 6, 7 |

---

## Task 1: Az app commit-üzenetének scope-ja

**PR 1.** Az app a vaultba commitolva ma `docs(videos):` scope-ot ír; ez az app
nevére vált.

**Fájlok:**
- Módosít: `src/cli.ts:193`, `:455`, `:456`
- Teszt: `src/cli.test.ts:1179`, `:1777`, `:1864`; `src/e2e.test.ts:226`, `:359`, `:360`

**Interfészek:**
- Előállítja: `COMMIT_SCOPE` modulszintű konstans a `src/cli.ts`-ben (nem
  exportált — a tesztek a kész üzenetre néznek, nem a konstansra).

- [ ] **1. lépés: A meglévő elvárások átírása az új szövegre**

`src/cli.test.ts:1179`:

```ts
    expect(uzenet).toBe('docs(transcript-refinery): 5 jegyzet a feldolgozási sorból')
```

`src/cli.test.ts:1777`:

```ts
      'docs(transcript-refinery): feldolgozási sor frissítése',
```

`src/cli.test.ts:1864`:

```ts
      'docs(transcript-refinery): átirat 2 videóhoz',
```

`src/e2e.test.ts:226`:

```ts
    await gitCommitPaths(vault, written, 'docs(transcript-refinery): átirat 1 felirathoz')
```

`src/e2e.test.ts:359-360`:

```ts
        'docs(transcript-refinery): 2 jegyzet a feldolgozási sorból',
        'docs(transcript-refinery): feldolgozási sor frissítése',
```

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtatás: `pnpm test -- src/cli.test.ts src/e2e.test.ts`
Várt: FAIL — a kapott üzenet `docs(videos): …`, a várt `docs(transcript-refinery): …`.

- [ ] **3. lépés: A scope konstans bevezetése**

`src/cli.ts`, a `render` függvény fölé:

```ts
/**
 * Az app saját, vaultba írt commitjainak scope-ja. Az app neve, nem a
 * feldolgozott tartalomé: a `videos` egy korábbi, videó-központú fázisból
 * maradt itt.
 */
const COMMIT_SCOPE = 'transcript-refinery'
```

- [ ] **4. lépés: A három üzenet átírása**

`src/cli.ts:193`:

```ts
  if (
    commit &&
    (await gitCommitPaths(cfg.vaultPath, [path], `docs(${COMMIT_SCOPE}): feldolgozási sor frissítése`))
  ) {
```

`src/cli.ts:455-456`:

```ts
          const message = queueMode
            ? `docs(${COMMIT_SCOPE}): ${String(notePaths.length)} jegyzet a feldolgozási sorból`
            : `docs(${COMMIT_SCOPE}): átirat ${String(notePaths.length)} videóhoz`
```

- [ ] **5. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/cli.test.ts src/e2e.test.ts`
Várt: PASS.

- [ ] **6. lépés: Ellenőrizd, hogy nem maradt `docs(videos)` a repóban**

Futtatás: `grep -rn "docs(videos)" src web evals README.md`
Várt: nincs találat. (A `docs/` mappa kimarad: a spec és ez a terv idézi a régi
szöveget, ott a találat helyes.)

- [ ] **7. lépés: Commit**

```bash
git add src/cli.ts src/cli.test.ts src/e2e.test.ts
git commit -m "$(cat <<'EOF'
fix(cli): az app neve a saját commitjainak scope-jában

Az app a vaultba írt commitjaihoz `docs(videos)` scope-ot használt; ez egy
korábbi, videó-központú fázisból maradt. Helyette az app neve áll, egyetlen
konstansból.
EOF
)"
```

---

## Task 2: Obsidian-kompatibilis címkék

**PR 1.** A szóközt tartalmazó címkét az Obsidian hibásnak jelzi; a
forrás-metaadat viszont tartalmazhat ilyet.

**Fájlok:**
- Módosít: `src/vault/render.ts:16-32`
- Teszt: `src/vault/render.test.ts`

**Interfészek:**
- Előállítja: `sanitizeTag(tag: string): string` (modulszintű, nem exportált) —
  a `mergeTags` viselkedése változik: a metaadat-címkéket **mindig** megtisztítja,
  recept-címke nélkül is.

- [ ] **1. lépés: A bukó tesztek megírása**

`src/vault/render.test.ts`, a `renderTranscriptNote` describe-ba:

```ts
  it('a címke szóközét aláhúzásra cseréli, mert az Obsidian a szóközöst hibának jelzi', () => {
    const note = renderTranscriptNote(
      item({ metadata: { tags: ['machine learning', 'ai'] } }),
      transcript,
      '0.1.0',
    )
    expect(note).toContain('tags: [machine_learning, ai]')
  })
```

És a `renderRecipeNote` describe-ba, ahol a recept-címke is játszik:

```ts
  it('a tisztítás után azonos címke nem kerül be kétszer', () => {
    const note = renderRecipeNote(
      item({ metadata: { tags: ['machine learning'] } }),
      transcript,
      'A törzs.',
      { ...meta, tags: ['machine_learning'] },
      '0.1.0',
    )
    expect(note).toContain('tags: [machine_learning]')
  })
```

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtatás: `pnpm test -- src/vault/render.test.ts`
Várt: FAIL — `tags: [machine learning, ai]`, illetve két címke egy helyett.

- [ ] **3. lépés: A tisztítás bevezetése**

`src/vault/render.ts`, a `mergeTags` doc-kommentje és törzse helyére:

```ts
/** Obsidian-kompatibilis címke: a szóköz aláhúzásra vált. */
const sanitizeTag = (tag: string): string => tag.trim().replace(/\s+/g, '_')

/**
 * A metaadat címkéi a mai sorrendben, utánuk a recept címkéi, csak ha még
 * nincsenek a listában.
 *
 * Minden címke átmegy a `sanitizeTag`-en — **a recept címkéitől függetlenül**:
 * az Obsidian a szóközt tartalmazó címkét hibásnak jelzi, a forrás-metaadat
 * címkéit pedig nem mi írjuk. A duplikátum-szűrés a megtisztított alakon
 * történik, tehát a `machine learning` és a `machine_learning` egy címke.
 */
function mergeTags(
  metadata: readonly string[] | undefined,
  extra: readonly string[] | undefined,
): readonly string[] | undefined {
  if (metadata === undefined && (extra === undefined || extra.length === 0)) return undefined
  const merged: string[] = []
  for (const tag of [...(metadata ?? []), ...(extra ?? [])]) {
    const clean = sanitizeTag(tag)
    if (clean !== '' && !merged.includes(clean)) merged.push(clean)
  }
  return merged.length > 0 ? merged : undefined
}
```

- [ ] **4. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/vault/render.test.ts`
Várt: PASS, a fájl korábbi esetei is (`tags: [ai]`, `tags: [ai, decks, bloom]`,
és a „recept-címke nélkül nincs `tags` mező" eset).

- [ ] **5. lépés: Teljes tesztkészlet, típus- és lintellenőrzés**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld.

- [ ] **6. lépés: Commit (PR 1 lezárása)**

```bash
git add src/vault/render.ts src/vault/render.test.ts
git commit -m "$(cat <<'EOF'
fix(vault): a frontmatter címkéiben aláhúzás a szóköz helyett

Az Obsidian a szóközt tartalmazó címkét hibásnak jelzi, a forrás-metaadat
címkéit viszont nem mi írjuk. A tisztítás a recept címkéitől függetlenül,
mindig lefut, és a duplikátum-szűrés a megtisztított alakon történik.
EOF
)"
```

---

## Task 3: Nyelvazonosítás hiányzó nyelvkódnál

**PR 2.** Ma a nyelvkód nélküli feliratfájl csendben angolnak minősül.

**Fájlok:**
- Módosít: `src/pipeline.ts:1-20` (import), `:65-90` (`normalizeItem`)
- Teszt: `src/pipeline.test.ts`

**Interfészek:**
- Fogyasztja: `identifyLanguage(text: string): LanguageTag | null`
  (`src/lang/identify.ts:79`).
- Előállítja: a `normalizeItem` mellékhatásként **kitölti** az `item.language`
  mezőt, ha az `null` volt; felismerhetetlen nyelvnél `Error`-t dob.

- [ ] **1. lépés: A bukó tesztek megírása**

`src/pipeline.test.ts`, a `describe('processItem', …)` blokkba. A meglévő `SRT`
fixture magyar szövegű, tehát az azonosításhoz nem kell új fájl:

```ts
  it('nyelvkód nélküli fájlnévnél a tartalomból azonosítja a nyelvet', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item({ language: null }), {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: {},
    })

    expect(outcome.status).toBe('published')
    expect(await readFile(outcome.path!, 'utf8')).toContain('\nlanguage: hu\n')
  })

  it('felismerhetetlen nyelvnél megnevezett hibával áll meg, jegyzet nélkül', async () => {
    await writeFile(
      join(dir, 'Ismeretlen.srt'),
      [
        '1',
        '00:00:00,000 --> 00:00:02,000',
        'Xyzzy quux foobar plugh grault.',
        '',
        '2',
        '00:00:02,000 --> 00:00:04,000',
        'Waldo fred corge thud xyzzy.',
        '',
      ].join('\n'),
      'utf8',
    )
    const { sink } = collectEvents()

    const outcome = await processItem(
      item({
        subtitlePath: join(dir, 'Ismeretlen.srt'),
        sourceFile: 'csatorna/Ismeretlen.srt',
        baseName: 'Ismeretlen',
        title: 'Ismeretlen',
        language: null,
      }),
      { notesRoot, store, sink, version: '0.1.0', options: {} },
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('nyelvkód')
  })
```

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtatás: `pnpm test -- src/pipeline.test.ts`
Várt: FAIL — az elsőnél `language: en` áll a jegyzetben (a csendes
alapértelmezés), a másodiknál `status: 'published'` jön `'failed'` helyett.

- [ ] **3. lépés: Az import felvétele**

`src/pipeline.ts`, a meglévő importok közé (ábécésorrendben a `./events.js`
után, a `./model/budget.js` elé nem fér — a `./lang/identify.js` a helye a
`./events.js` és a `./model/budget.js` között):

```ts
import { identifyLanguage } from './lang/identify.js'
```

- [ ] **4. lépés: A nyelvazonosítás a `normalizeItem`-ben**

`src/pipeline.ts`, a `normalizedText` sora után, a `return` elé:

```ts
  // A fájlnév nyelvkódja az elsődleges forrás; ha nincs, a tartalom dönt.
  // Csendes angol alapértelmezés helyett megnevezett hiba: egy holland vagy
  // német feliratot angolnak véve a nyelvi kapu rossz alaphoz mérne.
  if (item.language === null) {
    const detected = identifyLanguage(normalizedText)
    if (detected === null) {
      throw new Error(
        'a feliratfájl nevében nincs nyelvkód, és a tartalom nyelve sem ' +
          `ismerhető fel biztosan: ${item.sourceFile}`,
      )
    }
    item.language = detected
  }
```

- [ ] **5. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/pipeline.test.ts`
Várt: PASS, a fájl korábbi esetei is (azok `language: 'en'`-nel futnak, tehát
az új ág rájuk nem vonatkozik).

- [ ] **6. lépés: Teljes tesztkészlet, típus- és lintellenőrzés**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld. Ha a `scan` vagy az e2e teszt nyelvkód nélküli fixture-t
használ, az most hibára fut — ilyenkor a fixture kap nyelvkódot, vagy a
tesztelvárás vált a megnevezett hibára; a csendes angol alapértelmezés
visszaállítása **nem** megoldás.

- [ ] **7. lépés: Commit (PR 2 lezárása)**

```bash
git add src/pipeline.ts src/pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): nyelvkód nélküli feliratnál a tartalom dönt a nyelvről

A fájlnévben hiányzó nyelvkódnál a determinisztikus azonosító fut le az
átiraton. Ha az sem elég biztos, az elem megnevezett hibával áll meg — eddig
csendben angolnak minősült, és a nyelvi kapu ehhez a rossz alaphoz mért.
EOF
)"
```

---

## Task 4: A bíró kikapcsolása

**PR 3.** CLI-kapcsoló és config-mező, a CLI elsőbbségével.

**Fájlok:**
- Módosít: `src/rubric/types.ts:51-84`, `src/refine/loop.ts`,
  `src/pipeline.ts:23-30` és `:179-186`, `src/config.ts:206-215` és `:245-275`,
  `src/cli.ts:246-292` és `:719-733`, `README.md:237-244`
- Teszt: `src/rubric/types.test.ts`, `src/refine/loop.test.ts`,
  `src/config.test.ts`

**Interfészek:**
- Előállítja:
  - `scoreRubric(rubric, ctx, client, opts?: { skipJudge?: boolean })`
  - `RefineOptions.skipJudge?: boolean`
  - `RecipeDeps.skipJudge?: boolean`
  - `ModelConfig.judgeEnabled: boolean` (YAML: `model.judge_enabled`, alap `true`)
  - CLI: `--no-judge` (`default` nélkül, hogy a „nem adták meg" felismerhető legyen)

- [ ] **1. lépés: A bukó tesztek megírása a rubrikához**

`src/rubric/types.test.ts`, a `describe('scoreRubric', …)` blokkba:

```ts
  it('skipJudge mellett a pontozó (modellhívó) kritériumok el sem indulnak', async () => {
    let futott = false
    const biro: Criterion = {
      name: 'biro',
      score: () => {
        futott = true
        return Promise.resolve({ value: 0.2, gaps: ['valami'] })
      },
    }
    const rubric: Rubric = {
      criteria: [fixKriterium('formatum', 1, [], true), biro],
      passThreshold: 0.8,
    }

    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens, { skipJudge: true })

    expect(futott).toBe(false)
    expect(result.value).toBe(1)
    expect(result.gaps).toEqual([])
  })

  it('skipJudge mellett a blokkoló kapuk változatlanul futnak', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('formatum', 0, ['rossz formátum'], true)],
      passThreshold: 0.8,
    }

    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens, { skipJudge: true })

    expect(result.value).toBe(0)
    expect(result.gaps).toEqual(['rossz formátum'])
  })
```

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtatás: `pnpm test -- src/rubric/types.test.ts`
Várt: FAIL — a `scoreRubric` még nem fogad negyedik paramétert (típushiba), és a
`biro` lefut.

- [ ] **3. lépés: A `scoreRubric` bővítése**

`src/rubric/types.ts`, az aláírás és a kapuk utáni ág:

```ts
export async function scoreRubric(
  rubric: Rubric,
  ctx: ScoreContext,
  client: ModelClient,
  opts: { skipJudge?: boolean } = {},
): Promise<RubricResult> {
```

A blokkoló kritériumok ciklusa után, a `const scored = …` sor elé:

```ts
  // A kapuk determinisztikusak, tehát kikapcsolt bíró mellett is futnak; csak a
  // modellhívó pontozók maradnak ki. Az eredmény ugyanaz, mint a pontozó
  // nélküli rubrikánál: a kapuk átengedték, több mondanivaló nincs.
  if (opts.skipJudge) return { value: 1, gaps: [], usage }
```

- [ ] **4. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/rubric/types.test.ts`
Várt: PASS.

- [ ] **5. lépés: A bukó teszt megírása a loophoz**

`src/refine/loop.test.ts`, a `describe('refine', …)` blokkba:

```ts
  it('skipJudge mellett egy generálás fut, pontozás nélkül', async () => {
    const { client, generalt } = scriptedClient([{ text: 'kimenet', score: 0.1 }])
    let futott = false
    const biro: Criterion = {
      name: 'biro',
      score: () => {
        futott = true
        return Promise.resolve({ value: 0.1, gaps: ['hiány'] })
      },
    }

    const result = await refine(recept([biro]), INPUT, client, { skipJudge: true })

    expect(futott).toBe(false)
    expect(generalt).toEqual(['kimenet'])
    expect(result.generations).toBe(1)
    expect(result.score).toBe(1)
  })
```

A `score: 0.1` szándékos: bíróval ez két javító kört indítana. A teszt tehát
azt is rögzíti, hogy kikapcsolt bíró mellett **nincs** javító kör.

- [ ] **6. lépés: Futtasd a tesztet, és nézd meg, hogy elbukik**

Futtatás: `pnpm test -- src/refine/loop.test.ts`
Várt: FAIL — a `RefineOptions` nem ismeri a `skipJudge` mezőt.

- [ ] **7. lépés: A `RefineOptions` bővítése és átadása**

`src/refine/loop.ts`, a `RefineOptions` interfészbe:

```ts
  /**
   * Igaz esetén a rubrika modellhívó pontozói kimaradnak; a determinisztikus
   * kapuk futnak. A pontszám ilyenkor 1, tehát javító kör sem indul.
   */
  skipJudge?: boolean
```

Mindkét `scoreRubric` hívás negyedik paramétert kap:

```ts
  const firstScore = await scoreRubric(
    recipe.rubric,
    { transcript: input.transcript, output: first.value },
    client,
    { skipJudge: opts.skipJudge },
  )
```

```ts
    const scored = await scoreRubric(
      recipe.rubric,
      { transcript: input.transcript, output: next.value },
      client,
      { skipJudge: opts.skipJudge },
    )
```

- [ ] **8. lépés: Futtasd a tesztet**

Futtatás: `pnpm test -- src/refine/loop.test.ts`
Várt: PASS.

- [ ] **9. lépés: A config mező tesztje**

`src/config.test.ts`, a `describe('loadModelConfig', …)` blokkba:

```ts
  it('a judge_enabled alapértelmezése igaz', () => {
    expect(loadModelConfig(RAW, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml').judgeEnabled).toBe(true)
  })

  it('a judge_enabled kikapcsolható a YAML-ból', () => {
    const raw = { ...RAW, model: { ...RAW.model, judge_enabled: false } }
    expect(loadModelConfig(raw, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml').judgeEnabled).toBe(false)
  })
```

- [ ] **10. lépés: A config séma és a `ModelConfig` bővítése**

`src/config.ts`, a `ModelSchema` `model` objektumába, a `judge` sor után:

```ts
    /** Hamisra állítva a bíró pontozói nem futnak; a determinisztikus kapuk igen. */
    judge_enabled: z.boolean().default(true),
```

A `ModelConfig` interfészbe:

```ts
  /** Fusson-e a bíró. A `--no-judge` kapcsoló felülírja. */
  judgeEnabled: boolean
```

A `loadModelConfig` visszatérési objektumába, a `models` sor után:

```ts
    judgeEnabled: c.model.judge_enabled,
```

- [ ] **11. lépés: Futtasd a config teszteket**

Futtatás: `pnpm test -- src/config.test.ts`
Várt: PASS.

- [ ] **12. lépés: A CLI kapcsoló és a precedencia**

`src/cli.ts`, a `parseArgs` `options` objektumába:

```ts
      // Szándékosan `default` nélkül: az `undefined` jelenti azt, hogy a
      // kapcsolót nem adták meg, és ilyenkor a config dönt.
      'no-judge': { type: 'boolean' },
```

A `commandRun` `flags` paraméterébe:

```ts
    /** A `--no-judge`; hiányában (`undefined`) a config `judge_enabled` mezője dönt. */
    noJudge?: boolean
```

A `main()` `commandRun` hívásába, a `retryFailed` sor mellé:

```ts
      noJudge: values['no-judge'],
```

A `commandRun`-ban, a `model` felépítése után, a `depsFor` elé:

```ts
  // A CLI elsőbbsége: a megadott kapcsoló felülírja a configot, hiányában a
  // config dönt. A `--no-judge` csak kikapcsolni tud — visszakapcsolni nem
  // kell, mert a config alapértelmezése amúgy is a bekapcsolt bíró.
  const skipJudge = flags.noJudge ?? !(model?.modelConfig.judgeEnabled ?? true)
```

A `depsFor` visszaadott objektumába:

```ts
          skipJudge,
```

- [ ] **13. lépés: A `RecipeDeps` és a `refine` hívás**

`src/pipeline.ts`, a `RecipeDeps` interfészbe:

```ts
  /** Igaz esetén a bíró pontozói kimaradnak; a determinisztikus kapuk futnak. */
  skipJudge?: boolean
```

A `runRecipe` `refine` hívásába, az `onScore` után:

```ts
    skipJudge: recipeDeps.skipJudge,
```

- [ ] **14. lépés: A README kiegészítése**

`README.md:244` után, a „Gyakori kapcsolók" listába:

```markdown
  - `--no-judge`: a bíró pontozói nem futnak (a determinisztikus kapuk igen);
    felülírja a `model.judge_enabled` beállítást
```

- [ ] **15. lépés: Teljes tesztkészlet, típus- és lintellenőrzés**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld.

- [ ] **16. lépés: Commit (PR 3 lezárása)**

```bash
git add src/rubric/types.ts src/rubric/types.test.ts src/refine/loop.ts \
  src/refine/loop.test.ts src/config.ts src/config.test.ts src/cli.ts \
  src/pipeline.ts README.md
git commit -m "$(cat <<'EOF'
feat(cli): a bíró kikapcsolható kapcsolóval és configból

A `--no-judge` és a `model.judge_enabled` a rubrika modellhívó pontozóit
hagyja ki; a determinisztikus kapuk változatlanul futnak. Ütközésnél a
parancssori kapcsoló az erősebb.
EOF
)"
```

---

## Task 5: Részletesebb naplózás

**PR 4.** A JSONL napló és a konzol is többet mond, vault-tartalom nélkül.

**Fájlok:**
- Módosít: `src/events.ts:22-33` és `:70-78`, `src/pipeline.ts:200-207`,
  `:332-341`, `:356-375`, `src/cli.ts:106-133`
- Teszt: `src/pipeline.test.ts`

**Interfészek:**
- Előállítja: `item:failed.stack?: string`;
  `item:refined.rounds: { score, gaps, generateTokens, scoreTokens }[]`;
  a `render` új esetei `item:start`, `item:generating`, `item:scored` eseményre.

- [ ] **1. lépés: A bukó tesztek megírása**

`src/pipeline.test.ts`, a `describe('processItem — generálási és pontozási események', …)`
blokkba (vagy mellé):

```ts
  it('az item:refined körönkénti token-bontást is visz', async () => {
    const { sink, events } = collectEvents()
    await processItem(item(), {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: {},
      recipeDeps: recipeDepsFixture(),
    })

    const refined = events.find((e) => e.type === 'item:refined')
    expect(refined).toBeDefined()
    expect(refined).toMatchObject({
      rounds: [
        {
          score: expect.any(Number),
          gaps: expect.any(Number),
          generateTokens: { input: expect.any(Number), output: expect.any(Number) },
          scoreTokens: { input: expect.any(Number), output: expect.any(Number) },
        },
      ],
    })
  })

  it('az elbukott elem eseménye a hívási láncot is viszi', async () => {
    const broken = item({ subtitlePath: join(dir, 'nincs.en.srt') })
    const { sink, events } = collectEvents()

    await processItem(broken, { notesRoot, store, sink, version: '0.1.0', options: {} })

    const failed = events.find((e) => e.type === 'item:failed')
    expect(failed).toMatchObject({ stack: expect.stringContaining('Error') })
  })
```

A `recipeDepsFixture()` a fájlban már meglévő recept-deps összeállítás — ha
helyben épül, vedd át a `describe('processItem recepttel', …)` mintáját.

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtatás: `pnpm test -- src/pipeline.test.ts`
Várt: FAIL — nincs `rounds`, és nincs `stack`.

- [ ] **3. lépés: Az eseménytípusok bővítése**

`src/events.ts`, az `item:failed` variánsba:

```ts
      /** A hiba hívási lánca, ha van — a diagnózishoz; a felület nem mutatja. */
      stack?: string
```

Az `item:refined` variánsba:

```ts
      /**
       * Körönkénti bontás. A `gaps` itt is **szám**, nem szöveg: a naplóba nem
       * kerülhet vault-tartalom.
       */
      rounds: {
        score: number
        gaps: number
        generateTokens: { input: number; output: number }
        scoreTokens: { input: number; output: number }
      }[]
```

- [ ] **4. lépés: A `stack` kitöltése mindhárom helyen**

`src/pipeline.ts`, a recepthiba catch ágában (`:332` körül):

```ts
      } catch (error) {
        const message = (error as Error).message
        const stack = (error as Error).stack
        store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
        deps.sink({
          type: 'item:failed',
          itemId: item.itemId,
          source: item.source,
          kind: recipeDeps.recipe.id,
          error: message,
          stack,
        })
```

A külső catch ágban (`:348` körül) ugyanígy: `const stack = (error as Error).stack`,
és mindkét `sink({ type: 'item:failed', … })` hívás kap egy `stack,` sort.

- [ ] **5. lépés: A `rounds` kivezetése**

`src/pipeline.ts`, az `item:refined` kibocsátásába (`:200-207`):

```ts
  deps.sink({
    type: 'item:refined',
    itemId: item.itemId,
    recipe: recipe.id,
    score: result.score,
    generations: result.generations,
    usd,
    rounds: result.rounds.map((round) => ({
      score: round.score,
      gaps: round.gaps,
      generateTokens: {
        input: round.generateUsage.inputTokens,
        output: round.generateUsage.outputTokens,
      },
      scoreTokens: {
        input: round.scoreUsage.inputTokens,
        output: round.scoreUsage.outputTokens,
      },
    })),
  })
```

- [ ] **6. lépés: A konzol új sorai**

`src/cli.ts`, a `render` `switch`-ébe, a `case 'item:normalized':` elé:

```ts
    case 'item:start':
      return `▸ ${event.itemId}: ${event.title}`
    case 'item:generating':
      return `  … ${event.itemId}: ${event.recipe} generálás #${String(event.generation)}`
    case 'item:scored':
      return `  · ${event.itemId}: ${event.recipe} kör ${event.score.toFixed(2)}, ${String(event.gaps)} hiány`
```

Enélkül a terminál a futás leghosszabb szakasza — a modellhívás — alatt néma.

- [ ] **7. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/pipeline.test.ts`
Várt: PASS.

- [ ] **8. lépés: Teljes tesztkészlet, típus- és lintellenőrzés**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld. A `web/` felület típusai is: ha a `RunEvent` uniót ott
kimerítően kezeli egy `switch`, a `rounds` kötelező mezője fordítási hibát
adhat — ilyenkor a felület oldalán is ki kell egészíteni.

- [ ] **9. lépés: Commit (PR 4 lezárása)**

```bash
git add src/events.ts src/pipeline.ts src/cli.ts src/pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(run): részletesebb napló a JSONL-ben és a konzolon

Az elbukott elem eseménye a hívási láncot is viszi, a befejezett recepté pedig
a körönkénti token-bontást. A konzol a generálás és a pontozás alatt sem néma
többé. Vault-tartalom továbbra sem kerül naplóba: minden új mező szám.
EOF
)"
```

---

## Task 6: Horgonyzás — bekezdésenkénti visszaesés

**PR 5.** Ma egyetlen bizonytalan bekezdés eldobja a teljes, kifizetett
jegyzetet.

**Fájlok:**
- Módosít: `src/recipe/anchor.ts:154-177`, `src/recipe/types.ts`,
  `src/recipe/clean.ts:59-68`, `src/events.ts`, `src/pipeline.ts:200-210`,
  `src/cli.ts:106-133`, `README.md`
- Teszt: `src/recipe/anchor.test.ts:65-73` (átírás), `src/pipeline.test.ts`

**Interfészek:**
- Fogyasztja: `AnchorError` (`src/recipe/anchor.ts:35`) — megmarad, de már nem
  hagyja el az `anchorParagraphs`-ot.
- Előállítja: `unanchoredParagraphs(anchored: string): { count: number; total: number }`;
  `Recipe.anchored?: boolean`; `item:anchor-skipped` esemény.

- [ ] **1. lépés: A két meglévő teszt átírása és egy új eset**

`src/recipe/anchor.test.ts:65-73` helyére:

```ts
  it('horgonyozhatatlan bekezdést időbélyeg nélkül enged át', () => {
    const output = 'Completely unrelated sentence about quantum chromodynamics and nothing else.'
    expect(anchorParagraphs(output, TIMED)).toBe(output)
  })

  it('a túl rövid bekezdés is időbélyeg nélkül megy át', () => {
    expect(anchorParagraphs('Right.', TIMED)).toBe('Right.')
  })

  it('egy bukó bekezdés nem viszi el a többi időbélyegét', () => {
    const output = [
      'Hey everyone, welcome back to the channel. Today we are going to talk',
      'about container storage and why it matters for your home lab.',
      '',
      'Completely unrelated sentence about quantum chromodynamics and nothing else.',
      '',
      'The second thing I want to cover is backups, because nobody thinks about',
      'them until the disk finally dies on a Sunday night.',
    ].join('\n')

    const result = anchorParagraphs(output, TIMED)

    expect(result).toContain('[00:00] Hey everyone, welcome back')
    expect(result).toContain('\nCompletely unrelated sentence about quantum')
    expect(result).toContain('[01:04] The second thing I want to cover')
  })
```

És az `unanchoredParagraphs`-hoz, új `describe`-ban:

```ts
describe('unanchoredParagraphs', () => {
  it('a fejlécet nem számolja, az időbélyeg nélküli bekezdést igen', () => {
    const anchored = ['## Storage', '', '[00:00] Első bekezdés.', '', 'Második bekezdés.'].join('\n')
    expect(unanchoredParagraphs(anchored)).toEqual({ count: 1, total: 2 })
  })

  it('órás időbélyeget is felismer', () => {
    expect(unanchoredParagraphs('[1:05:20] Bekezdés.')).toEqual({ count: 0, total: 1 })
  })
})
```

Az import kiegészül: `import { anchorParagraphs, formatTimestamp, unanchoredParagraphs } from './anchor.js'`.

- [ ] **2. lépés: Futtasd a teszteket, és nézd meg, hogy elbuknak**

Futtatás: `pnpm test -- src/recipe/anchor.test.ts`
Várt: FAIL — az első kettő kivételt kap a visszatérési érték helyett, az
`unanchoredParagraphs` pedig nem létezik.

- [ ] **3. lépés: A bekezdésenkénti visszaesés**

`src/recipe/anchor.ts`, az `anchorParagraphs` ciklusmagjának végén, az
`anchorOne` hívás helyére:

```ts
    try {
      const anchored = anchorOne(paragraph, words, timed, cursor)
      out.push(anchored.text)
      cursor = anchored.cursor
    } catch (error) {
      if (!(error instanceof AnchorError)) throw error
      // A bizonytalan bekezdés időbélyeg nélkül megy át, a kurzor pedig a
      // helyén marad: bukott illesztésnél nincs hiteles új pozíció, az ablak
      // (500 szó) viszont innen a következő bekezdést még eléri. Egy rossz
      // illesztés így egyetlen időbélyeget visz, nem az egész jegyzetet — az
      // pedig eddig a kifizetett modellhívás eredményét dobta el.
      out.push(paragraph)
    }
```

A függvény doc-kommentjében a „A bizonytalan illesztés **dob**…" bekezdés
helyére az új viselkedés leírása kerül.

- [ ] **4. lépés: Az `unanchoredParagraphs` felvétele**

`src/recipe/anchor.ts`, a `HEADING` konstans mellé és a fájl végére:

```ts
/** A horgonyzott bekezdés időbélyeggel kezdődik; a fejléc soha. */
const TIMESTAMP = /^\[\d{1,2}:\d{2}(?::\d{2})?\] /

/**
 * Hány prózabekezdés maradt időbélyeg nélkül a horgonyzott kimenetben, és
 * hányból. A fejlécek nem számítanak: azok eleve időbélyeg nélkül mennek át.
 *
 * A naplózás ebből tudja, mennyit veszített a jegyzet — a kihagyás okát
 * szándékosan nem visszük tovább, mert az a bekezdés szövegét tartalmazná.
 */
export function unanchoredParagraphs(anchored: string): { count: number; total: number } {
  let count = 0
  let total = 0
  for (const block of anchored.split(/\n{2,}/)) {
    const trimmed = block.trim()
    if (trimmed === '' || HEADING.test(trimmed)) continue
    total++
    if (!TIMESTAMP.test(trimmed)) count++
  }
  return { count, total }
}
```

- [ ] **5. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/recipe/anchor.test.ts`
Várt: PASS, a fájl korábbi esetei is.

- [ ] **6. lépés: A recept jelöli magát**

`src/recipe/types.ts`, a `Recipe` interfészbe (a `headingsAreContent` mellé):

```ts
  /**
   * Ha igaz, a recept kimenete bekezdésenkénti időbélyeget kap. A csővezeték
   * ebből tudja, hogy az időbélyeg nélküli bekezdés hiány, nem a recept alakja.
   */
  anchored?: boolean
```

`src/recipe/clean.ts`, a `cleanRecipe` objektumába a `postprocess` mellé:

```ts
  anchored: true,
```

- [ ] **7. lépés: Az esemény és a kibocsátása**

`src/events.ts`, a `RunEvent` unióba:

```ts
  | {
      type: 'item:anchor-skipped'
      itemId: string
      recipe: string
      /** Hány prózabekezdés maradt időbélyeg nélkül. */
      count: number
      /** Hány prózabekezdés van összesen — enélkül a szám nem mond arányt. */
      total: number
    }
```

`src/pipeline.ts`, a `runRecipe`-ben az `item:refined` kibocsátása után:

```ts
  // Csak az időbélyeges receptnél értelmes: egy `summary` jegyzetben minden
  // bekezdés időbélyeg nélküli, az nem hiány.
  if (recipe.anchored) {
    const { count, total } = unanchoredParagraphs(result.output)
    if (count > 0) {
      deps.sink({ type: 'item:anchor-skipped', itemId: item.itemId, recipe: recipe.id, count, total })
    }
  }
```

Az import kiegészül: `import { unanchoredParagraphs } from './recipe/anchor.js'`.

- [ ] **8. lépés: A konzolsor**

`src/cli.ts`, a `render` `switch`-ébe:

```ts
    case 'item:anchor-skipped':
      return `  ! ${event.itemId}: ${String(event.count)}/${String(event.total)} bekezdés időbélyeg nélkül`
```

- [ ] **9. lépés: A csővezeték tesztje**

`src/pipeline.test.ts`, a recepttel futó blokkba: olyan recept-fixture kell,
amelynek `anchored: true` és a `postprocess`-e az `anchorParagraphs` — a modell
válasza pedig egy nem horgonyozható bekezdés. Az elvárás:

```ts
    expect(outcome.status).toBe('published')
    expect(events.find((e) => e.type === 'item:anchor-skipped')).toMatchObject({ count: 1 })
```

A lényeg, amit rögzít: a jegyzet **elkészül** (ma `failed` lenne), és a
kihagyás nyomot hagy.

- [ ] **10. lépés: A README frissítése**

A horgonyzást leíró szakaszban rögzítsd: a bizonytalanul illeszkedő bekezdés
időbélyeg nélkül kerül a jegyzetbe, a jegyzet maga elkészül, és a futás naplója
megmondja, hány bekezdés maradt időbélyeg nélkül.

- [ ] **11. lépés: Teljes tesztkészlet, típus- és lintellenőrzés**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld. Figyelj a `web/` felület `RunEvent`-kezelésére: az új
eseménytípus ott is megjelenhet kimerítő `switch`-ben.

- [ ] **12. lépés: Commit (PR 5 lezárása)**

```bash
git add src/recipe/anchor.ts src/recipe/anchor.test.ts src/recipe/types.ts \
  src/recipe/clean.ts src/events.ts src/pipeline.ts src/pipeline.test.ts \
  src/cli.ts README.md
git commit -m "$(cat <<'EOF'
fix(recipe): a horgonyzás bekezdésenként esik vissza, nem dobja el a jegyzetet

Eddig az első bizonytalan illesztés kivétellel elvitte a teljes, már kifizetett
tisztított leiratot, és a jegyzet nem került a vaultba. Mostantól az érintett
bekezdés időbélyeg nélkül megy át, a többi megkapja a magáét, a kihagyások
száma pedig a naplóba kerül.
EOF
)"
```

---

## Task 7: `check-pricing --fix`

**PR 6.** Az árellenőrzés eddig csak jelentett; mostantól javítani is tud.

**Fájlok:**
- Módosít: `src/model/pricing-check.ts` (új export), `src/config.ts` (új
  export), `src/cli.ts:206-228`, `:719-733`, `:746-748`, `README.md:246-252`
- Teszt: `src/model/pricing-check.test.ts`, `src/cli.test.ts:1673-1740`

**Interfészek:**
- Előállítja:
  - `applyPricingFix(configText: string, mismatches: readonly PricingMismatch[]): string`
  - `readConfigText(path: string): Promise<string>`
  - `commandCheckPricing(modelConfig, opts?: { fix?: boolean; configPath?: string })`
  - CLI: `--fix`

- [ ] **1. lépés: A bukó teszt megírása a tiszta függvényhez**

`src/model/pricing-check.test.ts`, új `describe`:

```ts
describe('applyPricingFix', () => {
  const TEXT = [
    '# Ár-megjegyzés, amelynek meg kell maradnia.',
    'pricing:',
    '  draft: { input_per_million: 2.00, output_per_million: 10.00 }',
    '  judge: { input_per_million: 1.25, output_per_million: 2.50 }',
    '',
  ].join('\n')

  it('csak az eltérő szerep árát írja át, a megjegyzést és a flow-alakot megtartva', () => {
    const fixed = applyPricingFix(TEXT, [
      {
        role: 'draft',
        model: 'claude-sonnet-5',
        configured: PRICING.draft,
        live: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    ])

    expect(fixed).toContain('# Ár-megjegyzés, amelynek meg kell maradnia.')
    expect(fixed).toContain('draft: { input_per_million: 3, output_per_million: 15 }')
    expect(fixed).toContain('judge: { input_per_million: 1.25, output_per_million: 2.50 }')
  })

  it('két tizedesre kerekít, mert az élő ár tokenárból visszaszorzott', () => {
    const fixed = applyPricingFix(TEXT, [
      {
        role: 'judge',
        model: 'grok-4-fast-reasoning',
        configured: PRICING.judge,
        live: { inputPerMillion: 2.4999999999999996, outputPerMillion: 12.345 },
      },
    ])

    expect(fixed).toContain('judge: { input_per_million: 2.5, output_per_million: 12.35 }')
  })
})
```

Az import kiegészül: `applyPricingFix`, `type PricingMismatch`.

- [ ] **2. lépés: Futtasd a tesztet, és nézd meg, hogy elbukik**

Futtatás: `pnpm test -- src/model/pricing-check.test.ts`
Várt: FAIL — az `applyPricingFix` nem létezik.

- [ ] **3. lépés: Az `applyPricingFix` megírása**

`src/model/pricing-check.ts`, a fájl elejére az import, a végére a függvény:

```ts
import { isMap, parseDocument } from 'yaml'
```

```ts
/**
 * Két tizedes: a config ebben az alakban tartja az árakat, a LiteLLM
 * token-alapú árából visszaszorozva pedig lebegőpontos zaj keletkezhet.
 */
const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * A configban rögzített árat a LiteLLM élő értékeire írja át.
 *
 * **A forrás YAML-on szerkeszt**, nem az elemzett objektumból épít új
 * szöveget: a `pricing:` blokk fölötti magyarázó megjegyzés és a flow-alak
 * (`{ … }`) enélkül elveszne. A meglévő csomópont értékeit állítjuk, magát a
 * csomópontot nem cseréljük — ez őrzi meg az alakját.
 */
export function applyPricingFix(
  configText: string,
  mismatches: readonly PricingMismatch[],
): string {
  const doc = parseDocument(configText)
  for (const mismatch of mismatches) {
    const node = doc.getIn(['pricing', mismatch.role])
    if (!isMap(node)) continue
    node.set('input_per_million', round2(mismatch.live.inputPerMillion))
    node.set('output_per_million', round2(mismatch.live.outputPerMillion))
  }
  return String(doc)
}
```

- [ ] **4. lépés: Futtasd a tesztet**

Futtatás: `pnpm test -- src/model/pricing-check.test.ts`
Várt: PASS. Ha a flow-alak mégis blokk-alakra törik, a `node.set` helyett a
`node.items` megfelelő `Pair`-jének `value`-ját kell állítani — a teszt ezt
azonnal megmutatja.

- [ ] **5. lépés: A bukó teszt megírása a parancshoz**

`src/cli.test.ts`, a `describe('commandCheckPricing', …)` blokkba:

```ts
  it('--fix-nél visszaírja az élő árat, és 0-val tér vissza', async () => {
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    stubLiteLLM([
      { model_name: 'claude-sonnet-5', input: 0.000003, output: 0.000015 },
      { model_name: 'grok-4-fast-reasoning', input: 0.00000125, output: 0.0000025 },
    ])
    const fixDir = await mkdtemp(join(tmpdir(), 'refinery-fix-'))
    const configPath = join(fixDir, 'refinery.config.yaml')
    await writeFile(
      configPath,
      [
        '# Ár-megjegyzés.',
        'pricing:',
        '  draft: { input_per_million: 2.00, output_per_million: 10.00 }',
        '  judge: { input_per_million: 1.25, output_per_million: 2.50 }',
        '',
      ].join('\n'),
      'utf8',
    )

    const code = await commandCheckPricing(MODEL_CONFIG, { fix: true, configPath })

    expect(code).toBe(0)
    const text = await readFile(configPath, 'utf8')
    expect(text).toContain('# Ár-megjegyzés.')
    expect(text).toContain('draft: { input_per_million: 3, output_per_million: 15 }')
    await rm(fixDir, { recursive: true, force: true })
    naplo.mockRestore()
  })

  it('--fix nélkül nem nyúl a confighoz', async () => {
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    stubLiteLLM([
      { model_name: 'claude-sonnet-5', input: 0.000003, output: 0.000015 },
      { model_name: 'grok-4-fast-reasoning', input: 0.00000125, output: 0.0000025 },
    ])

    expect(await commandCheckPricing(MODEL_CONFIG)).toBe(1)
    naplo.mockRestore()
  })
```

- [ ] **6. lépés: Futtasd a tesztet, és nézd meg, hogy elbukik**

Futtatás: `pnpm test -- src/cli.test.ts -t commandCheckPricing`
Várt: FAIL — a `commandCheckPricing` nem fogad második paramétert.

- [ ] **7. lépés: A nyers config-szöveg olvasása**

`src/config.ts`, a `readConfigFile` mellé:

```ts
/**
 * A konfigurációs fájl nyers szövege, elemzés nélkül. A `--fix`-nek ez kell:
 * a `readConfigFile` a szöveget eldobja, a megjegyzések megőrzéséhez viszont a
 * forrásra van szükség.
 */
export async function readConfigText(path: string): Promise<string> {
  return readFile(path, 'utf8')
}
```

- [ ] **8. lépés: A parancs bővítése**

`src/cli.ts`, a `commandCheckPricing` aláírása és vége:

```ts
export async function commandCheckPricing(
  modelConfig: ModelConfig,
  opts: { fix?: boolean; configPath?: string } = {},
): Promise<number> {
```

A `mismatches` kiírása után, a `return` helyére:

```ts
  if (mismatches.length === 0 && unknown.length === 0) {
    console.log('Az árazás egyezik a LiteLLM élő adataival.')
    return 0
  }

  if (mismatches.length > 0 && opts.fix && opts.configPath) {
    const fixed = applyPricingFix(await readConfigText(opts.configPath), mismatches)
    await writeFileAtomic(opts.configPath, fixed)
    console.log(
      `Javítva a configban: ${mismatches.map((m) => m.role).join(', ')} — ${opts.configPath}`,
    )
    return 0
  }

  return mismatches.length > 0 ? 1 : 0
}
```

Az importok kiegészülnek: `applyPricingFix` a `./model/pricing-check.js`-ből,
`readConfigText` a `./config.js`-ből. A `writeFileAtomic` már importálva van.

- [ ] **9. lépés: A CLI kapcsoló**

`src/cli.ts`, a `parseArgs` `options` objektumába:

```ts
      fix: { type: 'boolean', default: false },
```

A `check-pricing` ágba:

```ts
  if (command === 'check-pricing') {
    return commandCheckPricing(loadModelConfig(raw, process.env, cfg.configPath), {
      fix: values.fix,
      configPath,
    })
  }
```

- [ ] **10. lépés: Futtasd a teszteket**

Futtatás: `pnpm test -- src/cli.test.ts src/model/pricing-check.test.ts`
Várt: PASS.

- [ ] **11. lépés: A README frissítése**

`README.md:252` után:

```markdown
A `--fix` a talált eltéréseket vissza is írja a konfigurációba, a fájl
megjegyzéseinek megtartásával:

```bash
node dist/cli.js check-pricing --fix
```
```

- [ ] **12. lépés: Kézi ellenőrzés valódi configon**

Futtatás: `cp refinery.config.yaml /tmp/config-proba.yaml && node dist/cli.js check-pricing --fix --config /tmp/config-proba.yaml && diff refinery.config.yaml /tmp/config-proba.yaml`
Várt: a diff csak árszámokat mutat (vagy üres), a megjegyzések és a szerkezet
érintetlen. **Modellhívás nincs**, csak a LiteLLM `/model/info` lekérdezése.

- [ ] **13. lépés: Teljes tesztkészlet, típus- és lintellenőrzés**

Futtatás: `pnpm test && pnpm typecheck && pnpm lint`
Várt: minden zöld.

- [ ] **14. lépés: Commit (PR 6 lezárása)**

```bash
git add src/model/pricing-check.ts src/model/pricing-check.test.ts \
  src/config.ts src/cli.ts src/cli.test.ts README.md
git commit -m "$(cat <<'EOF'
feat(cli): a check-pricing --fix visszaírja az élő árat a configba

Az ellenőrzés eddig csak jelentette az eltérést. A --fix a forrás YAML-on
szerkeszt, így a pricing blokk magyarázó megjegyzései és flow-alakja megmarad.
EOF
)"
```

---

## Önellenőrzés (a terv írása után elvégezve)

**Spec-lefedettség.** A spec hét pontja és a taskok: 1 → Task 1; 2 → Task 6;
3 → Task 2; 4 → Task 4; 5 → Task 7; 6 → Task 3; 7 → Task 5. A spec
„Amihez nem nyúlunk" listája egyetlen taskban sem sérül.

**Ismert rések, amiket a végrehajtónak kezelnie kell:**

1. A Task 5 és a Task 6 `pipeline.test.ts`-beli tesztje recept-fixture-t
   igényel; a fájlban meglévő minta (`describe('processItem recepttel', …)`)
   az alap, de a pontos összeállítást a végrehajtó a helyszínen veszi át — ezt
   a terv nem másolja ide, mert a fixture a fájl tetején élő segédektől függ.
2. A Task 3 után elbukhat olyan meglévő teszt vagy fixture, amely nyelvkód
   nélküli feliratfájlt használ. A javítás iránya kötött: a fixture kap
   nyelvkódot, vagy az elvárás vált a megnevezett hibára.
3. A `web/` felület `RunEvent`-kezelése a Task 5 és a Task 6 után fordítási
   hibát adhat (új kötelező mező, új eseményvariáns).

**Típus-egyezés.** A `skipJudge` mező neve azonos mind a négy helyen
(`RefineOptions`, `RecipeDeps`, a `scoreRubric` `opts`-a, a `commandRun` helyi
változója); a config oldali neve szándékosan más és fordított értelmű
(`judge_enabled` / `judgeEnabled`), ezt a Task 4 12. lépése köti össze.
