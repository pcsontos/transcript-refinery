# Spec — A `/notes` a vaultból, a `serve`-en át (#180, bővítve)

**Dátum:** 2026-10-09 · **Státusz:** átnézésre vár

Ez a dokumentum a #180 bővített tervezéséből készült. Az eredeti issue a jegyzettartalom GitHub API-függését szüntette volna meg; a tervezés közben kiderült, hogy a `/notes` lista is csak a Telegramról indított futásokat látja (a D1-ből olvas), a `refinery run`-nal készült jegyzeteket nem. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

A `/notes` minden jegyzetet mutat, bárhonnan indult a futása, és a tartalmát a peter-mba vaultjából olvassa; a vault olvasásához és írásához sehol nem kell GitHub-specifikus kód.

## Háttér: miért a vault az igazságforrás

Futás három helyről indul: a peter-mbp-ről (fejlesztés, próba), a peter-mba gazdagépéről (`ssh peter-mba refinery run …`) és a peter-mba konténeréből (`serve`, Telegram). Mindháromnak saját `.state/refinery.db` SQLite-ja van, a Workernek pedig a D1. Egyetlen közös pont van: a vault, git-en át. Minden jegyzet frontmattere tartalmazza a listához szükséges adatokat (`item_id`, `title`, `source`, `url`, `generated_at`).

## Ezen a körön kívül

- Cache (R2 vagy D1) arra az időre, amikor a peter-mba alszik: későbbi kör. Addig ilyenkor a `/notes` nem érhető el.
- A `web` `origin`-érték: akkor kerül be, amikor a webfelület futást indíthat.
- A `refinery-mba.peteroncode.dev/notes` útvonal (Worker-route a `serve` hosztnevén).
- A kódrepó és a kiadás GitHub-kötései: `ghcr.io` kép, GitHub Actions CI, a `yt-dlp` letöltése a Dockerfile-ban, az `org.opencontainers.image.source` címke. Ezek nem a vaulthoz tartoznak.
- A konténer git-hozzáférése egy esetleges új forge-hoz (SSH-kulcs, `known_hosts`): beállítás, nem kód.
- A D1 `jobs` és `runs` tábláinak átalakítása; a Telegram-folyamat (sor, értesítés, CAS) változatlanul ezeket használja.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Honnan jön a lista? | A vault fájljaiból, a `serve` olvassa (`git pull` után). Se a D1, se a SQLite. |
| Ki a felület? | A Worker marad (Cloudflare Access-belépés); a `serve`-től kér listát és tartalmat. |
| Ki rendereli a markdownt? | A `serve`, `markdown-it`-tel, `html: false` beállítással, mint a `web/server/utils/markdown.ts`. |
| Látszik-e, honnan indult a futás? | Igen: új `origin` frontmatter-mező, értéke `telegram` vagy `cli`. A `source` nem változik, mert abból számolódik a jegyzet vault-beli útvonala (`src/vault/paths.ts:26`). |
| Kinek a jegyzetei látszanak? | Mindenkinek minden, aki az Access mögé belép. A `sub` szerinti szűrés megszűnik (ma egy felhasználó van). |
| Mi lesz a régi bot-linkekkel? | Működnek: a `jobId`-ból (`<update_id>:<videóazonosító>`) a Worker kiveszi a videóazonosítót. |
| `noteUrl` | Vault-relatív útvonal lesz GitHub-URL helyett. |
| „Megnyitás a GitHubon” link | Megszűnik, nem kerül helyére másik forge-link. |
| Ha a peter-mba alszik | A `/notes` hibaüzenetet ad (502). Elfogadott, a cache későbbi kör. |

## 1. `serve`: vault-beolvasás

Új modul (például `src/serve/notes.ts`), amely a betöltött config `notesRoot` mappáját olvassa.

### Beolvasás

