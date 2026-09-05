# Fázis 1 — Első recept, LiteLLM-bekötés, mérési harness

> **Ágens-végrehajtóknak:** KÖTELEZŐ AL-SKILL: használd a
> `superpowers:subagent-driven-development` (ajánlott) vagy a
> `superpowers:executing-plans` skillt a terv feladatonkénti végrehajtásához.
> A lépések checkbox (`- [ ]`) szintaxist használnak a követéshez.

**Cél:** A normalizált átiratból modellel készül összefoglaló jegyzet a
vaultba — korlátos evaluator–optimizer loopban, a futás előtt kiírt és
kikényszerített költségplafon alatt, és a rubrika ugyanaz az objektum a
futásidejű javításban és a mérésben.

**Architektúra:** A Fázis 0 magja három új réteggel bővül. A **modellréteg**
(`src/model/`) egyetlen szűk interfész mögé zárja a LiteLLM-et: szerepet kap,
nem modellnevet, és minden hívás visszaadja a tényleges token-felhasználást. A
**receptréteg** (`src/recipe/`, `src/rubric/`, `src/refine/`) egy recept
promptjából és rubrikájából álló loopot futtat, ahol a rubrika pontszámot **és
konkrét hiánylistát** ad vissza — ugyanaz az objektum méri és javítja a
kimenetet. A **mérési harness** (`evals/`) ugyanezt a loopot futtatja egy
determinisztikus fixture-modellel, tehát kulcs és hálózat nélkül is valódi
pontszámokat ír ki.

**Tech stack:** A Fázis 0 stackje (TypeScript, Node 26.2.0, pnpm 11.24.0,
ESLint 10, `node:sqlite`, `zod`) kiegészülve: `ai@^7` és
`@ai-sdk/openai-compatible@^3` a modellhívásokhoz (futásidejű függőség),
`evalite@0.19.0` és `vitest@^4` a méréshez (fejlesztői függőség).

**Spec:** [`../architecture.md`](<../architecture.md>) (§8 receptmotor,
§11 költségkorlát), [`../evaluation.md`](<../evaluation.md>),
[`../roadmap.md`](<../roadmap.md>) (Fázis 1),
[`../decisions/0004-koltsegplafon.md`](<../decisions/0004-koltsegplafon.md>),
[`../decisions/0006-eval-stack.md`](<../decisions/0006-eval-stack.md>)

## Sikerkritériumok

A `roadmap.md` négy kritériuma. A terv utolsó feladata mindegyiket
megfigyelhető viselkedésként ellenőrzi:

1. A mérés egy **friss klónon, kulcs nélkül, offline** lefut a szintetikus
   fixture-ökön, és pontszámokat ír ki.
2. A minőségi kapu precisionje és recallja **szám formájában** megjelenik, és a
   határeset benne van a címkézett halmazban.
3. Egyetlen elemre futtatva jegyzet készül, aminek a frontmatterében ott a
   modell, az iterációszám és a pontszám.
4. Az előzetes becslés a futás **előtt** kiírja a becsült tokent és költséget,
   és a megadott plafon felett **el sem indul.**

---

## Globális megkötések

Minden feladat követelményei implicit módon tartalmazzák ezt a szakaszt.

- **Node `26.2.0`, pnpm `11.24.0`** — a `.mise.toml`-ból. Minden parancs
  `mise exec --` előtaggal fut, soha nem a shell PATH-ból.
- **A dokumentáció, a commit-üzenetek és a felhasználónak szóló kimenetek
  magyarul.** A kódazonosítók, típusnevek és a conventional commit előtagok
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) angolul.
- **A modellnek szóló promptok és a rubrika hiánylistái angolul.** Ez nem
  kivétel a fenti szabály alól, hanem következik belőle: a jegyzet nyelve a
  forrás nyelve (`architecture.md` §7), a hiánylista pedig visszamegy a
  javító promptba, tehát a generált szöveg nyelvén kell lennie. A CLI ezeket
  magyar keretben jeleníti meg, de a tartalmukat nem fordítja.
- **A commit-üzenetekbe nem kerül `Co-Authored-By` trailer.**
- **Modellnév a kódban sehol nem szerepel.** A receptek szerepet kérnek
  (`draft`, `judge`), a szerep→modell leképezés a konfigurációé
  (`decisions/0004`).
- **Köteg nem indul felső korlát nélkül.** Ez két külön kapu: plafon hiányában
  el sem indul, és a becslés a plafon felett sem indul el.
- **A vault linkelési szabálya kötelező:** minden Markdown-link célja
  szögletes zárójelben, `[Név](<./út.md>)`. Wikilink (`[[X]]`) **tilos**.
  Belső link emoji 📓, külső 🌐.
- **A vault-írás write-once:** létező fájlt soha nem írunk felül `--force`
  nélkül.
- **A Fázis 0 viselkedése nem változhat.** Recept nélkül futtatva a `scan` és
  a `run` bit-azonos kimenetet ad, és **egyetlen új környezeti változót sem
  követel meg.** A modell-konfiguráció csak akkor kötelező, ha recept fut.
- **TDD kötelező:** előbb bukó teszt, aztán a minimális implementáció.
- **Commit előtt `pnpm lint` és `pnpm typecheck` is fut, nem csak `pnpm test`.**
  Egy feladat akkor kész, ha mindhárom zöld.
- **Verziót csak `pnpm release` emel** (bumpp). Kézzel a `package.json`
  `version` mezőjéhez nem nyúlunk.

---

## Amit a megvalósítás előtt verifikáltunk

Az `architecture.md` §14 nyitott pontja szerint az Evalite aktuális API-ja a
megvalósítás előtt verifikálandó volt. Megtörtént, 2026-09-01-én, és négy
dolgot hozott, ami a tervet alakította:

| Mérés | Eredmény | Következmény |
|---|---|---|
| `evalite` verziók | stabil `0.19.0`; `1.0.0-beta.16` peer-je **`ai: ^6`** | A beta kiesik: a projekt `ai@7`-et használ. A `0.19.0` marad, pinnelve |
| `evalite` belső függősége | `@vitest/runner@^4`, a projekt vitest **3.2.7**-en van | Vitest 3→4 frissítés kell. **Kipróbálva: 19 fájl, 114 teszt zöld, nulla kódváltoztatás** |
| `evalite` tranzitív függősége | `better-sqlite3@^11` — **natív fordítás**, prebuild nélkül forrásból épült (~19 s) | `allowBuilds` bejegyzés és dokumentált C++ toolchain-előfeltétel kell. A mag futásidejű függősége továbbra is egyedül a `zod` |
| `process.loadEnvFile()` Node 26.2.0-n | létezik; **a már beállított változót nem írja felül**, hiányzó fájlra `ENOENT` | Az 1. feladat flag nélkül oldható meg, és a shell értéke erősebb a fájlénál |

Az `ai@7` API-ja szintén verifikálva: `createOpenAICompatible({ name, baseURL,
apiKey })`, `generateText`, strukturált kimenet `output: Output.object({ schema })`
alakban, `MockLanguageModelV4` az `ai/test` alatt.

---

## Fájlszerkezet

| Fájl | Felelősség |
|---|---|
| `src/types.ts` | *(bővül)* `ModelRole`, `MODEL_ROLES` |
| `src/config.ts` | *(bővül)* `loadDotEnv`, modell-konfiguráció külön, opcionális rétegként |
| `src/model/client.ts` | `ModelClient`: szerep → modell, szöveg- és objektumgenerálás, `usage` |
| `src/model/pricing.ts` | token → USD, szerepenkénti be/ki árakkal |
| `src/model/budget.ts` | szószámból becslés, a két plafon-kapu, futás közbeni összegzés |
| `src/rubric/types.ts` | `Score`, `Criterion`, `Rubric`, `scoreRubric` |
| `src/rubric/format.ts` | determinisztikus formátum-kritérium, nulla token |
| `src/rubric/judge.ts` | modell-bíró kritérium: hűség és lefedettség |
| `src/recipe/types.ts` | `Recipe`, `RecipeInput` |
| `src/recipe/summary.ts` | az első recept: prompt, javító prompt, rubrika |
| `src/recipe/registry.ts` | statikus registry: `RECIPES`, `getRecipe` |
| `src/refine/loop.ts` | evaluator–optimizer loop, iterációkorláttal és nem-javulási őrrel |
| `src/state/db.ts` | *(bővül)* `artifacts` migráció: `iterations`, `score`, `cost_usd`, `model` |
| `src/events.ts` | *(bővül)* becslés, megszakítás, generálás, pontozás eseményei |
| `src/vault/render.ts` | *(bővül)* `renderRecipeNote` |
| `src/vault/paths.ts` | *(bővül)* `recipeFile` — tetszőleges `_<típus>.md` testvér |
| `src/pipeline.ts` | *(bővül)* 6. lépés: recept futtatása és publikálása |
| `src/cli.ts` | *(bővül)* `--recipe`, becslés-kiírás, plafon-kapu |
| `evals/summary.eval.ts` | a teljes loop fixture-modellen, szintetikus feliratokon |
| `evals/fixtures/transcripts.ts` | publikus, kézzel írt szintetikus felirat-fixture-ök |
| `evals/fixtures/gate.ts` | a minőségi kapu publikus, címkézett halmaza |
| `evals/fixture-model.ts` | determinisztikus `ModelClient` egy fixture-höz |
| `evals/private-layer.ts` | a privát réteg betöltője; hiányában láthatóan kihagy |
| `evals/private/` | gitignore-olt privát mérőréteg (`fixtures.json`) |
| `src/normalize/gate.test.ts` | a minőségi kapu precisionje és recallja számmal |
| `.github/workflows/ci.yml` | typecheck, lint, test, build és az offline eval |
| `tsconfig.json` | *(bővül)* az `evals/` is típusellenőrzésre kerül; a `rootDir` átköltözik |
| `tsconfig.build.json` | *(bővül)* `rootDir: "src"` és `include`, hogy a build változatlan maradjon |

A tesztek a forrás mellett élnek: `src/**/*.test.ts`.

---

### Feladat 1: Az `.env` betöltése a CLI-ben

A Fázis 0 után maradt adósság. A `loadConfig` a `process.env`-ből dolgozik, de
semmi nem olvassa az `.env`-et, ezért minden futtatás
`node --env-file=.env dist/cli.js …` alakot igényel. A Fázis 1 ezt nem
halaszthatja tovább: innentől a LiteLLM alap-URL-je és kulcsa is környezetből
jön.

**Fájlok:**
- Módosít: `src/config.ts`, `src/cli.ts`
- Teszt: `src/config.test.ts`

**Interfészek:**
- Előállít: `loadDotEnv(path?: string): void`

> **Verifikált viselkedés.** A Node 26.2.0 `process.loadEnvFile()`-ja a **már
> beállított** környezeti változót **nem írja felül** — a shellben adott érték
> erősebb a fájlénál. Ez a helyes precedencia, és tesztként rögzítjük, mert
> enélkül egy elfelejtett `.env`-sor csendben felülbírálná a szándékos
> `VAULT_PATH=… refinery run` alakot. Hiányzó fájlra `ENOENT`-tel dob.

- [ ] **1. lépés: Írd meg a bukó tesztet**

Írd a meglévő `src/config.test.ts` végére:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDotEnv } from './config.js'

describe('loadDotEnv', () => {
  let dir: string
  const savedKeys = new Set(Object.keys(process.env))

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-env-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) {
      if (!savedKeys.has(key)) delete process.env[key]
    }
  })

  it('betölti a fájlban lévő változót', async () => {
    await writeFile(join(dir, '.env'), 'REFINERY_PROBA_A=fajlbol\n', 'utf8')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.REFINERY_PROBA_A).toBe('fajlbol')
  })

  it('a már beállított környezeti változót nem írja felül', async () => {
    process.env.REFINERY_PROBA_B = 'shellbol'
    await writeFile(join(dir, '.env'), 'REFINERY_PROBA_B=fajlbol\n', 'utf8')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.REFINERY_PROBA_B).toBe('shellbol')
  })

  it('hiányzó fájl esetén nem dob', () => {
    expect(() => loadDotEnv(join(dir, 'nincs-ilyen'))).not.toThrow()
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/config.test.ts`
Elvárt: FAIL — `loadDotEnv is not a function` (nincs exportálva).

- [ ] **3. lépés: Írd meg az implementációt**

`src/config.ts` — a meglévő importok mellé kell a `join`, ami már ott van. Az
új függvény a fájl elejére, a `NOTES_SUBDIR` konstans után:

```ts
/**
 * Betölti az `.env`-et, ha létezik.
 *
 * A `process.loadEnvFile()` a **már beállított** környezeti változókat nem
 * írja felül, tehát a shellben megadott érték erősebb a fájlénál — ez teszi
 * biztonságossá az egyszeri `VAULT_PATH=… refinery run` alakot.
 *
 * A hiányzó fájl nem hiba: CI-ban és automatizált futtatáskor a környezet
 * közvetlenül van beállítva. Minden más hiba (például szintaktikai) viszont
 * felszínre jön, mert egy csendben elnyelt elgépelés órákat visz el.
 */
export function loadDotEnv(path = join(process.cwd(), '.env')): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/config.test.ts`
Elvárt: PASS.

- [ ] **5. lépés: Kösd be a CLI-be**

`src/cli.ts` — az importhoz vedd fel a `loadDotEnv`-et:

```ts
import { loadConfig, loadDotEnv, validateConfig, type Config } from './config.js'
```

És **kizárólag a belépési pontban** hívd, nem a `main()`-ben:

```ts
const isEntrypoint = process.argv[1]?.endsWith('cli.js') ?? false
if (isEntrypoint) {
  loadDotEnv()
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message)
      process.exit(1)
    })
}
```

> **Miért nem a `main()`-ben:** a `main()` exportált és tesztelt. Ha ott
> töltené be az `.env`-et, a tesztek a fejlesztő valódi vaultjára mutató
> környezetet kapnának. A belépési pont a fájlrendszer-mellékhatások helye,
> a `main()` maradjon tiszta.

- [ ] **6. lépés: Exportáld az indexből**

`src/index.ts` — egészítsd ki a meglévő sort:

```ts
export { loadConfig, loadDotEnv, validateConfig, type Config } from './config.js'
```

- [ ] **7. lépés: Ellenőrizd a teljes készletet**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: mindhárom zöld, 117 teszt.

- [ ] **8. lépés: Commitolj**

```bash
git add src/config.ts src/config.test.ts src/cli.ts src/index.ts
git commit -m "feat(config): a CLI betölti az .env-et a Node beépített loadEnvFile-jával"
```

---

### Feladat 2: CI munkafolyamat

A másik Fázis 0 után maradt adósság. A repóban nincs `.github/`, tehát a
`test`/`typecheck`/`lint` hármas PR-en nem fut le automatikusan — pedig a
munkamenet PR-alapú. Ez a feladat az alapokat teszi le; a 15. feladat egészíti
ki az offline eval lépéssel, amikor az már létezik.

**Fájlok:**
- Létrehoz: `.github/workflows/ci.yml`

**Interfészek:**
- Előállít: egy `ellenorzes` nevű job, amit a 15. feladat egy lépéssel bővít.

> **Miért `mise-action`:** a projekt eszközverzióit a `.mise.toml` dönti el,
> nem a shell PATH (`architecture.md` §12). Ha a CI a saját
> `setup-node`-jával telepítene, a pinnelt `26.2.0` és a `11.24.0` csendben
> elcsúszhatna a lokálistól, és a CI zöldje mást bizonyítana, mint amit
> futtatunk.

- [ ] **1. lépés: Írd meg a munkafolyamatot**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  ellenorzes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Eszközök a .mise.toml-ból
        uses: jdx/mise-action@v4

      - name: Függőségek
        run: pnpm install --frozen-lockfile

      - name: Típusellenőrzés
        run: pnpm typecheck

      - name: Linter
        run: pnpm lint

      - name: Tesztek
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] **2. lépés: Ellenőrizd lokálisan, hogy ugyanaz a négy parancs zöld**

Futtasd:

```bash
mise exec -- pnpm typecheck && mise exec -- pnpm lint && mise exec -- pnpm test && mise exec -- pnpm build
```

Elvárt: mind a négy zöld. A CI nem futtat mást, tehát ha ez zöld, a CI is az
lesz — leszámítva a `--frozen-lockfile`-t, amit a következő lépés ellenőriz.

- [ ] **3. lépés: Ellenőrizd, hogy a lockfile naprakész**

Futtasd: `mise exec -- pnpm install --frozen-lockfile`
Elvárt: hiba nélkül lefut. Ha `ERR_PNPM_OUTDATED_LOCKFILE`-lal elhasal, a
`pnpm-lock.yaml` nincs szinkronban a `package.json`-nal — futtass egy sima
`pnpm install`-t, és commitold a lockfile-t is.

- [ ] **4. lépés: Commitolj**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck, lint, test és build minden PR-en"
```

> **Megfigyelhető siker:** a PR megnyitása után a GitHub felületén megjelenik
> az `ellenorzes` job, és zölden fut le. Ez a fájl létezésénél erősebb
> állítás — a fájl megléte semmit nem bizonyít.

---

### Feladat 3: Konfiguráció — modellszerepek, árak, költségplafon

**Fájlok:**
- Módosít: `src/types.ts`, `src/config.ts`, `.env.example`
- Teszt: `src/config.test.ts`

**Interfészek:**
- Előállít: `MODEL_ROLES`, `ModelRole` (a `src/types.ts`-ből);
  `ModelPricing`, `ModelConfig`,
  `loadModelConfig(env: Record<string, string | undefined>): ModelConfig`

> **A kulcsdöntés: külön réteg, nem bővített `Config`.** A modell-konfiguráció
> **nem** kerül bele a `loadConfig` sémájába. Ha belekerülne, a Fázis 0
> `scan` és `run` parancsa is megkövetelné a LiteLLM-kulcsot — ami megsértené
> a globális megkötést, hogy a Fázis 0 viselkedése változatlan marad. A
> `loadModelConfig` külön függvény, amit **csak akkor** hívunk meg, ha recept
> fut.

- [ ] **1. lépés: Írd meg a bukó tesztet**

Írd a `src/config.test.ts` végére:

