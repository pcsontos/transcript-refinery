# Spec — A negyedik szelet: a többi recept és a fordítás a boton át

**Dátum:** 2026-10-08 · **Státusz:** jóváhagyva

Ez a dokumentum a [`2026-10-04-telegram-cloudflare-brief.md`](./2026-10-04-telegram-cloudflare-brief.md) negyedik szeletéből és a 2026-10-08-i tervezésből készült. Az előző szeletek spece a [`2026-10-04-telegram-cloudflare-spec.md`](./2026-10-04-telegram-cloudflare-spec.md), a [`2026-10-05-telegram-summary-spec.md`](./2026-10-05-telegram-summary-spec.md) és a [`2026-10-07-telegram-olvaso-spec.md`](./2026-10-07-telegram-olvaso-spec.md). Ahol ez a spec nem mond mást, az ottani viselkedés marad.

A brief „Receptválasztás” szakasza javaslat volt. Ez a spec lezárja: a választás csak gombbal megy, receptnév gépelése nincs.

## A cél egy mondatban

A felirat után a bot nyolc receptgombot és egy `fordítás` gombot ad. Egy koppintás egy receptet futtat, a fordítás egy vagy több kész jegyzetet visz egy nyelvre. Minden kérés egy futás a meglévő `cost_limit_usd` plafon alatt, és minden jegyzet megnyílik az olvasóban.

## Ezen a szeleten kívül

A fiókonkénti vagy időszakos költségkeret, a receptnév gépelése az üzenetben, a mentett alapértelmezés, a lejátszási lista, fordítás fordítása, több nyelv egy kérésben, és a #147 halasztott hibái. Átmeneti kompatibilitás a régi `recipe` mezőjű kopogtatással nincs.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Hogyan választ receptet a felhasználó? | Csak gombbal. |
| Melyik receptek? | `summary`, `notes`, `qa`, `flashcards`, `bloom`, `clean-mild`, `clean-moderate`, `clean-deep`. |
| Fordítás | `fordítás` gomb → kapcsolható gombok a kész alapreceptekből, több is választható → `tovább` → hét nyelvgomb, egy választható, a koppintás indít. |
| Költségplafon | Futásonként a meglévő `cost_limit_usd`. Egy kérés (egy receptkoppintás vagy egy fordításkérés) egy futás, egy közös plafon alatt (`decisions/0010`). |
| Hol él a receptenkénti állapot? | Új D1-tábla: `runs`. |
| Hol él a kapcsolók kijelölése? | A gombok `callback_data`-jában, bitmaszkként. D1 nem kell hozzá. |

## 1. A Telegram-menet

### A felirat után

A „<cím>. A felirat megvan.” üzenet alatt a mai egyetlen `summary` gomb helyett kilenc gomb jelenik meg, soronként három:

```text
[summary] [notes] [qa]
[flashcards] [bloom] [clean-mild]
[clean-moderate] [clean-deep] [fordítás]
```

### Receptgomb

A gomb adata `r:<recept>:<jobId>`. A koppintás a `runs` `<jobId>:<recept>` sorára dönt, a mai `decideTap` szerint:

| A sor | A bot |
|---|---|
| nincs | új sor `queued`, kopogtatás, „Sorba került: <recept>” |
| `failed` | a sor `queued` lesz (`claim`), kopogtatás, „Sorba került: <recept>” |
| `queued`, `waiting`, `accepted` | „Már sorban van: <videoId>.” |
| `ready` és `notified` | újraküldi a kész üzenetet |

A kész üzenet: „<cím> · <recept>. A jegyzet megvan.” és alatta a `/notes/<jobId>/<recept>` link.

A régi üzenetek `summary:<jobId>` gombja ugyanígy működik, `r:summary:<jobId>`-ként.

### Fordítás

