# Spec — Hierarchikus feldolgozási sor

**Dátum:** 2026-09-23 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a backlog 2.5 és 2.6 tételét specifikálja, egy kiegészítéssel:
a feldolgozási sor (`_queue.md`) számozott csoport- és videófejlécet kap, a
fordítások pedig a forrásreceptjük alá kerülnek behúzott nyelvi al-sorként. A
célnyelvű videó alatt nincs fordítássor.

Ez a négy tervezett szelet közül az első. A többi — a meglévő jegyzetek
bepipálása (2.4), a `refinery list` parancs (2.7) és a webes riportoldal (6) —
külön spec–terv kört kap, és erre a formátumra épül.

Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

A `scan --queue` után a sor Obsidianban számozott, összecsukható vázlat:
csoport → videó → recept → fordítás, és egy magyar videó alatt nincs `hu`
pipa, amit feleslegesen ki lehetne pipálni.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| A régi formátumú sor sorsa | **A `scan --queue` egyszer, automatikusan átalakítja**, pipákkal és utótagokkal együtt | Egy formátum marad a kódban; a régi elemző egy külön, később törölhető modulban él |
| A sorszámok gazdája | **Minden scan újraszámoz**; a `N. ` előtag a pipeline-é, mint az utótag | A számozás mindig folytonos, kézi törlés és átrendezés után is |
| Behúzás | **A recept behúzás nélkül, a fordítás két szóközzel** a H3 alatt | A backlog példája; a H3 a szülő, a fordítás a recepttel együtt csukható |
| Fordítássor célnyelvű videó alatt | **Törlődik, a pipált és az utótagos is** | Kifejezett döntés (C); a vaultbeli jegyzetfájl nem törlődik, csak a sor |
| Nyelv, ha a fájlnévben nincs kód | **A scan a tartalomból felismeri** (`identifyLanguage`, nulla token) | Az élő korpusz egyetlen magyar feliratának nevében nincs nyelvkód |
| Bizonytalan nyelv | **A fordítássorok maradnak** | Ugyanaz az elv, mint az `alreadyInTarget`-ben: bizonytalan felismerésnél nincs kihagyás |
| Megközelítés | **Soronkénti szerkesztés, három tiszta lépés** (`migrateLegacy` → `mergeQueue` → `renumberQueue`) | A mai „bájtra érintetlen" garancia megmarad; a teljes fa újraírása ezt kockáztatná |
| PR-szerkezet | **Két PR egymás után**: előbb spec + terv, majd a kód a friss `main`-ről | A #37/#39 és a #41 mintája |

## Amit a tervezés előtt megmértünk és ellenőriztünk

### Az élő sor

`<vault>/Inbox/transcript-refinery/_queue.md` (2026-09-23):

| mérőszám | érték |
|---|---|
| sor | 1887 |
| csoport (`## `) | 28 |
| videó (`%%…%%`) | 166 |
| bepipált receptsor | 10 (mind alaprecept, utótaggal: 7 × `✓`, 3 × `✗`) |
| fordítássor (`*-hu`) | 664 = 166 × 4, egy sincs bepipálva |
| saját sor a fejrészen kívül | 0 |

### A konfig

`translate: { to: hu, recipes: [clean, summary, notes, bloom] }`. Fordítássor
tehát csak e négy recept alá kerül, és csak `hu` nyelvvel.

### A korpusz nyelve

A forrásmappában 166 felirat van: 165 `.en.srt` és egy magyar
(`FPg1oNlifJk`, *Buddha nyomába 1. rész*), **nyelvkód nélküli** fájlnévvel. A
scan ma `item.language === null`-t lát rá; a tartalom alapú felismerés csak a
futásban történik (`normalizeItem`, `pipeline.ts`), és az eredménye nem kerül
az állapottárba (ott is `NULL`). A kiegészítés tehát a scan saját
nyelvfelismerése nélkül erre az egy videóra sem hatna.

A fájlnévből jövő címke nyers (`splitSubtitleName`): lehet `en-US` vagy
nagybetűs is.

### Kik olvassák a sort

- `src/cli.ts` — `commandScanQueue` (merge), a `run --queue` ága (`checkedPairs`,
  `applyStatuses`).
- `src/view/overview.ts` — `checkedPairs`, a webes felület áttekintéséhez.
- `web/test/e2e/fixture.ts` — régi formátumú `_queue.md`-t ír a teszthez.
- `src/vault/lint.ts` — szerkezetre nem szab megkötést, csak linkekre és
  frontmatterre.

## Kiindulási állapot

