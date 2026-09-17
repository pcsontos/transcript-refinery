# Spec — Fordítás

**Dátum:** 2026-09-17 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a Fázis 6 **negyedik, utolsó szeletét** specifikálja. A
roadmap „fordítás fordítási memóriával" néven vette fel; a memória a tervezés
előtti mérés alapján **kimarad** (lásd lent), a szelet neve ezért egyszerűen
fordítás.

Nem egy új recept, hanem **egy általános fordító recept**, amiből a konfig
szerint forrásreceptenként egy példány készül: `clean-hu`, `summary-hu`, és
így tovább.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

Bármelyik meglévő recept kész jegyzetéből a konfigban megadott célnyelvű
változat készül, ugyanabban a szerkezetben — időbélyegekkel, fejlécekkel,
kártyákkal, táblázattal —, és ezt egy nulla tokenes kapu ellenőrzi.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Mit fordít | **A teljes beszédet és a kivonatokat is** — bármelyik meglévő recept jegyzetét | Kifejezett kérés |
| Egy vagy több recept | **Egy általános kód, forrásreceptenként egy receptpéldány** | Saját státusz, pipa, költség és hiánylista fordításonként; az állapottár sémája és a sor formátuma változatlan |
| Hogyan adjuk meg | **Konfigkulcs** (`translate.to`, `translate.recipes`) | A sorban csak a kért fordítások pipái jelennek meg |
| Fordítási memória | **Egyelőre nincs** | A korpuszon a szöveg 0,16%-a ismétlődik videók között; szójegyzék akkor jön, ha a fordításokban tényleg látszik következetlenség |
| Hiányzó forrás | **Kihagyás, megnevezett okkal** — nincs kéretlen modellhívás | Csak az fut, amit kifejezetten kértél, és a költség előre látszik |
| Megközelítés | **Egész dokumentum egy hívásban, vázkapuval** | Általános, a `refine` loophoz nem nyúl; a darabolás csak mért időtúllépés után jön |
| Mihez mér a rubrika | **A forrásjegyzethez**, nem az átirathoz | A forrás már a saját rubrikáján átment; a fordítás hűsége a forráshoz mérhető |
| Renderer-címkék (`**Example:**`, `*Remember · Beginner*`) | **Fordulnak** | A jegyzet végig a célnyelven legyen; a vázkapu szerkezetet vet össze, nem címkét |
| Recept-azonosító | **`clean-hu`**, fájl: `_clean-hu.md` | A sor elemzője pontot nem enged az azonosítóban (lásd lent) |
| Elavulás | **Nincs automatikus**; a frontmatter rögzíti a forrás `generated_at`-jét, az újrafordítást a `--force` kéri | YAGNI; az eltérés látható |
| Webes forrásjegyzet-nézet | **Nem része a szeletnek** | A felület csak a fordítások címkéjét és sorait kapja meg |
| Kalibrálás | **A szelet végén**, külön jóváhagyással | Az `outputRatio` és a hosszú szöveg generálási ideje mért szám legyen |
| PR-szerkezet | **Két PR egymás után**: előbb spec + terv, majd a kód a friss `main`-ről | Korábbi kifejezett kérés, a #37/#39 mintája |

## Amit a tervezés előtt megmértünk és ellenőriztünk

### A korpusz

A `refinery.config.yaml` forrásmappája alatt ma **20 felirat** van: 19 angol
`.srt` és egy 2026-09-17-én hozzáadott **magyar** `.srt`.

Az állapottárban a `clean` recept eddig három elemen futott:

| normalizált szó | eredmény |
|---|---|
| 4050 | kész, $0,0955 (`claude-sonnet-5`) |
| 9989 | `item:failed` — `Headers Timeout Error`, három próbálkozás után |
| 22 477 | `item:failed` — a horgonyzás egy „Oh yeah." bekezdésen elbukott |

Kész `_clean.md` tehát **egy** van, 4050 szavas. A 9989 szavas hiba oka lehet
egy öt percnél hosszabb generálás (a kliens `generateText`-tel, válaszfolyam
nélkül hív, `model/client.ts:52`), de ez **nem ellenőrzött**, egyetlen
adatpont. A hosszú `clean` hibái a `clean` recept saját gondjai, ennek a
szeletnek nem része a javításuk — de korlátozzák, hány hosszú forrás lesz
fordítható.

