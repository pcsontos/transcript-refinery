# Fázis 5 — A Nuxt-felület — implementációs terv

> **Ágenseknek:** KÖTELEZŐ AL-SKILL: `superpowers:executing-plans` — a projekt
> gyakorlata szerint egyetlen munkamenetben, Sonneten — vagy
> `superpowers:subagent-driven-development` a feladatonkénti végrehajtáshoz. A
> lépések jelölőnégyzetes (`- [ ]`) szintaxist használnak.

**Cél:** Egy csak olvasó, csak a `127.0.0.1`-en figyelő böngészős felület, ahol
látszik, hol tart a korpusz, melyik jegyzet gyenge és miért, és élőben
követhető egy CLI-ből indított futás.

**Architektúra:** A mag (`src/`) csak olvasó réteget kap: közös lekérdezéseket
és írásvédett állapottár-kapcsolatot, a bíró hiánylistájának rögzítését,
időbélyeges és indulás/lezárás-eseményes futásnaplót, a futás állapotát és
követését, valamint nézetmodelleket (áttekintő, elemek, elem, hibák, futások).
A `web/` egy Nuxt 4.5 + Nuxt UI 4.11 workspace-csomag: a szerverútvonalai
egy-egy mag-függvényt hívnak, az élő futás SSE-n érkezik, a kliens csak
megjelenít.

**Tech stack:** a magban TypeScript 5.9, Node 26.2, vitest 4, zod 4; a `web/`-ben
Nuxt 4.5.2, Nuxt UI 4.11.1, h3 1.15, nitropack 2.13, markdown-it 15,
`@nuxt/test-utils` 4.3, `@nuxt/eslint` 1.17, `vue-tsc` 3.3. **A mag új
futásidejű függőséget nem kap.**

**Spec:** `docs/plans/2026-09-11-fazis-5-nuxt-felulet-spec.md` — a terv ebből
érvel; a végrehajtó mindkettőt olvassa.

## Globális megkötések

- Egyetlen teszt sem hív modellt; a hamis modellkliens-minta marad.
- Minden parancs `mise exec --` alatt fut (`mise exec -- pnpm test`).
- Magyar a dokumentáció, a kódkomment, a felület szövege és a commit-üzenet;
  angol a produkciós azonosító.
- Nincs közvetlen munka a `main` ágon. Az ág: `feat/fazis-5-nuxt-felulet`
  (létezik; a spec commitja rajta van és pusholva).
- Korpuszrészlet — cím, csatornanév, azonosító, jegyzetszöveg — nem kerülhet a
  repóba, se tesztbe, se dokumentumba, se képernyőképre. Minden minta
  szintetikus.
- A `web/` nem tartalmaz prompt- vagy csővezeték-logikát, és nem ír: se
  állapottárba, se vaultba, se naplóba, se gitbe. A kliens a magból csak
  típust importál.
- A mag új futásidejű függőséget nem kap; a felület függőségei a
  `web/package.json`-ban vannak.
- A felület címe mindig `127.0.0.1`, az alapport `4310`.
- **Minden feladat végén zöld:** `mise exec -- pnpm test`,
  `mise exec -- pnpm typecheck`, `mise exec -- pnpm lint`. A 11. feladattól
  ezen felül: `mise exec -- pnpm web:typecheck`, `mise exec -- pnpm web:lint`,
  `mise exec -- pnpm web:test`.
- **Commit:** feladatonként egy, a `commit-message` skill-lel, a feladat végén
  javasolt üzenettel és `Refs #28` lábléccel; a 16. feladaté `Closes #28`. Push
  és PR csak a végén, a felhasználó jóváhagyásával.
- **Mutációs ellenőrzés** mindig a commit **után**, így a visszaállítás
  (`git checkout -- <fájl>`) csak a mutációt dobja el.
- **Valódi pénzt költő futás** csak a 16. feladatban, a felhasználó kifejezett
  jóváhagyásával.

## Amibe a kód beleütközik

**A magban:**

- **`noUncheckedIndexedAccess`**: a tömbindexelés és a regex-csoport
  `T | undefined`. A `!` az ESLint-konfigban szándékosan engedélyezett.
- **`recommendedTypeChecked`**: aktív a `require-await` (az `await` nélküli
  `async` függvény hiba — ilyenkor legyen szinkron), a `no-floating-promises`,
  a `no-misused-promises` és az `unbound-method` (állapottár-metódust ne adj át
  hivatkozásként, hívd közvetlenül). Sablon-literálban a számot `String(…)`-be
  csomagold, ahogy a kódbázis.
- **Szűkítés és lezárások:** egy `let x: T | null = null` változót, amit egy
  belső függvény ír át, a TypeScript a külső kódban `null`-nak lát. Ahol egy
  ciklus állapotot gyűjt, közvetlen értékadást vagy tiszta segédfüggvényt
  használj — a terv kódja ezt követi.
- **A `cli.test.ts` modul szinten mockolja a `gitCommitPaths`-t úgy, hogy
  kivételt dobjon.** Az ebben a tervben hozzáadott CLI-tesztek `commit: false`-szal
  futnak, a git-hez nem nyúlnak.
- **A `refinery` bin pnpm alatt nincs önmagára linkelve:** a CLI-t
  `mise exec -- node dist/cli.js …` futtatja, nem `pnpm exec refinery`.

**A `web/`-ben** — ezeket a terv írásakor a repó eldobható klónjában
kipróbáltuk:

- **zsh:** több szavas parancsot ne tegyél változóba (`F="pnpm --filter x"`,
  majd `$F`). A zsh nem bontja szavakra, a `mise` az egészet programnévnek veszi.
- **pnpm 11 — build scriptek:** új build scriptnél az install
  `ERR_PNPM_IGNORED_BUILDS`-szal megáll, és a `pnpm-workspace.yaml` `allowBuilds`
  alá `set this to true or false` helykitöltőt ír. **A helykitöltőt cseréld le,
  ne írj mellé:** a duplikált kulcs után minden pnpm-parancs YAML-hibával bukik.
  A Nuxt-függőségekhez kettő kell, mindkettő `false`: `unrs-resolver`,
  `vue-demi`.
- **pnpm 11 — friss kiadások:** a pnpm magától `minimumReleaseAgeExclude`
  bejegyzést írhat a `pnpm-workspace.yaml`-be (a terv írásakor:
  `markdown-it@15.0.2`). Ez a változtatás része; commitold.
