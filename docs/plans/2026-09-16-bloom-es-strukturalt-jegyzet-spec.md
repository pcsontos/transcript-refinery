# Spec — Bloom-taxonómiás kártyák és strukturált jegyzet

**Dátum:** 2026-09-16 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a Fázis 6 **második szeletét** specifikálja: két új receptet,
egy közös speccel és tervvel. Az első szelet (tisztított leirat) kész; a
harmadik — fordítás fordítási memóriával — külön szelet marad, saját speckel.

A két recept mintája két vault-skill (`flashcards-generator`,
`study-notes-creator`) — **mintaként, nem szó szerinti portként**. Ahol a skill
ütközik a projekt invariánsaival (több fájl, wikilink), az invariáns nyer.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

Egy videóból két új tanulási anyag készül: egy Bloom-szintekre tagolt
kártyapakli, amit a vault Decks-pluginje paklinak ismer fel, és egy
fogalmakra, példákra és összefoglaló táblázatra épülő strukturált jegyzet.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| A Bloom-kártya viszonya a `flashcards`-hoz | **Önálló új recept**, nem bővítés | Kifejezett kérés a négy recept tervezésekor |
| A strukturált jegyzet alakja | **Egy fájl**, szakaszokkal | A motor receptenként egy fájlt ír; a több fájl motorszintű változás lenne |
| Átiraton túli tartalom | **Megengedett pedagógiai tartalom**, szerkezetileg jelölt zónákban | A példa és az alkalmazás értéke a túllépésben van |
| A túllépés határa | A szabad zóna **nem mondhat ellent** az átiratnak, és nem adhat a beszélő szájába állítást | Egy tananyagban az átirattal ellentétes magyarázat a legrosszabb hibamód |
| Kártyaméret | **Közepes**: válasz + rövid magyarázat + szint- és nehézségcímke, szintenként 3–5, összesen 18–30 | Tanulási érték a Decks 500 karakteres sűrűségi határa körül |
| A szint helye | **Címke a kártya hátulján**, lapos `##` kártyák szintsorrendben | A Decks alapbeállításával működik, pluginkonfiguráció nélkül |
| `#decks` címke | **Receptmező, a `bloom` és a `flashcards` is megkapja** ebben a szeletben | A `flashcards` javítása ugyanerre a varratra épül |
| Kötelező jegyzetelemek | **Példa + variáció** fogalmanként, **összefoglaló táblázat** | — |
| Nem kötelező elemek | **Mermaid kérve, kapu nélkül; gyakorlófeladat nincs** | A gyakorlást a Bloom-pakli Apply–Create kártyái adják |
| Megközelítés | **Mindkét recept sémás**, a Markdownt a renderer írja | A kötelező elemek szerkezeti garanciák, nem kapun múlnak; a bíró szerkezeti címkékre támaszkodik |
| Költségbecslő | **Változatlan**, receptenkénti kezdő `outputRatio` | A köteg egészére biztonságos irányba téved (lásd alább) |
| Kalibrálás | **A szelet végén**, külön jóváhagyással, $1 plafonnal | Olcsó, és az eredmény közvetlenül a becslőbe kerül |
| PR-szerkezet | **Két PR egymás után**: előbb spec + terv, majd a kód a friss `main`-ről | Korábbi kifejezett kérés; a #33 egyszeri kivétel volt |

## Amit a tervezés előtt megmértünk és ellenőriztünk

### A korpusz

A `refinery.config.yaml` forrásmappája alatt **19 felirat** van, mind angol
`.srt`. A tisztított leirat specjének 154 elemes számai a korábbi korpuszra
vonatkoznak; a felhasználó megerősítette, hogy a 19 elem az érvényes.

| | |
|---|---|
| normalizált szó / elem | medián **4050**, min 1926, max 22 477 |

### A Decks-plugin

A vaultban a DecksMD 2.9.3 fut (`.obsidian/plugins/decks`), a dokumentációja
(`decksmd.app/docs/cards/header-paragraph/`) és a beállításai szerint:

- A kártya eleje a beállított szintű címsor, **alapból `##`**; a hátulja
  minden, ami a következő azonos szintű címsorig tart.