### A magyar elem meglévő jegyzetei

A magyar elem `summary` és `qa` jegyzete kész, de **angolul** íródott, pedig a
prompt a kód szerint (`languageRule`, a `.hu` fájlnév-utótagból) magyar nyelvet
kért. A nyelvi kapu mindkettőt 0-ra pontozta
(`The output is written in English, but the transcript is in Hungarian…`), a
jegyzetek a pontszámtól függetlenül publikálódtak (`minimax-m3`). Két
következménye van erre a szeletre:

- Egy `summary-hu` ezt az angol jegyzetet **lefordítaná**, nem hagyná ki — a
  kihagyás a forrásjegyzet szövegén múlik, nem a metaadaton, és ez így helyes.
  A „forrás már a célnyelven" ágnak ezért ma nincs valós esete a korpuszban;
  fixture teszteli.
- Egy esetben a `minimax-m3` a kimondott magyar nyelvi utasítás ellenére
  angolul írt. Egy adatpont, nem mérés — de a célnyelv-kapu éppen ezt a
  hibamódot fogja, és a kalibrálás figyeli.

### Ismétlődés a videók között

A fordítási memória klasszikus formája (mondatpárok, modellhívás nélküli
újrahasznosítás) csak akkor spórol, ha a szövegek ismétlik egymást. Mérés a 19
angol feliraton, modellhívás nélkül, sorismétlés-szűréssel, 8 és 12 szavas
szakaszokra bontva:

| szakaszhossz | más videóban is előforduló szakasz |
|---|---|
| 8 szó | **0,16%** (190 / 115 264) |
| 12 szó | **0,11%** (123 / 115 275) |

