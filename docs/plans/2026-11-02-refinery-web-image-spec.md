Spec — A webes felület a daemon image-ben, karcsúsított image-dzsel

**Dátum:** 2026-11-02 · **Státusz:** tervezet

Ez a dokumentum a `refinery-web` brainstormingjából készült (2026-11-02). A kiinduló terv a homelab repóban van (`docs/refinery-web-plan.md`); a homelab-oldali lépések ott maradnak, ez a spec csak a transcript-refinery repó változásait írja le. Issue még nincs.

## A cél egy mondatban

A `web/` Nuxt-felület ugyanabban az image-ben kerüljön ki, mint a `refinery serve`, közös verziószámmal, az image közben a futáshoz nem kellő függőségektől megszabaduljon, és a konténer leállítása a futó futást lezárja, ne hagyja örökre „fut” állapotban.

## Miért

- **A felhasználó szavaival:** a felületen követi, hol tartanak a Telegramról indított kérések, és visszanézi a korábbi futásokat. Főleg laptopról, de telefonról is, tehát útközben is. Ma a felület csak a fejlesztői Macen fut, kézzel indítva (`pnpm web`, `127.0.0.1:4310`).
- **A peter-mba-n futó felülethez image kell.** A mostani image (`ghcr.io/pcsontos/transcript-refinery:1.27.0`) csak a `dist/`-et és a CLI-t futtatja; a web build kimenete nincs benne.
- **A karcsúsítás:** a mostani image 888 MB, ebből 469 MB (kicsomagolva 572 MB) a `node_modules`, ami a teljes workspace fejlesztői függőségeit is tartalmazza (`three`, `maplibre-gl`, `typescript`, `@nuxt/devtools`, esbuild, rolldown stb.). A `serve` ezek egyikét sem használja. A felhasználó döntése: a karcsúsítás ebbe a körbe kerül, mert a `Dockerfile` úgyis változik.

## Anti-cél

- **A felület ír.** Az ADR 0011 „csak olvas” pontja változatlan: írásvédett állapottár-kapcsolat, se futásindítás, se jóváhagyás. A konténerben ezt a csak olvasható mount is kikényszeríti, de a kódnak sem szabad írnia.
- **A `serve` a karcsúsított image-ben elszáll.** Ha egy futás közben betöltött csomag rosszul van fejlesztői függőségnek jelölve, a hiba csak élesben, egy Telegram-kérésnél jönne elő. Ezt a kiadás előtt ki kell zárni (lásd Elfogadás).
- **A web és a daemon verziója elcsúszik.** Az olvasó a sémát ellenőrzi (`assertCurrentSchema`, `src/state/queries.ts:59`), és eltérésnél hibát dob; a két rész csak együtt működik.
- **A felület hitelesítés nélkül elérhető kívülről.** A hitelesítést az Authelia adja az app előtt (homelab); a `0.0.0.0` címre kötés csak a konténerben érvényes, a helyi `pnpm web` marad `127.0.0.1`-en.

## Előfeltétel-tények (ellenőrizve, 2026-11-02)