- A beállított szint fölötti címsorok (a jegyzet `#` címe) nem kártyák, hanem
  morzsamenü.
- A címsorszint profilonként, azaz címkénként állítható.
- Paklinak csak a **`#decks` címkével** jelölt jegyzet számít (`deckTag`).
- A sűrűségi határ **500 karakter** (`denseCardCharThreshold`).
- Ismétléskor a plugin horgonyokat ír a jegyzetbe (`%%dk:h:…%%`).

**Mellékes lelet:** a `render.ts:35` a frontmatter `tags` mezőjét kizárólag a
videó metaadat-címkéiből tölti ki, a `flashcards` renderer nem ír címkét. A
kód szerint tehát a mai `flashcards` jegyzeteket a Decks **nem ismeri fel
paklinak**. A gyakorlatban ez még nem jött elő: a vaultban egyetlen
`_flashcards.md` sincs.

A horgonyok miatti munkafa-módosítás nem akasztja meg a futást: az `isDirty`
(`vault/git.ts:20`) éles kódban nincs hívva, a publisher pedig csak a saját
útvonalait commitolja (`vault/git.ts:30`).

### Mi történik egy elbukott kapuval

A `scoreRubric` az első elbukott blokkoló kritériumnál 0-t és a hiánylistát
adja vissza (`rubric/types.ts:63`). A `passThreshold`-ot éles kódban csak a
loop (`refine/loop.ts:110`) és a felület olvassa; a `pipeline.ts` a
pontszámtól függetlenül publikál. **`maxIterations: 0` mellett tehát egy
kapuhiba 0-s pontszámú, megnevezett hiányú, publikált jegyzetet jelent**, míg
egy sémahiba `item:failed`-et, publikálás nélkül (`recipe/structured.ts:29`).

### A sémás kérés szigorú

A #18 óta a sémás kérés `json_schema`-ként megy ki
(`model/client.ts`, `supportsStructuredOutputs: true`), és az SDK alapból
`strict: true`-t küld mellé (`@ai-sdk/openai-compatible@3.0.43`,
`dist/index.js:533`, `:573`). Strict módban egy
`required`-ből hiányzó, opcionális mező a gatewaytől függően elutasítható. Ezt
nem próbáltuk ki, ezért **a sémákban nincs opcionális mező**: ahol a hiány
megengedett, üres string jelzi.

### Költség

A repó saját becslőjével (`estimateItemUsd`), egy generálással, két bíróval, a
19 elemen. A két új kimenet közel **fix méretű** (kártya- és fogalomszám), a
becslő viszont a bemenet **arányában** számol. A táblázat a medián elemre
beállított arány hibáját mutatja egy fix kimeneti méret feltevése mellett
(bloom: 30 kártya × 100 szó; notes: kb. 1200 szó):

| | kezdő arány | legrövidebb elem | medián | leghosszabb | 19 elem: becslés / „valós” |
|---|---|---|---|---|---|
| `bloom` | 0,74 | 0,58× | 1,00× | 2,22× | **$2,17 / $1,68** |
| `notes` | 0,30 | 0,68× | 1,00× | 1,58× | **$1,30 / $1,11** |

A rövid elemeket a becslő néhány centtel alulbecsli, a hosszúakat
felülbecsli; **a köteg egészére biztonságos irányba téved.** Egy mégis
túlfutó köteget a [`0004`](<../decisions/0004-koltsegplafon.md>) második
rétege, a futás közbeni token-őr állít meg.

**A mérés korlátja, kimondva:** a kártyánkénti és a jegyzetenkénti szószám
feltevés, nem mérés. A valós arányt a kalibráló futás adja.

## Kiindulási állapot

- `src/recipe/types.ts:41` — a `Recipe`; `outputRatio?` (`:62`), `structured?`
  (`:70`), `postprocess?` (`:77`). Címkemező nincs.
- `src/recipe/flashcards.ts:48` — `escapeHeadings`, `:88` — `parseCards`,
  `:112` — `checkFlashcards`; mindhárom modul-privát vagy a recepthez kötött.
- `src/recipe/rules.ts:14` — `RULE.traceable`, minden recept idézi.
- `src/rubric/judge.ts:34` — a `judgeCriterion` gyártó; `:51` — a
  `faithfulnessCriterion`.
