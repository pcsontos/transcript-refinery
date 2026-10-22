# Telegram: elemcímke és receptenkénti modellváltás — megvalósítási terv

> **A végrehajtónak:** a terv natívan, skill és alügynök nélkül fut (Read, Edit, Bash). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** a futás három Telegram-üzenete (Sorba került, Elkezdődött, hiba) az elem azonosítójával és címével kezdődik (#274). A recept → modell hozzárendelés Telegramról egyszeri vagy állandó móddal állítható, a 8 alapreceptre és egy közös fordítás-kulcsra (#292).

**Felépítés:**
- **1. ütem (#274):** csak a Worker változik. A `runLabel` megkapja a sort (`videoId`, `title`), a hat hívóhely ezt adja át. A serve-hez nem kell nyúlni.
- **2. ütem (#292):** a felülírás a Worker D1-ében él. A `requestRun` a futás sorába írja a modellt (`runs.model`), a kopogtatás `models` mezőben viszi, a serve a futás idejére a `raw.model.recipes`-be fésüli. A serve nem tárol semmit. Új serve-végpont csak olvasásra van: `GET /models`.

**Technológia:** TypeScript, Cloudflare D1 (SQL-migráció), `node:http`, zod, vitest.

**Spec:** `docs/plans/2026-10-22-telegram-cimke-modellvaltas-spec.md`

**Ágak:**
1. `feat/telegram-cimke` a `main`-ről: kód-PR, utána kiadás. Csak Worker-telepítés kell, a konténerkép nem változik.
2. `feat/modellvaltas` a `main`-ről, az 1. ütem merge-e után: kód-PR, utána kiadás. Ehhez kép, Worker, D1-migráció és a peter-mba config módosítása is kell.

## Eltérések a spectől (a tervezés közben dőltek el)

| Spec | Terv | Miért |
|---|---|---|
| Nyitott: a `GET /models` foglalja-e a kaput | Nem foglalja | Csak olvassa a configot (`loadCliConfig` + `loadModelConfig`), a futás állapotához nem nyúl. A `notes` forrása a vault-pull miatt foglal, itt nincs pull. |
| A sémás ellenőrzés helye nyitott | A `runRecipes` elején, a vault-pull előtt | Hibás felülírásnál így nincs pull, és modellhívás sincs. A `loadModelConfig` az árat, az új `assertOverrideModels` a `switchable` tagságot és a `structured` jelzést nézi. |
| Az újrapróba modellje nyitott | A `claimRun` új, elhagyható `model` paramétere írja | A `failed` → `queued` újrapróba is a koppintás pillanatának felülírását kapja. A megszakítás (`claimRun` 3 paraméterrel) a modellt nem érinti. |
| `ModelConfig.switchable` | Elhagyható mező | A meglévő tesztek `ModelConfig`-literáljai (7 fájl) így változatlanok. A `loadModelConfig` mindig kitölti. |

## Globális megkötések

- Új függőség nincs.
- Új fájl csak: `worker/migrations/0006_model_overrides.sql`.
- Magyar kommentek és üzenetek, a környező kód sűrűségével. Tudatos korlátnál `ponytail:` komment.
- Ellenőrzés minden feladat végén: `pnpm typecheck && pnpm lint && pnpm test`, mind zöld.
- Commit minden feladat végén a `commit-message` skill-lel.

## Amire a review figyeljen

1. **A címke mind a hat hívóhelyen ugyanaz** (`handle.ts:538, 563, 589, 598, 688, 757`), a késői, megszakított futás hibájánál is.
2. **A felirat-job üzenetei nem változnak.** A `queuedLine` (`Sorba került: <id>`) és a `waitingLine` régi alakja marad. A tesztekben a két alak könnyen összekeveredik.
3. **Az egyszeri felülírás csak sikeres `insertRun` vagy `claimRun` után fogy el.** A `busy`, a `resend` és az `ignore` nem fogyaszt, a 4. feladat tesztje ezt rögzíti.
4. **A gombadat 64 bájtja:** a modelllista azt a modellt hagyja ki, amelynél a leghosszabb gombadat (`o:a:<recept>:<modell>`) 64 bájt fölött van. UTF-8 bájtban mérünk, nem karakterben.
5. **A `models` a serve határán megbízhatatlan bemenet.** Az `isJob` csak szöveg → szöveg objektumot enged át. A kulcsot az `assertRecipeModels`, az árat a `loadModelConfig`, a `switchable` tagságot és a `structured` jelzést az `assertOverrideModels` ellenőrzi.

---

# 1. ütem — #274 (ág: `feat/telegram-cimke`)

### 1. feladat: elemcímke a futásüzenetekben

**Fájlok:**
- Módosul: `worker/src/messages.ts` (`runLabel`, `runQueuedLine`, `runStartedLine`, `runFailedLine`)
- Módosul: `worker/src/handle.ts` (a hat hívóhely)
- Teszt: `worker/src/plan.test.ts:264–267`, `worker/src/handle.test.ts` (a futásüzenet-elvárások)

**Kód (`messages.ts`, a mai `runLabel` és a három függvény helyére):**
```ts
/** A futásüzenet tárgya (#274): a vault-azonosító és a cím. */
type RunItem = Pick<JobRow, 'videoId' | 'title'>
type RunPart = Pick<RunRow, 'recipes' | 'lang'>

const LABEL_TITLE_MAX = 60

function shortTitle(title: string): string {
  const chars = [...flatTitle(title)]
  return chars.length > LABEL_TITLE_MAX ? `${chars.slice(0, LABEL_TITLE_MAX - 1).join('')}…` : chars.join('')
}

function runLabel(item: RunItem, run: RunPart): string {
  const head = item.title === null ? `[${item.videoId}]` : `[${item.videoId}] ${shortTitle(item.title)}`
  return `${head}: ${run.recipes.join(', ')}${run.lang === null ? '' : ` → ${run.lang}`}`
}

export function runQueuedLine(item: RunItem, run: RunPart): string {
  return `Sorba került ${runLabel(item, run)}`
}

export function runStartedLine(item: RunItem, run: RunPart): string {
  return `Elkezdődött a feldolgozás ${runLabel(item, run)}. Hamarosan jelzem az eredményt.`
}

export function runFailedLine(item: RunItem, run: RunPart, error: string): string {
  return `${runLabel(item, run)}: ${error}`
}
```
A `messages.ts` a `JobRow` és a `RunRow` típust a `./store.js`-ből importálja (`import type`). A `store.ts` nem importál a `messages.ts`-ből, ezért kör nincs.

**Hívóhelyek (`handle.ts`):** a `row` a `JobRow`, a `run` a `RunRow`, illetve a `fresh`.
- 538 és 757: `text: runStartedLine(row, run)`
- 563, 589: `runFailedLine(row, run, body.error)`
- 598: `runFailedLine(row, run, MISSING_NOTE_URL)`
- 688: `runQueuedLine(row, fresh)`

- [x] **1. lépés: a bukó tesztek.**
  - `plan.test.ts:264–267` új elvárásai, `const ITEM = { videoId: 'abcdefghijk', title: 'Cím' }` mellett:
    - `runQueuedLine(ITEM, { recipes: ['notes'], lang: null })` → `'Sorba került [abcdefghijk] Cím: notes'`
    - `runQueuedLine(ITEM, { recipes: ['summary', 'notes'], lang: 'de' })` → `'Sorba került [abcdefghijk] Cím: summary, notes → de'`
    - `runFailedLine(ITEM, { recipes: ['qa'], lang: null }, 'A futás megállt.')` → `'[abcdefghijk] Cím: qa: A futás megállt.'`
    - `runStartedLine(ITEM, { recipes: ['notes'], lang: null })` → `'Elkezdődött a feldolgozás [abcdefghijk] Cím: notes. Hamarosan jelzem az eredményt.'`
  - Új esetek:
    - cím nélkül: `runQueuedLine({ videoId: 'abcdefghijk', title: null }, { recipes: ['qa'], lang: null })` → `'Sorba került [abcdefghijk]: qa'`;
    - 100 karakteres cím (`'é'.repeat(100)`): a címrész `'é'.repeat(59) + '…'`, vagyis pontosan 60 karakter;
    - pontosan 60 karakteres cím: változatlan, `…` nélkül;
    - sortörést tartalmazó cím (`'Egy\nkettő'`): `'[…] Egy kettő: …'`.
  - `handle.test.ts`: minden *futás*-üzenet elvárása az új alakra. A `readyRow` címe `'Cím'`, ezért például a 468. sor `['Sorba került [abcdefghijk] Cím: notes']`, a 784. sor `STARTED` segédje pedig `` `Elkezdődött a feldolgozás [${ID}] Cím: ${label}. Hamarosan jelzem az eredményt.` `` lesz. A felirat- és szövegjob-elvárásokhoz nem nyúlunk (180, 210, 212, 828, 1149, 1168, 1179, 1233, 1245, 1247, 1264). A futás-elvárásokat a `pnpm vitest run worker` bukó sorai adják ki: minden bukó `Sorba került: <recept>`, `Elkezdődött a feldolgozás:` és `<recept>: <hiba>` elvárást át kell írni.
  - Szöveges tételre egy új `handle.test.ts` eset: `readyRow({ videoId: 't-0123456789abcdef', jobId: '5:t-0123456789abcdef', title: 'eloadas-jegyzet' })`, `r:notes:5:t-0123456789abcdef` koppintás → `'Sorba került [t-0123456789abcdef] eloadas-jegyzet: notes'`.
- [x] **2. lépés:** `pnpm vitest run worker` → FAIL (régi szöveg).
- [x] **3. lépés:** a fenti kód és a hat hívóhely.
- [x] **4. lépés:** `pnpm vitest run worker` → PASS. Mutációs próba: a `LABEL_TITLE_MAX - 1`-ből `LABEL_TITLE_MAX` lesz, és a 100 karakteres eset elbukik. Utána visszaállítás. Teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(worker): Show item id and title in run messages`, `Closes #274`).

### 2. feladat: kód-PR és kiadás

- [ ] PR a `feat/telegram-cimke`-ről, `gh pr checks` zöld (CI), merge.
- [ ] Kiadás a bevált menettel (bumpp, changelog-generator, PR, tag). Konténerkép nem kell, mert a serve nem változott. Worker-telepítés kell.
- [ ] Éles próba: egy videón a `summary` gomb után a Sorba került és az Elkezdődött üzenet `[<id>] <cím>:`-mal kezdődik.

---

# 2. ütem — #292 (ág: `feat/modellvaltas`, az 1. ütem merge-e után)

### 3. feladat: a `model.switchable`, a felülírás befésülése és a `GET /models` (serve)

**Fájlok:**
- Módosul: `src/config.ts` (`ModelSchema`, `ModelConfig`, `loadModelConfig`, az `asRecord` exportja)
- Módosul: `src/model/recipe-model.ts` (három új függvény)
- Módosul: `src/serve/job.ts` (`ServeJob.models`, `JobEffects.refine`, a `refine` hívása)
- Módosul: `src/serve/http.ts` (`isJob`, `ServeServerInput.models`, `GET /models`)
- Módosul: `src/serve/command.ts` (`RecipesRun`, `serveEffects.refine`, `models` a szerverbe)
- Módosul: `src/serve/summary.ts` (`runRecipes`)
- Teszt: `src/config.test.ts`, `src/model/recipe-model.test.ts`, `src/serve/http.test.ts`, `src/serve/summary.test.ts`, `src/serve/job.test.ts`

**Config:**
A `ModelSchema` `model` objektumába, a `recipes` után:
```ts
    /**
     * Telegramról ezekre lehet váltani (#292): modell → `structured` (sémás JSON-t ad) vagy `text`.
     * Mindnek kell ár, mint a `recipes` modelljeinek.
     */
    switchable: z
      .record(z.string().min(1), z.enum(['structured', 'text'], 'A model.switchable értéke structured vagy text.'))
      .default({}),
```
- `ModelConfig` kap egy mezőt: `/** Telegramról váltható modellek; hiányában egy sem. */ switchable?: Readonly<Record<string, 'structured' | 'text'>>`.
- A `loadModelConfig`-ban a hiányzó ár vizsgálata (`missing`) a `switchable` kulcsait is nézi: `[...new Set([...used, ...Object.keys(c.model.switchable)])]`, a hibaüzenet felsorolásába pedig bekerül a `model.switchable`. A régi pricing-alak vizsgálata (`legacyPricingKeys`) nem változik.
- A visszatérési értékbe: `switchable: c.model.switchable`.
- Az `asRecord` (`config.ts`) `export`-ot kap.

**`recipe-model.ts`:**
```ts
import type { Registry } from '../recipe/registry.js'
// A meglévő `import type { ModelConfig }` sor helyére; a `config.ts` `asRecord`-ja `export`-ot kap.
import { asRecord, type ModelConfig } from '../config.js'

/** A YAML `model.recipes` a kérés felülírásával (#292); a nyers configot nem módosítja. */
export function withRecipeModels(raw: unknown, overrides: Readonly<Record<string, string>>): unknown {
  if (Object.keys(overrides).length === 0) return raw
  const root = asRecord(raw) ?? {}
  const model = asRecord(root.model) ?? {}
  return { ...root, model: { ...model, recipes: { ...asRecord(model.recipes), ...overrides } } }
}

/**
 * A felülírás csak `model.switchable` modell lehet, sémás receptnél `structured` jelzéssel.
 * A YAML `model.recipes`-t nem nézi, csak a Telegram-felülírást.
 */
export function assertOverrideModels(
  cfg: ModelConfig,
  registry: Registry,
  overrides: Readonly<Record<string, string>>,
): void {
  const switchable = cfg.switchable ?? {}
  const bad = Object.entries(overrides).filter(([id, model]) => {
    const kind = switchable[model]
    return kind === undefined || (registry[id]?.structured !== undefined && kind !== 'structured')
  })
  if (bad.length === 0) return
  throw new Error(
    `model: nem váltható modell: ${bad.map(([id, model]) => `${id}=${model}`).join(', ')}. Telegramról csak a model.switchable modelljei választhatók, sémás recepthez structured jelzéssel.`,
  )
}

export interface ModelsView {
  draft: string
  recipes: Readonly<Record<string, string>>
  models: { name: string; structured: boolean }[]
  structuredRecipes: string[]
}

/** A `GET /models` válasza: a YAML-alap és a `model.switchable` modelljei. */
export function modelsView(cfg: ModelConfig, registry: Registry): ModelsView {
  return {
    draft: cfg.models.draft,
    recipes: cfg.recipeModels,
    models: Object.entries(cfg.switchable ?? {}).map(([name, kind]) => ({ name, structured: kind === 'structured' })),
    structuredRecipes: Object.keys(registry).filter((id) => registry[id]?.structured !== undefined),
  }
}
```
Ha a `recipe-model.ts` és a `registry.ts` között import-kör lenne, a `Registry` típus `import type`, tehát futásidőben nem okoz kört.

**`ServeJob` és `isJob`:**
- `ServeJob` kap egy mezőt: `/** Receptazonosító → modell, a futás tényleges azonosítóival (`notes`, `notes-hu`); a Worker felülírása (#292). */ models?: Record<string, string>`.
- Az `isJob` típusába bekerül a `models?: unknown`, és a `return` elé ez az ellenőrzés:
  ```ts
  if (job.models !== undefined) {
    if (typeof job.models !== 'object' || job.models === null || Array.isArray(job.models)) return false
    if (!Object.values(job.models).every((model) => typeof model === 'string' && model !== '')) return false
  }
  ```

**A `refine` útja:**
- A `JobEffects.refine` és a `serveEffects` `refine` mezője hatodik paramétert kap: `models?: Readonly<Record<string, string>>`.
- A `runJob` (`job.ts:288`) a `job.models`-t adja át.
- A `RecipesRun` és a `refineWith({...})` egy `models` mezőt kap.
- A `runRecipes` bemenete: `/** A Worker felülírása; a YAML `model.recipes` fölé kerül. */ models?: Readonly<Record<string, string>>`.

**`runRecipes` (`summary.ts`):**
1. A `cfg` összeállítása (a `sources` és a `translate` felülírása) a `git.pull` **elé** kerül. Tiszta számítás, a pull nem befolyásolja.
2. Közvetlenül utána:
   ```ts
   const models = input.models ?? {}
   const raw = withRecipeModels(loaded.raw, models)
   if (Object.keys(models).length > 0) {
     try {
       assertOverrideModels(loadModelConfig(raw, process.env, cfg.configPath), recipesFor(cfg), models)
     } catch (error) {
       return { ok: false, error: firstLine(error instanceof Error ? error.message : String(error)) }
     }
   }
   ```
3. A `commandRun` a `loaded.raw` helyett a `raw`-t kapja. A parancssor: ``command: ['serve recipes', ...Object.entries(models).map(([id, model]) => `${id}=${model}`)].join(' ')``.

**`GET /models` (`http.ts`):**
- A `ServeServerInput` kap egy mezőt: `/** A `GET /models` forrása; hiányában a végpont `503`. */ models?: () => Promise<ModelsView>`.
- A `handle`-ben a `/status` után:
  ```ts
  if (request.method === 'GET' && path === '/models') {
    if (!authorized(request.headers.authorization, input.secret)) {
      rejectUnauthorized(request, response)
      return
    }
    try {
      if (input.models === undefined) throw new Error('nincs modellforrás')
      sendBody(response, 200, 'application/json', JSON.stringify(await input.models()))
    } catch (cause) {
      console.warn(`[serve] 503 /models: ${cause instanceof Error ? firstLine(cause.message) : String(cause)}`)
      send(response, 503)
    }
    return
  }
  ```
  A `firstLine` a `summary.ts`-ből jön. Ha az import kört okozna, helyben egy `message.split('\n')[0]` is elég.
- `command.ts`, a `createServeServer({...})`-ban:
  ```ts
  // A config kérésenként töltődik, mint a receptfuttatásnál; a kaput nem foglalja, mert csak olvas.
  models: async () => {
    const { cfg, raw } = await loadCliConfig(configArg)
    return modelsView(loadModelConfig(raw, process.env, cfg.configPath), recipesFor(cfg))
  },
  ```

- [x] **1. lépés: a bukó tesztek.**
  - `config.test.ts`:
    - `model.switchable: { a: 'structured', b: 'text' }`, ahol mindkettőnek van ára → a `switchable` ugyanez;
    - hiányzó `switchable` → `{}`;
    - `{ a: 'igen' }` → séma-hiba, az üzenetben `structured vagy text`;
    - `{ c: 'text' }`, és a `c`-nek nincs ára → `pricing: nincs ára … c` hiba.
  - `recipe-model.test.ts`:
    - `withRecipeModels({ model: { draft: 'd', recipes: { qa: 'x' } }, pricing: {} }, { notes: 'y' })` → `model.recipes` = `{ qa: 'x', notes: 'y' }`, és a bemenet változatlan (a `toEqual` egy előtte készült `structuredClone`-nal).
    - Üres felülírásnál ugyanazt az objektumot adja vissza (`toBe`).
    - `assertOverrideModels`, egy `{ notes: { structured: {...} }, summary: {} }` alakú registry és `switchable: { semas: 'structured', szoveg: 'text' }` mellett:
      - a `{ notes: 'szoveg' }` dob, az üzenetben `notes=szoveg` áll;
      - a `{ summary: 'ismeretlen' }` dob;
      - a `{ summary: 'szoveg' }`, a `{ summary: 'semas' }` és a `{ notes: 'semas' }` nem dob.
    - `modelsView`: a `CFG` fixtúra `switchable: { 'sonnet-proba': 'structured', 'draft-modell': 'text' }` kiegészítésével a `models` pontosan ez a két modell, a helyes `structured` jelzővel, a `judge-modell` nélkül; a `structuredRecipes` a valódi `RECIPES`-ből `['notes', 'flashcards', 'bloom']` (a sorrendet a registry adja, `toEqual(expect.arrayContaining(...))` és hossz).
  - `http.test.ts`:
    - a `GET /models` titok nélkül 401;
    - titokkal, `models` forrással 200 és a forrás JSON-ja;
    - ha a forrás dob, 503;
    - forrás nélkül 503;
    - a `POST /jobs` `models: { notes: 'x' }`-szel 202, `models: { notes: 3 }`-mal 400, `models: ['x']`-szel 400.
  - `job.test.ts`: a `refine` hamisítvány hatodik paraméterként megkapja a `job.models`-t.
  - `summary.test.ts`, a `scene(5, { switchable: { 'proba-sonnet': 'structured', 'proba-draft': 'text' } })` mellett. A `scene` pricing-jéhez egy harmadik modell kell: a `scene` kap egy elhagyható `pricingExtra` paramétert, és a teszt `'proba-sonnet': { input_per_million: 3, output_per_million: 15 }`-t ad.
    - `models: { summary: 'proba-sonnet' }`: a kész summary-jegyzet frontmatterjében `model: proba-sonnet` áll, a futásnapló `run:started` eseményének `command`-ja `serve recipes summary=proba-sonnet`.
    - `models: { summary: 'nincs-ara' }`: `{ ok: false }`, a hiba `pricing: nincs ára` kezdetű, a kliens `generate` hívásszáma 0, és a vault-originben nincs új commit.
    - `models: { summary: 'proba-judge' }` (van ára, de nincs a `switchable`-ben): `{ ok: false }`, a hiba `model: nem váltható modell` kezdetű, 0 modellhívás.
    - `models: { notes: 'proba-draft' }` (a `proba-draft` `text`): `{ ok: false }`, a hiba `model: nem váltható modell` kezdetű, 0 modellhívás.
- [x] **2. lépés:** `pnpm vitest run src/config src/model src/serve` → FAIL.
- [x] **3. lépés:** a fenti kód.
- [x] **4. lépés:** PASS. Mutációs próba: az `assertOverrideModels` szűrőjéből kikerül a `registry[id]?.structured !== undefined &&`, és a „`summary` `text` modellel nem dob" eset elbukik. Visszaállítás, teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(serve): Accept per-run model overrides and list models`).

### 4. feladat: a felülírás tárolása és a futás modellje (Worker)

**Fájlok:**
- Új: `worker/migrations/0006_model_overrides.sql`
- Módosul: `worker/src/store.ts` (`RunRow.model`, `ModelOverride`, `JobStore` három új metódusa és a `claimRun`, `memoryStore`)
- Módosul: `worker/src/d1.ts` (`RunRecord.model`, `toRun`, `insertRun`, `claimRun`, három új metódus)
- Módosul: `worker/src/handle.ts` (`PlannedKnock.models`, `requestRun`, `knockFor`)
- Módosul: `worker/src/messages.ts` (`runLabel` a modellel)
- Teszt: `worker/src/store.test.ts`, `worker/src/d1.test.ts`, `worker/src/handle.test.ts`, `worker/src/plan.test.ts`

**Migráció:**
```sql
CREATE TABLE model_overrides (
  sub TEXT NOT NULL,
  recipe TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT NOT NULL,
  PRIMARY KEY (sub, recipe, mode)
);
ALTER TABLE runs ADD COLUMN model TEXT;
```

**`store.ts`:**
```ts
export type OverrideMode = 'once' | 'always'

/** Telegramról állított modell; `recipe` egy alaprecept, vagy `translate` minden fordításra (#292). */
export interface ModelOverride {
  sub: string
  recipe: string
  mode: OverrideMode
  model: string
}
```
- A `RunRow` kap egy mezőt: `/** A futás felülírt modellje; `null` vagy hiány esetén a config dönt. */ model?: string | null`.
- A `JobStore` új metódusai:
  ```ts
  overridesFor(sub: string): Promise<ModelOverride[]>
  /** Beszúr vagy cserél a `(sub, recipe, mode)` kulcson. */
  setOverride(override: ModelOverride): Promise<void>
  /** `mode` nélkül a recept mindkét felülírását törli. */
  clearOverride(sub: string, recipe: string, mode?: OverrideMode): Promise<void>
  ```
- A `claimRun` aláírása: `claimRun(runId, expect, next, model?: string | null)`. Ha a `model` `undefined`, a modell változatlan.
- `memoryStore`: egy `overrides: ModelOverride[]` tömb a három metódussal. A `claimRun` az új objektumba `...(model === undefined ? {} : { model })`-t tesz.

**`d1.ts`:**
- `RunRecord` kap egy `model: string | null` mezőt; a `toRun`-ba `model: record.model`.
- `insertRun`: a `model` oszlop és a `run.model ?? null` érték bekerül.
- `claimRun`: ha a `model !== undefined`, akkor
  `UPDATE runs SET status = ?, error = NULL, notified = 0, accepted_at = NULL, model = ? WHERE run_id = ? AND status = ?`,
  különben a mai SQL.
- `overridesFor`: `SELECT * FROM model_overrides WHERE sub = ?`.
- `setOverride`: `INSERT INTO model_overrides (sub, recipe, mode, model) VALUES (?, ?, ?, ?) ON CONFLICT(sub, recipe, mode) DO UPDATE SET model = excluded.model`.
- `clearOverride`: a `mode` szerint `DELETE … WHERE sub = ? AND recipe = ? AND mode = ?`, mode nélkül `… AND recipe = ?`.

**`handle.ts`:**
```ts
/** Alaprecept-futásnál a recept, fordításnál a közös `translate` kulcs; az egyszeri nyer (#292). */
async function pickOverride(row: JobRow, recipes: readonly string[], lang: string | null, deps: WorkerDeps) {
  if (row.sub === null) return null
  const key = lang === null ? (recipes[0] ?? '') : 'translate'
  const own = (await deps.store.overridesFor(row.sub)).filter((item) => item.recipe === key)
  return own.find((item) => item.mode === 'once') ?? own.find((item) => item.mode === 'always') ?? null
}
```
- A `requestRun`-ban a `fresh` előtt: `const override = await pickOverride(row, recipes, lang, deps)`. A `fresh` kap egy `model: override?.model ?? null` mezőt. A `claimRun` hívás: `deps.store.claimRun(id, run.status, 'queued', fresh.model)`.
- A `claimed` ellenőrzése után, a Sorba került üzenet előtt:
  ```ts
  // ponytail: két egyidejű koppintás ugyanazt az egyszerit kétszer is felhasználhatja; tranzakció, ha zavaró lesz.
  if (override?.mode === 'once' && row.sub !== null) await deps.store.clearOverride(row.sub, override.recipe, 'once')
  ```
- `PlannedKnock` kap egy mezőt: `/** Receptazonosító → modell; a `run.model`-ből, a futás minden fajtájára. */ models?: Record<string, string>`.
- A `knockFor`: `if (run.model) knock.models = Object.fromEntries(runKinds(run).map((kind) => [kind, run.model as string]))`. A `runKinds` importja a `plan.js`-ből.

**`messages.ts`:** a `RunPart` alias `Pick<RunRow, 'recipes' | 'lang' | 'model'>` lesz, a három függvény aláírása nem változik. A címke végére `${run.model ? ` (${run.model})` : ''}` kerül.

- [x] **1. lépés: a bukó tesztek.**
  - `plan.test.ts`: `runQueuedLine(ITEM, { recipes: ['notes'], lang: null, model: 'sonnet' })` → `'Sorba került [abcdefghijk] Cím: notes (sonnet)'`. Fordításnál: `'… Cím: summary, notes → de (sonnet)'`.
  - `store.test.ts`, `memoryStore`:
    - a `setOverride` kétszer ugyanarra a kulcsra egy sort hagy, az új modellel;
    - a `clearOverride(sub, 'notes', 'once')` az `always` sort meghagyja;
    - mode nélkül mindkettő törlődik;
    - más `sub` sorai érintetlenek.
  - `d1.test.ts`, a `capture()`-rel:
    - az `insertRun` SQL-je tartalmazza a `model` oszlopot, és a `run.model` értéke a bind-listában szerepel (`model` nélküli sornál `null`);
    - `claimRun(id, 'failed', 'queued', 'm')` SQL-je tartalmazza a `model = ?`-t, a 3 paraméteres hívásé nem;
    - a `setOverride` SQL-je `ON CONFLICT(sub, recipe, mode)`.
  - `handle.test.ts`:
    1. Egyszeri `notes = sonnet` mellett az `r:notes` koppintás:
       - a kopogtatás `models: { notes: 'sonnet' }`;
       - a Sorba került üzenet `(sonnet)`-re végződik;
       - a `store.overridesFor('sub-42')` üres.
       
       Egy második videón (`readyRow({ jobId: '6:…', updateId: 6, videoId: … })`) az `r:notes` már `models` nélkül, zárójel nélkül megy.
    2. Egyszeri `notes = a` és állandó `notes = b`: az első futás `a`, a második `b`.
    3. Állandó `translate = t`: az `l:3:de` koppintás (`summary`, `notes` → `de`) kopogtatása `models: { 'summary-de': 't', 'notes-de': 't' }`. Utána az `r:notes` alaprecept-futás `models` nélkül megy.
    4. Már kész, értesített `notes` futás (`readyRun(['notes'])`) mellett egyszeri `notes = sonnet`: az `r:notes` `resend`, kopogtatás nincs, az egyszeri megmarad.
    5. `failed` `notes` futás mellett állandó `notes = sonnet`: az újrapróba kopogtatása `models: { notes: 'sonnet' }`, a `store.run(id)?.model` `'sonnet'`.
    6. A cron újrakopogtatása (`handleCron` egy `queued` futásra, amelynek `model: 'sonnet'`) ugyanazt a `models`-t viszi.
    7. Más felhasználó (`sub-9`) felülírása nem hat a `sub-42` futására.
- [x] **2. lépés:** `pnpm vitest run worker` → FAIL.
- [x] **3. lépés:** migráció és a fenti kód.
- [x] **4. lépés:** PASS. Mutációs próba: a `requestRun`-ban az egyszeri törlése az `if (!claimed)` **elé** kerül, és a „sikertelen foglalás” eset elbukik (a 4. eset, a resend, ezt nem fogja meg: a `resend` ág korábban visszatér). Visszaállítás, teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(worker): Store model overrides and send them with the run`).

### 5. feladat: a `/model` parancs és a gombok (Worker)

**Fájlok:**
- Módosul: `worker/src/messages.ts` (új szövegek és billentyűzetek, `HELP_TEXT`, a `probeFailure` exportja)
- Módosul: `worker/src/plan.ts` (`Tap` és `parseTap`, a re-exportok)
- Módosul: `worker/src/handle.ts` (`COMMAND`, `WorkerDeps.models`, `handleCommand`, `handleTap`)
- Módosul: `worker/src/index.ts` (a `models` dep)
- Teszt: `worker/src/plan.test.ts`, `worker/src/handle.test.ts`, `worker/src/entry.test.ts` (ha a dep-összerakást teszteli)

**Típus (`messages.ts`):**
```ts
export type ModelsReply =
  | {
      ok: true
      draft: string
      recipes: Readonly<Record<string, string>>
      models: readonly { name: string; structured: boolean }[]
      structuredRecipes: readonly string[]
    }
  | { ok: false; reason: 'secret' | 'down' }
```

**Gombadat:** a mai fejekkel (`summary`, `f`, `r`, `d`, `c`, `t`, `n`, `l`) nem ütközik.

| Adat | Jelentés |
|---|---|
| `m:<kulcs>` | a kulcs modelllistája |
| `p:<kulcs>:<modell>` | a mód kérdése |
| `o:<o\|a>:<kulcs>:<modell>` | beállítás (`o` egyszeri, `a` állandó) |
| `x:<kulcs>` | visszaállítás |

A `<kulcs>` a `RECIPES` egyike vagy `translate`. A modell az utolsó mező, a maradék `join(':')`-tal, így kettőspontot is tartalmazhat. A `parseTap` csak ismert kulcsot és nem üres modellt fogad el.

```ts
| { type: 'model'; key: string }
| { type: 'modelPick'; key: string; model: string }
| { type: 'modelSet'; mode: 'once' | 'always'; key: string; model: string }
| { type: 'modelReset'; key: string }
```

**Szövegek (`messages.ts`):**
```ts
export const MODEL_KEYS = [...RECIPES, 'translate'] as const
const TAP_MAX = 64

function keyLabel(key: string): string {
  return key === 'translate' ? 'fordítás' : key
}

/** A `/model` kiírása: felülírás, ha van (az egyszeri elöl), különben a config szerinti modell. */
export function modelText(view: Extract<ModelsReply, { ok: true }>, overrides: readonly ModelOverride[]): string {
  const lines = MODEL_KEYS.map((key) => {
    const own = (['once', 'always'] as const).flatMap((mode) =>
      overrides.filter((item) => item.recipe === key && item.mode === mode),
    )
    if (own.length > 0) {
      const parts = own.map((item) => `${item.model} (${item.mode === 'once' ? 'egyszeri' : 'állandó'})`)
      return `${keyLabel(key)}: ${parts.join(' · ')}`
    }
    if (key === 'translate') return 'fordítás: a config szerint'
    return `${key}: ${view.recipes[key] ?? view.draft}`
  })
  return ['A receptek modellje:', ...lines].join('\n')
}

export function modelKeyboard(): Key[][] {
  return inRows(MODEL_KEYS.map((key) => ({ text: keyLabel(key), data: `m:${key}` })), 3)
}

/** A modellek, amelyek leghosszabb gombadata is belefér a Telegram 64 bájtjába. */
export function fitsTap(key: string, model: string): boolean {
  return new TextEncoder().encode(`o:a:${key}:${model}`).length <= TAP_MAX
}

export function modelPickLine(key: string): string {
  return `Melyik modellel fusson: ${keyLabel(key)}?`
}

export function noModelLine(key: string): string {
  return `Nincs választható modell: ${keyLabel(key)}. A configban a model.switchable alá kell felvenni, sémás recepthez structured jelzéssel.`
}

export function modelPickKeyboard(key: string, models: readonly string[], reset: boolean): Key[][] {
  const rows = models.map((model) => [{ text: model, data: `p:${key}:${model}` }])
  return reset ? [...rows, [{ text: 'visszaállítás', data: `x:${key}` }]] : rows
}

export function modeLine(key: string, model: string): string {
  return `${keyLabel(key)}: ${model}. Egyszer vagy állandóan?`
}

export function modeKeyboard(key: string, model: string): Key[][] {
  return [[
    { text: 'egyszeri', data: `o:o:${key}:${model}` },
    { text: 'állandó', data: `o:a:${key}:${model}` },
  ]]
}

export function modelSetLine(key: string, model: string, mode: 'once' | 'always'): string {
  return mode === 'once'
    ? `${keyLabel(key)}: ${model}, egyszeri. A következő ${keyLabel(key)}-futás ezzel megy.`
    : `${keyLabel(key)}: ${model}, állandó, amíg vissza nem állítod.`
}

export function modelResetLine(key: string): string {
  return `${keyLabel(key)}: visszaállítva, a config szerinti modell fut.`
}
```
- A `HELP_TEXT`-be a `/cancel` sor után: `'/model – a receptek modelljének megtekintése és váltása'`.
- A `probeFailure` `export`-ot kap, a `ModelsReply` hibaágát is ez fordítja szövegre (azonos `reason`).
- A `messages.ts` a `ModelOverride` típust a `./store.js`-ből importálja (`import type`).
- A `plan.ts` re-export listájába bekerül minden új név (`MODEL_KEYS`, `type ModelsReply`, `modelText`, `modelKeyboard`, `fitsTap`, `modelPickLine`, `noModelLine`, `modelPickKeyboard`, `modeLine`, `modeKeyboard`, `modelSetLine`, `modelResetLine`, `probeFailure`), mert a `handle.ts` a `plan.js`-ből importál.

**`handle.ts`:**
- `COMMAND = /^\/(help|cancel|ping|version|status|model)(?:@\w+)?\s*$/`.
- `WorkerDeps` kap egy mezőt: `/** A serve `GET /models`-a: a YAML-alap és a választható modellek. */ models: () => Promise<ModelsReply>`.
- A `handleCommand`-ban a `cancel` ág után:
  ```ts
  if (command === 'model') {
    const view = await deps.models()
    if (!view.ok) await deps.send(chatId, probeFailure(view))
    else await deps.send(chatId, modelText(view, await deps.store.overridesFor(binding.sub)), modelKeyboard())
    return
  }
  ```
- A `handleTap`-ben a `cancel` ág után, a `findRow` **előtt**:
  ```ts
  if (tap.type === 'model' || tap.type === 'modelPick' || tap.type === 'modelSet' || tap.type === 'modelReset') {
    if (from !== undefined) await modelTap(tap, binding.sub, String(from.id), update.callback_query.message?.message_id, deps)
    return []
  }
  ```
- Új függvény:
  ```ts
  /** A `/model` gombjai: ugyanazt az üzenetet szerkesztik, ha a Telegram megadta, különben újat küldenek. */
  async function modelTap(
    tap: Extract<Tap, { type: 'model' | 'modelPick' | 'modelSet' | 'modelReset' }>,
    sub: string,
    chatId: string,
    messageId: number | undefined,
    deps: WorkerDeps,
  ): Promise<void> {
    const show = (text: string, keyboard: Key[][] = []) =>
      typeof messageId === 'number' ? deps.edit(chatId, messageId, text, keyboard) : deps.send(chatId, text, keyboard)
    if (tap.type === 'modelPick') {
      await show(modeLine(tap.key, tap.model), modeKeyboard(tap.key, tap.model))
      return
    }
    if (tap.type === 'modelSet') {
      await deps.store.setOverride({ sub, recipe: tap.key, mode: tap.mode, model: tap.model })
      await show(modelSetLine(tap.key, tap.model, tap.mode))
      return
    }
    if (tap.type === 'modelReset') {
      await deps.store.clearOverride(sub, tap.key)
      await show(modelResetLine(tap.key))
      return
    }
    const view = await deps.models()
    if (!view.ok) {
      await show(probeFailure(view))
      return
    }
    const strict = view.structuredRecipes.includes(tap.key)
    const names = view.models.filter((model) => !strict || model.structured).map((model) => model.name)
    const fitting = names.filter((name) => fitsTap(tap.key, name))
    const reset = (await deps.store.overridesFor(sub)).some((item) => item.recipe === tap.key)
    if (fitting.length === 0) await show(noModelLine(tap.key))
    else await show(modelPickLine(tap.key), modelPickKeyboard(tap.key, fitting, reset))
  }
  ```
  A `Tap` típust a `plan.js`-ből kell importálni (`type Tap`).

**`index.ts`, a `probe` mintájára:**
```ts
models: async () => {
  try {
    const response = await fetch(`${env.SERVE_URL.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${env.REFINERY_SERVE_SECRET}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401) return { ok: false, reason: 'secret' }
    if (!response.ok) return { ok: false, reason: 'down' }
    const body = (await response.json()) as Partial<Extract<ModelsReply, { ok: true }>>
    if (typeof body.draft !== 'string' || !Array.isArray(body.models) || !Array.isArray(body.structuredRecipes)) {
      return { ok: false, reason: 'down' }
    }
    return { ok: true, draft: body.draft, recipes: body.recipes ?? {}, models: body.models, structuredRecipes: body.structuredRecipes }
  } catch {
    return { ok: false, reason: 'down' }
  }
},
```

- [ ] **1. lépés: a bukó tesztek.**
  - `plan.test.ts`:
    - `parseTap`:
      - `m:notes` → `{ type: 'model', key: 'notes' }`;
      - `m:translate` → `{ type: 'model', key: 'translate' }`;
      - `m:ismeretlen` → `null`;
      - `p:notes:a:b` → `model: 'a:b'`;
      - `o:o:notes:x` → `mode: 'once'`, `o:a:notes:x` → `mode: 'always'`;
      - `o:z:notes:x` → `null`, `o:o:notes:` → `null`;
      - `x:qa` → `{ type: 'modelReset', key: 'qa' }`.
    - A határ: az `o:a:clean-moderate:` előtag 19 bájt, ezért a `fitsTap('clean-moderate', 'm'.repeat(45))` igaz (64 bájt), a `'m'.repeat(46)` hamis (65 bájt). Ékezetes névnél a bájthossz számít: a `'é'.repeat(23)` 46 bájt, tehát hamis.
    - `modelText`:
      - felülírás nélkül a `notes: <recipes.notes>` és a `qa: <draft>` sor;
      - egyszeri és állandó együtt: `notes: a (egyszeri) · b (állandó)`, akkor is, ha az `always` sor van elöl a bemenetben;
      - a `translate` felülírás nélkül `fordítás: a config szerint`.
  - `handle.test.ts` (a `deps` hamisítványa kap egy `models` mezőt, alapból egy `ok: true` választ két modellel: `sonnet` structured, `grok` nem; `structuredRecipes: ['notes', 'flashcards', 'bloom']`):
    1. `/model` összekötött felhasználónál: egy üzenet a `modelText` szövegével és a `modelKeyboard`-dal.
    2. Összekötés nélkül: `BIND_FIRST`, és a `models` nincs meghívva (számláló 0).
    3. A serve nem érhető el (`{ ok: false, reason: 'down' }`): `A szerver nem válaszol.`
    4. `m:notes` koppintás `messageId`-vel: egy szerkesztés, csak a `sonnet` gombbal. Az `m:summary` koppintásnál mindkét modell megjelenik.
    5. `p:notes:sonnet` után `o:o:notes:sonnet`: a `store.overridesFor('sub-42')` `[{ recipe: 'notes', mode: 'once', model: 'sonnet' }]`, és az utolsó szerkesztés szövege `modelSetLine('notes', 'sonnet', 'once')`.
    6. `x:notes` mindkét felülírást törli, a szöveg `modelResetLine('notes')`.
    7. Egy `messageId` nélküli koppintás `send`-del válaszol, nem `edit`-tel.
    8. Ha a válaszban nincs `structured` modell, az `m:notes` a `noModelLine('notes')` szöveget adja.
    9. Végponttól végpontig: `o:o:notes:sonnet`, utána `r:notes` egy kész videón → a kopogtatás `models: { notes: 'sonnet' }`, és a Sorba került üzenet `(sonnet)`-re végződik.
- [ ] **2. lépés:** `pnpm vitest run worker` → FAIL.
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. Mutációs próba: az `m:` ágban a `!strict ||` kikerül, és a 4. eset (csak `sonnet`) elbukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(worker): Add /model command to switch recipe models`, `Closes #292`).

### 6. feladat: dokumentáció és példa-config

**Fájlok:**
- `refinery.config.example.yaml`: a `model` alá egy `switchable` példa két modellel (`structured` és `text`), a spec szerinti kétsoros magyarázattal.
- `docs/usage.md`: a Telegram-parancsok közé a `/model`, a három lépés és a két mód. Hogy a `docs/usage.md`-ben hol vannak a Telegram-parancsok, azt a végrehajtáskor `grep -n '/cancel' docs/*.md` adja ki.
- `docs/operations/telegram-worker-topology.md`: a `GET /models` a serve végpontjai közé, ha ott fel vannak sorolva.

- [ ] Szöveg megírása, teljes ellenőrzés zöld, commit (`docs: Document the /model command and model.switchable`).

### 7. feladat: kód-PR, telepítés, éles próba

- [ ] PR a `feat/modellvaltas`-ról, `gh pr checks` zöld, a záró review Opuson, merge.
- [ ] Kiadás a bevált menettel, és `pnpm docker:publish`, mert a serve kódja változott.
- [ ] D1-migráció: `wrangler d1 migrations apply` a Worker telepítése **előtt**. A régi Worker nem olvassa az új oszlopot, ezért az új séma mellett is fut.
- [ ] A peter-mba configjában (homelab `services/refinery/config.peter-mba.yaml`) a `model` alá bekerül a `switchable` lista. A modelleket a felhasználó választja ki, a sémás jelzés a mért tapasztalat szerint megy: Sonnet `structured`, a Gemini-flash és a minimax `text`. A homelab repóban csak ez a blokk változik, a felhasználó nem commitolt módosításai maradnak.
- [ ] A compose-ban a képverzió emelése, majd a konténer újraindítása. Ez a felhasználó lépése.
- [ ] Éles próba (valódi pénzbe kerül: egy summary-futás, kis videón):
  1. `/model` → a kiírás a peter-mba YAML-ját tükrözi.
  2. `summary` → egy nem alapértelmezett modell → `egyszeri`. Egy új videó `summary` gombja után a Sorba került üzenetben ott a modell, a jegyzet frontmatterjében `model: <az a modell>` áll.
  3. A következő videó `summary`-ja már zárójel nélkül megy.
  4. `/model` → `notes`: a listában csak a `switchable` `structured` modelljei vannak, a `summary` listájában a `switchable` összes modellje, és semmi más.