```markdown
## transcripts/youtube/A_Tan_Kapuja
- Buddha nyomába 1. rész: … %%FPg1oNlifJk%%
  - [ ] summary
  - [ ] flashcards
  - [ ] qa
  - [x] clean — ✓ 0.95 · $0.5328 · [jegyzet](<…>)
  - [ ] bloom
  - [ ] notes
  - [ ] clean-hu
  - [ ] summary-hu
  - [ ] notes-hu
  - [ ] bloom-hu
```

## Célállapot

```markdown
## 1. transcripts/youtube/A_Tan_Kapuja
### 1. Buddha nyomába 1. rész: … %%FPg1oNlifJk%%
- [ ] summary
- [ ] flashcards
- [ ] qa
- [x] clean — ✓ 0.95 · $0.5328 · [jegyzet](<…>)
- [ ] bloom
- [ ] notes

## 2. transcripts/youtube/Sajjaad_Khader
### 1. How to Become a 300K AI Engineer in 2026 … %%…%%
- [x] summary — ✓ 0.94 · $0.0396 · [jegyzet](<…>)
  - [ ] hu
- [ ] flashcards
- [ ] qa
- [x] clean — ✓ 0.98 · $0.1281 · [jegyzet](<…>)
  - [ ] hu
- [ ] bloom
  - [ ] hu
- [ ] notes
  - [ ] hu
```

A magyar videó alatt nincs `hu` al-sor; az angol videó alatt csak a
`translate.recipes` négy receptje alatt van.

## 1. Sorfajták — `src/queue/line.ts`

A `classifyLine` öt fajtát ismer:

| fajta | minta | megjegyzés |
|---|---|---|
| `heading` | `^## (\d+)\. (.+)$` | `key` a sorszám nélküli szöveg |
| `video` | `^(### (\d+)\. .*? %%(.+?)%%)(.*)$` | `head` a sor eleje a horgonyig, **a `### N. ` előtaggal együtt** (a `withSuffix` ebből írja vissza a sort); `suffix` a horgony utáni rész |
| `recipe` | `^- \[([ xX])\] ([A-Za-z0-9_-]+)(.*)$` | oszlop 0 |
| `translation` | `^  - \[([ xX])\] ([a-z]{2})(.*)$` | pontosan két szóköz; kétbetűs nyelvkód, mint a `translate.to` minden megengedett értéke |
| `other` | minden más | |

A cím nem-mohó illesztése és az első `%%…%%` mint horgony ugyanaz, mint ma. Egy
`1. rész`-szel kezdődő cím nem zavar: a sorszámot a `### ` utáni első `\d+\. `
adja, a cím ezután jön.

A számozatlan `## ` fejléc és a `- … %%id%%` videósor az új elemzőnek `other`;
ezeket csak a `legacy.ts` ismeri.

A sorgenerálók:

- `headingLine(n, key)` → `## n. key`
- `videoLine(n, item)` → `### n. <cleanTitle> %%<itemId>%%`
- `recipeLine(id)` → `- [ ] id`
- `translationLine(lang)` → `  - [ ] lang`

Az új sorok `n` értéke mindegy (a `renumberQueue` úgyis felülírja); a
generálók `0`-t is kaphatnak.

## 2. Elemző — `src/queue/parse.ts`

- `QueueRecipe` új mezője: `translations: QueueTranslation[]`, ahol
  `QueueTranslation = { line, lang, checked, head, suffix }`.
- A fordítássor a legközelebbi megelőző, **ugyanahhoz a videóhoz tartozó**
  receptsorhoz kötődik. Recept nélkül (közvetlenül a H3 után vagy az első videó
  előtt) `other`.
- A `QueueVideo` `head` mezője a teljes sor a horgonyig, előtaggal együtt; a
  sorszámot kizárólag a `renumberQueue` írja át.
- `checkedPairs` a bepipált fordítást `{ itemId, recipeId: '<recept>-<nyelv>' }`
  párként adja, a recept után, a jegyzet sorrendjében. A fordítás pipája
  független a szülőétől: hiányzó forrásjegyzetet a futtató ma is `⏸`
  utótaggal kezel.

A `cli.ts` futtatója és a `view/overview.ts` így nem változik: ugyanazokat a
recept-azonosítókat kapják, mint eddig.

## 3. Sorelrendezés — `QueueLayout`

```ts
export interface QueueLayout {
  /** Az alaprecept-azonosítók, a regiszter sorrendjében. */
  recipes: readonly string[]
  /** Forrásrecept → célnyelv, pl. `clean` → `hu`. */
  translations: ReadonlyMap<string, LanguageTag>
}
```

`queueLayout(registry)` állítja elő: alaprecept az, aminek nincs `translation`
mezője; a fordítások a `translation.source.id` → `translation.target` párok.
Ezen kívül visszafelé is kell: `translationId(source, lang)` → `source-lang`,
`splitTranslationId(id)` → `{ source, lang } | null` (csak a layoutban
szereplő azonosítókra).