```ts
import { loadModelConfig } from './config.js'

const TELJES_MODELL_ENV = {
  LITELLM_BASE_URL: 'http://localhost:4000/v1',
  LITELLM_API_KEY: 'sk-proba',
  REFINERY_MODEL_DRAFT: 'claude-sonnet-5',
  REFINERY_MODEL_JUDGE: 'grok-4-fast-reasoning',
  REFINERY_PRICE_DRAFT_IN: '3.00',
  REFINERY_PRICE_DRAFT_OUT: '15.00',
  REFINERY_PRICE_JUDGE_IN: '0.20',
  REFINERY_PRICE_JUDGE_OUT: '0.50',
  REFINERY_COST_LIMIT_USD: '5.00',
}

describe('loadModelConfig', () => {
  it('szerepenként képezi le a modellt és az árat', () => {
    const cfg = loadModelConfig(TELJES_MODELL_ENV)
    expect(cfg.models.draft).toBe('claude-sonnet-5')
    expect(cfg.models.judge).toBe('grok-4-fast-reasoning')
    expect(cfg.pricing.draft).toEqual({ inputPerMillion: 3, outputPerMillion: 15 })
    expect(cfg.pricing.judge).toEqual({ inputPerMillion: 0.2, outputPerMillion: 0.5 })
    expect(cfg.costLimitUsd).toBe(5)
  })

  it('a plafon hiányában elutasít — köteg nem indul felső korlát nélkül', () => {
    const { REFINERY_COST_LIMIT_USD: _elhagyva, ...env } = TELJES_MODELL_ENV
    expect(() => loadModelConfig(env)).toThrow(/REFINERY_COST_LIMIT_USD/)
  })

  it('a nulla plafont is elutasítja', () => {
    expect(() =>
      loadModelConfig({ ...TELJES_MODELL_ENV, REFINERY_COST_LIMIT_USD: '0' }),
    ).toThrow(/REFINERY_COST_LIMIT_USD/)
  })

  it('hiányzó kulcsra a változó nevét mondja meg', () => {
    const { LITELLM_API_KEY: _elhagyva, ...env } = TELJES_MODELL_ENV
    expect(() => loadModelConfig(env)).toThrow(/LITELLM_API_KEY/)
  })

  it('érvénytelen alap-URL-t elutasít', () => {
    expect(() =>
      loadModelConfig({ ...TELJES_MODELL_ENV, LITELLM_BASE_URL: 'nem-url' }),
    ).toThrow(/LITELLM_BASE_URL/)
  })

  it('a Fázis 0 loadConfigja nem követeli meg a modell-változókat', () => {
    const cfg = loadConfig({
      VAULT_PATH: '/vault',
      PINCHFLAT_DOWNLOADS: '/letoltesek',
    })
    expect(cfg.vaultPath).toBe('/vault')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/config.test.ts`
Elvárt: FAIL — `loadModelConfig is not a function`.

- [ ] **3. lépés: Vedd fel a szerep-típust**

`src/types.ts`, a fájl elejére, a `CAPTION_SOURCES` mellé:

```ts
/**
 * Modellszerep. A receptek szerepet kérnek, nem modellnevet — a konkrét
 * modell a konfigurációé, mert a választás mérési eredmény, nem vélemény
 * (`decisions/0004`).
 */
export const MODEL_ROLES = ['draft', 'judge'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]
```

- [ ] **4. lépés: Írd meg a `loadModelConfig`-ot**

`src/config.ts`, a fájl végére. Az importot egészítsd ki:

```ts
import type { ModelRole } from './types.js'
```

```ts
const ModelEnvSchema = z.object({
  LITELLM_BASE_URL: z.url('A LITELLM_BASE_URL érvényes URL kell legyen.'),
  LITELLM_API_KEY: z.string().min(1, 'A LITELLM_API_KEY kötelező.'),
  REFINERY_MODEL_DRAFT: z.string().min(1, 'A REFINERY_MODEL_DRAFT kötelező.'),
  REFINERY_MODEL_JUDGE: z.string().min(1, 'A REFINERY_MODEL_JUDGE kötelező.'),
  REFINERY_PRICE_DRAFT_IN: z.coerce.number().nonnegative(),
  REFINERY_PRICE_DRAFT_OUT: z.coerce.number().nonnegative(),
  REFINERY_PRICE_JUDGE_IN: z.coerce.number().nonnegative(),
  REFINERY_PRICE_JUDGE_OUT: z.coerce.number().nonnegative(),
  REFINERY_COST_LIMIT_USD: z.coerce
    .number()
    .positive('Kötelező és pozitív: köteg nem indul felső korlát nélkül.'),
})

/** USD egymillió tokenre vetítve. */
export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
}

export interface ModelConfig {
  baseUrl: string
  apiKey: string
  models: Record<ModelRole, string>
  pricing: Record<ModelRole, ModelPricing>
  /** Futásonkénti felső korlát dollárban. */
  costLimitUsd: number
}

/**
 * A modellréteg konfigurációja — **szándékosan külön** a `loadConfig`-tól.
 *
 * Ha ezek a `loadConfig` sémájában lennének, a modellhívás nélküli `scan` és
 * `run` is megkövetelné a LiteLLM-kulcsot. Így viszont a Fázis 0 útja egyetlen
 * új környezeti változó nélkül fut tovább, és a modell-konfigurációt csak az
 * fizeti meg, aki receptet futtat.
 */
export function loadModelConfig(
  env: Record<string, string | undefined>,
): ModelConfig {
  const parsed = ModelEnvSchema.safeParse(env)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    const name = first.path[0] ?? 'konfiguráció'
    throw new Error(`${String(name)}: ${first.message}`)
  }
  const e = parsed.data
  return {
    baseUrl: e.LITELLM_BASE_URL,
    apiKey: e.LITELLM_API_KEY,
    models: {
      draft: e.REFINERY_MODEL_DRAFT,
      judge: e.REFINERY_MODEL_JUDGE,
    },
    pricing: {
      draft: {
        inputPerMillion: e.REFINERY_PRICE_DRAFT_IN,
        outputPerMillion: e.REFINERY_PRICE_DRAFT_OUT,
      },
      judge: {
        inputPerMillion: e.REFINERY_PRICE_JUDGE_IN,
        outputPerMillion: e.REFINERY_PRICE_JUDGE_OUT,
      },
    },
    costLimitUsd: e.REFINERY_COST_LIMIT_USD,
  }
}
```

- [ ] **5. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/config.test.ts`
Elvárt: PASS, 6 új teszt.

- [ ] **6. lépés: Egészítsd ki az `.env.example`-t**

A meglévő `LITELLM_BASE_URL` / `LITELLM_API_KEY` blokk után:

```bash
# Szerep → modell. A receptek szerepet kérnek, nem modellnevet; a konkrét
# választás mérési eredmény lesz, nem vélemény (decisions/0004). Az itt
# szereplő páros védhető kiindulás, nem eldöntött érték: más gyártó a
# generátor és a bíró, tehát az önpreferencia-torzítás családszinten zárt.
REFINERY_MODEL_DRAFT=claude-sonnet-5
REFINERY_MODEL_JUDGE=grok-4-fast-reasoning

# USD egymillió tokenre, szerepenként be- és kimenetre. Azért környezetből
# és nem beégetett ártáblázatból, mert az avul.
REFINERY_PRICE_DRAFT_IN=3.00
REFINERY_PRICE_DRAFT_OUT=15.00
REFINERY_PRICE_JUDGE_IN=0.20
REFINERY_PRICE_JUDGE_OUT=0.50

# Futásonkénti költségplafon dollárban. Kötelező: köteg nem indul felső
# korlát nélkül. A korpusz mért mediánjából (3 017 normalizált szó) egy elem
# nagyjából 8 cent a fenti párossal, tehát a teljes 154 elemű korpusz ~12 $.
# Az 5,00-s alapértelmezés emiatt megállít egy teljes korpuszfutást, és
# kikényszeríti a szándékos felülbírálást.
REFINERY_COST_LIMIT_USD=5.00
```

- [ ] **7. lépés: Ellenőrizd a teljes készletet**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: mindhárom zöld.

- [ ] **8. lépés: Commitolj**

```bash
git add src/types.ts src/config.ts src/config.test.ts .env.example
git commit -m "feat(config): modellszerepek, árazás és futásonkénti költségplafon"
```

---

### Feladat 4: ModelClient — a LiteLLM egyetlen belépési pontja

**Fájlok:**
- Létrehoz: `src/model/client.ts`
- Módosít: `package.json` (`ai`, `@ai-sdk/openai-compatible`)
- Teszt: `src/model/client.test.ts`

**Interfészek:**
- Fogyaszt: `ModelRole` (Feladat 3), `ModelConfig` (Feladat 3)
- Előállít: `ModelUsage`, `ModelResult<T>`, `ModelClient`,
  `createModelClient(cfg: ModelConfig): ModelClient`,
  `modelClientFrom(models: Record<ModelRole, LanguageModel>): ModelClient`

> **Miért két gyártófüggvény:** a `createModelClient` a valódi LiteLLM-hez
> köt, a `modelClientFrom` tetszőleges `LanguageModel`-eket kap. Ez utóbbi
> teszi lehetővé a fixture-modellt a tesztekben és az evalben — ugyanaz a
> `ModelClient` fut mindkettőben, tehát a mérés a valódi kódutat méri, nem
> egy párhuzamos ágat.

- [ ] **1. lépés: Telepítsd a függőségeket**

```bash
mise exec -- pnpm add ai@^7 @ai-sdk/openai-compatible@^3
```

Ezek **futásidejű** függőségek, nem fejlesztőiek: a mag hívja őket.

- [ ] **2. lépés: Írd meg a bukó tesztet**

`src/model/client.test.ts`:

```ts
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { modelClientFrom } from './client.js'

/** Fixture-modell: rögzített szöveget ad vissza, rögzített használattal. */
function fixModell(text: string, inputTokens = 100, outputTokens = 20) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: {
        inputTokens: {
          total: inputTokens,
          noCache: inputTokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
      },
      warnings: [],
    }),
  })
}

describe('modelClientFrom', () => {
  it('szöveget generál, és visszaadja a token-felhasználást', async () => {
    const client = modelClientFrom({
      draft: fixModell('Ez a vázlat.', 120, 30),
      judge: fixModell('nem hívjuk'),
    })

    const result = await client.generate('draft', 'Írj vázlatot.')

    expect(result.value).toBe('Ez a vázlat.')
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
  })

  it('a szerep dönti el, melyik modell fut', async () => {
    const client = modelClientFrom({
      draft: fixModell('vázlat'),
      judge: fixModell('ítélet'),
    })

    expect((await client.generate('judge', 'Pontozz.')).value).toBe('ítélet')
  })

  it('sémával validált objektumot generál', async () => {
    const client = modelClientFrom({
      draft: fixModell('{"score":0.8,"gaps":["hiányzik a második pont"]}'),
      judge: fixModell('nem hívjuk'),
    })

    const schema = z.object({ score: z.number(), gaps: z.array(z.string()) })
    const result = await client.generateObject('draft', 'Pontozz.', schema)

    expect(result.value).toEqual({ score: 0.8, gaps: ['hiányzik a második pont'] })
    expect(result.usage.inputTokens).toBe(100)
  })
})
```

- [ ] **3. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/model/client.test.ts`
Elvárt: FAIL — `Cannot find module './client.js'`

- [ ] **4. lépés: Írd meg az implementációt**

`src/model/client.ts`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, generateText, type LanguageModel } from 'ai'
import type { ZodType } from 'zod'
import type { ModelConfig } from '../config.js'
import { MODEL_ROLES, type ModelRole } from '../types.js'

/** Egyetlen hívás tényleges token-felhasználása. */
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
}

export interface ModelResult<T> {
  value: T
  usage: ModelUsage
}

/**
 * A modellréteg teljes felülete. Szándékosan szűk: a mag ennél többet nem
 * tud a modellekről, tehát a LiteLLM lecserélése egyetlen fájl kérdése.
 */
export interface ModelClient {
  generate(role: ModelRole, prompt: string): Promise<ModelResult<string>>
  generateObject<T>(
    role: ModelRole,
    prompt: string,
    schema: ZodType<T>,
  ): Promise<ModelResult<T>>
}

/**
 * A használat mezői az AI SDK-ban opcionálisak, mert nem minden szolgáltató
 * küldi vissza őket. A hiányzó értéket nullának vesszük — a költségőr így a
 * legrosszabb esetben alábecsül, de sosem dob a futás közepén.
 */
function usageOf(usage: {
  inputTokens?: number
  outputTokens?: number
}): ModelUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  }
}

/** Szerep→modell leképezésből épít klienst. Ez a tesztelhető mag. */
export function modelClientFrom(
  models: Record<ModelRole, LanguageModel>,
): ModelClient {
  return {
    async generate(role, prompt) {
      const { text, usage } = await generateText({ model: models[role], prompt })
      return { value: text, usage: usageOf(usage) }
    },

    async generateObject(role, prompt, schema) {
      const { output, usage } = await generateText({
        model: models[role],
        prompt,
        output: Output.object({ schema }),
      })
      return { value: output, usage: usageOf(usage) }
    },
  }
}

/**
 * A valódi kliens: egyetlen OpenAI-kompatibilis provider a LiteLLM
 * alap-URL-jére. Az útválasztás, a tartalék-útvonal és a terheléselosztás a
 * gateway dolga, nem az alkalmazásé (`architecture.md` §13).
 */
export function createModelClient(cfg: ModelConfig): ModelClient {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
  })

  const models = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, provider(cfg.models[role])]),
  ) as Record<ModelRole, LanguageModel>

  return modelClientFrom(models)
}
```

- [ ] **5. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/model/client.test.ts`
Elvárt: PASS, 3 teszt.

> **Ha a `usage` alakja nem stimmel:** az AI SDK a szolgáltatói szinten
> (`doGenerate`) beágyazott alakot vár (`inputTokens: { total, … }`), a hívó
> szintjén viszont lapos `usage.inputTokens` számot ad vissza. A teszt a
> szolgáltatói alakot írja, az implementáció a laposat olvassa — ez
> szándékos. Ha a teszt mégis `undefined`-ot lát, írd ki a nyers `usage`
> objektumot, és igazítsd a `usageOf`-ot ahhoz, amit ténylegesen kapsz.

- [ ] **6. lépés: Ellenőrizd a teljes készletet**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: mindhárom zöld.

- [ ] **7. lépés: Commitolj**

```bash
git add package.json pnpm-lock.yaml src/model/client.ts src/model/client.test.ts
git commit -m "feat(model): ModelClient a LiteLLM elé, szerep alapú modellválasztással"
```

---

### Feladat 5: Árazás, előzetes becslés és a költségkapu

**Fájlok:**
- Létrehoz: `src/model/pricing.ts`, `src/model/budget.ts`
- Teszt: `src/model/pricing.test.ts`, `src/model/budget.test.ts`

**Interfészek:**
- Fogyaszt: `ModelUsage` (Feladat 4), `ModelConfig`, `ModelPricing` (Feladat 3)
- Előállít: `costOf(usage, pricing): number`, `TOKENS_PER_WORD`,
  `estimateItemUsd(words, maxIterations, cfg): number`,
  `estimateRunUsd(wordCounts, maxIterations, cfg): { usd; tokens }`,
  `CostGuard`, `createCostGuard(limitUsd): CostGuard`

> **A becslés azért lehetséges, mert ingyen van** (`decisions/0004`):
> normalizálás után a szószám modellhívás nélkül megszámolható, és az
> iterációkorlát miatt a szorzó felülről ismert. Enélkül a „köteg nem indul
> felső korlát nélkül" absztrakt szabály maradna; így konkrét szám a futás
> előtt.

- [ ] **1. lépés: Írd meg a bukó tesztet az árazásra**

`src/model/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TOKENS_PER_WORD, costOf } from './pricing.js'

describe('costOf', () => {
  it('millió tokenre vetített árból számol', () => {
    const usd = costOf(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { inputPerMillion: 3, outputPerMillion: 15 },
    )
    expect(usd).toBe(18)
  })

  it('arányosan számol a millió töredékére is', () => {
    const usd = costOf(
      { inputTokens: 10_000, outputTokens: 2_000 },
      { inputPerMillion: 3, outputPerMillion: 15 },
    )
    expect(usd).toBeCloseTo(0.06, 10)
  })

  it('nulla használat nulla költség', () => {
    expect(
      costOf({ inputTokens: 0, outputTokens: 0 }, { inputPerMillion: 3, outputPerMillion: 15 }),
    ).toBe(0)
  })

  it('a szó→token szorzó megnevezett konstans, nem szórt szám', () => {
    expect(TOKENS_PER_WORD).toBeGreaterThan(1)
    expect(TOKENS_PER_WORD).toBeLessThan(2)
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/model/pricing.test.ts`
Elvárt: FAIL — `Cannot find module './pricing.js'`

- [ ] **3. lépés: Írd meg az árazást**

`src/model/pricing.ts`:

```ts
import type { ModelPricing } from '../config.js'
import type { ModelUsage } from './client.js'

/**
 * Szó→token szorzó a becsléshez. Angol prózára nagyjából 1,3–1,4 token esik
 * egy szóra. Ez **becslés és nem mérés**: a tényleges elszámolás mindig a
 * modell válaszában visszaküldött `usage`-ből megy, ez a szám csak a futás
 * előtti kapuhoz kell.
 */
export const TOKENS_PER_WORD = 1.35

/** Token-felhasználás → dollár. */
export function costOf(usage: ModelUsage, pricing: ModelPricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  )
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/model/pricing.test.ts`
Elvárt: PASS, 4 teszt.

- [ ] **5. lépés: Írd meg a bukó tesztet a becslésre és az őrre**

`src/model/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { createCostGuard, estimateItemUsd, estimateRunUsd } from './budget.js'

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  costLimitUsd: 5,
}

describe('estimateItemUsd', () => {
  it('a hosszabb átirat drágább', () => {
    expect(estimateItemUsd(10_000, 2, CFG)).toBeGreaterThan(
      estimateItemUsd(1_000, 2, CFG),
    )
  })

  it('a több iteráció drágább', () => {
    expect(estimateItemUsd(3_000, 2, CFG)).toBeGreaterThan(
      estimateItemUsd(3_000, 0, CFG),
    )
  })

  it('a korpusz mediánjára reális nagyságrendet ad', () => {
    // 3 017 szó a valós korpusz mediánja. A becslés centes nagyságrend —
    // ha dollárokat vagy ezredcenteket adna, a szorzók elcsúsztak.
    const usd = estimateItemUsd(3_017, 2, CFG)
    expect(usd).toBeGreaterThan(0.01)
    expect(usd).toBeLessThan(1)
  })
})

describe('estimateRunUsd', () => {
  it('összegzi az elemeket, és tokent is ad', () => {
    const egy = estimateRunUsd([3_000], 2, CFG)
    const harom = estimateRunUsd([3_000, 3_000, 3_000], 2, CFG)
    expect(harom.usd).toBeCloseTo(egy.usd * 3, 10)
    expect(harom.tokens).toBe(egy.tokens * 3)
  })

  it('üres kötegre nullát ad', () => {
    expect(estimateRunUsd([], 2, CFG)).toEqual({ usd: 0, tokens: 0 })
  })
})

describe('createCostGuard', () => {
  it('összegzi a tényleges használatot szerepenként', () => {
    const guard = createCostGuard(5)
    guard.add('draft', { inputTokens: 1_000_000, outputTokens: 0 }, CFG)
    guard.add('judge', { inputTokens: 1_000_000, outputTokens: 0 }, CFG)
    expect(guard.spentUsd()).toBeCloseTo(3.2, 10)
  })

  it('a plafon alatt nem jelez túllépést', () => {
    const guard = createCostGuard(5)
    guard.add('draft', { inputTokens: 100_000, outputTokens: 0 }, CFG)
    expect(guard.exceeded()).toBe(false)
  })

  it('a plafon átlépésekor jelez', () => {
    const guard = createCostGuard(1)
    guard.add('draft', { inputTokens: 1_000_000, outputTokens: 0 }, CFG)
    expect(guard.exceeded()).toBe(true)
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/model/budget.test.ts`
Elvárt: FAIL — `Cannot find module './budget.js'`