- **`@nuxt/test-utils`:** tesztfájlonként **egyetlen** `setup()`. Egy második
  `describe` saját `setup`-pal az egész fájlt elrontja („No context is
  available"). A más környezetű teszt külön fájlba kerül; a
  `web/vitest.config.ts` `fileParallelism: false`-szal futtatja őket egymás
  után. A szerver környezetét a `setup({ env })` adja. A `setup` lefordítja az
  appot: `setupTimeout: 300_000`.
- **Nitro:** a `node:sqlite` importra figyelmeztet, hacsak a
  `nitro.rollupConfig.external` nem sorolja fel.
- **A `runtimeConfig.refineryRoot` perjellel végződik**
  (`…/transcript-refinery/`). `join`/`resolve`-val kezeld, ne összefűzéssel.
- **Nuxt UI:** a `ui: { fonts: false }` és a helyi `@iconify-json/lucide` nélkül
  a felület fontot és ikont töltene le kívülről.
- **A `useFetch` típusa** a szerverútvonal visszatérési típusából jön — dinamikus
  URL-lel (``() => `/api/items/${id}` ``) és egymásba ágyazott útvonallal is. Az
  oldalak ezért a sortípust a válaszból vezetik le
  (`(typeof rows.value)[number]`), nem a magból importálják.
- **A `web/` ESLintje** (`@nuxt/eslint`) nem típusérzékeny; a gyökér ESLintje a
  `web/`-et kihagyja. A `v-html` elé
  `<!-- eslint-disable-next-line vue/no-v-html -->` kerül, indoklással.
- **Csak olvasó SQLite:** a `new DatabaseSync(path, { readOnly: true })` hiányzó
  fájlra hibát dob, ezért előbb `existsSync`. Író nélkül is megnyílik (a
  `-wal`/`-shm` fájlokat létrehozza), és látja az író későbbi beszúrását.
- **A `createError` üzenete** élesben is eljut a klienshez: az 500-as válasz
  törzsének `message` mezőjében.
- **A kódolt útvonalparaméter** (`getRouterParam(event, 'x', { decode: true })`)
  a `..%2F..%2Fetc`-t `../../etc`-ként adja — ezt kell az őrnek elutasítania.

## Fájlszerkezet

| fájl | felelősség | feladat |
|---|---|---|
| `src/config.ts` | a `loadConfig` `baseDir` paramétere | 1 |
| `src/state/db.ts` | `artifact_gaps` tábla, `gapsOf`, tranzakciós `recordArtifact`; a lekérdezéseket a `queries.ts`-ből hívja | 2, 3 |
| `src/state/queries.ts` | az író és az olvasó közös SQL-je, a sémaellenőrzés | 3 |
| `src/state/reader.ts` | `openStateReader`, `openReadOnlyDatabase` | 3 |
| `src/pipeline.ts` | a hiánylista átadása; generálási és pontozási események | 2, 5 |
| `src/refine/loop.ts` | `onGenerate`, `onScore` visszahívások | 5 |
| `src/run/log.ts` | `at` időbélyeg minden sorban | 4 |
| `src/run/logfile.ts` | `RunLogLine`, `isRunId`, `listRuns`, `readRunEvents`, `parseEventId`, `findRun` | 4, 8 |
| `src/events.ts` | `run:started`, `run:ended` | 6 |
| `src/cli.ts` | a két új esemény kibocsátása | 6 |
| `src/run/status.ts` | `runStatus`, `isPidAlive` | 7 |
| `src/view/live.ts` | `liveRunState` | 7 |
| `src/view/runs.ts` | `summarizeRun`; `loadRun`, `readRuns`, `readRun` | 7, 8 |
| `src/run/follow.ts` | `followRunLog` | 8 |
| `src/view/overview.ts` | az áttekintő nézetmodellje és beolvasása | 9 |
| `src/view/items.ts` | elemlista, elem-részlet, `stripFrontmatter` | 10 |
| `src/view/failures.ts` | hibacsoportok | 10 |
| `src/index.ts` | az új exportok | 3, 4, 7–10 |
| `pnpm-workspace.yaml`, `package.json`, `eslint.config.js`, `.gitignore` | workspace, `exports`, `web:*` scriptek, kizárások | 11 |
| `web/package.json`, `web/nuxt.config.ts`, `web/tsconfig.json`, `web/eslint.config.mjs`, `web/vitest.config.ts` | a felület csomagja és eszközei | 11 |
| `web/server/utils/refinery.ts` | konfiguráció és hibakezelés az útvonalaknak | 11 |
| `web/server/utils/markdown.ts` | Markdown → HTML, nyers HTML nélkül | 12 |
| `web/server/api/**` | vékony API-útvonalak és SSE | 11–13 |
| `web/test/e2e/fixture.ts`, `api.test.ts`, `errors.test.ts` | szintetikus környezet és e2e-tesztek | 11–15 |
| `web/app/**` | elrendezés, oldalak, composable, formázók | 11, 14, 15 |
| `docs/decisions/0011-webes-felulet-csak-olvas.md`, `docs/architecture.md`, `docs/roadmap.md`, `README.md`, `docs/README.md` | dokumentáció | 16 |

---

## Feladat 1: A relatív útvonalak alapmappája

**Fájlok:**
- Módosít: `src/config.ts` (`loadConfig`)
- Teszt: `src/config.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból.
- Termel: `loadConfig(raw: unknown, configPath: string, baseDir?: string): Config`.
  A 11. feladat szerverkódja a repó gyökerét adja át `baseDir`-ként.

- [ ] **1. lépés: Írd meg a bukó tesztet**

Fűzd a `src/config.test.ts` végére (a `MIN` konstans és a `resolve` import már
a fájlban van):

```ts
describe('loadConfig — alapmappa', () => {
  it('a relatív állapot- és naplóútvonalat a megadott alapmappához oldja fel', () => {
    const cfg = loadConfig(
      { ...MIN, state: { path: '.state/refinery.db' }, logs: { dir: 'logs' } },
      '/p/refinery.config.yaml',
      '/repo',
    )
    expect(cfg.statePath).toBe('/repo/.state/refinery.db')
    expect(cfg.logsDir).toBe('/repo/logs')
  })

  it('alapmappa nélkül a munkakönyvtárhoz oldja fel, ahogy eddig', () => {
    const cfg = loadConfig(MIN, '/p/refinery.config.yaml')
    expect(cfg.statePath).toBe(resolve(process.cwd(), '.state', 'refinery.db'))
    expect(cfg.logsDir).toBe(resolve(process.cwd(), 'logs'))
  })

  it('az abszolút útvonalat az alapmappa nem írja át', () => {
    const cfg = loadConfig(
      { ...MIN, state: { path: '/abs/state.db' }, logs: { dir: '/abs/logs' } },
      '/p/refinery.config.yaml',
      '/repo',
    )
    expect(cfg.statePath).toBe('/abs/state.db')
    expect(cfg.logsDir).toBe('/abs/logs')
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/config.test.ts
```

Várt: FAIL, 1 teszt — „a relatív állapot- és naplóútvonalat…": a `statePath`
még a munkakönyvtárhoz oldódik. (A vitest nem típusellenőriz, a harmadik
argumentumot futásidőben figyelmen kívül hagyja.)

- [ ] **3. lépés: Az implementáció**

A `src/config.ts`-ben cseréld le ezt:

```ts
/** YAML → konfiguráció. Fájlrendszertől független, hogy tesztelhető legyen. */
export function loadConfig(raw: unknown, configPath: string): Config {
```

erre:

```ts
/**
 * YAML → konfiguráció. Fájlrendszertől független, hogy tesztelhető legyen.
 *
 * A relatív `state.path` és `logs.dir` a `baseDir`-hez oldódik fel. A CLI nem
 * adja át — nála ez a munkakönyvtár, ahogy eddig —, a webes felület viszont a
 * repó gyökerét adja, mert a szervere más munkakönyvtárból is indulhat.
 */
export function loadConfig(raw: unknown, configPath: string, baseDir = process.cwd()): Config {
```

és ugyanebben a függvényben ezt:

```ts
    statePath: resolve(process.cwd(), c.state.path),
    logsDir: resolve(process.cwd(), c.logs.dir),
```

erre:

```ts
    statePath: resolve(baseDir, c.state.path),
    logsDir: resolve(baseDir, c.logs.dir),
```

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/config.test.ts
```

Várt: PASS, a három új teszttel együtt.

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **6. lépés: Commit**

```bash
git add src/config.ts src/config.test.ts
```

Javasolt üzenet: `feat(config): a relatív útvonalak alapmappája megadható`, `Refs #28`.

---

## Feladat 2: A bíró hiánylistája az állapottárban

**Fájlok:**
- Módosít: `src/state/db.ts`, `src/pipeline.ts`
- Teszt: `src/state/db.test.ts`, `src/pipeline.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból.
- Termel:
  - tábla: `artifact_gaps (item_id, kind, gaps)` — műtermékenként egy sor, a
    `gaps` JSON-tömb. A sor megléte = rögzítve; `[]` = a bíró nem nevezett meg
    hiányt.
  - `ArtifactMetrics.gaps?: string[]`
  - `StateStore.gapsOf(itemId: string, kind: string): string[] | null`
  - A 3. feladat közös lekérdezése (`selectGaps`) ugyanezt a táblát olvassa.

- [ ] **1. lépés: Írd meg a bukó teszteket**

Fűzd a `src/state/db.test.ts` végére (az `item`, a `store`, a `DatabaseSync`,
a `mkdtemp`, a `tmpdir` és a `join` már a fájlban van):

```ts
describe('StateStore — hiánylista', () => {
  const metrics = { iterations: 1, score: 0.6, costUsd: 0.01, model: 'szintetikus-modell' }

  it('a metrikákkal együtt rögzíti, és visszaadja', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a_summary.md', null, {
      ...metrics,
      gaps: ['kimaradt: a zárás'],
    })
    expect(store.gapsOf('a1b2c3', 'summary')).toEqual(['kimaradt: a zárás'])
  })

  it('az üres lista rögzített, és különbözik a nem rögzítettől', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, { ...metrics, gaps: [] })
    store.recordArtifact('a1b2c3', 'qa', 'done', '/v/b.md', null, metrics)
    expect(store.gapsOf('a1b2c3', 'summary')).toEqual([])
    expect(store.gapsOf('a1b2c3', 'qa')).toBeNull()
  })

  it('újrarögzítéskor lecseréli a régit', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, {
      ...metrics,
      gaps: ['régi hiány'],
    })
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, {
      ...metrics,
      gaps: ['új hiány'],
    })
    expect(store.gapsOf('a1b2c3', 'summary')).toEqual(['új hiány'])
  })

  it('hibás rögzítésnél törli', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a.md', null, {
      ...metrics,
      gaps: ['hiány'],
    })
    store.recordArtifact('a1b2c3', 'summary', 'failed', null, 'szintetikus hiba')
    expect(store.gapsOf('a1b2c3', 'summary')).toBeNull()
  })

  it('a hiánylista-tábla nélküli állapotfájl megnyitás után megkapja a táblát', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-regi-'))
    const path = join(dir, 'state.db')
    const old = new DatabaseSync(path)
    old.exec(
      `CREATE TABLE artifacts (
         item_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, path TEXT,
         error TEXT, iterations INTEGER, score REAL, cost_usd REAL, model TEXT,
         created_at TEXT NOT NULL, PRIMARY KEY (item_id, kind))`,
    )
    old.close()

    openState(path).close()

    const check = new DatabaseSync(path)
    const tables = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifact_gaps'")
      .all()
    check.close()
    expect(tables).toHaveLength(1)
  })
})
```

Fűzd a `src/pipeline.test.ts` végére (az `item`, az `alapDeps`, az
`ATMENO_RECEPT`, a `probaKliens`, a `MODELL_CFG` és a `createCostGuard` már a
fájlban van):

```ts
describe('processItem — a hiánylista rögzítése', () => {
  /** Recept, aminek a bírója hiányt nevez meg; javító kör nincs. */
  const HIANYOS_RECEPT: Recipe = {
    ...ATMENO_RECEPT,
    rubric: {
      criteria: [
        {
          name: 'hianyos',
          score: () => Promise.resolve({ value: 0.6, gaps: ['kimaradt: a második pont'] }),
        },
      ],
      passThreshold: 0.8,
    },
  }

  it('a megtartott kimenet hiánylistáját az állapottárba írja', async () => {
    const deps = alapDeps()
    const current = item()
    await processItem(current, {
      ...deps,
      recipeDeps: {
        recipe: HIANYOS_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })
    expect(deps.store.gapsOf(current.itemId, 'proba')).toEqual(['kimaradt: a második pont'])
  })

  it('a nem publikálható receptnél is rögzíti', async () => {
    const deps = alapDeps()
    const current = item()
    await processItem(current, {
      ...deps,
      recipeDeps: {
        recipe: { ...HIANYOS_RECEPT, publishable: false },
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })
    expect(deps.store.gapsOf(current.itemId, 'proba')).toEqual(['kimaradt: a második pont'])
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/state/db.test.ts src/pipeline.test.ts
```

Várt: FAIL — `store.gapsOf is not a function` az új tesztekben; a
„tábla nélküli állapotfájl" teszt a hiányzó táblán bukik.

- [ ] **3. lépés: A tábla és a típusok a `src/state/db.ts`-ben**

A `SCHEMA` végén cseréld le ezt:

```ts
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, kind)
);
`
```

erre:

```ts
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, kind)
);

CREATE TABLE IF NOT EXISTS artifact_gaps (
  item_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  gaps    TEXT NOT NULL,
  PRIMARY KEY (item_id, kind),
  FOREIGN KEY (item_id, kind) REFERENCES artifacts(item_id, kind)
);
`
```

Az `ArtifactMetrics` interfészt cseréld le erre:

```ts
/** Egy recept futásának mérőszámai. A Fázis 0 átirata ezeket nem tölti ki. */
export interface ArtifactMetrics {
  /** Hány generálás történt. */
  iterations: number
  score: number
  costUsd: number
  /** A ténylegesen futott generáló modell neve. */
  model: string
  /**
   * A megtartott kimenet hiánylistája, ahogy a bíró megnevezte. Hiánya azt
   * jelenti, hogy nincs rögzítve; az üres tömb azt, hogy a bíró nem talált
   * hiányt. A felület a kettőt megkülönbözteti.
   */
  gaps?: string[]
}
```

A `StateStore` interfészben a `artifactOf(itemId: string, kind: string): ArtifactRecord | null`
sor után illeszd be:

```ts
  /** A rögzített hiánylista; `null`, ha nincs rögzítve. */
  gapsOf(itemId: string, kind: string): string[] | null
```

- [ ] **4. lépés: A tranzakciós rögzítés és a `gapsOf`**

A `recordArtifact(itemId, kind, status, path, error, metrics) { … },` metódust
cseréld le teljes egészében erre:

```ts
    recordArtifact(itemId, kind, status, path, error, metrics) {
      // Egy tranzakcióban: a műtermék és a hiánylistája együtt változik, így egy
      // újrafuttatás után sem maradhat a régi kimenet hiánylistája az új mellett.
      db.exec('BEGIN')
      try {
        db.prepare(
          `INSERT INTO artifacts
             (item_id, kind, status, path, error, iterations, score, cost_usd, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_id, kind) DO UPDATE SET
             status = excluded.status,
             path = excluded.path,
             error = excluded.error,
             iterations = excluded.iterations,
             score = excluded.score,
             cost_usd = excluded.cost_usd,
             model = excluded.model,
             created_at = excluded.created_at`,
        ).run(
          itemId,
          kind,
          status,
          path,
          error,
          metrics?.iterations ?? null,
          metrics?.score ?? null,
          metrics?.costUsd ?? null,
          metrics?.model ?? null,
          now(),
        )
        db.prepare('DELETE FROM artifact_gaps WHERE item_id = ? AND kind = ?').run(itemId, kind)
        if (status === 'done' && metrics?.gaps !== undefined) {
          db.prepare('INSERT INTO artifact_gaps (item_id, kind, gaps) VALUES (?, ?, ?)').run(
            itemId,
            kind,
            JSON.stringify(metrics.gaps),
          )
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
```

Közvetlenül a `    transcriptOf(itemId) {` sor elé illeszd be:

```ts
    gapsOf(itemId, kind) {
      const row = db
        .prepare('SELECT gaps FROM artifact_gaps WHERE item_id = ? AND kind = ?')
        .get(itemId, kind) as { gaps: string } | undefined
      return row ? (JSON.parse(row.gaps) as string[]) : null
    },

```

- [ ] **5. lépés: A hiánylista átadása a `src/pipeline.ts`-ben**

A `runRecipe`-ben a `publishable: false` ágon cseréld le ezt:

```ts
      deps.store.recordArtifact(item.itemId, recipe.id, 'done', null, null, {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
      })
```

erre:

```ts
      deps.store.recordArtifact(item.itemId, recipe.id, 'done', null, null, {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
        gaps: result.gaps,
      })
```

és a publikálás utáni rögzítésnél ezt:

```ts
      {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
      },
```

erre:

```ts
      {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
        gaps: result.gaps,
      },
```

- [ ] **6. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/state/db.test.ts src/pipeline.test.ts
```

Várt: PASS, az új tesztekkel együtt.

- [ ] **7. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **8. lépés: Commit**

```bash
git add src/state/db.ts src/state/db.test.ts src/pipeline.ts src/pipeline.test.ts
```

Javasolt üzenet: `feat(state): a bíró hiánylistája az állapottárban`, `Refs #28`.

- [ ] **9. lépés: Mutációs ellenőrzés — a hiánylista cseréje**

A `recordArtifact`-ben töröld a `DELETE FROM artifact_gaps …` sort, és futtasd:

```bash
mise exec -- pnpm vitest run src/state/db.test.ts
```

Várt: FAIL — legalább az „újrarögzítéskor lecseréli a régit" és a „hibás
rögzítésnél törli" bukik. Állítsd vissza:

```bash
git checkout -- src/state/db.ts
```

---

## Feladat 3: Közös lekérdezések és csak olvasó hozzáférés

**Fájlok:**
- Létrehoz: `src/state/queries.ts`, `src/state/reader.ts`
- Módosít: `src/state/db.ts`, `src/index.ts`
- Teszt: `src/state/reader.test.ts`

**Interfészek:**
- Fogyaszt: az `artifact_gaps` tábla (2.).
- Termel:
  - `ItemRow` — `{ itemId, source, sourceFile, baseName, title, language, channel, uploadedAt, url, discoveredAt, captionSource: CaptionSource | null, wordsRaw: number | null, wordsNormalized: number | null }`
  - `ArtifactRow` — `{ itemId, kind, status, path, error, iterations, score, costUsd, model, createdAt }`
  - `StateReader` — `items(): ItemRow[]`, `artifacts(): ArtifactRow[]`,
    `gapsOf(itemId, kind): string[] | null`,
    `corpusStatus(items: readonly SourceItem[], kind: string): CorpusStatus`, `close()`
  - `openStateReader(path: string): StateReader | null`
  - `openReadOnlyDatabase(path: string): DatabaseSync`
  - A 9. és a 10. feladat nézetmodelljei ezt olvassák.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/state/reader.test.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { openState } from './db.js'
import { openReadOnlyDatabase, openStateReader } from './reader.js'

let dir: string
let path: string

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: '/s/youtube/csatorna/Beszéd.en.srt',
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: { channel: 'Szintetikus Csatorna' },
  ...overrides,
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-reader-'))
  path = join(dir, 'state.db')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Az író tölti fel: pontosan azt az állapotot látjuk, amit a CLI hagy maga után. */
function seed(): void {
  const store = openState(path)
  store.recordItem(item())
  store.recordTranscript('a1b2c3', 'creator', 1000, 400)
  store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/Beszéd_transcript.md', null)
  store.recordArtifact('a1b2c3', 'summary', 'done', '/v/Beszéd_summary.md', null, {
    iterations: 1,
    score: 0.7,
    costUsd: 0.02,
    model: 'szintetikus-modell',
    gaps: ['kimaradt: a zárás'],
  })
  store.close()
}

describe('openStateReader', () => {
  it('hiányzó állapotfájlra null-t ad', () => {
    expect(openStateReader(path)).toBeNull()
  })

  it('az elemeket az átirat mérőszámaival adja vissza', () => {
    seed()
    const reader = openStateReader(path)!
    expect(reader.items()).toEqual([
      expect.objectContaining({
        itemId: 'a1b2c3',
        title: 'Beszéd',
        channel: 'Szintetikus Csatorna',
        captionSource: 'creator',
        wordsRaw: 1000,
        wordsNormalized: 400,
      }),
    ])
    reader.close()
  })

  it('minden műtermék sorát visszaadja, elem és típus szerint rendezve', () => {
    seed()
    const reader = openStateReader(path)!
    expect(reader.artifacts().map((a) => [a.kind, a.status, a.score])).toEqual([
      ['summary', 'done', 0.7],
      ['transcript', 'done', null],
    ])
    reader.close()
  })

  it('a hiánylistát és a korpusz-állapotot ugyanúgy adja, mint az író', () => {
    seed()
    const reader = openStateReader(path)!
    const writer = openState(path)
    expect(reader.gapsOf('a1b2c3', 'summary')).toEqual(['kimaradt: a zárás'])
    expect(reader.corpusStatus([item()], 'summary')).toEqual(writer.corpusStatus([item()], 'summary'))
    writer.close()
    reader.close()
  })

  it('a nyitott olvasó látja az író későbbi rögzítését', () => {
    seed()
    const reader = openStateReader(path)!
    const writer = openState(path)
    writer.recordArtifact('a1b2c3', 'qa', 'failed', null, 'szintetikus hiba')
    writer.close()
    expect(reader.artifacts().some((a) => a.kind === 'qa' && a.status === 'failed')).toBe(true)
    reader.close()
  })

  it('hiánylista-tábla nélküli állapotfájlon a hiánylista null', () => {
    seed()
    const db = new DatabaseSync(path)
    db.exec('DROP TABLE artifact_gaps')
    db.close()
    const reader = openStateReader(path)!
    expect(reader.gapsOf('a1b2c3', 'summary')).toBeNull()
    reader.close()
  })

  it('régi sémájú állapotfájlnál ugyanazt a hibát dobja, mint az író', () => {
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE artifacts (video_id TEXT PRIMARY KEY)')
    old.close()
    expect(() => openStateReader(path)).toThrow(/régi, videó-alapú sémát/)
  })
})

describe('openReadOnlyDatabase', () => {
  it('a kapcsolaton az írást az SQLite utasítja el', () => {
    seed()
    const db = openReadOnlyDatabase(path)
    expect(() =>
      db.exec("INSERT INTO artifact_gaps (item_id, kind, gaps) VALUES ('x', 'y', '[]')"),
    ).toThrow(/readonly/)
    db.close()
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/state/reader.test.ts
```

Várt: FAIL, `Failed to load url ./reader.js` (a modul még nincs).

- [ ] **3. lépés: A közös lekérdezések**

`src/state/queries.ts` — a `db.ts`-ből ide költözik a sémaellenőrzés, az
`artifactOf`, a `gapsOf` és a `corpusStatus` törzse, változatlan SQL-lel:

```ts
import type { DatabaseSync } from 'node:sqlite'
import type { CaptionSource, SourceItem } from '../types.js'
import type { ArtifactRecord, CorpusStatus, SourceStatus } from './db.js'

// Az állapottár lekérdezései egy helyen. Az író (`openState`) és a csak olvasó
// (`openStateReader`) ugyanezt hívja, így a felület pontosan azt a
// korpusz-állapotot mutatja, amit a futás riportja.

/** Egy elem sora az átirat mérőszámaival. */
export interface ItemRow {
  itemId: string
  source: string
  sourceFile: string
  baseName: string
  title: string
  language: string | null
  channel: string | null
  uploadedAt: string | null
  url: string | null
  discoveredAt: string
  /** Az átirat felirat-eredete; `null`, ha még nincs átirat. */
  captionSource: CaptionSource | null
  wordsRaw: number | null
  wordsNormalized: number | null
}

/** Egy műtermék sora, minden mezővel. */
export interface ArtifactRow {
  itemId: string
  kind: string
  status: string
  path: string | null
  error: string | null
  iterations: number | null
  score: number | null
  costUsd: number | null
  model: string | null
  createdAt: string
}

/**
 * A `CREATE TABLE IF NOT EXISTS` szándékosan nem migrál: egy Fázis 1-ből maradt
 * állapotfájlon a régi, `video_id`-alapú `artifacts` tábla érintetlen marad.
 * Enélkül az ellenőrzés nélkül az `isDone` egy beazonosíthatatlan
 * `no such column: item_id` hibával állítaná meg a TELJES köteget, ahelyett hogy
 * megnevezné a valódi okot. Hiba esetén a kapcsolatot lezárja.
 */
export function assertCurrentSchema(db: DatabaseSync, path: string): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('artifacts')").all() as {
    name: string
  }[]
  if (!cols.some((c) => c.name === 'item_id')) {
    db.close()
    throw new Error(
      `A(z) ${path} állapotfájl a régi, videó-alapú sémát használja. ` +
        `Töröld — a vaultban lévő jegyzeteid érintetlenek maradnak, ` +
        `az állapot az első futáskor újraépül.`,
    )
  }
}

/** Létezik-e a tábla. A csak olvasó kapcsolat nem hozhatja létre, ezért kérdezni kell. */
export function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  )
}

export function selectArtifact(
  db: DatabaseSync,
  itemId: string,
  kind: string,
): ArtifactRecord | null {
  const row = db
    .prepare(
      `SELECT status, path, error, iterations, score, cost_usd, model
         FROM artifacts WHERE item_id = ? AND kind = ?`,
    )
    .get(itemId, kind) as
    | {
        status: string
        path: string | null
        error: string | null
        iterations: number | null
        score: number | null
        cost_usd: number | null
        model: string | null
      }
    | undefined
  if (!row) return null
  return {
    status: row.status,
    path: row.path,
    error: row.error,
    iterations: row.iterations,
    score: row.score,
    costUsd: row.cost_usd,
    model: row.model,
  }
}

/** A rögzített hiánylista; `null`, ha nincs rögzítve. */
export function selectGaps(db: DatabaseSync, itemId: string, kind: string): string[] | null {
  const row = db
    .prepare('SELECT gaps FROM artifact_gaps WHERE item_id = ? AND kind = ?')
    .get(itemId, kind) as { gaps: string } | undefined
  return row ? (JSON.parse(row.gaps) as string[]) : null
}

/**
 * A teljes korpusz állapota egy műtermék-típusra. A kész/hibás/hátralévő számok
 * erre a típusra szólnak, a `totalCostUsd` viszont minden típuson összegez.
 */
export function selectCorpusStatus(
  db: DatabaseSync,
  items: readonly SourceItem[],
  kind: string,
): CorpusStatus {
  const rows = db
    .prepare('SELECT item_id, status FROM artifacts WHERE kind = ?')
    .all(kind) as { item_id: string; status: string }[]
  const statusOf = new Map(rows.map((r) => [r.item_id, r.status]))

  const captions = db
    .prepare('SELECT item_id, source FROM transcripts')
    .all() as { item_id: string; source: string }[]
  const captionOf = new Map(captions.map((r) => [r.item_id, r.source as CaptionSource]))

  const bySourceName = new Map<string, SourceStatus>()
  const byCaptionSource: Record<CaptionSource, number> = { creator: 0, auto: 0 }
  let done = 0
  let failed = 0

  for (const item of items) {
    const entry = bySourceName.get(item.source) ?? {
      source: item.source,
      total: 0,
      done: 0,
      failed: 0,
      pending: 0,
    }
    entry.total++

    const status = statusOf.get(item.itemId)
    if (status === 'done') {
      entry.done++
      done++
    } else if (status === 'failed') {
      entry.failed++
      failed++
    } else {
      entry.pending++
    }
    bySourceName.set(item.source, entry)

    const caption = captionOf.get(item.itemId)
    if (caption !== undefined) byCaptionSource[caption]++
  }

  // A költés minden műtermék-típusra összegződik: a kérdés az, hogy erre a
  // korpuszra eddig mennyit költöttünk, nem az, hogy melyik recept vitte.
  const cost = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM artifacts')
    .get() as { total: number }

  return {
    bySource: [...bySourceName.values()].sort((a, b) => a.source.localeCompare(b.source)),
    byCaptionSource,
    done,
    failed,
    pending: items.length - done - failed,
    totalCostUsd: cost.total,
  }
}

/** Az elemek sorai az átirat mérőszámaival, azonosító szerint rendezve. */
export function selectItemRows(db: DatabaseSync): ItemRow[] {
  const rows = db
    .prepare(
      `SELECT i.item_id, i.source, i.source_file, i.base_name, i.title, i.language,
              i.channel, i.uploaded_at, i.url, i.discovered_at,
              t.source AS caption_source, t.words_raw, t.words_normalized
         FROM items i
         LEFT JOIN transcripts t ON t.item_id = i.item_id
        ORDER BY i.item_id`,
    )
    .all() as {
    item_id: string
    source: string
    source_file: string
    base_name: string
    title: string
    language: string | null
    channel: string | null
    uploaded_at: string | null
    url: string | null
    discovered_at: string
    caption_source: string | null
    words_raw: number | null
    words_normalized: number | null
  }[]
  return rows.map((r) => ({
    itemId: r.item_id,
    source: r.source,
    sourceFile: r.source_file,
    baseName: r.base_name,
    title: r.title,
    language: r.language,
    channel: r.channel,
    uploadedAt: r.uploaded_at,
    url: r.url,
    discoveredAt: r.discovered_at,
    captionSource: r.caption_source as CaptionSource | null,
    wordsRaw: r.words_raw,
    wordsNormalized: r.words_normalized,
  }))
}

/** Minden műtermék sora, elem és típus szerint rendezve. */
export function selectArtifactRows(db: DatabaseSync): ArtifactRow[] {
  const rows = db
    .prepare(
      `SELECT item_id, kind, status, path, error, iterations, score, cost_usd, model, created_at
         FROM artifacts
        ORDER BY item_id, kind`,
    )
    .all() as {
    item_id: string
    kind: string
    status: string
    path: string | null
    error: string | null
    iterations: number | null
    score: number | null
    cost_usd: number | null
    model: string | null
    created_at: string
  }[]
  return rows.map((r) => ({
    itemId: r.item_id,
    kind: r.kind,
    status: r.status,
    path: r.path,
    error: r.error,
    iterations: r.iterations,
    score: r.score,
    costUsd: r.cost_usd,
    model: r.model,
    createdAt: r.created_at,
  }))
}
```

- [ ] **4. lépés: Az író a közös lekérdezéseket hívja**

A `src/state/db.ts` importjai közé:

```ts
import { assertCurrentSchema, selectArtifact, selectCorpusStatus, selectGaps } from './queries.js'
```

Az `openState`-ben a sémaellenőrző blokkot — a
`// A \`CREATE TABLE IF NOT EXISTS\` szándékosan nem migrál` megjegyzéstől a
`throw new Error(…)`-t lezáró `}`-ig — cseréld le erre az egy sorra:

```ts
  assertCurrentSchema(db, path)
```

A visszaadott objektumban a három metódus törzse a közös lekérdezést hívja.
Cseréld le a teljes `artifactOf(itemId, kind) { … },` metódust erre:

```ts
    artifactOf(itemId, kind) {
      return selectArtifact(db, itemId, kind)
    },
```

a 2. feladatban beillesztett `gapsOf(itemId, kind) { … },` metódust erre:

```ts
    gapsOf(itemId, kind) {
      return selectGaps(db, itemId, kind)
    },
```

és a teljes `corpusStatus(items, kind) { … },` metódust erre:

```ts
    corpusStatus(items, kind) {
      return selectCorpusStatus(db, items, kind)
    },
```

- [ ] **5. lépés: Az olvasó**

`src/state/reader.ts`:

```ts
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { SourceItem } from '../types.js'
import type { CorpusStatus } from './db.js'
import {
  assertCurrentSchema,
  hasTable,
  selectArtifactRows,
  selectCorpusStatus,
  selectGaps,
  selectItemRows,
  type ArtifactRow,
  type ItemRow,
} from './queries.js'

/** Az állapottár a felület szemével: csak olvas. */
export interface StateReader {
  readonly path: string
  items(): ItemRow[]
  artifacts(): ArtifactRow[]
  /**
   * A rögzített hiánylista. `null`, ha nincs rögzítve — vagy ha az állapotfájlban
   * még nincs meg a tábla, mert a változás óta nem futott a CLI.
   */
  gapsOf(itemId: string, kind: string): string[] | null
  /** Ugyanaz a lekérdezés, amiből a futás riportja dolgozik. */
  corpusStatus(items: readonly SourceItem[], kind: string): CorpusStatus
  close(): void
}

/**
 * Csak olvasó kapcsolat. Külön függvény, hogy a teszt közvetlenül bizonyíthassa:
 * írni nem lehet rajta — az SQLite utasítja el, nem konvenció.
 */
export function openReadOnlyDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true })
}

/**
 * Az állapottár megnyitása a felületnek. Sémát nem hoz létre és PRAGMA-t nem
 * állít — ez az író dolga. Hiányzó fájlnál `null`: még nem futott semmi, ez nem
 * hiba.
 */
export function openStateReader(path: string): StateReader | null {
  if (!existsSync(path)) return null
  const db = openReadOnlyDatabase(path)
  assertCurrentSchema(db, path)
  const gapsTable = hasTable(db, 'artifact_gaps')

  let closed = false
  return {
    path,
    items: () => selectItemRows(db),
    artifacts: () => selectArtifactRows(db),
    gapsOf: (itemId, kind) => (gapsTable ? selectGaps(db, itemId, kind) : null),
    corpusStatus: (items, kind) => selectCorpusStatus(db, items, kind),
    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
```

- [ ] **6. lépés: Exportok**

A `src/index.ts`-ben cseréld le ezt:

```ts
export { openState, type StateStore } from './state/db.js'
```

erre:

```ts
export {
  openState,
  type ArtifactMetrics,
  type ArtifactRecord,
  type CorpusStatus,
  type SourceStatus,
  type StateStore,
} from './state/db.js'
export { openReadOnlyDatabase, openStateReader, type StateReader } from './state/reader.js'
export type { ArtifactRow, ItemRow } from './state/queries.js'
```

- [ ] **7. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/state
```

Várt: PASS — az új `reader.test.ts` és a változatlan `db.test.ts` is (a
refaktor viselkedést nem változtat).

- [ ] **8. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **9. lépés: Commit**

```bash
git add src/state/queries.ts src/state/reader.ts src/state/reader.test.ts src/state/db.ts src/index.ts
```

Javasolt üzenet: `feat(state): csak olvasó hozzáférés az állapottárhoz`, `Refs #28`.

- [ ] **10. lépés: Mutációs ellenőrzés — a csak olvasó kapcsolat**

Az `openReadOnlyDatabase`-ben cseréld a `new DatabaseSync(path, { readOnly: true })`-t
`new DatabaseSync(path)`-ra, és futtasd:

```bash
mise exec -- pnpm vitest run src/state/reader.test.ts
```

Várt: FAIL — „a kapcsolaton az írást az SQLite utasítja el". Állítsd vissza:

```bash
git checkout -- src/state/reader.ts
```

---

## Feladat 4: Időbélyeg a naplóban és a napló visszaolvasása

**Fájlok:**
- Módosít: `src/run/log.ts`, `src/run/log.test.ts`, `src/index.ts`
- Létrehoz: `src/run/logfile.ts`
- Teszt: `src/run/logfile.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból.
- Termel:
  - `RunLogLine = RunEvent & { at?: string }`
  - `RunLogEntry = { line: RunLogLine; end: number }` — az `end` a sor utáni bájt-offset
  - `RunLogChunk = { lines: RunLogEntry[]; nextOffset: number; invalid: number }`
  - `RunFiles = { runId: string; logPath: string; reportPath: string | null }`
  - `isRunId(value: string): boolean`
  - `listRuns(logsDir: string): Promise<RunFiles[]>` — legújabb elöl
  - `readRunEvents(path: string, offset?: number): Promise<RunLogChunk>`
  - `parseEventId(value: string | undefined): number`
  - A 7., 8. és 13. feladat ezekre épül.

- [ ] **1. lépés: Írd meg a bukó teszteket**

A `src/run/log.test.ts` első tesztjében cseréld le ezt:

```ts
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: 'scan:found', count: 2 },
      { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat' },
    ])
```

erre:

```ts
    const parsed = lines.map((line) => JSON.parse(line) as { at: unknown } & Record<string, unknown>)
    expect(parsed.map(({ at, ...event }) => [typeof at, event])).toEqual([
      ['string', { type: 'scan:found', count: 2 }],
      [
        'string',
        { type: 'item:failed', itemId: 'a', source: 'youtube', kind: 'transcript', error: 'olvashatatlan felirat' },
      ],
    ])
```

és a `describe('openRunLog', …)` blokk végére, a záró `})` elé illeszd be:

```ts
  it('minden sor ISO időbélyeget kap', async () => {
    const log = openRunLog(join(work, 'run.jsonl'))
    log.sink({ type: 'scan:found', count: 1 })
    log.close()

    const [line] = (await readFile(log.path, 'utf8')).trim().split('\n')
    const { at } = JSON.parse(line!) as { at: string }
    expect(new Date(at).toISOString()).toBe(at)
  })
```

`src/run/logfile.test.ts`:

```ts
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRunLog } from './log.js'
import { isRunId, listRuns, parseEventId, readRunEvents } from './logfile.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-logfile-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('isRunId', () => {
  it('a futásazonosító alakját elfogadja, ütközési utótaggal is', () => {
    expect(isRunId('2026-09-07T02-14-03')).toBe(true)
    expect(isRunId('2026-09-07T02-14-03-2')).toBe(true)
  })

  it('minden más alakot elutasít', () => {
    for (const value of [
      '',
      '..',
      '../2026-09-07T02-14-03',
      '2026-09-07T02-14-03.jsonl',
      '2026-09-07',
      'x2026-09-07T02-14-03',
      '2026-09-07T02-14-03/..',
    ]) {
      expect(isRunId(value)).toBe(false)
    }
  })
})

describe('listRuns', () => {
  it('hiányzó mappára üres listát ad', async () => {
    expect(await listRuns(join(dir, 'nincs'))).toEqual([])
  })

  it('legújabb elöl, a riporttal párosítva, a más nevű fájlokat kihagyva', async () => {
    await writeFile(join(dir, '2026-09-07T02-14-03.jsonl'), '')
    await writeFile(join(dir, '2026-09-07T02-14-03.md'), '# riport')
    await writeFile(join(dir, '2026-09-08T10-00-00.jsonl'), '')
    await writeFile(join(dir, 'jegyzet.jsonl'), '')
    await writeFile(join(dir, '2026-09-08T10-00-00.txt'), '')

    expect(await listRuns(dir)).toEqual([
      {
        runId: '2026-09-08T10-00-00',
        logPath: join(dir, '2026-09-08T10-00-00.jsonl'),
        reportPath: null,
      },
      {
        runId: '2026-09-07T02-14-03',
        logPath: join(dir, '2026-09-07T02-14-03.jsonl'),
        reportPath: join(dir, '2026-09-07T02-14-03.md'),
      },
    ])
  })
})

describe('readRunEvents', () => {
  it('a lezárt sorokat adja vissza, a sor utáni bájt-offsettel', async () => {
    const path = join(dir, 'run.jsonl')
    const first = '{"at":"2026-09-07T02:14:03.000Z","type":"scan:found","count":2}\n'
    const second = '{"type":"item:start","itemId":"a","title":"Árvíztűrő tükörfúrógép"}\n'
    await writeFile(path, first + second)

    const chunk = await readRunEvents(path)
    expect(chunk.lines.map((entry) => entry.line.type)).toEqual(['scan:found', 'item:start'])
    // Bájtban, nem karakterben: az ékezetes cím miatt a kettő eltér.
    expect(chunk.lines[0]!.end).toBe(Buffer.byteLength(first))
    expect(chunk.nextOffset).toBe(Buffer.byteLength(first + second))
    expect(chunk.invalid).toBe(0)
  })

  it('a félig kiírt utolsó sort a következő olvasásra hagyja', async () => {
    const path = join(dir, 'run.jsonl')
    const whole = '{"type":"scan:found","count":1}\n'
    await writeFile(path, `${whole}{"type":"item:st`)

    const chunk = await readRunEvents(path)
    expect(chunk.lines).toHaveLength(1)
    expect(chunk.nextOffset).toBe(Buffer.byteLength(whole))

    await appendFile(path, 'art","itemId":"a","title":"t"}\n')
    const next = await readRunEvents(path, chunk.nextOffset)
    expect(next.lines.map((entry) => entry.line.type)).toEqual(['item:start'])
  })

  it('az értelmezhetetlen sort kihagyja és megszámolja', async () => {
    const path = join(dir, 'run.jsonl')
    await writeFile(path, 'nem json\n{"nincs":"típus"}\n{"type":"scan:found","count":1}\n')

    const chunk = await readRunEvents(path)
    expect(chunk.lines.map((entry) => entry.line.type)).toEqual(['scan:found'])
    expect(chunk.invalid).toBe(2)
  })

  it('a fájl végénél nem kisebb offsetre üres választ ad', async () => {
    const path = join(dir, 'run.jsonl')
    await writeFile(path, '{"type":"scan:found","count":1}\n')
    expect(await readRunEvents(path, 9999)).toEqual({ lines: [], nextOffset: 9999, invalid: 0 })
  })

  it('az openRunLog által írt naplót időbélyeggel olvassa vissza', async () => {
    const log = openRunLog(join(dir, 'run.jsonl'))
    log.sink({ type: 'scan:found', count: 3 })
    log.close()

    const [entry] = (await readRunEvents(log.path)).lines
    expect(entry!.line.type).toBe('scan:found')
    expect(typeof entry!.line.at).toBe('string')
  })
})

describe('parseEventId', () => {
  it('a nemnegatív egész szöveget számmá alakítja', () => {
    expect(parseEventId('0')).toBe(0)
    expect(parseEventId('1234')).toBe(1234)
  })

  it('minden másra nullát ad', () => {
    for (const value of [undefined, '', '-1', '1.5', '12a', ' 12']) {
      expect(parseEventId(value)).toBe(0)
    }
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/run/log.test.ts src/run/logfile.test.ts
```

Várt: FAIL — a `log.test.ts` két tesztje (nincs `at`), és a `logfile.test.ts`
`Failed to load url ./logfile.js`.

- [ ] **3. lépés: Az időbélyeg**

A `src/run/log.ts`-ben cseréld le ezt:

```ts
    sink(event) {
      if (closed) return
      writeSync(fd, `${JSON.stringify(event)}\n`)
    },
```

erre:

```ts
    sink(event) {
      if (closed) return
      // Az idő a napló tulajdonsága, nem az eseményé: a `RunEvent` időmentes
      // marad, így a mag tesztjei determinisztikusak. A felület ebből rajzolja
      // az idővonalat, és ebből látja, mióta nem jött esemény.
      writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
    },
```

- [ ] **4. lépés: A napló visszaolvasása**

`src/run/logfile.ts`:

```ts
import { existsSync } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunEvent } from '../events.js'

/** Egy naplósor: az esemény és — a Fázis 5 óta — az írás időpontja. */
export type RunLogLine = RunEvent & { at?: string }

/** Egy beolvasott sor, és a vége utáni bájt-offset: innen folytatható az olvasás. */
export interface RunLogEntry {
  line: RunLogLine
  end: number
}

export interface RunLogChunk {
  lines: RunLogEntry[]
  /** Az utolsó lezárt sor utáni offset; a félig kiírt sor ide nem számít bele. */
  nextOffset: number
  /** Kihagyott, értelmezhetetlen sorok száma. */
  invalid: number
}

/** Egy futás fájljai a naplómappában. */
export interface RunFiles {
  runId: string
  logPath: string
  /** A riport útvonala; `null`, ha még (vagy soha) nem készült el. */
  reportPath: string | null
}

const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?$/

/**
 * A `runId` és a `reserveRunId` által előállítható alak. Fájlútvonal csak ezen
 * az őrön átjutott értékből képződhet: így URL-ből nem olvastatható a
 * naplómappán kívüli fájl.
 */
export function isRunId(value: string): boolean {
  return RUN_ID.test(value)
}

/** A naplómappa futásai, legújabb elöl. Hiányzó mappánál üres lista. */
export async function listRuns(logsDir: string): Promise<RunFiles[]> {
  let names: string[]
  try {
    names = await readdir(logsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const runs: RunFiles[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const runId = name.slice(0, -'.jsonl'.length)
    if (!isRunId(runId)) continue
    const reportPath = join(logsDir, `${runId}.md`)
    runs.push({
      runId,
      logPath: join(logsDir, name),
      reportPath: existsSync(reportPath) ? reportPath : null,
    })
  }
  // Az azonosító időbélyeg-alakú, tehát a kódpont szerinti rendezés időrend.
  return runs.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0))
}

function parseLine(text: string): RunLogLine | null {
  try {
    const value = JSON.parse(text) as unknown
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { type?: unknown }).type === 'string'
    ) {
      return value as RunLogLine
    }
    return null
  } catch {
    return null
  }
}

/**
 * A napló `offset`-től kezdődő, újsorral lezárt sorai.
 *
 * Egy futás közben olvasott napló utolsó sora félig kiírt lehet: az a következő
 * olvasásra marad. Az offset bájtban értendő, nem karakterben — az ékezetes
 * szöveg miatt a kettő eltér.
 */
export async function readRunEvents(path: string, offset = 0): Promise<RunLogChunk> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (offset >= size) return { lines: [], nextOffset: offset, invalid: 0 }

    const buffer = Buffer.alloc(size - offset)
    await handle.read(buffer, 0, buffer.length, offset)
    const lastNewline = buffer.lastIndexOf(0x0a)
    if (lastNewline === -1) return { lines: [], nextOffset: offset, invalid: 0 }

    const lines: RunLogEntry[] = []
    let invalid = 0
    let start = 0
    while (start <= lastNewline) {
      const newline = buffer.indexOf(0x0a, start)
      const text = buffer.subarray(start, newline).toString('utf8')
      const end = offset + newline + 1
      start = newline + 1
      if (text.trim() === '') continue
      const line = parseLine(text)
      if (line) lines.push({ line, end })
      else invalid++
    }
    return { lines, nextOffset: offset + lastNewline + 1, invalid }
  } finally {
    await handle.close()
  }
}

/** Az SSE `Last-Event-ID` fejlécéből kapott offset; érvénytelen értékre 0. */
export function parseEventId(value: string | undefined): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : 0
}
```

- [ ] **5. lépés: Exportok**

A `src/index.ts` végére:

```ts
export {
  isRunId,
  listRuns,
  parseEventId,
  readRunEvents,
  type RunFiles,
  type RunLogChunk,
  type RunLogEntry,
  type RunLogLine,
} from './run/logfile.js'
```

- [ ] **6. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/run
```

Várt: PASS. A `cli.test.ts` naplót olvasó tesztjei sem buknak: az `at` mező a
`find`/`toMatchObject`-es állításokat nem zavarja.

- [ ] **7. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **8. lépés: Commit**

```bash
git add src/run/log.ts src/run/log.test.ts src/run/logfile.ts src/run/logfile.test.ts src/index.ts
```

Javasolt üzenet: `feat(run): időbélyeg a futásnaplóban és a napló visszaolvasása`, `Refs #28`.

- [ ] **9. lépés: Mutációs ellenőrzés — a futásazonosító-őr**

A `src/run/logfile.ts`-ben cseréld a `RUN_ID` értékét `/^.+$/`-ra, és futtasd:

```bash
mise exec -- pnpm vitest run src/run/logfile.test.ts
```

Várt: FAIL — „minden más alakot elutasít" és a `listRuns` kihagyási tesztje.
Állítsd vissza:

```bash
git checkout -- src/run/logfile.ts
```

---

## Feladat 5: Generálási és pontozási események