1. A `fordítás` gomb adata `f:<jobId>`. Koppintásra a bot új üzenetet küld: „Melyik jegyzetet fordítsam?”. Alatta a videó kész alapreceptjei kapcsolható gombként, és egy `tovább` gomb. A kész alaprecept az, amelynek `runs`-sora `ready` és `lang` nélküli. Ha nincs ilyen, a bot ezt válaszolja: „Előbb készíts egy jegyzetet.”
2. A kapcsoló adata `t:<maszk>:<jobId>`. Egy koppintás a recept bitjét átfordítja, és a bot az üzenetet szerkeszti: a kijelölt gomb felirata `✓ <recept>`. A maszk a nyolcelemű receptlista indexeinek bitje, hexában.
3. A `tovább` adata `n:<maszk>:<jobId>`. Üres maszknál nem történik semmi. Egyébként a bot ugyanezt az üzenetet szerkeszti: „Melyik nyelvre?” és a hét nyelvgomb (`en`, `hu`, `nl`, `de`, `es`, `fr`, `it`), soronként négy.
4. A nyelvgomb adata `l:<maszk>:<nyelv>:<jobId>`. A koppintás a `runs` `<jobId>:<nyelv>:<recept+recept>` sorára dönt, a receptgomb táblája szerint. A válasz „Sorba került: summary, notes → de”.
5. A kész üzenet: „<cím> · de. A fordítás megvan.” és receptenként egy link: `/notes/<jobId>/summary-de`.

A választó csak alapreceptet kínál, így fordítást fordítani nem lehet. Ha egy (recept, nyelv) pár már kész a vaultban, a konténer modellhívás nélkül késznek veszi.

A leghosszabb gombadat, `l:ff:de:<updateId>:<videoId>`, 40 bájt alatt marad, a Telegram 64 bájtos korlátja alatt.

Minden gomb előtt a mai ellenőrzés fut: `answerTap`, `rememberUpdate`, kötött és engedélyezett fiók, és a `jobs.sub` egyezik a kötés `sub`-jával. Ha bármelyik bukik, a bot nem válaszol.

## 2. A Worker és a D1

### `0004_runs.sql`

```sql
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  recipes TEXT NOT NULL,
  lang TEXT,
  status TEXT NOT NULL,
  error TEXT,
  note_url TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  accepted_at INTEGER
);
CREATE INDEX runs_job ON runs(job_id);
INSERT INTO runs (run_id, job_id, recipes, lang, status, error, note_url, notified, accepted_at)
  SELECT job_id || ':summary', job_id, 'summary', NULL, status, error,
         replace(note_url, '_summary.md', '_transcript.md'), note_notified, accepted_at
  FROM jobs WHERE phase = 'summary';
UPDATE jobs SET status = 'ready', phase = 'subtitle' WHERE phase = 'summary';
```

- `run_id`: `<jobId>:<recept>`, vagy fordításnál `<jobId>:<nyelv>:<recept>+<recept>`, a receptek a lista sorrendjében. A determinisztikus azonosító miatt ugyanaz a kérés ugyanarra a sorra fut.
- `recipes`: az alapreceptek, szóközzel elválasztva. `lang`: a célnyelv, vagy `NULL`. A futás fajtái: `lang` nélkül maguk a receptek, `lang`-gal `<recept>-<lang>`.
- `note_url`: a videó `_transcript.md`-jének GitHub-címe, mert minden futás mellé az átirat is elkészül. Ebből minden fajta címe utótagcserével jön.
- A `jobs` tábla a felirat sora marad. A `phase` oszlopot a kód nem olvassa többé, fizikailag nem törlődik.

### A tár

A `JobStore` kap egy `RunRow` típust és hat hívást: `run(runId)`, `insertRun(row)`, `saveRun(row)`, `claimRun(runId, expect, next)`, `runsFor(jobId)` és `dueRuns(now)`. A `dueRuns` a `runs` esedékes sorait adja, ugyanazzal a feltétellel, mint a `due` a `jobs`-ét. A `notesFor(sub)` a `runs` kész sorait adja, a `jobs`-szal összekapcsolva. A `claim` régi, `phase`-es alakja megszűnik.

### A kopogtatás

```ts
{ jobId: string, videoId: string, url: string, recipes?: string[], lang?: string }
```

