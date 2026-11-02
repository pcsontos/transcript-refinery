# A webes felület a daemon image-ben — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `web/` felület ugyanabban, karcsúsított image-ben kerüljön ki, mint a `refinery serve`, közös verzióval, és a SIGTERM a futó futást lezárja (#349).

**Architecture:** A meglévő, minden hívó által használt `installSigint` SIGTERM-re is figyel (egy helyen javít: `run`, `fetch`, `watch`); a tétlen `serve` saját SIGTERM-kezelővel lép ki. A `Dockerfile` build stage-e a `pnpm deploy --prod` kimenetéből és a `web/.output`-ból állítja össze a futó image-et. A `bumpp` a két `package.json`-t együtt emeli.

**Tech Stack:** TypeScript, Node 26.2, pnpm 12.6 workspace, Nuxt 4 / Nitro, Docker, vitest, bumpp.

**Spec:** `docs/plans/2026-11-02-refinery-web-image-spec.md`

## Global Constraints

- Ponytail: a legrövidebb működő diff. Új fájl csak az ADR 0013. Új függőség nincs.
- Egy image: `ghcr.io/pcsontos/transcript-refinery`; a `CMD` marad `["refinery", "serve"]`; a web helye `/app/web`, indítása `node /app/web/server/index.mjs`.
- Az image nem állít `NITRO_HOST`-ot; a `web/package.json` `start` szkriptje marad `NITRO_HOST=127.0.0.1`.
- Node `26.2`, apt réteg és yt-dlp változatlan; nincs Alpine, nincs multi-arch, nincs CI-publikálás.
- A `web/package.json` `version` mindig a gyökérrel azonos (most `1.27.0`).
- SIGTERM futás közben: ugyanaz az út, mint a SIGINT (`run:ended` `interrupted: true`, riport, `exit(130)`). Tétlen `serve`: `exit(143)`.
- Az image-méret felső határa: 700 MB (fölötte a terv megáll és jelez); várt ~500 MB.
- Valódi pénzt költő futás csak a felhasználó jóváhagyásával, előtte közölt becsléssel (a 3. feladat 6. lépése).
- Minden feladat után: `pnpm typecheck`, `pnpm lint`, `pnpm test` zöld.
- Commit-üzenet a `commit-message` skill-lel, `Refs #349`.

## Review Focus

1. **SIGTERM a normál befejezés közben** (a futás már a `finish(false)`-ban jár): a `finish` egyszeri (`finishPromise`, `src/cli.ts:719`), a második hívó ugyanarra vár — nem írhat dupla `run:ended`-et. → a meglévő SIGINT-tesztek lefedik, mert ugyanaz a kezelő; az 1. feladat tesztje igazolja, hogy SIGINT után a SIGTERM már nem hív újra.
2. **SIGTERM a `refinery fetch` és a `refinery watch` alatt:** mostantól ugyanúgy szabályosan áll le, mint Ctrl+C-re. → a meglévő `fetch`/`watch` tesztek zöldek maradnak (1. feladat 4. lépése).
3. **Foglalt `serve`, de még nincs futás** (felirat-letöltés, `notes`-foglalás): a SIGTERM-et senki nem kezeli, a Docker a türelmi idő után SIGKILL-t küld. Elfogadott korlát, `ponytail:` megjegyzéssel. → a 2. teszt (`foglalt kapunál nem lép ki`) rögzíti.
4. **A bundle-olt web a `/app/web` alól indul:** a `transcript-refinery` a web chunkjaiba van csomagolva; ha bármi a repó-elrendezéshez kötött relatív utat olvas, a web induláskor elszáll. → a 3. feladat 5. lépése (`GET /` → 200).
5. **WAL + csak olvasható mount élő író mellett:** ha a `/api/overview` hibát ad, a `/data/state` írható mounttal ismétlendő (felhasználói döntés). → a 3. feladat 7. lépése.

---

### Task 1: SIGTERM lezárja a futást, a tétlen `serve` kilép

**Files:**
- Modify: `src/run/finish.ts:24-46` (`installSigint`)
- Modify: `src/serve/command.ts` (új `installIdleExit`, hívása a `gate` létrehozása után, `:183` körül)
- Test: `src/run/finish.test.ts`, `src/serve/command.test.ts`

