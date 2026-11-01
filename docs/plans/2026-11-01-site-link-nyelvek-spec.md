Spec — Telegram-link a site-ra (`SITE_URL`) és nem hu/en eredeti nyelvű jegyzetek deployja

**Dátum:** 2026-11-01 · **Státusz:** tervezet

Ez a dokumentum a #279 és a #334 közös tervezéséből készült (szülő: #280). A jegyek leírása az alap; ahol ez a spec eltér tőlük vagy pontosítja őket, ez érvényes. A #277 (`docs/plans/2026-10-24-refinery-deploy-spec.md`), a #278 (`docs/plans/2026-10-30-llm-mdx-spec.md`) és a #340 (`docs/plans/2026-10-31-deploy-szures-spec.md`) döntései változatlanok, kivéve a deploy-spec „Kimarad" sorának nyelvi pontját (lásd B).

A #282 (jegyzet törlése a site-ról a refinery felől) a tervezés elején ebben a körben volt, a felhasználó kivette (2026-11-01). Az issue nyitva marad.

## A cél egy mondatban

A Telegram „kész" üzenetének linkje a site-on nyissa meg a jegyzetet, és a site-ra a nem magyar és nem angol eredeti nyelvű jegyzetek (pl. holland videó) is kimenjenek.

## Miért

- **A:** a site (`transcripts.peteroncode.dev`) a jegyzetek fő felülete lett: tagolt MDX, kétnyelvű felület, láthatóság. A Telegram-link ma a Worker egyszerű HTML-oldalára (`/notes/<id>/<kind>`) visz, amely ráadásul csak akkor működik, ha a peter-mba ébren van.
- **A felhasználó helyzete:** a „kész" üzenet linkjét **csak magának nyitja meg**, bejelentkezve (admin), nem küldi tovább. A private jegyzet tehát megnyílik neki.
- **B:** a `refinery deploy` ma minden `hu`/`en`-től eltérő nyelvű jegyzetet kihagy. A site a pcsontos/refinery-showroom#11 óta (2026-10-29) befogadja a bármilyen ISO 639-1 nyelvű eredeti változatot; a refinery-oldali párja hiányzik.

## Anti-cél

- **Halott link tartósan.** A link legfeljebb a deploy végéig (percek) adhat 404-et, utána mindig élő oldalra mutat. Olyan link, amely sosem lesz élő (pl. a site által el nem fogadott fordítási nyelv), nem mehet ki. **Elfogadott kivétel (felhasználói döntés, 2026-11-01):** ha a deploy egy jegyzetet a Worker számára nem látható okból hagy ki (pl. hiányzó vagy listán kívüli nyelv, hiányzó `generated_at`), a link tartósan 404 marad. Ez ritka, a régi Worker-link kézzel elérhető; serve→Worker jelzés erre nem készül.
- **A Telegram-fiók összekötése elromlik.** A `/link?t=…` link a Workeren kell maradjon.
- **A deploy eltöri a site buildjét** egy olyan nyelvi kóddal, amelyet a site nem fogad el.

## Előfeltétel-tények (ellenőrizve, 2026-11-01)

