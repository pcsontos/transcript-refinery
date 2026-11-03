# Futás-életjel — implementációs terv (#351)

> **Végrehajtóknak:** ennél a felhasználónál a terv **natívan**, skill és alügynök nélkül fut a munkamenetben (Read/Edit/Bash), Sonneten. A záró, teljes ágra szóló review Opuson. A lépések `- [ ]` jelölésűek.

**Cél:** a „fut” / „meghalt” döntés a futásnapló módosítási idejéből jöjjön, ne a `run:started.pid`-ből.

**Felépítés:** az író (`openRunLog`) 30 mp-enként frissíti a napló fájlidejét. Az olvasó (`isWriterAlive`) a fájlidőt a mostani időhöz méri: legfeljebb 90 mp → él. Az eddigi `isAlive(pid)` beinjektálási pont megmarad, csak a típusa változik `(logPath) => Promise<boolean>`-ra, így a hívók szerkezete nem változik.

**Technológia:** TypeScript, Node `node:fs` (`futimesSync`, `stat`), vitest (fake timers).

**Spec:** [2026-11-03-futas-eletjel-spec.md](2026-11-03-futas-eletjel-spec.md)

## Globális megkötések

- Életjel-időköz: **30 mp** (`HEARTBEAT_MS = 30_000`); küszöb: **90 mp** (`STALE_MS = 90_000`). Rögzített konstans, konfiguráció nincs.
- Él, ha `now - mtimeMs <= STALE_MS` (a spec: „legfeljebb 90 mp-cel régebbi”).
- Az életjel nem ír sort a naplóba; csak a fájlidő változik.
- A web csak olvas (`stat`), sosem ír.
- A `run:started.pid` mező marad az eseményben; az `isPidAlive` megszűnik (kód, export, tesztek).
- Kliensoldali (Nuxt) változás nincs.
- Minden feladat után: `pnpm typecheck && pnpm lint && pnpm test` zöld; a 3. feladat után `pnpm web:typecheck` is.
- Commit üzenet a `commit-message` skill-lel; ág: a felhasználó adja.

## Review-fókusz

1. **Eltűnt naplófájl futás közben** → az író nem dob (a frissítés hibája elnyelve), az olvasó „meghalt”-ot ad, nem dob. Tesztek: 1. és 2. feladat.
2. **Jövőbeli fájlidő** (órakülönbség, kézi `touch`) → negatív kor, „fut”. Teszt: 2. feladat.
3. **`close()` utáni időzítő** → a lezárt fájlleírón a `futimesSync` `EBADF`-et dobna: a `close()` előbb állítja le az időzítőt, csak utána zár. Teszt: 1. feladat (a `close()` után az idő nem mozdul, és nincs dobás).
4. **A `refinery run` kilépése** → az időzítő `unref()`-elt, nem tartja életben a folyamatot. Nem tesztelhető olcsón; a review nézze meg, hogy a `unref()` ott van, és a `cli.ts:1046` `log.close()` minden ágon lefut.
5. **Lezárt, de régi fájlidejű napló** → a `run:ended` dönt, a fájlidő nem számít (a mai lezárt állapotok). Teszt: 2. feladat.

---

### 1. feladat: Életjel az íróban

**Fájlok:**
- Módosít: `src/run/status.ts` (két konstans)
- Módosít: `src/run/log.ts`
- Teszt: `src/run/log.test.ts`

**Interfészek:**
- Termel: `export const HEARTBEAT_MS = 30_000` és `export const STALE_MS = 90_000` a `src/run/status.ts`-ben (a konstansok egy helyen, a `STALE_MS` mellé egysoros megjegyzés: a küszöb 3× az időköz). A `openRunLog(path: string): RunLog` aláírása változatlan.

- [ ] **1. lépés: a bukó teszt** (`src/run/log.test.ts`, új `describe`)