## 4. Átalakítás — `src/queue/legacy.ts`

`migrateLegacy(text, layout): { text: string; migrated: boolean }`

- Régi formátum jele: legalább egy számozatlan `## ` fejléc vagy egy oszlop 0-s
  `- … %%id%%` videósor. Ha nincs, a szöveg **bájtra változatlan**, `migrated:
  false`.
- Egy menetben, soronként:
  - `## kulcs` → `## 0. kulcs`. A `# Feldolgozási sor` fejléc (egy `#`) nem
    érintett.
  - `- cím %%id%%utótag` → `### 0. cím %%id%%utótag` (a horgonyig és az
    utótag bájtra ugyanaz).
  - Videóblokkon belül `  - [p] id utótag`:
    - ha `id` a layout egy fordítása (`clean-hu`): a sor kivétele, és
      `  - [p] hu utótag`-ként a blokk `clean` sora (és annak már áthelyezett
      fordításai) után kerül. Ha a blokkban nincs `clean` sor, a blokk végére
      `- [ ] clean` szülősor kerül, alá a fordítás.
    - különben `- [p] id utótag` — a pipa, az azonosító és az utótag
      változatlan, csak a két szóköz tűnik el. Ismeretlen azonosító is így
      marad meg.
  - Minden más sor a helyén marad.
- A fordítássor utótagjában lehet link; ez szövegként megy át, nem módosul.

A modul akkor törölhető, amikor régi formátumú sor már nincs; ezt külön issue
jelzi, nem ez a szelet.

## 5. Összefésülés — `src/queue/merge.ts`

`mergeQueue(current, items, layout)` — a harmadik paraméter a mai
`recipeIds` helyett a `QueueLayout`.

Változatlan elvek: tiszta függvény; a pipák, a saját sorok és a sorrend
bájtra érintetlenek, kivéve az alább felsorolt eseteket; kétszer alkalmazva
ugyanazt adja.

1. **Jelölések:** a `⚠ duplikátum` és a `⚠ a felirat nem található` a H3 sor
   utótagjába kerül (`withSuffix(head, mark)`).
2. **Hiányzó alaprecept:** a videóblokk utolsó recept- vagy fordítássora után
   (több hiányzónál a layout sorrendjében).
3. **Hiányzó fordítássor:** a szülőrecept utolsó fordítássora után, vagy ha
   nincs ilyen, közvetlenül a szülőrecept után. Csak ha a szülő a
   `layout.translations`-ben szerepel, és a videó nyelve nem a célnyelv. Ha a
   szülőreceptsor maga is hiányzik, a 2. lépés beszúrja, és alá kerül a
   fordítás.
4. **Nyelvi szabály:** ha a videó nyelve (lásd 6.) megegyezik egy
   fordítássor nyelvével, a sor **törlődik** — a bepipált és az utótagos is.
   Ez a sor egyetlen törlő lépése. `null` nyelvnél és `⚠ nem található`
   videónál a fordítássorokhoz nem nyúl.
5. **Új videó:** `### 0. …` + receptek + fordítások (a nyelvi szabály
   szerint) a csoport szakaszának végén; új csoport `## 0. kulcs`-csal a jegyzet
   végén.

A `MergeStats` új mezője: `removedTranslationLines`. A `cli.ts` kiírja.

Nyelvegyezés: kisbetűsítve, az elsődleges altagot hasonlítva (`hu-HU` →
`hu`).

## 6. Nyelv a scan idején — `src/cli.ts`

A `commandScanQueue` a `discoverAll` után, a merge előtt feloldja a nyelvet
azoknál az elemeknél, amelyeknél `item.language === null`:

- egy másolaton meghívja a meglévő `normalizeItem`-et (ugyanaz a beolvasás,
  normalizálás és `identifyLanguage`, mint a futásban);
- siker esetén a másolat `language`-ét adja tovább a mergének;
- ha a `normalizeItem` hibát dob (nem ismerhető fel biztosan, üres felirat),
  a nyelv `null` marad, a hiba nem állítja meg a scant.

Az eredeti `SourceItem`-et nem módosítja. Ma ez egy fájl beolvasása; token
nem fogy.

## 7. Újraszámozás — `src/queue/renumber.ts`

`renumberQueue(text): string`

- A `heading` sorok a dokumentumon végig 1-től folytonosan számozódnak.
- A `video` sorok minden `heading` után 1-ről indulnak; az első `heading`
  előtti videók is 1-ről.
- Csak a `\d+\. ` előtag változik; a fejléc többi része és minden más sor
  bájtra érintetlen.
- Idempotens.

A scan sorrendje: `migrateLegacy` → `mergeQueue` → `renumberQueue`. A lint
(`assertLint`) a merge generált töredékeire fut, mint ma.

## 8. Visszaírás — `src/queue/status.ts`