- `src/vault/render.ts:35` — a `tags` csak a metaadatból; `:79` —
  `renderRecipeNote`, `:63` — `RecipeNoteMeta`.
- `src/pipeline.ts:179` — az egyetlen éles `renderRecipeNote`-hívás.
- `src/run/report.ts:62` — `escapeTableCell`, modul-privát.
- `src/run/plan.ts:84` — a becslés a receptből veszi az `outputRatio`-t, a
  bírók számát a rubrikából (`:87`).
- `src/recipe/registry.ts:15` — statikus registry.
- `src/cli.ts:168` — a `scan --queue` a `RECIPE_IDS`-ből dolgozik, tehát az új
  receptek sorai registry-bejegyzéssel együtt megjelennek.
- `web/app/utils/format.ts:1` — beégetett magyar típuscímkék.
- `evals/fixture-model.ts` — a `draft` szerep szöveget ad; az `Output.object`
  ezt JSON-ként olvassa, tehát sémás recept evalja JSON-szöveget ad át.

## 1. Közös modulok

Két új fájl, **viselkedésváltozás nélküli** kiemeléssel a `flashcards.ts`-ből:

- **`src/recipe/markdown.ts`** — `escapeHeadings(text: string): string`,
  változatlan logikával (ATX három szóköz behúzásig, setext aláhúzás szövegsor
  alatt). Mindkét új recept és a `flashcards` innen importál.
- **`src/recipe/cards.ts`** — `parseCards(output)` és
  `checkCardBasics(cards): string[]` (üres hátoldal, ismétlődő kérdés). A
  hiányüzenetek szövege **bájtra azonos** a maival, mert a javító promptba és a
  felületre mennek.

A `flashcards` darabszám-ellenőrzése (legalább három kártya) a receptben
marad. A `flashcards.test.ts` változatlanul zöld — ez bizonyítja a kiemelés
viselkedéssemlegességét.

A táblázatcella-escape (`report.ts:62`) **nem** költözik: a `run/` réteget
egy receptmodulból importálni rétegsértés lenne, a két soros szabály pedig a
jegyzet rendererében saját tesztet kap.

## 2. Címkevarrat

```ts
export interface Recipe {
  /* ...a mai mezők változatlanul... */
  /**
   * A jegyzet frontmatterjébe kerülő címkék, a videó metaadat-címkéi után.
   * A Decks-plugin a `decks` címkéből ismeri fel a paklit.
   */
  tags?: readonly string[]
}
```

A `RecipeNoteMeta` ugyanilyen `tags?` mezőt kap, a `pipeline.ts:179` a
receptből tölti ki. A `renderRecipeNote` a `tags` mezőt így állítja elő:

- a metaadat-címkék **érintetlenül, a mai sorrendben**;
- utánuk a recept címkéi, **csak ha még nincsenek a listában**;
- ha az eredmény üres, a mező kimarad — pontosan ahogy ma.

Így a `summary`, a `qa` és a `clean` frontmatterje **bájtra változatlan**; a
`flashcards` és a `bloom` `tags: ['decks']`-t kap. A `renderTranscriptNote`
nem változik.

## 3. Pedagógiai hűség

### A prompt-szabály

A `rules.ts` új függvényt kap; a `RULE.traceable` érintetlen marad:

```ts
/** A két tanulási recept hűségszabálya: a szabad zónákat a recept nevezi meg. */
export function pedagogicalRule(freeParts: string): string
```

Tartalma angolul: minden, ami azt írja le, amit a videó mond, legyen
visszavezethető az átiratra; a megnevezett szabad zónák túlmehetnek rajta
alkalmazással, példával, kontextussal, de **soha nem mondhatnak ellent** az
átiratnak, és nem tulajdoníthatnak a beszélőnek olyat, amit nem mondott.

### A bíró

A `judge.ts` új gyártót kap a `judgeCriterion` fölött:

```ts
export function pedagogicalFaithfulnessCriterion(freeParts: string): Criterion
```