- A `notesRoot` alatt rekurzívan minden `*_transcript.md` egy elem kiindulópontja. Az alapnév a fájlnév a `_transcript.md` vég nélkül.
- Ugyanabban a mappában minden `<alapnév>_<fajta>.md` fájl az elem egy jegyzete; a fajta a kettő közötti rész (`summary`, `notes-hu`, `clean-moderate-hu`, …). A `transcript` is fajta.
- Egy fájl frontmattere az első két `---` sor közötti YAML, a meglévő `yaml` csomaggal olvasva. Frontmatter nélküli vagy hibás YAML-ű fájl kimarad (a beolvasás nem bukik meg miatta).
- A `_queue.md` (és bármely `_`-szal kezdődő fájl) kimarad.
- A fajtának illeszkednie kell a `^[a-z]+(-[a-z]+)*$` mintára; ami nem illeszkedik, kimarad.

### Csoportosítás

- Az elemek kulcsa a frontmatter `item_id` mezője. Ha két mappában ugyanaz az `item_id` szerepel (ugyanazt a videót a Telegram és a terminál is feldolgozta), egy elemmé olvadnak.
- Ha egy fajta több fájlban is megvan, a nagyobb `generated_at` értékű nyer. Hiányzó `generated_at` a legkisebbnek számít.
- Az elem `title`, `url` és `origin` mezője a legfrissebb (`generated_at`) jegyzetéből jön; az elem `generatedAt` értéke ugyanez.

### Az `origin` meghatározása

1. Ha a frontmatterben van `origin`, és értéke `telegram` vagy `cli`, az számít.
2. Ha nincs: `source: serve-out` → `telegram`, minden más → `cli`. (A régi jegyzeteket nem írjuk át.)

### A `git pull`

- Minden `/notes` listakérés előtt `git pull --ff-only` a vaulton, a meglévő `gitPullFfOnly` (`src/vault/git.ts`) használatával, legfeljebb 10 másodperc időkorláttal.
- Hiba vagy időtúllépés esetén a beolvasás a helyi állapotból fut, és a válasz `stale: true` jelzést kap.
- Egy jegyzet lekérése (`/notes/<id>/<fajta>`) nem pullol: a lista már frissített.

## 2. `serve`: új útvonalak

A `src/serve/http.ts` `handle` függvénye két új GET útvonalat kap, mindkettő a meglévő `authorized` Bearer-ellenőrzéssel (rossz vagy hiányzó titoknál `401`):

| Útvonal | Válasz |
|---|---|
| `GET /notes` | `200`, `application/json`: `{ "stale": false, "items": [ { "itemId", "title", "url" \| null, "origin", "generatedAt" \| null, "kinds": ["summary", "transcript", …] } ] }`. Az `items` `generatedAt` szerint csökkenő. A `kinds` sorrendje nem kötött. |
| `GET /notes/<itemId>/<fajta>` | `200`, `application/json`: `{ "title", "url" \| null, "origin", "generatedAt" \| null, "html" }`. Ismeretlen elem vagy fajta, illetve a mintára nem illeszkedő fajta: `404`. |

- Az útvonal egyik szegmenséből sem rak össze fájlútvonalat: a fájlt a beolvasás eredményéből választja ki. Így `..`-t tartalmazó kéréssel sem lehet a vaulton kívülre jutni.
- A `html` a jegyzet törzséből készül, a frontmatter nélkül, `markdown-it`-tel (`html: false`, `linkify: false`). A modell által írt nyers HTML így szövegként jelenik meg.
- A `markdown-it` a gyökércsomag függősége lesz (a `web` már használja, a lockfile-ban benne van); a `@types/markdown-it` fejlesztői függőség.
- A szerver a vault-olvasást függőségként kapja (`createServeServer` bemenete), hogy a HTTP-tesztek hamis olvasóval is futhassanak.
- Ha a `serve` config nélkül fut (nincs vault), a két útvonal `503`-at ad.

## 3. Worker: a `/notes` a `serve`-ből

### Lista (`GET /notes`)

