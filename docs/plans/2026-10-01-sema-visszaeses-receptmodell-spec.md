# Spec — sémás hívás visszaeséssel, receptenkénti modell

**Dátum:** 2026-10-01 · **Státusz:** jóváhagyásra vár · **Issue-k:** #78, #79

Ez a dokumentum a backlog két tételét specifikálja **egyetlen körben** (egy
spec, egy terv, egy kód-PR, egy kiadás — a felhasználó kérése):

| backlog-tétel | issue | ebben a specben |
|---|---|---|
| 1.4 Sémás receptek elbuknak kényszerített `tool_choice`-ot nem támogató modellen | #78 | 1. szakasz |
| 2.9 Receptenkénti modellválasztás a configban | #79 | 2. szakasz |

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A sémás hívás (a `flashcards`, `notes`, `bloom` recept **és a bíró**) olyan
modellen is működjön, amely nem fogad el kényszerített `tool_choice`-ot; és a
configban receptenként lehessen modellt választani, a költség pedig mindig a
ténylegesen használt modell árán könyvelődjön.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Hány kör | **Egy**: egy spec, egy terv, egy kód-PR, egy kiadás | A felhasználó kérése |
| Végrehajtás | **Opus 5.5**, `executing-plans` | A felhasználó kérése |
| A #78 mechanizmusa | **Automatikus visszaesés**: marad a `json_schema`; ha a gateway pontosan a forced-`tool_choice` 400-zal utasít el, újrakérés tool-definícióval és `toolChoice: 'auto'`-val | A felhasználó választása; a Sonnet bevált, kalibrált útja nem változik, config nem kell |
| Elvetett #78-utak | Mindig tool-hívás; config-kapcsoló modellenként; `json_object` | Az első a bevált utat is cseréli; a második modellváltáskor elfelejthető (pont ez történt); a harmadik Opuson kerítéses JSON-t adott, sémakényszer nélkül |
| A visszaesés emlékezete | **Modellenként, futáson belül**, memóriában | Az első elutasítás után nincs több fölösleges kérés; tartós tárolás nem kell |
| A receptenkénti modell kulcsa | **Pontos receptazonosító** (`notes`, `clean-deep`, `notes-hu`) | A fordítás prózai recept, ezért **nincs öröklés** a forrásreceptből |
| A felülbírálás hatóköre | **Csak a generálás**; a bíró mindig `model.judge` | A #79 igénye a generáló modellről szól |
| Árazás | **Modellnév szerint** (`pricing.<modellnév>`) | A felhasználó választása; minden modell ára egyszer szerepel |
| A régi `pricing.draft` / `pricing.judge` | **Beszédes hibával elutasítva**, átírási útmutatóval | Config-törés, a changelog *Átállás* pontja jelzi (mint v1.5.0-nál a `clean`) |
| Kiadás | **v1.6.0** | A config formája változik |
| PR-szerkezet | Spec + terv PR (`docs/sema-fallback-receptmodell`), majd kód-PR (`feat/sema-fallback-receptmodell`) a friss `main`-ről | A korábbi szeletek mintája |

## Amit a tervezés előtt ellenőriztünk

- **A hiba helye.** `src/model/client.ts` `generateObject`: `generateText` +
  `Output.object({ schema })`, a provider `supportsStructuredOutputs: true`-val
  — a kérésben `response_format: json_schema` megy ki, amit a LiteLLM
  Anthropic felé kényszerített tool-hívásra fordít.
- **A bíró is sémás hívás.** `src/rubric/judge.ts:41` ugyanazt a
  `client.generateObject`-et hívja. 2026-09-29-én a helyi config
  `judge: sub2api--claude-opus-5-5` volt, és a `run --queue` a `summary` és a
  `clean-moderate` (szöveges) receptet is ugyanazzal a 400-zal buktatta el
  (`logs/2026-09-29T14-08-24.md`); a következő futások `--no-judge`-dzsal
  mentek.