`applyStatuses` a receptsorok mellett a fordítássorokat is bejárja, és a
`pairKey(itemId, '<recept>-<nyelv>')` kulcsú állapotot a behúzott al-sorra
írja (`withSuffix(translation.head, status)`). Minden más változatlan.

## 9. Kimenet a konzolon

A `scan --queue` összegző sora kiegészül:

- ha `migrated`: `a sor átalakítva az új formátumra (számozott fejlécek, behúzott fordítások)`;
- ha `removedTranslationLines > 0`: `N fordítássor törölve célnyelvű videó alól`.

## Megkötések

- Új függőség nincs.
- A `QUEUE_HEADER` szövege nem változik (csak az első scan írja).
- Az állapottár sémája nem változik.
- A `run --queue` viselkedése a pipált párok szintjén nem változik.

## Sikerkritériumok

A megfigyelhető viselkedés, nem a fájl tartalma:

1. Az élő `_queue.md` **másolatán** egy `scan --queue` után:
   - 28 számozott `## N.` csoport, 1-től folytonosan; 166 `### N.` videó,
     csoportonként 1-től;
   - mind a 10 bepipált receptsor ugyanazzal a pipával és bájtra ugyanazzal
     az utótaggal megvan, ugyanannál a videónál;
   - az `FPg1oNlifJk` videó alatt nincs `hu` sor; a 165 angol videó alatt
     pontosan a `clean`, `summary`, `notes`, `bloom` alatt van egy-egy;
   - a konzol kiírja az átalakítást és a törölt fordítássorok számát (4).
2. Egy második `scan --queue` ugyanazon a fájlon bájtra ugyanazt hagyja.
3. Egy kézzel törölt `### 3.` után a scan a csoport videóit 1-től folytonosan
   számozza, és semmi mást nem változtat.
4. Egy `  - [x] hu` pipa után a `run --queue --dry-run` a `summary-hu`
   párt listázza; a valódi futás utótagja az al-sorra kerül, a szülő
   `summary` sor érintetlen.
5. A `view/overview.ts` ugyanazt a párlistát mutatja az új formátumú sorból,
   mint a régiből az átalakítás előtt.
6. `pnpm test`, `pnpm lint`, `tsc` és a CI zöld; a web e2e fixture az új
   formátumot írja.

## Tesztelés

TDD, minden új viselkedés előbb bukó teszttel:

- `line.test.ts`: az öt sorfajta; `1. rész`-es cím; négy szóköz (nem
  fordítás); háromjegyű nyelvkód (nem fordítás).
- `parse.test.ts`: fordítás a recepthez kötve; recept nélküli fordítás
  `other`; `checkedPairs` sorrendje és `summary-hu` párja.
- `legacy.test.ts`: új formátumra bájtra identitás; pipa és utótag
  megmarad; `clean-hu` a `clean` alá; hiányzó `clean` szülősor; ismeretlen
  recept megmarad; saját sor a helyén.
- `merge.test.ts`: hiányzó recept és fordítás beszúrása; célnyelvű videó
  fordítássorai törlődnek (pipált és utótagos is); `null` nyelv és nem
  talált videó érintetlen; `⚠` a H3-on; `hu-HU` egyezik `hu`-val; kétszeri
  alkalmazás identitás.
- `renumber.test.ts`: lyukas és átrendezett számozás; első H2 előtti videó;
  idempotencia.
- `status.test.ts`: fordítás utótagja az al-sorra, szülő érintetlen.
- A teljes lánc (`migrateLegacy` → `mergeQueue` → `renumberQueue`) kétszer
  alkalmazva régi és új bemenetre is identitás.
- `cli.test.ts` / `e2e.test.ts`: nyelvkód nélküli magyar felirat → nincs `hu`
  sor; felismerhetetlen tartalom → a scan nem áll meg, a sorok maradnak.
- `web/test/e2e/fixture.ts` az új formátumra.
- Valódi adat: a 1. sikerkritérium ellenőrzése az élő sor másolatán, a vault
  érintése nélkül.

## Dokumentáció

- `README.md`: a `_queue.md` leírása és példája (134., 212., 233. sor körül).
- `docs/architecture.md`: a feldolgozási sor szakasza (184., 369. sor körül).
- A döntési jegyzetek érintetlenek: a `0010` a videónkénti választás elvét
  rögzíti, a sor formátumát nem.

## Amit ez a szelet szándékosan nem tartalmaz

- Meglévő vault-jegyzetek automatikus bepipálása (2.4) — a következő szelet.
- `refinery list` (2.7) és a webes riportoldal (6).
- Több célnyelv egyszerre (a `translate.to` ma egy nyelv).
- A felismert nyelv mentése az állapottárba.
- A `legacy.ts` törlése.