```ts
describe('openRunLog — életjel', () => {
  afterEach(() => vi.useRealTimers())

  it('esemény nélkül is előre viszi a fájlidőt, close() után nem', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-03T10:00:00Z') })
    const log = openRunLog(join(work, 'eletjel.jsonl'))
    const old = new Date('2026-11-03T09:00:00Z')
    utimesSync(log.path, old, old)

    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(statSync(log.path).mtimeMs).toBeGreaterThan(old.getTime())

    log.close()
    utimesSync(log.path, old, old)
    vi.advanceTimersByTime(HEARTBEAT_MS * 2)
    expect(statSync(log.path).mtimeMs).toBe(old.getTime())
  })

  it('az eltűnt fájl nem dob', () => {
    vi.useFakeTimers()
    const log = openRunLog(join(work, 'eltunik.jsonl'))
    rmSync(log.path)
    expect(() => vi.advanceTimersByTime(HEARTBEAT_MS)).not.toThrow()
    log.close()
  })
})
```

(Importok: `vi` a vitestből; `statSync`, `utimesSync`, `rmSync` a `node:fs`-ből; `HEARTBEAT_MS` a `./status.js`-ből.)

- [ ] **2. lépés: futtasd, bukjon**

Futtasd: `pnpm vitest run src/run/log.test.ts`
Várt: az első teszt FAIL (a fájlidő nem mozdul), vagy import-hiba a `HEARTBEAT_MS`-re.

- [ ] **3. lépés: az író**

`openRunLog`: `setInterval(() => { try { futimesSync(fd, new Date(), new Date()) } catch {} }, HEARTBEAT_MS).unref()`; a `close()` a `closed = true` után előbb `clearInterval`, utána `closeSync`. A JSDoc kapjon egy mondatot: a felület a fájlidőből látja, él-e az író (`isWriterAlive`). (Megjegyzés: az eltűnt fájl esetén a nyitott leírón a `futimesSync` POSIX-on általában nem dob; a `try` ettől függetlenül kell.)

- [ ] **4. lépés: futtasd, menjen át**

Futtasd: `pnpm vitest run src/run/log.test.ts` → PASS. Utána `pnpm typecheck && pnpm lint && pnpm test` → zöld.

- [ ] **5. lépés: mutációs ellenőrzés**

Ideiglenesen töröld a `clearInterval` hívást → az első teszt FAIL-jen. Állítsd vissza.

- [ ] **6. lépés: commit** — `src/run/status.ts`, `src/run/log.ts`, `src/run/log.test.ts`.

---

### 2. feladat: Állapot a fájlidőből

**Fájlok:**
- Módosít: `src/run/status.ts`, `src/view/runs.ts`, `src/view/overview.ts:176`, `src/view/reports.ts:303`, `src/index.ts:56`
- Teszt: `src/run/status.test.ts`, `src/view/runs.test.ts`, `src/view/overview.test.ts`, `src/view/reports.test.ts`

**Interfészek:**
- Fogyaszt: `STALE_MS` (1. feladat).
- Termel (a `src/run/status.ts`-ben):
  - `export type WriterAlive = (logPath: string) => Promise<boolean>`
  - `export async function isWriterAlive(logPath: string, now: number = Date.now()): Promise<boolean>` — `stat(logPath)`, `now - mtimeMs <= STALE_MS`; bármilyen `stat`-hiba → `false`.
  - `RunStatusContext`: az `isAlive: (pid: number) => boolean` mező helyére `writerAlive: boolean` kerül. A `runStatus` szerkezete változatlan, csak `ctx.writerAlive ? 'running' : 'died'`.
- A `loadRun(files, isAlive: WriterAlive)`, `readRuns(cfg, isAlive: WriterAlive = isWriterAlive)`, `readRun(cfg, runId, isAlive: WriterAlive = isWriterAlive)`, `readOverview(cfg, isAlive: WriterAlive = isWriterAlive)`, `readReports(cfg, isAlive: WriterAlive = isWriterAlive)`. A `loadRun` `writerAlive: await isAlive(files.logPath)`-ot ad a `runStatus`-nak.
- `src/index.ts`: `isPidAlive` helyett `isWriterAlive` és `type WriterAlive` export.