- A Worker a `SERVE_URL`-en hívja a `serve /notes`-t a `REFINERY_SERVE_SECRET`-tel, 10 másodperc időkorláttal.
- A lap szerkezete a mai: elemenként a cím (a YouTube-linkkel, ha van `url`), a dátum (`generatedAt` napja), egy `telegram`/`cli` címke, alatta a fajták linkjei.
- A fajták sorrendje a mai `KIND_ORDER` (`worker/src/reader.ts:48`): a receptek a gombok sorrendjében, mindegyik után a fordításai, az ismeretlen fajta a végén, a `transcript` legutoljára.
- A linkek alakja: `/notes/<itemId>/<fajta>`.
- `stale: true` esetén a lap tetején egy sor: „A vault frissítése nem sikerült, a lista nem friss.”
- Üres `items`: a mai `NO_NOTES` üzenet.

### Egy jegyzet (`GET /notes/<id>/<fajta>`)

- Ha az `<id>` kettőspontot tartalmaz (régi bot-link, `<update_id>:<videóazonosító>`), a Worker az utolsó kettőspont utáni részt veszi `itemId`-nak.
- A Worker a `serve /notes/<itemId>/<fajta>`-t hívja, és a választ a mai oldalkeretbe teszi: fejléc a címmel (YouTube-linkkel, ha van), a fajtával, az `origin`-címkével és a dátummal, alatta a `html`.

### Hibák

| Helyzet | Válasz |
|---|---|
| A `serve` nem válaszol 10 s alatt, vagy hálózati hiba | `502`, „A peter-mba nem érhető el, a jegyzetek most nem olvashatók.” |
| A `serve` `401`-et ad | `502`, „A Worker és a serve titka nem egyezik.” |
| A `serve` `503`-at ad | `502`, „A serve nem éri el a vaultot.” |
| A `serve` `404`-et ad | `404`, a mai `NOTE_MISSING` szöveggel |

### Bot-üzenetek

A `runReadyMessage` (`worker/src/plan.ts:109`) linkjei `/notes/<videóazonosító>/<fajta>` alakúak lesznek `/notes/<jobId>/<fajta>` helyett.

## 4. Az `origin` beírása

- A `baseFields` (`src/vault/render.ts:51`) új `origin` mezőt kap a `source` után. Így az átirat, a receptjegyzet és a fordítás frontmatterébe is bekerül.
- Az érték a futás kapcsolóiból jön: a `commandRun` kapcsolói (`src/cli.ts:375` környéke) új `origin?: 'telegram' | 'cli'` mezőt kapnak, alapértéke `cli`; a pipeline a jegyzet rendereléséig viszi.
- A `runRecipes` (`src/serve/summary.ts:140`) `origin: 'telegram'`-et ad át. A `run`, a `watch` és a `queue` `cli` marad.

## 5. A GitHub-függés kivezetése

### `serve`

- A `githubNoteUrl` és a fájlja (`src/serve/note-url.ts`, a tesztjével) törlődik.
- A `runRecipes` `noteUrl` helyett a vault-relatív útvonalat adja vissza (például `Inbox/transcript-refinery/serve-out/<alapnév>_transcript.md`). Az „A vault távoli címe nem GitHub-cím.” hiba (`src/serve/summary.ts:186`) megszűnik; ma ez minden nem-GitHub remote-ú vaultnál megbuktatja a Telegram-recepteket.
- A callback alakja nem változik: `noteUrl` mezőben megy a relatív útvonal.

### Worker

- A Worker a `noteUrl`-t továbbra is nem üres szövegként ellenőrzi és eltárolja (`worker/src/handle.ts:278`); a `/notes` nem olvassa. A D1 `note_url` oszlopa marad, migráció nincs.
- Kikerül:
  - a `reader.ts` GitHub-része (a `vaultPath` és a GitHub Contents API hívása), a D1-ből olvasó lista;
  - a `notesFor` a store-ból, a D1-ből és a teszt-store-ból;
  - a `GITHUB_DOWN`, `VAULT_LOCKED` és `OPEN_ON_GITHUB` üzenet;
  - az `Env` `VAULT_GITHUB_TOKEN`, `VAULT_REPO` és `VAULT_BRANCH` mezője, és a `wrangler.toml` megfelelő bejegyzései, ha vannak.