A 13 csatornából egyedül egy csatorna három videójában van számottevő átfedés
(1,4–2,0%), és az is a visszatérő videózáró szöveg („subscribe if you haven't
already… free tech newsletter"). **A mondatpár-memória ezen a korpuszon
gyakorlatilag semmit nem spórolna.**

A szójegyzék haszna nem a spórolás, hanem a következetesség (például az
„agent" fordítása). Hogy a modell egy dokumentumon vagy videókon belül
ténylegesen következetlen-e, **nem mértük** — ezért marad ki, és ezért nem
zárjuk ki.

### Kimeneti korlát

A LiteLLM `/model/info` szerint (2026-09-17) a `minimax-m3` és a
`claude-sonnet-5` is **128 000** kimeneti tokent enged. A korpusz leghosszabb
átiratának (22 477 szó) fordítása is ez alá esik; **a korlát a hossz, nem a
tokenszám szempontjából lehet szűk** — ezt a kalibrálás méri.

### A sor recept-azonosítója

A feldolgozási sor receptsorának mintája `[A-Za-z0-9_-]+`
(`queue/line.ts:17`). Egy `clean.hu` azonosító nem illeszkedne, a pár nem
jelenne meg a sorban. Az azonosító ezért **`clean-hu`**; a sor elemzője
változatlan.

### Mi történik egy elbukott kapuval

A `pipeline.ts` a pontszámtól függetlenül publikál (`:179`), a `passThreshold`
csak a loopot és a felületet érinti. **`maxIterations: 0` mellett egy
kapuhiba 0-s pontszámú, megnevezett hiányú, publikált jegyzetet jelent**,
bíró-hívás nélkül — ugyanúgy, mint a Bloom-kapunál.

### A forrásjegyzetek valódi hossza

A becslő a fordítás bemenetét az átirat szószáma × a forrásrecept
`outputRatio`-ja alapján számolja. A vaultban lévő kész jegyzetek törzsének
szószáma az átirathoz mérve:

| forrás | mért arány (törzs / átirat) | a recept `outputRatio`-ja | a becslés iránya |
|---|---|---|---|
| `clean` | 1,02 | 1,05 | pontos |
| `notes` | 0,32 | 1,10 | 3,4× felül — biztonságos |
| `bloom` | 0,34 | 0,81 | 2,4× felül — biztonságos |
| `summary` | 0,06–0,27 | 0,1 (alapértelmezés) | rövid elemen 2,6× alul, hosszún felül |

A `summary` alulbecslése egy fordításon **egy centnél kisebb** összeg; a
futás közbeni token-őr ([`0004`](<../decisions/0004-koltsegplafon.md>) második
rétege) egy mégis túlfutó köteget megállít. Becslő-változás ezért nem kell.

### Költség

A repó képletével (`estimateItemUsd`), egy generálással, egy bíróval, a
becsült 1,5-ös kezdő `outputRatio`-val, egy 4050 szavas elemre:

| | `minimax-m3` + `grok-4-fast-reasoning` | `claude-sonnet-5` + `grok-4-fast-reasoning` |
|---|---|---|
| `clean-hu` | kb. $0,031 | kb. $0,116 |
| `summary-hu` | kb. $0,003 | kb. $0,012 |

Becsült számok. A magyar szöveg tokenaránya **nem mért**; az 1,5 szándékosan
magas kezdőérték, amit a kalibrálás felülír.

## Kiindulási állapot

- `src/recipe/types.ts:22` — `RecipeInput` (`transcript`, `timed`); `:41` —
  `Recipe`, forrásrecept-mező nincs.
- `src/recipe/registry.ts:17` — statikus `RECIPES`, `:26` — `RECIPE_IDS`,
  `:28` — `getRecipe`.
- A regiszter fogyasztói: `src/cli.ts:168` (`scan --queue`), `:263`
  (`--recipe`), `:388`, `:455` (riport), `:513` (sorból olvasott párok);
  `src/view/overview.ts:17`, `:64`, `:114`, `:150`; `src/view/items.ts:40`;
  `src/index.ts:32`.
- `src/config.ts:39` — `CoreSchema`; `:117` — `loadConfig`. A webes szerver is
  ezt hívja: `web/server/utils/refinery.ts:14`.
- `src/pipeline.ts:115` — `runRecipe`; `:134` — a `refine` hívása az
  átirattal; `:224` — `processItem`, `:238` — a „már feldolgozva" kihagyás.
- `src/refine/loop.ts:92`, `:121` — a pontozás viszonyítási alapja az
  `input.transcript`.
- `src/rubric/judge.ts:14` — a bíró promptja `--- TRANSCRIPT ---` és
  `--- NOTES UNDER REVIEW ---` szakaszokkal.
- `src/rubric/language.ts:18` — `checkLanguage` az átirat nyelvéhez mér;
  `src/lang/identify.ts:16` — hét nyelv, köztük a magyar.
- `src/rubric/format.ts:17` — `checkFormat`, recepttől független.
- `src/vault/render.ts:34` — `baseFields`, `:48` — `language` az elem
  nyelvéből; `:66` — `body()`: cím, 🌐 link, `---`, tartalom.
- `src/recipe/anchor.ts:105` — `formatTimestamp`: `[MM:SS]`, egy órán túl
  `[H:MM:SS]`.
- `src/run/plan.ts:61` — `estimateUnits`, `:72` — a szószám az átiratból,
  `:84` — az `outputRatio` a receptből.
- `src/queue/line.ts:17` — a receptsor mintája; `src/queue/status.ts:7`, `:8`
  — a `⏳` és `✗` státuszok.
- `src/events.ts:20` — `item:skipped` okkal.
- `src/run/report.ts:18` — `QueueRecipeStatus`, `:42` — `warnings`.
- `web/app/utils/format.ts:1` — beégetett magyar típuscímkék.

## 1. Konfig és regiszter

### Konfig

Új, elhagyható kulcs a `CoreSchema`-ban (a `scan --queue` és a felület modell
nélkül is ismeri):

```yaml
translate:
  to: hu
  recipes: [clean, summary, notes]
```

- Ha a kulcs hiányzik, a `Config.translate` `null`, és **nincs fordítórecept**.
- `to`: a `LANGUAGE_NAMES` egyik kulcsa; más érték betöltési hiba, ami
  felsorolja az ismert nyelveket.
- `recipes`: nem üres, ismétlés nélküli lista.

### Regiszter

A hat alaprecept statikus marad. Új függvény:

```ts
export function recipesFor(config: Pick<Config, 'translate'>): Record<string, Recipe>
```

Az alapreceptekhez hozzáfűzi a `translationOf(forrás, config.translate.to)`
példányokat, a lista sorrendjében. Beszédes hibával áll meg, ha a forrás:

- ismeretlen recept — felsorolja az ismert alapreceptek azonosítóit;
- maga is fordítás (például `clean-hu`);
- nem publikálható — annak nincs jegyzete, amiből fordítani lehetne.

A `RECIPES`/`RECIPE_IDS`/`getRecipe` modulkonstansok helyett a fogyasztók a
betöltött konfigból épített regisztert kapják. `translate` kulcs nélkül a
regiszter pontosan a mai hat recept, a mai sorrendben.

## 2. A fordítórecept

Új fájl: `src/recipe/translate.ts`.

```ts
export function translationOf(source: Recipe, target: LanguageTag): Recipe
```

| mező | érték |
|---|---|
| `id` | `${source.id}-${target}` |
| `outputFile` | `_${source.id}-${target}.md` |
| `publishable` | `source.publishable` |
| `role` | `'draft'` |
| `maxIterations` | `0` |
| `outputRatio` | `1.5` — becsült kezdőérték, a kalibrálás felülírja |
| `tags` | `source.tags` — a lefordított kártyák is Decks-paklik |
| `translation` | `{ source, target }` — új, elhagyható `Recipe` mező; a kihagyáshoz a célnyelv is kell |
| `structured` | nincs: kártyaforrásnál is prózaként fordít |
| `postprocess` | nincs |

### Prompt

Angolul, a projekt konvenciója szerint. A nyelv neve a `LANGUAGE_NAMES`-ből.

```text
Translate the note below into Hungarian.

Rules:
- Translate everything: headings, paragraphs, list items, table cells, labels
  such as **Example:**, and the text of Mermaid node labels.
- Keep the Markdown structure exactly: the same headings at the same levels, the
  same paragraphs, list items, table rows and columns, and code fences.
- Keep every timestamp such as [03:12] exactly as it is, at the start of the
  same paragraph.
- In Mermaid code, keep node IDs, arrows and keywords unchanged.
- Keep link targets unchanged; translate only the link text.
- Do not add, drop, summarise or explain anything. Do not add a translator's
  note.
- Technical terms that Hungarian professionals usually say in English may stay
  in English. Treat each such term the same way throughout.
- Do not emit YAML frontmatter; it is added separately.
- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle
  brackets: `[Name](<https://example.com>)`.

Title: <item.title>

--- NOTE ---
<a forrásjegyzet törzse>
```

Az utolsó két szabály a `RULE.noFrontmatter` és a `RULE.noWikilinks`,
szó szerint. A `languageRule` és a `RULE.traceable` **nem** szerepel: az
előbbi fordítást tilt, az utóbbi az átiratra hivatkozik.

### Javító prompt

A `clean` mintáján: „Revise the translation below. A reviewer compared it with
the source note and listed concrete gaps…", a szabályokkal, a hiánylistával, a
jelenlegi fordítással és a forrásjegyzettel. `maxIterations: 0` mellett nem
fut, de a `Recipe` szerződése megköveteli.

## 3. Bemenet és függés

### A forrásjegyzet törzse

Új függvény a `src/vault/` alatt:

```ts
export function noteBody(markdown: string): { body: string; generatedAt: string | null }
```

A `render.ts` `body()` pontos megfordítása: leválasztja a frontmattert, a
`# cím` sort, az elhagyható 🌐 linksort és az első `---` elválasztót. A
`generatedAt` a frontmatter `generated_at` mezője, vagy `null`, ha hiányzik.
Ha a fejléc-szerkezet nem ismerhető fel, **beszédes hibát dob** — ez
`item:failed` lesz, nem néma rossz bemenet.

A törzsből kikerülnek az egysoros Obsidian-megjegyzések (`%%…%%`). Ezek nem
tartalom, és a Decks ismétlési horgonyai (`%%dk:h:…%%`) is ilyenek: egy
fordításba átmásolt horgony két paklit kötne ugyanahhoz az ismétlési
állapothoz. Hogy a Decks ezt ténylegesen így kezelné-e, nem ellenőriztük — a
kockázat elkerülése olcsóbb, mint a próbája.

A törzs a vaultban lévő fájlból jön, tehát egy Obsidianban kézzel javított
forrásjegyzet javított változata fordul.

### Hogyan jut el a receptig

A `runRecipe` fordítórecepteknél (`recipe.translation` jelen van):

1. az állapottárból kiolvassa a forrás műtermékét
   (`store.artifactOf(itemId, source.id)`);
2. beolvassa a fájlt az `artifacts.path` útvonalról, és leválasztja a törzset;
3. a `refine`-t `{ item, transcript: <törzs>, timed: [] }` bemenettel hívja.

A `refine` loop és a rubrika így érintetlen: a pontozás viszonyítási alapja
automatikusan a forrásjegyzet. A `RecipeInput.transcript` és a
`ScoreContext.transcript` dokumentációja erre módosul: **„a recept bemenő és
viszonyítási szövege — alapreceptnél a normalizált átirat, fordításnál a
forrásjegyzet törzse."**

### Kihagyás

A kihagyás az `item:skipped` eseménnyel, **állapottár-sor nélkül** történik:
se nem hiba, se nem kész, a következő futás újra megvizsgálja.

| helyzet | ok (`reason`) | sor-státusz |
|---|---|---|
| A forrásnak nincs műterméke | `előbb a clean recept kell` | `⏸ előbb a clean recept kell` |
| A forrás műterméke `failed` | `a clean recept jegyzete nem készült el` | `⏸ a clean recept jegyzete nem készült el` |
| A forrásjegyzet már a célnyelven van | `a forrás már magyar` | `⏸ a forrás már magyar` |

- A nyelvet a **forrásjegyzet szövegéből** azonosítja (`identifyLanguage`),
  nem az `item.language`-ből — a `0009` 5. pontja szerint. `null` esetén nem
  hagy ki.
- A kihagyás a modellhívás **előtt** történik.
- A „forrás már a célnyelven" okot a pipeline állapítja meg, mert ő olvassa a
  forrásjegyzetet; az `ItemOutcome` új `skipReason` mezőben adja vissza, hogy a
  futás a sorba és a riportba is kiírhassa.

### Hiányzó forrásfájl

Ha az állapottár szerint a forrás kész, de a fájl nincs az útvonalon, a
fordítás `item:failed`: `a forrásjegyzet nem található: <relatív útvonal>`.
Zajos hiba, nem csendes kihagyás.

### Sorrend egy indításon belül

- A sorból olvasott egységeket a futás **stabil rendezéssel** átrendezi:
  előbb minden alaprecept, utána a fordítások. A sor kézi átrendezése így nem
  fordíthatja meg a sorrendet.
- **Tervezéskor** egy fordítási egység csak akkor kerül a becslésbe, ha a
  forrása kész, vagy ugyanebben az indításban **tervezett** (nem a plafon miatt
  elhalasztott) egység. Ha a forrás ugyanebben az indításban a plafon miatt
  elhalasztott, a fordítás is `⏳`-t kap. Minden más esetben kihagyásra kerül,
  a fenti okkal, és a becslésbe nem számít bele.
- **Végrehajtáskor** a futás újra ellenőrzi a forrás állapotát. Ha a forrás
  ebben a futásban elbukott, a fordítás a második sor okával kimarad.

### Elavulás

Nincs automatikus. Ha a forrást később újragenerálod, a fordítás kész marad;
az újrafordítást a `--force` kéri. A frontmatter `source_generated_at` mezője
mutatja, melyik forrásváltozatból készült.

## 4. Rubrika

```ts
rubric: {
  criteria: [formatCriterion, targetLanguageCriterion(target), skeletonCriterion, translationFaithfulness(target)],
  passThreshold: 0.8,
}
```

Az első három nulla tokenes, blokkoló kapu.

### Célnyelv-kapu

A `language.ts` új, közös függvénye:

```ts
export function checkLanguageIs(output: string, expected: LanguageTag): Score
```

- A kimenet nyelve `expected` → átmegy; `null` (gyenge jel) → átmegy; más →
  0, hiánnyal: `The output is written in English, but it must be in Hungarian.
  Translate it into Hungarian and keep the structure unchanged.`
- A mai `checkLanguage(output, transcript)` erre épül át: ha az átirat nyelve
  `null`, átenged, különben `checkLanguageIs`-t hív — **a hiányüzenete és a
  viselkedése bájtra a mai**, a `language.test.ts` változtatás nélkül zöld.

### Vázkapu

Új fájl: `src/rubric/skeleton.ts`.

```ts
export function checkSkeleton(output: string, source: string): Score
```

Mindkét szövegből ugyanaz a váz készül, és az első eltérés számít. A
kódkerítésen belüli sorok a kerítéssorok kivételével **nem** számítanak bele
(a Mermaid-címkék fordulnak).

| elem | minta | összevetés |
|---|---|---|
| Időbélyeg a bekezdés elején | `^\[(\d+:)?\d{2}:\d{2}\]` | a sorozat pontosan egyezik |
| Fejléc | `^ {0,3}(#{1,6}) ` | a szintek sorozata egyezik |
| Blokk | üres sorral elválasztott, nem üres szakasz; egy kódkerítés egy blokk | a darabszám egyezik |
| Listaelem | `^\s*([-*+]\|\d+\.) ` | a darabszám egyezik |
| Táblázatsor | `^\s*\|` | a sorok oszlopszám-sorozata egyezik |
| Kódkerítés | ``^```(\S*)`` | az infosztringek sorozata egyezik |
| Linkcél | `](<…>)` és `<https://…>` | a multihalmaz egyezik |

A hiányüzenet angolul szól, egy elemre egy, az első eltérést nevezi meg:

- `The translation has 41 timestamps, the source has 42; the first difference follows [03:12].`
- `The translation has 18 paragraphs, the source has 19. Do not merge, split or drop paragraphs.`
- `Heading 7 is level 3 in the source but level 2 in the translation.`
- `A link target changed: <https://example.com> is missing from the translation.`

A forrásreceptek saját kapui (például a Bloom szintcímke-ellenőrzése) a
fordításon **nem** futnak: az angol címkéket keresik. A szintenkénti
kártyaszámot a fejléc-sorozat egyezése megőrzi.

### Fordításhűség-bíró

`judgeCriterion`, `translation-faithfulness` néven, a `judge.ts`
változtatása nélkül. A bíró promptjának szakaszcímeit (`TRANSCRIPT`,
`NOTES UNDER REVIEW`) az utasítás nevezi meg:

```text
You are grading a translation into Hungarian. The TRANSCRIPT section below holds
the source note; the NOTES UNDER REVIEW section holds its translation.

Return a score between 0 and 1, where 1 means the translation says exactly what
the source says, in natural Hungarian.

Report as a gap every place where the meaning changed, a passage was dropped or
added, or text was left untranslated. Technical terms that Hungarian
professionals usually say in English may stay in English, but the same term must
be handled the same way throughout; report inconsistent handling as a gap.

Do not report differences in Markdown structure; they are checked separately.
```

## 5. Kimenet

### A jegyzet

`noteFile(notesRoot, item, '_clean-hu.md')` — a forrásjegyzet mellé, ugyanabba
a vault-commitba, mint a futás többi jegyzete.

A frontmatter a `renderRecipeNote` szokásos mezői, négy eltéréssel:

| mező | érték |
|---|---|
| `language` | a célnyelv (`hu`) — a jegyzet nyelve |
| `source_language` | az `item.language`; ha `null`, a mező kimarad |
| `translation_of` | a forrásrecept azonosítója (`clean`) |
| `source_generated_at` | a forrásjegyzet `generated_at`-je; ha hiányzik, a mező kimarad |

A `# cím`, a `description` és a metaadat-címkék **nem fordulnak**. Fordítás
nélküli jegyzet frontmatterje a `generated_at` kivételével bájtra a mai.

### Sor, riport, felület

- A `scan --queue` a regiszter azonosítóiból dolgozik, tehát a fordítások pipái
  a kulccsal együtt megjelennek, a meglévő pipákhoz nem nyúl.
- A `⏸` státuszok a `status.ts` új konstansai; a `run --queue` a kihagyott
  párokra írja vissza őket.
- A `QueueRecipeStatus` új `skipped` számot kap. A kihagyott pár **nem**
  `pending`, tehát nem vált ki folytatási parancs-javaslatot. A riport
  sortáblázata a „kihagyva" oszlopot **csak akkor** mutatja, ha valamelyik sorban
  nem nulla — fordítás nélkül a riport bájtra a mai. A pároknál a kihagyás oka a
  `warnings` listába kerül: `clean-hu — <cím>: előbb a clean recept kell`.
- `web/app/utils/format.ts`: a `kindLabel` egy `<forrás>-<nyelv>` alakú
  típushoz, ahol a forrás ismert, `tisztított leirat (hu)` alakú címkét ad.
- A felület tételoldala a fordítás mellé is a normalizált átiratot teszi — ez
  változatlan.

## 6. Becslés

A `budget.ts` képlete változatlan. A `plan.ts` fordítási egységnél:

- **bemeneti szószám:** `transcriptWords × (translation.source.outputRatio ?? 0.1)`
  — a forrásfájlt nem olvassa, tehát kész és ugyanabban az indításban tervezett
  forrásra ugyanúgy működik;
- **`outputRatio`:** a fordítórecepté;
- **bírók száma:** a rubrikából, itt 1. A bíró bemenete a képlet szerint a
  bemenet és a kimenet együtt — fordításnál a forrás és a fordítás, pontosan.

## 7. Eval

- `evals/translate.eval.ts` a `clean.eval.ts` mintáján, fixture-modellen,
  offline: szintetikus forrásjegyzetek (`clean`, `summary`, `notes`, `bloom`
  alakban) és a fixture-modell által adott fordítás; a pontozás a teljes
  rubrikán fut.
- A vázkapu címkézett esetei az `evals/fixtures/gate.ts` mintáján: helyes
  fordítás, lefordított címkékkel; kimaradt bekezdés; összevont bekezdés;
  megváltozott időbélyeg; kimaradt kártya; megváltozott linkcél; összefoglalt
  szöveg. A kapu precisionje és recallja **számként** jelenik meg.

## Megkötések

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet; angol
  produkciós azonosító, prompt és hiányüzenet.
- **Nulla új függőség.**
- Minden teszt hálózat és API-kulcs nélkül fut, a meglévő hamis kliens mintáján.
- Recept nem kerülhet be a rubrikája nélkül.
- A mag nem ír konzolra és nem ír fájlt.
- A hat meglévő recept promptja bájtra változatlan; a `judge.ts` és a
  `refine/loop.ts` nem változik.
- Commit-sorrend: (1) prompt-ujjlenyomat a `bloom`-ra és a `notes`-ra, és a
  célnyelv-kapu; (2) vázkapu és a címkézett esetei; (3) `noteBody`;
  (4) konfigkulcs, `translationOf`, `recipesFor`; (5) a regiszter fogyasztói:
  nézetek, `scan --queue`, `--recipe`, felületcímke; (6) a fordítás bemenete és
  frontmatterje a pipeline-ban; (7) sorrend, kihagyás, becslés, sor-státusz és
  riport a futásban; (8) eval; (9) kalibrálás és a végleges `outputRatio`;
  (10) füstpróba és dokumentáció.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom.

1. `translate` kulcs nélkül a `scan --queue`, a `run`, a `run --queue`, a riport
   és a felület kimenete ugyanarra az állapotra **bájtra a mai** (a
   `generated_at` időbélyegek kivételével); a hat recept összeállított promptja
   bájtra azonos.
2. `translate: { to: hu, recipes: [clean, summary] }` mellett a `scan --queue`
   videónként felveszi a `clean-hu` és a `summary-hu` sort; másodszor
   futtatva **bájtra azonos** sort hagy.
3. Ha egy videónál a `clean` és a `clean-hu` is ki van pipálva, és a `clean`
   még nincs kész, **egy indítás** előbb a `_clean.md`-t, aztán a
   `_clean-hu.md`-t készíti el, **egyetlen commitban** — akkor is, ha a sorban a
   `clean-hu` áll elöl. A `_clean-hu.md` időbélyeg-sorozata azonos a
   `_clean.md`-ével, frontmatterében `language: hu` és `translation_of: clean`
   áll.
4. Ha csak a `clean-hu` van kipipálva, és a `clean` nincs kész: a párra **nulla
   modellhívás**, a sorban `⏸ előbb a clean recept kell`, a riport
   figyelmeztetései megnevezik a párt és az okot, és nem javasol folytatási
   parancsot miatta. Másodszor futtatva a sor bájtra azonos, commit nélkül.
5. Ha a fordításból kimarad egy bekezdés, a jegyzet **nulla bíró-hívással**,
   0-s pontszámmal kerül ki, és a hiány megnevezi az eltérő bekezdésszámot.
6. Ha a forrásjegyzet szövege már a célnyelven van (egy magyar átiratból
   helyesen magyarul készült összefoglaló), a fordítási pár
   `⏸ a forrás már magyar` okkal, nulla modellhívással kimarad. A mai korpusz
   magyar elemének angolul íródott összefoglalója viszont **lefordul**.
7. `translate: { to: xx }` vagy `recipes: [clean-hu]` betöltéskor beszédes
   hibával áll meg, még a felderítés előtt.
8. Egy lefordított `bloom` jegyzetet az Obsidianban a Decks paklinak ismer fel,
   és egy lefordított `notes` jegyzet Mermaid-diagramja hiba nélkül megjelenik
   (kézi ellenőrzés).
9. A futás előtti becslés egy 4050 szavas elem `clean-hu`-jára a kalibrált
   `outputRatio`-val számolt értéket írja ki.
10. A teljes teszt-, lint- és eval-futás zöld; `--dry-run` mellett a futás fájlt
    nem ír.

## Kalibrálás — a szelet végén, külön jóváhagyással

Becsült értékek ebben a specben: a kezdő `outputRatio` (1,5), és hogy egy
hosszú forrás egy hívásban lefordítható-e időtúllépés nélkül.

- **Arány:** `clean-hu` az egy kész `_clean.md`-n; `summary-hu` három angol
  elem kész összefoglalóján; `notes-hu` az egy kész `_notes.md`-n. Valódi
  hívásokkal, a konfigban akkor beállított `draft` és `judge` modellel — az
  arány tokenizáló-függő, ezért a mérés megnevezi a modellt.
- **Hosszú szöveg:** egy kb. 16 ezer szavas valódi átiratból bekezdésekre
  tördelt, szintetikus időbélyegekkel ellátott forrás egyetlen fordítóhívása,
  bíró nélkül. Mért érték: a generálás ideje, a kimenet hossza, és hogy
  időtúllépés nélkül lefut-e.
- **Döntés:** ha a hosszú fordítás időtúllépéssel elbukik, a darabolás **külön
  issue** lesz, mért számmal; ez a szelet nem darabol.
- **Költség:** becsülten $0,12 (`minimax-m3`) és $0,67 (`claude-sonnet-5`)
  között; kétszeres ráhagyással **$1,40-es plafon**.
- **Indítás csak kifejezett jóváhagyás után**, előzetes becsléssel.
- **Kimenet:** a végleges `outputRatio` ugyanabba a PR-be kerül, a mérés a
  `docs/measurements/` alá — gépnevek és útvonalak nélkül, a videók közötti
  ismétlődés mérésével együtt.

## Dokumentáció

- **Új ADR: `docs/decisions/0012-forditas.md`.** Rögzíti: a fordítás a
  forrásjegyzetből készül és ahhoz mér; forrásreceptenként egy példány; a
  fordítási memória a mérés alapján kimaradt. Kimondja, hogy a `0002`
  „a fordítás nem architekturális kérdés" következménye a `0009` nyelvi kapuja
  és a statikus regiszter miatt **nem állt meg**. Az `architecture.md` 14.
  szakasza a vázlatmodell-döntés ADR-jét `0012`-ként nevezi meg; ez a hivatkozás
  szám nélkülire módosul.
- **`architecture.md`:** a 7. szakasz „Nyelv" bekezdése (a „nulla
  architekturális költség" mondat helyett a tényleges megoldás), az 5.
  szakasz regiszterleírása, és a 8. szakasz a fordítórecepttel.
- **`roadmap.md`:** a Fázis 6 negyedik szelete „fordítás" néven, státusszal,
  kész-kritériumokkal és a memória kimaradásának okával.
- **`README.md`** és **`refinery.config.example.yaml`:** a `translate` kulcs.

## Amit ez a szelet szándékosan nem tartalmaz

- **Fordítási memóriát és szójegyzéket** — a mérés szerint a mondatpár-memória
  nem spórolna; a szójegyzék akkor jön, ha a fordításokban látszik a
  következetlenség.
- **Darabolást** — csak a kalibrálás által mért időtúllépés után, külön issue-ban.
- **Több célnyelvet egy konfigban** — a `to` egyetlen nyelv; az azonosító
  (`clean-hu`) nem zárja ki a későbbi bővítést.
- **Automatikus elavulás-kezelést** — a `--force` kéri az újrafordítást.
- **Hiányzó forrás automatikus legyártását** — kéretlen költés lenne.
- **A hosszú `clean` hibáinak javítását** (horgonyzás, időtúllépés) — a `clean`
  recept saját ügye.
- **Webes forrásjegyzet-nézetet** — a felület csak a fordítások címkéjét és
  sorait kapja meg.
- **A cím, a leírás és a metaadat-címkék fordítását** — ezek a videó adatai.