A `jobId` futásnál a `run_id`. A `recipes` nélküli kopogtatás a mai felirat-munka.

### A visszahívás

A `POST /internal/jobs/:id` először a `runs`-ban keres, utána a `jobs`-ban. Futásra:

- `failed`: a mai szabály, a hibasor megy a chatbe, a sor `failed`.
- `ready`: ha `notified`, nincs teendő. Ha a `noteUrl` hiányzik, a mai `MISSING_NOTE_URL`. Egyébként a kész üzenet megy, a sor `ready` és `notified`. Ha a küldés bukik, a sor `accepted` marad, ahogy ma.

A `jobs`-ág `summary`-része megszűnik, a felirat-ág változatlan.

### A cron

A `handleCron` a `due` és a `dueRuns` minden sorát a meglévő `settle` szerint kopogtatja újra: a `jobs`-sort felirat-munkaként, a `runs`-sort a `recipes` és a `lang` értékével.

### Listák

A Worker egy-egy `const` tömbben tartja a nyolc receptet és a hét nyelvet. Egy teszt összeveti őket a mag `RECIPE_IDS` és `LanguageTag` listájával.

### Telegram-hívások

A `send` egyetlen gomb helyett gombsorokat kap (`{ text, data }[][]`). Új hívás az `edit(chatId, messageId, text, keyboard)`, ami az `editMessageText` Bot API-hívás. A kapcsoló és a `tovább` ezzel szerkeszti az üzenetet. A `message_id` a `callback_query.message` mezőjéből jön.

## 3. A konténer

### `commandRun`, `recipes` kapcsoló

A `flags` kap egy `recipes?: string[]` mezőt. Ha meg van adva, a nem-queue ág `items × recipes` egységet gyárt, mindegyiket a regiszterből (`recipeFrom`). A modell, a `guard` és a `depsFor` úgy jön létre, mint a `recipe`-nél. A `sourcesFirst`, a `sourceGap` és az `alreadyDone` a mai módon dolgozik. A riport `kinds` sora a lista. A CLI-ben nincs új parancssori kapcsoló.

### `src/serve/summary.ts` → `runRecipes`

A `runSummary` neve `runRecipes({ videoId, outDir, recipes, lang })` lesz:

- `lang` nélkül a `commandRun` a `recipes`-t kapja.
- `lang`-gal a futás idejére `cfg.translate = { to: lang, recipes }`, és a `commandRun` a receptenkénti `<recept>-<lang>` azonosítók listáját kapja. A config fájl nem változik.
- A commit az átiratot és minden kért fajta `outputFile`-ját viszi, ha a fájl létezik.
- A siker `{ ok: true, noteUrl }`, ahol a `noteUrl` az átirat GitHub-címe. A hiba a mai `failureLine` szövege, vagy „A jegyzet nem készült el.”, ha bármelyik kért jegyzet hiányzik.
- A plafonon megálló futás a mai „A futás megállt: … $ / … $” sort adja. A kész jegyzetek commitolva maradnak, újrapróbálásnál az `alreadyDone` átugorja őket.

### `job.ts`, `http.ts`

Az `isJob` elfogadja a `recipes` mezőt (nem üres sztringlista) és a `lang` mezőt (sztring), a `recipe` mezőt nem. A `runJob` a `recipes` meglétére vált recept-útra. Ha a `lang` nem a `LANGUAGE_NAMES` kulcsa, a válasz „Ismeretlen nyelv.”, modellhívás nélkül. Ismeretlen receptre a hiba a `recipeFrom` vagy a `recipesFor` első sora.

### Modell

A `peter-mba` configjában `draft: claude-sonnet-5`, `model.recipes` nincs. A Sonnet a sémás recepteket kezeli. A minimax-m3 és az Opus 5.5 korlátja itt nem érint. Ha a config `draft`-ja változik, sémás recept előtt a LiteLLM `/model/info` `supports_response_schema` mezőjét kell nézni.

## 4. Az olvasó

### `GET /notes`