- **Próba a LiteLLM-en** (2026-09-30, közvetlen `curl`, minimális kétmezős
  séma, összesen < 0,02 $):

  | mód | `sub2api--claude-opus-5-5` | `sub2api--claude-sonnet-5` |
  |---|---|---|
  | `response_format: json_schema` (a mai út) | **400** — `does not support forced tool_choice; use auto or none` | tiszta JSON |
  | egy tool + `tool_choice: "auto"` | tool-hívás, helyes argumentumokkal (`finish_reason: tool_calls`) | ugyanígy |
  | `response_format: json_object` | JSON ```` ```json ```` kerítésben, sémakényszer nélkül | tiszta JSON, sémakényszer nélkül |
  | sima prompt, benne a sémával | tiszta JSON | tiszta JSON |

  **Korlát:** a próba apró sémával ment; a valódi `notes`/`bloom` séma
  nagyobb. Ezért a megvalósítás végén valódi próba kell (lásd 3.2).
- **Az ár ma szerepenként adott.** `src/config.ts` `pricing: { draft, judge }`;
  szerep szerint számol a költségőr (`src/model/budget.ts` `createCostGuard`),
  az elemenkénti könyvelés (`src/pipeline.ts:226–231`), az előzetes becslés
  (`estimateItemUsd`, `src/cli.ts:767`) és a `check-pricing`
  (`src/model/pricing-check.ts` `comparePricing`, `applyPricingFix`).
- **Receptenkénti függőség már van.** `src/cli.ts` `depsFor(unit.recipe)`
  receptenként adja a `client`-et és a `modelConfig`-ot a `processItem`-nek.
- **A webes felület** (`web/`) nem olvas `pricing`-et és nem hívja a
  `loadModelConfig`-ot; a naplóban tárolt `usd`-t mutatja, a naplóformátum
  nem változik.

## 1. Sémás hívás visszaeséssel (#78)

### 1.1 Folyamat

Csak a `src/model/client.ts` változik, a `generateObject` belsejében. A
`ModelClient` felülete, a receptek, a bíró és a `structured.ts` nem változik.

1. A kliens a mai úton kérdez (`json_schema`).
2. Ha a hívás hibával tér vissza, és a hiba (üzenete vagy a válasz törzse)
   tartalmazza a `does not support forced tool_choice` szöveget, a kliens
   ugyanazt a promptot **újraküldi** egyetlen tool-definícióval (paraméterei a
   Zod-séma JSON Schemaként) és `toolChoice: 'auto'`-val.
3. Az eredmény kinyerése:
   - ha a modell meghívta a toolt → a tool argumentumai;
   - ha szöveget adott → a szövegből kinyert JSON (az esetleges
     ```` ```json ```` / ```` ``` ```` kerítés leszedésével);
   - mindkét esetben **Zod-validálás**.
4. Ha a validálás elbukik, vagy nincs se tool-hívás, se értelmezhető JSON, a
   kliens olyan hibát dob, amelyet a `structured.ts` a mai módon séma-hibaként
   csomagol (a `SCHEMA_ERRORS` halmazba eső név). Az elem `item:failed` lesz
   ugyanazzal az úttal, mint ma. **Nincs új hibaút.**

### 1.2 Emlékezet és napló

- A kliens egy halmazban tartja azokat a modellneveket, amelyek ezt a 400-at
  adták; ezeknél a következő sémás hívás **egyből** a tool-úton megy. A halmaz
  az egész futásra közös (a receptenkénti kliensek is ugyanazt látják), a
  futás végén elvész.
- Az első visszaesés modellenként **egy** figyelmeztető eseményt ad, amely a
  terminálon és a futásnaplóban (`.jsonl`) is megjelenik, pl.
  „`sub2api--claude-opus-5-5`: kényszerített tool_choice nem támogatott,
  tool-hívással (auto) folytatom". A pontos eseménytípust a terv rögzíti a
  meglévő eseménykészlethez igazítva.

### 1.3 Ami nem változik

- A `finishReason`-kapu (`ellenorizdAVeget`) **mindkét úton** lefut; a
  `tool-calls` a tool-úton is legitim vég.
- **Más** 400-as (és bármely más) hibánál nincs visszaesés; a hiba a mai módon
  megy tovább.
- A `retry.ts` ezt a 400-at végleges hibának minősíti; a visszaesés a
  kliensen **belül**, a retry-réteg alatt történik.
- A használat (token) a ténylegesen sikeres hívásból jön; az elutasított
  hívás nem termel tokent.

### 1.4 Tesztek (megfigyelhető viselkedés)

Valódi hálózat nélkül, a `createModelClient` tesztes `fetch`-ével:

- Az első kérésre a pontos üzenetű 400 jön → a második kérés törzsében
  `tools` és `tool_choice: "auto"` van, és a hívás a tool argumentumaiból
  épített, validált objektumot adja vissza.
- Ugyanarra a modellre a következő sémás hívás **első** kérése már a tool-út.
- Más modellre (amelyik nem adott 400-at) a mai `json_schema` út megy.
- Szöveges válasz kerítéses JSON-nal → validált objektum.
- Séma-sértő tool-argumentum, illetve se tool, se JSON → a `structuredOutput`
  „a modell nem a sémának megfelelő kimenetet adott" hibát dob.
- Más szövegű 400 → nincs második kérés, a hiba továbbmegy.
- `finish_reason: length` a tool-úton → a csonkolás-hiba dob.
- A `judgeCriterion` a 400 után is pontszámot és hiánylistát ad.

## 2. Receptenkénti modell és árazás modellnév szerint (#79)

### 2.1 Config-forma

```yaml
model:
  base_url: http://localhost:4000/v1
  draft: sub2api--grok-4.7          # alapértelmezés minden receptnek
  judge: sub2api--claude-opus-5-5
  recipes:                          # opcionális
    notes: sub2api--claude-sonnet-5
    bloom-hu: sub2api--claude-sonnet-5