**Interfaces:**
- Produces: `installSigint(handler, target?)` — változatlan szignatúra, most SIGINT-re és SIGTERM-re is egyszer fut; a leiratkozás mindkettőt leveszi.
- Produces: `installIdleExit(gate: ServeGate, target?: { on(event: string, listener: () => void): unknown }, exit?: (code: number) => void): void` a `src/serve/command.ts`-ben.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/run/finish.test.ts`, a `describe('installSigint')` blokkba:

```ts
  it('a SIGTERM-re is futtatja a kezelőt', () => {
    const target = new EventEmitter()
    let calls = 0
    installSigint(() => void calls++, target)

    target.emit('SIGTERM')
    expect(calls).toBe(1)
  })

  it('a SIGINT és a SIGTERM együtt is csak egyszer futtat', () => {
    const target = new EventEmitter()
    let calls = 0
    installSigint(() => void calls++, target)

    target.emit('SIGTERM')
    target.emit('SIGINT')
    target.emit('SIGTERM')
    expect(calls).toBe(1)
  })

  it('a leiratkozás a SIGTERM-kezelőt is eltávolítja', () => {
    const target = new EventEmitter()
    let calls = 0
    const uninstall = installSigint(() => void calls++, target)

    uninstall()
    target.emit('SIGTERM')

    expect(calls).toBe(0)
  })
```

`src/serve/command.test.ts` végére (importok: `EventEmitter` a `node:events`-ből, `installIdleExit` a `./command.js`-ből):

```ts
describe('installIdleExit', () => {
  it('tétlen kapunál SIGTERM-re 143-mal kilép', () => {
    const target = new EventEmitter()
    const codes: number[] = []
    installIdleExit({ current: null }, target, (code) => void codes.push(code))

    target.emit('SIGTERM')

    expect(codes).toEqual([143])
  })

  it('foglalt kapunál nem lép ki: a futás saját kezelője zár le', () => {
    const target = new EventEmitter()
    const codes: number[] = []
    installIdleExit({ current: 'job-1' }, target, (code) => void codes.push(code))

    target.emit('SIGTERM')

    expect(codes).toEqual([])
  })
})
```

- [ ] **Step 2: Futtasd, bukjanak**

Run: `pnpm exec vitest run src/run/finish.test.ts src/serve/command.test.ts`
Expected: FAIL — `a SIGTERM-re is futtatja a kezelőt` (`expected 0 to be 1`) és a két `installIdleExit`-teszt (`installIdleExit is not a function`). A másik két új `installSigint`-teszt már most zöld: regressziós őr az egyszeriségre és a leiratkozásra.

- [ ] **Step 3: Implementáld**

`src/run/finish.ts`: az `installSigint` a listenert a `'SIGINT'` és a `'SIGTERM'` jelre is felteszi, a visszaadott függvény mindkettőről leveszi. A név marad (három hívó, `cli.ts`, `fetch/command.ts`, `watch/command.ts`); a doc-komment első mondata: „A Ctrl+C és a SIGTERM (`docker stop`) is riportot hagy maga után.” A `fired` őr közös: két különböző jel együtt is egyszer futtat.

`src/serve/command.ts`:

```ts
/**
 * A tétlen serve SIGTERM-re azonnal kilép. PID 1-ként a Node kezelő nélkül
 * nem állna le, és a Docker a türelmi idő után SIGKILL-t küldene. Futás
 * közben a `commandRun` saját kezelője zárja le a futást és lép ki.
 */
// ponytail: foglalt kapu futás nélkül (felirat-letöltés, notes) → SIGKILL a türelmi idő után; abort, ha zavar.
export function installIdleExit(
  gate: ServeGate,
  target: { on(event: string, listener: () => void): unknown } = process,
  exit: (code: number) => void = process.exit,
): void {
  target.on('SIGTERM', () => {
    if (gate.current === null) exit(143)
  })
}
```

A `commandServe`-ben a `const gate: ServeGate = { current: null }` sor után: `installIdleExit(gate)`.

- [ ] **Step 4: Futtasd a teljes ellenőrzést**

Run: `pnpm exec vitest run src/run/finish.test.ts src/serve/command.test.ts && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS mind; a `fetch`/`watch`/`cli` meglévő SIGINT-tesztjei is zöldek.