- **A Telegramos futások a felület által olvasott helyre írnak.** A `serve` a futást a CLI kódjával indítja (`src/serve/summary.ts:3`, `commandRun`), ami `<logsDir>/<id>.jsonl` naplót és `<id>.md` riportot ír (`src/cli.ts:594-597`). A `/runs` oldal ezt a mappát olvassa (`src/view/runs.ts:74`, `readRuns`), nem az adatbázist.
- **Az élő követés valódi SSE.** `web/server/api/runs/[runId]/events.get.ts` a h3 `createEventStream`-jét használja, `Last-Event-ID` alapú folytatással. A Cloudflare tunnelen át nincs kipróbálva.
- **A felület írásvédetten nyitja az állapottárat** (`src/state/reader.ts:37`, `readOnly: true`), az író viszont WAL módot állít (`src/state/db.ts:285`). Hogy WAL módban, csak olvasható mounton megnyílik-e, **nincs kipróbálva**.
- **A konfig helye.** A web a repógyökeret build-időben rögzíti (`web/nuxt.config.ts`, `runtimeConfig.refineryRoot`; a build stage-ben ez `/src/`), és a `REFINERY_CONFIG` env ezt felülírja (`web/server/utils/refinery.ts`). Konténerben tehát a `REFINERY_CONFIG` kötelező. A konfig betöltése nem olvas környezeti változót.
- **A web build önálló.** `web/.output` 9,1 MB, ebből 5,2 MB a saját `server/node_modules` (korábbi helyi build, nem a mostani kódból). A `transcript-refinery` csomag bele van csomagolva, a `node:sqlite` külső (beépített modul).
- **A mag futási függőségei kicsik.** `pnpm --filter transcript-refinery deploy --prod <cél>` macOS-en **71 MB** `node_modules`-t ad (függőségek: `ai`, `@ai-sdk/openai-compatible`, `@mdx-js/mdx`, `chokidar`, `markdown-it`, `yaml`, `zod`). A gyökér `package.json`-ben nincs `files` mező, és a `dist/` git-ignorált lehet; hogy a `deploy` kimenete tartalmazza-e a `dist/`-et, nincs ellenőrizve.
- **A PID-ellenőrzés konténerek között.** A futás állapota („fut” / „meghalt”) a `run:started` sorban rögzített PID-ből jön (`src/run/status.ts:30-37`, `process.kill(pid, 0)`). A web saját PID-térben fut, ahol a `serve` nem látszik. A `refinery` egy `#!/usr/bin/env node` fejlécű symlink (`Dockerfile`), és a homelab compose `exec`-kel indítja, ezért a `serve` **várhatóan** PID 1. A web konténerben a PID 1 a web szerver, ami mindig él, így a futó kérés helyesen „fut”-nak látszik. Élesben nincs ellenőrizve.
- **A kiadás ma** (`package.json`): a `pnpm release` a `bumpp`, ami alapból csak a gyökér `package.json`-t emeli; a `web/package.json`-ben nincs `version` mező. A `pnpm docker:publish` a natív architektúrára épít és tölt fel (a Macen arm64, ami megfelel a peter-mba-nak).
- **A korábbi döntés, amit ez felülír:** ADR 0011 („Csak a `127.0.0.1`-en figyel, hitelesítés nélkül”) és `docs/architecture.md` 13. fejezet („Publikus kitettség, tunnel, autentikációs réteg” nem épül).

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Egy vagy két image | **Egy image**: a `ghcr.io/pcsontos/transcript-refinery` tartalmazza a webet is; a web service ugyanazt az image-et más paranccsal futtatja | Felhasználói döntés (2026-11-02); a „felfújás” ellenérv mérés után nem állt meg (9 MB a 888 MB mellett) |
| A web verziója | **Közös verziószám**: a `web/package.json` kap `version` mezőt, mindig a gyökérrel azonos, a `bumpp` együtt emeli | Felhasználói döntés (2026-11-02); a web a mag kódjával olvas, külön szám valótlan függetlenséget mutatna |
| Karcsúsítás | **Ebben a körben**: a futó image `node_modules`-a csak a mag futási függőségeit tartalmazza | Felhasználói döntés (2026-11-02) |
| Hol a web az image-ben | `/app/web` (a `web/.output` tartalma), indítás `node /app/web/server/index.mjs` | Az én döntésem |
| Kötési cím a konténerben | Az image nem állít `NITRO_HOST`-ot; a homelab compose adja (`0.0.0.0`, `4310`). A `web/package.json` `start` szkriptje marad `127.0.0.1` | Az én döntésem: az image alapértéke a `serve`, a web a compose felől kapcsolódik be |
| Az image `CMD`-je | Marad `["refinery", "serve"]` | Az én döntésem: a meglévő telepítés változatlanul működjön |
| Felülírt korábbi döntés | **Új ADR 0013**: a felület Authelia mögött, a peter-mba-n fut; a 0011 `127.0.0.1` pontját részben felülírja, a „csak olvas” pont marad | Felhasználói döntés (2026-11-02) |
| Multi-arch build, CI-publikálás | Nincs; a build marad a Macen, kézzel | Az én döntésem: a peter-mba arm64, a Mac natívan azt épít |
| Leállítás futás közben (SIGTERM) | **Ebben a körben javítjuk**: a `serve` SIGTERM-re a futó futást ugyanúgy zárja le, mint a Ctrl+C-t (`run:ended`, `interrupted: true`, riport), majd kilép (lásd C) | Felhasználói döntés (2026-11-02, builder-check találata) |
| WAL + csak olvasható mount | Ha a `:ro` mounton a felület nem tudja olvasni az állapottárat, **elfogadott**, hogy a web konténerben csak a `/data/state` mappa írható; a kód akkor is `readOnly: true`-val nyit | Felhasználói döntés (2026-11-02) |
| A PID-ellenőrzés konténerek között | Ebben a körben nem javítjuk. Ismert korlát: a `docker exec … refinery run` futás (PID ≠ 1) a felületen „meghalt”-nak látszik, miközben fut. A felhasználó ilyet még nem futtat, de fog, ha az app stabil; az üzemeltetési leírásba kerül, és külön issue nyílik rá | A korlát a felhasználó válasza (2026-11-02); hogy most nem javítjuk, az az én döntésem |
| Telefonos nézet | Nem igazítjuk; ha a táblázatok kis képernyőn rosszak, külön issue | Az én döntésem |