- A Telegramról indított futások **mindig a peter-mba konténerén** mennek le, ott a `showroom.deploy` `auto` (a felhasználó közlése). Az `auto` deploy a futás jelentése után, tételenként fut (`src/serve/summary.ts:223-242`). A deployig tartó 404 ezért percekben mérhető, ez elfogadott (#279).
- A site nyelv nélküli útja átirányít: `GET /notes/3IetFvFg2cE/clean-deep` → `307` a `/<nyelv>/notes/…`-ra, az `Accept-Language` szerint (próbálva `hu`-val; a felhasználó böngészőjében `en`-re visz). A nyelvi úton bejelentkezés nélkül `307` a `/<nyelv>/login?next=…`-re.
- A site tartalomútja `content/notes/<itemId>/<kind>.<language>.mdx`; a fordítás nem külön fajta (a `summary-en` vault-fajta a site-on `summary`, `en` nyelvvel).
- A Telegram nyolc receptje (`worker/src/messages.ts:70`) mind site-fajta (`SITE_KINDS`, `src/deploy/deploy.ts:49`).
- A Telegram célnyelvei: `en, hu, nl, de, es, fr, it` (`worker/src/messages.ts:80`); a site fordítást csak `hu`/`en` nyelvre fogad el (`lib/note-frontmatter.ts`; a többi a #281).
- A szöveges tétel azonosítója a Workerben és a vaultban is `t-<16 hex>` (`src/source/text-core.ts:131`, vault `item_id`), a deploy ezt használja mappanévnek, így a link azonosítója egyezik.

## A. Telegram-link a site-ra (#279)

### A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Alaprecept-futás linkje | `<SITE_URL>/notes/<itemId>/<recept>`, **nyelv nélkül**; a site a böngésző nyelvére irányít | Issue; a felhasználó a próba után megerősítette (2026-11-01) |
| Fordítás linkje (`hu`/`en` célnyelv) | `<SITE_URL>/<célnyelv>/notes/<itemId>/<recept>`: egyenesen a lefordított változat. A recept a futás receptje (`summary`), nem a `summary-<nyelv>` | Felhasználói döntés (2026-11-01) |
| Fordítás más célnyelvre (`nl`, `de`, `es`, `fr`, `it`) | A **régi Worker-link** marad (`<origin>/notes/<itemId>/<recept>-<nyelv>`), mert ez a változat a site-on nem létezik | Az én döntésem (anti-cél: tartósan halott link) |
| `SITE_URL` hiányában | Minden link a mai formában (kérés-origin, `/notes/…`) | Issue |
| A fiók-összekötés linkje (`/link?t=…`, `worker/src/handle.ts:439`) | A Worker originjén marad; a `SITE_URL` csak a jegyzetlinkeket érinti. A `linkBase` ezért nem írható felül egyszerűen | Az én döntésem |
| A `SITE_URL` helye | Nem titkos érték: a `worker/wrangler.toml`-ba egy **új** `[vars]` blokk kerül (ma nincs ilyen), `https://transcripts.peteroncode.dev` értékkel. Egy fájlbeli `[vars]` blokk a deploykor lecseréli a dashboardon kézzel állított sima (nem titkos) változókat, ezért a terv első lépése a dashboard ellenőrzése; a titkokat nem érinti | Issue („wrangler var"); a blokk hiánya és a felülírás a builder-check találata |
| Helyi és debug Worker | Az üres `SITE_URL` hiánynak számít. A `scripts/telegram-debug.sh` a `worker/.dev.vars`-ba üres `SITE_URL`-t ír, mert a helyben készült jegyzet sosem kerül a site-ra. A `pnpm worker:dev` az éles serve-et használja, ott a `[vars]` értéke marad | Az én döntésem (builder-check találata) |
| Záró `/` a `SITE_URL`-ben | Levágva, hogy ne legyen `//notes` | Az én döntésem |
| A régi `/notes` útvonalak | Változatlanok | Issue |

### Működés

- A link minden helyen ugyanabból a függvényből jön, ahol ma (`runReadyMessage`, `worker/src/plan.ts:168`); a hívók (`worker/src/handle.ts:589, 605, 631, 699`) a mostani `linkBase` mellett megkapják a `SITE_URL`-t is (pl. a `WorkerDeps` új mezőjeként, `worker/src/index.ts:78`). A pontos alak a tervé.
- A `done`-ágon (`handle.ts:605`, `body.done`) érkező fajtanevek formáját a terv a serve kódjával veti össze (alaprecept-név, vagy fordításnál `<recept>-<nyelv>`), és ugyanarra a site-útra képezi le őket.
- Az üzenet első sora (cím, receptek, „A jegyzet megvan." / „A fordítás megvan.") nem változik.

### Elfogadási feltételek

- Worker-teszt (`worker/src/plan.test.ts`, és ahol a hívók tesztje van, `handle.test.ts`):
  - `SITE_URL`-lel alapreceptre a link `<SITE_URL>/notes/<itemId>/<recept>`.
  - `SITE_URL`-lel `hu` és `en` fordításra a link `<SITE_URL>/<nyelv>/notes/<itemId>/<recept>`.
  - `SITE_URL`-lel `de` fordításra a régi Worker-link.
  - `SITE_URL` nélkül minden link a mai formában.
  - Záró `/`-es `SITE_URL` sem ad `//`-t.
  - A `/link?t=…` link `SITE_URL` mellett is a Worker originjén van.
- Élő próba a kiadás után: egy Telegramról indított alaprecept „kész" linkje a deploy után a site-on nyitja meg a jegyzetet; egy `en` fordítás linkje az `/en/…` változatot.
- Dokumentáció: `docs/operations/telegram-worker-topology.md` (a `SITE_URL` sora a konfigurációs táblában, és a link viselkedése).

## B. Nem hu/en eredeti nyelvű jegyzetek deployja (#334)

### A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Elfogadott nyelv az eredeti változatnál | Bármely kétbetűs, kisbetűs ISO 639-1 kód, **pontosan a site listája** (183 kód, a visszavontak nélkül, `lib/note-frontmatter.ts`) | Issue; a site szerződése (`docs/content-format.md`) |
| A kódlista forrása | A refinery a site listájának átiratát kapja, külső függőség nélkül, a meglévő átirat-minta szerint (`src/deploy/mdx.ts:90`, „a site … átirata") | Az én döntésem: így pontosan azt engedi át, amit a site buildje elfogad |
| Fordítás nyelve | Továbbra is csak `hu`/`en`; a többi kihagyás, `nyelv: <kód>` okkal | Issue (a többi a #281) |
| `-orig` levágása | Változatlan (`nl-orig` → `nl`) | Issue |
| Hiányzó vagy ismeretlen nyelv | Kihagyás és napló, megnevezett okkal (pl. `nyelv: xx`, `nyelv: ismeretlen`) | Issue |
| Az LLM-átalakítás nyelve (`src/deploy/llm.ts:31-33`) | A prompt nyelvneve bármely kódra működjön (pl. a stdlib `Intl.DisplayNames` angol neve: `nl` → `Dutch`). A bevezető Callout címe (`INTRO_TITLES`) a `hu`/`en` mellett a Telegram további nyelveire (`nl`, `de`, `es`, `fr`, `it`) saját nyelvű címet kap, a többi kódra az angol `In brief`-et | Az én döntésem: a holland jegyzet holland bevezetőt kap, egy ritka nyelv nem bukik el emiatt |

### Működés

- A `variantOf` (`src/deploy/variant.ts:45`) nyelvi feltétele: eredeti változatnál a kód a listán van; fordításnál `hu` vagy `en`. A `SiteLanguage` típus ennek megfelelően tágul (eredetinél bármely listás kód).
- A frontmatter-ellenőrzés (`frontmatterError`, `src/deploy/mdx.ts:99`) a site szabályát követi: eredeti változat suffixe a listán, fordításé `hu`/`en`, a hibaszövegek a site szövegeinek mintájára.
- A célfájl `<fajta>.<nyelv>.mdx` (pl. `summary.nl.mdx`), `language: nl`.
- **Árva fordítás:** ha egy tétel egy fajtájának nincs a site-ra kerülő eredeti változata (a vaultban nincs, vagy kihagyásra kerül, pl. listán kívüli nyelv miatt), a fordításai is kimaradnak, `nincs eredeti változat a site-on` okkal. A site buildje az eredeti nélküli fordításra elbukik (`resolveVariants`, showroom `lib/note-variants.ts:23`), és ma a deploy ezt nem szűri (`src/deploy/deploy.ts:223-246`). Az én döntésem (anti-cél: a deploy nem törheti el a site buildjét; builder-check találata).
- A deploy minden más viselkedése (kártyák, szójegyzék, változásfelismerés, költségplafon, szűrés) változatlan.

### Elfogadási feltételek

- Vitest:
  - Egy holland eredetijű vault-jegyzetből `<fajta>.nl.mdx` nyelvi változat lesz `language: nl`-lel; a `nl-orig` is `nl`.
  - A listán nem szereplő kód (`xx`) és a hiányzó nyelv kihagyás, megnevezett okkal.
  - Egy `de` célnyelvű fordítás kihagyás, `nyelv: de` okkal.
  - Egy `xx` nyelvű eredeti mellett álló `hu` fordítás is kihagyás, `nincs eredeti változat a site-on` okkal; a szűrt (`--kind`) futás is így viselkedik.
  - A `frontmatterError` egy `summary.nl.mdx` eredetit elfogad, egy `summary.nl.mdx` fordítást (`translation_of`-fal) elutasít.
  - Az LLM-prompt egy `nl` jegyzetnél a `Dutch` nyelvnevet és a holland Callout-címet kapja.
- Élő próba: egy holland eredetijű jegyzet deployja után a site buildje zöld, és a jegyzet a `/hu` és az `/en` felületen a holland szöveget mutatja a felület nyelvén írt jelzéssel (pcsontos/refinery-showroom#11).
- Dokumentáció: `docs/usage.md` 8. fejezet „Mit hagy ki" pontja, és a deploy-spec (`docs/plans/2026-10-24-refinery-deploy-spec.md:48`) „Kimarad" sora: a nyelvi kihagyás csak a listán kívüli kódra és a nem `hu`/`en` fordításra vonatkozik.

## Telepítési sorrend

- A B a serve-képben fut (a peter-mba `auto` deployja és a kézi `refinery deploy`), az A a Workerben. A kettő egymástól független, bármelyik mehet előbb.
- A site oldaláról nincs teendő: a #11 már élesben van.

## Ezen a körön kívül

- #282 (törlés a refinery felől) — kivéve, nyitva marad.
- #281 (nem `hu`/`en` célnyelvű fordítás a site-on). Ha elkészül, az A „más célnyelv" sora a site-linkre válthat.
- #346 (lejátszási lista Telegramról).
- #195 (Worker `/notes` cache alvás idejére): az A után a fő link a site-ra mutat, amely nem függ a peter-mba ébrenlététől. Javaslat: a kiadás után a felhasználó döntsön a lezárásáról.

## Ami a tervre marad

- A `SITE_URL` útja a `runReadyMessage`-ig (paraméter vagy `WorkerDeps`-mező), és a hívók tesztjeinek igazítása.
- A `done`-ágon érkező fajtanevek pontos formájának ellenőrzése a serve kódjában.
- Az ISO-lista helye a refinery-ben (új modul vagy a `mdx.ts` mellett), és a `SiteLanguage` típus átnevezése, ha félrevezetővé válik.
- A Callout-címek pontos szövege az öt további nyelven.