- [ ] **1. lépés: a bukó tesztek** (`src/run/status.test.ts`)

A `alive`/`dead` konstansok: `{ writerAlive: true, hasReport: false }` / `{ writerAlive: false, … }`; a régi naplós tesztekben `isAlive: () => true` → `writerAlive: true`. A „pid-jével kérdezi” teszt és a `describe('isPidAlive')` törlődik. Új:

```ts
describe('isWriterAlive', () => {
  const now = Date.parse('2026-11-03T10:00:00Z')
  let file: string
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'refinery-status-')), 'run.jsonl')
    await writeFile(file, '')
  })
  const touch = (msAgo: number) => utimesSync(file, new Date(now - msAgo), new Date(now - msAgo))

  it('89 mp-es fájlidővel él', async () => {
    touch(89_000)
    expect(await isWriterAlive(file, now)).toBe(true)
  })
  it('pontosan 90 mp-esnél még él', async () => {
    touch(STALE_MS)
    expect(await isWriterAlive(file, now)).toBe(true)
  })
  it('91 mp-es fájlidővel halott', async () => {
    touch(91_000)
    expect(await isWriterAlive(file, now)).toBe(false)
  })
  it('jövőbeli fájlidővel él', async () => {
    touch(-60_000)
    expect(await isWriterAlive(file, now)).toBe(true)
  })
  it('hiányzó fájlra halott, nem dob', async () => {
    expect(await isWriterAlive(join(tmpdir(), 'nincs-ilyen-refinery.jsonl'), now)).toBe(false)
  })
})
```

A lezárt naplós meglévő tesztek (`interrupted`, `capped`, `done`, `failed`) `dead` kontextussal is a mai értéket adják; ez fedi a review-fókusz 5. pontját.

- [ ] **2. lépés: futtasd, bukjon** — `pnpm vitest run src/run/status.test.ts` → FAIL (`isWriterAlive` nincs exportálva).

- [ ] **3. lépés: `status.ts`** — a fenti interfészek; az `isPidAlive` és a „újrahasznosított pid” megjegyzés törlődik. Helyette az `isWriterAlive` JSDoc-ja: az író 30 mp-enként frissíti a fájlidőt (`openRunLog`); ismert korlát: 90 mp-nél hosszabban blokkolt eseményhurok átmenetileg „meghalt”-ot ad, a futás oldala ilyenkor csak újratöltés után követ újra.

- [ ] **4. lépés: a nézetek** — `runs.ts`, `overview.ts`, `reports.ts`, `index.ts` az Interfészek szerint.

- [ ] **5. lépés: a nézet-tesztek hamis függvényei**
  - `runs.test.ts:110`: `(pid) => pid === 22` → `async (p) => p.endsWith('2026-09-11T09-00-00.jsonl')`
  - `runs.test.ts:126`: `() => false` → `async () => false`
  - `overview.test.ts:246`: `(pid) => pid === 4242` → `async () => true`
  - `reports.test.ts:463`: `() => false` → `async () => false`
  - Az alapértelmezett `isAlive`-val hívott tesztek (pl. `readOverview(cfg)`, `readReports(cfg)`): a frissen írt, `run:ended` nélküli napló most „fut”-nak látszik (eddig a nem létező PID miatt „meghalt”). Ha egy ilyen elvárás bukik, a teszt kapjon explicit `async () => false`-t, ne az elvárás változzon.

- [ ] **6. lépés: futtasd** — `pnpm typecheck && pnpm lint && pnpm test` → zöld.