- A `runsFor` és a `findRow` marad, ha a Telegram-folyamat használja; ha csak a régi olvasó használta, az is kikerül.

### A felhasználó teendője telepítés után

- `wrangler secret delete VAULT_GITHUB_TOKEN` a Workeren, és a GitHub-token visszavonása.

## 6. Telepítési sorrend

1. Konténerkép (`pnpm docker:publish`), a peter-mba konténer frissítése. A régi Worker ezt nem veszi észre.
2. Worker (`pnpm worker:deploy`).

Fordított sorrendben a köztes időben a `/notes` 502-t ad (a régi `serve`-nek nincs `/notes` útvonala); más hiba nincs.

## 7. Tesztelés

A meglévő minta szerint `vitest`; a `serve` beolvasása ideiglenes könyvtárban valódi fájlokkal, a HTTP-réteg valódi szerverrel, a Worker hamis `fetch`-csel. Minden pont megfigyelhető viselkedést ír le.

### `serve`: beolvasás

- Két mappában ugyanaz az `item_id`, mindkettőben `summary`: a válaszban egy elem, a `summary` a nagyobb `generated_at`-ű, és az elem `generatedAt` értéke az övé.
- `origin` nélküli `serve-out` jegyzet → `telegram`; `origin` nélküli `youtube` jegyzet → `cli`; `origin: cli` egy `serve-out` jegyzetben → `cli`.
- A `_queue.md`, a frontmatter nélküli és a hibás YAML-ű fájl nincs a listában, és a beolvasás nem bukik meg.
- Ha a `git pull` hibát dob, a válasz `200`, az elemek megvannak, `stale: true`.

### `serve`: HTTP

- Titok nélkül a `GET /notes` és a `GET /notes/<id>/<fajta>` `401`.
- A `<script>alert(1)</script>` törzsű jegyzet `html`-jében `&lt;script&gt;` áll, `<script>` nem.
- A `html` nem tartalmazza a frontmatter mezőit (például az `item_id:` szöveget).
- `GET /notes/<id>/..%2F..%2Fetc`, `GET /notes/<id>/Summary` és ismeretlen `itemId`: `404`.
- Config nélküli `serve`-nél: `503`.

### Worker

- Ha a hamis `serve` két elemet ad, a lap két elemet mutat a címkéikkel, a linkek `/notes/<itemId>/<fajta>` alakúak, a fajták `KIND_ORDER` szerint, a `transcript` a végén.
- `stale: true`-nál a figyelmeztető sor megjelenik.
- `GET /notes/123:abcdefghijk/summary` a `serve`-től az `abcdefghijk/summary`-t kéri.
- Időtúllépés → `502` a „peter-mba nem érhető el” szöveggel; `401` → `502` a „titka nem egyezik” szöveggel; `404` → `404`.
- A `runReadyMessage` linkje `/notes/<videóazonosító>/<fajta>`.

### Az `origin` és a `noteUrl`

- `commandRun` `origin` nélkül olyan jegyzetet ír, amelynek frontmatterében `origin: cli` áll; a `runRecipes` által indított futásé `origin: telegram`.
- Ha a vault remote-ja `https://codeberg.org/x/y.git`, a `runRecipes` `ok: true`-t ad vissza, és a `noteUrl` a vault-relatív útvonal.

### Élő próba telepítés után

A felhasználó végzi; ezt kell látni:

1. A `https://transcript-refinery.peteroncode.workers.dev/notes` lapon a `refinery run`-nal készült jegyzetek is megjelennek (például a 3Blue1Brown-videó `bloom`, `notes` és `notes-hu` jegyzete), `cli` címkével.
2. Egy régi Telegram-link ugyanazt a jegyzetet nyitja meg, GitHub-link nélkül.
3. Egy új Telegram-recept után a jegyzet frontmatterében `origin: telegram` áll, és a bot linkje `/notes/<videóazonosító>/…` alakú.
4. Ha a peter-mba alszik, a lap a „nem érhető el” üzenetet adja.