- Név: `pedagogical-faithfulness`.
- A szabad zónákat **nem bünteti** azért, mert túlmennek az átiraton; csak
  ellentmondásért, vagy ha a beszélőnek tulajdonítanak el nem hangzott
  állítást.
- Minden más részre a mai `faithfulness` mércéje érvényes.
- Minden hiány külön tétel, idézettel, és megnevezi, hogy alátámasztatlan vagy
  ellentmondó.

A szabad zónákat a **renderer által írt** címkék jelölik ki, ezért a bíró
szerkezeti jelre támaszkodik, nem a modell megfogalmazására.

## 4. A Bloom-recept

Fájl: `src/recipe/bloom.ts`.

| mező | érték |
|---|---|
| `id` | `bloom` |
| `outputFile` | `_bloom.md` |
| `publishable` | `true` |
| `role` | `draft` |
| `maxIterations` | `0` |
| `outputRatio` | `0.74` (kezdőérték, a kalibrálás felülírja) |
| `tags` | `['decks']` |

### Séma

```ts
export const BLOOM_LEVELS = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
] as const

export const BloomSchema = z.object({
  cards: z
    .array(
      z.object({
        level: z.enum(BLOOM_LEVELS),
        difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
        explanation: z.string().trim().min(1),
      }),
    )
    .min(1),
})
```

A darabszám-szabály (szintenként 3–5) **szándékosan nem a sémában** van: a
sémahiba `item:failed`, nyom nélkül; a kapu viszont megnevezett hiánnyal,
látható 0-s pontszámmal publikál.

### Renderer

Szintsorrend (`BLOOM_LEVELS`), szinten belül a modell sorrendje (stabil
rendezés). Kártyánként:

```
## <kérdés, a sortörések szóközzé olvasztva>

<answer, escapeHeadings>

**Why:** <explanation, escapeHeadings>

*Apply · Intermediate*
```

A címkesor mindig a kártya **utolsó** sora, nagy kezdőbetűs angol szint- és
nehézségnévvel, `·` (U+00B7) elválasztóval.

### Kapu: `bloom-format`

Blokkoló, nulla token. A renderelt szövegből, a `cards.ts` elemzőjével:

1. `checkCardBasics` — üres hátoldal, ismétlődő kérdés.
2. Minden kártya utolsó nem üres sora szabályos címkesor; ha nem, hiány
   (a renderer hibája elleni védőréteg).
3. Mind a hat szinten **3–5 kártya**; eltérésnél szintenként egy hiány, a
   mért darabszámmal:
   `The level "Apply" has 2 card(s). Write 3 to 5 cards for every level.`

### Prompt

Angolul, a `flashcards` szerkezetében (`prompt` és `repairPrompt` ugyanazt a
`rules`-t idézi):

- `languageRule(item)`
- `pedagogicalRule(...)`: szabad az Apply, Analyze, Evaluate és Create kártyák
  kérdése és válasza, valamint minden magyarázat; a Remember és Understand
  kártyák kérdése és válasza az átiratból.
- A hat szint egy-egy sorban, a skill igéivel (Remember: define, identify,
  recall; … Create: design, formulate, synthesize).
- Szintenként 3–5 kártya.
- Nehézség: beginner / intermediate / advanced, nagyjából 40/40/20 arányban
  (kérés, nem ellenőrzött szabály).
- A kérdés önmagában, a videó nélkül is érthető.
- Egy–két mondatos válasz, két–három mondatos magyarázat.
- Nincs ismétlődő kérdés.
- `RULE.noFrontmatter`, `RULE.noWikilinks`.

### Rubrika

```
[formatCriterion, bloomFormatCriterion, languageCriterion,
 pedagogicalFaithfulnessCriterion(BLOOM_FREE_PARTS), coverageCriterion]
passThreshold: 0.8
```

`BLOOM_FREE_PARTS`: az Apply, Analyze, Evaluate és Create címkesorú kártyák
kérdése és válasza, valamint minden `**Why:**` kezdetű bekezdés. A kérdés
azért szabad, mert ezeken a szinteken maga a kérdés állít fel új helyzetet
(„Design a pipeline that…”), ami az átiratban nem szerepel.

## 5. A strukturált jegyzet

Fájl: `src/recipe/notes.ts`.