- [ ] **Step 5: Commit** (`commit-message` skill; pl. `fix(run): Close the run on SIGTERM too`, `Refs #349`)

---

### Task 2: Közös verzió a webnek

**Files:**
- Modify: `web/package.json` (új `"version": "1.27.0"` a `"name"` után)
- Modify: `bump.config.ts` (új `files: ['package.json', 'web/package.json']`)

- [ ] **Step 1: Írd be a két változást** a fenti értékekkel.

- [ ] **Step 2: Ellenőrizd, hogy a bumpp mindkettőt emeli**

Run: `pnpm exec bumpp patch --no-commit --no-tag --no-push -y && node -p "require('./package.json').version + ' ' + require('./web/package.json').version"`
Expected: `1.27.1 1.27.1`

- [ ] **Step 3: Állítsd vissza a próbát**

Run: `git checkout package.json web/package.json && git diff --stat`
Expected: csak a `web/package.json` (`version` sor) és a `bump.config.ts` változása látszik a 1. lépésből. (Ha a bumpp más fájlt is írt, azt is vissza kell állítani.)

- [ ] **Step 4: `pnpm install --frozen-lockfile && pnpm test`** — Expected: a lockfile nem változik, a tesztek zöldek.

- [ ] **Step 5: Commit** (pl. `chore(release): Bump web/package.json with the root version`, `Refs #349`)

---

### Task 3: Karcsúsított image, benne a web

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Produces: az image-ben `/app/dist`, `/app/node_modules` (csak futási függőségek), `/app/package.json`, `/app/web/server/index.mjs`. A homelab compose ezekre hivatkozik.

- [ ] **Step 1: Írd át a `Dockerfile`-t**

A build stage `RUN` sora:

```dockerfile
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter transcript-refinery-web build \
 && pnpm --filter transcript-refinery deploy --prod /prod
```

A futó stage három `COPY` sora helyett:

```dockerfile
COPY --from=build /prod/package.json /app/package.json
COPY --from=build /prod/dist /app/dist
COPY --from=build /prod/node_modules /app/node_modules
COPY --from=build /src/web/.output /app/web
```

Minden más (apt, yt-dlp, `chmod` + `ln -s`, `CMD`) marad. Ha a `deploy` a `dist/`-et nem viszi (a `.gitignore` miatt), a `dist` sor forrása `/src/dist` legyen.

- [ ] **Step 2: Építsd meg próbataggel** (nem a kiadott taggel, hogy a helyi `1.27.0` ne íródjon felül)

Run: `docker build -t refinery-slim-test . && docker images refinery-slim-test --format '{{.Size}}'`
Expected: sikeres build; méret ≤ 700 MB (várt ~500 MB). A számot jegyezd fel a PR-hez. 700 MB fölött: állj meg, jelezz.

- [ ] **Step 3: A CLI modulgráfja betölt**

Run: `docker run --rm refinery-slim-test refinery help >/dev/null && echo OK`
Expected: `OK`. (Az ESM a teljes statikus importgráfot futás előtt feloldja; a `src/`-ben nincs dinamikus import.)

- [ ] **Step 4: A `serve` elindul, válaszol, és SIGTERM-re gyorsan kilép**

```bash
docker run -d --name rs-test -p 8787:8787 -e SERVE_HOST=0.0.0.0 \
  -e REFINERY_SERVE_SECRET=x -e WORKER_CALLBACK_URL=http://127.0.0.1:9 -e SERVE_OUT=/tmp/t \
  refinery-slim-test
sleep 2; curl -s localhost:8787/ping; curl -s localhost:8787/version
time docker stop rs-test; docker inspect rs-test --format '{{.State.ExitCode}}'; docker rm rs-test
```

Expected: `ok`, `{"version":"1.27.0"}`; a `docker stop` 1–2 mp alatt végez; exit code `143`.

