# Spec — több `--recipe` egy futásban, olvasási idő a jegyzetekben, `list`-takarítás, a Telegram parancsmenüje és a sémás kimenet mérése

**Dátum:** 2026-10-23 · **Státusz:** tervezés alatt

Ez a dokumentum a #244, a #291, a #71, a #304 és a #305 (Telegram parancsmenü) issue közös tervezéséből készült. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

A `refinery run` több `--recipe`-et is lefuttat egy hívásban (#244). Minden vault-jegyzet frontmatterje megmondja, mennyi idő elolvasni (#291). A `run` és a `list` ugyanúgy ellenőrzi a `--limit`-et, és a `list` kapcsolóinak bekötését teszt védi (#71). A Telegram `/` parancsmenüje ugyanabból a listából jön, mint a `/help`, és így a `/model` is bekerül (#305). Egy parancs kiméri, hogy a `model.switchable` modelljei tényleg tudnak-e sémás kimenetet, és összeveti a config jelzésével (#304).

## Miért egy spec

A #244 és a #71 ugyanazt a `parseArgs`-blokkot (`src/cli.ts:1037`) és ugyanazt a két hívóhelyet (`run`, `list`) érinti. A #291 és a parancsmenü kicsi, egymástól és a CLI-től független munka. Egy kód-PR-ben, egy kiadásban mennek ki.

## Mért kiinduló állapot (2026-10-23)

**#244 — `--recipe`**
- A `run`, a `list` és minden más alparancs **közös `parseArgs`-ot** használ (`src/cli.ts:1037`). A `recipe` itt `{ type: 'string' }` (`:1044`), `multiple: true` nélkül.
- Igazolva: `parseArgs` ismételt kapcsolónál hiba nélkül az utolsót tartja meg (`--recipe qa --recipe flashcards` → `{ recipe: 'flashcards' }`, Node 26.2).
- A `commandRun` már ismeri a több receptet: `flags.recipes` (`src/cli.ts:458`). Ezt ma csak a serve hívja (`src/serve/summary.ts:165`). A `recipes` úton minden elem × minden recept egy egység lesz (`:840`), egy közös költségőr alatt (`:508`).
- Az egyetlen `recipe` többet tesz egy listaelemnél: queue-módban szűrő a kipipált párokra (`:819`), és ez adja a `--retry-failed` műtermék-típusát (`artifactKind`, `:530`, `:836`). A `recipes` úton az `artifactKind` az átirat, tehát a `--retry-failed` ott rossz típust nézne.
- Ismeretlen receptre a `recipeFrom` egyértelmű hibát dob (`src/recipe/registry.ts:35`).

**#71 — `list`**
- 1. **Részben már kész:** a `main()`-en át hívó `list`-teszt létezik (`src/cli.test.ts:2837`, a `--channels` és a `--limit abc` esettel), az issue után került be. A `run` `main()`-szintű kapcsolóit (`--limit`, `--recipe`) viszont semmi nem védi.
- 2. A dokumentációs rész **már kész**: a `docs/usage.md:193–195` leírja, hogy a `--channels` mellett a `--limit` nem hat. A futáskor viszont nincs jelzés.
- 3. A `--limit` mindkét helyen `Number(values.limit)` (`src/cli.ts:1109`, `:1120`). A `list` utána ellenőriz (`:347`: pozitív egész), a `run` nem. A `run --limit abc` `NaN`-t ad, a `slice(0, NaN)` pedig üres, tehát a futás csendben semmit nem csinál. A `0x10` mindkettőn 16, az `1e1` 10.
- 4. A címoszlop legkisebb szélessége 20 (`src/view/list.ts:150`), így kb. 60 oszlop alatt a sor túlfut.

**#291 — olvasási idő**
- A frontmatter két helyen áll elő: `renderTranscriptNote` és `renderRecipeNote` (`src/vault/render.ts:87`, `:144`), a közös mezők a `baseFields`-ben (`:44`). Hívóik: `src/pipeline.ts:349`, `:464`. Más jegyzetíró nincs.
- Szószámláló van: `countWords` (`src/normalize/dedupe.ts:33`).
- A frontmatter a `:`-ot tartalmazó értéket magától idézi (`src/vault/frontmatter.ts`, `PLAIN`), így a `07:30` nem válik YAML 1.1-ben hatvanas számmá.
- Minden recept (summary, qa, flashcards, bloom, notes, a három clean, a fordítások) Markdown-szöveget ír a `renderRecipeNote`-on át.

**Parancsmenü**
- A `@TranscriptRefineryBot` `getMyCommands` válasza 2026-10-23-án hét parancs: `start`, `cancel`, `status`, `ping`, `version`, `help`, `scan`. **A `/model` hiányzik.** A menüt nem a kód állítja be, valaki kézzel tette fel, ezért nem követte a `/help` bővülését.
- A `/help` szövege (`HELP_TEXT`, `worker/src/messages.ts:189`) a `/model`-t már tartalmazza, a v1.21.0 Workerrel élesben.
- A parancsfelismerés két regexben él: `COMMAND` és `SCAN` (`worker/src/handle.ts:117`, `:119`), a `/start` külön ágon.
- A `scripts/telegram-bot-info.sh` olvassa a menüt (`getMyCommands`), a tokent a `TELEGRAM_BOT_TOKEN` környezeti változóból vagy a `worker/.dev.vars`-ból veszi, és a hibából kitakarja.

**#304 — sémás kimenet**
- A `model.switchable` jelzése (`structured`/`text`) kézi. A LiteLLM `supports_response_schema` mezője megbízhatatlan: a `sub2api--grok-4.7`-re és a sub2api Geminikre `null`, a Gemini-flash-high-ra `True`, mégis bukik.
- 2026-10-23-i kézi próba a projekt kliensével (`createModelClient` + `generateObject`, egy kártyás séma, 3 hívás modellenként): `sub2api--grok-4.7` 3/3, `sub2api--gemini-3.8-flash-high` 0/3 (`No object generated`). A `minimax-m3` az issue szerint mind a hat próbán bukott.
- Egy próba tokenje mérve: kb. 3,5 ezer be (séma + utasítás), 0,8–1,1 ezer ki.
- A sémás receptek: `flashcards`, `notes`, `bloom` (`structuredOutput`, `src/recipe/structured.ts:29`). A sémájuk exportált (`FlashcardsSchema`, `NotesSchema`, `BloomSchema`).
- A séma-hiba neve az AI SDK-ban `AI_NoObjectGeneratedError`, `AI_TypeValidationError` vagy `AI_JSONParseError` (`SCHEMA_ERRORS`, `src/recipe/structured.ts:14`).
- A mintaparancs: `refinery check-pricing` (`src/cli.ts:385`): config + LiteLLM, kiírás, kilépési kód.

**A CLI súgója**
- A `refinery help`, a `refinery help <parancs>` és a `refinery <parancs> --help` egyetlen táblából készül: `COMMANDS: CommandHelp[]` (`src/help.ts:30`). A teszt (`src/cli.test.ts:2436`, `OPTIONS`) parancsonként ellenőrzi, hogy a súgó minden kapcsolót felsorol, és hogy a tábla pontosan a várt parancsokat írja le.
- Ma a `run` leírása: „A --recipe receptet is futtat”, a kapcsolósora: „receptet is futtat (pl. summary); enélkül csak átirat”. A `LIMIT` sor: „legfeljebb ennyi elem”. A `list` `--recipe` sora: „csak ennek a típusnak az állapota”, a `--channels` sora: „csatornánkénti összesítő”.

## Ezen a körön kívül

- A `list --recipe` több értékkel (B változat: receptenként három oszlop). Később külön issue lehet.
- `--recipe` több értékkel `--queue` vagy `--retry-failed` mellett. Ezek egyelőre hibát adnak, lásd lent.
- A meglévő vault-jegyzetek utólagos `reading_time`-mal bővítése. A mező az újonnan írt vagy újragenerált jegyzetekbe kerül.
- A keskeny terminál tördelése a `list`-ben. Csak dokumentáljuk (#71/4).
- A parancsmenü automatikus beállítása a Worker deployjában.
- A `switchable` lista automatikus átírása és a szöveges modellek minőségének mérése (#304 „Nem cél”).
- Állítható próbaszám (`--runs`) a `check-structured`-hez: a 3 rögzített, kapcsoló akkor kell, ha a 3 próba drága vagy kevés lesz.
- Menet közbeni költségőr a `check-structured`-ben: az indulás előtti, 2× ráhagyású becslés a felső korlát; őr akkor kell, ha a próba nagyobb lesz.

## Döntések a tervezésből

| Kérdés | Döntés | Kié |
|---|---|---|
| Hatókör | #244, #291, a #71 mind a négy pontja, a Telegram parancsmenüje (#305) és a #304, egy spec, egy kód-PR. | felhasználó |
| A `list` több `--recipe`-pel | **A változat:** a `list` egyet fogad el, kettőnél egyértelmű hiba. | felhasználó |
| Az olvasási sebesség helye | Config kulcs, hiányában 200 szó/perc. | felhasználó |
| #71/4 | Csak dokumentáció. | felhasználó |
| A parancsmenü | Script a repóban, egy forrásból a `/help`-pel, teszt köti össze őket. | felhasználó |
| A #304 bevonása | Igen, ebbe a körbe. | felhasználó |
| A #304 helye | `refinery check-structured` alparancs, a `check-pricing` mellett. A config, a kliens és a súgó kész, a scriptnek mindet újra kellene építenie. | tervező |
| Mivel mér a #304 | A három sémás recept valódi sémájával, modellenként és sémánként 3 próbával (rögzített szám, nincs kapcsoló). Kis séma nem elég: a nagy séma ott is bukhat, ahol a kicsi átmegy. | tervező |
| A #304 költségplafonja | Indulás előtt: ha a becslés kétszerese a `cost_limit_usd` fölött van, egy hívás sincs. Menet közbeni költségőr nincs: a becslés felső korlát, a 2× ráhagyás a valódi pénzes futások szabálya. | tervező |
| Mi számít eltérésnek | Ha egyetlen séma-hiba is van, a mért eredmény `text`. Hálózati és egyéb hiba nem számít bele, külön látszik. | tervező |
| Több `--recipe` `--queue`/`--retry-failed` mellett | Hiba, a modellhívás és az állapottár előtt. | tervező |
| Ugyanaz a recept kétszer (`--recipe qa --recipe qa`) | Egyszer fut. | tervező |
| `--limit` szabálya | Csak tízes számrendszerbeli pozitív egész (`^[1-9][0-9]*$`), különben hiba. | tervező |
| #71/2 futáskori jelzés | Egy sor a stderr-re, ha a `--channels` mellett `--limit` is van. | tervező |

## 1. #244 — több `--recipe` a `run`-ban

- A `parseArgs` `recipe` kapcsolója `multiple: true` lesz, a `values.recipe` tömb.
- **`run`:**
  - nincs `--recipe`: a mai út (átirat);
  - egy (vagy ismételten ugyanaz az egy): a mai egyetlen-`recipe` út, változatlanul, `--queue` és `--retry-failed` mellett is;
  - két vagy több különböző recept: a `recipes` út, ugyanaz, amit a serve hív. Egy közös költségplafon, a `--limit` az elemeket határolja, a recepteket nem. A fordítás a forrása után fut (`sourcesFirst`). Ha egy fordítás és a forrása is szerepel, a sorrend akkor is helyes.
  - kettő vagy több `--queue` mellett: hiba `A --queue mellett egy --recipe adható meg (szűrőként).`, 1-es kód;
  - kettő vagy több `--retry-failed` mellett: hiba `A --retry-failed mellett egy --recipe adható meg.`, 1-es kód.
- A hibák a config, az állapottár és a modell érintése előtt állnak meg, mint a mai kapcsolóütközések (`src/cli.ts:1064`).
- Ismeretlen recept: a mai `recipeFrom` hiba, akármelyik helyen áll a sorban. Előbb fut, mint bármely modellhívás.
- A riport fejlécének parancssora a teljes `argv`, tehát minden `--recipe` látszik benne (mint ma, `command: argv.join(' ')`).
- **`list`:** egy `--recipe` a mai részletes nézet. Kettő vagy több különböző recept: hiba `A list egyszerre egy típus részleteit mutatja.`, 1-es kód.
- **Más alparancs**, amely olvassa a `values.recipe`-et: ma csak a `run` és a `list`. A terv ezt megerősíti (`grep`).

## 2. #71 — a `list` takarítása

1. **Teszt a `main()`-en át.** A meglévő `list`-teszt (`src/cli.test.ts:2837`) marad, az új üzenetszöveggel. Új esetek:
   - `main(['list', '--config', p, '--recipe', 'a', '--recipe', 'b'])` → 1 (az 1. pontból);
   - `main(['run', '--config', p, '--limit', '0x10'])` → 1.
2. **Jelzés a `--channels --limit`-re.** A stderr-re egy sor: `A --channels a teljes szűrt halmazt számolja, a --limit nem hat.` A kilépési kód 0 marad, a kimenet változatlan.
3. **Közös `parseLimit`.** Egy függvény a `run` és a `list` `--limit`-jének. Elfogadja a `^[1-9][0-9]*$` alakot, mást (`abc`, `0`, `-1`, `0x10`, `1e1`, `1.5`, üres) hibával utasít el: `A --limit pozitív egész szám: <érték>`, 1-es kód. A `list` mai `:347`-es ellenőrzése ebbe olvad. A `run --limit 0` ma üres futás, utána hiba: ez szándékos.
4. **Keskeny terminál.** Egy mondat a `docs/usage.md` `list`-szakaszába: kb. 60 oszlop alatt a sorok tördelődnek, mert a cím legalább 20 karakter.

## 3. #291 — `reading_time` a frontmatterben

- **Mező:** `reading_time`, minden új vagy újragenerált vault-jegyzetben: az átiratban és minden recept jegyzetében, a fordításokat is beleértve.
- **Mit számol:** a jegyzet tartalmának szavait (`countWords`), a frontmatter, a cím és a linksor nélkül. Átiratnál a bekezdésekre tördelt szöveget, receptnél a recept kimenetét.
- **Képlet:** `másodperc = round(szavak × 60 / wpm)`.
- **Formátum:** egy óra alatt `pp:mm` (pl. `07:30`), egy órától `ó:pp:mm` (pl. `1:02:30`). A perc és a másodperc kétjegyű, az óra nem. Üres tartalom: `00:00`.
- **Sebesség:** `vault.reading_wpm` a configban, pozitív egész, hiányában **200**. Rossz értékre a config betöltése a többi config-hibához hasonlóan áll meg.
- **Helye a mezők között:** a `words_normalized` és a `punctuation_density` után, hogy a szövegre vonatkozó mérőszámok együtt legyenek.
- **Egy hely:** a mező a `src/vault/render.ts`-ben áll elő, a két render-függvény közös útján. A recepteknek nem kell róla tudniuk.
- **Dokumentáció:** a `refinery.config.example.yaml` kommentben mutatja a `reading_wpm`-et, a frontmatter-mezők leírása (ha van ilyen a doksiban) kiegészül.

## 4. A Telegram parancsmenüje (#305)

- **Egy forrás:** a `worker/src/messages.ts` egy parancslistát exportál (név, opcionális argumentum, leírás). A `HELP_TEXT` ebből épül, a szövege betűre a mai marad.
- **Script:** `scripts/telegram-commands.ts`, `pnpm telegram:commands` paranccsal. A listából `setMyCommands`-ot hív az alapértelmezett hatókörre, utána `getMyCommands`-szal visszaolvassa, és kiírja, mi lett beállítva. A token a `TELEGRAM_BOT_TOKEN` környezeti változó. A `pnpm telegram:commands` a `worker/.dev.vars`-t a Node `--env-file-if-exists` kapcsolójával tölti, a környezet ennél erősebb. A script a tokent sosem írja ki. `--dry-run`-nal csak kiírja a listát, hívás nélkül.
- **Leírás a menüben:** a `/help` sorának leírása (a `–` utáni rész), argumentum nélkül. A Telegram korlátait (parancs 1–32 karakter, leírás 1–256) a `setMyCommands` maga ellenőrzi, a hibáját a script kiírja; külön teszt nincs rá.
- **Teszt köti össze:** a lista minden parancsát felismeri a Worker (`COMMAND`, `SCAN` vagy a `/start` ága), és minden felismert parancs szerepel a listában. Ha valaki új parancsot vesz fel a `COMMAND`-ba a lista nélkül, a teszt bukik.
- **Futtatás:** a kiadás után kézzel, egyszer. A dokumentáció (`docs/operations/telegram-worker-topology.md`) a telepítési lépések közé veszi.

## 5. #304 — a sémás kimenet mérése

- **Parancs:** `refinery check-structured [--config <út>]`.
- **Mit hív:** minden `model.switchable` modellre, mindhárom sémás recept sémájával (`flashcards`, `notes`, `bloom`), háromszor ugyanazt a `generateObject`-et, amit a recept, a projekt kliensével (`createModelClient`). Az utasítás egy rövid, rögzített magyar szöveg. A modell a `draft` szerepben fut, a saját árával.
- **Költség:** indulás előtt kiírja a becslést: próbák száma × (4000 be + 1500 ki token) a modell árán. Ha a becslés kétszerese a `cost_limit_usd` fölött van, egy hívás nélkül 1-es kóddal áll meg. Menet közben nincs külön költségőr.
- **Kimenet:** modellenként egy sor: `<modell>: config <jelzés>, mért <eredmény> (<sikeres>/<sémás próbák> sémás[, <n> egyéb hiba])`, eltérésnél `← ELTÉR`. A mért eredmény `structured`, ha egy séma-hiba sincs. Ha akár egy is van, `text`. Ha minden próba egyéb hibán bukott, `?`.
- **Hibatűrés:** egy próba bármilyen hibája (hálózat, időtúllépés) csak azt a próbát érinti, a mérés megy tovább.
- **Kilépési kód:** 0, ha nincs eltérés, 1, ha van, vagy ha a becslés kétszerese a plafon fölött van.
- **Üres lista:** `A model.switchable üres: nincs mit mérni.`, 0.
- **Nem javít:** a configot nem írja át.

## 6. A CLI súgója (`CommandHelp`, `src/help.ts`)

Az implementáció része, nem utólagos doksi: minden új vagy megváltozott kapcsoló a `COMMANDS` táblában is megjelenik, ugyanabban a commitban, mint a kód.

- **`run`:** a leírás: „A --recipe receptet is futtat, többször megadva több receptet egy futásban, közös költségplafon alatt. A --queue és a --retry-failed mellett egy --recipe adható meg.” A `--recipe` sora: „receptet is futtat (pl. summary); többször is megadható; enélkül csak átirat”. Új példa: `refinery run --file ~/atiratok/átirat.txt --recipe qa --recipe flashcards`.
- **`LIMIT`** (a `run` és a `list` közös sora): „legfeljebb ennyi elem (pozitív egész)”.
- **`list`:** a `--recipe` sora: „csak ennek a típusnak az állapota (egy adható meg)”. A `--channels` sora: „csatornánkénti összesítő; mellette a --limit nem hat”.
- **`check-structured`:** új bejegyzés (összefoglaló, használat, leírás, `--config`, `--help`, egy példa). Az `OPTIONS` tesztbe is bekerül.
- A #291 és a #305 nem CLI-kapcsoló, ezért a súgóhoz nem nyúl.

## Elfogadás

- `refinery run --file x.txt --recipe qa --recipe flashcards` mindkét jegyzetet megírja, egy riportban, egy költségplafon alatt.
- `refinery run --recipe qa --recipe flashcards --queue` és `--retry-failed` mellett 1-es kód, modellhívás nélkül.
- `refinery list --recipe a --recipe b`, `run --limit abc` és `run --limit 0x10` 1-es kóddal áll meg.
- `refinery list --channels --limit 5` kiírja a stderr-sort, a kimenet nem változik.
- Egy új jegyzet frontmatterjében ott a `reading_time`, 200 szó/perccel, `vault.reading_wpm: 100` mellett a duplája.
- A `pnpm telegram:commands` után a `getMyCommands` nyolc parancsot ad, köztük a `/model`-t.
- A `refinery help run`, a `refinery help list` és a `refinery help check-structured` az új szövegeket mutatja, a `refinery help` áttekintése felsorolja a `check-structured`-et.
- `refinery check-structured` a peter-mba configjával (valódi pénz, kb. 27 hívás): a `sub2api--claude-sonnet-5-5` és a `sub2api--grok-4.7` mért `structured`, a `minimax-m3` mért `text`, eltérés nincs. Ha a grok a nagy sémán bukik, az eltérést kell jelezni, és ez is helyes eredmény.

## Kiadás

Minor kiadás: új CLI-viselkedés és új frontmatter-mező. A konténer kódja változik (`src/`), ezért kép is kell. A Worker kódja csak szerkezetileg változik (a `HELP_TEXT` forrása), a súgó szövege nem. A Worker telepítése ezért nem szükséges, de nem is árt. A parancsmenü a kiadás után a `pnpm telegram:commands`-szal kerül fel.
