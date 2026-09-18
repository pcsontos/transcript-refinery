# Spec — Üzemeltetési javítások

**Dátum:** 2026-09-18 · **Státusz:** jóváhagyásra vár

Ez a dokumentum hét, egymástól független súrlódási pontot specifikál, amelyek a
napi használat során gyűltek össze. A korábbi szeletektől eltérően ez **nem egy
összefüggő funkció**, hanem javítási lista — ezért a szerkezete is más: egy
spec, egy terv, de a végrehajtás **több PR-re bomlik kockázat szerint**.

Kettő a hét pontból ma valódi adat- vagy pénzvesztést okoz:

- a horgonyzás első bizonytalan illesztésnél **eldobja a teljes, már kifizetett
  modellkimenetet** (`src/pipeline.ts:332`), a jegyzet nem kerül a vaultba;
- a nyelvkód nélküli feliratfájl **csendben angolnak minősül**
  (`src/lang/identify.ts:106`), tehát a nyelvi kapu rossz alaphoz mér.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A mindennapi használatban felgyűlt hét hiba és hiányosság megszüntetése úgy,
hogy közben **egyetlen kifizetett modellkimenet se vesszen el**, és a csendes
alapértelmezések helyére megnevezett hiba vagy tudatos kapcsoló kerüljön.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| PR-szerkezet | **Egy spec + egy terv, a kód több PR-ben, kockázat szerint** | Kifejezett kérés. A hét pont mérete és kockázata nagyságrendekkel eltér; egy nagy diffben egy újratervezés a kész, triviális javításokat is visszatartaná |
| 1. Commit-üzenet | A scope az **app neve** (`transcript-refinery`), nem `videos` | Az app saját, futás közbeni commitjairól van szó, nem a fejlesztői commitokról; a `videos` szó egy korábbi, videó-központú fázisból maradt |
| 2. Horgonyzási hiba | **Bekezdésenkénti fokozatos visszaesés**: a bizonytalan bekezdés időbélyeg nélkül megy át, a többi megkapja a magáét | Kifejezett kérés („azt az időbélyeget kihagyja, de a továbbiakat még beilleszti, ha tudja"). A „teljesen időbélyeg nélkül" változat ennek degenerált esete, külön ág nélkül adódik |
| 2b. A kurzor sorsa hibánál | **Marad, ahol volt** | Bukott illesztésnél nincs hiteles új pozíció; a helyben hagyott kurzor ablakából (500 szó ≈ hat bekezdés) a következő bekezdés még megtalálhatja magát |
| 2c. Retroaktív újra-horgonyzás | **Kimarad ebből a szeletből** | A 2. pont után a jegyzet már nem vész el, tehát nincs sürgető ok rá. Külön eszköz, és a küszöbök kalibrálásához kötődik (`anchor.ts:18` — a mai küszöbök becsültek) |
| 3. Címkék | **Automatikus javítás a rendereléskor**, nem lint-hiba | A kérés javítást kér, nem hibajelzést; a forrás-metaadat címkéit nem mi írjuk, tehát a hibajelzés csak megállítaná a futást |
| 4. Bíró kikapcsolása | **CLI (`--no-judge`) és config (`model.judge_enabled`) is**, ütközésnél a **CLI győz** | Kifejezett kérés mindkét felületre és a precedenciára |
| 4b. Mi marad bekapcsolva | A **determinisztikus, blokkoló kapuk futnak tovább**; csak az LLM-bíró marad ki | A `scoreRubric` már ma szétválasztja a kettőt (`src/rubric/types.ts:63` vs `:71`), tehát a vágás pontosan a meglévő határon fut |
| 5. `check-pricing` | Új **`--fix`** kapcsoló, kommentmegőrző YAML-visszaírással | A felhasználó `npx refinery check-pricing --fix`-et futtatott; ez a kapcsoló ma nem létezik |
| 5b. Az árellenőrzés hatóköre | **Változatlan** | Ellenőrizve: a `comparePricing` már ma a `MODEL_ROLES` fölött iterál, tehát a bíró árát is nézi — itt nincs tennivaló |
| 6. Nyelvazonosítás | Hiányzó nyelvkódnál **determinisztikus azonosítás**; ha az is bizonytalan, **hibával megáll** | Kifejezett kérés. A mai csendes angol alapértelmezés egy holland vagy német feliratot is angolnak vesz, és a nyelvi kapu ehhez a rossz alaphoz mér |
| 7. Naplózás | **Mindkét felület** (JSONL és konzol), minden lépésről | Kifejezett kérés |
| 7b. Mi nem kerül a naplóba | **Vault-tartalom és hiányszöveg továbbra sem** | Meglévő, szándékos tervezési döntés (`src/refine/loop.ts:24-26`); a bővítés mérőszámokat visz, nem szöveget |

## Amit a tervezés előtt ellenőriztünk

Minden alábbi állítás a jelenlegi forráskódból ellenőrzött, nem feltételezés.

### Az 5. pont fele már kész

A `comparePricing` (`src/model/pricing-check.ts:69`) a `models` kulcsai fölött
iterál, ami a `MODEL_ROLES` (`src/types.ts:9`) mindkét elemét tartalmazza:

```ts
for (const role of Object.keys(models) as ModelRole[]) {
```

Tehát az `npx refinery check-pricing` **ma is** összeveti a bíró configolt árát
a LiteLLM élő árával. Ami hiányzik, az kizárólag a visszaírás (`--fix`).

### A horgonyzás ma is nulla modellhívású

Az `anchorParagraphs` (`src/recipe/anchor.ts:154`) tiszta függvény:
tokenizálás és leghosszabb közös részsorozat (LCS) illesztés a felirat
időzítéséhez. **Nincs benne modellhívás**, tehát önmagában tetszőlegesen
újrafuttatható — a „ha nem jár modellhívással" feltétel már ma teljesül.

A tényleges hiba a hívási láncban van:

1. `src/refine/loop.ts` `generate()` — a modellhívás után **azonnal** lefuttatja
   a `recipe.postprocess`-t;
2. a `clean` receptnél ez az `anchorParagraphs` (`src/recipe/clean.ts:68`);
3. az `anchorOne` (`anchor.ts:122`) az **első** bizonytalan bekezdésnél dob
   (`:130` túl rövid, `:137` gyenge egyezés vagy fölény);
4. a kivétel a `processItem` catch ágáig fut fel (`src/pipeline.ts:332`), ahol
   `item:failed` lesz belőle, **a nyers modellkimenet mentése nélkül** — a
   `store.recordArtifact(..., 'failed', null, message)` hívás útvonalként
   `null`-t ad.

A mai állapotban tehát egy gyengén illeszkedő bekezdés a teljes, már kifizetett
tisztított leiratot eldobja.

### A nyelvazonosító már létezik, csak nem itt fut

Az `identifyLanguage` (`src/lang/identify.ts:79`) determinisztikus,
nulla tokenes, függőség nélküli. Ma **egyetlen** fogyasztója van: a
`src/rubric/language.ts`, amely a **modell kimenetének** nyelvét méri az
átirathoz.

Az `item.language` (`src/types.ts:62`) a feliratfájl nevének utótagjából
töltődik (`src/source/folder.ts:59-76`: `Beszéd.en.srt` → `en`), és `null`
marad, ha a fájlnévben nincs nyelvkód. Ilyenkor a `languageName`
(`src/lang/identify.ts:106-109`) **csendben angolt** ad.

### A bíró kikapcsolása a meglévő határon vág

A `scoreRubric` (`src/rubric/types.ts:51`) két lépcsős: előbb a blokkoló kapuk
(`:63`), utánuk a pontozók (`:71`). A produkciós kritériumok besorolása:

| kritérium | blokkoló | hív modellt |
|---|---|---|
| `formatCriterion` (`src/rubric/format.ts:58`) | igen | nem |
| `languageCriterion` (`src/rubric/language.ts`) | igen | nem |
| `fidelityCriterion` (`src/rubric/fidelity.ts:64`) | igen | nem |
| `judgeCriterion`-ből épülők (`src/rubric/judge.ts:34`) | **nem** | **igen** (`client.generateObject('judge', …)`) |

A kettő tehát pontosan egybeesik: minden blokkoló kapu determinisztikus, és
minden modellhívó kritérium pontozó. A „bíró kikapcsolása" így nem új
szétválasztást igényel, csak a pontozó ág kihagyását.

### A konzol ma néma a generálás alatt

A `render` (`src/cli.ts:106`) `switch`-e nem kezeli az `item:generating` és
`item:scored` eseményt, tehát azok a `default: return null` ágon kiesnek. A
terminálon a futás leghosszabb szakasza — a modellhívás — alatt **semmi nem
jelenik meg**; a következő sor csak az `item:refined`-nél jön.

A JSONL napló ezzel szemben minden eseményt kiír, és **minden sorhoz ad `at`
időbélyeget** (`src/run/log.ts:33`), tehát a lépésenkénti időzítés ott már ma
kiszámolható.

### A körönkénti bontás már elkészül, csak nem jut el a naplóig

A `refine` visszaadja a `rounds` tömböt (`src/refine/loop.ts` `RoundTrace`:
pontszám, hiányszám, generálás és pontozás token-felhasználása külön). A
`runRecipe` ezt ma **csak** a költség összegzésére használja
(`src/pipeline.ts:192-198`), az `item:refined` esemény nem viszi tovább.

A `RoundTrace.gaps` eleve **szám**, nem szöveg — a körönkénti bontás naplózása
tehát nem sérti a vault-tartalom tilalmát.

## Kiindulási állapot

- `src/cli.ts:193`, `:455`, `:456` — a beégetett `docs(videos)` üzenetek;
  `:106` — `render`; `:206` — `commandCheckPricing`; `:246` — `commandRun`;
  `:284` — `depsFor`; `:719` — a `parseArgs` kapcsolólistája; `:746` — a
  `check-pricing` ág.
- `src/cli.test.ts:1179`, `:1777`, `:1864` és `src/e2e.test.ts:226`, `:359`,
  `:360` — a `docs(videos)` szövegre épülő elvárások.
- `src/recipe/anchor.ts:122` — `anchorOne` (dob); `:154` — `anchorParagraphs`;
  `:21-22` — a **becsült, nem mért** `MIN_SCORE` / `MIN_MARGIN` küszöbök.
- `src/recipe/anchor.test.ts:65`, `:70` — a két eset, amely ma **dobást vár**.
- `src/recipe/clean.ts:68` — `postprocess`; `src/refine/loop.ts` — `generate()`
  és a két `scoreRubric` hívás; `src/pipeline.ts:332` — a recepthiba catch ága.
- `src/recipe/types.ts:41` — `Recipe`; itt él a `headingsAreContent` precedens,
  amelyet az új `anchored` mező követ.
- `src/vault/render.ts:22` — `mergeTags` (a metaadat-címkéket extra címke nélkül
  **érintetlenül** adja vissza); `:56` — a `tags` mező.
- `src/vault/lint.ts` — ma **nem** ellenőrzi a címkéket.
- `src/rubric/types.ts:51` — `scoreRubric`; `:63` — a kapuk; `:71` — a pontozók.
- `src/config.ts:206` — `ModelSchema`; `:245` — `loadModelConfig`; `:110` —
  `readConfigFile` (a nyers szöveget **eldobja**, csak az elemzett objektumot
  adja).
- `src/model/pricing-check.ts:69` — `comparePricing`; `:48` —
  `PricingMismatch`.
- `refinery.config.yaml` / `refinery.config.example.yaml` — a `pricing:` blokk
  flow-stílusú (`{ input_per_million: …, output_per_million: … }`), fölötte
  dátumozott, magyarázó megjegyzéssel.
- `src/lang/identify.ts:79` — `identifyLanguage`; `:106` — `languageName`.
- `src/pipeline.ts:65` — `normalizeItem`; `:336`, `:359`, `:369` — az
  `item:failed` kibocsátásai.
- `src/events.ts:22` — `item:failed`; `:70` — `item:refined`.
- `package.json:2` — `"name": "transcript-refinery"`.

## 1. Az app commit-üzenetének scope-ja

A három beégetett üzenetben a `videos` helyére az app neve kerül:

| hely | ma | ezután |
|---|---|---|
| `src/cli.ts:193` | `docs(videos): feldolgozási sor frissítése` | `docs(transcript-refinery): feldolgozási sor frissítése` |
| `src/cli.ts:455` | `docs(videos): N jegyzet a feldolgozási sorból` | `docs(transcript-refinery): N jegyzet a feldolgozási sorból` |
| `src/cli.ts:456` | `docs(videos): átirat N videóhoz` | `docs(transcript-refinery): átirat N videóhoz` |

A név **nem** íródik be negyedszer is: egy konstans tartja
(`const COMMIT_SCOPE = 'transcript-refinery'`), hogy a következő átnevezés egy
helyen történjen.

Ez a szelet **nem** érinti a fejlesztői (emberi) commitok konvencióját: azok
továbbra is modul-alapú scope-ot használnak (`feat(evals)`, `docs(rubric)`),
vagy széles körű doksi-változásnál scope nélküli `docs:`-ot.

## 2. Horgonyzás: bekezdésenkénti visszaesés

Az `anchorParagraphs` a bizonytalan bekezdést **nem dobja el és nem is dob
kivételt**, hanem időbélyeg nélkül engedi át:

```ts
try {
  const anchored = anchorOne(paragraph, words, timed, cursor)
  out.push(anchored.text)
  cursor = anchored.cursor
} catch (error) {
  if (!(error instanceof AnchorError)) throw error
  // Bizonytalan illesztésnél a bekezdés időbélyeg nélkül megy át, a kurzor
  // pedig a helyén marad: bukott illesztésnél nincs hiteles új pozíció, és
  // az ablak (500 szó) innen a következő bekezdést még eléri. Egy rossz
  // illesztés így egyetlen bekezdés időbélyegét viszi, nem a jegyzetet.
  out.push(paragraph)
}
```

Következmények:

- **Az `AnchorError` többé nem hagyja el a függvényt.** A `clean` recept
  `postprocess`-e tehát nem tud elbukni, a `refine` loop és a `runRecipe`
  változatlanul fut, a jegyzet publikálódik.
- A „teljesen időbélyeg nélkül" eset külön ág nélkül adódik: ha minden bekezdés
  bukik, mindegyik időbélyeg nélkül megy át.
- A fejlécek kezelése változatlan (időbélyeg nélkül mennek át).
- Az `AnchorError` osztály **megmarad**: a hiba oka továbbra is megfogalmazódik,
  csak már nem terjed — a 7. pont naplózása ezt viszi ki (lásd lent).

### Két meglévő egységteszt viselkedése változik

Az `anchor.test.ts:65` („horgonyozhatatlan bekezdésnél dob") és `:70` („túl
rövid bekezdésnél dob") ma **dobást vár**. Mindkettő átíródik arra, amit a
szelet valójában akar: a bekezdés időbélyeg **nélkül** kerül a kimenetbe, és a
többi bekezdés időbélyege megmarad. Ez a szelet szándéka, nem mellékhatás.

### Amit a hívó megtud

Az `anchorParagraphs` aláírása **nem változik** (marad `(output, timed) =>
string`), és a `postprocess` sem kap visszahívást. A `postprocess` a `refine`
loop belsejéből fut (`src/refine/loop.ts` `generate()`), ahol nincs
eseménycsatorna — egy odáig fűzött callback a `Recipe` típusát és a
`RefineResult`-ot is átszabná, pusztán naplózásért.

Helyette a kihagyások száma a **kész kimenetből** olvasható ki, mert a
horgonyzott bekezdés mindig időbélyeggel kezdődik:

```ts
/** Hány prózabekezdés maradt időbélyeg nélkül a horgonyzott kimenetben. */
export function unanchoredParagraphs(anchored: string): number
```

Ez a fejléceket kihagyja (azok eleve időbélyeg nélküliek), és tiszta függvény
marad — a `runRecipe` hívja a publikálás előtt.

### Melyik recept horgonyoz

A számlálás csak az időbélyeges receptre értelmes: egy `summary` jegyzetben
minden bekezdés „időbélyeg nélküli" lenne. A recept **mondja meg magáról**, a
`headingsAreContent` mező precedensét követve (`decisions` szerint: beégetett
azonosítólista helyett a recept jelöli magát):

```ts
/** Ha igaz, a recept kimenete bekezdésenkénti időbélyeget kap. */
anchored?: boolean
```

A `cleanRecipe` állítja magáról (`anchored: true`); minden más recept
változatlan.

## 3. Címkék: aláhúzás a szóköz helyett

Az Obsidian a szóközt tartalmazó címkét hibásnak jelzi. A forrás-metaadat
(például a videó saját címkéi) viszont tartalmazhat ilyet.

A `mergeTags` (`src/vault/render.ts:22`) minden címkét megtisztít:

```ts
/** Obsidian-kompatibilis címke: a szóköz aláhúzásra vált. */
const sanitizeTag = (tag: string): string => tag.trim().replace(/\s+/g, '_')
```

A mai rövidzár (extra címke nélkül a metaadat listája **változatlanul** megy
vissza) megszűnik: a tisztítás a recept-címkéktől függetlenül, mindig lefut. A
függvény doc-kommentje ezzel együtt frissül — ma azt állítja, hogy a
metaadat-címkék érintetlenek maradnak.

A duplikátum-szűrés a **megtisztított** alakon történik, tehát a
`machine learning` és a `machine_learning` egyetlen címke lesz.

## 4. A bíró kikapcsolása

### A rubrika szintjén

```ts
export async function scoreRubric(
  rubric: Rubric,
  ctx: ScoreContext,
  client: ModelClient,
  opts: { skipJudge?: boolean } = {},
): Promise<RubricResult>
```

A kapuk lefutása után, a pontozók előtt:

```ts
// A kapuk determinisztikusak, tehát kikapcsolt bíró mellett is futnak; csak a
// modellhívó pontozók maradnak ki. A teljes pont ugyanaz, mint a pontozó
// nélküli rubrikánál.
if (opts.skipJudge) return { value: 1, gaps: [], usage }
```

Egy bukó kapu változatlanul 0-t ad a saját hiánylistájával — a kikapcsolás a
kapukat **nem** gyengíti.

### A loop szintjén

A `RefineOptions` új, elhagyható `skipJudge?: boolean` mezőt kap, amit mindkét
`scoreRubric` hívás továbbad. Külön megállási logika **nem** kell: a visszaadott
`value: 1` minden `passThreshold` fölött van, tehát a javító kör magától nem
indul el.

### A csővezeték és a CLI szintjén

- `RecipeDeps` (`src/pipeline.ts:23`) új `skipJudge?: boolean` mezője a
  `refine` hívásba megy.
- `ModelSchema.model` (`src/config.ts:206`) új kulcsa:
  `judge_enabled: z.boolean().default(true)`; a `ModelConfig` mezője
  `judgeEnabled: boolean`.
- `src/cli.ts` `parseArgs`: `'no-judge': { type: 'boolean' }` — **szándékosan
  `default` nélkül**, hogy a „nem adták meg" (`undefined`) megkülönböztethető
  legyen.
- A feloldás a `commandRun`-ban, a `modelConfig` betöltése után:

```ts
// A CLI elsőbbsége: a megadott kapcsoló felülírja a configot; hiányában a
// config dönt.
const skipJudge = flags.noJudge ?? !modelConfig.judgeEnabled
```

Mivel a `--no-judge` csak kikapcsolni tud, a „config kikapcsolta, de a CLI
visszakapcsolná" eset nem áll elő; ha erre később igény lesz, egy `--judge`
párkapcsoló a helye. Ez tudatos egyszerűsítés.

## 5. `check-pricing --fix`

Új, tiszta függvény a `src/model/pricing-check.ts`-ben, amely **a forrás
YAML-szövegen** szerkeszt, nem az elemzett objektumból épít újat — így a
megjegyzések, a kulcssorrend és a flow-stílus megmarad:

```ts
import { isMap, parseDocument } from 'yaml'

/** Két tizedes: a config ebben a formában tartja az árakat, és a
 *  token-alapú élő árból visszaszorozva lebegőpontos zaj keletkezhet. */
const round2 = (value: number): number => Math.round(value * 100) / 100

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

A meglévő csomópont **értékeit** állítjuk (`node.set`), nem cseréljük magát a
csomópontot — ez őrzi meg a `{ … }` alakot.

A `commandCheckPricing` kiegészül:

```ts
export async function commandCheckPricing(
  modelConfig: ModelConfig,
  opts: { fix?: boolean; configPath?: string } = {},
): Promise<number>
```

Eltérés **és** `--fix` esetén beolvassa a config nyers szövegét, átírja, és
`writeFileAtomic`-kal visszaírja, majd kiírja, melyik szerep ára változott. A
visszatérési kód ilyenkor **0** — a javítás után nincs mit jelenteni.

A nyers szöveg olvasásához a `src/config.ts` új, egysoros exportot kap
(`readConfigText`): a mai `readConfigFile` a szöveget eldobja.

Az `--fix` a `parseArgs` kapcsolói közé kerül (`fix: { type: 'boolean',
default: false }`), és a `main()` a már meglévő `configPath` változót adja át.

## 6. Nyelvazonosítás hiányzó nyelvkódnál

A `normalizeItem` (`src/pipeline.ts:65`) a normalizált szöveg előállítása után:

```ts
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

- A **siker** a `SourceItem` mezőjét tölti, tehát minden későbbi fogyasztó (a
  frontmatter `language` mezője, a prompt nyelvi szabálya) a felismert nyelvet
  kapja.
- A **bizonytalanság** hibát dob. Ez a meglévő hibaúton fut: a `processItem`
  külső catch ága `item:failed`-et ír mindkét érintett műtermék-típusra
  (`src/pipeline.ts:348-377`), tehát az elem megnevezett hibával áll meg, nem
  csendben angol jegyzetként.
- A `languageName` **változatlan**: ott az angol tartalék továbbra is helyes —
  oda már csak ismert vagy szándékosan hiányzó taggel jutunk el.

Az `identifyLanguage` küszöbei (`MIN_RATE`, `MIN_MARGIN`) változatlanok: a
modul eleve „nem találgat" elven működik, és most épp erre a tulajdonságára
építünk.

## 7. Részletesebb naplózás

### A JSONL naplóban

| esemény | ma | ezután |
|---|---|---|
| `item:failed` | `error` (üzenet) | `+ stack?: string` — a hívási lánc, a diagnózishoz |
| `item:refined` | összesített `score`, `generations`, `usd` | `+ rounds[]`: körönként pontszám, hiány**szám**, és a generálás/pontozás token-felhasználása külön |

A `rounds` a `refine` már meglévő `RoundTrace` tömbjéből képződik
(`src/pipeline.ts:192`), tehát **nem új mérés**, csak a meglévő adat kivezetése:

```ts
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
```

Új esemény a 2. ponthoz:

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

Csak **szám**, szöveg nélkül: a kihagyás okát az `anchorOne` üzenete tartalmazná
a bekezdés első 40 karakterével, az pedig vault-tartalom lenne a naplóban. Az
esemény csak akkor megy ki, ha `count > 0` és a recept `anchored`.

### A konzolon

A `render` (`src/cli.ts:106`) három új esetet kap, hogy a futás leghosszabb
szakasza ne legyen néma:

| esemény | konzolsor |
|---|---|
| `item:start` | `▸ <itemId>: <cím>` |
| `item:generating` | `  … <itemId>: <recept> generálás #<n>` |
| `item:scored` | `  · <itemId>: <recept> kör ${score}, <n> hiány` |
| `item:anchor-skipped` | `  ! <itemId>: <n>/<összes> bekezdés időbélyeg nélkül` |

A meglévő sorok formátuma **változatlan**.

## Amihez nem nyúlunk

- Az `anchorOne` illesztési logikája és küszöbei (`MIN_SCORE`, `MIN_MARGIN`):
  ezek kalibrálása külön kör, valódi méréssel.
- Retroaktív újra-horgonyzó eszköz a már publikált jegyzetekhez.
- A `maxIterations` (mindhárom recepten `0`), a promptok, a `passThreshold`.
- A `comparePricing` összevetési logikája és a toleranciája.
- A `languageName` angol tartaléka.
- A webes felület és a riport szerkezete.
- A fejlesztői (emberi) commitok scope-konvenciója.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom:

1. `pnpm test` zöld.
2. Egy futás, amely a vaultba commitol, `docs(transcript-refinery): …` kezdetű
   commitot hagy maga után; `git log --format=%s` egyetlen `docs(videos)`
   sort sem ad.
3. Egy olyan tisztított leirat, amelynek egyetlen bekezdése sem horgonyozható,
   **publikált jegyzetként** jelenik meg a vaultban (ma `item:failed`), és a
   szövege hiánytalan, csak időbélyeg nélküli.
4. Egy olyan tisztított leirat, amelynek a középső bekezdése nem horgonyozható,
   **megkapja az összes többi bekezdés időbélyegét**, és a naplóban egy
   `item:anchor-skipped` esemény áll `count: 1`-gyel.
5. Egy `machine learning` címkéjű forrásból készült jegyzet frontmatterében
   `tags: [machine_learning]` áll, és az Obsidian nem jelez hibát a címkére.
6. `refinery run --recipe clean --no-judge` egyetlen `judge` szerepű
   modellhívást sem indít (a riport `judge` költése 0,00 $), a jegyzet mégis
   elkészül; egy formátumhibás kimenet viszont továbbra is elbukik a kapun.
7. `model.judge_enabled: false` mellett ugyanez történik kapcsoló nélkül is, és
   `--no-judge` a `judge_enabled: true` configot is felülírja.
8. `npx refinery check-pricing --fix` egy elavult árú configon 0-val tér vissza,
   a `pricing:` blokk fölötti megjegyzés és a `{ … }` alak megmarad, és a
   következő `check-pricing` már egyezést jelent.
9. Egy nyelvkód nélküli, magyar nyelvű feliratfájl jegyzetének frontmatterében
   `language: hu` áll.
10. Egy nyelvkód nélküli, felismerhetetlen nyelvű feliratfájl `item:failed`-del
    áll meg, és a hibaüzenet megnevezi a fájlt és az okot — a vaultba nem kerül
    jegyzet.
11. Egy futás konzolkimenete a modellhívás alatt is halad: minden generálás
    előtt megjelenik egy sor.
12. A futás JSONL naplójában az `item:refined` sor körönkénti token-bontást
    tartalmaz, és egy elbukott elem sora `stack` mezőt is visz.

## Megkötések

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet;
  angol produkciós azonosító, prompt és hiányüzenet.
- **Nulla új függőség.** (A `yaml` csomag már közvetlen függőség: `^2.9.0`.)
- Nincs valódi modellhívás ebben a szeletben.
- A vault-tartalom naplóba írásának tilalma **kivétel nélkül** érvényben marad:
  a bővített események mind számot visznek, szöveget nem.