pricing:                            # modellnév → ár (USD / 1M token)
  sub2api--grok-4.7:        { input_per_million: 2, output_per_million: 10 }
  sub2api--claude-opus-5-5: { input_per_million: 4, output_per_million: 20 }
  sub2api--claude-sonnet-5: { input_per_million: 3, output_per_million: 15 }
```

### 2.2 Szabályok és ellenőrzés

- A `model.recipes` kulcsa pontos receptazonosító: a regiszter receptjei
  (`RECIPE_IDS`) vagy egy fordítás azonosítója (`<recept>-<nyelv>`, a
  `translationOf` szerint). A `notes` felülbírálása **nem** vonatkozik a
  `notes-hu`-ra.
- A felülbírálás csak a generálást érinti; a pontozás mindig `model.judge`.
- **Betöltéskor, még a futás előtt, beszédes hibával áll meg az app**, ha:
  - a `model.recipes` ismeretlen kulcsot tartalmaz (a hiba felsorolja az
    érvényeseket);
  - egy **használt** modellnek (`draft`, `judge` vagy bármely felülbírálás)
    nincs ára a `pricing` alatt (a hiba megnevezi a modellt);
  - a `pricing` a régi alakot használja (`draft` / `judge` kulcs, ha nincs
    ilyen nevű modell a `model` blokkban) — a hiba megmutatja az új alakot.
- Árazott, de nem használt modell megengedett.

### 2.3 Belső szerkezet

- A betöltő a modellnév szerinti árakat és a receptes felülbírálásokat is
  tárolja a `ModelConfig`-ban.
- Új függvény: `modelConfigFor(cfg, recipeId)` — receptre szabott
  `ModelConfig`-nézet, amelyben a `models.draft` és a `pricing.draft` már a
  felülbírált modell és annak ára; a `judge` a configé. Így a szerep szerint
  számoló kód (költségőr, `pipeline.ts` könyvelés, előzetes becslés, a
  `depsFor`) változatlan logikával helyes modellt és árat használ.
- A kliens receptenként a nézetből készül; az 1.2 visszaesési halmaza közös.

### 2.4 `check-pricing`

- Szerepek helyett **minden használt modellt** (egyszer modellenként)
  összevet a LiteLLM `/model/info`-val.
- A `--fix` a `pricing.<modellnév>` csomópontot írja, megőrizve a megjegyzést
  és a flow-alakot (mint ma).

### 2.5 Tesztek (megfigyelhető viselkedés)

- Helyes config: a `modelConfigFor(cfg, 'notes')` a felülbírált modellt és
  árát adja, a `modelConfigFor(cfg, 'summary')` az alapértelmezést, a
  `modelConfigFor(cfg, 'notes-hu')` az alapértelmezést (nincs öröklés).
- Ismeretlen receptkulcs, hiányzó ár, régi `pricing.draft` → beszédes hiba.
- Egy felülbírált recept elemének `item:refined` `usd`-je a felülbírált modell
  árán, a bíró tokenjei a bíró árán számolódnak; a költségőr ugyanígy.
- Az előzetes becslés felülbírált recepttel a felülbírált árat használja.
- A kimenő kérés `model` mezője a felülbírált recepthez a felülbírált modell.
- `check-pricing`: modellenként egy sor; a `--fix` a modellnév-kulcsot írja.

## 3. Ellenőrzés és szállítás

### 3.1 Minden lépés után

`pnpm vitest run`, `pnpm typecheck`, `pnpm lint`, `pnpm build` zöld.

### 3.2 Valódi próba (a megvalósítás végén, a felhasználó jóváhagyásával)

- `refinery run --recipe notes` a `7d8a94e02918c454` elemen (2026-09-26-án
  ezen bukott el a `notes`), **Opus `draft`-tal és Opus bíróval**. Siker: a
  `_notes.md` elkészül, a bíró pontoz, a naplóban egyszer szerepel a
  visszaesési figyelmeztetés.
- Egy rövid futás `model.recipes`-szel (pl. `notes: sub2api--claude-sonnet-5`):
  a futásnaplóban a költség a Sonnet árán könyvelődik.
- Becsült költés néhány tized dollár; a plafon a szokásos 5 $.

### 3.3 Átállás (a kód-PR merge-e után, a kiadás előtt)

- A helyi `refinery.config.yaml` átírása az új `pricing`-alakra — mentés után,
  a felhasználó jóváhagyásával.
- A `refinery.config.example.yaml` a kód-PR része.
- A `CHANGELOG.md` *Átállás* pontja leírja az átírást.

## Sikerkritériumok

1. Opus 5.5 `draft`-tal a `notes`, `flashcards`, `bloom` elkészül, nem 400-zal
   bukik.
2. Opus 5.5 bíróval a pontozás lefut (a szöveges receptek sem buknak el).
3. Sonnet `draft`-tal a kimenő kérés változatlanul `json_schema`.
4. `model.recipes`-szel a felülbírált recept a felülbírált modellt hívja, és
   annak árán könyvelődik.
5. Hibás config (ismeretlen receptkulcs, hiányzó ár, régi `pricing`) a futás
   előtt beszédes hibával áll meg.

## A szeleten kívül (YAGNI)

- Tartós (futásokon átívelő) emlékezet a visszaesésről.
- Fallback-lánc hálózati / 5xx hibákra (backlog 2.1).
- Köteg-szintű megszakító ismétlődő séma-hibára (#38).
- A bíró modelljének receptenkénti felülbírálása.
- Az ár automatikus lekérése futásidőben a LiteLLM-ből.
- A helyi configban a `pricing:` alá került `judge_enabled` rendezése (a
  felhasználó configja, nem kód).