- [ ] **7. lépés: mutációs ellenőrzés** — `<=` → `<` a küszöbben: a „pontosan 90 mp” teszt FAIL-jen; a `stat`-hiba ágát `return true`-ra írva a „hiányzó fájl” teszt FAIL-jen. Állítsd vissza.

- [ ] **8. lépés: commit** — a fenti fájlok.

---

### 3. feladat: Élő követés, web és dokumentáció

**Fájlok:**
- Módosít: `src/run/follow.ts`, `web/server/api/runs/[runId]/events.get.ts`, `docs/decisions/0013-webes-felulet-a-peter-mba-n.md:51-56`, `docs/usage.md:328-329`
- Teszt: `src/run/follow.test.ts`

**Interfészek:**
- Fogyaszt: `WriterAlive`, `isWriterAlive` (2. feladat).
- `FollowOptions.isAlive: WriterAlive` (eddig `(pid: number) => boolean`). A `followRunLog` `await opts.isAlive(path)`-szal kérdez, ugyanott, ahol ma (`follow.ts:70`, a várakozás előtt).
- A `startedPid` helyett `hasStarted(lines): boolean`; a kilépési feltétel: `!hasStarted(lines) || hasEnded(lines)`.
- `events.get.ts`: `isAlive: isWriterAlive` (import a `transcript-refinery`-ből, az `isPidAlive` helyett).

- [ ] **1. lépés: a tesztek** (`src/run/follow.test.ts`)
  - A `types` segéd alapértéke: `isAlive: async () => true`; a „leállt folyamat” teszt: `isAlive: async () => false` (a várt kimenet változatlan: `['run:started', 'scan:found']`).
  - Új teszt: a követés a napló útját kérdezi.

```ts
it('az író élését a napló útjával kérdezi', async () => {
  await writeFile(path, line(started))
  const asked: string[] = []
  await types({
    isAlive: async (p) => {
      asked.push(p)
      return false
    },
  })
  expect(asked).toEqual([path])
})
```

- [ ] **2. lépés: futtasd, bukjon** — `pnpm vitest run src/run/follow.test.ts` → az új teszt FAIL (`[77]`-et kap, vagy typecheck-hiba).

- [ ] **3. lépés: `follow.ts`** — az Interfészek szerint; a JSDoc „ha a folyamat már nem él” mondata: „ha az író életjele elhalt (`isWriterAlive`)”.

- [ ] **4. lépés: `events.get.ts`** — `isAlive: isWriterAlive`.

- [ ] **5. lépés: dokumentáció**
  - ADR 0013: az „Ismert korlát” és a „Fordított hiba” pontja egy pontba olvad: a futás élését a napló fájlideje adja (30 mp életjel, 90 mp küszöb), így a `docker exec` futás és az újraindult `serve` is helyesen látszik; megoldva a #351-ben, hivatkozás a spec-re.
  - `docs/usage.md:328-329`: a „Korlát: … (PID ≠ 1) „meghalt"-nak látszik” mondat helyére: egy elhalt futás legfeljebb ~2 perc múlva, oldal-újratöltés után látszik „meghalt”-nak.

- [ ] **6. lépés: futtasd** — `pnpm typecheck && pnpm lint && pnpm test && pnpm web:typecheck` → zöld; `grep -rn isPidAlive src web --include='*.ts' --exclude-dir=node_modules` → nincs találat.

- [ ] **7. lépés: mutációs ellenőrzés** — a `followRunLog`-ban az `if (!alive) return`-t töröld → a „leállt folyamat” teszt ne érjen véget a várt két sorral (FAIL vagy időtúllépés). Állítsd vissza.

- [ ] **8. lépés: commit** — a fenti fájlok.

---

## Az ágon kívül marad

- Az élő próba a peter-mba-n (spec, Elfogadás 4.): a homelab web-telepítés része, nem a kód-PR feltétele.
- Kiadás: a kód-PR merge után a szokásos verzióemelés és changelog.