Videónként egy sor: cím, nap, és a kész fajták linkje a futások sorrendjében, a végén a `transcript`. Nincs kész futás, nincs sor.

### `GET /notes/:jobId/:fajta`

A fajta akkor nyílik meg, ha `transcript`, vagy szerepel a videó egy `ready` futásának fajtái között. A `jobs.sub` egyezik a belépett `sub`-bal. A vaultbeli cím a futás `note_url`-jéből jön, a `_transcript.md` utótag cseréjével `_<fajta>.md`-re. Minden más eset `404`. A GitHub-hibák kezelése a 3b-ből változatlan.

A `NOTE_KINDS` megszűnik: a fajtát az adat dönti el.

## 5. A kód határa

| Hely | Változás |
|---|---|
| `worker/migrations/0004_runs.sql` | új |
| `worker/src/store.ts`, `d1.ts` | `RunRow`, a `runs` hívásai, `due`, `notesFor` |
| `worker/src/plan.ts`, `messages.ts` | receptlista, nyelvlista, gombsorok, maszk, üzenetek |
| `worker/src/handle.ts` | `handleTap` öt előtaggal, `handleCallback` futásra, `handleCron` |
| `worker/src/reader.ts` | fajta a futásokból |
| `worker/src/index.ts` | `send` gombsorokkal, `edit` |
| `src/cli.ts` | `recipes` kapcsoló |
| `src/serve/summary.ts`, `job.ts`, `http.ts`, `command.ts` | `runRecipes`, `recipes` és `lang` |

## 6. Teszt

- `commandRun`: két recept egy futásban, egy közös plafonnal. Egy alacsony plafon a második recept előtt megállít. Egy fordítás `lang`-gal a forrás után fut.
- `runRecipes`: commitolja az átiratot és a kért fajtákat, és az átirat címét adja vissza. Hiányzó jegyzetre hibát ad.
- `isJob` és `runJob`: `recipes`-szel és `lang`-gal recept-út, `recipe` mezővel elutasítás, ismeretlen `lang`-ra „Ismeretlen nyelv.”
- `handleTap`: mind az öt előtag, a régi `summary:` gomb, idegen `sub`, üres maszk, kész alaprecept nélküli `fordítás`, kész és bukott futás.
- `handleCallback`: futás `ready` és `failed`, megismételt visszahívás.
- `handleCron`: a `runs` esedékes sora a `recipes`-szel és a `lang`-gal kopog.
- `reader`: kész fajta megnyílik, nem kész fajta `404`, idegen `sub` `404`, a lista videónként.
- A Worker recept- és nyelvlistája egyezik a mag listáival.
- A migráció a meglévő summary-sort átviszi: a régi `summary` link és a `/notes` lista ugyanazt mutatja, mint előtte.

## 7. Élesítés

1. A `0004` migráció az éles D1-en.
2. Konténerkép: `pnpm docker:publish`, újraindítás a `peter-mba`-n.
3. Worker: `wrangler deploy`.
4. Éles próba egy rövid videón: `notes`, utána `fordítás` → `summary` + `notes` → `de`. A becsült költés néhány tized dollár, a plafon 5 $.

A 2. és a 3. lépés közti percekben a régi Worker `recipe` mezős kopogtatását a konténer elutasítja, és a koppintott sor `phase='summary'` marad. Ezért a Worker telepítése után a migráció utolsó sorát még egyszer le kell futtatni az éles D1-en (`UPDATE jobs SET status='ready', phase='subtitle' WHERE phase='summary';`), és utána újra kell koppintani.

## Siker

- A felirat után kilenc gomb jelenik meg, és mind a nyolc recept egy koppintással elkészül a vaultban, linkkel a Telegramban.
- Egy fordításkérés két receptre és egy nyelvre egy futás, és a két fordítás megnyílik az olvasóban.
- Egy alacsony plafonnal a futás a Telegramban a „megállt … $ / … $” sorral áll meg, és a kész jegyzet megmarad.
- A szelet előtti summary-jegyzetek linkje és listája ugyanúgy működik, mint előtte.