- [ ] **7. lépés: Írd meg a becslést és az őrt**

`src/model/budget.ts`:

```ts
import type { ModelConfig } from '../config.js'
import type { ModelRole } from '../types.js'
import type { ModelUsage } from './client.js'
import { TOKENS_PER_WORD, costOf } from './pricing.js'

/**
 * A generált jegyzet hossza a bemenet töredéke. Egy összefoglaló nagyjából a
 * normalizált átirat tizede — ez felső becslés, tehát a kapu inkább
 * óvatosabb, mint megengedőbb.
 */
const OUTPUT_RATIO = 0.1

/** A rubrika modell-bíró kritériumainak száma (hűség és lefedettség). */
const JUDGE_CRITERIA = 2

/**
 * Egy elem becsült költsége dollárban.
 *
 * A `maxIterations` javítási kört jelent, tehát a generálások száma
 * `maxIterations + 1`. Minden generálás után lefut a rubrika, ami
 * kritériumonként egy bíró-hívást jelent; a bíró bemenete az átirat és a
 * vázlat együtt.
 */
export function estimateItemUsd(
  words: number,
  maxIterations: number,
  cfg: ModelConfig,
): number {
  const transcriptTokens = words * TOKENS_PER_WORD
  const outputTokens = transcriptTokens * OUTPUT_RATIO
  const generations = maxIterations + 1

  const draft = costOf(
    {
      inputTokens: transcriptTokens * generations,
      outputTokens: outputTokens * generations,
    },
    cfg.pricing.draft,
  )

  const judgeCalls = generations * JUDGE_CRITERIA
  const judge = costOf(
    {
      inputTokens: (transcriptTokens + outputTokens) * judgeCalls,
      // A bíró strukturált ítéletet ad: pontszám és néhány mondatnyi hiány.
      outputTokens: 200 * judgeCalls,
    },
    cfg.pricing.judge,
  )

  return draft + judge
}

/** A köteg becsült költsége és becsült összes tokene. */
export function estimateRunUsd(
  wordCounts: readonly number[],
  maxIterations: number,
  cfg: ModelConfig,
): { usd: number; tokens: number } {
  let usd = 0
  let tokens = 0
  for (const words of wordCounts) {
    usd += estimateItemUsd(words, maxIterations, cfg)
    tokens += Math.round(
      words * TOKENS_PER_WORD * (maxIterations + 1) * (1 + JUDGE_CRITERIA),
    )
  }
  return { usd, tokens }
}

export interface CostGuard {
  add(role: ModelRole, usage: ModelUsage, cfg: ModelConfig): void
  spentUsd(): number
  exceeded(): boolean
}

/**
 * A futás közbeni lágy kapu. A **tényleges** használati adatokból összegez,
 * nem a becslésből — a becslés tévedhet, ezért kell a második réteg
 * (`decisions/0004`).
 */
export function createCostGuard(limitUsd: number): CostGuard {
  let spent = 0
  return {
    add(role, usage, cfg) {
      spent += costOf(usage, cfg.pricing[role])
    },
    spentUsd: () => spent,
    exceeded: () => spent > limitUsd,
  }
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/model/budget.test.ts`
Elvárt: PASS, 8 teszt.

- [ ] **9. lépés: Ellenőrizd a teljes készletet**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: mindhárom zöld.

- [ ] **10. lépés: Commitolj**

```bash
git add src/model/pricing.ts src/model/pricing.test.ts src/model/budget.ts src/model/budget.test.ts
git commit -m "feat(model): előzetes költségbecslés és futás közbeni költségőr"
```

---

### Feladat 6: Recept- és rubrika-interfészek

**Fájlok:**
- Létrehoz: `src/rubric/types.ts`, `src/recipe/types.ts`
- Teszt: `src/rubric/types.test.ts`

**Interfészek:**
- Fogyaszt: `ModelClient`, `ModelUsage` (Feladat 4), `ModelRole` (Feladat 3),
  `SourceItem` (Fázis 0)
- Előállít: `Score`, `ScoreContext`, `Criterion`, `Rubric`, `RubricResult`,
  `scoreRubric(rubric, ctx, client): Promise<RubricResult>`;
  `Recipe`, `RecipeInput`, `RepairInput`

> **A rubrika hiányokat ad vissza, nem csak pontszámot** (`architecture.md`
> §8). Egy szám nem tud javítást vezérelni. Ez az a pont, ahol a mérőeszköz és
> az optimalizáló jel *ugyanaz az objektum* — ezért nem lakhat a rubrika a
> mérési keretrendszerben (`decisions/0006`).

> **A blokkoló kritérium kapu, nem pontozott összetevő.** A determinisztikus
> formátum-ellenőrzés fut először, és ha bukik, a drága bíró-hívások **el sem
> indulnak.** A végső pontszám a nem-blokkoló kritériumok átlaga — ha a
> formátum is beleszámítana, egy hibátlan formátumú, de hallucináló jegyzet
> mesterségesen magas pontot kapna.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/rubric/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { scoreRubric, type Criterion, type Rubric } from './types.js'

/** A kliens, amit ezekben a tesztekben nem szabad meghívni. */
const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}

function fixKriterium(
  name: string,
  value: number,
  gaps: string[] = [],
  blocking = false,
): Criterion {
  return { name, blocking, score: () => Promise.resolve({ value, gaps }) }
}

const CTX = { transcript: 'az átirat', output: 'a jegyzet' }

describe('scoreRubric', () => {
  it('a nem-blokkoló kritériumok átlagát adja', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('a', 1), fixKriterium('b', 0.5)],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.value).toBeCloseTo(0.75, 10)
  })

  it('összegyűjti minden kritérium hiányait', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('a', 0.5, ['első hiány']), fixKriterium('b', 0.5, ['második'])],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.gaps).toEqual(['első hiány', 'második'])
  })

  it('bukó blokkoló kritériumnál a drága kritériumok el sem indulnak', async () => {
    let futott = false
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () => {
        futott = true
        return Promise.resolve({ value: 1, gaps: [] })
      },
    }
    const rubric: Rubric = {
      criteria: [fixKriterium('formatum', 0, ['rossz formátum'], true), dragaKriterium],
      passThreshold: 0.8,
    }

    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)

    expect(futott).toBe(false)
    expect(result.value).toBe(0)
    expect(result.gaps).toEqual(['rossz formátum'])
  })

  it('átmenő blokkoló kritérium nem számít bele a pontszámba', async () => {
    const rubric: Rubric = {
      criteria: [fixKriterium('formatum', 1, [], true), fixKriterium('b', 0.5)],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.value).toBeCloseTo(0.5, 10)
  })

  it('összegzi a kritériumok token-felhasználását', async () => {
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () =>
        Promise.resolve({
          value: 1,
          gaps: [],
          usage: { inputTokens: 100, outputTokens: 10 },
        }),
    }
    const rubric: Rubric = {
      criteria: [dragaKriterium, dragaKriterium],
      passThreshold: 0.8,
    }
    const result = await scoreRubric(rubric, CTX, nemHivhatoKliens)
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 })
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/rubric/types.test.ts`
Elvárt: FAIL — `Cannot find module './types.js'`

- [ ] **3. lépés: Írd meg a rubrika-típusokat**

`src/rubric/types.ts`:

```ts
import type { ModelClient, ModelUsage } from '../model/client.js'

export interface Score {
  /** 0 és 1 közötti pontszám. */
  value: number
  /**
   * Konkrét, megnevezett hiányok. **Egy szám nem tud javítást vezérelni** —
   * ez a lista megy vissza a javító promptba.
   */
  gaps: string[]
  /** A kritérium modellhívásainak felhasználása; determinisztikusnál hiányzik. */
  usage?: ModelUsage
}

export interface ScoreContext {
  /** A normalizált átirat: a viszonyítási alap minden kritériumnál. */
  transcript: string
  /** A modell által generált jegyzettörzs. */
  output: string
  /** Kurált kulcspont-lista, ha van. A lefedettség ezt tekinti mérvadónak. */
  keyPoints?: string[]
}

export interface Criterion {
  name: string
  /**
   * Kapu, nem pontozott összetevő. Ha nem éri el az 1,0-t, a többi kritérium
   * el sem indul. A determinisztikus formátum-ellenőrzés helye — ez szűri ki
   * a hibák jelentős részét, mielőtt bármi drága elindulna.
   */
  blocking?: boolean
  score(ctx: ScoreContext, client: ModelClient): Promise<Score>
}

export interface Rubric {
  criteria: Criterion[]
  /** E fölött a kimenet elfogadott, és a loop megáll. */
  passThreshold: number
}

export interface RubricResult {
  value: number
  gaps: string[]
  usage: ModelUsage
}

/**
 * Lefuttatja a rubrikát. Előbb a kapuk, aztán a pontozott kritériumok — így
 * egy formátumhibás kimenet nulla bíró-hívásba kerül.
 */
export async function scoreRubric(
  rubric: Rubric,
  ctx: ScoreContext,
  client: ModelClient,
): Promise<RubricResult> {
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: ModelUsage | undefined): void => {
    if (!u) return
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }

  for (const criterion of rubric.criteria.filter((c) => c.blocking)) {
    const score = await criterion.score(ctx, client)
    add(score.usage)
    if (score.value < 1) {
      return { value: score.value, gaps: score.gaps, usage }
    }
  }

  const scored = rubric.criteria.filter((c) => !c.blocking)
  if (scored.length === 0) return { value: 1, gaps: [], usage }

  let total = 0
  const gaps: string[] = []
  for (const criterion of scored) {
    const score = await criterion.score(ctx, client)
    add(score.usage)
    total += score.value
    gaps.push(...score.gaps)
  }

  return { value: total / scored.length, gaps, usage }
}
```

- [ ] **4. lépés: Írd meg a recept-típusokat**

`src/recipe/types.ts`:

```ts
import type { Rubric } from '../rubric/types.js'
import type { ModelRole, SourceItem } from '../types.js'

export interface RecipeInput {
  item: SourceItem
  /** A normalizált átirat teljes szövege. */
  transcript: string
}

export interface RepairInput extends RecipeInput {
  /** Az előző kör kimenete, amit javítani kell. */
  previous: string
  /** A rubrika által megnevezett konkrét hiányok. */
  gaps: string[]
}

/**
 * Egy dokumentumtípus egy modul (`decisions/0002`). Erős alapértelmezések
 * mellett egy prózarecept nagyjából tíz sor, amiből kilenc maga a prompt.
 */
export interface Recipe {
  /** Az állapottárban és a `--recipe` kapcsolóban használt azonosító. */
  id: string
  /** A vault fájlnév-utótagja, például `_summary.md`. */
  outputFile: string
  /**
   * A publisher által kikényszerített invariáns, nem konvenció. Bizonyos
   * típusok — például cikkvázlat mások videójából — soha nem kerülhetnek
   * publikálási útra.
   */
  publishable: boolean
  /** Modellszerep, nem modellnév. */
  role: ModelRole
  /** Javító körök felső korlátja. Kettő javítás = három generálás. */
  maxIterations: number
  prompt(input: RecipeInput): string
  repairPrompt(input: RepairInput): string
  rubric: Rubric
}
```

- [ ] **5. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/rubric/types.test.ts`
Elvárt: PASS, 5 teszt.

- [ ] **6. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/rubric/types.ts src/rubric/types.test.ts src/recipe/types.ts
git commit -m "feat(rubric): rubrika- és receptinterfészek, kapu-elvű pontozással"
```

---

### Feladat 7: Formátum-kritérium — determinisztikus, nulla token

**Fájlok:**
- Létrehoz: `src/rubric/format.ts`
- Teszt: `src/rubric/format.test.ts`

**Interfészek:**
- Fogyaszt: `Criterion`, `Score` (Feladat 6), `lintVaultMarkdown` (Fázis 0)
- Előállít: `checkFormat(output: string): Score`, `formatCriterion: Criterion`

> **A vault linkszabálya egy helyen él.** A kritérium nem írja újra a
> szabályt, hanem a Fázis 0 `lintVaultMarkdown`-ját hívja — így a renderer és
> a rubrika nem tud elcsúszni egymástól. A hiányüzenetet viszont maga
> fogalmazza angolul, mert az visszamegy a modellnek.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/rubric/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkFormat, formatCriterion } from './format.js'

describe('checkFormat', () => {
  it('a szabályos jegyzetet elfogadja', () => {
    const result = checkFormat('## Main point\n\n- Something the speaker said.\n')
    expect(result.value).toBe(1)
    expect(result.gaps).toEqual([])
  })

  it('az üres kimenetet elutasítja', () => {
    const result = checkFormat('   \n  ')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/empty/i)
  })

  it('a wikilinket elutasítja', () => {
    const result = checkFormat('See [[Another Note]] for details.')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/wikilink/i)
  })

  it('a szögletes zárójel nélküli linkcélt elutasítja', () => {
    const result = checkFormat('See [the docs](https://example.com).')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/angle bracket/i)
  })

  it('a szögletes zárójeles linkcélt elfogadja', () => {
    const result = checkFormat('See [the docs](<https://example.com>).')
    expect(result.value).toBe(1)
  })

  it('a lezáratlan kódblokkot elutasítja', () => {
    const result = checkFormat('Example:\n\n```ts\nconst a = 1\n')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/code fence/i)
  })

  it('a lezárt kódblokkot elfogadja', () => {
    expect(checkFormat('```ts\nconst a = 1\n```\n').value).toBe(1)
  })

  it('a modell által kitett frontmattert elutasítja', () => {
    const result = checkFormat('---\ntitle: Valami\n---\n\n## Pont\n')
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/frontmatter/i)
  })

  it('minden hibát felsorol, nem csak az elsőt', () => {
    const result = checkFormat('See [[X]] and [docs](https://example.com).')
    expect(result.gaps.length).toBe(2)
  })
})