## A. Dockerfile

- A build stage a magot és a webet is lefordítja (`pnpm build`, `pnpm --filter transcript-refinery-web build`).
- A futó stage a következőket kapja: a mag `dist/`-je, a mag **csak futási** függőségei (pl. `pnpm --filter transcript-refinery deploy --prod`, vagy `--prod` install egy külön stage-ben; a módszer a tervé), és a `web/.output` a `/app/web` alá.
- A `refinery` symlink (`/usr/local/bin/refinery` → `/app/dist/cli.js`) és a `CMD` marad.
- A Node verzió a meglévő `26.2` (a `node:sqlite` miatt a web is ezen fut, egy image-ben ez magától adódik).
- Az apt réteg és a yt-dlp változatlan. Alpine-ra váltás nincs: a yt-dlp bináris glibc-s.
- Ha a `pnpm deploy` a `dist/`-et nem viszi át, a terv a `dist/`-et külön másolja.

## B. Verzió és kiadás

- `web/package.json`: `version` mező, a gyökérrel azonos értékkel (most `1.27.0`).
- A `bumpp` mindkét `package.json`-t emelje egy lépésben (konfigfájllal vagy a `release` szkript argumentumaival; a tervé).
- A `docker:build` / `docker:push` / `docker:publish` szkriptek nevei és tagjei változatlanok: egy image, verzió- és `latest` taggel.
- A changelog-menet változatlan.

## C. Leállítás futás közben (SIGTERM)

**Tény (ellenőrizve, 2026-11-02):** a kód csak a SIGINT-et kezeli (`src/run/finish.ts:44`, `installSigint`; `src/cli.ts:829`). A `docker stop` / `just up` SIGTERM-et küld; a PID 1-ként futó Node kezelő nélkül nem áll le rá, a Docker 10 mp után SIGKILL-t küld, és a napló `run:ended` sora nem íródik ki. A web konténerben a PID 1 mindig él, így az ilyen futás örökre „fut”, és az SSE-követése nem zárul le.

**Működés:**

- Futás közben kapott SIGTERM ugyanazt az utat járja, mint a SIGINT: `run:ended` `interrupted: true`-val, riport, majd kilépés. A felületen a futás „megszakítva” lesz.
- Futás nélkül (tétlen `serve`) a SIGTERM azonnali, tiszta kilépést ad, nem a 10 mp-es SIGKILL-t.
- A CLI-ből (terminálból) indított futásnál a SIGTERM ugyanígy viselkedik.
- A lezárás (`runFinish`, `src/cli.ts:726`) git-commitot és pusht is végezhet. Ha ez nem fér bele a Docker 10 mp-es türelmi idejébe, a homelab compose `stop_grace_period`-ja nő; a terv méri, mennyi idő kell, és ennek alapján javasol értéket.
- A megvalósítás helye (`installSigint` bővítése vagy `serve`-szintű kezelő) a tervé.

## D. Dokumentáció

- **`docs/decisions/0013-...md`** (új ADR, a meglévők stílusában): a kérdés (a felhasználó útközben, telefonról is követni akarja a Telegram-kéréseket), a döntés (a felület a daemon image-ben, a peter-mba-n, Authelia kétfaktoros belépés mögött, csak olvasható mountokkal; a 0011 `127.0.0.1` pontja a konténeres telepítésre nem érvényes, a helyi indításra igen), és mi döntötte el (egy image, közös verzió, a hitelesítés az app előtt).
- **ADR 0011:** a `127.0.0.1` pont mellé hivatkozás a 0013-ra; a 0011 egyébként érvényes marad.
- **`docs/architecture.md`:** a 491. sor körüli felület-leírás és a 13. fejezet „Publikus kitettség…” sora hivatkozzon a 0013-ra.
- **Üzemeltetési leírás** (`docs/usage.md` vagy `docs/operations/`): hogyan indul a web a konténerben (`node /app/web/server/index.mjs`, `REFINERY_CONFIG`, `NITRO_HOST`, `NITRO_PORT`, csak olvasható mountok), és a PID-korlát: a `docker exec … refinery run` futás a felületen „meghalt”-nak látszik, miközben fut.
- **Issue** a PID-korlát javítására (a kód-PR-rel együtt nyílik).