- [ ] **Step 5: Tesztkörnyezet a web- és futáspróbához** (a `tmp/` git-ignorált)

- `tmp/docker-test/config/config.yaml`: `vault.path: /vault`, `state.path: /data/state/refinery.db`, `logs.dir: /data/logs`, `sources: [/in]`, `languages: [hu, en]`; a `model` és a `pricing` blokk a helyi `refinery.config.yaml`-ből, a `base_url`-ben a `localhost` helyett `host.docker.internal`.
- `tmp/docker-test/vault/` üres mappa, `tmp/docker-test/data/` üres mappa, `tmp/docker-test/in/rovid.txt`: egy kb. 500 szavas magyar szöveg.
- A web indítása (mind `:ro`):

```bash
docker run -d --name rw-test -p 4310:4310 \
  -e REFINERY_CONFIG=/app/config/config.yaml -e NITRO_HOST=0.0.0.0 -e NITRO_PORT=4310 \
  -v "$PWD/tmp/docker-test/config:/app/config:ro" -v "$PWD/tmp/docker-test/vault:/vault:ro" \
  -v "$PWD/tmp/docker-test/data:/data:ro" \
  refinery-slim-test node /app/web/server/index.mjs
sleep 3; curl -s -o /dev/null -w '%{http_code}\n' localhost:4310/
```

Expected: `200` (Review Focus 4). Az állapottár ekkor még nincs: ez nem hiba (`openStateReader` → `null`).

- [ ] **Step 6: Kérd a felhasználó jóváhagyását a valódi futáshoz**

Közöld: két rövid `summary`-futás (`--no-judge`) a `rovid.txt`-n, a draft modellen; becslés futásonként ~0,02 $, kétszeres ráhagyással összesen **≤ 0,10 $**. Csak „igen” után menj tovább.

- [ ] **Step 7: Élő író + web + SIGTERM futás közben**

Az első futás konténer fő folyamataként (PID 1, ahogy a `serve`):

```bash
docker run -d --name rr-test -e LITELLM_API_KEY \
  -v "$PWD/tmp/docker-test/config:/app/config:ro" -v "$PWD/tmp/docker-test/vault:/vault" \
  -v "$PWD/tmp/docker-test/data:/data" -v "$PWD/tmp/docker-test/in:/in:ro" \
  refinery-slim-test refinery run --config /app/config/config.yaml \
    --file /in/rovid.txt --recipe summary --no-judge --no-commit
```

Amint a `tmp/docker-test/data/logs/*.jsonl`-ben megjelenik az `item:generating` sor:
- `curl -s localhost:4310/api/overview` → 200, nem állapottár-hiba (élő író mellett, `:ro` mounton);
- `curl -s localhost:4310/api/runs` → a futás benne van;
- `curl -sN -m 5 -D - localhost:4310/api/runs/<id>/events | head -20` → `content-type: text/event-stream`, és sorok jönnek;
- `time docker stop rr-test; docker inspect rr-test --format '{{.State.ExitCode}}'`.

A `time` adja a spec C. pontjának mérését a `stop_grace_period`-hoz. A `serve` futásai `commit: false`-szal mennek (`src/serve/summary.ts:180`), ezért a lezárásban nincs git-push; ha a mért idő 10 mp alatt van, a homelab compose-ban nem kell `stop_grace_period`. Az értéket jegyezd fel a PR-be.

Expected: exit code `130` (nem `137`); a `.jsonl` utolsó sora `run:ended` `"interrupted":true`; van `.md` riport; a `/api/runs` a futást „megszakítva” állapotúnak mutatja.

Ha a `/api/overview` állapottár-hibát ad: indítsd újra a webet úgy, hogy a `data/state` külön, írható mount (`-v "$PWD/tmp/docker-test/data/state:/data/state"`), a többi marad `:ro`, és ismételd meg. Az eredményt (melyik változat működött) jegyezd fel a PR-be és a homelab-tervbe.

- [ ] **Step 8: Teljes futás az image-ben**

Ugyanaz a parancs `rr-test2` névvel, stop nélkül. Expected: exit code `0`, a `.jsonl`-ben `run:done` és `run:ended` `"interrupted":false`, a `tmp/docker-test/vault/`-ban megvan a summary jegyzet; a weben a futás „kész”.