**Fájlok:**
- Módosít: `src/refine/loop.ts`, `src/pipeline.ts`
- Teszt: `src/refine/loop.test.ts`, `src/pipeline.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból (a meglévő `item:generating` és
  `item:scored` eseménytípust).
- Termel: `RefineOptions.onGenerate?: (generation: number) => void`,
  `RefineOptions.onScore?: (score: number, gaps: number) => void`; a `runRecipe`
  mostantól kibocsátja az `item:generating` és az `item:scored` eseményt. A
  7. feladat `liveRunState`-je ezekből mutatja a lépést.

- [ ] **1. lépés: Írd meg a bukó teszteket**

Fűzd a `src/refine/loop.test.ts` végére (a `scriptedClient`, a
`tablazatosRubrika`, a `recept` és az `INPUT` már a fájlban van):

```ts
describe('refine — visszahívások', () => {
  it('minden generálás előtt és pontozás után jelez, sorrendben', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'első', score: 0.5 },
      { text: 'második', score: 0.9 },
    ])
    const jelzesek: string[] = []

    await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client, {
      onGenerate: (generation) => jelzesek.push(`generálás ${String(generation)}`),
      onScore: (score, gaps) => jelzesek.push(`pontozás ${String(score)}, ${String(gaps)} hiány`),
    })

    expect(jelzesek).toEqual([
      'generálás 1',
      'pontozás 0.5, 1 hiány',
      'generálás 2',
      'pontozás 0.9, 1 hiány',
    ])
  })
})
```

Fűzd a `src/pipeline.test.ts` végére:

```ts
describe('processItem — generálási és pontozási események', () => {
  it('generálás előtt és pontozás után eseményt bocsát ki', async () => {
    const { sink, events } = collectEvents()
    await processItem(item(), {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(
      events.filter((e) => e.type === 'item:generating' || e.type === 'item:scored'),
    ).toEqual([
      { type: 'item:generating', itemId: 'a1b2c3', recipe: 'proba', generation: 1 },
      { type: 'item:scored', itemId: 'a1b2c3', recipe: 'proba', score: 1, gaps: 0 },
    ])
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/refine/loop.test.ts src/pipeline.test.ts
```

Várt: FAIL — a `jelzesek` üres, és az eseménylista is üres.

- [ ] **3. lépés: A visszahívások a loopban**

A `src/refine/loop.ts`-ben a `RefineOptions` interfész végére, a `stopEarly?: boolean`
után:

```ts
  /** Minden generálás előtt, egytől számozva. Az élő követés ebből látja, hol tart a loop. */
  onGenerate?: (generation: number) => void
  /** Minden pontozás után: a pontszám és a megnevezett hiányok száma. */
  onScore?: (score: number, gaps: number) => void
```

A `refine` törzsében cseréld le ezt:

```ts
  const first = await generate(recipe.prompt(input))
  add(first.usage)

  const firstScore = await scoreRubric(
    recipe.rubric,
    { transcript: input.transcript, output: first.value },
    client,
  )
  add(firstScore.usage)
```

erre:

```ts
  opts.onGenerate?.(1)
  const first = await generate(recipe.prompt(input))
  add(first.usage)

  const firstScore = await scoreRubric(
    recipe.rubric,
    { transcript: input.transcript, output: first.value },
    client,
  )
  add(firstScore.usage)
  opts.onScore?.(firstScore.value, firstScore.gaps.length)
```

és a javító ciklusban ezt:

```ts
    const next = await generate(
      recipe.repairPrompt({ ...input, previous: best.output, gaps: best.gaps }),
    )
    add(next.usage)
    generations++

    const scored = await scoreRubric(
      recipe.rubric,
      { transcript: input.transcript, output: next.value },
      client,
    )
    add(scored.usage)
```

erre:

```ts
    opts.onGenerate?.(generations + 1)
    const next = await generate(
      recipe.repairPrompt({ ...input, previous: best.output, gaps: best.gaps }),
    )
    add(next.usage)
    generations++

    const scored = await scoreRubric(
      recipe.rubric,
      { transcript: input.transcript, output: next.value },
      client,
    )
    add(scored.usage)
    opts.onScore?.(scored.value, scored.gaps.length)
```

- [ ] **4. lépés: Az események a `runRecipe`-ben**

A `src/pipeline.ts`-ben cseréld le ezt:

```ts
  const result = await refine(recipe, { item, transcript: text }, client)
```

erre:

```ts
  const result = await refine(recipe, { item, transcript: text }, client, {
    // Az élő követés ezekből látja, hol tart a loop: enélkül a modellhívások
    // alatt — a futásidő nagyobb részében — nem jönne esemény.
    onGenerate: (generation) =>
      deps.sink({ type: 'item:generating', itemId: item.itemId, recipe: recipe.id, generation }),
    onScore: (score, gaps) =>
      deps.sink({ type: 'item:scored', itemId: item.itemId, recipe: recipe.id, score, gaps }),
  })
```

- [ ] **5. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/refine/loop.test.ts src/pipeline.test.ts
```

Várt: PASS.

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

A `src/e2e.test.ts` és a `cli.test.ts` változatlanul zöld: a CLI `render`-e az
új eseményekre `null`-t ad, a konzolkimenet nem változik.

- [ ] **7. lépés: Commit**

```bash
git add src/refine/loop.ts src/refine/loop.test.ts src/pipeline.ts src/pipeline.test.ts
```

Javasolt üzenet: `feat(refine): generálási és pontozási események futás közben`, `Refs #28`.

---

## Feladat 6: Indulási és lezárási esemény

**Fájlok:**
- Módosít: `src/events.ts`, `src/cli.ts`
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból.
- Termel: `RunEvent` új tagjai: `{ type: 'run:started'; command: string; pid: number }`
  és `{ type: 'run:ended'; interrupted: boolean }`. A 7. feladat `runStatus`-a és a
  8. feladat `followRunLog`-ja ezekből dönt.

- [ ] **1. lépés: Írd meg a bukó teszteket**

Fűzd a `src/cli.test.ts` végére (a `makeVideo`, a `rawConfig`, a `rawWithVault`,
a `hamisKliens`, a `downloads`, valamint a `loadConfig`, `loadModelConfig`,
`folderSource`, `getRecipe`, `normalizeItem`, `estimateItemUsd`, `readdir`,
`readFile`, `join` és a `RunEvent` típus már a fájlban van):

```ts
/** A futás egyetlen naplójának eseményei, sorrendben. */
async function naploEsemenyek(logsDir: string): Promise<RunEvent[]> {
  const jsonl = (await readdir(logsDir)).find((f) => f.endsWith('.jsonl'))!
  return (await readFile(join(logsDir, jsonl), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as RunEvent)
}

describe('commandRun — indulás és lezárás a naplóban', () => {
  it('az első sor a run:started, az utolsó a run:ended', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, {
      dryRun: false,
      force: false,
      commit: false,
      command: 'run --limit 1',
    })

    expect(code).toBe(0)
    const events = await naploEsemenyek(cfg.logsDir)
    const first = events[0]
    expect(first?.type).toBe('run:started')
    expect(first?.type === 'run:started' ? [first.command, first.pid] : null).toEqual([
      'run --limit 1',
      process.pid,
    ])
    const last = events.at(-1)
    expect(last?.type).toBe('run:ended')
    expect(last?.type === 'run:ended' ? last.interrupted : null).toBe(false)
    expect(events.filter((e) => e.type === 'run:ended')).toHaveLength(1)
    expect(events.findIndex((e) => e.type === 'run:done')).toBeLessThan(events.length - 1)
  })

  it('megszakításkor a run:ended megszakítottnak jelöl', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    let sigint: (() => void) | undefined
    let interrupted: () => void
    const exited = new Promise<void>((resolve) => (interrupted = resolve))
    const hivasok = { generate: 0 }

    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      {
        // A jel az első generálás közben érkezik: a megszakítás ága biztosan
        // megelőzi a normál befejezést.
        signals: {
          on(_event: string, listener: () => void) {
            sigint = listener
            return this
          },
        },
        exit: () => interrupted(),
        createClient: () =>
          hamisKliens(hivasok, (hanyadik) => {
            if (hanyadik === 1) sigint?.()
          }),
      },
    )
    await exited

    const lezarasok = (await naploEsemenyek(cfg.logsDir)).filter((e) => e.type === 'run:ended')
    expect(lezarasok).toHaveLength(1)
    expect(lezarasok[0]?.type === 'run:ended' ? lezarasok[0].interrupted : null).toBe(true)
  })

  it('a plafon miatti megállásnál a run:ended a run:aborted után jön', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const cost = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })

    expect(code).toBe(2)
    const types = (await naploEsemenyek(cfg.logsDir)).map((e) => e.type)
    expect(types.indexOf('run:aborted')).toBeGreaterThan(-1)
    expect(types.indexOf('run:ended')).toBeGreaterThan(types.indexOf('run:aborted'))
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/cli.test.ts -t "indulás és lezárás"
```

Várt: FAIL, mindhárom teszt — nincs `run:started` és `run:ended` a naplóban.

- [ ] **3. lépés: Az eseménytípusok**

A `src/events.ts`-ben a `RunEvent` unióban, közvetlenül ez a sor után:

```ts
  | { type: 'run:aborted'; reason: string; spentUsd: number; limitUsd: number }
```

illeszd be:

```ts
  | {
      type: 'run:started'
      /** A futást indító parancssor, kapcsolókkal. */
      command: string
      /** A futó folyamat azonosítója: a felület ebből dönti el, él-e még a futás. */
      pid: number
    }
  | {
      type: 'run:ended'
      /** Igaz, ha a futást megszakítás (SIGINT) zárta le. */
      interrupted: boolean
    }
```

- [ ] **4. lépés: A kibocsátás a `commandRun`-ban**

A `src/cli.ts`-ben ez a blokk után:

```ts
  const { sink, events } = collectEvents()
  const printing = (e: RunEvent) => {
    sink(e)
    log.sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }
```

illeszd be:

```ts

  // A napló első sora: a felület ebből tudja, mi fut, és él-e még a folyamat.
  printing({ type: 'run:started', command: commandLine, pid: process.pid })
```

A `finish`-ben cseréld le ezt:

```ts
    try {
      await writeBack()
    } catch (error) {
      console.error(`A sor visszaírása nem sikerült: ${(error as Error).message}`)
    }

    const summary = summarize(events)
```

erre:

```ts
    try {
      await writeBack()
    } catch (error) {
      console.error(`A sor visszaírása nem sikerült: ${(error as Error).message}`)
    }

    // A lezárás a naplóban: enélkül egy riport nélküli napló nem különböztetné
    // meg a még futót a keményen leállítottól.
    printing({ type: 'run:ended', interrupted })

    const summary = summarize(events)
```

- [ ] **5. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/cli.test.ts src/e2e.test.ts
```

Várt: PASS — az új tesztek, és változatlanul a meglévők (a konzolkimenet nem
változik, a `render` az új eseményekre `null`-t ad).

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **7. lépés: Commit**

```bash
git add src/events.ts src/cli.ts src/cli.test.ts
```

Javasolt üzenet: `feat(run): indulási és lezárási esemény a futásnaplóban`, `Refs #28`.

---

## Feladat 7: A futás állapota és élő összegzése

**Fájlok:**
- Létrehoz: `src/run/status.ts`, `src/view/live.ts`, `src/view/runs.ts`
- Módosít: `src/index.ts`
- Teszt: `src/run/status.test.ts`, `src/view/live.test.ts`, `src/view/runs.test.ts`

**Interfészek:**
- Fogyaszt: `RunLogLine`, `RunFiles` (4.); `run:started`, `run:ended` (6.);
  `item:generating`, `item:scored` (5.); a meglévő `summarize`.
- Termel:
  - `RunStatus = 'running' | 'died' | 'interrupted' | 'capped' | 'done' | 'failed' | 'closed' | 'unknown'`
  - `runStatus(lines: readonly RunLogLine[], ctx: { isAlive: (pid: number) => boolean; hasReport: boolean }): RunStatus`
  - `isPidAlive(pid: number): boolean`
  - `LiveRunState` és `liveRunState(lines: readonly RunLogLine[]): LiveRunState`
  - `RunSummaryView` és `summarizeRun(files: RunFiles, lines: readonly RunLogLine[], status: RunStatus, invalid: number): RunSummaryView`
  - A 8. feladat beolvasása és követése, a 9. feladat áttekintője és a
    felület futás-oldalai ezekből dolgoznak.

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/run/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RunLogLine } from './logfile.js'
import { isPidAlive, runStatus } from './status.js'

const started: RunLogLine = { type: 'run:started', command: 'run', pid: 4242 }
const ended = (interrupted: boolean): RunLogLine => ({ type: 'run:ended', interrupted })
const aborted: RunLogLine = { type: 'run:aborted', reason: 'plafon', spentUsd: 1, limitUsd: 1 }
const done: RunLogLine = { type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }
const alive = { isAlive: () => true, hasReport: false }
const dead = { isAlive: () => false, hasReport: false }

describe('runStatus — run:started-es napló', () => {
  it('lezárás nélkül, élő folyamattal: fut', () => {
    expect(runStatus([started], alive)).toBe('running')
  })

  it('lezárás nélkül, leállt folyamattal: nyom nélkül leállt', () => {
    expect(runStatus([started], dead)).toBe('died')
  })

  it('megszakított lezárás: megszakítva', () => {
    expect(runStatus([started, aborted, done, ended(true)], dead)).toBe('interrupted')
  })

  it('a plafonos megállás a run:done mellett is: a plafon miatt megállt', () => {
    expect(runStatus([started, aborted, done, ended(false)], dead)).toBe('capped')
  })

  it('run:done-nal lezárva: kész', () => {
    expect(runStatus([started, done, ended(false)], dead)).toBe('done')
  })

  it('run:done nélkül lezárva: hibával ért véget', () => {
    expect(runStatus([started, ended(false)], dead)).toBe('failed')
  })

  it('a folyamat élését a run:started pid-jével kérdezi', () => {
    const kerdezett: number[] = []
    runStatus([started], {
      isAlive: (pid) => {
        kerdezett.push(pid)
        return true
      },
      hasReport: false,
    })
    expect(kerdezett).toEqual([4242])
  })
})

describe('runStatus — run:started nélküli (régi) napló', () => {
  it('run:aborted: a plafon miatt megállt', () => {
    expect(runStatus([aborted, done], { isAlive: () => true, hasReport: true })).toBe('capped')
  })

  it('run:done: kész', () => {
    expect(runStatus([done], { isAlive: () => true, hasReport: true })).toBe('done')
  })

  it('egyik sincs, van riport: lezárt', () => {
    expect(runStatus([], { isAlive: () => true, hasReport: true })).toBe('closed')
  })

  it('egyik sincs, nincs riport: ismeretlen', () => {
    expect(runStatus([], { isAlive: () => true, hasReport: false })).toBe('unknown')
  })
})

describe('isPidAlive', () => {
  it('a saját folyamatra igaz', () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it('nem létező folyamatra hamis', () => {
    // A macOS és a Linux pid-tartományán is kívül esik.
    expect(isPidAlive(2 ** 22 + 12_345)).toBe(false)
  })
})
```

`src/view/live.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RunLogLine } from '../run/logfile.js'
import { liveRunState } from './live.js'

const at = (second: number): string => `2026-09-11T09:00:${String(second).padStart(2, '0')}.000Z`

describe('liveRunState', () => {
  it('üres naplóra kezdeti állapotot ad', () => {
    expect(liveRunState([])).toEqual({
      units: null,
      started: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      estimate: null,
      spentUsd: 0,
      current: null,
      lastScore: null,
      retries: 0,
      recentFailures: [],
      aborted: null,
      ended: null,
      lastEventAt: null,
    })
  })

  it('követi az éppen feldolgozott elemet és a lépését', () => {
    const lines: RunLogLine[] = [
      { at: at(1), type: 'run:started', command: 'run --queue', pid: 1 },
      { at: at(2), type: 'scan:found', count: 2 },
      { at: at(3), type: 'run:estimate', items: 2, tokens: 1000, usd: 0.2, limitUsd: 5 },
      { at: at(4), type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      { at: at(5), type: 'item:generating', itemId: 'a', recipe: 'summary', generation: 1 },
    ]

    const state = liveRunState(lines)
    expect(state.units).toBe(2)
    expect(state.started).toBe(1)
    expect(state.estimate).toEqual({ items: 2, usd: 0.2, limitUsd: 5 })
    expect(state.current).toEqual({
      itemId: 'a',
      title: 'Első példavideó',
      step: 'summary: generálás (1.)',
    })
    expect(state.lastEventAt).toBe(at(5))
  })

  it('összegzi a pontozást, a költést és az újrapróbát', () => {
    const lines: RunLogLine[] = [
      { type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      { type: 'item:retry', itemId: 'a', attempt: 1, delayMs: 1000, reason: 'sebességkorlát' },
      { type: 'item:scored', itemId: 'a', recipe: 'summary', score: 0.62, gaps: 2 },
      { type: 'item:refined', itemId: 'a', recipe: 'summary', score: 0.62, generations: 1, usd: 0.0123 },
      { type: 'item:refined', itemId: 'b', recipe: 'qa', score: 0.9, generations: 1, usd: 0.01 },
    ]

    const state = liveRunState(lines)
    expect(state.retries).toBe(1)
    expect(state.lastScore).toEqual({ itemId: 'a', recipe: 'summary', score: 0.62, gaps: 2 })
    expect(state.current?.step).toBe('summary: pontozva, 0.62')
    expect(state.spentUsd).toBeCloseTo(0.0223, 10)
  })

  it('a legutóbbi öt hibát tartja meg, a legfrissebbet elöl', () => {
    const lines: RunLogLine[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'item:failed' as const,
      itemId: `e${String(i)}`,
      source: 'youtube',
      kind: 'summary',
      error: `szintetikus hiba ${String(i)}`,
    }))

    const state = liveRunState(lines)
    expect(state.failed).toBe(7)
    expect(state.recentFailures.map((f) => f.itemId)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2'])
  })

  it('a futás végén nincs aktuális elem; látszik a lezárás és a plafon', () => {
    const lines: RunLogLine[] = [
      { type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      {
        type: 'run:aborted',
        reason: 'a tényleges költés meghaladta a plafont',
        spentUsd: 5.1,
        limitUsd: 5,
      },
      { type: 'run:done', succeeded: 0, skipped: 0, failed: 0 },
      { type: 'run:ended', interrupted: false },
    ]

    const state = liveRunState(lines)
    expect(state.current).toBeNull()
    expect(state.aborted).toBe('a tényleges költés meghaladta a plafont')
    expect(state.ended).toEqual({ interrupted: false })
  })
})
```

`src/view/runs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RunLogLine } from '../run/logfile.js'
import { summarizeRun } from './runs.js'

const files = {
  runId: '2026-09-07T02-14-03',
  logPath: '/l/2026-09-07T02-14-03.jsonl',
  reportPath: '/l/2026-09-07T02-14-03.md',
}

describe('summarizeRun', () => {
  it('a parancsot, az időt, az egységeket, a becslést és a költést a sorokból veszi', () => {
    const lines: RunLogLine[] = [
      { at: '2026-09-07T02:14:03.000Z', type: 'run:started', command: 'run --queue', pid: 1 },
      { at: '2026-09-07T02:14:04.000Z', type: 'scan:found', count: 2 },
      { at: '2026-09-07T02:14:04.500Z', type: 'run:estimate', items: 2, tokens: 1000, usd: 0.2, limitUsd: 5 },
      { at: '2026-09-07T02:14:05.000Z', type: 'item:start', itemId: 'a', title: 'Első példavideó' },
      {
        at: '2026-09-07T02:14:06.000Z',
        type: 'item:normalized',
        itemId: 'a',
        wordsRaw: 10,
        wordsNormalized: 5,
        captionSource: 'creator',
      },
      {
        at: '2026-09-07T02:14:08.000Z',
        type: 'item:refined',
        itemId: 'a',
        recipe: 'summary',
        score: 0.9,
        generations: 1,
        usd: 0.05,
      },
      { at: '2026-09-07T02:14:08.100Z', type: 'item:published', itemId: 'a', path: '/v/a.md' },
      {
        at: '2026-09-07T02:14:09.000Z',
        type: 'item:failed',
        itemId: 'b',
        source: 'youtube',
        kind: 'summary',
        error: 'szintetikus hiba',
      },
      { at: '2026-09-07T02:14:13.000Z', type: 'run:ended', interrupted: false },
    ]

    expect(summarizeRun(files, lines, 'failed', 0)).toEqual({
      runId: '2026-09-07T02-14-03',
      status: 'failed',
      command: 'run --queue',
      startedAt: '2026-09-07T02:14:03.000Z',
      lastEventAt: '2026-09-07T02:14:13.000Z',
      durationMs: 10_000,
      units: 2,
      estimate: { items: 2, usd: 0.2, limitUsd: 5 },
      succeeded: 1,
      failed: 1,
      spentUsd: 0.05,
      hasReport: true,
      invalid: 0,
    })
  })

  it('a változás előtti, időbélyeg nélküli naplónál a parancs és az idő null', () => {
    const lines: RunLogLine[] = [
      { type: 'scan:found', count: 1 },
      { type: 'run:done', succeeded: 0, skipped: 0, failed: 0 },
    ]

    const view = summarizeRun({ ...files, reportPath: null }, lines, 'done', 3)
    expect([view.command, view.startedAt, view.durationMs, view.hasReport, view.invalid]).toEqual([
      null,
      null,
      null,
      false,
      3,
    ])
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/run/status.test.ts src/view
```

Várt: FAIL — a három modul még nincs.

- [ ] **3. lépés: A futás állapota**

`src/run/status.ts`:

```ts
import type { RunLogLine } from './logfile.js'

/** Egy futás állapota; a felület magyarul írja ki. */
export type RunStatus =
  | 'running'
  | 'died'
  | 'interrupted'
  | 'capped'
  | 'done'
  | 'failed'
  | 'closed'
  | 'unknown'

export interface RunStatusContext {
  /** Él-e a megadott folyamat. A tesztek hamis függvényt adnak. */
  isAlive: (pid: number) => boolean
  /** Elkészült-e a futás riportja. */
  hasReport: boolean
}

/**
 * A futás állapota a naplósorokból.
 *
 * Új naplóban (`run:started` van) a lezárás dönt; a változás előtti naplóban a
 * `run:aborted`, a `run:done` és a riport megléte. A plafonos megállásnál a
 * kód a `run:aborted` után `run:done`-t is kibocsát, ezért a `run:aborted`
 * vizsgálata jön előbb.
 */
export function runStatus(lines: readonly RunLogLine[], ctx: RunStatusContext): RunStatus {
  const started = lines.find((line) => line.type === 'run:started')
  const ended = lines.find((line) => line.type === 'run:ended')
  const aborted = lines.some((line) => line.type === 'run:aborted')
  const done = lines.some((line) => line.type === 'run:done')

  if (started?.type === 'run:started') {
    if (ended?.type !== 'run:ended') return ctx.isAlive(started.pid) ? 'running' : 'died'
    if (ended.interrupted) return 'interrupted'
    if (aborted) return 'capped'
    if (done) return 'done'
    return 'failed'
  }

  if (aborted) return 'capped'
  if (done) return 'done'
  return ctx.hasReport ? 'closed' : 'unknown'
}

/**
 * Él-e a folyamat. A `kill(pid, 0)` jelet nem küld, csak ellenőriz. `EPERM`: a
 * folyamat létezik, csak nem a miénk — tehát él.
 *
 * Ismert korlát: egy újrahasznosított pid ritkán hamis „fut"-ot adhat; a
 * felület ezért mindig kiírja az utolsó esemény óta eltelt időt.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
```

- [ ] **4. lépés: Az élő állapot**

`src/view/live.ts`:

```ts
import { summarize } from '../events.js'
import type { RunLogLine } from '../run/logfile.js'

/** Egy futás állapota, ahogy a felület mutatja. Mindig a napló elejétől számol. */
export interface LiveRunState {
  /** A feldolgozandó egységek száma (`scan:found`). */
  units: number | null
  /** Az elkezdett egységek száma (`item:start`). */
  started: number
  succeeded: number
  skipped: number
  failed: number
  estimate: { items: number; usd: number; limitUsd: number } | null
  /** A tényleges költés: az `item:refined` összegei. */
  spentUsd: number
  /** Az éppen feldolgozott elem és lépése; a futás végén `null`. */
  current: { itemId: string; title: string; step: string } | null
  lastScore: { itemId: string; recipe: string; score: number; gaps: number } | null
  retries: number
  /** A legutóbbi legfeljebb öt hiba, a legfrissebb elöl. */
  recentFailures: { itemId: string; kind: string; error: string }[]
  /** A plafon miatti megállás oka, ha volt. */
  aborted: string | null
  ended: { interrupted: boolean } | null
  /** Az utolsó időbélyeges sor ideje. */
  lastEventAt: string | null
}

/**
 * A futás állapota a naplósorokból. Tiszta függvény: az SSE-útvonal minden sor
 * után hívja, a futás oldala a teljes naplóra. A kliens csak megjeleníti.
 */
export function liveRunState(lines: readonly RunLogLine[]): LiveRunState {
  const summary = summarize(lines)
  const titles = new Map<string, string>()
  const stepOf = (itemId: string, step: string): LiveRunState['current'] => ({
    itemId,
    title: titles.get(itemId) ?? itemId,
    step,
  })

  let units: number | null = null
  let started = 0
  let estimate: LiveRunState['estimate'] = null
  let spentUsd = 0
  let current: LiveRunState['current'] = null
  let lastScore: LiveRunState['lastScore'] = null
  let retries = 0
  const failures: LiveRunState['recentFailures'] = []
  let aborted: string | null = null
  let ended: LiveRunState['ended'] = null
  let lastEventAt: string | null = null

  for (const line of lines) {
    if (line.at !== undefined) lastEventAt = line.at
    switch (line.type) {
      case 'scan:found':
        units = line.count
        break
      case 'run:estimate':
        estimate = { items: line.items, usd: line.usd, limitUsd: line.limitUsd }
        break
      case 'item:start':
        started++
        titles.set(line.itemId, line.title)
        current = stepOf(line.itemId, 'feldolgozás')
        break
      case 'item:generating':
        current = stepOf(line.itemId, `${line.recipe}: generálás (${String(line.generation)}.)`)
        break
      case 'item:scored':
        lastScore = { itemId: line.itemId, recipe: line.recipe, score: line.score, gaps: line.gaps }
        current = stepOf(line.itemId, `${line.recipe}: pontozva, ${line.score.toFixed(2)}`)
        break
      case 'item:retry':
        retries++
        current = stepOf(line.itemId, `újrapróba (${String(line.attempt)}.)`)
        break
      case 'item:refined':
        spentUsd += line.usd
        break
      case 'item:failed':
        failures.unshift({ itemId: line.itemId, kind: line.kind, error: line.error })
        break
      case 'run:aborted':
        aborted = line.reason
        break
      case 'run:done':
        current = null
        break
      case 'run:ended':
        ended = { interrupted: line.interrupted }
        current = null
        break
      default:
        break
    }
  }

  return {
    units,
    started,
    succeeded: summary.succeeded,
    skipped: summary.skipped,
    failed: summary.failed,
    estimate,
    spentUsd,
    current,
    lastScore,
    retries,
    recentFailures: failures.slice(0, 5),
    aborted,
    ended,
    lastEventAt,
  }
}
```

- [ ] **5. lépés: A futás összegzése**

`src/view/runs.ts`:

```ts
import type { RunFiles, RunLogLine } from '../run/logfile.js'
import type { RunStatus } from '../run/status.js'
import { liveRunState } from './live.js'

/** Egy futás a futáslistában. */
export interface RunSummaryView {
  runId: string
  status: RunStatus
  /** A `run:started` parancssora; a változás előtti naplóban `null`. */
  command: string | null
  /** Az első időbélyeges sor ideje; a változás előtti naplóban `null`. */
  startedAt: string | null
  lastEventAt: string | null
  durationMs: number | null
  units: number | null
  estimate: { items: number; usd: number; limitUsd: number } | null
  succeeded: number
  failed: number
  spentUsd: number
  hasReport: boolean
  /** Kihagyott, értelmezhetetlen naplósorok. */
  invalid: number
}

export function summarizeRun(
  files: RunFiles,
  lines: readonly RunLogLine[],
  status: RunStatus,
  invalid: number,
): RunSummaryView {
  const live = liveRunState(lines)
  const started = lines.find((line) => line.type === 'run:started')
  const startedAt = lines.find((line) => line.at !== undefined)?.at ?? null
  return {
    runId: files.runId,
    status,
    command: started?.type === 'run:started' ? started.command : null,
    startedAt,
    lastEventAt: live.lastEventAt,
    durationMs:
      startedAt !== null && live.lastEventAt !== null
        ? Date.parse(live.lastEventAt) - Date.parse(startedAt)
        : null,
    units: live.units,
    estimate: live.estimate,
    succeeded: live.succeeded,
    failed: live.failed,
    spentUsd: live.spentUsd,
    hasReport: files.reportPath !== null,
    invalid,
  }
}
```

- [ ] **6. lépés: Exportok**

A `src/index.ts` végére:

```ts
export { isPidAlive, runStatus, type RunStatus, type RunStatusContext } from './run/status.js'
export { liveRunState, type LiveRunState } from './view/live.js'
export { summarizeRun, type RunSummaryView } from './view/runs.js'
```

- [ ] **7. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/run/status.test.ts src/view
```

Várt: PASS.

- [ ] **8. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **9. lépés: Commit**

```bash
git add src/run/status.ts src/run/status.test.ts src/view/live.ts src/view/live.test.ts src/view/runs.ts src/view/runs.test.ts src/index.ts
```

Javasolt üzenet: `feat(run): a futás állapota és élő összegzése a naplóból`, `Refs #28`.

- [ ] **10. lépés: Mutációs ellenőrzés — a `run:aborted` előbb-vizsgálata**

A `runStatus` `run:started`-es ágában cseréld fel a két sort
(`if (done) return 'done'` kerüljön az `if (aborted) return 'capped'` elé), és
futtasd:

```bash
mise exec -- pnpm vitest run src/run/status.test.ts
```

Várt: FAIL — „a plafonos megállás a run:done mellett is". Állítsd vissza:

```bash
git checkout -- src/run/status.ts
```

---

## Feladat 8: Futások beolvasása és a napló követése

**Fájlok:**
- Létrehoz: `src/run/follow.ts`
- Módosít: `src/run/logfile.ts`, `src/view/runs.ts`, `src/index.ts`
- Teszt: `src/run/follow.test.ts`, `src/run/logfile.test.ts`, `src/view/runs.test.ts`

**Interfészek:**
- Fogyaszt: `readRunEvents`, `listRuns`, `isRunId`, `RunFiles`, `RunLogLine` (4.);
  `runStatus`, `isPidAlive`, `liveRunState`, `summarizeRun` (7.).
- Termel:
  - `findRun(logsDir: string, runId: string): RunFiles | null`
  - `loadRun(files: RunFiles, isAlive: (pid: number) => boolean): Promise<{ summary: RunSummaryView; lines: RunLogLine[] }>`
  - `readRuns(cfg: Pick<Config, 'logsDir'>, isAlive?): Promise<RunSummaryView[]>`
  - `RunDetail = { summary: RunSummaryView; lines: RunLogLine[]; state: LiveRunState; report: string | null }`
  - `readRun(cfg: Pick<Config, 'logsDir'>, runId: string, isAlive?): Promise<RunDetail | null>`
  - `FollowOptions = { fromOffset: number; intervalMs: number; isAlive: (pid: number) => boolean; signal: AbortSignal; sleep?: (ms: number) => Promise<void> }`
  - `FollowedLine = { line: RunLogLine; end: number; state: LiveRunState }`
  - `followRunLog(path: string, opts: FollowOptions): AsyncGenerator<FollowedLine>`
  - A 9. feladat áttekintője a `readRuns`-t, a 13. feladat útvonalai a
    `readRuns`-t, a `readRun`-t, a `findRun`-t és a `followRunLog`-ot hívják.

- [ ] **1. lépés: Írd meg a bukó teszteket**

A `src/run/logfile.test.ts` importsorát cseréld le erre:

```ts
import { findRun, isRunId, listRuns, parseEventId, readRunEvents } from './logfile.js'
```

és fűzd a fájl végére:

```ts
describe('findRun', () => {
  it('létező futásra a fájljait adja', async () => {
    await writeFile(join(dir, '2026-09-07T02-14-03.jsonl'), '')
    expect(findRun(dir, '2026-09-07T02-14-03')).toEqual({
      runId: '2026-09-07T02-14-03',
      logPath: join(dir, '2026-09-07T02-14-03.jsonl'),
      reportPath: null,
    })
  })

  it('nem runId alakú vagy nem létező futásra null', async () => {
    await writeFile(join(dir, '2026-09-07T02-14-03.jsonl'), '')
    expect(findRun(dir, '../2026-09-07T02-14-03')).toBeNull()
    expect(findRun(dir, '2026-09-08T00-00-00')).toBeNull()
  })
})
```

`src/run/follow.test.ts`:

```ts
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEvent } from '../events.js'
import { followRunLog, type FollowOptions } from './follow.js'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-follow-'))
  path = join(dir, 'run.jsonl')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const line = (event: RunEvent): string => `${JSON.stringify(event)}\n`
const started: RunEvent = { type: 'run:started', command: 'run', pid: 77 }
const ended: RunEvent = { type: 'run:ended', interrupted: false }

/** A várakozás helyett a következő sort fűzi a naplóhoz: a követés így determinisztikus. */
function appending(next: string[]): (ms: number) => Promise<void> {
  return async () => {
    const chunk = next.shift()
    if (chunk !== undefined) await appendFile(path, chunk)
  }
}

async function types(opts: Partial<FollowOptions>): Promise<string[]> {
  const seen: string[] = []
  const lines = followRunLog(path, {
    fromOffset: 0,
    intervalMs: 1,
    isAlive: () => true,
    signal: new AbortController().signal,
    sleep: appending([]),
    ...opts,
  })
  for await (const followed of lines) seen.push(followed.line.type)
  return seen
}

describe('followRunLog', () => {
  it('a futó napló új sorait adja, és a run:ended után egy utolsó olvasással zár', async () => {
    await writeFile(path, line(started))
    const got = await types({
      sleep: appending([
        line({ type: 'scan:found', count: 1 }),
        line(ended),
        line({ type: 'run:done', succeeded: 0, skipped: 0, failed: 0 }),
      ]),
    })
    expect(got).toEqual(['run:started', 'scan:found', 'run:ended', 'run:done'])
  })

  it('a fromOffset előtti sorokat nem adja ki, de az állapot beszámítja őket', async () => {
    const head = line(started) + line({ type: 'scan:found', count: 3 })
    await writeFile(path, head + line(ended))

    const got: [string, number | null, number][] = []
    const lines = followRunLog(path, {
      fromOffset: Buffer.byteLength(head),
      intervalMs: 1,
      isAlive: () => true,
      signal: new AbortController().signal,
      sleep: appending([]),
    })
    for await (const followed of lines) {
      got.push([followed.line.type, followed.state.units, followed.end])
    }
    expect(got).toEqual([['run:ended', 3, Buffer.byteLength(head + line(ended))]])
  })

  it('a fájl méreténél nagyobb offsetnél az elejéről kezd', async () => {
    await writeFile(path, line(started) + line(ended))
    expect(await types({ fromOffset: 10_000 })).toEqual(['run:started', 'run:ended'])
  })

  it('leállt folyamat után egy utolsó olvasással zár', async () => {
    await writeFile(path, line(started))
    const got = await types({
      isAlive: () => false,
      sleep: appending([
        line({ type: 'scan:found', count: 1 }),
        line({ type: 'item:start', itemId: 'a', title: 'szintetikus' }),
      ]),
    })
    expect(got).toEqual(['run:started', 'scan:found'])
  })

  it('a run:started nélküli (régi) naplót kiadja és zár', async () => {
    await writeFile(
      path,
      line({ type: 'scan:found', count: 1 }) +
        line({ type: 'run:done', succeeded: 0, skipped: 0, failed: 0 }),
    )
    const got = await types({
      sleep: appending([line({ type: 'item:start', itemId: 'a', title: 'szintetikus' })]),
    })
    expect(got).toEqual(['scan:found', 'run:done'])
  })

  it('a megszakított jelzés után nem ad több sort', async () => {
    await writeFile(path, line(started))
    const controller = new AbortController()
    const got = await types({
      signal: controller.signal,
      sleep: async () => {
        controller.abort()
        await appendFile(path, line({ type: 'scan:found', count: 1 }))
      },
    })
    expect(got).toEqual(['run:started'])
  })
})
```

Az `src/view/runs.test.ts` importjait cseréld le erre:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunEvent } from '../events.js'
import type { RunLogLine } from '../run/logfile.js'
import { readRun, readRuns, summarizeRun } from './runs.js'
```

és fűzd a fájl végére:

```ts
describe('readRuns és readRun', () => {
  let dir: string
  const line = (event: RunEvent): string => `${JSON.stringify(event)}\n`

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-runs-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a futásokat legújabb elöl, a folyamat élése szerinti állapottal adja', async () => {
    await writeFile(
      join(dir, '2026-09-10T08-00-00.jsonl'),
      line({ type: 'run:started', command: 'run', pid: 11 }) +
        line({ type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }) +
        line({ type: 'run:ended', interrupted: false }),
    )
    await writeFile(
      join(dir, '2026-09-11T09-00-00.jsonl'),
      line({ type: 'run:started', command: 'run --queue', pid: 22 }),
    )

    const runs = await readRuns({ logsDir: dir }, (pid) => pid === 22)
    expect(runs.map((r) => [r.runId, r.status, r.command])).toEqual([
      ['2026-09-11T09-00-00', 'running', 'run --queue'],
      ['2026-09-10T08-00-00', 'done', 'run'],
    ])
  })

  it('egy futás sorait, állapotát és riportját adja', async () => {
    await writeFile(
      join(dir, '2026-09-10T08-00-00.jsonl'),
      line({ type: 'run:started', command: 'run', pid: 11 }) +
        line({ type: 'scan:found', count: 4 }) +
        line({ type: 'run:ended', interrupted: true }),
    )
    await writeFile(join(dir, '2026-09-10T08-00-00.md'), '# Futás\n')

    const run = await readRun({ logsDir: dir }, '2026-09-10T08-00-00', () => false)
    expect(run?.summary.status).toBe('interrupted')
    expect(run?.lines.map((l) => l.type)).toEqual(['run:started', 'scan:found', 'run:ended'])
    expect(run?.state.units).toBe(4)
    expect(run?.report).toBe('# Futás\n')
  })

  it('nem runId alakú azonosítóra null', async () => {
    expect(await readRun({ logsDir: dir }, '../../etc/passwd')).toBeNull()
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/run/logfile.test.ts src/run/follow.test.ts src/view/runs.test.ts
```

Várt: FAIL — `findRun` nincs exportálva, a `follow.ts` hiányzik, a `readRuns`
és a `readRun` nincs.

- [ ] **3. lépés: A futás megkeresése**

A `src/run/logfile.ts` végére:

```ts
/** Egy futás fájljai azonosító szerint; nem `runId` alakú vagy nem létező futásra `null`. */
export function findRun(logsDir: string, runId: string): RunFiles | null {
  if (!isRunId(runId)) return null
  const logPath = join(logsDir, `${runId}.jsonl`)
  if (!existsSync(logPath)) return null
  const reportPath = join(logsDir, `${runId}.md`)
  return { runId, logPath, reportPath: existsSync(reportPath) ? reportPath : null }
}
```

- [ ] **4. lépés: A napló követése**

`src/run/follow.ts`:

```ts
import { stat } from 'node:fs/promises'
import { liveRunState, type LiveRunState } from '../view/live.js'
import { readRunEvents, type RunLogLine } from './logfile.js'

export interface FollowOptions {
  /** A böngésző utolsó ismert offsetje (`Last-Event-ID`); a fájl méreténél nagyobbra 0. */
  fromOffset: number
  intervalMs: number
  isAlive: (pid: number) => boolean
  signal: AbortSignal
  /** A várakozás; a tesztek a napló bővítésére használják. */
  sleep?: (ms: number) => Promise<void>
}

export interface FollowedLine {
  line: RunLogLine
  /** A sor utáni bájt-offset: ez az SSE-üzenet azonosítója. */
  end: number
  /** A futás állapota e sor után, a napló elejétől számolva. */
  state: LiveRunState
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function startedPid(lines: readonly RunLogLine[]): number | null {
  for (const line of lines) {
    if (line.type === 'run:started') return line.pid
  }
  return null
}

const hasEnded = (lines: readonly RunLogLine[]): boolean =>
  lines.some((line) => line.type === 'run:ended')

/**
 * Egy futásnapló követése.
 *
 * Előbb a teljes eddigi tartalmat olvassa — az állapot a napló elejétől
 * számít —, de csak a `fromOffset` utáni sorokat adja ki. Utána
 * `intervalMs`-enként megnézi, nőtt-e a fájl. Fájlfigyelő nincs: egyetlen fájl
 * méretének ellenőrzése egyszerű és kiszámítható.
 *
 * Véget ér: ha a naplóban nincs `run:started` (változás előtti napló) vagy már
 * lezárt; ha követés közben megjön a `run:ended` — egy utolsó olvasás után, mert
 * a megszakítás ágán a fő ág még írhat —; ha a folyamat már nem él, egy utolsó
 * olvasás után; vagy ha a `signal` megszakad.
 */
export async function* followRunLog(
  path: string,
  opts: FollowOptions,
): AsyncGenerator<FollowedLine> {
  const sleep = opts.sleep ?? wait
  const { size } = await stat(path)
  const from = opts.fromOffset <= size ? opts.fromOffset : 0
  const lines: RunLogLine[] = []

  const first = await readRunEvents(path, 0)
  let offset = first.nextOffset
  for (const { line, end } of first.lines) {
    lines.push(line)
    if (end > from) yield { line, end, state: liveRunState(lines) }
  }

  const pid = startedPid(lines)
  if (pid === null || hasEnded(lines)) return

  while (!opts.signal.aborted) {
    // Az élést a várakozás ELŐTT nézzük: egy leállt folyamat után még egy
    // olvasás jár, hogy az utolsó sorai se vesszenek el.
    const alive = opts.isAlive(pid)
    await sleep(opts.intervalMs)
    if (opts.signal.aborted) return

    const chunk = await readRunEvents(path, offset)
    offset = chunk.nextOffset
    for (const { line, end } of chunk.lines) {
      lines.push(line)
      yield { line, end, state: liveRunState(lines) }
    }

    if (hasEnded(lines)) {
      await sleep(opts.intervalMs)
      if (opts.signal.aborted) return
      const tail = await readRunEvents(path, offset)
      for (const { line, end } of tail.lines) {
        lines.push(line)
        yield { line, end, state: liveRunState(lines) }
      }
      return
    }
    if (!alive) return
  }
}
```

- [ ] **5. lépés: A futások beolvasása**

A `src/view/runs.ts` importjait cseréld le erre:

```ts
import { readFile } from 'node:fs/promises'
import type { Config } from '../config.js'
import {
  findRun,
  listRuns,
  readRunEvents,
  type RunFiles,
  type RunLogLine,
} from '../run/logfile.js'
import { isPidAlive, runStatus, type RunStatus } from '../run/status.js'
import { liveRunState, type LiveRunState } from './live.js'
```

és fűzd a fájl végére:

```ts
/** Egy futás beolvasása: a sorai és az összegzése. */
export async function loadRun(
  files: RunFiles,
  isAlive: (pid: number) => boolean,
): Promise<{ summary: RunSummaryView; lines: RunLogLine[] }> {
  const chunk = await readRunEvents(files.logPath)
  const lines = chunk.lines.map((entry) => entry.line)
  const status = runStatus(lines, { isAlive, hasReport: files.reportPath !== null })
  return { summary: summarizeRun(files, lines, status, chunk.invalid), lines }
}

/** A naplómappa futásai, legújabb elöl. */
export async function readRuns(
  cfg: Pick<Config, 'logsDir'>,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<RunSummaryView[]> {
  const runs = await listRuns(cfg.logsDir)
  return Promise.all(runs.map(async (files) => (await loadRun(files, isAlive)).summary))
}

/** Egy futás minden adata a futás oldalához. */
export interface RunDetail {
  summary: RunSummaryView
  lines: RunLogLine[]
  state: LiveRunState
  /** A riport Markdownja; `null`, ha nincs. */
  report: string | null
}

/** Egy futás beolvasása; nem `runId` alakú vagy nem létező futásra `null`. */
export async function readRun(
  cfg: Pick<Config, 'logsDir'>,
  runId: string,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<RunDetail | null> {
  const files = findRun(cfg.logsDir, runId)
  if (!files) return null
  const { summary, lines } = await loadRun(files, isAlive)
  const report = files.reportPath === null ? null : await readFile(files.reportPath, 'utf8')
  return { summary, lines, state: liveRunState(lines), report }
}
```

- [ ] **6. lépés: Exportok**

A `src/index.ts`-ben a 4. feladatban felvett `./run/logfile.js`-exportba vedd fel
a `findRun`-t, a 7. feladatban felvett `./view/runs.js`-exportot pedig cseréld le.
A két blokk így nézzen ki:

```ts
export {
  findRun,
  isRunId,
  listRuns,
  parseEventId,
  readRunEvents,
  type RunFiles,
  type RunLogChunk,
  type RunLogEntry,
  type RunLogLine,
} from './run/logfile.js'
```

```ts
export {
  loadRun,
  readRun,
  readRuns,
  summarizeRun,
  type RunDetail,
  type RunSummaryView,
} from './view/runs.js'
```

és a fájl végére:

```ts
export { followRunLog, type FollowedLine, type FollowOptions } from './run/follow.js'
```

- [ ] **7. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/run src/view
```

Várt: PASS.

- [ ] **8. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **9. lépés: Commit**

```bash
git add src/run/logfile.ts src/run/logfile.test.ts src/run/follow.ts src/run/follow.test.ts src/view/runs.ts src/view/runs.test.ts src/index.ts
```

Javasolt üzenet: `feat(run): futások beolvasása és a napló követése`, `Refs #28`.

---

## Feladat 9: Az áttekintő nézetmodellje

**Fájlok:**
- Létrehoz: `src/view/overview.ts`
- Módosít: `src/index.ts`
- Teszt: `src/view/overview.test.ts`

**Interfészek:**
- Fogyaszt: `loadConfig` `baseDir`-rel (1.); `openStateReader`, `ArtifactRow` (3.);
  `readRuns`, `RunSummaryView` (8.); a meglévő `discoverAll`, `parseQueue`,
  `checkedPairs`, `queuePath`, `readQueueFile`, `RECIPES`, `RECIPE_IDS`,
  `ARTIFACT_KIND`, `KindCorpus`.
- Termel:
  - `artifactKinds(): string[]` — `['transcript', ...RECIPE_IDS]`
  - `emptyCorpusStatus(items: readonly SourceItem[]): CorpusStatus`
  - `ScoreDistribution = { recipe; threshold; buckets: number[]; scored; belowThreshold }`
  - `scoreDistribution(recipe: string, artifacts: readonly ArtifactRow[]): ScoreDistribution`
  - `QueueRecipeOverview = { recipe; checked; done; failed; pending }`
  - `queueOverview(queueText: string, artifacts: readonly ArtifactRow[]): QueueRecipeOverview[]`
  - `Overview = { hasState; discovered; corpus: KindCorpus[]; scores; totalCostUsd; queue: QueueRecipeOverview[] | null; running: RunSummaryView[] }`
  - `buildOverview(input: OverviewInput): Overview`
  - `readOverview(cfg, isAlive?): Promise<Overview>`
  - A 10. feladat az `artifactKinds`-ot, a 11. feladat `/api/overview` útvonala a
    `readOverview`-t hívja.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/view/overview.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { discoverAll } from '../source/folder.js'
import { openState } from '../state/db.js'
import type { ArtifactRow } from '../state/queries.js'
import type { SourceItem } from '../types.js'
import {
  artifactKinds,
  buildOverview,
  emptyCorpusStatus,
  queueOverview,
  readOverview,
  scoreDistribution,
} from './overview.js'
import type { RunSummaryView } from './runs.js'

const artifact = (overrides: Partial<ArtifactRow>): ArtifactRow => ({
  itemId: 'a',
  kind: 'summary',
  status: 'done',
  path: null,
  error: null,
  iterations: 1,
  score: null,
  costUsd: null,
  model: null,
  createdAt: '2026-09-11T09:00:00.000Z',
  ...overrides,
})

describe('artifactKinds', () => {
  it('az átirat után a registry receptjei, registry-sorrendben', () => {
    expect(artifactKinds()).toEqual(['transcript', 'summary', 'flashcards', 'qa'])
  })
})

describe('scoreDistribution', () => {
  it('tized-sávokba sorol, és a recept küszöbe alattiakat számolja', () => {
    const artifacts = [
      artifact({ itemId: 'a', score: 0.62 }),
      artifact({ itemId: 'b', score: 0.85 }),
      artifact({ itemId: 'c', score: 1 }),
      artifact({ itemId: 'd', score: 0.3, status: 'failed' }),
      artifact({ itemId: 'e', score: 0.5, kind: 'qa' }),
    ]

    const dist = scoreDistribution('summary', artifacts)
    expect(dist.threshold).toBe(0.8)
    expect(dist.buckets).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 1, 1])
    expect([dist.scored, dist.belowThreshold]).toEqual([3, 1])
  })
})

describe('emptyCorpusStatus', () => {
  it('pontosan azt adja, amit egy üres állapottár corpusStatus-a', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-ures-'))
    const items: SourceItem[] = ['youtube', 'meetings', 'youtube'].map((source, i) => ({
      itemId: `i${String(i)}`,
      source,
      sourceFile: `x${String(i)}.srt`,
      subtitlePath: `/s/x${String(i)}.srt`,
      baseName: `x${String(i)}`,
      title: `x${String(i)}`,
      language: null,
      metadata: {},
    }))

    const store = openState(join(dir, 'state.db'))
    expect(emptyCorpusStatus(items)).toEqual(store.corpusStatus(items, 'summary'))
    store.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('queueOverview', () => {
  const SOR = [
    '## youtube',
    '- Első példavideó %%a%%',
    '  - [x] summary',
    '  - [ ] flashcards',
    '  - [x] qa',
    '- Második példavideó %%b%%',
    '  - [x] summary',
    '- Harmadik példavideó %%c%%',
    '  - [x] summary',
    '  - [x] ismeretlen',
    '',
  ].join('\n')

  it('a kipipált párokat az állapottár szerint számolja, registry-sorrendben', () => {
    const artifacts = [
      artifact({ itemId: 'a', kind: 'summary', status: 'done' }),
      artifact({ itemId: 'b', kind: 'summary', status: 'failed' }),
    ]
    expect(queueOverview(SOR, artifacts)).toEqual([
      { recipe: 'summary', checked: 3, done: 1, failed: 1, pending: 1 },
      { recipe: 'qa', checked: 1, done: 0, failed: 0, pending: 1 },
    ])
  })
})

describe('buildOverview', () => {
  const run = (runId: string, status: RunSummaryView['status']): RunSummaryView => ({
    runId,
    status,
    command: null,
    startedAt: null,
    lastEventAt: null,
    durationMs: null,
    units: null,
    estimate: null,
    succeeded: 0,
    failed: 0,
    spentUsd: 0,
    hasReport: false,
    invalid: 0,
  })

  it('csak a futó futásokat emeli ki, és a teljes költést összegzi', () => {
    const overview = buildOverview({
      hasState: true,
      discovered: 2,
      corpus: [],
      artifacts: [
        artifact({ costUsd: 0.01 }),
        artifact({ itemId: 'b', kind: 'transcript', costUsd: null }),
      ],
      queueText: null,
      runs: [run('2026-09-11T09-00-00', 'running'), run('2026-09-10T08-00-00', 'done')],
    })

    expect(overview.running.map((r) => r.runId)).toEqual(['2026-09-11T09-00-00'])
    expect(overview.totalCostUsd).toBe(0.01)
    expect(overview.queue).toBeNull()
    expect(overview.scores.map((s) => s.recipe)).toEqual(['summary', 'flashcards', 'qa'])
  })
})

describe('readOverview', () => {
  let dir: string
  let cfg: Config
  const SRT = '1\n00:00:00,000 --> 00:00:02,000\nEgy szintetikus mondat.\n'

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-overview-'))
    const channel = join(dir, 'feliratok', 'youtube', 'Szintetikus Csatorna')
    await mkdir(channel, { recursive: true })
    const videos = [
      ['szint0001', 'Első példavideó'],
      ['szint0002', 'Második példavideó'],
    ] as const
    for (const [id, title] of videos) {
      await writeFile(
        join(channel, `${title}.info.json`),
        JSON.stringify({
          id,
          title,
          channel: 'Szintetikus Csatorna',
          upload_date: '20260714',
          webpage_url: `https://example.com/${id}`,
        }),
      )
      await writeFile(join(channel, `${title}.en.srt`), SRT)
    }
    cfg = loadConfig(
      {
        vault: { path: join(dir, 'vault') },
        sources: [join(dir, 'feliratok', 'youtube')],
        state: { path: 'state.db' },
        logs: { dir: 'logs' },
      },
      join(dir, 'refinery.config.yaml'),
      dir,
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('állapotfájl nélkül minden felderített elem hátra van', async () => {
    const overview = await readOverview(cfg)
    expect(overview.hasState).toBe(false)
    expect(overview.discovered).toBe(2)
    expect(overview.corpus.map((c) => [c.kind, c.status.pending])).toEqual([
      ['transcript', 2],
      ['summary', 2],
      ['flashcards', 2],
      ['qa', 2],
    ])
    expect(overview.queue).toBeNull()
    expect(overview.running).toEqual([])
  })

  it('az író corpusStatus-át adja, és látszik a sor és a futó futás', async () => {
    const items = await discoverAll(cfg.sources, cfg.languages)
    const store = openState(cfg.statePath)
    for (const item of items) store.recordItem(item)
    store.recordArtifact('szint0001', 'summary', 'done', '/v/a.md', null, {
      iterations: 1,
      score: 0.62,
      costUsd: 0.01,
      model: 'szintetikus-modell',
      gaps: [],
    })
    const expected = store.corpusStatus(items, 'summary')
    store.close()

    await mkdir(cfg.notesRoot, { recursive: true })
    await writeFile(join(cfg.notesRoot, '_queue.md'), '- Első példavideó %%szint0001%%\n  - [x] summary\n')
    await mkdir(cfg.logsDir, { recursive: true })
    await writeFile(
      join(cfg.logsDir, '2026-09-11T09-00-00.jsonl'),
      `${JSON.stringify({ type: 'run:started', command: 'run', pid: 4242 })}\n`,
    )

    const overview = await readOverview(cfg, (pid) => pid === 4242)
    expect(overview.corpus.find((c) => c.kind === 'summary')?.status).toEqual(expected)
    expect(overview.queue).toEqual([{ recipe: 'summary', checked: 1, done: 1, failed: 0, pending: 0 }])
    expect(overview.running.map((r) => r.runId)).toEqual(['2026-09-11T09-00-00'])
    expect(overview.scores[0]).toMatchObject({ recipe: 'summary', scored: 1, belowThreshold: 1 })
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/view/overview.test.ts
```

Várt: FAIL, `Failed to load url ./overview.js`.

- [ ] **3. lépés: Az implementáció**

`src/view/overview.ts`:

```ts
import type { Config } from '../config.js'
import { ARTIFACT_KIND } from '../pipeline.js'
import { queuePath, readQueueFile } from '../queue/file.js'
import { checkedPairs, parseQueue } from '../queue/parse.js'
import { RECIPES, RECIPE_IDS } from '../recipe/registry.js'
import type { KindCorpus } from '../run/report.js'
import { isPidAlive } from '../run/status.js'
import { discoverAll } from '../source/folder.js'
import type { CorpusStatus, SourceStatus } from '../state/db.js'
import type { ArtifactRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'
import type { SourceItem } from '../types.js'
import { readRuns, type RunSummaryView } from './runs.js'

/** A műtermék-típusok a felület sorrendjében: az átirat, majd a registry receptjei. */
export function artifactKinds(): string[] {
  return [ARTIFACT_KIND, ...RECIPE_IDS]
}

/**
 * A korpusz állapota állapotfájl nélkül: minden felderített elem hátra van. Az
 * alakja pontosan az, amit a `corpusStatus` adna egy üres állapottáron.
 */
export function emptyCorpusStatus(items: readonly SourceItem[]): CorpusStatus {
  const bySource = new Map<string, SourceStatus>()
  for (const item of items) {
    const entry = bySource.get(item.source) ?? {
      source: item.source,
      total: 0,
      done: 0,
      failed: 0,
      pending: 0,
    }
    entry.total++
    entry.pending++
    bySource.set(item.source, entry)
  }
  return {
    bySource: [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source)),
    byCaptionSource: { creator: 0, auto: 0 },
    done: 0,
    failed: 0,
    pending: items.length,
    totalCostUsd: 0,
  }
}

/** Egy recept pontszámainak eloszlása. */
export interface ScoreDistribution {
  recipe: string
  /** A recept rubrikájának küszöbe. */
  threshold: number
  /** Tíz sáv: [0; 0,1), [0,1; 0,2), …, [0,9; 1]. */
  buckets: number[]
  /** A pontszámmal rögzített kész jegyzetek száma. */
  scored: number
  belowThreshold: number
}

export function scoreDistribution(
  recipe: string,
  artifacts: readonly ArtifactRow[],
): ScoreDistribution {
  const threshold = RECIPES[recipe]?.rubric.passThreshold ?? 0
  const buckets = Array.from({ length: 10 }, () => 0)
  let scored = 0
  let belowThreshold = 0
  for (const artifact of artifacts) {
    if (artifact.kind !== recipe || artifact.status !== 'done' || artifact.score === null) continue
    scored++
    const index = Math.min(9, Math.floor(artifact.score * 10))
    buckets[index] = (buckets[index] ?? 0) + 1
    if (artifact.score < threshold) belowThreshold++
  }
  return { recipe, threshold, buckets, scored, belowThreshold }
}

/** A feldolgozási sor állapota egy receptre. */
export interface QueueRecipeOverview {
  recipe: string
  checked: number
  done: number
  failed: number
  pending: number
}

/**
 * A kipipált párok állapota receptenként, az állapottár szerint.
 * Registry-sorrendben; a registryben nem szereplő receptek kimaradnak.
 */
export function queueOverview(
  queueText: string,
  artifacts: readonly ArtifactRow[],
): QueueRecipeOverview[] {
  const statusOf = new Map(
    artifacts.map((a) => [JSON.stringify([a.itemId, a.kind]), a.status] as const),
  )
  const rows = new Map<string, QueueRecipeOverview>()
  for (const pair of checkedPairs(parseQueue(queueText))) {
    const row = rows.get(pair.recipeId) ?? {
      recipe: pair.recipeId,
      checked: 0,
      done: 0,
      failed: 0,
      pending: 0,
    }
    row.checked++
    const status = statusOf.get(JSON.stringify([pair.itemId, pair.recipeId]))
    if (status === 'done') row.done++
    else if (status === 'failed') row.failed++
    else row.pending++
    rows.set(pair.recipeId, row)
  }
  return RECIPE_IDS.flatMap((recipe) => {
    const row = rows.get(recipe)
    return row ? [row] : []
  })
}

/** Az áttekintő oldal adatai. */
export interface Overview {
  /** Van-e már állapotfájl. */
  hasState: boolean
  /** A felderített elemek száma. */
  discovered: number
  /** Típusonként a korpusz állapota, az `artifactKinds()` sorrendjében. */
  corpus: KindCorpus[]
  scores: ScoreDistribution[]
  totalCostUsd: number
  /** `null`, ha nincs feldolgozási sor. */
  queue: QueueRecipeOverview[] | null
  /** A most futó futások. */
  running: RunSummaryView[]
}

export interface OverviewInput {
  hasState: boolean
  discovered: number
  corpus: KindCorpus[]
  artifacts: readonly ArtifactRow[]
  queueText: string | null
  runs: readonly RunSummaryView[]
}

export function buildOverview(input: OverviewInput): Overview {
  return {
    hasState: input.hasState,
    discovered: input.discovered,
    corpus: input.corpus,
    scores: RECIPE_IDS.map((recipe) => scoreDistribution(recipe, input.artifacts)),
    totalCostUsd: input.artifacts.reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
    queue: input.queueText === null ? null : queueOverview(input.queueText, input.artifacts),
    running: input.runs.filter((run) => run.status === 'running'),
  }
}

/**
 * Az áttekintő beolvasása: felderítés, állapottár, feldolgozási sor és
 * futásnaplók. A korpusz-állapot ugyanabból a lekérdezésből jön, amiből a futás
 * riportja — a két szám ezért nem térhet el.
 */
export async function readOverview(
  cfg: Pick<Config, 'sources' | 'languages' | 'statePath' | 'notesRoot' | 'logsDir'>,
  isAlive: (pid: number) => boolean = isPidAlive,
): Promise<Overview> {
  const discovered = await discoverAll(cfg.sources, cfg.languages)
  const reader = openStateReader(cfg.statePath)
  try {
    const corpus = artifactKinds().map((kind) => ({
      kind,
      status: reader ? reader.corpusStatus(discovered, kind) : emptyCorpusStatus(discovered),
    }))
    return buildOverview({
      hasState: reader !== null,
      discovered: discovered.length,
      corpus,
      artifacts: reader ? reader.artifacts() : [],
      queueText: await readQueueFile(queuePath(cfg.notesRoot)),
      runs: await readRuns(cfg, isAlive),
    })
  } finally {
    reader?.close()
  }
}
```

- [ ] **4. lépés: Exportok**

A `src/index.ts` végére:

```ts
export {
  artifactKinds,
  buildOverview,
  emptyCorpusStatus,
  queueOverview,
  readOverview,
  scoreDistribution,
  type Overview,
  type OverviewInput,
  type QueueRecipeOverview,
  type ScoreDistribution,
} from './view/overview.js'
export type { KindCorpus } from './run/report.js'
```

- [ ] **5. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/view/overview.test.ts
```

Várt: PASS.

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **7. lépés: Commit**

```bash
git add src/view/overview.ts src/view/overview.test.ts src/index.ts
```

Javasolt üzenet: `feat(view): az áttekintő nézetmodellje`, `Refs #28`.

---

## Feladat 10: Az elemek, az elem és a hibák nézetmodellje

**Fájlok:**
- Létrehoz: `src/view/items.ts`, `src/view/failures.ts`
- Módosít: `src/index.ts`
- Teszt: `src/view/items.test.ts`, `src/view/failures.test.ts`

**Interfészek:**
- Fogyaszt: `loadConfig` `baseDir`-rel (1.); a `gaps` rögzítése (2.);
  `openStateReader`, `ItemRow`, `ArtifactRow` (3.); `artifactKinds` (9.); a meglévő
  `discoverAll`, `RECIPES`.
- Termel:
  - `CellStatus = 'done' | 'failed' | 'pending'`
  - `ItemCell = { status: CellStatus; score: number | null; costUsd: number | null; belowThreshold: boolean }`
  - `ItemListRow = { itemId; title; source; channel: string | null; captionSource: CaptionSource | null; discovered: boolean; updatedAt: string | null; cells: Record<string, ItemCell> }`
  - `buildItemRows(discovered, items, artifacts): ItemListRow[]`, `readItems(cfg): Promise<ItemListRow[]>`
  - `stripFrontmatter(markdown: string): string`
  - `ArtifactDetail`, `ItemDetail`, `readItemDetail(cfg, itemId): Promise<ItemDetail | null>`
  - `FailureGroup = { message; count; items: { itemId; title; kind }[] }`
  - `groupFailures(items, artifacts): FailureGroup[]`, `readFailures(cfg): FailureGroup[]`
  - A 12. feladat útvonalai ezeket hívják.

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/view/items.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { discoverAll } from '../source/folder.js'
import { openState } from '../state/db.js'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import type { SourceItem } from '../types.js'
import { buildItemRows, readItemDetail, stripFrontmatter } from './items.js'

const sourceItem = (itemId: string, title: string, channel?: string): SourceItem => ({
  itemId,
  source: 'youtube',
  sourceFile: `${title}.en.srt`,
  subtitlePath: `/s/${title}.en.srt`,
  baseName: title,
  title,
  language: 'en',
  metadata: channel ? { channel } : {},
})

const itemRow = (itemId: string, title: string): ItemRow => ({
  itemId,
  source: 'youtube',
  sourceFile: `${title}.en.srt`,
  baseName: title,
  title,
  language: 'en',
  channel: 'Régi Csatorna',
  uploadedAt: null,
  url: null,
  discoveredAt: '2026-09-01T00:00:00.000Z',
  captionSource: 'auto',
  wordsRaw: 100,
  wordsNormalized: 40,
})

const artifact = (overrides: Partial<ArtifactRow>): ArtifactRow => ({
  itemId: 'a',
  kind: 'summary',
  status: 'done',
  path: null,
  error: null,
  iterations: 1,
  score: null,
  costUsd: null,
  model: null,
  createdAt: '2026-09-11T09:00:00.000Z',
  ...overrides,
})

describe('buildItemRows', () => {
  it('a felderített elemeket felderítési sorrendben, a csak az állapottárban lévőket utánuk adja', () => {
    const rows = buildItemRows(
      [
        sourceItem('b', 'Második példavideó', 'Szintetikus Csatorna'),
        sourceItem('a', 'Első példavideó'),
      ],
      [itemRow('a', 'Első példavideó'), itemRow('z', 'Eltűnt példavideó')],
      [],
    )

    expect(rows.map((r) => [r.itemId, r.discovered, r.channel])).toEqual([
      ['b', true, 'Szintetikus Csatorna'],
      ['a', true, 'Régi Csatorna'],
      ['z', false, 'Régi Csatorna'],
    ])
    expect(rows[1]!.captionSource).toBe('auto')
  })

  it('típusonként állapotcellát ad, a küszöb alattiak jelölésével', () => {
    const [row] = buildItemRows(
      [sourceItem('a', 'Első példavideó')],
      [],
      [
        artifact({ kind: 'transcript', createdAt: '2026-09-11T08:00:00.000Z' }),
        artifact({ kind: 'summary', score: 0.62, costUsd: 0.01 }),
        artifact({ kind: 'qa', status: 'failed', createdAt: '2026-09-11T10:00:00.000Z' }),
      ],
    )

    expect(row!.cells).toEqual({
      transcript: { status: 'done', score: null, costUsd: null, belowThreshold: false },
      summary: { status: 'done', score: 0.62, costUsd: 0.01, belowThreshold: true },
      flashcards: { status: 'pending', score: null, costUsd: null, belowThreshold: false },
      qa: { status: 'failed', score: null, costUsd: null, belowThreshold: false },
    })
    expect(row!.updatedAt).toBe('2026-09-11T10:00:00.000Z')
  })
})

describe('stripFrontmatter', () => {
  it('levágja a frontmattert, a törzset meghagyja', () => {
    expect(stripFrontmatter('---\nitem_id: a\ntitle: x\n---\n# Cím\n\nSzöveg.\n')).toBe(
      '# Cím\n\nSzöveg.\n',
    )
  })

  it('a frontmatter nélküli szöveget változatlanul adja', () => {
    expect(stripFrontmatter('# Cím\n\n---\n\nSzöveg.\n')).toBe('# Cím\n\n---\n\nSzöveg.\n')
  })
})

describe('readItemDetail', () => {
  let dir: string
  let cfg: Config
  let noteDir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-item-'))
    const channel = join(dir, 'feliratok', 'youtube', 'Szintetikus Csatorna')
    await mkdir(channel, { recursive: true })
    await writeFile(
      join(channel, 'Első példavideó.info.json'),
      JSON.stringify({
        id: 'szint0001',
        title: 'Első példavideó',
        channel: 'Szintetikus Csatorna',
        upload_date: '20260714',
        webpage_url: 'https://example.com/szint0001',
      }),
    )
    await writeFile(
      join(channel, 'Első példavideó.en.srt'),
      '1\n00:00:00,000 --> 00:00:02,000\nEgy szintetikus mondat.\n',
    )
    cfg = loadConfig(
      {
        vault: { path: join(dir, 'vault') },
        sources: [join(dir, 'feliratok', 'youtube')],
        state: { path: 'state.db' },
        logs: { dir: 'logs' },
      },
      join(dir, 'refinery.config.yaml'),
      dir,
    )
    noteDir = join(cfg.notesRoot, 'youtube', 'Szintetikus Csatorna')
    await mkdir(noteDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('ismeretlen elemre null', async () => {
    expect(await readItemDetail(cfg, 'nincs-ilyen')).toBeNull()
  })

  it('a felderített, de fel nem dolgozott elemre műtermék nélküli részletet ad', async () => {
    const detail = await readItemDetail(cfg, 'szint0001')
    expect(detail?.item).toMatchObject({
      title: 'Első példavideó',
      channel: 'Szintetikus Csatorna',
      discovered: true,
    })
    expect(detail?.artifacts).toEqual([])
  })

  it('a jegyzetek törzsét, a hiánylistát, a hibát és a hiányzó fájlt is jelzi', async () => {
    const [item] = await discoverAll(cfg.sources, cfg.languages)
    const transcript = join(noteDir, 'Első példavideó_transcript.md')
    await writeFile(
      transcript,
      '---\nitem_id: szint0001\n---\n# Első példavideó\n\nEgy szintetikus mondat.\n',
    )
    const store = openState(cfg.statePath)
    store.recordItem(item!)
    store.recordTranscript('szint0001', 'creator', 3, 3)
    store.recordArtifact('szint0001', 'transcript', 'done', transcript, null)
    store.recordArtifact('szint0001', 'summary', 'done', join(noteDir, 'nincs_summary.md'), null, {
      iterations: 1,
      score: 0.62,
      costUsd: 0.01,
      model: 'szintetikus-modell',
      gaps: ['kimaradt: a zárás'],
    })
    store.recordArtifact('szint0001', 'qa', 'failed', null, 'szintetikus hiba')
    store.close()

    const detail = await readItemDetail(cfg, 'szint0001')
    expect(detail?.item.captionSource).toBe('creator')
    expect(detail?.artifacts.map((a) => [a.kind, a.status])).toEqual([
      ['transcript', 'done'],
      ['summary', 'done'],
      ['qa', 'failed'],
    ])
    const [t, s, q] = detail!.artifacts
    expect([t!.body, t!.gaps]).toEqual(['# Első példavideó\n\nEgy szintetikus mondat.\n', null])
    expect([s!.body, s!.missingFile, s!.gaps, s!.threshold]).toEqual([
      null,
      true,
      ['kimaradt: a zárás'],
      0.8,
    ])
    expect([q!.error, q!.missingFile]).toEqual(['szintetikus hiba', false])
  })
})
```

`src/view/failures.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import { groupFailures, readFailures } from './failures.js'

const itemRow = (itemId: string, title: string): ItemRow => ({
  itemId,
  source: 'youtube',
  sourceFile: `${title}.en.srt`,
  baseName: title,
  title,
  language: 'en',
  channel: null,
  uploadedAt: null,
  url: null,
  discoveredAt: '2026-09-01T00:00:00.000Z',
  captionSource: null,
  wordsRaw: null,
  wordsNormalized: null,
})

const failed = (itemId: string, kind: string, error: string): ArtifactRow => ({
  itemId,
  kind,
  status: 'failed',
  path: null,
  error,
  iterations: null,
  score: null,
  costUsd: null,
  model: null,
  createdAt: '2026-09-11T09:00:00.000Z',
})

describe('groupFailures', () => {
  it('a hibaüzenet első sora szerint csoportosít, a nagyobb csoport elöl', () => {
    const items = [itemRow('a', 'Első példavideó'), itemRow('b', 'Második példavideó')]
    const wikilink = 'a jegyzet megsérti a vault írási szabályait: wikilink tiltott'

    const groups = groupFailures(items, [
      failed('b', 'qa', `${wikilink}\nrészletek`),
      failed('a', 'summary', wikilink),
      failed('a', 'qa', 'sebességkorlát'),
      { ...failed('b', 'summary', ''), status: 'done', error: null },
    ])

    expect(groups).toEqual([
      {
        message: wikilink,
        count: 2,
        items: [
          { itemId: 'a', title: 'Első példavideó', kind: 'summary' },
          { itemId: 'b', title: 'Második példavideó', kind: 'qa' },
        ],
      },
      {
        message: 'sebességkorlát',
        count: 1,
        items: [{ itemId: 'a', title: 'Első példavideó', kind: 'qa' }],
      },
    ])
  })
})

describe('readFailures', () => {
  it('állapotfájl nélkül üres listát ad', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-failures-'))
    expect(readFailures({ statePath: join(dir, 'nincs.db') })).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/view/items.test.ts src/view/failures.test.ts
```

Várt: FAIL — a két modul még nincs.

- [ ] **3. lépés: Az elemek és az elem**

`src/view/items.ts`:

```ts
import { readFile } from 'node:fs/promises'
import type { Config } from '../config.js'
import { RECIPES } from '../recipe/registry.js'
import { discoverAll } from '../source/folder.js'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'
import type { CaptionSource, SourceItem } from '../types.js'
import { artifactKinds } from './overview.js'

export type CellStatus = 'done' | 'failed' | 'pending'

/** Egy elem egy műtermék-típusának állapota a listában. */
export interface ItemCell {
  status: CellStatus
  score: number | null
  costUsd: number | null
  /** Kész, pontozott, és a recept küszöbe alatt maradt. */
  belowThreshold: boolean
}

export interface ItemListRow {
  itemId: string
  title: string
  source: string
  channel: string | null
  captionSource: CaptionSource | null
  /** Megvan-e még a felirat a forrásmappában. */
  discovered: boolean
  /** A legutóbbi műtermék-rögzítés ideje. */
  updatedAt: string | null
  /** Műtermék-típusonként egy cella, az `artifactKinds()` kulcsaival. */
  cells: Record<string, ItemCell>
}

function cellStatus(status: string | undefined): CellStatus {
  return status === 'done' || status === 'failed' ? status : 'pending'
}

function thresholdOf(kind: string): number | null {
  return RECIPES[kind]?.rubric.passThreshold ?? null
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Az elemlista: a felderített elemek felderítési sorrendben, utánuk azok, amelyek
 * csak az állapottárban vannak (a feliratuk azóta eltűnt), cím szerint.
 */
export function buildItemRows(
  discovered: readonly SourceItem[],
  items: readonly ItemRow[],
  artifacts: readonly ArtifactRow[],
): ItemListRow[] {
  const rowOf = new Map(items.map((row) => [row.itemId, row] as const))
  const artifactsOf = new Map<string, ArtifactRow[]>()
  for (const artifact of artifacts) {
    const list = artifactsOf.get(artifact.itemId) ?? []
    list.push(artifact)
    artifactsOf.set(artifact.itemId, list)
  }
  const kinds = artifactKinds()

  const toRow = (
    itemId: string,
    title: string,
    source: string,
    channel: string | null,
    isDiscovered: boolean,
  ): ItemListRow => {
    const own = artifactsOf.get(itemId) ?? []
    const cells: Record<string, ItemCell> = {}
    for (const kind of kinds) {
      const artifact = own.find((a) => a.kind === kind)
      const status = cellStatus(artifact?.status)
      const score = artifact?.score ?? null
      const threshold = thresholdOf(kind)
      cells[kind] = {
        status,
        score,
        costUsd: artifact?.costUsd ?? null,
        belowThreshold: status === 'done' && threshold !== null && score !== null && score < threshold,
      }
    }
    const times = own.map((a) => a.createdAt).sort()
    return {
      itemId,
      title,
      source,
      channel,
      captionSource: rowOf.get(itemId)?.captionSource ?? null,
      discovered: isDiscovered,
      updatedAt: times.at(-1) ?? null,
      cells,
    }
  }

  const seen = new Set<string>()
  const rows = discovered.map((item) => {
    seen.add(item.itemId)
    const channel = item.metadata.channel ?? rowOf.get(item.itemId)?.channel ?? null
    return toRow(item.itemId, item.title, item.source, channel, true)
  })
  const missing = items
    .filter((row) => !seen.has(row.itemId))
    .sort((a, b) => byText(a.title, b.title))
    .map((row) => toRow(row.itemId, row.title, row.source, row.channel, false))
  return [...rows, ...missing]
}

export async function readItems(
  cfg: Pick<Config, 'sources' | 'languages' | 'statePath'>,
): Promise<ItemListRow[]> {
  const discovered = await discoverAll(cfg.sources, cfg.languages)
  const reader = openStateReader(cfg.statePath)
  try {
    return buildItemRows(discovered, reader?.items() ?? [], reader?.artifacts() ?? [])
  } finally {
    reader?.close()
  }
}

/** A jegyzet törzse a YAML-frontmatter nélkül; frontmatter nélküli szöveget változatlanul ad. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

/** Egy rögzített műtermék az elem oldalán. */
export interface ArtifactDetail {
  kind: string
  status: CellStatus
  path: string | null
  error: string | null
  iterations: number | null
  score: number | null
  costUsd: number | null
  model: string | null
  createdAt: string
  /** A recept küszöbe; az átiratnál `null`. */
  threshold: number | null
  /** A bíró hiánylistája; `null`, ha nincs rögzítve. */
  gaps: string[] | null
  /** A jegyzet Markdown-törzse frontmatter nélkül; `null`, ha nincs fájl. */
  body: string | null
  /** Az állapottár szerint kész, de a fájl nem található. */
  missingFile: boolean
}

export interface ItemDetail {
  item: {
    itemId: string
    title: string
    source: string
    sourceFile: string | null
    channel: string | null
    url: string | null
    uploadedAt: string | null
    captionSource: CaptionSource | null
    wordsRaw: number | null
    wordsNormalized: number | null
    /** Megvan-e még a felirat a forrásmappában. */
    discovered: boolean
  }
  /** A rögzített műtermékek, az `artifactKinds()` sorrendjében. */
  artifacts: ArtifactDetail[]
}

async function readNote(path: string | null): Promise<{ body: string | null; missing: boolean }> {
  if (path === null) return { body: null, missing: false }
  try {
    return { body: stripFrontmatter(await readFile(path, 'utf8')), missing: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { body: null, missing: true }
    throw error
  }
}

/**
 * Egy elem minden adata az elem oldalához. Jegyzetfájlt kizárólag az
 * állapottárban rögzített útról olvas — soha nem a kérésből kapott értékből.
 * Ismeretlen elemre `null`.
 */
export async function readItemDetail(
  cfg: Pick<Config, 'sources' | 'languages' | 'statePath'>,
  itemId: string,
): Promise<ItemDetail | null> {
  const discovered = (await discoverAll(cfg.sources, cfg.languages)).find(
    (item) => item.itemId === itemId,
  )
  const reader = openStateReader(cfg.statePath)
  try {
    const row = reader?.items().find((item) => item.itemId === itemId)
    if (!discovered && !row) return null

    const own = (reader?.artifacts() ?? []).filter((a) => a.itemId === itemId)
    const artifacts: ArtifactDetail[] = []
    for (const kind of artifactKinds()) {
      const artifact = own.find((a) => a.kind === kind)
      if (!artifact) continue
      const status = cellStatus(artifact.status)
      const note =
        status === 'done' ? await readNote(artifact.path) : { body: null, missing: false }
      artifacts.push({
        kind,
        status,
        path: artifact.path,
        error: artifact.error,
        iterations: artifact.iterations,
        score: artifact.score,
        costUsd: artifact.costUsd,
        model: artifact.model,
        createdAt: artifact.createdAt,
        threshold: thresholdOf(kind),
        gaps: reader?.gapsOf(itemId, kind) ?? null,
        body: note.body,
        missingFile: note.missing,
      })
    }

    return {
      item: {
        itemId,
        title: discovered?.title ?? row?.title ?? itemId,
        source: discovered?.source ?? row?.source ?? '',
        sourceFile: discovered?.sourceFile ?? row?.sourceFile ?? null,
        channel: discovered?.metadata.channel ?? row?.channel ?? null,
        url: discovered?.metadata.url ?? row?.url ?? null,
        uploadedAt: discovered?.metadata.uploadedAt ?? row?.uploadedAt ?? null,
        captionSource: row?.captionSource ?? null,
        wordsRaw: row?.wordsRaw ?? null,
        wordsNormalized: row?.wordsNormalized ?? null,
        discovered: discovered !== undefined,
      },
      artifacts,
    }
  } finally {
    reader?.close()
  }
}
```

- [ ] **4. lépés: A hibák**

`src/view/failures.ts`:

```ts
import type { Config } from '../config.js'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'

export interface FailureGroup {
  /** A hibaüzenet első sora: egy rendszeres hiba így egy csoport, nem húsz sor. */
  message: string
  count: number
  items: { itemId: string; title: string; kind: string }[]
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** A hibás műtermékek csoportjai: a nagyobb csoport elöl, azon belül cím szerint. */
export function groupFailures(
  items: readonly ItemRow[],
  artifacts: readonly ArtifactRow[],
): FailureGroup[] {
  const titleOf = new Map(items.map((row) => [row.itemId, row.title] as const))
  const groups = new Map<string, FailureGroup>()
  for (const artifact of artifacts) {
    if (artifact.status !== 'failed') continue
    const message = (artifact.error ?? 'ismeretlen hiba').split('\n')[0]!.trim()
    const group = groups.get(message) ?? { message, count: 0, items: [] }
    group.count++
    group.items.push({
      itemId: artifact.itemId,
      title: titleOf.get(artifact.itemId) ?? artifact.itemId,
      kind: artifact.kind,
    })
    groups.set(message, group)
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => byText(a.title, b.title) || byText(a.kind, b.kind))
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || byText(a.message, b.message))
}

export function readFailures(cfg: Pick<Config, 'statePath'>): FailureGroup[] {
  const reader = openStateReader(cfg.statePath)
  if (!reader) return []
  try {
    return groupFailures(reader.items(), reader.artifacts())
  } finally {
    reader.close()
  }
}
```

- [ ] **5. lépés: Exportok**

A `src/index.ts` végére:

```ts
export {
  buildItemRows,
  readItemDetail,
  readItems,
  stripFrontmatter,
  type ArtifactDetail,
  type CellStatus,
  type ItemCell,
  type ItemDetail,
  type ItemListRow,
} from './view/items.js'
export { groupFailures, readFailures, type FailureGroup } from './view/failures.js'
```

- [ ] **6. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/view
```

Várt: PASS.

- [ ] **7. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **8. lépés: Commit**

```bash
git add src/view/items.ts src/view/items.test.ts src/view/failures.ts src/view/failures.test.ts src/index.ts
```

Javasolt üzenet: `feat(view): az elemek, az elem és a hibák nézetmodellje`, `Refs #28`.

---

## Feladat 11: A `web/` állvány és az áttekintő API

**Fájlok:**
- Módosít: `pnpm-workspace.yaml`, `package.json`, `eslint.config.js`, `.gitignore`,
  `pnpm-lock.yaml` (az install írja)
- Létrehoz: `web/package.json`, `web/nuxt.config.ts`, `web/tsconfig.json`,
  `web/eslint.config.mjs`, `web/vitest.config.ts`, `web/app/app.vue`,
  `web/app/assets/css/main.css`, `web/app/pages/index.vue` (ideiglenes, a 14.
  feladat cseréli), `web/server/utils/refinery.ts`, `web/server/api/overview.get.ts`
- Teszt: `web/test/e2e/fixture.ts`, `web/test/e2e/api.test.ts`, `web/test/e2e/errors.test.ts`

**Interfészek:**
- Fogyaszt: `loadConfig` `baseDir`-rel (1.); `readOverview`, `Overview` (9.); a
  meglévő `CONFIG_FILENAME`, `readConfigFile`, `openState`, `discoverAll`.
- Termel:
  - `useRefineryConfig(): Promise<Config>` és
    `coreHandler<T>(run: (cfg: Config) => T | Promise<T>): Promise<T>` a
    `web/server/utils/refinery.ts`-ben — a Nitro auto-importálja
  - `GET /api/overview` → `Overview`
  - `createFixture(): Promise<Fixture>`, `FINISHED_RUN`, `RUNNING_RUN` a
    `web/test/e2e/fixture.ts`-ben
  - az `api.test.ts` egyetlen `describe('API', …)` blokkja — a 12–14. feladat
    ebbe fűzi az `it`-jeit

- [ ] **1. lépés: A workspace és a gyökér**

`pnpm-workspace.yaml` teljes tartalma:

```yaml
packages:
  - web

allowBuilds:
  better-sqlite3: true
  esbuild: true
  unrs-resolver: false
  vue-demi: false

overrides:
  better-sqlite3: ^13.0.3
```

A gyökér `package.json`-ban a `"bin"` blokk után vedd fel:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
```

és a `"scripts"` végére, a `"release": "bumpp"` után (vesszővel):

```json
    "web": "pnpm build && pnpm --filter transcript-refinery-web build && pnpm --filter transcript-refinery-web start",
    "web:dev": "pnpm build && pnpm --filter transcript-refinery-web dev",
    "web:test": "pnpm build && pnpm --filter transcript-refinery-web test",
    "web:typecheck": "pnpm build && pnpm --filter transcript-refinery-web typecheck",
    "web:lint": "pnpm --filter transcript-refinery-web lint"
```

Az `eslint.config.js`-ben cseréld le ezt:

```js
  { ignores: ['dist/', 'coverage/', '.state/'] },
```

erre:

```js
  { ignores: ['dist/', 'coverage/', '.state/', 'web/'] },
```

A `.gitignore`-ban a `.output/` sor után vedd fel:

```
.nuxt/
```

- [ ] **2. lépés: A `web/` csomag**

`web/package.json`:

```json
{
  "name": "transcript-refinery-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev --host 127.0.0.1 --port 4310",
    "build": "nuxt build",
    "start": "NITRO_HOST=127.0.0.1 NITRO_PORT=${NITRO_PORT:-4310} node .output/server/index.mjs",
    "test": "vitest run",
    "typecheck": "nuxt typecheck",
    "lint": "eslint .",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "@iconify-json/lucide": "^1.2.131",
    "@nuxt/ui": "^4.11.1",
    "markdown-it": "^15.0.2",
    "nuxt": "^4.5.2",
    "tailwindcss": "^4.3.3",
    "transcript-refinery": "workspace:*",
    "vue": "^3.5.40",
    "vue-router": "^5.2.0"
  },
  "devDependencies": {
    "@nuxt/eslint": "^1.17.0",
    "@nuxt/test-utils": "^4.3.2",
    "@types/markdown-it": "^14.2.0",
    "eslint": "^10.9.1",
    "typescript": "^5.9.0",
    "vitest": "^4.1.11",
    "vue-tsc": "^3.3.11"
  }
}
```

`web/nuxt.config.ts`:

```ts
import { fileURLToPath } from 'node:url'

// A repó gyökere: a `web/` szülőmappája. Build-időben rögzül, így a szerver a
// munkakönyvtártól függetlenül ugyanazt a konfigurációt és állapottárat látja,
// mint a gyökérből futtatott CLI.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-09-11',
  modules: ['@nuxt/ui', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  telemetry: false,
  // A felület kifelé nem hív: font nem töltődik le, az ikonok a helyi
  // `@iconify-json/lucide` csomagból jönnek.
  ui: { fonts: false },
  runtimeConfig: { refineryRoot: repoRoot },
  // A `node:sqlite` Node-beépített modul: külsőként jelölve a build nem
  // figyelmeztet rá.
  nitro: { rollupConfig: { external: ['node:sqlite'] } },
})
```

`web/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

`web/eslint.config.mjs`:

```js
// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt()
```

`web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Minden e2e-tesztfájl saját szervert fordít és indít: egymás után futnak.
    fileParallelism: false,
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
})
```

`web/app/assets/css/main.css`:

```css
@import "tailwindcss";
@import "@nuxt/ui";
```

`web/app/app.vue`:

```vue
<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
```

`web/app/pages/index.vue` (ideiglenes):

```vue
<template>
  <UContainer class="py-6">
    <h1 class="text-2xl font-semibold">Transcript Refinery</h1>
  </UContainer>
</template>
```

- [ ] **3. lépés: Telepítés**

```bash
mise exec -- pnpm install
```

Várt: sikeres install, a végén `web postinstall$ nuxt prepare` és
`Types generated in .nuxt`.

- Ha `ERR_PNPM_IGNORED_BUILDS` jön, és a `pnpm-workspace.yaml`-ben új
  `set this to true or false` helykitöltő jelent meg: **cseréld le** `false`-ra
  (ne írj mellé új kulcsot), és futtasd újra.
- Ha a pnpm `minimumReleaseAgeExclude` bejegyzést írt a fájlba, hagyd benne.

Ellenőrizd a kötést:

```bash
ls -la web/node_modules/transcript-refinery
```

Várt: `web/node_modules/transcript-refinery -> ../..`

- [ ] **4. lépés: Írd meg a bukó teszteket**

`web/test/e2e/fixture.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverAll, openState } from 'transcript-refinery'

/** Egy lezárt futás riporttal, és egy „futó", aminek a pid-je a tesztfolyamaté. */
export const FINISHED_RUN = '2026-09-10T08-00-00'
export const RUNNING_RUN = '2026-09-11T09-00-00'

export interface Fixture {
  root: string
  configPath: string
  runningLog: string
  summaryNote: string
}

const SRT = [
  '1',
  '00:00:00,000 --> 00:00:02,000',
  'Ez az első szintetikus mondat.',
  '',
  '2',
  '00:00:02,000 --> 00:00:04,000',
  'Ez a második szintetikus mondat.',
  '',
].join('\n')

const line = (value: object): string => `${JSON.stringify(value)}\n`

async function video(dir: string, id: string, title: string): Promise<void> {
  await writeFile(
    join(dir, `${title}.info.json`),
    JSON.stringify({
      id,
      title,
      channel: 'Szintetikus Csatorna',
      upload_date: '20260714',
      webpage_url: `https://example.com/${id}`,
    }),
    'utf8',
  )
  await writeFile(join(dir, `${title}.en.srt`), SRT, 'utf8')
}

/**
 * Szintetikus környezet a felület e2e-tesztjeihez: feliratmappa két videóval,
 * vault két jegyzettel és feldolgozási sorral, állapottár, két futásnapló és a
 * konfigurációs fájl — mind egy ideiglenes mappában, abszolút útvonalakkal.
 */
export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'refinery-web-'))

  const sources = join(root, 'feliratok', 'youtube')
  const channel = join(sources, 'Szintetikus Csatorna')
  await mkdir(channel, { recursive: true })
  await video(channel, 'szint0001', 'Első példavideó')
  await video(channel, 'szint0002', 'Második példavideó')

  const vault = join(root, 'vault')
  const notesRoot = join(vault, 'Inbox', 'transcript-refinery')
  const noteDir = join(notesRoot, 'youtube', 'Szintetikus Csatorna')
  await mkdir(noteDir, { recursive: true })
  const transcriptNote = join(noteDir, 'Első példavideó_transcript.md')
  const summaryNote = join(noteDir, 'Első példavideó_summary.md')
  await writeFile(
    transcriptNote,
    [
      '---',
      'item_id: szint0001',
      '---',
      '# Első példavideó',
      '',
      'Ez az első szintetikus mondat. Ez a második szintetikus mondat.',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    summaryNote,
    [
      '---',
      'item_id: szint0001',
      'recipe: summary',
      '---',
      '## Összefoglaló',
      '',
      'Egy szintetikus pont.',
      '',
      '<script>alert(1)</script>',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    join(notesRoot, '_queue.md'),
    [
      '## youtube/Szintetikus Csatorna',
      '- Első példavideó %%szint0001%%',
      '  - [x] summary',
      '  - [ ] flashcards',
      '  - [ ] qa',
      '- Második példavideó %%szint0002%%',
      '  - [ ] summary',
      '',
    ].join('\n'),
    'utf8',
  )

  const statePath = join(root, 'state.db')
  const items = await discoverAll([{ name: 'youtube', path: sources }], ['en'])
  const first = items.find((item) => item.itemId === 'szint0001')
  if (!first) throw new Error('a szintetikus videó felderítése nem sikerült')
  const store = openState(statePath)
  store.recordItem(first)
  store.recordTranscript('szint0001', 'creator', 12, 10)
  store.recordArtifact('szint0001', 'transcript', 'done', transcriptNote, null)
  store.recordArtifact('szint0001', 'summary', 'done', summaryNote, null, {
    iterations: 1,
    score: 0.62,
    costUsd: 0.0123,
    model: 'szintetikus-modell',
    gaps: ['kimaradt: a zárás'],
  })
  store.recordArtifact(
    'szint0001',
    'qa',
    'failed',
    null,
    'a jegyzet megsérti a vault írási szabályait: wikilink tiltott',
  )
  store.close()

  const logs = join(root, 'logs')
  await mkdir(logs, { recursive: true })
  await writeFile(
    join(logs, `${FINISHED_RUN}.jsonl`),
    [
      line({ at: '2026-09-10T08:00:00.000Z', type: 'run:started', command: 'run --recipe summary', pid: 999_999 }),
      line({ at: '2026-09-10T08:00:01.000Z', type: 'scan:found', count: 1 }),
      line({ at: '2026-09-10T08:00:02.000Z', type: 'item:start', itemId: 'szint0001', title: 'Első példavideó' }),
      line({
        at: '2026-09-10T08:00:03.000Z',
        type: 'item:normalized',
        itemId: 'szint0001',
        wordsRaw: 12,
        wordsNormalized: 10,
        captionSource: 'creator',
      }),
      line({
        at: '2026-09-10T08:00:05.000Z',
        type: 'item:refined',
        itemId: 'szint0001',
        recipe: 'summary',
        score: 0.62,
        generations: 1,
        usd: 0.0123,
      }),
      line({ at: '2026-09-10T08:00:05.100Z', type: 'item:published', itemId: 'szint0001', path: summaryNote }),
      line({ at: '2026-09-10T08:00:06.000Z', type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }),
      line({ at: '2026-09-10T08:00:06.100Z', type: 'run:ended', interrupted: false }),
    ].join(''),
    'utf8',
  )
  await writeFile(join(logs, `${FINISHED_RUN}.md`), '# Futás\n\n| sikeres | 1 |\n', 'utf8')
  const runningLog = join(logs, `${RUNNING_RUN}.jsonl`)
  await writeFile(
    runningLog,
    [
      line({ at: new Date().toISOString(), type: 'run:started', command: 'run --queue', pid: process.pid }),
      line({ at: new Date().toISOString(), type: 'scan:found', count: 1 }),
    ].join(''),
    'utf8',
  )

  const configPath = join(root, 'refinery.config.yaml')
  await writeFile(
    configPath,
    [
      'vault:',
      `  path: ${JSON.stringify(vault)}`,
      'sources:',
      `  - ${JSON.stringify(sources)}`,
      'languages: [en]',
      'state:',
      `  path: ${JSON.stringify(statePath)}`,
      'logs:',
      `  dir: ${JSON.stringify(logs)}`,
      '',
    ].join('\n'),
    'utf8',
  )

  return { root, configPath, runningLog, summaryNote }
}
```

`web/test/e2e/api.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import type { Overview } from 'transcript-refinery'
import { RUNNING_RUN, createFixture } from './fixture'

const fixture = await createFixture()

// Egyetlen `setup()` a fájlban: egy második `describe` saját `setup`-pal az egész
// fájlt elrontaná. A későbbi feladatok tesztjei ebbe a blokkba kerülnek.
describe('API', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    env: { REFINERY_CONFIG: fixture.configPath },
    setupTimeout: 300_000,
  })

  it('az áttekintő a szintetikus állapotot adja', async () => {
    const overview = await $fetch<Overview>('/api/overview')
    expect(overview.hasState).toBe(true)
    expect(overview.discovered).toBe(2)
    expect(overview.corpus.find((c) => c.kind === 'summary')?.status).toMatchObject({
      done: 1,
      failed: 0,
      pending: 1,
    })
    expect(overview.scores.find((s) => s.recipe === 'summary')).toMatchObject({
      scored: 1,
      belowThreshold: 1,
    })
    expect(overview.queue).toEqual([
      { recipe: 'summary', checked: 1, done: 1, failed: 0, pending: 0 },
    ])
    expect(overview.running.map((r) => r.runId)).toEqual([RUNNING_RUN])
    expect(overview.totalCostUsd).toBeCloseTo(0.0123, 10)
  })
})
```

`web/test/e2e/errors.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'

// Más környezet — hiányzó konfigurációs fájl —, ezért külön fájl, saját `setup()`-pal.
describe('API — hiányzó konfiguráció', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    env: { REFINERY_CONFIG: '/nem/letezo/refinery.config.yaml' },
    setupTimeout: 300_000,
  })

  it('az áttekintő 500-as válasza a konfigurációs hibát nevezi meg', async () => {
    const error = await $fetch('/api/overview').catch((e: unknown) => e)
    expect((error as { statusCode?: number }).statusCode).toBe(500)
    expect((error as { data?: { message?: string } }).data?.message).toContain(
      'Nincs konfigurációs fájl: /nem/letezo/refinery.config.yaml',
    )
  })
})
```

- [ ] **5. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm web:test
```

Várt: FAIL, 2 teszt — az `/api/overview` még nincs, mindkét hívás 404-et kap.

- [ ] **6. lépés: A szerveroldali segédek és az útvonal**

`web/server/utils/refinery.ts`:

```ts
import { join } from 'node:path'
import { CONFIG_FILENAME, loadConfig, readConfigFile, type Config } from 'transcript-refinery'

/**
 * A konfiguráció, ahogy a gyökérből futtatott CLI is látja. A repó gyökere
 * build-időben rögzül (`nuxt.config.ts`); a fájl helyét a `REFINERY_CONFIG`
 * felülírhatja — a CLI `--config` kapcsolójának megfelelője. Beállítási értéket
 * környezeti változó nem ír felül.
 */
export async function useRefineryConfig(): Promise<Config> {
  const root = String(useRuntimeConfig().refineryRoot)
  const configPath = process.env.REFINERY_CONFIG ?? join(root, CONFIG_FILENAME)
  try {
    return loadConfig(await readConfigFile(configPath), configPath, root)
  } catch (error) {
    throw createError({ statusCode: 500, message: (error as Error).message })
  }
}

/**
 * Egy API-útvonal törzse: konfiguráció, a mag egy függvénye, és a mag hibája
 * olvasható 500-as válaszként. A már HTTP-hibaként dobott kivétel (például a
 * 404) változatlanul megy tovább.
 */
export async function coreHandler<T>(run: (cfg: Config) => T | Promise<T>): Promise<T> {
  const cfg = await useRefineryConfig()
  try {
    return await run(cfg)
  } catch (error) {
    if (typeof (error as { statusCode?: unknown }).statusCode === 'number') throw error
    throw createError({ statusCode: 500, message: (error as Error).message })
  }
}
```

`web/server/api/overview.get.ts`:

```ts
import { readOverview } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readOverview(cfg)))
```

- [ ] **7. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm web:test
```

Várt: PASS, 2 tesztfájl, 2 teszt.

- [ ] **8. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
mise exec -- pnpm web:typecheck && mise exec -- pnpm web:lint
```

Várt: mind zöld; a gyökér ESLintje a `web/`-et kihagyja, a gyökér tesztjei
változatlanok.

- [ ] **9. lépés: A cím ellenőrzése — 1. sikerkritérium**

A gyökérben lévő, valódi `refinery.config.yaml`-lel (a felület csak olvas):

```bash
mise exec -- pnpm web &
curl -s --retry 300 --retry-connrefused --retry-delay 1 -o /dev/null -w "127.0.0.1: %{http_code}\n" http://127.0.0.1:4310/api/overview
IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
curl -s --max-time 3 -o /dev/null "http://$IP:4310/api/overview" && echo "hálózati cím: VÁLASZOL — HIBA" || echo "hálózati cím: nem válaszol — helyes"
pkill -f ".output/server/index.mjs"
```

Várt: `127.0.0.1: 200` és `hálózati cím: nem válaszol — helyes`.

- [ ] **10. lépés: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml package.json eslint.config.js .gitignore web/
git status --short
```

A `git status`-ban nem szerepelhet `web/.nuxt`, `web/.output` vagy
`web/node_modules`.

Javasolt üzenet: `feat(web): a Nuxt-felület állványa és az áttekintő API`, `Refs #28`.

---

## Feladat 12: Az elemek, az elem és a hibák API-ja

**Fájlok:**
- Létrehoz: `web/server/utils/markdown.ts`, `web/server/api/items/index.get.ts`,
  `web/server/api/items/[itemId].get.ts`, `web/server/api/failures.get.ts`
- Teszt: `web/test/e2e/api.test.ts`

**Interfészek:**
- Fogyaszt: `readItems`, `readItemDetail`, `readFailures`, `ItemListRow`,
  `ItemDetail`, `ArtifactDetail`, `FailureGroup` (10.); `coreHandler` és a
  fixture (11.).
- Termel:
  - `renderMarkdown(source: string): string` — `web/server/utils/markdown.ts`, auto-importált
  - `GET /api/items` → `ItemListRow[]`
  - `GET /api/items/[itemId]` → `ItemDetail`, műtermékenként `html: string | null` és `obsidianUrl: string | null` mezővel; ismeretlen elemre 404
  - `GET /api/failures` → `FailureGroup[]`
  - A 13. feladat a `renderMarkdown`-t, a 14. feladat oldalai ezeket az útvonalakat használják.

- [ ] **1. lépés: Írd meg a bukó teszteket**

A `web/test/e2e/api.test.ts` importjait cseréld le erre:

```ts
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import type {
  ArtifactDetail,
  FailureGroup,
  ItemDetail,
  ItemListRow,
  Overview,
} from 'transcript-refinery'
import { RUNNING_RUN, createFixture } from './fixture'

type ItemResponse = Omit<ItemDetail, 'artifacts'> & {
  artifacts: (ArtifactDetail & { html: string | null; obsidianUrl: string | null })[]
}
```

és a `describe('API', …)` blokk végére, a záró `})` elé illeszd be:

```ts
  it('az elemlista a felderített elemeket adja, típusonkénti cellákkal', async () => {
    const rows = await $fetch<ItemListRow[]>('/api/items')
    expect(rows.map((row) => row.itemId)).toEqual(['szint0001', 'szint0002'])
    expect(rows[0]?.cells.summary).toEqual({
      status: 'done',
      score: 0.62,
      costUsd: 0.0123,
      belowThreshold: true,
    })
    expect(rows[0]?.cells.qa?.status).toBe('failed')
    expect(rows[1]?.cells.summary?.status).toBe('pending')
  })

  it('az elem oldala a renderelt jegyzetet, a hiánylistát és az Obsidian-linket adja', async () => {
    const detail = await $fetch<ItemResponse>('/api/items/szint0001')
    expect(detail.item.title).toBe('Első példavideó')

    const summary = detail.artifacts.find((a) => a.kind === 'summary')
    expect(summary?.gaps).toEqual(['kimaradt: a zárás'])
    expect(summary?.html).toContain('<h2>Összefoglaló</h2>')
    expect(summary?.obsidianUrl).toBe(
      `obsidian://open?path=${encodeURIComponent(fixture.summaryNote)}`,
    )

    const transcript = detail.artifacts.find((a) => a.kind === 'transcript')
    expect(transcript?.html).toContain('Ez az első szintetikus mondat.')
  })

  it('a jegyzetbe írt nyers HTML szövegként jelenik meg', async () => {
    const detail = await $fetch<ItemResponse>('/api/items/szint0001')
    const html = detail.artifacts.find((a) => a.kind === 'summary')?.html ?? ''
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('ismeretlen elemre 404', async () => {
    const error = await $fetch('/api/items/nincs-ilyen').catch((e: unknown) => e)
    expect((error as { statusCode?: number }).statusCode).toBe(404)
  })

  it('a hibák a hibaüzenet első sora szerint csoportosítva', async () => {
    expect(await $fetch<FailureGroup[]>('/api/failures')).toEqual([
      {
        message: 'a jegyzet megsérti a vault írási szabályait: wikilink tiltott',
        count: 1,
        items: [{ itemId: 'szint0001', title: 'Első példavideó', kind: 'qa' }],
      },
    ])
  })
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm web:test
```

Várt: FAIL, 4 új teszt. Az „ismeretlen elemre 404" már most átmegy, mert maga
az útvonal sincs meg; a mutációs lépés a `<script>`-es tesztet ellenőrzi.

- [ ] **3. lépés: A renderelés**

`web/server/utils/markdown.ts`:

```ts
import MarkdownIt from 'markdown-it'

// A jegyzet modell írta szöveg: nyers HTML nem kerülhet belőle az oldalba. A
// `html: false` itt kifejezetten áll, mert ez a biztonsági pont — teszt őrzi.
const markdown = new MarkdownIt({ html: false, linkify: false })

export function renderMarkdown(source: string): string {
  return markdown.render(source)
}
```

- [ ] **4. lépés: Az útvonalak**

`web/server/api/items/index.get.ts`:

```ts
import { readItems } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readItems(cfg)))
```

`web/server/api/items/[itemId].get.ts`:

```ts
import { readItemDetail } from 'transcript-refinery'

export default defineEventHandler((event) =>
  coreHandler(async (cfg) => {
    const itemId = getRouterParam(event, 'itemId', { decode: true }) ?? ''
    const detail = await readItemDetail(cfg, itemId)
    if (!detail) throw createError({ statusCode: 404, message: 'Nincs ilyen elem.' })
    return {
      ...detail,
      artifacts: detail.artifacts.map((artifact) => ({
        ...artifact,
        html: artifact.body === null ? null : renderMarkdown(artifact.body),
        obsidianUrl:
          artifact.path === null
            ? null
            : `obsidian://open?path=${encodeURIComponent(artifact.path)}`,
      })),
    }
  }),
)
```

`web/server/api/failures.get.ts`:

```ts
import { readFailures } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readFailures(cfg)))
```

- [ ] **5. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm web:test
```

Várt: PASS.

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
mise exec -- pnpm web:typecheck && mise exec -- pnpm web:lint
```

- [ ] **7. lépés: Commit**

```bash
git add web/server web/test
```

Javasolt üzenet: `feat(web): az elemek, az elem és a hibák API-ja`, `Refs #28`.

- [ ] **8. lépés: Mutációs ellenőrzés — a nyers HTML tiltása**

A `web/server/utils/markdown.ts`-ben írd át a `html: false`-t `html: true`-ra, és
futtasd:

```bash
mise exec -- pnpm web:test
```

Várt: FAIL — „a jegyzetbe írt nyers HTML szövegként jelenik meg". Állítsd vissza:

```bash
git checkout -- web/server/utils/markdown.ts
```

---

## Feladat 13: A futások API-ja és az élő követés SSE-n

**Fájlok:**
- Létrehoz: `web/server/api/runs/index.get.ts`, `web/server/api/runs/[runId]/index.get.ts`,
  `web/server/api/runs/[runId]/events.get.ts`
- Teszt: `web/test/e2e/api.test.ts`

**Interfészek:**
- Fogyaszt: `readRuns`, `readRun`, `RunDetail`, `findRun`, `followRunLog`,
  `isPidAlive`, `parseEventId`, `RunSummaryView` (4., 7., 8.); `coreHandler`,
  `useRefineryConfig`, a fixture (11.); `renderMarkdown` (12.).
- Termel:
  - `GET /api/runs` → `RunSummaryView[]`
  - `GET /api/runs/[runId]` → `RunDetail & { reportHtml: string | null }`; nem létező vagy nem `runId` alakú azonosítóra 404
  - `GET /api/runs/[runId]/events` → SSE: soronként `id` = a sor utáni offset, `data` = `{ line, state }`; a végén egy `end` nevű esemény
  - A 15. feladat futás-oldalai ezeket használják.

- [ ] **1. lépés: Írd meg a bukó teszteket**

A `web/test/e2e/api.test.ts` importjait (a típus-aliasszal együtt) cseréld le erre:

```ts
import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import type {
  ArtifactDetail,
  FailureGroup,
  ItemDetail,
  ItemListRow,
  Overview,
  RunDetail,
  RunSummaryView,
} from 'transcript-refinery'
import { FINISHED_RUN, RUNNING_RUN, createFixture } from './fixture'

type ItemResponse = Omit<ItemDetail, 'artifacts'> & {
  artifacts: (ArtifactDetail & { html: string | null; obsidianUrl: string | null })[]
}

type RunResponse = RunDetail & { reportHtml: string | null }

const eventIds = (text: string): string[] =>
  [...text.matchAll(/^id: (\d+)$/gm)].map((match) => match[1] ?? '')
```

és a `describe('API', …)` blokk végére, a záró `})` elé illeszd be:

```ts
  it('a futáslista legújabb elöl, állapottal', async () => {
    const runs = await $fetch<RunSummaryView[]>('/api/runs')
    expect(runs.map((run) => [run.runId, run.status])).toEqual([
      [RUNNING_RUN, 'running'],
      [FINISHED_RUN, 'done'],
    ])
  })

  it('a lezárt futás oldala a sorokat, az állapotot és a renderelt riportot adja', async () => {
    const run = await $fetch<RunResponse>(`/api/runs/${FINISHED_RUN}`)
    expect(run.summary.status).toBe('done')
    expect(run.lines).toHaveLength(8)
    expect(run.state.spentUsd).toBeCloseTo(0.0123, 10)
    expect(run.reportHtml).toContain('<h1>Futás</h1>')
  })

  it('a nem futásazonosító alakú kérésre 404, az SSE-nél is', async () => {
    for (const path of [
      '/api/runs/..%2F..%2Fetc',
      '/api/runs/nincs-ilyen',
      '/api/runs/..%2F..%2Fetc/events',
    ]) {
      const error = await $fetch(path).catch((e: unknown) => e)
      expect((error as { statusCode?: number }).statusCode).toBe(404)
    }
  })

  it('a lezárt futás folyama minden sort ad, end eseménnyel zár, és a Last-Event-ID-től folytat', async () => {
    const all = await (await fetch(`/api/runs/${FINISHED_RUN}/events`)).text()
    expect(all).toContain('event: end')
    const ids = eventIds(all)
    expect(ids).toHaveLength(8)

    const rest = await (
      await fetch(`/api/runs/${FINISHED_RUN}/events`, { headers: { 'Last-Event-ID': ids[0]! } })
    ).text()
    expect(eventIds(rest)).toEqual(ids.slice(1))
  })

  it('a futó napló hozzáfűzött sora megjelenik a folyamban, az állapottal együtt', async () => {
    const response = await fetch(`/api/runs/${RUNNING_RUN}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''

    /** Addig olvas, amíg a keresett szöveget tartalmazó üzenet teljesen meg nem jött. */
    const messageWith = async (needle: string): Promise<string> => {
      for (;;) {
        const at = text.indexOf(needle)
        const endAt = at === -1 ? -1 : text.indexOf('\n\n', at)
        if (endAt !== -1) {
          const before = text.lastIndexOf('\n\n', at)
          return text.slice(before === -1 ? 0 : before + 2, endAt)
        }
        const { value, done } = await reader.read()
        if (done) throw new Error(`a folyam véget ért, mielőtt megjött: ${needle}`)
        text += decoder.decode(value, { stream: true })
      }
    }

    await messageWith('"type":"scan:found"')
    await appendFile(
      fixture.runningLog,
      `${JSON.stringify({
        at: new Date().toISOString(),
        type: 'item:start',
        itemId: 'szint0002',
        title: 'Második példavideó',
      })}\n`,
    )
    const message = await messageWith('"type":"item:start"')
    await reader.cancel()

    const dataLine = message.split('\n').find((l) => l.startsWith('data: ')) ?? ''
    const data = JSON.parse(dataLine.slice('data: '.length)) as {
      line: { itemId: string }
      state: { current: { title: string } | null }
    }
    expect(data.line.itemId).toBe('szint0002')
    expect(data.state.current?.title).toBe('Második példavideó')
  })
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm web:test
```

Várt: FAIL — a futáslista, a futás oldala és a két SSE-teszt (az útvonalak még
nincsenek). A 404-es teszt már most átmegy, mert maga az útvonal sincs meg; az
őrt a 4. feladat mutációs ellenőrzése már igazolta.

- [ ] **3. lépés: A futáslista és a futás oldala**

`web/server/api/runs/index.get.ts`:

```ts
import { readRuns } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readRuns(cfg)))
```

`web/server/api/runs/[runId]/index.get.ts`:

```ts
import { readRun } from 'transcript-refinery'

export default defineEventHandler((event) =>
  coreHandler(async (cfg) => {
    const run = await readRun(cfg, getRouterParam(event, 'runId', { decode: true }) ?? '')
    if (!run) throw createError({ statusCode: 404, message: 'Nincs ilyen futás.' })
    return { ...run, reportHtml: run.report === null ? null : renderMarkdown(run.report) }
  }),
)
```

- [ ] **4. lépés: Az SSE-útvonal**

`web/server/api/runs/[runId]/events.get.ts`:

```ts
import { findRun, followRunLog, isPidAlive, parseEventId } from 'transcript-refinery'

/**
 * Egy futás eseményei SSE-n. Az üzenet `id`-je a sor utáni bájt-offset: a
 * böngésző újracsatlakozáskor ezt küldi vissza (`Last-Event-ID`), és a követés
 * onnan folytatódik. A követés logikája a magban él (`followRunLog`), ez az
 * útvonal csak továbbít.
 */
export default defineEventHandler(async (event) => {
  const cfg = await useRefineryConfig()
  const files = findRun(cfg.logsDir, getRouterParam(event, 'runId', { decode: true }) ?? '')
  if (!files) throw createError({ statusCode: 404, message: 'Nincs ilyen futás.' })

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())

  const forward = async (): Promise<void> => {
    try {
      const followed = followRunLog(files.logPath, {
        fromOffset: parseEventId(getHeader(event, 'last-event-id')),
        intervalMs: 500,
        isAlive: isPidAlive,
        signal: controller.signal,
      })
      for await (const { line, end, state } of followed) {
        await stream.push({ id: String(end), data: JSON.stringify({ line, state }) })
      }
      // A lezárt folyamra a böngésző EventSource-a újra és újra csatlakozna: az
      // `end` esemény mondja meg neki, hogy vége.
      await stream.push({ event: 'end', data: '{}' })
    } catch (error) {
      // A bontott kapcsolat nem hiba; minden más a szervernaplóba kerül.
      if (!controller.signal.aborted) {
        console.error(`A futásnapló követése megszakadt: ${(error as Error).message}`)
      }
    } finally {
      await stream.close()
    }
  }
  void forward()
  return stream.send()
})
```

- [ ] **5. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm web:test
```

Várt: PASS.

- [ ] **6. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
mise exec -- pnpm web:typecheck && mise exec -- pnpm web:lint
```

- [ ] **7. lépés: Commit**

```bash
git add web/server web/test
```

Javasolt üzenet: `feat(web): a futások API-ja és az élő követés SSE-n`, `Refs #28`.

---

## Feladat 14: Az áttekintő, az elemek, az elem és a hibák oldala

**Fájlok:**
- Módosít: `web/app/app.vue`, `web/app/pages/index.vue`, `web/app/assets/css/main.css`
- Létrehoz: `web/app/layouts/default.vue`, `web/app/utils/format.ts`,
  `web/app/components/ErrorAlert.vue`, `web/app/components/ArtifactPanel.vue`,
  `web/app/pages/items/index.vue`, `web/app/pages/items/[itemId].vue`,
  `web/app/pages/failures.vue`
- Teszt: `web/test/e2e/api.test.ts`, `web/test/e2e/errors.test.ts`

**Interfészek:**
- Fogyaszt: `/api/overview` (11.), `/api/items`, `/api/items/[itemId]`, `/api/failures` (12.).
- Termel: az oldalak; a `web/app/utils/format.ts` auto-importált formázói
  (`kindLabel`, `runStatusLabel`, `runStatusColor`, `formatUsd`, `formatScore`,
  `formatDate`, `formatTime`, `formatDuration`, `lineDetail`, `errorMessage`) és
  az `ErrorAlert` komponens — a 15. feladat is ezeket használja.

A kliens a magból nem importál futásidejű kódot: a sortípusokat a `useFetch`
válaszából vezeti le. Slotba (például a `UCard` törzsébe) nullázható értéket ne
vigyél — ott a `v-if` szűkítése nem érvényes; ilyenkor komponens kapja kötelező
propként (`ArtifactPanel`).

- [ ] **1. lépés: Írd meg a bukó teszteket**

A `web/test/e2e/api.test.ts` `describe('API', …)` blokkjának végére, a záró `})` elé:

```ts
  it('az oldalak a szerveren renderelve a szintetikus adatot mutatják', async () => {
    const overview = await $fetch<string>('/')
    expect(overview).toContain('A korpusz állapota')
    expect(overview).toContain('Fut: run --queue')

    const items = await $fetch<string>('/items')
    expect(items).toContain('Első példavideó')
    expect(items).toContain('Második példavideó')

    const item = await $fetch<string>('/items/szint0001')
    expect(item).toContain('kimaradt: a zárás')
    expect(item).toContain('&lt;script&gt;')
    expect(item).toContain('Megnyitás Obsidianban')

    const failures = await $fetch<string>('/failures')
    expect(failures).toContain('wikilink tiltott')
  })
```

A `web/test/e2e/errors.test.ts` `describe` blokkjának végére:

```ts
  it('az oldal is a konfigurációs hibát mutatja', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('Nincs konfigurációs fájl')
  })
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm web:test
```

Várt: FAIL, 2 teszt — az ideiglenes kezdőlapon nincs adat, a többi oldal 404.

- [ ] **3. lépés: Elrendezés, formázók, hibajelzés**

`web/app/app.vue`:

```vue
<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

`web/app/layouts/default.vue`:

```vue
<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const items: NavigationMenuItem[] = [
  { label: 'Áttekintő', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Elemek', icon: 'i-lucide-list', to: '/items' },
  { label: 'Hibák', icon: 'i-lucide-triangle-alert', to: '/failures' },
  { label: 'Futások', icon: 'i-lucide-activity', to: '/runs' },
]
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-default">
      <UContainer class="flex items-center gap-6 py-2">
        <span class="font-semibold">Transcript Refinery</span>
        <UNavigationMenu orientation="horizontal" :items="items" />
      </UContainer>
    </header>
    <UContainer class="py-6">
      <slot />
    </UContainer>
  </div>
</template>
```

`web/app/utils/format.ts`:

```ts
const KIND_LABELS: Record<string, string> = {
  transcript: 'átirat',
  summary: 'összefoglaló',
  flashcards: 'tanulókártya',
  qa: 'kérdés-felelet',
}

/** A műtermék-típus magyar neve; ismeretlen típusnál maga az azonosító. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'fut',
  died: 'nyom nélkül leállt',
  interrupted: 'megszakítva',
  capped: 'a plafon miatt megállt',
  done: 'kész',
  failed: 'hibával ért véget',
  closed: 'lezárt',
  unknown: 'ismeretlen',
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status
}

export function runStatusColor(status: string): 'info' | 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'running':
      return 'info'
    case 'done':
      return 'success'
    case 'capped':
    case 'interrupted':
      return 'warning'
    case 'died':
    case 'failed':
      return 'error'
    default:
      return 'neutral'
  }
}

/** Négy tizedes, mint a CLI: egyetlen elem költsége két tizedessel mindig 0.00 lenne. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`
}

export function formatScore(value: number | null): string {
  return value === null ? '–' : value.toFixed(2)
}

/** Determinisztikus, UTC: a szerveren és a böngészőben ugyanaz a szöveg. */
export function formatDate(iso: string | null): string {
  return iso === null ? '–' : `${iso.slice(0, 19).replace('T', ' ')} UTC`
}

export function formatTime(iso: string): string {
  return iso.slice(11, 19)
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '–'
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds < 60 ? `${seconds} mp` : `${Math.floor(seconds / 60)} p ${seconds % 60} mp`
}

/** Egy naplósor mezői a típus és az idő nélkül, röviden — az idővonalhoz. */
export function lineDetail(line: object): string {
  const rest = Object.fromEntries(
    Object.entries(line).filter(([key]) => key !== 'type' && key !== 'at'),
  )
  const text = JSON.stringify(rest)
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}

/** A `useFetch` hibájából a szerver üzenete (az 500-as válasz `message` mezője). */
export function errorMessage(error: unknown): string {
  const body = (error as { data?: { message?: unknown } } | null)?.data
  if (typeof body?.message === 'string') return body.message
  return error instanceof Error ? error.message : 'Ismeretlen hiba.'
}
```

`web/app/components/ErrorAlert.vue`:

```vue
<script setup lang="ts">
defineProps<{ error: unknown }>()
</script>

<template>
  <UAlert
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    title="Az adat nem tölthető be"
    :description="errorMessage(error)"
  />
</template>
```

A `web/app/assets/css/main.css` végére — a renderelt jegyzet és riport olvasható
tagolása, typography-plugin nélkül:

```css
.note h1 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
.note h2 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; }
.note h3 { font-weight: 600; margin: 0.75rem 0 0.25rem; }
.note p, .note ul, .note ol, .note table { margin: 0.5rem 0; }
.note ul { list-style: disc; padding-left: 1.25rem; }
.note ol { list-style: decimal; padding-left: 1.25rem; }
```

- [ ] **4. lépés: Az áttekintő**

`web/app/pages/index.vue` teljes tartalma:

```vue
<script setup lang="ts">
const { data, error } = await useFetch('/api/overview')

const sources = computed(() => [
  ...new Set(
    (data.value?.corpus ?? []).flatMap((entry) => entry.status.bySource.map((s) => s.source)),
  ),
])

function sourceCell(
  rows: { source: string; done: number; failed: number; pending: number }[],
  source: string,
): string {
  const row = rows.find((r) => r.source === source)
  return row ? `${row.done} / ${row.failed} / ${row.pending}` : '–'
}

function barHeight(count: number, buckets: number[]): number {
  const max = Math.max(...buckets)
  return max === 0 ? 0 : Math.round((count / max) * 100)
}
</script>

<template>
  <div class="space-y-8">
    <h1 class="text-2xl font-semibold">Áttekintő</h1>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <UAlert
        v-for="run in data.running"
        :key="run.runId"
        color="info"
        variant="subtle"
        icon="i-lucide-activity"
        :title="`Fut: ${run.command ?? run.runId}`"
      >
        <template #description>
          <NuxtLink :to="`/runs/${run.runId}`" class="underline">Élő követés</NuxtLink>
        </template>
      </UAlert>

      <UAlert
        v-if="!data.hasState"
        color="neutral"
        variant="subtle"
        title="Még nincs feldolgozott elem"
        :description="`${data.discovered} felderített elem vár feldolgozásra.`"
      />

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">A korpusz állapota</h2>
        <p class="text-sm text-muted">
          {{ data.discovered }} felderített elem · eddigi költés: {{ formatUsd(data.totalCostUsd) }}
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="py-1 pr-4">forrás</th>
                <th v-for="entry in data.corpus" :key="entry.kind" class="py-1 pr-4">
                  {{ kindLabel(entry.kind) }}
                  <span class="block text-xs font-normal text-muted">kész / hibás / hátra</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="source in sources" :key="source" class="border-t border-default">
                <td class="py-1 pr-4">{{ source }}</td>
                <td v-for="entry in data.corpus" :key="entry.kind" class="py-1 pr-4">
                  {{ sourceCell(entry.status.bySource, source) }}
                </td>
              </tr>
              <tr class="border-t border-default font-medium">
                <td class="py-1 pr-4">összesen</td>
                <td v-for="entry in data.corpus" :key="entry.kind" class="py-1 pr-4">
                  {{ entry.status.done }} / {{ entry.status.failed }} / {{ entry.status.pending }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Pontszámok receptenként</h2>
        <div class="grid gap-4 md:grid-cols-3">
          <UCard v-for="dist in data.scores" :key="dist.recipe">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium">{{ kindLabel(dist.recipe) }}</span>
                <UBadge :color="dist.belowThreshold > 0 ? 'warning' : 'success'" variant="subtle">
                  {{ dist.belowThreshold }} a küszöb ({{ formatScore(dist.threshold) }}) alatt
                </UBadge>
              </div>
            </template>
            <div class="flex h-24 items-end gap-1">
              <div
                v-for="(count, index) in dist.buckets"
                :key="index"
                class="flex-1 rounded-t bg-primary"
                :style="{ height: `${barHeight(count, dist.buckets)}%` }"
                :title="`${(index / 10).toFixed(1)}–${((index + 1) / 10).toFixed(1)}: ${count}`"
              />
            </div>
            <p class="mt-2 text-xs text-muted">{{ dist.scored }} pontozott jegyzet</p>
          </UCard>
        </div>
      </section>

      <section v-if="data.queue" class="space-y-3">
        <h2 class="text-lg font-semibold">A feldolgozási sor</h2>
        <p v-if="data.queue.length === 0" class="text-sm text-muted">Nincs kipipált pár.</p>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="text-left">
              <th class="py-1 pr-4">recept</th>
              <th class="py-1 pr-4">kipipálva</th>
              <th class="py-1 pr-4">kész</th>
              <th class="py-1 pr-4">hibás</th>
              <th class="py-1 pr-4">hátra</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.queue" :key="row.recipe" class="border-t border-default">
              <td class="py-1 pr-4">{{ kindLabel(row.recipe) }}</td>
              <td class="py-1 pr-4">{{ row.checked }}</td>
              <td class="py-1 pr-4">{{ row.done }}</td>
              <td class="py-1 pr-4">{{ row.failed }}</td>
              <td class="py-1 pr-4">{{ row.pending }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
```

- [ ] **5. lépés: Az elemlista**

`web/app/pages/items/index.vue`:

```vue
<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const { data, error } = await useFetch('/api/items')
const NuxtLink = resolveComponent('NuxtLink')
const UBadge = resolveComponent('UBadge')

type Row = NonNullable<typeof data.value>[number]
type Cell = Row['cells'][string]

const ALL = 'mind'
const STATUS_LABELS = [ALL, 'kész', 'hibás', 'hátra']
const STATUS_OF: Record<string, string> = { kész: 'done', hibás: 'failed', hátra: 'pending' }
const SORTS = ['felderítés', 'pontszám (gyengébb elöl)', 'költség', 'frissítés']

const rows = computed<Row[]>(() => data.value ?? [])
const kinds = computed(() => Object.keys(rows.value[0]?.cells ?? {}))
const sources = computed(() => [ALL, ...new Set(rows.value.map((row) => row.source))])
const channels = computed(() => [
  ALL,
  ...new Set(rows.value.flatMap((row) => (row.channel ? [row.channel] : []))),
])

const source = ref(ALL)
const channel = ref(ALL)
const kind = ref('summary')
const status = ref(ALL)
const sort = ref(SORTS[0] ?? '')
const onlyBelow = ref(false)

const cellOf = (row: Row): Cell | undefined => row.cells[kind.value]

const visible = computed(() => {
  const selected = rows.value.filter((row) => {
    const cell = cellOf(row)
    if (source.value !== ALL && row.source !== source.value) return false
    if (channel.value !== ALL && row.channel !== channel.value) return false
    if (status.value !== ALL && cell?.status !== STATUS_OF[status.value]) return false
    if (onlyBelow.value && !cell?.belowThreshold) return false
    return true
  })
  if (sort.value === SORTS[1]) {
    return [...selected].sort((a, b) => (cellOf(a)?.score ?? 2) - (cellOf(b)?.score ?? 2))
  }
  if (sort.value === SORTS[2]) {
    return [...selected].sort((a, b) => (cellOf(b)?.costUsd ?? 0) - (cellOf(a)?.costUsd ?? 0))
  }
  if (sort.value === SORTS[3]) {
    return [...selected].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }
  return selected
})

function cellBadge(cell: Cell | undefined) {
  if (!cell || cell.status === 'pending') return '–'
  if (cell.status === 'failed') return h(UBadge, { color: 'error', variant: 'subtle' }, () => '✗')
  const label = cell.score === null ? '✓' : `✓ ${formatScore(cell.score)}`
  return h(
    UBadge,
    { color: cell.belowThreshold ? 'warning' : 'success', variant: 'subtle' },
    () => label,
  )
}

const captionLabel = (value: Row['captionSource']): string =>
  value === 'auto' ? 'automatikus' : value === 'creator' ? 'szerzői' : '–'

const columns = computed<TableColumn<Row>[]>(() => [
  {
    accessorKey: 'title',
    header: 'Cím',
    cell: ({ row }) =>
      h(
        NuxtLink,
        { to: `/items/${encodeURIComponent(row.original.itemId)}`, class: 'underline' },
        () => row.original.title,
      ),
  },
  { accessorKey: 'source', header: 'Forrás' },
  { accessorKey: 'channel', header: 'Csatorna', cell: ({ row }) => row.original.channel ?? '–' },
  {
    accessorKey: 'captionSource',
    header: 'Felirat',
    cell: ({ row }) => captionLabel(row.original.captionSource),
  },
  ...kinds.value.map(
    (k): TableColumn<Row> => ({
      id: k,
      header: kindLabel(k),
      cell: ({ row }) => cellBadge(row.original.cells[k]),
    }),
  ),
])
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Elemek</h1>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <USelect v-model="source" :items="sources" class="w-40" aria-label="Forrás" />
        <USelect v-model="channel" :items="channels" class="w-48" aria-label="Csatorna" />
        <USelect v-model="kind" :items="kinds" class="w-40" aria-label="Műtermék-típus" />
        <USelect v-model="status" :items="STATUS_LABELS" class="w-32" aria-label="Állapot" />
        <USelect v-model="sort" :items="SORTS" class="w-56" aria-label="Rendezés" />
        <UCheckbox v-model="onlyBelow" label="csak a küszöb alattiak" />
      </div>
      <p class="text-sm text-muted">{{ visible.length }} / {{ rows.length }} elem</p>
      <UTable :data="visible" :columns="columns" />
    </template>
  </div>
</template>
```

- [ ] **6. lépés: Az elem oldala**

`web/app/components/ArtifactPanel.vue`:

```vue
<script setup lang="ts">
defineProps<{
  artifact: {
    kind: string
    status: string
    path: string | null
    error: string | null
    iterations: number | null
    score: number | null
    costUsd: number | null
    model: string | null
    createdAt: string
    threshold: number | null
    gaps: string[] | null
    missingFile: boolean
    html: string | null
    obsidianUrl: string | null
  }
  transcriptHtml: string | null
}>()
</script>

<template>
  <div class="space-y-4 pt-4">
    <UAlert
      v-if="artifact.status === 'failed'"
      color="error"
      variant="subtle"
      title="A műtermék elbukott"
      :description="artifact.error ?? 'ismeretlen hiba'"
    />
    <template v-else>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <UBadge
          :color="
            artifact.score !== null && artifact.threshold !== null && artifact.score < artifact.threshold
              ? 'warning'
              : 'success'
          "
          variant="subtle"
        >
          pontszám {{ formatScore(artifact.score) }} · küszöb {{ formatScore(artifact.threshold) }}
        </UBadge>
        <span>{{ artifact.iterations ?? '–' }} generálás</span>
        <span>{{ artifact.costUsd === null ? '–' : formatUsd(artifact.costUsd) }}</span>
        <span>{{ artifact.model ?? '–' }}</span>
        <span class="text-muted">{{ formatDate(artifact.createdAt) }}</span>
        <UButton
          v-if="artifact.obsidianUrl"
          :to="artifact.obsidianUrl"
          external
          label="Megnyitás Obsidianban"
          icon="i-lucide-external-link"
          variant="soft"
          size="sm"
        />
      </div>

      <UCard>
        <template #header>A bíró hiánylistája</template>
        <p v-if="artifact.gaps === null" class="text-sm text-muted">
          Ehhez a jegyzethez nincs rögzített hiánylista.
        </p>
        <p v-else-if="artifact.gaps.length === 0" class="text-sm text-muted">
          A bíró nem nevezett meg hiányt.
        </p>
        <ul v-else class="list-disc space-y-1 pl-5 text-sm">
          <li v-for="(gap, index) in artifact.gaps" :key="index">{{ gap }}</li>
        </ul>
      </UCard>

      <UAlert
        v-if="artifact.missingFile"
        color="warning"
        variant="subtle"
        :title="`A jegyzet nem található: ${artifact.path}`"
      />

      <div class="grid gap-6 lg:grid-cols-2">
        <section class="space-y-2">
          <h3 class="font-medium">Jegyzet</h3>
          <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="artifact.html" class="note" v-html="artifact.html" />
        </section>
        <section class="space-y-2">
          <h3 class="font-medium">Normalizált átirat</h3>
          <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="transcriptHtml" class="note" v-html="transcriptHtml" />
          <p v-else class="text-sm text-muted">Nincs átirat-jegyzet.</p>
        </section>
      </div>
    </template>
  </div>
</template>
```

`web/app/pages/items/[itemId].vue`:

```vue
<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

const route = useRoute()
const itemId = computed(() => String(route.params.itemId))
const { data, error } = await useFetch(() => `/api/items/${encodeURIComponent(itemId.value)}`)

type Artifact = NonNullable<typeof data.value>['artifacts'][number]

const transcript = computed(() => data.value?.artifacts.find((a) => a.kind === 'transcript') ?? null)
const recipes = computed(() => data.value?.artifacts.filter((a) => a.kind !== 'transcript') ?? [])
const tabs = computed<TabsItem[]>(() =>
  recipes.value.map((a) => ({ label: kindLabel(a.kind), value: a.kind })),
)
const artifactOf = (value: TabsItem['value']): Artifact | undefined =>
  recipes.value.find((a) => a.kind === value)

const captionText = computed(() => {
  const value = data.value?.item.captionSource
  return value === 'auto' ? 'automatikus felirat' : value === 'creator' ? 'szerzői felirat' : 'még nincs átirat'
})
</script>

<template>
  <div class="space-y-6">
    <NuxtLink to="/items" class="text-sm underline">← Elemek</NuxtLink>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <header class="space-y-1">
        <h1 class="text-2xl font-semibold">{{ data.item.title }}</h1>
        <p class="text-sm text-muted">
          {{ data.item.source }} · {{ data.item.channel ?? 'csatorna nélkül' }} · {{ captionText }}
          <template v-if="data.item.wordsRaw !== null">
            · {{ data.item.wordsRaw }} → {{ data.item.wordsNormalized }} szó
          </template>
        </p>
        <UAlert
          v-if="!data.item.discovered"
          color="warning"
          variant="subtle"
          title="A felirat már nincs a forrásmappában"
        />
      </header>

      <p v-if="data.artifacts.length === 0" class="text-muted">
        Ehhez az elemhez még nincs rögzített műtermék.
      </p>

      <UTabs v-if="tabs.length > 0" :items="tabs" class="w-full">
        <template #content="{ item }">
          <ArtifactPanel
            v-if="artifactOf(item.value)"
            :artifact="artifactOf(item.value)!"
            :transcript-html="transcript?.html ?? null"
          />
        </template>
      </UTabs>

      <section v-else-if="transcript" class="space-y-2">
        <h2 class="font-medium">Normalizált átirat</h2>
        <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="transcript.html" class="note" v-html="transcript.html" />
      </section>
    </template>
  </div>
</template>
```

- [ ] **7. lépés: A hibák**

`web/app/pages/failures.vue`:

```vue
<script setup lang="ts">
const { data, error } = await useFetch('/api/failures')
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Hibák</h1>
    <ErrorAlert v-if="error" :error="error" />
    <p v-else-if="data && data.length === 0" class="text-muted">Nincs hibás műtermék.</p>
    <UCard v-for="group in data ?? []" :key="group.message">
      <template #header>
        <div class="flex items-start justify-between gap-3">
          <span class="font-medium">{{ group.message }}</span>
          <UBadge color="error" variant="subtle">{{ group.count }}</UBadge>
        </div>
      </template>
      <ul class="space-y-1 text-sm">
        <li v-for="entry in group.items" :key="`${entry.itemId}-${entry.kind}`">
          <NuxtLink :to="`/items/${encodeURIComponent(entry.itemId)}`" class="underline">
            {{ entry.title }}
          </NuxtLink>
          <span class="text-muted"> · {{ kindLabel(entry.kind) }}</span>
        </li>
      </ul>
    </UCard>
  </div>
</template>
```

- [ ] **8. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm web:test
```

Várt: PASS.

- [ ] **9. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
mise exec -- pnpm web:typecheck && mise exec -- pnpm web:lint
```

Ha a `web:typecheck` egy slotban nullázható értéket kifogásol, ne `!`-lel
némítsd: vidd az értéket komponens kötelező propjába, ahogy az `ArtifactPanel`.

- [ ] **10. lépés: Commit**

```bash
git add web/app web/test
```

Javasolt üzenet: `feat(web): az áttekintő, az elemek, az elem és a hibák oldala`, `Refs #28`.

---

## Feladat 15: A futások oldala és az élő nézet

**Fájlok:**
- Létrehoz: `web/app/composables/useRunStream.ts`, `web/app/components/RunStatePanel.vue`,
  `web/app/pages/runs/index.vue`, `web/app/pages/runs/[runId].vue`
- Teszt: `web/test/e2e/api.test.ts`

**Interfészek:**
- Fogyaszt: `/api/runs`, `/api/runs/[runId]`, `/api/runs/[runId]/events` (13.);
  `LiveRunState`, `RunLogLine` típus (4., 7.); a formázók és az `ErrorAlert` (14.).
- Termel: `useRunStream(runId: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>)`
  → `{ lines, state, live, finished }`; a futáslista és a futás oldala.

- [ ] **1. lépés: Írd meg a bukó tesztet**

A `web/test/e2e/api.test.ts` `describe('API', …)` blokkjának végére:

```ts
  it('a futás oldalai a szerveren renderelve az adatot mutatják', async () => {
    const list = await $fetch<string>('/runs')
    expect(list).toContain('run --recipe summary')
    expect(list).toContain('run --queue')

    const run = await $fetch<string>(`/runs/${FINISHED_RUN}`)
    expect(run).toContain('item:refined')
    expect(run).toContain('$0.0123')
    expect(run).toContain('Riport')
  })
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm web:test
```

Várt: FAIL, 1 teszt — a `/runs` oldalak még nincsenek.

- [ ] **3. lépés: Az élő folyam a böngészőben**

`web/app/composables/useRunStream.ts`:

```ts
import type { LiveRunState, RunLogLine } from 'transcript-refinery'

/**
 * Egy futás eseményei SSE-n. A böngésző `EventSource`-a a megszakadt kapcsolatot
 * magától újraépíti, és a `Last-Event-ID`-vel ott folytatja, ahol abbahagyta —
 * esemény nem ismétlődik. Az `end` esemény után viszont lezárjuk, különben a
 * lezárt folyamra újra és újra csatlakozna.
 */
export function useRunStream(runId: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  const lines = ref<RunLogLine[]>([])
  const state = ref<LiveRunState | null>(null)
  const live = ref(false)
  const finished = ref(false)
  let source: EventSource | null = null

  function stop(): void {
    source?.close()
    source = null
    live.value = false
  }

  function start(): void {
    stop()
    lines.value = []
    state.value = null
    finished.value = false
    source = new EventSource(`/api/runs/${encodeURIComponent(toValue(runId))}/events`)
    source.onopen = () => {
      live.value = true
    }
    source.onmessage = (message: MessageEvent<string>) => {
      const data = JSON.parse(message.data) as { line: RunLogLine; state: LiveRunState }
      lines.value.push(data.line)
      state.value = data.state
    }
    source.addEventListener('end', () => {
      stop()
      finished.value = true
    })
  }

  onMounted(() => {
    if (toValue(enabled)) start()
  })
  onBeforeUnmount(stop)
  return { lines, state, live, finished }
}
```

- [ ] **4. lépés: Az állapotpanel**

`web/app/components/RunStatePanel.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{
  state: {
    units: number | null
    started: number
    succeeded: number
    failed: number
    estimate: { items: number; usd: number; limitUsd: number } | null
    spentUsd: number
    current: { itemId: string; title: string; step: string } | null
    lastScore: { itemId: string; recipe: string; score: number; gaps: number } | null
    retries: number
    lastEventAt: string | null
  }
}>()

// Az utolsó esemény óta eltelt idő: egy újrahasznosított pid ritkán hamis
// „fut"-ot adhat, ez a szám mutatja meg, ha a futás valójában áll.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const sinceLast = computed(() =>
  props.state.lastEventAt === null
    ? '–'
    : formatDuration(now.value - Date.parse(props.state.lastEventAt)),
)
</script>

<template>
  <section class="grid gap-4 md:grid-cols-3">
    <UCard>
      <template #header>Haladás</template>
      <p class="text-sm">{{ state.started }} / {{ state.units ?? '?' }} egység elkezdve</p>
      <UProgress :model-value="state.started" :max="Math.max(state.units ?? 0, 1)" class="mt-2" />
      <p class="mt-2 text-sm">
        {{ state.succeeded }} sikeres · {{ state.failed }} hibás · {{ state.retries }} újrapróba
      </p>
    </UCard>

    <UCard>
      <template #header>Költés</template>
      <p class="text-sm">
        {{ formatUsd(state.spentUsd) }}
        <template v-if="state.estimate">/ plafon {{ formatUsd(state.estimate.limitUsd) }}</template>
      </p>
      <template v-if="state.estimate">
        <UProgress
          :model-value="Math.min(state.spentUsd, state.estimate.limitUsd)"
          :max="state.estimate.limitUsd"
          class="mt-2"
        />
        <p class="mt-2 text-xs text-muted">
          becslés: {{ formatUsd(state.estimate.usd) }}, {{ state.estimate.items }} egység
        </p>
      </template>
    </UCard>

    <UCard>
      <template #header>Most</template>
      <p v-if="state.current" class="text-sm">{{ state.current.title }} — {{ state.current.step }}</p>
      <p v-else class="text-sm text-muted">Nincs feldolgozás alatt álló elem.</p>
      <p v-if="state.lastScore" class="mt-2 text-sm">
        utolsó pontszám: {{ formatScore(state.lastScore.score) }}
        ({{ kindLabel(state.lastScore.recipe) }}, {{ state.lastScore.gaps }} hiány)
      </p>
      <ClientOnly>
        <p class="mt-2 text-xs text-muted">utolsó esemény: {{ sinceLast }} ezelőtt</p>
      </ClientOnly>
    </UCard>
  </section>
</template>
```

- [ ] **5. lépés: A futáslista**

`web/app/pages/runs/index.vue`:

```vue
<script setup lang="ts">
const { data, error } = await useFetch('/api/runs')
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Futások</h1>
    <ErrorAlert v-if="error" :error="error" />
    <p v-else-if="data && data.length === 0" class="text-muted">Még nincs futásnapló.</p>
    <div v-else-if="data" class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left">
            <th class="py-1 pr-4">indulás</th>
            <th class="py-1 pr-4">parancs</th>
            <th class="py-1 pr-4">állapot</th>
            <th class="py-1 pr-4">egység</th>
            <th class="py-1 pr-4">sikeres / hibás</th>
            <th class="py-1 pr-4">költés</th>
            <th class="py-1 pr-4">időtartam</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in data" :key="run.runId" class="border-t border-default">
            <td class="py-1 pr-4">
              <NuxtLink :to="`/runs/${run.runId}`" class="underline">
                {{ run.startedAt ? formatDate(run.startedAt) : run.runId }}
              </NuxtLink>
            </td>
            <td class="py-1 pr-4 font-mono">{{ run.command ?? '–' }}</td>
            <td class="py-1 pr-4">
              <UBadge :color="runStatusColor(run.status)" variant="subtle">
                {{ runStatusLabel(run.status) }}
              </UBadge>
            </td>
            <td class="py-1 pr-4">{{ run.units ?? '–' }}</td>
            <td class="py-1 pr-4">{{ run.succeeded }} / {{ run.failed }}</td>
            <td class="py-1 pr-4">{{ formatUsd(run.spentUsd) }}</td>
            <td class="py-1 pr-4">{{ formatDuration(run.durationMs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
```

- [ ] **6. lépés: A futás oldala és az élő nézet**

`web/app/pages/runs/[runId].vue`:

```vue
<script setup lang="ts">
const route = useRoute()
const runId = computed(() => String(route.params.runId))
const { data, error, refresh } = await useFetch(
  () => `/api/runs/${encodeURIComponent(runId.value)}`,
)

// Futó futásnál az események SSE-n jönnek; lezártnál a teljes napló már a válaszban van.
const running = computed(() => data.value?.summary.status === 'running')
const { lines: liveLines, state: liveState, live, finished } = useRunStream(runId, running)

// A folyam végén a lezárt állapot a szerverről frissül (állapot, riport).
watch(finished, (value) => {
  if (value) void refresh()
})

const state = computed(() => liveState.value ?? data.value?.state ?? null)
const lines = computed(() => (liveLines.value.length > 0 ? liveLines.value : (data.value?.lines ?? [])))
const aborted = computed(() => state.value?.aborted ?? null)
const failures = computed(() => state.value?.recentFailures ?? [])
</script>

<template>
  <div class="space-y-6">
    <NuxtLink to="/runs" class="text-sm underline">← Futások</NuxtLink>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="font-mono text-xl font-semibold">{{ data.summary.command ?? data.summary.runId }}</h1>
        <UBadge :color="runStatusColor(data.summary.status)" variant="subtle">
          {{ runStatusLabel(data.summary.status) }}
        </UBadge>
        <UBadge v-if="live" color="info" variant="outline">élő</UBadge>
        <span class="text-sm text-muted">
          {{ formatDate(data.summary.startedAt) }} · {{ formatDuration(data.summary.durationMs) }}
        </span>
      </header>

      <RunStatePanel v-if="state" :state="state" />

      <UAlert
        v-if="aborted"
        color="warning"
        variant="subtle"
        title="A plafon miatt megállt"
        :description="aborted"
      />
      <UAlert v-if="failures.length > 0" color="error" variant="subtle" title="Friss hibák">
        <template #description>
          <ul class="space-y-1">
            <li v-for="failure in failures" :key="`${failure.itemId}-${failure.kind}`">
              {{ failure.itemId }} ({{ kindLabel(failure.kind) }}): {{ failure.error }}
            </li>
          </ul>
        </template>
      </UAlert>

      <section class="space-y-2">
        <h2 class="text-lg font-semibold">Idővonal</h2>
        <p v-if="data.summary.invalid > 0" class="text-sm text-warning">
          {{ data.summary.invalid }} értelmezhetetlen naplósor kimaradt.
        </p>
        <ol class="space-y-1 font-mono text-xs">
          <li v-for="(line, index) in lines" :key="index">
            <span class="text-muted">{{ line.at ? formatTime(line.at) : '–' }}</span>
            {{ line.type }}
            <span class="text-muted">{{ lineDetail(line) }}</span>
          </li>
        </ol>
      </section>

      <section v-if="data.reportHtml" class="space-y-2">
        <h2 class="text-lg font-semibold">Riport</h2>
        <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="note" v-html="data.reportHtml" />
      </section>
    </template>
  </div>
</template>
```

- [ ] **7. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm web:test
```

Várt: PASS.

- [ ] **8. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
mise exec -- pnpm web:typecheck && mise exec -- pnpm web:lint
```

- [ ] **9. lépés: Commit**

```bash
git add web/app web/test
```

Javasolt üzenet: `feat(web): a futások oldala és az élő nézet`, `Refs #28`.

---

## Feladat 16: A döntés, a dokumentáció és a záró ellenőrzés

**Fájlok:**
- Létrehoz: `docs/decisions/0011-webes-felulet-csak-olvas.md`
- Módosít: `docs/architecture.md`, `docs/roadmap.md`, `README.md`, `docs/README.md`

**Interfészek:**
- Fogyaszt: az 1–15. feladat eredményét.
- Termel: dokumentációt; a sikerkritériumok ellenőrzését.

- [ ] **1. lépés: A döntési rekord**

`docs/decisions/0011-webes-felulet-csak-olvas.md`:

```markdown
# 0011 — A webes felület csak olvas

**Dátum:** 2026-09-11 · **Státusz:** elfogadva

## A kérdés

A roadmap Fázis 5-je „áttekintő és átnéző réteget, élő haladásjelzéssel" ígér a
mag fölé. Nyitva maradt, mit tehet ez a felület: csak mutat, vagy futtat is? Kér-e
jóváhagyást, mielőtt egy jegyzet a vaultba kerül? Honnan kapja az adatot, és hol
marad meg a bíró indoklása, amit ma a futás végén eldobunk?

## A döntés

**A felület csak olvas.** Áttekintést és átnézést ad, és élőben követ egy
CLI-ből indított futást — de futást nem indít, nem szakít meg, és jóváhagyást
nem kér.

- Az adatot a mag csak olvasó rétegén át kapja: írásvédett állapottár-kapcsolat,
  nézetmodellek, a futásnapló követése. A `web/` szerverútvonalai egy-egy
  mag-függvényt hívnak.
- A bíró hiánylistája az állapottárba kerül, műtermékenként egy JSON-sorban.
- Csak a `127.0.0.1`-en figyel, hitelesítés nélkül.

## Mi döntötte el

**1. A futtatás és a válogatás már megvan.** A válogatás a queue-jegyzet dolga
(`0010`), az indítás a CLI-é. Egy böngészős indítás a futásvezérlés kiemelését
kérné a `cli.ts`-ből, és a `_queue.md` mellé második kiválasztási utat nyitna —
olyan igényre, ami nem jelentkezett.

**2. A jóváhagyás a publikálási utat változtatná meg.** A mag ma a küszöb alatti
jegyzetet is kiírja; egy jóváhagyási lépés ezt a szerződést írná át. Előbb
érdemes látni, mennyi és milyen jegyzet marad a küszöb alatt — ezt a felület
most megmutatja.

**3. Az adatlogika a magban tesztelhető.** A három megvizsgált út közül:

- *Nuxt a repóban, a mag olvasó rétegén át* — ezt választottuk: a lekérdezések
  és a követés logikája Vitesttel tesztelt, a típusok közösek, a felület vékony.
- *`refinery serve` a CLI-ben, statikus Nuxt-klienssel* — elvetve: kézzel
  építenénk meg a szervert, amit a Nitro ad.
- *Nuxt a CLI JSON-kimenetén át* — elvetve: minden nézethez új parancs és
  kérésenként folyamatindítás kellene.

**4. A hiánylista az állapottárba, nem a jegyzetbe kerül.** A frontmatterben
túlélné az állapotfájl törlését, de a bíró kritikája a tudásjegyzet része lenne,
és a vault kimeneti formátuma változna. Az egyetlen fogyasztója a felület.

## Következmények

- A mag új olvasó modulokat kap (`src/state/reader.ts`, `src/view/`,
  `src/run/follow.ts`), az állapottár egy új táblát (`artifact_gaps`).
- A futásnapló sorai időbélyeget kapnak, és két új eseményt: `run:started`,
  `run:ended`. A `item:generating` és az `item:scored` mostantól kibocsátódik.
- A változás előtt készült jegyzetekhez nincs hiánylista; csak `--force`
  újrafuttatással pótolható, valós költséggel.
- Spec: [`plans/2026-09-11-fazis-5-nuxt-felulet-spec.md`](<../plans/2026-09-11-fazis-5-nuxt-felulet-spec.md>).
```

- [ ] **2. lépés: Az architektúra**

A `docs/architecture.md`-ben:

A 3. fejezet ábráján cseréld le ezt a sort:

```
                   (mag)      (jegyzet I/O)          (SSE, később)
```

erre:

```
                   (mag)      (jegyzet I/O)          (csak olvas, SSE)
```

és az ábra utáni bekezdés végére, a „…sem csővezeték-logikát nem tartalmaznak."
mondat után fűzd hozzá:

```markdown
A Nuxt-felület ráadásul csak olvas: futást nem indít, és az állapottárat
írásvédett kapcsolaton nyitja meg ([`decisions/0011`](<./decisions/0011-webes-felulet-csak-olvas.md>)).
```

A 6. fejezetben cseréld le ezt:

```markdown
Három tábla elég:

| tábla | mit tárol |
|---|---|
| `videos` | felderített elemek és metaadatuk |
| `transcripts` | a szöveg származása, modell, szószámok |
| `artifacts` | recept, státusz, útvonal, iterációszám, pontszám, költség, hiba |
```

erre:

```markdown
Négy tábla:

| tábla | mit tárol |
|---|---|
| `items` | felderített elemek és metaadatuk |
| `transcripts` | a szöveg származása, szószámok |
| `artifacts` | recept, státusz, útvonal, iterációszám, pontszám, költség, hiba |
| `artifact_gaps` | a bíró hiánylistája műtermékenként, JSON-tömbként |

A felület az állapottárat írásvédett kapcsolaton olvassa (`openStateReader`),
ugyanazokkal a lekérdezésekkel, mint az író — ezért mutatja pontosan azt a
korpusz-állapotot, amit a futás riportja.
```

A 8. fejezet loop-listájában cseréld le ezt:

```markdown
5. Minden revízió perzisztálódik.
```

erre:

```markdown
5. A megtartott kimenet pontszáma, iterációszáma, költsége és hiánylistája
   rögzül; a köztes revíziók szövege nem.
```

A 12. fejezet „Futtatás" listájának végére, az „Újraindulás köteg közben" pont
után:

```markdown
- **A felület:** `mise exec -- pnpm web` lefordítja a magot és a felületet, és a
  `127.0.0.1:4310`-en indítja — kézzel, amikor nézni akarod; háttérszolgáltatás
  nincs. Egy futó CLI-köteg élőben követhető rajta: a futásnapló sorait SSE-n
  kapja.
```

- [ ] **3. lépés: A roadmap**

A `docs/roadmap.md`-ben a `## v2 és utána` sor elé illeszd be:

```markdown
**A Nuxt-felület — státusz: kész** (a dátumot a `date +%F` adja). Spec és terv:
[`plans/2026-09-11-fazis-5-nuxt-felulet-spec.md`](<./plans/2026-09-11-fazis-5-nuxt-felulet-spec.md>),
[`plans/2026-09-11-fazis-5-nuxt-felulet.md`](<./plans/2026-09-11-fazis-5-nuxt-felulet.md>).

**Kész, ha (Nuxt-felület):**

- A felület a `127.0.0.1`-en válaszol, a gép hálózati címén nem.
- Az áttekintő típusonkénti kész / hibás / hátra számai megegyeznek egy
  ugyanarra az állapotra futtatott `run` riportjának korpusz-állapotával.
- Egy a változás után generált receptjegyzet oldalán látszik a bíró
  hiánylistája, a jegyzet és a normalizált átirat egymás mellett.
- Egy CLI-ből indított futás élőben követhető; megszakítás után „megszakítva",
  kemény leállítás után „nyom nélkül leállt"; frissítés után egyetlen esemény
  sem ismétlődik.
- A felület nem ír: a vault munkafája a használata után tiszta.

```

A `(a dátumot a date +%F adja)` helyére írd be a `date +%F` kimenetét.

- [ ] **4. lépés: A README**

A `README.md` „Ami már fut" szakaszában a `A mérési harness (\`pnpm eval\`)`
kezdetű bekezdés elé illeszd be:

```markdown
A felület (`mise exec -- pnpm web`, `http://127.0.0.1:4310`) csak olvas. Az
áttekintő a korpusz állapotát, a pontszámok eloszlását receptenként és a
feldolgozási sort mutatja; az elem oldalán a jegyzet és a normalizált átirat
egymás mellett látszik, a bíró hiánylistájával — így kiderül, *miért* maradt egy
jegyzet a küszöb alatt. Egy CLI-ből indított futás élőben követhető: az éppen
feldolgozott elem, a pontszám és a költés a plafonhoz mérve, SSE-n.

```

Ugyanitt a `586 teszttel, 60 tesztfájlban` szöveget cseréld a
`mise exec -- pnpm test` kimenetének „Tests" és „Test Files" számaira, és
egészítsd ki: `, valamint a felület e2e-tesztjeivel (N teszt, M fájl)` — az N és
M a `mise exec -- pnpm web:test` kimenetéből.

A „Beállítás" kódblokk utolsó sora után, a blokkon belül:

```bash
mise exec -- pnpm web   # a felület: http://127.0.0.1:4310
```

- [ ] **5. lépés: A döntéstábla**

A `docs/README.md` döntéstáblájában a `0009`-es sor után:

```markdown
| [0010](<./decisions/0010-videonkenti-receptvalasztas.md>) | a receptválasztás egysége | videónként és receptenként, a feldolgozási sorból |
| [0011](<./decisions/0011-webes-felulet-csak-olvas.md>) | a webes felület szerepe | csak olvas: áttekintés, átnézés, élő követés; futtatás és jóváhagyás nélkül |
```

- [ ] **6. lépés: Teljes automatikus ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
mise exec -- pnpm web:test && mise exec -- pnpm web:typecheck && mise exec -- pnpm web:lint
```

- [ ] **7. lépés: Commit**

```bash
git add docs/decisions/0011-webes-felulet-csak-olvas.md docs/architecture.md docs/roadmap.md README.md docs/README.md
```

Javasolt üzenet: `docs: a Nuxt-felület döntése és dokumentációja`, `Closes #28`.

- [ ] **8. lépés: Záró ellenőrzés a felhasználóval — ingyenes rész**

Ezek a lépések a valódi korpuszon, modellhívás nélkül futnak. A felhasználóval
együtt végezd, mert böngészőben kell nézni.

**1. kritérium — a cím.** Ismételd meg a 11. feladat 9. lépését.

**2. kritérium — az áttekintő és a riport egyezése.** Egy nulla egységes,
commit nélküli futás riportot ír a korpusz-állapotról, modellhívás és vault-írás
nélkül:

```bash
mise exec -- pnpm build
mise exec -- node dist/cli.js run --limit 0 --no-commit
```

A kiírt riport „A korpusz állapota — transcript" szakaszának kész / hibás / hátra
számait vesd össze a felület áttekintőjének „átirat" oszlopával (futó
`mise exec -- pnpm web` mellett, a böngészőben). Egyezniük kell.

**5. és 6. kritérium — megszakítás, kemény leállítás, frissítés.** Ideiglenes
állapottárral és vaulttal, a valódi feliratmappán, recept nélkül (nincs
költség). Az ideiglenes konfigurációba a `sources:` sort a gyökér
`refinery.config.yaml`-jéből másold:

```bash
V=$(mktemp -d)
mkdir -p "$V/vault" && git -C "$V/vault" init -q
# "$V/refinery.config.yaml": vault.path = "$V/vault", sources = a valódi
# refinery.config.yaml sources listája, state.path = "$V/state.db",
# logs.dir = "$V/logs"
REFINERY_CONFIG="$V/refinery.config.yaml" mise exec -- pnpm web &
mise exec -- node dist/cli.js run --config "$V/refinery.config.yaml" --no-commit &
RUN_PID=$!
```

A felhasználó nyissa meg a `http://127.0.0.1:4310/runs` oldalt, lépjen a futó
futásra, és frissítse az oldalt futás közben: az idővonal folytatódik, egyetlen
sor sem ismétlődik. Ezután:

```bash
kill -INT "$RUN_PID"
```

Az oldalon az állapot „megszakítva". Indíts egy második futást ugyanígy, és
állítsd le keményen:

```bash
mise exec -- node dist/cli.js run --config "$V/refinery.config.yaml" --no-commit --force &
RUN_PID=$!
kill -9 "$RUN_PID"
```

A futáslistán az állapot „nyom nélkül leállt". Végül:

```bash
pkill -f ".output/server/index.mjs"
```

- [ ] **9. lépés: Záró ellenőrzés a felhasználóval — pénzt költő rész**

**Csak a felhasználó kifejezett jóváhagyásával.** Mondd el előtte: egyetlen
elemre fut a `summary` recept a valódi konfigurációval; a futás előtt kiírja a
becsült költséget; a konfiguráció `cost_limit_usd` plafonja alatt marad; a
jegyzetet a vaultba írja, commitolja és pusholja. A becslő a mérés szerint
akár 2,4-szer alá is becsülhet — a tényleges költést a LiteLLM `/key/info`
végpontja mutatja meg.

Jóváhagyás után, futó felület mellett:

```bash
mise exec -- pnpm web &
mise exec -- node dist/cli.js run --recipe summary --limit 1
```

- **5. kritérium:** a futás oldalán az éppen generált elem, a pontszám és a
  költés az esemény után legfeljebb egy másodperccel megjelenik.
- **3. kritérium:** a futás után az elem oldalán látszik a bíró hiánylistája (vagy
  „A bíró nem nevezett meg hiányt."), a jegyzet és a normalizált átirat egymás
  mellett, és a „Megnyitás Obsidianban" gomb Obsidianban nyitja meg a jegyzetet.
- **4. kritérium:** a futás hibátlanul lefutott és commitolt, és a vault munkafája
  tiszta:

```bash
git -C "$(mise exec -- node -e "import('./dist/index.js').then(async (m) => console.log(m.loadConfig(await m.readConfigFile('refinery.config.yaml'), 'refinery.config.yaml').vaultPath))")" status --short
```

Várt: üres kimenet. Végül `pkill -f ".output/server/index.mjs"`.

- [ ] **10. lépés: Push és PR**

Csak a felhasználó jóváhagyásával: `git push`, majd PR a `main`-re, a törzsben
`Closes #28`. A push előtt `gh auth status` — az aktív fióknak `pcsontos`-nak
kell lennie.

---

## Önellenőrzés

**1. Spec-lefedettség.**

| spec | feladat |
|---|---|
| Cél: csak olvas, csak helyben, a mag fogyasztója | Globális megkötések; 3. (írásvédett kapcsolat), 11. (`127.0.0.1`), 12–15. (vékony útvonalak) |
| Kiindulási állapot | „Amibe a kód beleütközik" |
| §1 Szerkezet és határok, behúzás, `exports` | 11. |
| §1 Konfiguráció: repó-gyökér, `REFINERY_CONFIG`, `validateConfig` nélkül | 1. (`baseDir`), 11. (`useRefineryConfig`) |
| §1 Eszközök | 11. (`web:*` scriptek, ESLint-kizárás) |
| §1 A három kockázat | a terv írásakor kipróbálva; 11. (a valódi repóban újra) |
| §2 Áttekintő | 9., 11., 14. |
| §2 Elemek, elem | 10., 12., 14. |
| §2 Hibák | 10., 12., 14. |
| §2 Futások és élő nézet | 7., 8., 13., 15. |
| §2 Renderelés nyers HTML nélkül | 12. |
| §3 A hiánylista az állapottárban | 2. |
| §3 Csak olvasó hozzáférés, közös lekérdezések | 3. |
| §3 Konfiguráció és export | 1., 3., 4., 7.–10. |
| §4 Időbélyeg a naplóban | 4. |
| §4 Új és bekötött események | 5., 6. |
| §4 A futás állapota | 7. |
| §4 Futásnaplók a magban, `followRunLog` | 4., 8. |
| §4 Az SSE-útvonal | 13. |
| §5 Hibakezelés | 3. (hiányzó/régi állapotfájl), 4. (sérült sor), 10. (hiányzó jegyzetfájl), 11. (konfigurációs hiba), 12–13. (404) |
| §6 Tesztelés | minden feladat; mutációk: 2., 3., 4., 7., 12. |
| §7 Parancsok | 11. |
| §7 Dokumentáció | 16. |
| Megkötések | Globális megkötések |
| Sikerkritérium 1 | 11. (9. lépés), 16. |
| Sikerkritérium 2 | 3. (közös lekérdezés), 9. (teszt), 16. (a valódi riporttal) |
| Sikerkritérium 3 | 2., 12., 14. (e2e), 16. (valódi futás) |
| Sikerkritérium 4 | 16. |
| Sikerkritérium 5 | 5., 7., 8., 13. (e2e), 16. |
| Sikerkritérium 6 | 13. (`Last-Event-ID` e2e), 16. |
| Sikerkritérium 7 | 5., 6. (a meglévő `e2e.test.ts` és `cli.test.ts` változatlanul zöld) |
| Sikerkritérium 8 | 2. (hiánylista cseréje), 3. (`readOnly`), 4. (`isRunId`), 7. (`run:aborted` előbb), 12. (`html: false`) |
| Sikerkritérium 9 | 16. |

**2. Helykitöltő-vizsgálat.** Nincs „TBD", „később" vagy „mint az N.
feladatban". Szándékosan a végrehajtáskor dől el, pontos paranccsal: a roadmap
dátuma (`date +%F`) és a README tesztszámai (`pnpm test`, `pnpm web:test`) — a
16. feladatban.

**3. Típus- és névkonzisztencia.**

- `ArtifactMetrics.gaps`, `gapsOf` (2.) — `selectGaps` (3.), `StateReader.gapsOf` (3.), `readItemDetail` (10.).
- `ItemRow`, `ArtifactRow`, `StateReader`, `openStateReader`, `openReadOnlyDatabase` (3.) — 9., 10.
- `RunLogLine`, `RunLogEntry`, `RunLogChunk`, `RunFiles`, `isRunId`, `listRuns`, `readRunEvents`, `parseEventId` (4.) — 7., 8., 13.
- `run:started { command, pid }`, `run:ended { interrupted }` (6.) — `runStatus` (7.), `followRunLog` (8.), a fixture (11.).
- `RunStatus`, `runStatus`, `isPidAlive` (7.) — `loadRun`, `readRuns`, `readRun` (8.), 13.
- `LiveRunState`, `liveRunState` (7.) — `summarizeRun` (7.), `followRunLog`, `RunDetail.state` (8.), `useRunStream`, `RunStatePanel` (15.).
- `RunSummaryView`, `summarizeRun` (7.); `loadRun`, `readRuns`, `RunDetail`, `readRun`, `findRun`, `FollowOptions`, `FollowedLine`, `followRunLog` (8.) — 9., 13., 15.
- `artifactKinds`, `Overview`, `readOverview` (9.) — 10., 11.
- `ItemListRow`, `ItemCell`, `ArtifactDetail`, `ItemDetail`, `readItems`, `readItemDetail`, `FailureGroup`, `readFailures` (10.) — 12., 14.
- `useRefineryConfig`, `coreHandler` (11.); `renderMarkdown` (12.) — 12., 13.
- `createFixture`, `FINISHED_RUN`, `RUNNING_RUN`, `Fixture.runningLog`, `Fixture.summaryNote` (11.) — 12., 13., 15.
- A formázók és az `ErrorAlert` (14.) — 15.

**4. Tudatos pontosítások a spechez képest** (a spec ennek megfelelően frissült):

- **A hiánylista műtermékenként egy JSON-sor**, nem hiányonként egy sor: csak így
  különböztethető meg a „rögzítve, üres" a „nincs rögzítve"-től, amit az elem
  oldalának ki kell írnia.
- **A terv a mag feladataival kezd**, mert a spec §1 három kockázatát a terv
  írásakor a repó eldobható klónjában kipróbáltuk; a tanulságok az „Amibe a kód
  beleütközik" részben.
- **Az SSE-üzenet `{ line, state }`**, és a folyam egy `end` eseménnyel zár: az
  állapot a magban (`liveRunState`) számolódik, a kliens csak megjeleníti; az
  `end` nélkül a böngésző a lezárt folyamra újra és újra csatlakozna.
- **A `readRunEvents` sorai `{ line, end }` párok**: az `end` offset az
  SSE-üzenet azonosítója.
- **A `StateReader` külön teljesköltség-metódus nélkül**: a `corpusStatus`
  `totalCostUsd`-je ugyanaz az összeg.
- **Az `openReadOnlyDatabase` exportált**, hogy a `readOnly` kapcsoló mutációval
  bizonyítható legyen.
- **Két e2e-tesztfájl** (`api.test.ts`, `errors.test.ts`): a hiányzó
  konfiguráció más környezet, és fájlonként csak egy `setup()` lehet.

## Ami ebbe a tervbe szándékosan nem fér bele

- **Futásindítás és -megszakítás a böngészőből** — a futásvezérlés kiemelése a
  `cli.ts`-ből (`decisions/0011`).
- **Jóváhagyás publikálás előtt** (a brief B5 kérdése).
- **Publikus vagy telepített demó**, szintetikus demó-adat, képernyőkép.
- **Hitelesítés és elérés más gépről.**
- **Keresés a jegyzetek szövegében, szerkesztés, export.**
- **Kritériumonkénti pontszám** — a `scoreRubric` csak az átlagot adja.
- **A változás előtti jegyzetek hiánylistája** — csak `--force` újrafuttatással,
  valós költséggel.
- **A relatív linkek feloldása a renderelt jegyzetben.**
- **Háttérszolgáltatásként futtatás** (launchd).
- **Erősebb védelem a pid-újrahasznosítás ellen** (a folyamat parancssorának
  ellenőrzése).
- **Külön issue-t érdemel:** az állapotfájl törlése után a `run --recipe` minden
  meglévő jegyzetért újra fizet, mert a `refine` a `publishNote`
  létezés-ellenőrzése előtt fut.