| mező | érték |
|---|---|
| `id` | `notes` |
| `outputFile` | `_notes.md` |
| `publishable` | `true` |
| `role` | `draft` |
| `maxIterations` | `0` |
| `outputRatio` | `0.30` (kezdőérték, a kalibrálás felülírja) |
| `tags` | nincs |

### Séma

```ts
export const NotesSchema = z.object({
  summary: z.string().trim().min(1),
  /** Mermaid-forrás kerítés nélkül; üres string = nincs diagram. */
  diagram: z.string().trim(),
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        definition: z.string().trim().min(1),
        explanation: z.string().trim().min(1),
        example: z.string().trim().min(1),
        variation: z.string().trim().min(1),
      }),
    )
    .min(3),
})
```

### Renderer

````
<summary>

## Overview

```mermaid
<diagram>
```

## Key Concepts

### <name>

<explanation>

**Example:** <example>

**Variation:** <variation>

## Summary Table

| Term | Definition | Example |
| --- | --- | --- |
| <name> | <definition> | <example> |
````

- **Az Overview szakasz kimarad**, ha a `diagram` üres.
- **A diagram kerítése:** ha a modell mégis bekerítette (a string
  ```` ``` ````-lel vagy ```` ```mermaid ````-del kezdődik és ```` ``` ````-lel
  végződik), a renderer leszedi. Ha ezután is marad benne ```` ``` ````-lel
  kezdődő sor, a diagram kimarad — egy félbevágott kerítés különben a jegyzet
  hátralévő részét kódblokká tenné.
- **A táblázat a `concepts`-ből épül**, soronként egy fogalommal; a modell nem
  írja külön, ezért nem is térhet el a szakaszoktól. Cellánként: sortörés →
  szóköz, `|` → `\|`.
- A `summary`, `explanation`, `example` és `variation` `escapeHeadings`-en megy
  át; a `name` sortörései szóközzé olvadnak.

### Kapu

**Nincs saját kapu.** A kötelező elemeket (példa, variáció, táblázat) a séma és
a renderer garantálja; egy ellenőrző kapu csak a renderer saját tesztjét
ismételné. A `formatCriterion` (kerítés-párosság, link-alak) és a
`languageCriterion` a mai módon fut.

### Prompt

Angolul, a `summary` szerkezetében:

- `languageRule(item)`
- `pedagogicalRule(...)`: szabad a példa és a variáció; az összefoglaló, a
  definíció, a magyarázat és a diagram az átiratból.
- 3–8 kulcsfogalom.
- Egymondatos definíció, 2–4 mondatos magyarázat.
- 1–2 mondatos konkrét példa; a variáció `What if …? → …` alakú.
- Diagram akkor, ha a tartalomban van folyamat, szerkezet vagy összefüggés
  (flowchart, sequence, mindmap), **kerítés nélkül**; egyébként üres string.
- `RULE.noFrontmatter`, `RULE.noWikilinks`.

### Rubrika

```
[formatCriterion, languageCriterion,
 pedagogicalFaithfulnessCriterion(NOTES_FREE_PARTS), coverageCriterion]
passThreshold: 0.8
```

`NOTES_FREE_PARTS`: minden `**Example:**` és `**Variation:**` kezdetű bekezdés,
valamint a Summary Table `Example` oszlopa.

## 6. Registry, felület, sor, eval

- `registry.ts`: receptenként egy import és egy bejegyzés.
- `web/app/utils/format.ts`: `bloom: 'Bloom-kártya'`, `notes: 'strukturált
  jegyzet'`.
- A `scan --queue` videónként beszúrja a `bloom` és a `notes` sort; a meglévő
  pipákhoz nem nyúl.
- `evals/bloom.eval.ts` és `evals/notes.eval.ts` a `clean.eval.ts` mintáján,
  fixture-modellen, offline: a `draft` a séma szerinti JSON-szöveget adja, a
  pontozás a teljes rubrikán fut.

## Megkötések

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet; angol
  produkciós azonosító, prompt, renderer-címke és hiányüzenet.
- **Nulla új függőség.** Mermaid-szintaxist nem ellenőrzünk.
- Minden teszt hálózat és API-kulcs nélkül fut, a meglévő hamis kliens mintáján.
- Recept nem kerülhet be a rubrikája nélkül.
- A mag nem ír konzolra és nem ír fájlt.
- A `summary`, `flashcards`, `qa` és `clean` promptja bájtra változatlan.
- Commit-sorrend: (1) közös modulok és a címkevarrat, a `flashcards`
  címkéjével; (2) pedagógiai szabály és bíró; (3) a `bloom` recept, registry,
  címke, eval; (4) a `notes` recept, registry, címke, eval; (5) kalibrálás és
  a végleges `outputRatio`.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom.

1. `run --recipe bloom --limit 1` olyan `_bloom.md`-t ír, amelynek
   frontmatterében ott a `decks` címke; a kártyák szintsorrendben állnak, mind
   a hat szinten 3–5 kártya van, és minden kártya `*Level · Difficulty*`
   sorral zárul. **Az Obsidianban a Decks paklinak ismeri fel** (kézi
   ellenőrzés).
2. `run --recipe notes --limit 1` olyan `_notes.md`-t ír, amelyben minden `###`
   alatt ott az Example és a Variation, a táblázat sorainak száma egyezik a
   fogalmakéval, és a vault-linter átengedi. Ha van diagram, az Obsidian hiba
   nélkül rajzolja ki (kézi ellenőrzés).
3. Egy új `flashcards` jegyzet frontmatterében ott a `decks` címke. A
   `summary`, `flashcards`, `qa` és `clean` összeállított promptja bájtra
   azonos a maival; a `summary`, `qa` és `clean` frontmatterje ugyanarra a
   bemenetre a `generated_at` időbélyeg kivételével bájtra azonos.
4. A futás előtti becslés a 19 elemre `bloom`-nál **$2,2**, `notes`-nál
   **$1,3** nagyságrendjében van.
5. Ha a modell nem a sémának megfelelő kimenetet ad, az elem `item:failed`
   lesz, a riport megnevezi az okot, a köteg végigmegy.
6. Ha egy Bloom-szinten 2 kártya van, a jegyzet **nulla bíró-hívással**, 0-s
   pontszámmal jelenik meg, és a hiány megnevezi a szintet és a darabszámot.
7. A `scan --queue` kétszer futtatva másodszorra bájtra azonos sort hagy.
8. A teljes teszt- és lint-futás zöld; `--dry-run` mellett a futás fájlt nem ír.

## Kalibrálás — a szelet végén, külön jóváhagyással

Becsült értékek ebben a specben: a két kezdő `outputRatio` (0,74 és 0,30), és
az, hogy a pedagógiai bíró valóban kíméli-e a szabad zónákat.

- **Futás:** 3 elem × 2 recept, valódi hívásokkal, a PR előtt.
- **Költség:** becsülten kb. $0,5; kétszeres ráhagyással **$1-es plafon**.
- **Indítás csak kifejezett jóváhagyás után**, előzetes becsléssel.
- **Kimenet:** a mért kimeneti arány receptenként, a bíró pontszámai és
  hiánylistái; a végleges `outputRatio` ugyanabba a PR-be kerül, a mérés pedig
  a `docs/measurements/` alá — gépnevek és útvonalak nélkül.

## Amit ez a szelet szándékosan nem tartalmaz

- **A fordítást fordítási memóriával** — külön szelet, saját speckel.
- **Több fájlos jegyzetet, README-indexet, wikilinket** — a motor egy
  receptenként egy fájlra épül, a wikilink tiltott.
- **Gyakorlófeladatot a jegyzetben** — a Bloom-pakli Apply–Create kártyái adják.
- **Mermaid-szintaxis ellenőrzését** — új függőséget igényelne.
- **Kapcsolódó fogalmakat és gyakorló-tippet a kártyán** — a közepes méret
  szándékosan hagyja el őket.
- **Decks-profil vagy pluginbeállítás módosítását** — a repón kívül esik; a
  választott alak az alapbeállítással működik.
- **Becslő-változást** (fix kimeneti méret) — a mért hiba a köteg egészére
  biztonságos irányú.
- **Új webes nézetet** — a felület csak a két típus magyar címkéjét kapja meg.