## Elfogadási feltételek

Mindegyik megfigyelhető viselkedés, a kiadás előtt a Macen, a frissen épített image-dzsel.

1. **A `serve` működik a karcsúsított image-ben.** `docker run` a valódi konfiggal elindítja a `refinery serve`-et, és a `/ping` meg a `/version` válaszol; a `/version` az új verziót adja.
2. **Nincs hiányzó modul futás közben.** A `src/` nem-teszt kódjában nincs dinamikus import (ellenőrizve, 2026-11-02), tehát a kockázat a statikus csomag-importokban van: a `dist/` minden csupasz (nem relatív, nem `node:`) importja feloldódik az image-ben (pl. a `dist/` fájljait importáló `node -e` próba a konténerben), és egy valódi `refinery run` egy rövid tételen végigmegy az image-ben. Ez valódi pénzt költ, ezért a legolcsóbb receptet és a legrövidebb tételt kell választani; a becslést a futás előtt kell közölni.
3. **A web elindul ugyanabból az image-ből.** `docker run --rm -e REFINERY_CONFIG=… -e NITRO_HOST=0.0.0.0 -e NITRO_PORT=4310` a `node /app/web/server/index.mjs` paranccsal; a konfig, a `/data` és a vault **csak olvasható** mounttal. Az állapottár **élő íróval** legyen: ugyanazt a `/data` mappát egy közben futó `refinery serve` konténer írhatóan csatolja, és a próba alatt legalább egy futás ír bele (a statikus másolat nem bizonyít, mert éles üzemben az író tartja a `-shm` fájlt):
   - `GET /` → 200, az áttekintő betölt;
   - `GET /api/overview` → 200, nem állapottár-hiba (ez zárja le a WAL + `:ro` kérdést; ha elbukik, a `/data/state` mappa írható mounttal ismételendő, a többi marad `:ro`, és az eredmény a homelab-tervbe kerül);
   - `GET /api/runs` → a mountolt naplómappa futásai, nem üres lista;
   - `GET /api/runs/<id>/events` → `Content-Type: text/event-stream`, és a napló sorai érkeznek.
4. **Kisebb az image.** A `docker images` mérete a mostani 888 MB-hoz képest; a várt érték kb. 500 MB (becslés). A mért számot a PR leírása rögzíti. Ha 700 MB fölött marad, a terv megáll és jelez.
5. **A verzió együtt mozog.** Egy `bumpp` próbafuttatás (dry run vagy eldobott ág) után a gyökér és a `web/package.json` verziója azonos.
6. **SIGTERM futás közben lezárja a futást.** Teszt: a SIGTERM-jel ugyanazt a lezárást váltja ki, mint a SIGINT (a meglévő SIGINT-tesztek mintájára). Kézi próba: futó `serve` konténerben egy futás közben `docker stop` → a napló utolsó sora `run:ended` `interrupted: true`-val, a konténer a türelmi időn belül, SIGKILL nélkül áll le (`docker inspect` exit code ≠ 137), és a web „megszakítva”-t mutat. Tétlen `serve`-nél a `docker stop` 1–2 mp alatt végez.
7. **A helyi indítás nem változott.** `pnpm web` továbbra is `127.0.0.1:4310`-en figyel.
8. A meglévő tesztek, a lint és a typecheck zöldek.

## Kimarad

- Külön web image, külön web verzió (elvetve, lásd a döntéseket).
- Multi-arch build és image-publikálás a CI-ból.
- Alpine vagy distroless alap.
- A PID-ellenőrzés konténerfüggetlenné tétele.
- Telefonos elrendezés.
- A homelab-oldal (compose, Traefik, Authelia, Cloudflare): a homelab repó `docs/refinery-web-plan.md` tervében.

## Ami a tervre marad

- A csak futási függőségek előállításának módja (`pnpm deploy --prod` vagy más), és a `dist/` átvitele.
- A `bumpp` beállításának módja.
- Az ADR 0013 pontos szövege és fájlneve.
- Melyik tétel és recept az elfogadás 2. pontjának valódi futása.