describe('formatCriterion', () => {
  it('blokkoló kritérium', () => {
    expect(formatCriterion.blocking).toBe(true)
  })

  it('a kontextus kimenetét pontozza, nem az átiratot', async () => {
    const score = await formatCriterion.score(
      { transcript: 'See [[X]]', output: '## Rendben\n' },
      { generate: () => Promise.reject(new Error('nem hívható')),
        generateObject: () => Promise.reject(new Error('nem hívható')) },
    )
    expect(score.value).toBe(1)
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/rubric/format.test.ts`
Elvárt: FAIL — `Cannot find module './format.js'`

- [ ] **3. lépés: Írd meg az implementációt**

`src/rubric/format.ts`:

```ts
import { lintVaultMarkdown } from '../vault/lint.js'
import type { Criterion, Score } from './types.js'

const FENCE = /^```/gm
const WIKILINK = /\[\[[^\]]+\]\]/

/**
 * Determinisztikus formátum-ellenőrzés: sima függvény, nulla token.
 *
 * Ez szűri ki a hibák jelentős részét, **mielőtt bármi drága elindulna**, és
 * a futásidejű optimalizáló loopban is ez ad először visszajelzést
 * (`evaluation.md` §2).
 *
 * A hiányüzenetek angolul vannak, mert visszamennek a modellnek a javító
 * promptban — a jegyzet nyelvén kell szólniuk.
 */
export function checkFormat(output: string): Score {
  const gaps: string[] = []
  const trimmed = output.trim()

  if (trimmed === '') {
    gaps.push('The note is empty.')
  }

  if (WIKILINK.test(output)) {
    gaps.push(
      'Wikilinks are forbidden in this vault. Remove every [[...]] link or write it as [Name](<./path.md>).',
    )
  }

  // A linkcél-szabály egyetlen implementációja a Fázis 0 lintere; itt csak
  // a modellnek szóló megfogalmazás készül hozzá.
  const linkErrors = lintVaultMarkdown(output).filter((e) => !e.startsWith('wikilink'))
  if (linkErrors.length > 0) {
    gaps.push(
      `Every Markdown link target must be wrapped in angle brackets, e.g. [Name](<https://example.com>). ${String(linkErrors.length)} link(s) break this.`,
    )
  }

  if ((output.match(FENCE)?.length ?? 0) % 2 !== 0) {
    gaps.push('There is an unclosed code fence: every ``` must be paired.')
  }

  if (trimmed.startsWith('---')) {
    gaps.push(
      'Do not emit YAML frontmatter. It is added separately, and a second block would corrupt the note.',
    )
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/**
 * Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak.
 */
export const formatCriterion: Criterion = {
  name: 'format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFormat(ctx.output)),
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/rubric/format.test.ts`
Elvárt: PASS, 11 teszt.

- [ ] **5. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/rubric/format.ts src/rubric/format.test.ts
git commit -m "feat(rubric): determinisztikus formátum-kapu modellhívás nélkül"
```

---

### Feladat 8: Bíró-kritériumok — hűség és lefedettség

**Fájlok:**
- Létrehoz: `src/rubric/judge.ts`
- Teszt: `src/rubric/judge.test.ts`

**Interfészek:**
- Fogyaszt: `Criterion`, `ScoreContext` (Feladat 6), `ModelClient` (Feladat 4)
- Előállít: `judgeCriterion(opts): Criterion`, `faithfulnessCriterion`,
  `coverageCriterion`

> **A hűség referencia nélküli:** a viszonyítási alap maga az átirat, nem egy
> elvárt kimenet. Ez a legfontosabb kritérium, mert a hallucináció itt a
> legkárosabb hibamód — egy jegyzet, ami olyat állít, ami nem hangzott el,
> rosszabb, mint a hiányzó jegyzet (`evaluation.md` §2).

> **A lefedettség kulcspont-listával dolgozik, ha van.** A Fázis 1 nem készít
> kurált listákat, ezért lista hiányában a bíró magából az átiratból vezeti
> le a fő pontokat ugyanabban a hívásban. Amikor a privát mérőréteg elkészül,
> csak a `keyPoints` mezőt kell megadni — kódváltoztatás nélkül.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/rubric/judge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { coverageCriterion, faithfulnessCriterion, judgeCriterion } from './judge.js'

/** Rögzített ítéletet adó kliens, ami elteszi a kapott promptot. */
function fixBiro(verdict: { score: number; gaps: string[] }) {
  const promptok: string[] = []
  const client: ModelClient = {
    generate: () => Promise.reject(new Error('a bíró objektumot ad, nem szöveget')),
    generateObject: (_role, prompt) => {
      promptok.push(prompt)
      return Promise.resolve({
        value: verdict as never,
        usage: { inputTokens: 500, outputTokens: 40 },
      })
    },
  }
  return { client, promptok }
}

const CTX = { transcript: 'The speaker said A and B.', output: '- A\n' }

describe('judgeCriterion', () => {
  it('az ítélet pontszámát és hiányait adja vissza', async () => {
    const { client } = fixBiro({ score: 0.5, gaps: ['B is missing'] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    const score = await criterion.score(CTX, client)

    expect(score.value).toBe(0.5)
    expect(score.gaps).toEqual(['B is missing'])
  })

  it('visszaadja a bíró token-felhasználását', async () => {
    const { client } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    const score = await criterion.score(CTX, client)

    expect(score.usage).toEqual({ inputTokens: 500, outputTokens: 40 })
  })

  it('a promptba az átirat és a jegyzet is bekerül', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    await criterion.score(CTX, client)

    expect(promptok[0]).toContain('The speaker said A and B.')
    expect(promptok[0]).toContain('- A')
    expect(promptok[0]).toContain('Grade it.')
  })

  it('a kulcspont-lista bekerül a promptba, ha van', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    await criterion.score({ ...CTX, keyPoints: ['Point one', 'Point two'] }, client)

    expect(promptok[0]).toContain('Point one')
    expect(promptok[0]).toContain('Point two')
  })

  it('kulcspont-lista nélkül nem kerül be üres szakasz', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    await criterion.score(CTX, client)

    expect(promptok[0]).not.toContain('MAIN POINTS')
  })

  it('a bíró a judge szerepet kapja, nem a draftot', async () => {
    const szerepek: string[] = []
    const client: ModelClient = {
      generate: () => Promise.reject(new Error('nem hívható')),
      generateObject: (role) => {
        szerepek.push(role)
        return Promise.resolve({
          value: { score: 1, gaps: [] } as never,
          usage: { inputTokens: 1, outputTokens: 1 },
        })
      },
    }

    await judgeCriterion({ name: 'proba', instruction: 'Grade.' }).score(CTX, client)

    expect(szerepek).toEqual(['judge'])
  })
})

describe('a két szállított kritérium', () => {
  it('egyik sem blokkoló — a modellhívás nem lehet kapu', () => {
    expect(faithfulnessCriterion.blocking).toBeUndefined()
    expect(coverageCriterion.blocking).toBeUndefined()
  })

  it('megkülönböztethető nevük van', () => {
    expect(faithfulnessCriterion.name).toBe('faithfulness')
    expect(coverageCriterion.name).toBe('coverage')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/rubric/judge.test.ts`
Elvárt: FAIL — `Cannot find module './judge.js'`

- [ ] **3. lépés: Írd meg az implementációt**

`src/rubric/judge.ts`:

```ts
import { z } from 'zod'
import type { Criterion, ScoreContext } from './types.js'

/**
 * A bíró strukturált ítélete. A séma kényszeríti ki, hogy pontszám **és**
 * hiánylista is legyen — enélkül a modell hajlamos csak számot adni, és a
 * loop nem tudna miből javítani.
 */
const Verdict = z.object({
  score: z.number().min(0).max(1),
  gaps: z.array(z.string()),
})

function buildPrompt(instruction: string, ctx: ScoreContext): string {
  const parts = [instruction, '', '--- TRANSCRIPT ---', ctx.transcript]

  if (ctx.keyPoints && ctx.keyPoints.length > 0) {
    parts.push(
      '',
      '--- MAIN POINTS (authoritative) ---',
      ...ctx.keyPoints.map((point) => `- ${point}`),
    )
  }

  parts.push('', '--- NOTES UNDER REVIEW ---', ctx.output)
  return parts.join('\n')
}

/**
 * Modell-bíró kritérium. Az értékelő szerep alapból **más modell**, mint a
 * generáló: ha ugyanaz a modell pontozná a saját kimenetét, az
 * önpreferencia-torzítás miatt a mérés kevesebbet érne (`architecture.md` §8).
 */
export function judgeCriterion(opts: {
  name: string
  instruction: string
}): Criterion {
  return {
    name: opts.name,
    async score(ctx, client) {
      const { value, usage } = await client.generateObject(
        'judge',
        buildPrompt(opts.instruction, ctx),
        Verdict,
      )
      return { value: value.score, gaps: value.gaps, usage }
    },
  }
}

export const faithfulnessCriterion = judgeCriterion({
  name: 'faithfulness',
  instruction: [
    'You are grading a set of notes against the transcript they were written from.',
    '',
    'Rule: every claim in the notes must be traceable to the transcript. A claim',
    'that is true in general but never stated in the transcript is a failure, not',
    'a bonus. Paraphrase is fine; invention is not.',
    '',
    'Return a score between 0 and 1, where 1 means every claim is supported.',
    'List each unsupported claim as its own gap, quoting the offending phrase.',
    'An empty gap list means the notes are fully supported.',
  ].join('\n'),
})

export const coverageCriterion = judgeCriterion({
  name: 'coverage',
  instruction: [
    "You are grading a set of notes for coverage of the transcript's main points.",
    '',
    'If a list of main points is given below, treat it as authoritative and do',
    'not derive your own. Otherwise, first determine the main points of the',
    'transcript yourself, then check which of them the notes cover.',
    '',
    'Return a score between 0 and 1, where 1 means every main point is covered.',
    'List each missing main point as its own gap, stated concretely enough that',
    'a writer could add it without re-reading the transcript.',
  ].join('\n'),
})
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/rubric/judge.test.ts`
Elvárt: PASS, 8 teszt.

- [ ] **5. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/rubric/judge.ts src/rubric/judge.test.ts
git commit -m "feat(rubric): hűség- és lefedettség-bíró strukturált ítélettel"
```

---

### Feladat 9: A `summary` recept és a registry

**Fájlok:**
- Létrehoz: `src/recipe/summary.ts`, `src/recipe/registry.ts`
- Teszt: `src/recipe/summary.test.ts`, `src/recipe/registry.test.ts`

**Interfészek:**
- Fogyaszt: `Recipe`, `RecipeInput`, `RepairInput` (Feladat 6),
  `formatCriterion` (Feladat 7), `faithfulnessCriterion`, `coverageCriterion`
  (Feladat 8)
- Előállít: `summaryRecipe: Recipe`, `RECIPES`, `RECIPE_IDS`,
  `getRecipe(id: string): Recipe`

> **A recept nem kerülhet be a rubrikája nélkül.** Ez a szabály végigmegy
> minden fázison (`roadmap.md`), és itt válik kikényszeríthetővé: a `Recipe`
> interfész `rubric` mezője kötelező, tehát rubrika nélküli recept nem
> fordul le.

> **Nincs plugin-loader.** A registry egy indexfájl, ami statikusan importálja
> a recepteket. Néhány tucat elemnél a dinamikus betöltés csak a fordítási
> idejű típusbiztonságot venné el (`architecture.md` §5).

- [ ] **1. lépés: Írd meg a bukó tesztet a receptre**

`src/recipe/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { summaryRecipe } from './summary.js'

const ITEM: SourceItem = {
  videoId: 'abc123',
  title: 'Agent orchestration explained',
  channel: 'Some Channel',
  uploadedAt: '2026-07-14',
  url: 'https://www.youtube.com/watch?v=abc123',
  subtitlePath: '/nem/szamit.srt',
  mediaPath: null,
}

const INPUT = { item: ITEM, transcript: 'The speaker explains A, then B.' }

describe('summaryRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(summaryRecipe.id).toBe('summary')
    expect(summaryRecipe.outputFile).toBe('_summary.md')
  })

  it('publikálható, és a draft szerepet kéri', () => {
    expect(summaryRecipe.publishable).toBe(true)
    expect(summaryRecipe.role).toBe('draft')
  })

  it('alapból két javító kört enged, tehát három generálást', () => {
    expect(summaryRecipe.maxIterations).toBe(2)
  })

  it('rubrikája mindhárom kritériumot tartalmazza, a formátumot elsőként', () => {
    const nevek = summaryRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'faithfulness', 'coverage'])
    expect(summaryRecipe.rubric.criteria[0]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat, a cím és a csatorna', () => {
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toContain('The speaker explains A, then B.')
    expect(prompt).toContain('Agent orchestration explained')
    expect(prompt).toContain('Some Channel')
  })

  it('a prompt megtiltja a fordítást — a jegyzet nyelve a forrás nyelve', () => {
    expect(summaryRecipe.prompt(INPUT)).toMatch(/do not translate/i)
  })

  it('a prompt megtiltja a frontmattert és a wikilinket', () => {
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toMatch(/frontmatter/i)
    expect(prompt).toMatch(/wikilink/i)
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = summaryRecipe.repairPrompt({
      ...INPUT,
      previous: '## Korábbi jegyzet',
      gaps: ['B is missing', 'Claim X is unsupported'],
    })
    expect(prompt).toContain('B is missing')
    expect(prompt).toContain('Claim X is unsupported')
    expect(prompt).toContain('## Korábbi jegyzet')
    expect(prompt).toContain('The speaker explains A, then B.')
  })

  it('a javító prompt megtartásra utasít, nem újraírásra', () => {
    const prompt = summaryRecipe.repairPrompt({
      ...INPUT,
      previous: 'x',
      gaps: ['y'],
    })
    expect(prompt).toMatch(/do not rewrite/i)
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/recipe/summary.test.ts`
Elvárt: FAIL — `Cannot find module './summary.js'`

- [ ] **3. lépés: Írd meg a receptet**

`src/recipe/summary.ts`:

```ts
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import { formatCriterion } from '../rubric/format.js'
import type { Recipe } from './types.js'

/**
 * A közös szabályok. Mindkét prompt ugyanezeket idézi, mert a javító kör
 * ugyanazokat a megkötéseket kell hogy betartsa — enélkül a második
 * generálás kijavítaná a tartalmi hiányt, és közben elrontaná a formátumot.
 */
const RULES = [
  '- Write in the same language as the transcript. Do not translate.',
  '- Every statement must be traceable to the transcript. Do not add outside',
  '  knowledge, and do not speculate about what the speaker meant.',
  '- Open with a short paragraph on what the video is about, then use `##`',
  '  sections with bullet points for the substance.',
  '- Do not emit YAML frontmatter; it is added separately.',
  '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
  '  brackets: `[Name](<https://example.com>)`.',
  "- Aim for roughly a tenth of the transcript's length.",
].join('\n')

/**
 * Az első recept: strukturált tanulójegyzet a normalizált átiratból.
 *
 * A `_summary.md` utótag a vault bejáratott névkonvenciója
 * (`Youtube - <cím>_<típus>.md`), tehát a kimenet a meglévő fájlok mellé
 * illeszkedik, nem egy külön beérkező mappába.
 */
export const summaryRecipe: Recipe = {
  id: 'summary',
  outputFile: '_summary.md',
  publishable: true,
  role: 'draft',
  maxIterations: 2,

  prompt: ({ item, transcript }) =>
    [
      'Write structured study notes from the transcript of the video below.',
      '',
      'Rules:',
      RULES,
      '',
      `Title: ${item.title}`,
      `Channel: ${item.channel}`,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the notes below. A reviewer scored them against the transcript and',
      'listed concrete gaps. Fix every gap. Keep what already works — do not',
      'rewrite the notes wholesale.',
      '',
      'The original rules still apply:',
      RULES,
      '',
      `Title: ${item.title}`,
      `Channel: ${item.channel}`,
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT NOTES ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [formatCriterion, faithfulnessCriterion, coverageCriterion],
    // A két bíró-kritérium átlaga. A 0,8 azt jelenti: a hűség és a
    // lefedettség együtt legfeljebb egy közepes hiányt viselhet el.
    passThreshold: 0.8,
  },
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/recipe/summary.test.ts`
Elvárt: PASS, 9 teszt.

- [ ] **5. lépés: Írd meg a bukó tesztet a registryre**

`src/recipe/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RECIPES, RECIPE_IDS, getRecipe } from './registry.js'

describe('registry', () => {
  it('azonosító alapján adja vissza a receptet', () => {
    expect(getRecipe('summary').id).toBe('summary')
  })

  it('ismeretlen azonosítóra felsorolja az ismerteket', () => {
    expect(() => getRecipe('nincs-ilyen')).toThrow(/nincs-ilyen/)
    expect(() => getRecipe('nincs-ilyen')).toThrow(/summary/)
  })

  it('a kulcs mindig megegyezik a recept saját azonosítójával', () => {
    for (const [id, recipe] of Object.entries(RECIPES)) {
      expect(recipe.id).toBe(id)
    }
  })

  it('minden receptnek van rubrikája — recept nem kerülhet be a rubrikája nélkül', () => {
    for (const recipe of Object.values(RECIPES)) {
      expect(recipe.rubric.criteria.length).toBeGreaterThan(0)
    }
  })

  it('a Fázis 1-ben pontosan egy recept van', () => {
    expect(RECIPE_IDS).toEqual(['summary'])
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/recipe/registry.test.ts`
Elvárt: FAIL — `Cannot find module './registry.js'`

- [ ] **7. lépés: Írd meg a registryt**

`src/recipe/registry.ts`:

```ts
import { summaryRecipe } from './summary.js'
import type { Recipe } from './types.js'

/**
 * Statikus registry: egy indexfájl importálja az összes receptet. Nincs
 * plugin-loader és nincs dinamikus betöltés — néhány tucat elemnél az csak a
 * fordítási idejű típusbiztonságot venné el (`architecture.md` §5).
 *
 * Új prózarecept felvétele ezért **pontosan két sor**: egy import és egy
 * bejegyzés. A motorhoz nem kell nyúlni.
 */
export const RECIPES: Record<string, Recipe> = {
  [summaryRecipe.id]: summaryRecipe,
}

export const RECIPE_IDS: string[] = Object.keys(RECIPES)

export function getRecipe(id: string): Recipe {
  const recipe = RECIPES[id]
  if (!recipe) {
    throw new Error(
      `Ismeretlen recept: ${id}. Ismert receptek: ${RECIPE_IDS.join(', ')}.`,
    )
  }
  return recipe
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/recipe/registry.test.ts`
Elvárt: PASS, 5 teszt.

- [ ] **9. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/recipe/summary.ts src/recipe/summary.test.ts src/recipe/registry.ts src/recipe/registry.test.ts
git commit -m "feat(recipe): summary recept és statikus recept-registry"
```

---

### Feladat 10: Az evaluator–optimizer loop

**Fájlok:**
- Létrehoz: `src/refine/loop.ts`
- Teszt: `src/refine/loop.test.ts`

**Interfészek:**
- Fogyaszt: `Recipe`, `RecipeInput` (Feladat 6), `scoreRubric` (Feladat 6),
  `ModelClient`, `ModelUsage` (Feladat 4)
- Előállít: `RefineResult`, `RefineOptions`,
  `refine(recipe, input, client, opts?): Promise<RefineResult>`

> **Ez a fázis legkockázatosabb logikája**, és ezért fut végig fixture-modellen
> minden ága. A négy megkötés (`architecture.md` §8) mindegyike egy valós
> hibamódra válaszol:
>
> - **Korlátos:** alapból legfeljebb két javító kör, tehát három generálás. A
>   költség így felülről becsülhető — enélkül az előzetes becslés nem volna
>   érvényes.
> - **A rubrika hiányokat ad vissza**, és azok mennek vissza a promptba.
> - **Az értékelő az átirat ellen pontoz**, nem a vázlat önmagában vett
>   meggyőző erejéhez képest.
> - **Nem-javulási őr:** ha egy iteráció rosszabb az előzőnél, a jobbat
>   tartjuk meg és megállunk. Enélkül a loop elkóborol — ez a minta tipikus
>   csendes hibája.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/refine/loop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import type { Recipe } from '../recipe/types.js'
import type { Criterion } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { refine } from './loop.js'

const ITEM: SourceItem = {
  videoId: 'abc123',
  title: 'Cím',
  channel: 'Csatorna',
  uploadedAt: '2026-07-14',
  url: 'https://example.com',
  subtitlePath: '/nem/szamit.srt',
  mediaPath: null,
}

const INPUT = { item: ITEM, transcript: 'az átirat' }

/**
 * Kliens, ami a generáláskor sorban adja vissza a szövegeket, a pontozáskor
 * pedig a szöveghez rendelt pontszámot. Így a loop minden ága vezérelhető.
 */
function scriptedClient(script: { text: string; score: number }[]) {
  let i = 0
  const generalt: string[] = []
  const promptok: string[] = []
  const pontszamok = new Map(script.map((s) => [s.text, s.score]))

  const client: ModelClient = {
    generate: (_role, prompt) => {
      const step = script[Math.min(i, script.length - 1)]!
      i++
      promptok.push(prompt)
      generalt.push(step.text)
      return Promise.resolve({
        value: step.text,
        usage: { inputTokens: 100, outputTokens: 10 },
      })
    },
    generateObject: () => Promise.reject(new Error('a teszt-rubrika nem hív modellt')),
  }

  return { client, generalt, promptok, pontszamok }
}

/** Rubrika, ami a kimenet szövegéhez rendelt pontszámot adja vissza. */
function tablazatosRubrika(pontszamok: Map<string, number>): Criterion[] {
  return [
    {
      name: 'proba',
      score: (ctx) =>
        Promise.resolve({
          value: pontszamok.get(ctx.output) ?? 0,
          gaps: ['valami hiányzik'],
        }),
    },
  ]
}

function recept(criteria: Criterion[], maxIterations = 2): Recipe {
  return {
    id: 'proba',
    outputFile: '_proba.md',
    publishable: true,
    role: 'draft',
    maxIterations,
    prompt: () => 'ELSŐ PROMPT',
    repairPrompt: ({ gaps }) => `JAVÍTÓ PROMPT: ${gaps.join(', ')}`,
    rubric: { criteria, passThreshold: 0.8 },
  }
}

describe('refine', () => {
  it('elsőre átmenő kimenetnél egyetlen generálás történik', async () => {
    const { client, generalt, pontszamok } = scriptedClient([{ text: 'jó', score: 0.9 }])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.generations).toBe(1)
    expect(result.output).toBe('jó')
    expect(result.score).toBe(0.9)
    expect(generalt).toEqual(['jó'])
  })

  it('javuló második körnél a jobbat adja vissza', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.generations).toBe(2)
    expect(result.output).toBe('jobb')
    expect(result.score).toBe(0.9)
  })

  it('a hiányok bekerülnek a javító promptba', async () => {
    const { client, promptok, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(promptok[0]).toBe('ELSŐ PROMPT')
    expect(promptok[1]).toBe('JAVÍTÓ PROMPT: valami hiányzik')
  })

  it('nem-javulási őr: rosszabb kört eldob, és megáll', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'kozepes', score: 0.6 },
      { text: 'rosszabb', score: 0.3 },
      { text: 'sosem-jut-idaig', score: 1 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.output).toBe('kozepes')
    expect(result.score).toBe(0.6)
    expect(generalt).toEqual(['kozepes', 'rosszabb'])
  })

  it('az azonos pontszámú kört is megállásnak veszi', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'a', score: 0.6 },
      { text: 'b', score: 0.6 },
      { text: 'c', score: 1 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.output).toBe('a')
    expect(generalt).toEqual(['a', 'b'])
  })

  it('az iterációkorlát legfeljebb három generálást enged', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'a', score: 0.1 },
      { text: 'b', score: 0.2 },
      { text: 'c', score: 0.3 },
      { text: 'd', score: 0.4 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.generations).toBe(3)
    expect(generalt).toEqual(['a', 'b', 'c'])
    expect(result.output).toBe('c')
  })

  it('a korlát felülbírálható nullára: pontosan egy generálás', async () => {
    const { client, generalt, pontszamok } = scriptedClient([
      { text: 'a', score: 0.1 },
      { text: 'b', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client, {
      maxIterations: 0,
    })

    expect(result.generations).toBe(1)
    expect(generalt).toEqual(['a'])
  })

  it('összegzi a generálások és a pontozások token-felhasználását', async () => {
    const { client, pontszamok } = scriptedClient([
      { text: 'gyenge', score: 0.4 },
      { text: 'jobb', score: 0.9 },
    ])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    // Két generálás × (100 be, 10 ki). A teszt-rubrika nem hív modellt.
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 })
  })

  it('a végső hiánylistát a megtartott kimenethez adja vissza', async () => {
    const { client, pontszamok } = scriptedClient([{ text: 'jó', score: 0.9 }])

    const result = await refine(recept(tablazatosRubrika(pontszamok)), INPUT, client)

    expect(result.gaps).toEqual(['valami hiányzik'])
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/refine/loop.test.ts`
Elvárt: FAIL — `Cannot find module './loop.js'`

- [ ] **3. lépés: Írd meg az implementációt**

`src/refine/loop.ts`:

```ts
import type { ModelClient, ModelUsage } from '../model/client.js'
import type { Recipe, RecipeInput } from '../recipe/types.js'
import { scoreRubric } from '../rubric/types.js'

export interface RefineOptions {
  /** Felülbírálja a recept saját korlátját. Nulla = nincs javító kör. */
  maxIterations?: number
}

export interface RefineResult {
  /** A megtartott — tehát a legjobb pontszámú — kimenet. */
  output: string
  score: number
  gaps: string[]
  /** Hány generálás történt összesen. Egy = nem volt javító kör. */
  generations: number
  /** A loop teljes token-felhasználása, generálás és pontozás együtt. */
  usage: ModelUsage
}

/**
 * Az evaluator–optimizer loop: generálás → pontozás → javítás, korlátosan.
 *
 * Minden kör pontszáma számít: ebből válik számmal megválaszolhatóvá az a
 * kérdés, amit a legtöbb hasonló projekt meg sem kérdez — **segít-e
 * egyáltalán a második iteráció, és mennyiért?**
 */
export async function refine(
  recipe: Recipe,
  input: RecipeInput,
  client: ModelClient,
  opts: RefineOptions = {},
): Promise<RefineResult> {
  const maxIterations = opts.maxIterations ?? recipe.maxIterations
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: ModelUsage): void => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }

  const first = await client.generate(recipe.role, recipe.prompt(input))
  add(first.usage)

  const firstScore = await scoreRubric(
    recipe.rubric,
    { transcript: input.transcript, output: first.value },
    client,
  )
  add(firstScore.usage)

  let best = { output: first.value, score: firstScore.value, gaps: firstScore.gaps }
  let generations = 1

  while (best.score < recipe.rubric.passThreshold && generations <= maxIterations) {
    const next = await client.generate(
      recipe.role,
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

    // Nem-javulási őr. Az azonos pontszám is megállás: ha egy újabb kör nem
    // hozott előrelépést, a következő sem fog, és a loop csak költene.
    if (scored.value <= best.score) break

    best = { output: next.value, score: scored.value, gaps: scored.gaps }
  }

  return { ...best, generations, usage }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/refine/loop.test.ts`
Elvárt: PASS, 9 teszt.

- [ ] **5. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/refine/loop.ts src/refine/loop.test.ts
git commit -m "feat(refine): evaluator-optimizer loop iterációkorláttal és nem-javulási őrrel"
```

---

### Feladat 11: Állapottár — a recept-metrikák és a migráció

**Fájlok:**
- Módosít: `src/state/db.ts`
- Teszt: `src/state/db.test.ts`

**Interfészek:**
- Fogyaszt: a meglévő `StateStore` (Fázis 0)
- Előállít: `ArtifactMetrics`, a bővített
  `recordArtifact(videoId, kind, status, path, error, metrics?)`,
  `artifactOf(videoId, kind): ArtifactRecord | null`

> **A séma `CREATE TABLE IF NOT EXISTS`, tehát meglévő adatbázison az új
> oszlopok nem jönnének létre.** Ez a feladat legvalódibb kockázata: a
> fejlesztő gépén már van `.state/refinery.db` a Fázis 0-ból, és ott az
> `artifacts` tábla négy oszloppal kevesebb. Egy őrzött `ALTER TABLE` kell,
> és egy teszt, ami **régi sémájú fájlon indul** — enélkül a hiba csak a
> valós futáson jönne elő.

- [ ] **1. lépés: Írd meg a bukó tesztet**

Írd a `src/state/db.test.ts` végére:

```ts
import { DatabaseSync } from 'node:sqlite'

describe('artifacts metrikák', () => {
  it('eltárolja és visszaadja a recept-metrikákat', () => {
    const store = openState(join(dir, 'metrikak.db'))
    store.recordVideo(ITEM)
    store.recordArtifact(ITEM.videoId, 'summary', 'done', '/vault/a_summary.md', null, {
      iterations: 2,
      score: 0.91,
      costUsd: 0.0812,
      model: 'claude-sonnet-5',
    })

    const record = store.artifactOf(ITEM.videoId, 'summary')

    expect(record).not.toBeNull()
    expect(record!.iterations).toBe(2)
    expect(record!.score).toBeCloseTo(0.91, 10)
    expect(record!.costUsd).toBeCloseTo(0.0812, 10)
    expect(record!.model).toBe('claude-sonnet-5')
    store.close()
  })

  it('metrikák nélkül is rögzít — a Fázis 0 útja változatlan', () => {
    const store = openState(join(dir, 'metrika-nelkul.db'))
    store.recordVideo(ITEM)
    store.recordArtifact(ITEM.videoId, 'transcript', 'done', '/vault/a.md', null)

    const record = store.artifactOf(ITEM.videoId, 'transcript')

    expect(record!.status).toBe('done')
    expect(record!.score).toBeNull()
    expect(record!.model).toBeNull()
    store.close()
  })

  it('régi sémájú adatbázist migrál, adatvesztés nélkül', () => {
    const path = join(dir, 'regi-sema.db')

    // A Fázis 0 sémája, pontosan úgy, ahogy a lemezen van.
    const regi = new DatabaseSync(path)
    regi.exec(`
      CREATE TABLE videos (
        video_id TEXT PRIMARY KEY, title TEXT NOT NULL, channel TEXT NOT NULL,
        uploaded_at TEXT NOT NULL, url TEXT NOT NULL, subtitle_path TEXT NOT NULL,
        media_path TEXT, discovered_at TEXT NOT NULL
      );
      CREATE TABLE artifacts (
        video_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
        path TEXT, error TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY (video_id, kind)
      );
    `)
    regi
      .prepare(
        `INSERT INTO videos VALUES ('regi1','Régi','Csatorna','2026-01-01','http://x','/a.srt',NULL,'2026-01-01')`,
      )
      .run()
    regi
      .prepare(
        `INSERT INTO artifacts VALUES ('regi1','transcript','done','/vault/regi.md',NULL,'2026-01-01')`,
      )
      .run()
    regi.close()

    // A megnyitás migrál.
    const store = openState(path)

    const record = store.artifactOf('regi1', 'transcript')
    expect(record!.path).toBe('/vault/regi.md')
    expect(record!.score).toBeNull()

    // És az új oszlopok írhatók.
    store.recordArtifact('regi1', 'summary', 'done', '/vault/regi_summary.md', null, {
      iterations: 1,
      score: 0.85,
      costUsd: 0.05,
      model: 'proba-modell',
    })
    expect(store.artifactOf('regi1', 'summary')!.score).toBeCloseTo(0.85, 10)
    store.close()
  })

  it('a migráció idempotens: kétszeri megnyitás nem hasal el', () => {
    const path = join(dir, 'ketszer.db')
    openState(path).close()
    const masodik = openState(path)
    expect(masodik.path).toBe(path)
    masodik.close()
  })

  it('nem létező artefaktumra null', () => {
    const store = openState(join(dir, 'ures.db'))
    expect(store.artifactOf('nincs', 'summary')).toBeNull()
    store.close()
  })
})
```

> **A meglévő teszt segédeire épít.** A `dir` és az `ITEM` a fájl korábbi
> részében már definiált; ha a nevük eltér, igazítsd hozzájuk, ne vezess be
> újat.

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/state/db.test.ts`
Elvárt: FAIL — `store.artifactOf is not a function`

- [ ] **3. lépés: Írd meg a migrációt és az új műveleteket**

`src/state/db.ts` — a `SCHEMA` konstansban az `artifacts` tábla kapja meg az
új oszlopokat (friss adatbázisokhoz):

```ts
CREATE TABLE IF NOT EXISTS artifacts (
  video_id   TEXT NOT NULL REFERENCES videos(video_id),
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT,
  error      TEXT,
  iterations INTEGER,
  score      REAL,
  cost_usd   REAL,
  model      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, kind)
);
```

A típusok és a migráció a fájl megfelelő helyeire:

```ts
/** Egy recept futásának mérőszámai. A Fázis 0 átirata ezeket nem tölti ki. */
export interface ArtifactMetrics {
  /** Hány generálás történt. */
  iterations: number
  score: number
  costUsd: number
  /** A ténylegesen futott generáló modell neve. */
  model: string
}

export interface ArtifactRecord {
  status: string
  path: string | null
  error: string | null
  iterations: number | null
  score: number | null
  costUsd: number | null
  model: string | null
}

/** A Fázis 0 után hozzáadott oszlopok, migrációs sorrendben. */
const ARTIFACT_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'iterations', ddl: 'INTEGER' },
  { name: 'score', ddl: 'REAL' },
  { name: 'cost_usd', ddl: 'REAL' },
  { name: 'model', ddl: 'TEXT' },
]

/**
 * Hozzáadja a hiányzó oszlopokat egy Fázis 0-ban létrehozott adatbázishoz.
 *
 * A `CREATE TABLE IF NOT EXISTS` meglévő táblán nem csinál semmit, tehát az
 * új oszlopok enélkül sosem jelennének meg egy már használt `.state`-ben —
 * és a hiba nem a teszten, hanem az első valós futáson jönne elő.
 */
function migrateArtifacts(db: DatabaseSync): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(artifacts)').all() as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  for (const column of ARTIFACT_COLUMNS) {
    if (existing.has(column.name)) continue
    db.exec(`ALTER TABLE artifacts ADD COLUMN ${column.name} ${column.ddl}`)
  }
}
```

Az `openState`-ben, közvetlenül a `db.exec(SCHEMA)` után:

```ts
  db.exec(SCHEMA)
  migrateArtifacts(db)
```

A `StateStore` interfészben a `recordArtifact` kap egy opcionális hatodik
paramétert, és jön egy új lekérdezés:

```ts
  recordArtifact(
    videoId: string,
    kind: string,
    status: 'done' | 'failed',
    path: string | null,
    error: string | null,
    metrics?: ArtifactMetrics,
  ): void
  artifactOf(videoId: string, kind: string): ArtifactRecord | null
```

Az implementáció az `openState` visszatérési objektumában:

```ts
    recordArtifact(videoId, kind, status, path, error, metrics) {
      db.prepare(
        `INSERT INTO artifacts
           (video_id, kind, status, path, error, iterations, score, cost_usd, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id, kind) DO UPDATE SET
           status = excluded.status,
           path = excluded.path,
           error = excluded.error,
           iterations = excluded.iterations,
           score = excluded.score,
           cost_usd = excluded.cost_usd,
           model = excluded.model,
           created_at = excluded.created_at`,
      ).run(
        videoId,
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
    },

    artifactOf(videoId, kind) {
      const row = db
        .prepare(
          `SELECT status, path, error, iterations, score, cost_usd, model
             FROM artifacts WHERE video_id = ? AND kind = ?`,
        )
        .get(videoId, kind) as
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
    },
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/state/db.test.ts`
Elvárt: PASS — a meglévő tesztek és az 5 új is.

- [ ] **5. lépés: Töröld a saját `.state`-edet, és győződj meg róla, hogy újraépül**

```bash
mise exec -- pnpm build
ls -la .state/
```

Elvárt: a `.state/refinery.db` a helyén marad, és a fenti migrációs teszt
bizonyítja, hogy a régi séma migrálódik. **Ne töröld a fájlt** — épp az a
kérdés, hogy migrálódik-e; a törlés eltüntetné a bizonyítékot.

- [ ] **6. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/state/db.ts src/state/db.test.ts
git commit -m "feat(state): recept-metrikák az artifacts táblában, migrációval"
```

---

### Feladat 12: Események, útvonalak és a recept-jegyzet renderelése

**Fájlok:**
- Módosít: `src/events.ts`, `src/vault/paths.ts`, `src/vault/render.ts`
- Teszt: `src/events.test.ts`, `src/vault/paths.test.ts`, `src/vault/render.test.ts`

**Interfészek:**
- Fogyaszt: `NormalizedTranscript`, `SourceItem` (Fázis 0)
- Előállít: `recipeFile(videoDirPath, title, outputFile): string`;
  `RecipeNoteMeta`,
  `renderRecipeNote(item, transcript, body, meta, generatorVersion): string`;
  új `RunEvent` tagok: `run:estimate`, `run:aborted`, `item:generating`,
  `item:scored`, `item:refined`

> **A mag struktúrált eseményeket bocsát ki, nem szöveget ír ki**
> (`architecture.md` §2). Az új események ugyanezt a szerződést követik: a
> becslés, a megszakítás és a loop körei mind eseményként jelennek meg, és a
> CLI rendereli őket. Így ugyanez a folyam később SSE-vé válhat, anélkül hogy
> a maghoz hozzá kellene nyúlni.

- [ ] **1. lépés: Írd meg a bukó tesztet az útvonalra**

Írd a `src/vault/paths.test.ts` végére:

```ts
import { recipeFile } from './paths.js'

describe('recipeFile', () => {
  it('a vault névkonvenciója szerint nevez el', () => {
    expect(recipeFile('/vault/Csatorna/Cim', 'Cim', '_summary.md')).toBe(
      '/vault/Csatorna/Cim/Youtube - Cim_summary.md',
    )
  })

  it('szanitizálja a címet a fájlnévben', () => {
    expect(recipeFile('/vault/C/V', 'A/B: C?', '_summary.md')).not.toContain('/A/B')
  })

  it('a transcriptFile ugyanennek a speciális esete', () => {
    expect(transcriptFile('/vault/C/V', 'Cim')).toBe(
      recipeFile('/vault/C/V', 'Cim', '_transcript.md'),
    )
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/paths.test.ts`
Elvárt: FAIL — `recipeFile is not a function`

- [ ] **3. lépés: Írd meg az útvonal-függvényt**

`src/vault/paths.ts` — cseréld le a `transcriptFile`-t erre a kettőre:

```ts
/**
 * A vault konvenciója: `Youtube - <cím>_<típus>.md`. A típus-utótagot a
 * recept adja meg (`outputFile`), így a publisher recept-agnosztikus marad.
 */
export function recipeFile(
  videoDirPath: string,
  title: string,
  outputFile: string,
): string {
  return join(videoDirPath, `Youtube - ${sanitizeSegment(title)}${outputFile}`)
}

/** A Fázis 0 átirata: a `recipeFile` speciális esete. */
export function transcriptFile(videoDirPath: string, title: string): string {
  return recipeFile(videoDirPath, title, '_transcript.md')
}
```

- [ ] **4. lépés: Írd meg a bukó tesztet a renderelésre**

Írd a `src/vault/render.test.ts` végére:

```ts
import { renderRecipeNote } from './render.js'

const META = {
  recipe: 'summary',
  model: 'claude-sonnet-5',
  iterations: 2,
  score: 0.91,
  costUsd: 0.0812,
}

describe('renderRecipeNote', () => {
  it('a frontmatterbe kerül a modell, az iterációszám és a pontszám', () => {
    const md = renderRecipeNote(ITEM, TRANSCRIPT, '## Pont\n', META, '0.1.0')
    expect(md).toContain('recipe: summary')
    expect(md).toContain('model: claude-sonnet-5')
    expect(md).toContain('iterations: 2')
    expect(md).toContain('score: 0.91')
    expect(md).toContain('cost_usd: 0.0812')
  })

  it('megőrzi az átirat származási adatait is', () => {
    const md = renderRecipeNote(ITEM, TRANSCRIPT, '## Pont\n', META, '0.1.0')
    expect(md).toContain('transcript_source: creator_captions')
    expect(md).toContain(`words_normalized: ${String(TRANSCRIPT.wordsNormalized)}`)
  })

  it('a törzsbe a generált szöveg kerül, nem az átirat', () => {
    const md = renderRecipeNote(ITEM, TRANSCRIPT, '## Generált pont\n', META, '0.1.0')
    expect(md).toContain('## Generált pont')
    expect(md).not.toContain(TRANSCRIPT.lines[0])
  })

  it('átmegy a vault linterén', () => {
    const md = renderRecipeNote(ITEM, TRANSCRIPT, '## Pont\n', META, '0.1.0')
    expect(lintVaultMarkdown(md)).toEqual([])
  })

  it('érvényes, lezárt frontmattert ad', () => {
    const md = renderRecipeNote(ITEM, TRANSCRIPT, '## Pont\n', META, '0.1.0')
    expect(md.startsWith('---\n')).toBe(true)
    expect(md.split('\n---\n').length).toBeGreaterThanOrEqual(2)
  })
})
```

> A teszt az `ITEM`, `TRANSCRIPT` és `lintVaultMarkdown` segédeket használja a
> fájl korábbi részéből. Ha a `lintVaultMarkdown` még nincs importálva ebben a
> tesztfájlban, vedd fel.

- [ ] **5. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/render.test.ts`
Elvárt: FAIL — `renderRecipeNote is not a function`

- [ ] **6. lépés: Írd meg a renderelést**

`src/vault/render.ts`, a fájl végére:

```ts
/** Egy recept futásának eredménye, ahogy a frontmatterbe kerül. */
export interface RecipeNoteMeta {
  recipe: string
  /** A ténylegesen futott generáló modell neve. */
  model: string
  /** Hány generálás történt. */
  iterations: number
  score: number
  costUsd: number
}

/**
 * Recept kimenete → vault-jegyzet.
 *
 * A frontmatter az átirat származását **és** a generálás körülményeit is
 * rögzíti. Enélkül a későbbi mérés nem tudná, mit mér: melyik modell, hány
 * körben és mennyiért állította elő a jegyzetet.
 */
export function renderRecipeNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  body: string,
  meta: RecipeNoteMeta,
  generatorVersion: string,
): string {
  const source =
    transcript.captionSource === 'creator' ? 'creator_captions' : 'auto_captions'

  const frontmatter = [
    '---',
    `video_id: ${yamlScalar(item.videoId)}`,
    `title: ${yamlScalar(item.title)}`,
    `channel: ${yamlScalar(item.channel)}`,
    `uploaded: ${yamlScalar(item.uploadedAt)}`,
    `url: ${yamlScalar(item.url)}`,
    `transcript_source: ${source}`,
    'transcript_model: null',
    `words_raw: ${String(transcript.wordsRaw)}`,
    `words_normalized: ${String(transcript.wordsNormalized)}`,
    `recipe: ${yamlScalar(meta.recipe)}`,
    `model: ${yamlScalar(meta.model)}`,
    `iterations: ${String(meta.iterations)}`,
    `score: ${meta.score.toFixed(2)}`,
    `cost_usd: ${meta.costUsd.toFixed(4)}`,
    `generated_at: ${new Date().toISOString()}`,
    `generator: transcript-refinery@${generatorVersion}`,
    '---',
  ].join('\n')

  return [frontmatter, '', `# ${item.title}`, '', `🌐 <${item.url}>`, '', '---', '', body.trim(), ''].join('\n')
}
```

- [ ] **7. lépés: Bővítsd az eseményfolyamot**

`src/events.ts` — a `RunEvent` unióhoz vedd fel:

```ts
  | {
      type: 'run:estimate'
      items: number
      tokens: number
      usd: number
      limitUsd: number
    }
  | { type: 'run:aborted'; reason: string; spentUsd: number; limitUsd: number }
  | {
      type: 'item:generating'
      videoId: string
      recipe: string
      /** Hányadik generálás; egytől számozva. */
      generation: number
    }
  | {
      type: 'item:scored'
      videoId: string
      recipe: string
      score: number
      gaps: number
    }
  | {
      type: 'item:refined'
      videoId: string
      recipe: string
      score: number
      generations: number
      usd: number
    }
```

A `summarize` nem változik: az új események egyike sem publikálás, kihagyás
vagy hiba, tehát a számlálók helyesek maradnak.

- [ ] **8. lépés: Írd meg a tesztet az összegzés érintetlenségére**

Írd a `src/events.test.ts` végére:

```ts
it('az új események nem torzítják az összegzést', () => {
  const summary = summarize([
    { type: 'run:estimate', items: 3, tokens: 1000, usd: 0.2, limitUsd: 5 },
    { type: 'item:generating', videoId: 'a', recipe: 'summary', generation: 1 },
    { type: 'item:scored', videoId: 'a', recipe: 'summary', score: 0.9, gaps: 0 },
    { type: 'item:refined', videoId: 'a', recipe: 'summary', score: 0.9, generations: 1, usd: 0.08 },
    { type: 'item:published', videoId: 'a', path: '/vault/a.md' },
  ])
  expect(summary).toEqual({ succeeded: 1, skipped: 0, failed: 0 })
})
```

- [ ] **9. lépés: Futtasd, és győződj meg róla, hogy minden zöld**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: mindhárom zöld.

- [ ] **10. lépés: Commitolj**

```bash
git add src/events.ts src/events.test.ts src/vault/paths.ts src/vault/paths.test.ts src/vault/render.ts src/vault/render.test.ts
git commit -m "feat(vault): recept-jegyzet renderelése és a loop eseményei"
```

---

### Feladat 13: Csővezeték és CLI — a recept bekötése

**Fájlok:**
- Módosít: `src/pipeline.ts`, `src/cli.ts`, `src/index.ts`
- Teszt: `src/pipeline.test.ts`

**Interfészek:**
- Fogyaszt: `refine` (Feladat 10), `getRecipe` (Feladat 9),
  `createModelClient` (Feladat 4), `createCostGuard`, `estimateRunUsd`
  (Feladat 5), `loadModelConfig` (Feladat 3), `renderRecipeNote`,
  `recipeFile` (Feladat 12)
- Előállít: `normalizeItem(item): Promise<NormalizedTranscript>`, `RecipeDeps`,
  a bővített `PipelineDeps`, a `--recipe` CLI-kapcsoló

> **A Fázis 0 útja nem változhat.** Recept nélkül a `processItem` pontosan azt
> teszi, amit eddig, és a modell-konfigurációt meg sem nézi. Ezt teszt
> rögzíti, nem jóhiszeműség.

> **Két kapu a költségre** (`decisions/0004`). A `loadModelConfig` már
> elutasítja a plafon nélküli indulást; itt jön a második: a becslés a plafon
> felett **el sem indul**, és a futás közbeni tényleges költés átlépésekor a
> köteg megáll — a már kész elemek megmaradnak.

- [ ] **1. lépés: Írd meg a bukó tesztet**

Írd a `src/pipeline.test.ts` végére:

```ts
import { modelClientFrom } from './model/client.js'
import { createCostGuard } from './model/budget.js'
import type { Recipe } from './recipe/types.js'

const MODELL_CFG = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  pricing: {
    draft: { inputPerMillion: 3, outputPerMillion: 15 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  costLimitUsd: 5,
}

/** Recept, ami mindig átmegy, és nem hív bírót. */
const ATMENO_RECEPT: Recipe = {
  id: 'proba',
  outputFile: '_proba.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  prompt: () => 'generálj',
  repairPrompt: () => 'javíts',
  rubric: {
    criteria: [{ name: 'mindig-jo', score: () => Promise.resolve({ value: 1, gaps: [] }) }],
    passThreshold: 0.8,
  },
}

function probaKliens(text: string) {
  return modelClientFrom({
    draft: fixModell(text),
    judge: fixModell('nem hívjuk'),
  })
}

describe('processItem recepttel', () => {
  it('recept nélkül a Fázis 0 útján marad, és nem néz modell-konfigurációt', async () => {
    // Ez a teszt akkor is fut, ha egyetlen LiteLLM-változó sincs beállítva.
    const outcome = await processItem(ITEM, alapDeps())
    expect(outcome.status).toBe('published')
    expect(outcome.path).toContain('_transcript.md')
  })

  it('recepttel a jegyzetet is kiírja, a recept fájlnevével', async () => {
    const outcome = await processItem(ITEM, {
      ...alapDeps(),
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Generált jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.status).toBe('published')
    const irt = await readFile(outcome.recipePath!, 'utf8')
    expect(irt).toContain('## Generált jegyzet')
    expect(irt).toContain('recipe: proba')
    expect(irt).toContain('model: draft-modell')
  })

  it('a metrikákat az állapottárba írja', async () => {
    const deps = alapDeps()
    await processItem(ITEM, {
      ...deps,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const record = deps.store.artifactOf(ITEM.videoId, 'proba')
    expect(record!.status).toBe('done')
    expect(record!.iterations).toBe(1)
    expect(record!.score).toBe(1)
    expect(record!.model).toBe('draft-modell')
    expect(record!.costUsd).toBeGreaterThan(0)
  })

  it('a költségőr összegzi a loop tényleges használatát', async () => {
    const guard = createCostGuard(5)
    await processItem(ITEM, {
      ...alapDeps(),
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard,
      },
    })
    expect(guard.spentUsd()).toBeGreaterThan(0)
  })

  it('a már kész receptet másodszorra kihagyja', async () => {
    const deps = alapDeps()
    const recipeDeps = {
      recipe: ATMENO_RECEPT,
      client: probaKliens('## Jegyzet\n'),
      modelConfig: MODELL_CFG,
      guard: createCostGuard(5),
    }

    await processItem(ITEM, { ...deps, recipeDeps })
    const masodik = await processItem(ITEM, { ...deps, recipeDeps })

    expect(masodik.status).toBe('skipped')
  })

  it('publishable: false receptet nem ír ki', async () => {
    const outcome = await processItem(ITEM, {
      ...alapDeps(),
      recipeDeps: {
        recipe: { ...ATMENO_RECEPT, id: 'nem-publikus', publishable: false },
        client: probaKliens('## Jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(outcome.recipePath).toBeUndefined()
  })
})
```

> Az `alapDeps()` a fájl korábbi részében használt `PipelineDeps`-objektumot
> adja vissza friss állapottárral és ideiglenes vault-gyökérrel; ha még nincs
> ilyen segéd, emeld ki a meglévő tesztekből. A `fixModell` a Feladat 4
> tesztjéből másolható.

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/pipeline.test.ts`
Elvárt: FAIL — a `recipeDeps` ismeretlen tulajdonság.

- [ ] **3. lépés: Vedd fel az új importokat**

`src/pipeline.ts` — a meglévő importok mellé pontosan ezek kellenek. A
`transcriptFile` helyére a `recipeFile` lép (Feladat 12):

```ts
import type { ModelConfig } from './config.js'
import type { CostGuard } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { costOf } from './model/pricing.js'
import type { Recipe } from './recipe/types.js'
import { refine } from './refine/loop.js'
import { recipeFile, resolveChannelDir, videoDir } from './vault/paths.js'
import { renderRecipeNote, renderTranscriptNote } from './vault/render.js'
```

`src/cli.ts` — ugyanígy:

```ts
import { loadModelConfig } from './config.js'
import { createCostGuard, estimateRunUsd } from './model/budget.js'
import { createModelClient } from './model/client.js'
import { normalizeItem, processItem, type RecipeDeps } from './pipeline.js'
import { getRecipe } from './recipe/registry.js'
```

- [ ] **4. lépés: Emeld ki a normalizálást**

`src/pipeline.ts` — a `processItem` törzséből emeld ki külön függvénybe, hogy
a `scan` és a becslés is ugyanazt az utat használja:

```ts
/**
 * Feliratfájl → normalizált átirat. A `scan`, a költségbecslés és a
 * feldolgozás ugyanezt hívja, hogy a szószám mindhárom helyen ugyanaz legyen.
 */
export async function normalizeItem(
  item: SourceItem,
): Promise<NormalizedTranscript> {
  const raw = await readFile(item.subtitlePath, 'utf8')
  const cues = parseSubtitle(raw, item.subtitlePath)
  if (cues.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz értelmezhető feliratblokkot')
  }

  const rawText = cues.flatMap((c) => c.lines).join(' ')
  const lines = dedupeLines(cues)
  if (lines.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz szöveget')
  }
  const normalizedText = lines.join(' ')

  return {
    lines,
    wordsRaw: countWords(rawText),
    wordsNormalized: countWords(normalizedText),
    captionSource: classifyCaptions(normalizedText),
    punctuationDensity: punctuationDensity(normalizedText),
  }
}
```

- [ ] **5. lépés: Bővítsd a csővezetéket**

`src/pipeline.ts` — az új típusok és a `processItem` átalakítása:

```ts
export interface RecipeDeps {
  recipe: Recipe
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
}

export interface PipelineDeps {
  notesRoot: string
  store: StateStore
  sink: EventSink
  version: string
  options: PublishOptions
  /** Ha hiányzik, a csővezeték a Fázis 0 útján marad: csak átirat. */
  recipeDeps?: RecipeDeps
}

export interface ItemOutcome {
  status: 'published' | 'skipped' | 'failed'
  path?: string
  /** A recept jegyzetének útvonala, ha készült ilyen. */
  recipePath?: string
  error?: string
}
```

A `processItem` szerkezete — a kihagyás-vizsgálat artefaktumonként dől el:

```ts
export async function processItem(
  item: SourceItem,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const { notesRoot, store, sink, version, options, recipeDeps } = deps
  sink({ type: 'item:start', videoId: item.videoId, title: item.title })
  store.recordVideo(item)

  const kellAtirat = options.force || !store.isDone(item.videoId, ARTIFACT_KIND)
  const kellRecept =
    recipeDeps !== undefined &&
    (options.force || !store.isDone(item.videoId, recipeDeps.recipe.id))

  if (!kellAtirat && !kellRecept) {
    sink({ type: 'item:skipped', videoId: item.videoId, reason: 'már feldolgozva' })
    return { status: 'skipped' }
  }

  try {
    const transcript = await normalizeItem(item)
    sink({ type: 'item:parsed', videoId: item.videoId, cues: transcript.lines.length })
    sink({
      type: 'item:normalized',
      videoId: item.videoId,
      wordsRaw: transcript.wordsRaw,
      wordsNormalized: transcript.wordsNormalized,
      captionSource: transcript.captionSource,
    })
    store.recordTranscript(
      item.videoId,
      transcript.captionSource,
      transcript.wordsRaw,
      transcript.wordsNormalized,
    )

    const channelDir = await resolveChannelDir(notesRoot, item.channel)
    const dir = videoDir(notesRoot, channelDir, item.title)

    let outcome: ItemOutcome = { status: 'skipped' }

    if (kellAtirat) {
      outcome = await publishRendered(
        recipeFile(dir, item.title, '_transcript.md'),
        renderTranscriptNote(item, transcript, version),
        item,
        ARTIFACT_KIND,
        deps,
      )
    }

    if (kellRecept && recipeDeps) {
      const recipeOutcome = await runRecipe(item, transcript, dir, deps, recipeDeps)
      if (recipeOutcome.status === 'published') {
        outcome = { ...recipeOutcome, path: outcome.path ?? recipeOutcome.recipePath }
      }
    }

    return outcome
  } catch (error) {
    const message = (error as Error).message
    store.recordArtifact(item.videoId, ARTIFACT_KIND, 'failed', null, message)
    sink({ type: 'item:failed', videoId: item.videoId, error: message })
    return { status: 'failed', error: message }
  }
}
```

A két segédfüggvény, a `processItem` fölé:

```ts
/** Lintel, publikál, és rögzíti az állapotot. */
async function publishRendered(
  target: string,
  markdown: string,
  item: SourceItem,
  kind: string,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const lintErrors = lintVaultMarkdown(markdown)
  if (lintErrors.length > 0) {
    throw new Error(`a jegyzet megsérti a vault linkszabályát: ${lintErrors.join('; ')}`)
  }

  const result = await publishNote(target, markdown, deps.options)
  if (result.status === 'skipped') {
    deps.store.recordArtifact(item.videoId, kind, 'done', result.path, null)
    deps.sink({ type: 'item:skipped', videoId: item.videoId, reason: 'a fájl már létezik' })
    return { status: 'skipped', path: result.path }
  }

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(item.videoId, kind, 'done', result.path, null)
  }
  deps.sink({ type: 'item:published', videoId: item.videoId, path: result.path })
  return { status: 'published', path: result.path }
}

/** A 6. csővezeték-lépés: recept futtatása és publikálása. */
async function runRecipe(
  item: SourceItem,
  transcript: NormalizedTranscript,
  dir: string,
  deps: PipelineDeps,
  recipeDeps: RecipeDeps,
): Promise<ItemOutcome> {
  const { recipe, client, modelConfig, guard } = recipeDeps
  const text = transcript.lines.join(' ')

  const result = await refine(recipe, { item, transcript: text }, client)

  guard.add('draft', result.usage, modelConfig)
  const usd = costOf(result.usage, modelConfig.pricing.draft)

  deps.sink({
    type: 'item:refined',
    videoId: item.videoId,
    recipe: recipe.id,
    score: result.score,
    generations: result.generations,
    usd,
  })

  // A `publishable: false` a publisher által kikényszerített invariáns, nem
  // konvenció: bizonyos típusok soha nem kerülhetnek publikálási útra.
  if (!recipe.publishable) {
    deps.store.recordArtifact(item.videoId, recipe.id, 'done', null, null, {
      iterations: result.generations,
      score: result.score,
      costUsd: usd,
      model: modelConfig.models[recipe.role],
    })
    return { status: 'skipped' }
  }

  const markdown = renderRecipeNote(item, transcript, result.output, {
    recipe: recipe.id,
    model: modelConfig.models[recipe.role],
    iterations: result.generations,
    score: result.score,
    costUsd: usd,
  }, deps.version)

  const lintErrors = lintVaultMarkdown(markdown)
  if (lintErrors.length > 0) {
    throw new Error(`a jegyzet megsérti a vault linkszabályát: ${lintErrors.join('; ')}`)
  }

  const target = recipeFile(dir, item.title, recipe.outputFile)
  const published = await publishNote(target, markdown, deps.options)

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(
      item.videoId,
      recipe.id,
      'done',
      published.path,
      null,
      {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
      },
    )
  }

  if (published.status === 'skipped') {
    deps.sink({ type: 'item:skipped', videoId: item.videoId, reason: 'a fájl már létezik' })
    return { status: 'skipped', recipePath: published.path }
  }

  deps.sink({ type: 'item:published', videoId: item.videoId, path: published.path })
  return { status: 'published', recipePath: published.path }
}
```

> **A `costOf` a draft árazásával számol**, mert a `refine` összevont
> használatot ad vissza. Ez a Fázis 1-ben szándékos egyszerűsítés, és
> **felülről becsül**: a draft drágább, mint a bíró, tehát a jegyzetbe írt
> költség sosem kisebb a valósnál. A szerepenkénti bontás akkor kerül be,
> amikor a modell-bakeoff igényli.

> **Verifikálva a Feladat 16-ban: a `--dry-run` valós modellhívást indít.** A
> `deps.options.dryRun` fenti ellenőrzései kizárólag a `store.recordArtifact`
> hívást és — a `publishNote`-on belül — a tényleges fájlírást kerülik el; a
> `runRecipe` elején álló `refine()` hívás **feltétel nélküli.** A „száraz
> futtatás" tehát a névből várható módon **nem** nulla költségű: a vázlatoló
> és a bíráló modellt ugyanúgy meghívja, mint egy éles futás, csak a lemezre
> írást és az állapotrögzítést spórolja meg. Mért példa: egy
> `--recipe summary --limit 1 --dry-run` futás 0,97 pontszámú, 1 generálásos
> kimenetet adott, **0,1192 $ valós LiteLLM-költséggel**, miközben a vault
> munkafája bit-azonos maradt. Ha egy jövőbeli fázis valódi, nulla-költségű
> előnézetet akarna adni, itt kell módosítani.

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/pipeline.test.ts`
Elvárt: PASS — a meglévő tesztek és a 6 új is.

- [ ] **7. lépés: Kösd be a CLI-be**

`src/cli.ts` — a `USAGE` egészüljön ki:

```
  --recipe <id>     receptet is futtat (pl. summary); enélkül csak átirat
```

A `parseArgs` opciói közé: `recipe: { type: 'string' }`.

A `commandRun` elejére, a `flags.recipe` feldolgozása:

```ts
  let recipeDeps: RecipeDeps | undefined
  let maxIterations = 0
  if (flags.recipe) {
    const recipe = getRecipe(flags.recipe)
    const modelConfig = loadModelConfig(process.env)
    recipeDeps = {
      recipe,
      client: createModelClient(modelConfig),
      modelConfig,
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
    maxIterations = recipe.maxIterations
  }
```

A szűrés után, a feldolgozás **előtt**, a becslés és a kapu:

```ts
    if (recipeDeps) {
      const wordCounts: number[] = []
      for (const item of items) {
        try {
          wordCounts.push((await normalizeItem(item)).wordsNormalized)
        } catch {
          // Az olvashatatlan feliratot a feldolgozás jelenti majd; a
          // becslésből egyszerűen kimarad.
        }
      }

      const estimate = estimateRunUsd(wordCounts, maxIterations, recipeDeps.modelConfig)
      printing({
        type: 'run:estimate',
        items: wordCounts.length,
        tokens: estimate.tokens,
        usd: estimate.usd,
        limitUsd: recipeDeps.modelConfig.costLimitUsd,
      })

      if (estimate.usd > recipeDeps.modelConfig.costLimitUsd) {
        printing({
          type: 'run:aborted',
          reason: 'a becsült költség meghaladja a plafont',
          spentUsd: 0,
          limitUsd: recipeDeps.modelConfig.costLimitUsd,
        })
        return 2
      }
    }
```

A feldolgozó ciklusban, minden elem után:

```ts
      if (recipeDeps?.guard.exceeded()) {
        printing({
          type: 'run:aborted',
          reason: 'a tényleges költés meghaladta a plafont',
          spentUsd: recipeDeps.guard.spentUsd(),
          limitUsd: recipeDeps.modelConfig.costLimitUsd,
        })
        break
      }
```

A `render` függvény kapja meg az új eseményeket:

```ts
    case 'run:estimate':
      return `Becslés: ${String(event.items)} elem, ~${event.tokens.toLocaleString('hu-HU')} token, ~${event.usd.toFixed(2)} $ (plafon: ${event.limitUsd.toFixed(2)} $)`
    case 'run:aborted':
      return `A futás megállt: ${event.reason} (${event.spentUsd.toFixed(2)} $ / ${event.limitUsd.toFixed(2)} $)`
    case 'item:refined':
      return `  ~ ${event.videoId}: ${event.recipe} pontszám ${event.score.toFixed(2)}, ${String(event.generations)} generálás, ${event.usd.toFixed(4)} $`
```

- [ ] **8. lépés: Exportáld az indexből**

`src/index.ts` — vedd fel az új nyilvános felületet:

```ts
export { normalizeItem, type RecipeDeps } from './pipeline.js'
export { getRecipe, RECIPES, RECIPE_IDS } from './recipe/registry.js'
export type { Recipe, RecipeInput } from './recipe/types.js'
export { refine, type RefineResult } from './refine/loop.js'
export { createModelClient, modelClientFrom, type ModelClient } from './model/client.js'
export { loadModelConfig, type ModelConfig } from './config.js'
```

- [ ] **9. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint && mise exec -- pnpm build
git add src/pipeline.ts src/pipeline.test.ts src/cli.ts src/index.ts
git commit -m "feat(pipeline): recept futtatása a csővezeték hatodik lépéseként"
```

---

### Feladat 14: A mérési harness

**Fájlok:**
- Létrehoz: `evals/fixtures/transcripts.ts`, `evals/fixture-model.ts`,
  `evals/private-layer.ts`, `evals/summary.eval.ts`
- Módosít: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`,
  `tsconfig.build.json`, `.gitignore`

**Interfészek:**
- Fogyaszt: `refine` (Feladat 10), `summaryRecipe` (Feladat 9),
  `modelClientFrom` (Feladat 4), `checkFormat` (Feladat 7), a Fázis 0
  `parseSubtitle` és `dedupeLines` függvényei
- Előállít: `Fixture`, `PUBLIC_FIXTURES`, `fixtureClient(fixture)`,
  `loadPrivateFixtures()`, és a `pnpm eval` parancs

> **Az első sikerkritérium ezen múlik:** a mérés egy friss klónon, kulcs
> nélkül, offline lefut, és pontszámokat ír ki. Ezért fut a **teljes loop**
> fixture-modellel — nem csak a determinisztikus pontozók. A `ModelClient`
> ugyanaz mindkét úton, tehát a mérés a valódi kódutat méri, nem egy
> párhuzamos ágat.

> **Előfeltétel, amit a README-nek is ki kell mondania:** az `evalite`
> behúzza a `better-sqlite3`-at, ami natív fordítást igényel, és erre az
> ABI-ra nem volt kész prebuild. Egy friss klónhoz tehát C++ toolchain kell
> (macOS: Xcode Command Line Tools; Debian/Ubuntu: `build-essential`,
> `python3`). A **mag** futásidejű függősége ettől függetlenül változatlanul
> `zod`, `ai` és `@ai-sdk/openai-compatible` — a natív fordítás a
> mérőeszközé, nem a csővezetéké.

- [ ] **1. lépés: Frissítsd a Vitestet és telepítsd az evalite-ot**

```bash
mise exec -- pnpm add -D vitest@^4 evalite@0.19.0
```

Az `evalite` **pontos verzióra** rögzítve: a szerző saját közlése szerint
breaking változásokat tol, a `1.0.0-beta` pedig `ai@^6`-ot kér peerként, ami
ütközne a projekt `ai@7`-ével.

`pnpm-workspace.yaml` — a `better-sqlite3` build-szkriptjének engedélyezése:

```yaml
allowBuilds:
  esbuild: true
  better-sqlite3: true
```

- [ ] **2. lépés: Ellenőrizd, hogy a Vitest 4 nem tört el semmit**

Futtasd: `mise exec -- pnpm test`
Elvárt: minden korábbi teszt zöld, kódváltoztatás nélkül. (Ez előzetesen
verifikálva lett a Fázis 0 készletén: 19 fájl, 114 teszt.)

- [ ] **3. lépés: Vedd be az `evals/`-t a típusellenőrzésbe**

`tsconfig.json` — a `rootDir` kikerül, az `include` bővül:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "evals/**/*.ts"]
}
```

`tsconfig.build.json` — a `rootDir` ide költözik, hogy a build változatlan
maradjon:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`.gitignore` — a privát mérőréteg:

```
# A mérőhalmaz privát rétege: valós korpuszból válogatva, verziókövetésen
# kívül. A publikus, szintetikus réteg viszont be van commitolva.
evals/private/
```

- [ ] **4. lépés: Írd meg a publikus fixture-öket**

`evals/fixtures/transcripts.ts`:

```ts
/**
 * A publikus mérőréteg: **kézzel írt, szintetikus** felirat-fixture-ök.
 *
 * Nem a valós korpusz darabjai. Húsz idegen felirat becommitolása egy
 * publikus repóba szó szerinti újraközlés lenne (`evaluation.md` §4); ezek
 * viszont a valós **alakzatokat** utánozzák: háromszorozott sorok, írásjel
 * nélküli ASR-szöveg, strukturált tartalom.
 */
export interface Fixture {
  id: string
  title: string
  channel: string
  /** Nyers SRT, a gördülő ablakos ismétléssel együtt. */
  srt: string
  /** A fixture-modell által generálási körönként visszaadott jegyzetek. */
  notes: string[]
  /**
   * A bíró rögzített ítéletei, **hívási sorrendben**. Generálásonként kettő
   * kell: előbb a hűség, aztán a lefedettség.
   */
  verdicts: { score: number; gaps: string[] }[]
}

/** Gördülő ablakos ismétlés: minden sor háromszor, ahogy a YouTube adja. */
function rolling(lines: string[]): string {
  const blocks: string[] = []
  let n = 1
  for (let i = 0; i < lines.length; i++) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = `00:00:${String(i * 3 + repeat).padStart(2, '0')},000`
      const end = `00:00:${String(i * 3 + repeat + 1).padStart(2, '0')},000`
      blocks.push(`${String(n)}\n${start} --> ${end}\n${lines[i]!}\n`)
      n++
    }
  }
  return blocks.join('\n')
}

export const PUBLIC_FIXTURES: Fixture[] = [
  {
    id: 'szerzoi-felirat',
    title: 'How caching actually works',
    channel: 'Synthetic Channel',
    srt: rolling([
      'Caching is not one idea, it is three.',
      'The first is the cache key, which decides what counts as the same request.',
      'The second is invalidation, which decides when a stored answer goes stale.',
      'The third is eviction, which decides what to drop when memory runs out.',
      'Most outages I have seen came from the second one.',
    ]),
    notes: [
      [
        'The video breaks caching into three separate decisions rather than treating it as one technique.',
        '',
        '## The three decisions',
        '',
        '- **Cache key** — decides what counts as the same request.',
        '- **Invalidation** — decides when a stored answer goes stale.',
        '- **Eviction** — decides what to drop when memory runs out.',
        '',
        '## What actually breaks',
        '',
        '- The speaker attributes most outages they have seen to invalidation.',
      ].join('\n'),
    ],
    verdicts: [
      { score: 1, gaps: [] },
      { score: 0.9, gaps: [] },
    ],
  },
  {
    id: 'automatikus-felirat',
    title: 'agent orchestration in practice',
    channel: 'Synthetic Channel',
    srt: rolling([
      'agent orchestration otherwise known as what yes the latest hot trend',
      'for vibe coders or agentic engineers is here in this video',
      'we take a look at whether any of it survives contact with production',
      'the short answer is that the routing layer is the only part that pays off',
    ]),
    notes: [
      // Első kör: hiányos, a bíró meg is nevezi a hiányt.
      [
        'The video is about agent orchestration.',
        '',
        '## Main claim',
        '',
        '- Agent orchestration is a current trend.',
      ].join('\n'),
      // Második kör: a hiány pótolva.
      [
        'The video asks whether agent orchestration survives contact with production.',
        '',
        '## Main claim',
        '',
        '- Agent orchestration is a current trend among "vibe coders" and agentic engineers.',
        '- The speaker says the routing layer is the only part that pays off in production.',
      ].join('\n'),
    ],
    verdicts: [
      { score: 1, gaps: [] },
      { score: 0.4, gaps: ['The conclusion about the routing layer is missing.'] },
      { score: 1, gaps: [] },
      { score: 0.9, gaps: [] },
    ],
  },
  {
    id: 'formatumhiba',
    title: 'a note that breaks the vault rules',
    channel: 'Synthetic Channel',
    srt: rolling([
      'This one exists to prove the format gate stops the expensive scorers.',
      'The generated note contains a wikilink, which the vault forbids.',
    ]),
    notes: [
      // Wikilinket tartalmaz: a blokkoló kritérium megfogja, és a bíró
      // egyetlen hívást sem kap.
      'See [[Another Note]] for the details.',
    ],
    verdicts: [],
  },
]
```

- [ ] **5. lépés: Írd meg a fixture-modellt**

`evals/fixture-model.ts`:

```ts
import { MockLanguageModelV4 } from 'ai/test'
import { modelClientFrom, type ModelClient } from '../src/model/client.js'
import type { Fixture } from './fixtures/transcripts.js'

function cannedModel(next: () => string) {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: next() }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 1000,
            noCache: 1000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      }),
  })
}

/**
 * Determinisztikus kliens egy fixture-höz. A `draft` szerep a fixture
 * jegyzeteit adja sorban, a `judge` az ítéleteit — így a teljes loop lefut
 * kulcs és hálózat nélkül, valódi pontszámokkal.
 */
export function fixtureClient(fixture: Fixture): ModelClient {
  let draft = 0
  let judge = 0
  return modelClientFrom({
    draft: cannedModel(() => {
      const note = fixture.notes[Math.min(draft, fixture.notes.length - 1)]
      draft++
      return note ?? ''
    }),
    judge: cannedModel(() => {
      const verdict = fixture.verdicts[Math.min(judge, fixture.verdicts.length - 1)]
      judge++
      return JSON.stringify(verdict ?? { score: 0, gaps: ['no verdict in fixture'] })
    }),
  })
}
```

- [ ] **6. lépés: Írd meg a privát réteg betöltőjét**

`evals/private-layer.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Fixture } from './fixtures/transcripts.js'

const PRIVATE_PATH = join(process.cwd(), 'evals', 'private', 'fixtures.json')

/**
 * A mérőhalmaz privát rétege: a valós korpuszból válogatott elemek, amik
 * verziókövetésen kívül élnek (`evaluation.md` §4).
 *
 * Hiánya **nem hiba** — egy idegennek a publikus réteggel is le kell tudnia
 * futtatni a mérést. A kihagyás viszont látható, nem csendes.
 */
export function loadPrivateFixtures(): Fixture[] {
  try {
    return JSON.parse(readFileSync(PRIVATE_PATH, 'utf8')) as Fixture[]
  } catch {
    console.log(
      'A privát mérőréteg nincs jelen (evals/private/fixtures.json) — a mérés a publikus, szintetikus rétegen fut.',
    )
    return []
  }
}
```

- [ ] **7. lépés: Írd meg az evalt**

`evals/summary.eval.ts`:

```ts
import { evalite } from 'evalite'
import { dedupeLines } from '../src/normalize/dedupe.js'
import { summaryRecipe } from '../src/recipe/summary.js'
import { refine } from '../src/refine/loop.js'
import { checkFormat } from '../src/rubric/format.js'
import { parseSubtitle } from '../src/subtitle/parse.js'
import type { SourceItem } from '../src/types.js'
import { fixtureClient } from './fixture-model.js'
import { PUBLIC_FIXTURES, type Fixture } from './fixtures/transcripts.js'
import { loadPrivateFixtures } from './private-layer.js'

function itemOf(fixture: Fixture): SourceItem {
  return {
    videoId: fixture.id,
    title: fixture.title,
    channel: fixture.channel,
    uploadedAt: '2026-01-01',
    url: `https://example.com/${fixture.id}`,
    subtitlePath: `${fixture.id}.srt`,
    mediaPath: null,
  }
}

evalite('summary recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    // A valódi Fázis 0 út: nyers SRT → cue-k → deduplikált sorok.
    const cues = parseSubtitle(fixture.srt, `${fixture.id}.srt`)
    const transcript = dedupeLines(cues).join(' ')

    const result = await refine(
      summaryRecipe,
      { item: itemOf(fixture), transcript },
      fixtureClient(fixture),
    )

    return {
      output: result.output,
      score: result.score,
      generations: result.generations,
      gaps: result.gaps,
      inputTokens: result.usage.inputTokens,
    }
  },

  scorers: [
    {
      name: 'formatum',
      description: 'Determinisztikus vault-formátum: nulla token.',
      scorer: ({ output }) => checkFormat(output.output).value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Generálás', value: output.generations },
    { label: 'Hiányok', value: output.gaps.length },
    { label: 'Bemeneti token', value: output.inputTokens },
  ],
})
```

- [ ] **8. lépés: Vedd fel a parancsokat**

`package.json` — a `scripts` blokkba:

```json
    "eval": "evalite run",
    "eval:watch": "evalite watch",
```

- [ ] **9. lépés: Futtasd a mérést hálózat és kulcs nélkül**

```bash
env -u LITELLM_API_KEY -u LITELLM_BASE_URL mise exec -- pnpm eval
```

Elvárt: a három publikus fixture lefut, a táblázat kiírja a `formatum` és a
`rubrika-pontszam` oszlopot, és a `formatumhiba` fixture **0** formátumpontot
kap, miközben egyetlen bíró-hívás sem történt. A privát réteg hiányáról
látható üzenet jön. A parancs kilépési kódja `0`.

> **Ha a `pnpm eval` nem lép ki:** az `evalite run` a dokumentált egyszeri
> futtatás; a `serve` és a `watch` az, ami bent marad. Ha mégis várakozik,
> ellenőrizd, hogy a `run` alparancsot hívod. Küszöb is adható neki
> (`evalite run --threshold 70`), ha később szigorítani akarod a kaput.

- [ ] **10. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint && mise exec -- pnpm build
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json .gitignore evals/
git commit -m "feat(evals): mérési harness a teljes loopra, fixture-modellel"
```

---

### Feladat 15: A minőségi kapu precisionje és recallja

**Fájlok:**
- Létrehoz: `evals/fixtures/gate.ts`, `src/normalize/gate.test.ts`
- Módosít: `.github/workflows/ci.yml`

**Interfészek:**
- Fogyaszt: `classifyCaptions`, `punctuationDensity` (Fázis 0)
- Előállít: `GATE_LABELS`, `GateLabel`

> **Miért nem evalite:** az evalite soronkénti pontszámok átlagát adja, a
> precision és a recall viszont **halmaz-szintű** mennyiség — nem áll elő
> soronkénti pontszámok átlagaként. Ez Vitest-teszt helye, ami kiszámolja,
> kiírja és küszöbre assertálja a két számot.

> **A határeset szándékosan benne van.** A valós korpuszon a 2,0-s küszöb
> körüli sávban egyetlen fájl volt; a publikus rétegbe ennek szintetikus mása
> kerül. Ez az az elem, ami elkapja, ha a küszöb később elcsúszik.

- [ ] **1. lépés: Írd meg a címkézett halmazt**

`evals/fixtures/gate.ts`:

```ts
import type { CaptionSource } from '../../src/types.js'

/**
 * A minőségi kapu **publikus, címkézett** halmaza. Szintetikus szövegek, a
 * valós korpusz alakzatait utánozva: a kapu maga determinisztikus, de a
 * **küszöbérték ítélet**, tehát mérni kell (`evaluation.md` §1).
 */
export interface GateLabel {
  id: string
  text: string
  /** A kézzel adott, mérvadó címke. */
  label: CaptionSource
}

export const GATE_LABELS: GateLabel[] = [
  {
    id: 'szerzoi-1',
    label: 'creator',
    text: 'Caching is not one idea, it is three. The first is the cache key, which decides what counts as the same request. The second is invalidation.',
  },
  {
    id: 'szerzoi-2',
    label: 'creator',
    text: 'Welcome back! Today we look at three things: routing, retries, and rate limits. Each one is simple; together, they are not.',
  },
  {
    id: 'szerzoi-3',
    label: 'creator',
    text: 'So, what happened? The deploy went out at 3 a.m., and by 4, everything was on fire. Here is the timeline.',
  },
  {
    id: 'automatikus-1',
    label: 'auto',
    text: 'agent orchestration otherwise known as what yes the latest hot trend for vibe coders or agentic engineers is here in this video we take a look',
  },
  {
    id: 'automatikus-2',
    label: 'auto',
    text: 'so the first thing you want to do is open up your terminal and then you are going to want to run the install command and wait for it to finish',
  },
  {
    id: 'automatikus-3',
    label: 'auto',
    text: 'And so what I did was I took the whole thing apart and then I put it back together again and it turns out that the problem was the cable',
  },
  {
    id: 'hatareset',
    label: 'auto',
    // A valós korpusz egyetlen határesetének szintetikus mása: az újabb ASR
    // nagybetűsít és néha pontot tesz, de a sűrűség a küszöb körül marad.
    // Pontosan ez az az elem, ami elkapja, ha a küszöb elcsúszik.
    text: 'The thing about this approach is that it works until it does not and then you are left holding a system that nobody understands anymore and the person who wrote it left the company two years ago so there is nobody to ask about any of it. And that is the real cost',
  },
]
```

- [ ] **2. lépés: Írd meg a bukó tesztet**

`src/normalize/gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GATE_LABELS } from '../../evals/fixtures/gate.js'
import { PUNCTUATION_THRESHOLD, classifyCaptions, punctuationDensity } from './classify.js'

/** A pozitív osztály az `auto`: ez indítja majd az újratranszkribálást. */
function measure(threshold: number) {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const { text, label } of GATE_LABELS) {
    const predicted = classifyCaptions(text, threshold)
    if (predicted === 'auto' && label === 'auto') tp++
    if (predicted === 'auto' && label === 'creator') fp++
    if (predicted === 'creator' && label === 'auto') fn++
  }
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  }
}

describe('a minőségi kapu mérése a címkézett halmazon', () => {
  it('kiírja a precisiont és a recallt, és mindkettő 0,9 felett van', () => {
    const { precision, recall } = measure(PUNCTUATION_THRESHOLD)

    console.log(
      `\nMinőségi kapu (küszöb ${String(PUNCTUATION_THRESHOLD)} írásjel / 100 szó), ` +
        `${String(GATE_LABELS.length)} címkézett elem:\n` +
        `  precision: ${precision.toFixed(3)}\n` +
        `  recall:    ${recall.toFixed(3)}\n`,
    )

    expect(precision).toBeGreaterThanOrEqual(0.9)
    expect(recall).toBeGreaterThanOrEqual(0.9)
  })

  it('a határeset benne van a halmazban, és a küszöb közelében mér', () => {
    const edge = GATE_LABELS.find((l) => l.id === 'hatareset')
    expect(edge).toBeDefined()

    const density = punctuationDensity(edge!.text)
    expect(density).toBeLessThan(PUNCTUATION_THRESHOLD * 2)
    expect(classifyCaptions(edge!.text)).toBe(edge!.label)
  })

  it('a halmaz mindkét osztályt tartalmazza', () => {
    const labels = new Set(GATE_LABELS.map((l) => l.label))
    expect(labels).toEqual(new Set(['creator', 'auto']))
  })

  it('egy elcsúsztatott küszöb rontja a mérést — a halmaz tehát érzékeny', () => {
    // Ha ez a teszt bukik, a címkézett halmaz nem diszkriminál, és a fenti
    // 0,9-es kapuk semmit nem bizonyítanak.
    const eltolt = measure(20)
    expect(Math.min(eltolt.precision, eltolt.recall)).toBeLessThan(0.9)
  })
})
```

- [ ] **3. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/normalize/gate.test.ts`
Elvárt: FAIL — `Cannot find module '../../evals/fixtures/gate.js'`

- [ ] **4. lépés: Futtasd újra a fixture megírása után**

Futtasd: `mise exec -- pnpm vitest run src/normalize/gate.test.ts`
Elvárt: PASS, 4 teszt, és a kimenetben megjelenik a két szám.

> **Ha a precision vagy a recall 0,9 alatt van:** ne a küszöböt hangold. A
> küszöb egy **mért szakadék** közepe 153 valós fájlon; ha a szintetikus
> halmazon rosszul teljesít, akkor a szintetikus szövegek nem elég hűek a
> valós alakzatokhoz. Javítsd a fixture-szövegeket, ne a `classify.ts`-t.

- [ ] **5. lépés: Egészítsd ki a CI-t az offline méréssel**

`.github/workflows/ci.yml` — a `Build` lépés után:

```yaml
      - name: Offline mérés kulcs nélkül
        run: pnpm eval
        env:
          LITELLM_API_KEY: ''
          LITELLM_BASE_URL: ''
```

> Az üres környezeti változók nem véletlenek: **bizonyítják**, hogy a mérés
> kulcs nélkül fut. Ha a harness bármikor valódi hívást kezdene, ez a lépés
> hasalna el elsőként.

- [ ] **6. lépés: Ellenőrizd a teljes készletet, majd commitolj**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add evals/fixtures/gate.ts src/normalize/gate.test.ts .github/workflows/ci.yml
git commit -m "test(normalize): a minőségi kapu precisionje és recallja címkézett halmazon"
```

---

### Feladat 16: Végponttól végpontig ellenőrzés és a dokumentáció

Ez a feladat nem új kódot ír, hanem **megfigyelhető viselkedésként ellenőrzi
a fázis mind a négy sikerkritériumát**, valós adaton.

**Fájlok:**
- Módosít: `README.md`, `docs/architecture.md`, ez a terv

**Előfeltétel:** a `tmp/pinchflat-minta` korpusz a helyén van
(`pnpm sample:fetch`), és az `.env` tartalmazza a LiteLLM alap-URL-jét, a
kulcsot, a két modellnevet, a négy árat és a plafont.

- [ ] **1. lépés: Első kritérium — friss klón, kulcs nélkül, offline**

```bash
git clone . /tmp/refinery-friss-klon
cd /tmp/refinery-friss-klon
mise exec -- pnpm install
env -u LITELLM_API_KEY -u LITELLM_BASE_URL mise exec -- pnpm eval
```

Elvárt: a mérés lefut, pontszámokat ír ki, kilépési kód `0`. **Jegyezd fel a
kiírt pontszámokat** — ezek kerülnek a záró szakaszba.

- [ ] **2. lépés: Második kritérium — a kapu precisionje és recallja**

```bash
mise exec -- pnpm vitest run src/normalize/gate.test.ts
```

Elvárt: a két szám megjelenik a kimenetben, mindkettő 0,9 felett, és a
határeset a halmazban van. **Jegyezd fel a két számot.**

- [ ] **3. lépés: Negyedik kritérium — a becslés és a plafon**

Előbb a megállítás, szándékosan alacsony plafonnal:

```bash
mise exec -- pnpm build
REFINERY_COST_LIMIT_USD=0.001 node dist/cli.js run --recipe summary --limit 5
```

Elvárt: a becslés kiíródik (elemszám, token, dollár, plafon), utána a futás
megáll, **egyetlen modellhívás nélkül**, és a kilépési kód `2`. Ellenőrizd,
hogy a vault munkafája érintetlen: `git -C "$VAULT_PATH" status --porcelain`
üres.

Aztán a plafon hiánya:

```bash
env -u REFINERY_COST_LIMIT_USD node dist/cli.js run --recipe summary --limit 1
```

Elvárt: hibaüzenet, ami a `REFINERY_COST_LIMIT_USD`-t nevezi meg, és a futás
el sem indul — köteg nem indul felső korlát nélkül.

- [ ] **4. lépés: Szárazon futtatás valós plafonnal**

```bash
node dist/cli.js run --recipe summary --limit 1 --dry-run
```

Elvárt: a becslés a plafon alatt van, a futás végigmegy, és a vault
munkafája **bit-azonos** marad.

- [ ] **5. lépés: Harmadik kritérium — éles futás egyetlen elemre**

```bash
node dist/cli.js run --recipe summary --limit 1
```

Elvárt:

- elkészül a `Youtube - <cím>_transcript.md` **és** a
  `Youtube - <cím>_summary.md` ugyanabban a mappában;
- a summary-jegyzet frontmatterében ott a `model`, az `iterations` és a
  `score`;
- a futás kiírja az elért pontszámot, a generálások számát és a költséget;
- a vault státusza pontosan a ténylegesen írt útvonalakkal bővül.

Ellenőrizd a frontmattert:

```bash
head -20 "$VAULT_PATH/Resources/Videos/YouTube/<Csatorna>/<Cím>/Youtube - <cím>_summary.md"
```

- [ ] **6. lépés: Idempotencia**

Futtasd ugyanazt a parancsot másodszor.

Elvárt: „már feldolgozva" státusz, **nulla modellhívás**, nulla új fájl, és a
vault munkafája tiszta.

- [ ] **7. lépés: Vezesd át az eltéréseket ebbe a tervbe**

Ha a végrehajtás bármely ponton eltért a tervtől, **javítsd fentebb a
feladatot**, és a záró szakaszban csak az eltérés okát hagyd meg — ahogy a
Fázis 0 terve is teszi.

- [ ] **8. lépés: Frissítsd a dokumentációt**

`README.md`:

- az állapot-blokk a Fázis 1-re álljon át;
- a „Még nincs megírva" szakaszból kerüljön ki a mérési harness, a
  receptmotor és a modellréteg;
- kerüljön be a **C++ toolchain előfeltétel** az `evalite` natív
  függősége miatt, és az, hogy a mérés kulcs nélkül futtatható.

`docs/architecture.md` §14 — az „Evalite aktuális API-ja" nyitott pont
lezárható; a helyére a mért tények kerülnek (verzió, a `better-sqlite3`
következménye, a Vitest 4 igény).

- [ ] **9. lépés: Commitolj, és nyisd meg a PR-t**

```bash
git add README.md docs/architecture.md docs/plans/2026-09-01-fazis-1-elso-recept.md
git commit -m "docs: a Fázis 1 ellenőrzése valós korpuszon"
```

---

## Amit ez a fázis szándékosan nem tartalmaz

- **Whisper-újratranszkribálást.** A minőségi kapu besorol, de az automatikus
  feliratot a Fázis 1 is változatlanul dolgozza fel. Ez a Fázis 2.
- **Második receptet.** Egy recept elég annak bizonyítására, hogy a motor áll;
  hogy egy új recept *tényleg* egyetlen fájl, azt a Fázis 3 bizonyítja egy
  commit-tal.
- **Strukturált kimenetet a receptben.** A `Recipe` interfészből a Fázis 1-ben
  kimarad a `schema` és a `render` mező, amit az `architecture.md` §8 felsorol.
  Prózarecepthez egyik sem kell, és holt ágat nem építünk — a tanulókártya
  receptje hozza be őket a Fázis 3-ban.
- **A privát, 20 elemű mérőhalmazt és a kulcspont-listákat.** A betöltő kész
  és a `keyPoints` mező végigmegy a rendszeren, de a kurált listák megírása
  külön munka.
- **A modell-bakeoffot.** A jelöltlista (lentebb) megvan, de a mért
  modellválasztás külön futás, saját kerettel.
- **Szerepenkénti költségbontást a jegyzetben.** A `costOf` a draft
  árazásával számol, ami felülről becsül. A bontás akkor kerül be, amikor a
  bakeoff igényli.
- **URL-alapú ingestet** (Fázis 4) és **bármilyen felületet** (Fázis 5).

---

## Modell-jelöltek a későbbi bakeoffhoz

Ez a lista **tier- és ár alapú szűkítés, nem mérés.** A projekt kimondott
álláspontja, hogy a modellválasztás mérési eredmény (`decisions/0004`); ez a
tábla csak azt rögzíti, mely jelöltekkel érdemes elindulni, amikor a
bakeoffra sor kerül.

| Szerep | Jelöltek |
|---|---|
| `draft` | `claude-sonnet-5`, `claude-haiku-4-5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`, `gpt-5.1`, `gpt-5-mini`, `grok-4.6`, `grok-4.3`, `grok-4-fast` |
| `judge` | `claude-opus-5`, `claude-sonnet-5`, `gpt-5.4`, `gpt-5.6-terra`, `gpt-5.2`, `gpt-5.1`, `grok-4.6`, `grok-4.3`, `grok-4-fast-reasoning` |

Két megjegyzés, ami nem árlistából jön:

- **`gpt-5.3-codex` és `grok-code-fast-1` egyik szerepre sem jelölt.**
  Kódgenerálásra hangolt modellek, a projekt viszont prózát generál és
  értékel — a mismatch elég ahhoz, hogy a mérésbe se kerüljenek be.
- **`grok-4-fast-reasoning` a legolcsóbb reasoning-képes jelölt a listán.** A
  lépésenkénti gondolkodás pont az, ami egy hűség- és
  lefedettség-értékelőnél számít, tehát a „fast" tier ellenére erős
  bíró-jelölt.

A szállított alapértelmezés — `draft: claude-sonnet-5`,
`judge: grok-4-fast-reasoning` — azért ez a páros, mert **más gyártó a
generátor és a bíró.** Az `architecture.md` §8 azért írja elő az eltérő
bíró-modellt, mert az önpreferencia-torzítás rontja a mérést; a
családszintű eltérés ezt erősebben zárja ki, mint egy verziószintű.

---

## Végrehajtás

**2026-09-04**, a `feat/fazis-1-elso-recept` ágon, feladatonként egy commit.
Záró állapot a 15. feladat után: **29 tesztfájl, 212 teszt zöld**,
`typecheck`, `lint` és `build` tiszta. A 16. feladat mind a négy
sikerkritériumot megfigyelhető viselkedésként ellenőrizte, valós LiteLLM
gateway-en és valós vaulton.

Két ponton tért el a végrehajtás a tervtől. Az első **fentebb, a Feladat
13-nál át van vezetve**, itt csak az ok marad meg; a második (a
`better-sqlite3` natív fordítási inkompatibilitása) csak itt szerepel, mert a
Feladat 14 saját szakasza — szándékosan — a megvalósítás előtti,
akkor még nem cáfolt feltételezést őrzi:

| Hol | Miért kellett eltérni |
|---|---|
| Feladat 13, `runRecipe` | A „száraz futtatás" elnevezésből az következne, hogy nulla költséggel jár. A `deps.options.dryRun` ellenőrzés a kódban csak a `store.recordArtifact`-ot és — a `publishNote`-on belül — a tényleges fájlírást kerüli el; a `refine()` hívás feltétel nélküli. A 16. feladat 4. lépése ezt valós híváson igazolta: egy `--dry-run` futás 0,1192 $ tényleges LiteLLM-költséggel járt, a vault munkafájának érintetlensége mellett. |
| Feladat 14, `evalite` tranzitív függősége | A fenti, „Amit a megvalósítás előtt verifikáltunk" táblázat még a natív fordítás sikerét rögzíti — a valóságban a `better-sqlite3@^11.6.0` **nem fordult** a pinnelt Node `26.2.0` V8-ján (valódi API-eltávolítások, pl. `v8::Object::GetPrototype`, `v8::Context::GetIsolate`, nem hiányzó fordítói lánc). A `pnpm-workspace.yaml` `overrides` bejegyzése `^13.0.3`-ra emeli a függőséget, ami natív fordítási **és** JS/futásidejű szinten is verifikáltan helyesen működik. |

### Ellenőrzés valós korpuszon (16. feladat)

**1. kritérium — friss klón, kulcs nélkül, offline.** Friss klónon,
`LITELLM_API_KEY` és `LITELLM_BASE_URL` nélkül a `pnpm eval` lefutott,
kilépési kód `0`, és kiírta a „A privát mérőréteg nincs jelen…" üzenetet — a
mérés a publikus, szintetikus rétegen futott:

| Generálás | Hiányok | Bemeneti token | Score |
|---|---|---|---|
| 1 | 0 | 3000 | 98% |
| 2 | 1 | 2000 | 0% |
| 2 | 0 | 6000 | 98% |

Aggregált pontszám: **65%**.

**2. kritérium — a kapu precisionje és recallja.**
`pnpm vitest run src/normalize/gate.test.ts`: 4/4 teszt zöld, **precision
1,000, recall 1,000** a hét elemű, kézzel címkézett halmazon. A `hatareset`
határeset-fixture valóban a küszöb közelében mér (sűrűség 1,887 a 2,0-s
küszöbhöz képest).

**4. kritérium — a becslés és a plafon, mindkét kapu.** Szándékosan alacsony
plafonnal (`REFINERY_COST_LIMIT_USD=0.001`, `--limit 5`): a becslés kiíródott
(„Becslés: 5 elem, ~562 814 token, ~0.93 $ (plafon: 0.00 $)"), utána a futás
megállt („A futás megállt: a becsült költség meghaladja a plafont (0.00 $ /
0.00 $)"), kilépési kód `2`, a vault munkafája a futás előtt és után
bit-azonos — nulla írás, nulla modellhívás. Plafon hiányában
(`REFINERY_COST_LIMIT_USD` nincs beállítva): a hibaüzenet
(„`REFINERY_COST_LIMIT_USD: Invalid input: expected number, received NaN`")
megnevezi a változót, kilépési kód `1`, a futás el sem indult.

**Száraz futtatás valós plafonnal.** `--dry-run` mellett a becslés a plafon
alatt volt, a futás végigment, és a vault munkafája bit-azonos maradt — de,
ahogy a Feladat 13 fenti megjegyzése rögzíti, **nem** modellhívás nélkül:
pontszám 0,97, 1 generálás, 0,1192 $ tényleges LiteLLM-költség.

**3. kritérium — éles futás egyetlen elemre.** `--recipe summary --limit 1`:
elkészült a `Youtube - <cím>_transcript.md` **és** a
`Youtube - <cím>_summary.md` ugyanabban a mappában. A summary-jegyzet
frontmatterében: `model: claude-sonnet-5`, `iterations: 1`, `score: 0.97`,
`cost_usd: 0.1192`. A konzol kiírta az elért pontszámot, a generálások számát
és a költséget. A vault státusza pontosan egy új bejegyzéssel bővült
(`Resources/Videos/YouTube/3Blue1Brown/`); a `--no-commit` kapcsoló miatt a
vault-repóba nem került commit — ez szándékos, a döntést a felhasználóra
hagyva.

**Idempotencia.** Ugyanazt a parancsot másodszor futtatva: „wjZofJX0v4M: már
feldolgozva", „Kész: 0 sikeres, 1 kihagyva, 0 hibás", kilépési kód `0`,
**nulla új modellhívás** (nincs pontszám/generálás-sor a kimenetben), és a
vault munkafája bit-azonos a második futás előtti állapottal.

**Ezzel a fázis mind a négy sikerkritériuma teljesült**, a szintetikus
fixture-ökön és valós adaton, valós LiteLLM gateway-en egyaránt.
