# Spec — `refinery deploy`: a vault jegyzetei `.mdx`-ként a showroomba

**Dátum:** 2026-10-24 · **Státusz:** jóváhagyva (2026-10-25)

Ez a dokumentum a #277 tervezéséből készült. A jegy leírása az alap; ahol ez a spec eltér tőle vagy pontosítja, ez érvényes. Az LLM-es átalakítás (#278), a site-repó klónja a konténerben (homelab-compose) és a több célnyelv (#281) **nem része**; erről lent, „Nem cél".

## A cél egy mondatban

A `refinery deploy` a vault jegyzeteiből a `pcsontos/refinery-showroom` szerződése szerinti `.mdx`-fájlokat ír a site-repó helyi klónjába, és pusholja a `main`-re, ami a site deployját indítja. Csak a hiányzót és a megváltozottat írja, és soha nem küld olyan fájlt, amitől a site buildje elbukna.

## Miért

- A showroom oldalon (site, láthatóság, tartalomszerződés: showroom #2, #3, #4, #10) minden kész, de jegyzet nem kerül rá.
- A site buildje egyetlen hibás jegyzet miatt is elbukik, és akkor egy jegyzet sem frissül. A deploynak ezért szigorúbbnak kell lennie a site-nál.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| A #278 ebben a körben? | **Nem.** A #277 egy csatlakozási pontot ad az átalakítónak, ezt ebben a körben a determinisztikus változat tölti ki | A #278 önálló munka (prompt, recept-infrastruktúra, mérés). Az éles út (klón, push, site-build, `auto`-bekötés) $0-ért kipróbálható (felhasználói döntés, 2026-10-24) |
| Hogyan frissülnek később a determinisztikus változatok? | **Jelző a frontmatterben** (`mdx_fallback: true`). Az ilyen jegyzetet a deploy újra átalakítja, ha van LLM-es átalakító, akkor is, ha a `generated_at` nem változott | Különben a #278 után a már kiküldött jegyzetek örökre egyszerű változatban maradnának, és egy elbukott LLM-kimenet is (felhasználói döntés, 2026-10-24) |
| Hiányzó `url` | **Átmegy változtatás nélkül**, a site-on opcionális | Döntés: #277 komment; site oldalon kész (showroom `5d74d2b`) |
| Hiányos fordítás-mezők | Hiányzó **`source_generated_at`** → pótlás az eredeti változat `generated_at`-jéből; ha az eredeti nincs a vaultban, **kihagyás + napló**. Hiányzó **`source_language`** → **kihagyás + napló** | A `source_language` a tétel nyelvéből jön (`src/vault/render.ts:153`). Ha hiányzik, az eredeti `language`-e is hiányzik, tehát nincs miből pótolni. A három mező törlése („eredetiként" kiküldés) lefordulna, de hamis adatot adna a site-nak (felhasználói döntés, 2026-10-24) |
| Nyers átirat, szójegyzék | Az átirat **nem** megy ki, a szójegyzék **igen** | Felhasználói döntés, 2026-10-24 |
| Hová pushol | **Közvetlenül a showroom `main`-jére**, PR nélkül, mint a vault-push | A `main`-re kerülés indítja a site deployját: a Cloudflare Workers Builds be van kötve (a felhasználó szerint; a repóból nem látszik, csak a dashboardon). A privát repón nincs ágvédelem (ellenőrizve). A „soha ne a mainen" szabály a kódra vonatkozik, nem a generált tartalomra (**az én értelmezésem**) |
| Konténer (serve a peter-mba-n) | **Nem része.** A homelab-compose (klón, mount, push-jog) külön lépés | Felhasználói döntés, 2026-10-24 |
| Config-blokk neve | **`showroom:`**, benne `deploy` és `clone_path` | Minden része a showroom szerződéséhez kötődik, egy másik site-nak saját szerződése és blokkja lenne; a `clone_path` megmondja, hogy helyi klón (felhasználói döntés, 2026-10-25) |

## A működés

### Mit lát a deploy

A `scanNotes()` (`src/serve/notes.ts:207`) adja a tételeket és a fajtánkénti fájlokat. A fájlnév fajtája (`<alapnév>_<fajta>.md`) a vault-recept neve (`summary`, `clean-moderate`, `summary-hu`).

Egy vault-fájlból egy **nyelvi változat** lesz:
- **Eredeti** (nincs `translation_of` a frontmatterben): a site-fajta a vault-fajta, a nyelv a `language` mező.
- **Fordítás** (van `translation_of`): a nyelv a `language` mező (a célnyelv), a site-fajta a **fájlnév fajtája a `-<célnyelv>` végződés nélkül** (`summary-hu` → `summary`, `clean-moderate-hu` → `clean-moderate`). Nem a `translation_of`, mert az a fordítórecept forrás-azonosítója, és nem mindig a vault-fajta: a vaultban 6 `clean-moderate-hu` fájlban `translation_of: clean` áll (`src/pipeline.ts:412`), így a site két külön fajtának látná az eredetit és a fordítást. Az `.mdx`-be a `translation_of` a site-fajtával íródik felül, mert a szerződés szerint egyeznie kell a `kind`-dal. Az eredeti változatot (a `source_generated_at` pótlásához) ugyanez a kulcs találja meg (**az én döntésem**).

**Nyelvkód:** a `language` és a `source_language` `-orig` végződése levágódik (`hu-orig` → `hu`). Ez a yt-dlp felirat-kódja (`src/fetch/subtitle/ytdlp.ts:91-93`), és a „a videó eredeti nyelvű felirata" jelentésű, nem külön nyelv. A vaultban kb. 120 jegyzetnél így áll, levágás nélkül ezek mind kimaradnának (**az én döntésem**).

**`origin`:** a régi jegyzetekből hiányzik (a `486cce1` előtt íródtak). A deploy a refinery saját szabályával pótolja (`originOf()`, `src/serve/notes.ts:81`), mert a site kötelezőnek veszi (**az én döntésem**).

A cél: `content/notes/<itemId>/<site-fajta>.<nyelv>.mdx`.

**Kimarad és naplózódik:**
- a nyelv nem `hu` vagy `en`, vagy hiányzik (eredetinél és fordításnál is; a feloldás a showroom #11, illetve a #281);
- a fordításnál a `source_language` hiányzik, vagy a `source_generated_at` hiányzik és nem pótolható (lásd a döntéseket);
- a **nyers átirat** (`_transcript.md`): nem megy a site-ra (felhasználói döntés, 2026-10-24); naplózni sem kell, mert nem hiba;
- nincs `generated_at` (a szójegyzék kivételével, lent);
- két vault-fájl ugyanarra a célútra esne. Ilyenkor az eredeti nyer, a másik kimarad.

**A szójegyzék (`_glossary-<cél>.md`, #259) kimegy** (felhasználói döntés, 2026-10-24). A frontmatterje más, mint a recept-jegyzeteké (`src/vault/render.ts`, `renderGlossaryNote`): van `kind: glossary-<cél>`, `language`, `source_language`, de **nincs `generated_at`, `source`, `origin`**, mert a fájl a későbbi fordításokkal bővül. A deploy így kezeli (**az én döntéseim**):
- site-fajta: `glossary`, nyelv a `language` (a célnyelv): `glossary.hu.mdx`. Nem fordítás (nincs `translation_of`), a site eredeti változatnak látja. A `kind` `glossary`-ra íródik felül; a `source_language` **kimarad**, mert a site `lib/note-frontmatter.ts` `frontmatterError`-ja a fordítás-hármasból bármelyik magányos mezőre buktatja a buildet (ellenőrizve, 2026-10-25);
- `generated_at`: a fájl utolsó vault-commitjának ideje (`git log -1 --format=%cI -- <út>`). A deploy a vault-commit után fut, így a bővült szójegyzék új időt kap, és a változásfelismerés ugyanaz, mint a többi jegyzetnél. Ha a fájl még nincs commitolva, kimarad és naplózódik;
- `source` és `origin`: a tétel egy recept-jegyzetéből (a tétel közös adata); ha a tételnek nincs ilyen, kimarad és naplózódik.

A fordítás akkor is kimegy, ha az eredetije kimaradt (pl. `de` eredeti, `hu` fordítás). A szerződés ezt nem tiltja.

### Mikor írja újra

Egy nyelvi változat akkor íródik (újra), ha:
1. nincs még `.mdx`-fájl a célúton, vagy
2. a meglévő `.mdx` `generated_at`-je eltér a vault-fájlétól, vagy
3. a meglévő `.mdx`-en `mdx_fallback: true` áll, **és** van LLM-es átalakító. Ebben a körben nincs, ezért ez az ág csak teszten fut.

Változatlan jegyzetnél nincs átalakítás és nincs LLM-hívás. A `meta.json` (`{ "title": … }`) akkor íródik, ha hiányzik vagy a cím más.

### Átalakítás

Az átalakító egy függvény: vault-jegyzetből (frontmatter + törzs, célnyelv, a szerződés komponenslistája) `.mdx`-szöveget ad, vagy hibát. Két megvalósítás van:
- **LLM-es**: a #278 hozza. Ebben a körben csak a teszt ad hamisat.
- **Determinisztikus**: a vault-törzs, a kódblokkon és a soron belüli kódon kívül a `{`, `}` és `<` escape-elésével. A `<` három esetben nem escape-elődik, mert ott működő linket törne vagy látható szemetet adna: az `<https://…>` autolinkből `[url](<url>)` lesz (a vaultban kb. 170 `🌐 <https://…>` sor; escape-elve a site-on a `>` a href-be kerülne), a `[szöveg](<cél>)` link-célja érintetlen, a soron belüli `<!-- … -->` kimarad (a többsoros komment escape-elve szöveg marad; a vaultban ma nincs ilyen). Az alakja a végrehajtóé, de le kell fordulnia, és komponenst nem tartalmazhat.

A **frontmatter** mindkét úton ugyanaz, kódból készül, nem az LLM írja:
- a vault mezői átnevezés nélkül (az `url` hiánya rendben van), a fent leírt pótlásokkal és igazításokkal (`-orig` levágása, `origin`, a fordítás `translation_of`-ja);
- plusz `kind: <site-fajta>`, mert a recept-jegyzetekben nincs `kind` mező, a szerződés viszont megköveteli;
- fordításnál a pótolt `source_generated_at` (lásd fent);
- a determinisztikus úton `mdx_fallback: true`. A site a szerződésen kívüli mezőt átengedi.

### Ellenőrzés írás előtt

Minden kimenetre (LLM-esre és determinisztikusra is):
1. **Frontmatter a szerződés szerint** (showroom `docs/content-format.md`, `lib/note-frontmatter.ts`): kötelező mezők (`item_id`, `title`, `kind`, `language`, `generated_at`, `source`, `origin`), az opcionális sémamezők típusa (`description`, `icon`, `url` és a fordítás-hármas szöveg, `full` logikai; a site `lib/source.ts`-e, fumadocs `pageSchema`), a `language` `hu` vagy `en`, a fordítás-hármas együtt, a `translation_of` egyezik a `kind`-dal. Ez ugyanaz a lista, amire a site buildje elbukik; a pontos listát a végrehajtó a site kódjával veti össze.
2. **Fordítás:** `@mdx-js/mdx` `compile` (új függőség).
3. **Komponensek:** minden JSX-elem neve, minden attribútum neve és értéke szerepel a klónban lévő `contract/mdx-components.json`-ban. Az érték csak string-literál lehet, a kötelező attribútum nem hiányozhat, HTML-elem és fragment tilos (a szerződés „Komponensek" szakasza). A listát a deploy a pull **után** olvassa be. A site ezt nem a buildben, hanem a CI tartalom-tesztjében (`tests/content.test.mjs`) nézi, tehát egy hibás komponens a deployt nem állítaná meg, de piros CI-t és rosszul renderelt oldalt adna.

Ha az LLM-es kimenet bármelyiken elbukik, a determinisztikus változat megy helyette, és a napló megnevezi az okot. Ha a determinisztikus változat is elbukik, a nyelvi változat kimarad és naplózódik, a deploy a többivel folytatódik.

### Commit és push

0. **Ágellenőrzés:** ha a klón nem a `main`-en áll, a deploy hibával megáll, és nem ír semmit.
1. `gitPullRebase` a klónon (`src/vault/git.ts`: `git pull --rebase --autostash`). Nem `--ff-only`: egy elutasított push után a helyi deploy-commitok és a közben előrelépett távoli `main` szétágazna, és a fast-forward pull minden későbbi futást megállítana. A rebase a helyi commitokat a távoli ágra teszi; ez azért biztonságos, mert a klón csak a deployé, és a deploy csak a `content/notes` alá ír. Ütközésnél (pl. valaki ugyanazt a jegyzetet a távoliban kézzel módosította) a rebase visszavonódik, a deploy hibával áll meg, írás nincs.
1b. **Félbemaradt futás maradéka:** ha egy korábbi futás kiírt egy fájlt, de a commit elmaradt, az összevetés változatlannak látná, és sosem commitolná. Ezért a deploy a pull **után** a `content/notes` commitolatlan változásait egy külön commitba veszi (a klón csak a deployé, ott más nem ír). A pull után, mert az előtte készült commit is szétágaztatna.
2. Írás, majd **tételenként egy commit** a `gitCommitPaths`-szal, csak a tétel mappájának útjaival. Az üzenet a `noteCommitMessage` mintájára készül (a cím rövidül, az azonosító marad). A pontos alak a végrehajtóé.
3. Egy `gitPush` a végén. A push-hiba ugyanúgy kezelődik, mint a vaultnál: a commit helyben marad, a hívó jelzi, a következő futás pullja a távoli ágra teszi, és pusholja.

A deploy **csak hozzáad és frissít**, nem töröl (a törlés: showroom #7).

### Mikor fut

**Config** (`refinery.config.yaml`):

```yaml
showroom:
  deploy: manual          # auto | manual
  clone_path: /abs/út/refinery-showroom
```

- Ha nincs `showroom:` blokk, a deploy ki van kapcsolva: az `auto` bekötések nem futnak, a `refinery deploy` értelmes hibával áll meg.
- A `clone_path` abszolút út, induláskor ellenőrizve: létező mappa, git-repó (mint a `vault.path`). **A refinery nem klónoz**: a klónt a felhasználó hozza létre gépenként egyszer, a deploy csak pullol, commitol és pushol.
- A `clone_path` egy **külön, csak a deploynak fenntartott klón** (pl. `~/github/pcsontos/refinery-showroom-deploy`), nem a site fejlesztői munkapéldánya, hogy a deploy commitjai ne keveredjenek a kézi munkával, és ne egy feature-ágra menjenek (felhasználói döntés, 2026-10-25). A dokumentáció (README, config-példa) ezt kimondja.
- Az átalakító modellje **nem** kerül be most, a #278 hozza.

**`refinery deploy`** (kézi): a **teljes vaultot** nézi, és mindent kiküld, ami hiányzik vagy megváltozott. Újrafuttatható; a második futás változatlan vaultnál nem ír és nem commitol. Ez tölti fel a régi jegyzeteket is, ezért **külön `--all` kapcsoló nincs** (eltérés a jegytől; **az én döntésem**).

**`auto`**: csak az adott futás tételeire fut, nem a teljes vaultra, hogy a #278 után egy Telegram-kérés ne indítson tömeges LLM-átalakítást a régi jegyzetekre. Bekötés:
- CLI: a vault `commitPending` + push után (`src/cli.ts:687` környéke);
- serve: a vault-push után, a `ready` jelentés előtt. Egyetlen hely: a `runRecipes` (`src/serve/summary.ts`), mert a `job.ts` többi `ready`-ága (felirat-, szöveg-feltöltés) nem ír vaultba.
- **watch: nincs bekötés.** A `watchRound` csak átiratot ír (modellt nem hív), az átirat pedig nem megy a site-ra, tehát a bekötésnek nem lenne mit deployolnia. Ha a watch egyszer recepteket is futtat, akkor kell (felhasználói döntés, 2026-10-25, eltérés a jegytől).

**Deploy-hiba az `auto` úton** (pull, push, kivétel): a futás eredménye megmarad, a hiba nem buktatja a jobot. A CLI a push-sorhoz hasonló sorban jelzi. A serve naplózza, és a `ready` ugyanúgy megy. A Telegram nem kap róla jelzést (**az én döntésem**; ha kell, külön jegy).

A kihagyott nyelvi változatok listája (ok szerint) a kimenet része: CLI-ben kiírva, serve-ben naplózva.

## Nem cél

- LLM-es átalakítás, prompt, modellbeállítás (#278).
- A site-repó klónja és push-joga a konténerben (homelab-compose; a felhasználó külön lépésben csinálja, emlékeztető: #322).
- `de` és más célnyelvek (#281), nem `hu`/`en` eredeti (showroom #11).
- Törlés a site-ról (showroom #7).

## Elfogadási feltétel

Vitest, hamis gittel és hamis átalakítóval, a meglévő tesztek mintájára:
- a második `deploy` változatlan vaultnál nem hív átalakítót és nem commitol;
- `mdx_fallback: true` jegyzetnél, ha van (hamis) LLM-es átalakító, a deploy változatlan `generated_at` mellett is újra átalakít; LLM-es átalakító nélkül nem;
- le nem forduló LLM-kimenetnél a determinisztikus változat kerül a commitba;
- leforduló, de a listán nem szereplő komponenst (pl. `<Foo>` vagy `<div>`; a jegy `<Step>` példája a mai lista szerint érvényes) vagy attribútumértéket (pl. `<Callout type="danger">`) tartalmazó kimenetnél a determinisztikus változat kerül a commitba;
- a nyers átirat nem kerül a commitba; a `_glossary-hu.md` `glossary.hu.mdx`-ként, a vault-commit idejével mint `generated_at`, és a tétel `source`/`origin`-jével megy ki; a bővült szójegyzék a következő deployban frissül;
- `hu-orig` nyelvű eredeti `.hu.mdx`-ként, `language: hu`-val megy ki; `origin` nélküli régi jegyzet pótolt `origin`-nel;
- `clean-moderate-hu` fordítás (`translation_of: clean`) `clean-moderate.hu.mdx`-ként, `kind` és `translation_of` `clean-moderate`-tel megy ki;
- nem `main`-en álló klónnál a deploy hibával megáll, és nem ír, nem commitol;
- a komponenslista a pull után olvasódik: a pull által módosított lista már érvényes;
- magyar eredetijű, angol fordítású jegyzetnél `summary.hu.mdx` és `summary.en.mdx` kerül a commitba, a fordításé `kind: summary`-vel;
- `de` fordítás nem kerül a commitba, és a napló megnevezi;
- URL nélküli tétel kimegy, `url` mező nélkül;
- fordítás hiányzó `source_generated_at`-tel: pótolva megy ki; ha az eredeti sincs meg, kimarad és naplózódik;
- fordítás hiányzó `source_language`-dzsel: kimarad és naplózódik;
- a determinisztikus változat a `{`, `<` karaktereket tartalmazó törzsre is lefordul, a kódblokk tartalma változatlan;
- `deploy: manual` (és `showroom:` blokk nélkül) egy CLI- vagy serve-futás nem deployol;
- egy kiírt, de commitolatlan `.mdx` a következő futásban commitba kerül;
- `auto` mellett a futás csak a saját tételeit deployolja;
- a serve a deployt a `ready` előtt futtatja, és a deploy hibája mellett is `ready`-t jelent.

Élő próba (a felhasználó gépén, a helyi klónnal): `refinery deploy` után a régi jegyzetek megjelennek a site-on (adminként belépve: minden új jegyzet `private`, a láthatóság a deploy dolga nem), és a site buildje és CI-ja zöld; a második futás nem commitol.