- [ ] **Step 9: Takarítás és a helyi indítás ellenőrzése**

Run: `docker rm -f rw-test rr-test rr-test2; docker rmi refinery-slim-test`, majd `pnpm web` → a kiírás `127.0.0.1:4310`-et mutat (Ctrl+C).

- [ ] **Step 10: Commit** (pl. `build(docker): Ship the web app in a slimmer image`, `Refs #349`; a törzsben a mért méret)

---

### Task 4: ADR 0013, dokumentáció, PID-issue

**Files:**
- Create: `docs/decisions/0013-webes-felulet-a-peter-mba-n.md`
- Modify: `docs/decisions/0011-webes-felulet-csak-olvas.md:22`, `docs/architecture.md:490-492` és `:505-506`, `docs/usage.md:310-320` környéke

- [ ] **Step 1: ADR 0013** a 0011/0012 szerkezetében (`# 0013 — …`, `**Dátum:** 2026-11-02 · **Státusz:** elfogadva`, A kérdés / A döntés / Mi döntötte el / Következmények), a spec „Miért” és „döntések” táblája alapján:
  - Kérdés: a Telegram-kérések követése útközben, telefonról is.
  - Döntés: a felület a daemon image-ben, a peter-mba-n, Authelia kétfaktoros belépés mögött, csak olvasható mountokkal; a 0011 „csak a `127.0.0.1`-en” pontja a konténeres telepítésre nem érvényes, a helyi `pnpm web`-re igen; a „csak olvas” változatlan.
  - Mi döntötte el: egy image (a web 9 MB a 888 MB mellett), közös verzió (`assertCurrentSchema` miatt csak együtt működnek), a hitelesítés az app előtt (az app maga nem kap belépést).
  - Következmények: SIGTERM-kezelés; ismert korlát: a `docker exec … refinery run` futás (PID ≠ 1) a felületen „meghalt”-nak látszik (issue-link a 4. lépésből); spec-link.

- [ ] **Step 2: Hivatkozások**
  - 0011, 22. sor végére: ` A konténeres telepítésre lásd: [0013](0013-webes-felulet-a-peter-mba-n.md).`
  - `architecture.md` 490–492: a mondat végére `A peter-mba-n konténerben, Authelia mögött is fut (ADR 0013).`; az 505. sori „Publikus kitettség…” pont végére `— kivétel: a webes felület Authelia mögött (ADR 0013).`
  - `docs/usage.md` a web-szakasz végére egy rövid „Konténerben” bekezdés: `node /app/web/server/index.mjs`, kötelező `REFINERY_CONFIG`, `NITRO_HOST=0.0.0.0`, `NITRO_PORT=4310`, csak olvasható mountok (kivétel, ha a 3. feladat 7. lépése szerint a `/data/state` írható kell), és a PID-korlát egy mondatban.

- [ ] **Step 3: A PID-korlát issue-ja** (pcsontos-fiókkal):

```bash
GH_TOKEN=$(gh auth token --user pcsontos) gh issue create \
  --title "A web a más konténerben futó futást PID alapján ítéli meg (docker exec → „meghalt”)" \
  --body "A futás állapotát a web a run:started PID-jéből dönti el (src/run/status.ts, process.kill(pid, 0)), saját PID-terében. A serve PID 1-ként helyesen látszik, a docker exec … refinery run futás (PID ≠ 1) viszont „meghalt”-nak, miközben fut. Lásd ADR 0013, #349."
```

Az issue számát írd be az ADR 0013-ba és a `usage.md`-be.

- [ ] **Step 4: `pnpm lint && pnpm test`** — Expected: zöld.

- [ ] **Step 5: Commit** (pl. `docs(decisions): Add ADR 0013 for the web app on peter-mba`, `Refs #349`)

---

## A terv után (nem feladat)

Kód-PR → merge → kiadás a szokott menetben (`pnpm release`, changelog, tag, `pnpm docker:publish`), majd a homelab-terv (`peteroncode/homelab` `docs/refinery-web-plan.md`) B–D lépései.
