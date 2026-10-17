# Hosszú generálás — megvalósítási terv

> **Az ügynöknek:** KÖTELEZŐ al-skill: `superpowers:subagent-driven-development` (ajánlott) vagy `superpowers:executing-plans`. A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** egy hosszú recept streamelt hívással végigfusson; 25 percnél újrapróbálkozás nélkül álljon meg, és a Telegram kérdezzen rá (Újra / Eldobás); közben 10 percenként jöjjön életjel a terminálba és a Telegramra. Mindkét idő configból állítható (`model.recipe_timeout_minutes`, `model.heartbeat_minutes`).

**Felépítés:** a 25 perces óra és az életjel órája a `runRecipe`-ben indul (ezen megy át a `run` és a `serve` is). Az óra jele és a legenerált szöveg egy `AsyncLocalStorage`-hatókörben jut el a modellkliensig, így sem a `ModelClient` felülete, sem a `refine`/rubrika nem változik. A serve az életjel- és a leállás-eseményt a `commandRun` új `onEvent` horgán kapja, és a meglévő callback-úton küldi a Workernek. Az Újra gomb a mai receptgombok tap-adatát használja újra.

**Technológia:** TypeScript, `ai@7.0.91` (`streamText`), `@ai-sdk/openai-compatible@3.0.43`, `node:async_hooks`, vitest (fake timers), Cloudflare Worker.

**Spec:** `docs/plans/2026-10-17-hosszu-generalas-spec.md`

**Ág:** `feat/hosszu-generalas` a `main`-ről. Kód csak PR-en át kerül be.

## Globális megkötések

- A receptkorlát: `model.recipe_timeout_minutes`, alapból **25**. Az életjel időköze: `model.heartbeat_minutes`, alapból **10**. Mindkettő elhagyható pozitív szám (tört is lehet); a nulla, a negatív vagy a nem szám config-hiba a mező nevével. Az üzenetek a beállított értéket mondják.
- A 25 perces leállás után nincs újrapróbálkozás (se a `retry.ts`, se az SDK `maxRetries`-e). Az átmeneti hibák (503, 429, kapcsolati hiba) a korláton belül a mai módon újrapróbálódnak.
- A `finishReason`-kapu, a tool-visszaesés és a `supportsStructuredOutputs: true` viselkedése nem változik.
- Új függőség nincs.
- Magyar kommentek és üzenetek, a környező kód sűrűségével.
- Ellenőrzés minden feladat végén: `pnpm typecheck && pnpm lint && pnpm test`, mind zöld.

## Amire a review figyeljen

1. **Az Újra gomb, miközben a futás még dolgozik:** egy többrészes fordításfutásban a leállás után azonnal megjön a kérdés, de a futás még `accepted`. Ha ilyenkor nyomják meg az Újrát, a mai `alreadyLine` („már folyamatban”) jön, és nem indul semmi. A futás vége után a gomb működik. Ez szándékos (`ponytail:` komment a `retryKeyboard`-nál). A 6. feladat tesztje rögzíti.
2. **Leállás az újrapróbálkozás várakozása közben:** ha a 25 perc a `retry.ts` visszalépési várakozása alatt jár le, a következő hívás már megszakított jellel indul. Az nem fizetett hívás, és `RecipeTimeout`-ot dob. A 3. feladat tesztje rögzíti.
3. **A megszakított stream hibája:** a `streamText` a hibát nem dobja, hanem a stream `error` részébe teszi. Ha a kliens nem az eredeti hibát dobja tovább, az `isTransient` és az `isForcedToolChoiceRejection` vakká válik. A 2. feladat tesztjei rögzítik (503 újrapróbálódik, a 400-as visszaesés működik).
4. **Életjel judge alatt:** a judge hívása nem írja felül a vázlat szövegét, ezért az életjel ilyenkor a kész vázlat szószámát mutatja. A 2. feladat tesztje rögzíti.
5. **A sorrend a Workernél:** a `stalled` és a záró `failed` callback sorrendje nem garantált (a `stalled` nincs bevárva). A Worker mindkét sorrendet kezeli, mert a `stalled` nem ír állapotot. Az 5. feladat tesztje rögzíti.

---

### 1. feladat: Hatókör, `RecipeTimeout` és a két config-mező

**Fájlok:**
- Új: `src/model/deadline.ts`
- Módosul: `src/config.ts` (`ModelSchema.model`, `ModelConfig`, `loadModelConfig` visszatérése), `refinery.config.example.yaml` (a `judge_enabled` alá, kikommentezve, mint a spec 6. pontjában), `docs/usage.md` (a `judge_enabled` bekezdése mellé két mondat)
- Teszt: `src/model/deadline.test.ts`, `src/config.test.ts`

**Interfészek:**
- Létrehozza:
  ```ts
  // deadline.ts — az alapértékek egyetlen helye
  export const DEFAULT_RECIPE_TIMEOUT_MINUTES = 25
  export const DEFAULT_HEARTBEAT_MINUTES = 10
  export class RecipeTimeout extends Error // name: 'RecipeTimeoutError'
  //   constructor(recipe: string, minutes: number),
  //   message: `A(z) „${recipe}" recept ${minutes} perc után sem készült el, ezért leállt.`
  // config.ts — ModelConfig két opcionális mezővel (így a meglévő ~8 tesztfixture érintetlen):
  //   recipeTimeoutMinutes?: number; heartbeatMinutes?: number
  // ModelSchema.model: recipe_timeout_minutes / heartbeat_minutes: z.number().positive(<mezőnevet tartalmazó üzenet>).optional()
  export interface CallScope { signal: AbortSignal; text: string }
  export function inScope<T>(scope: CallScope, fn: () => Promise<T>): Promise<T>
  export function currentScope(): CallScope | undefined
  ```
  A `currentScope` egy modulszintű `AsyncLocalStorage<CallScope>` `getStore()`-ja.

- [x] **1. lépés: a bukó teszt**
  - `currentScope()` hatókörön kívül `undefined`; `inScope(s, async () => { await Promise.resolve(); return currentScope() })` → `s` (ugyanaz az objektum).
  - `isTransient(new RecipeTimeout('clean-deep', 40))` → `false`; az üzenet tartalmazza a `„clean-deep"` és a `40 perc` szöveget.
  - `config.test.ts`: a `model.recipe_timeout_minutes: 40`, `heartbeat_minutes: 0.5` → `recipeTimeoutMinutes === 40`, `heartbeatMinutes === 0.5`; hiányukban mindkettő `undefined`; a `recipe_timeout_minutes: 0` és a `heartbeat_minutes: -1` config-hibát ad, az üzenetben a mező nevével.
- [x] **2. lépés:** `pnpm vitest run src/model/deadline.test.ts src/config.test.ts` → FAIL.
- [x] **3. lépés:** megírni a `src/model/deadline.ts`-t és a config-mezőket, a példa-configot és a `docs/usage.md`-t.
- [x] **4. lépés:** a teszt → PASS.
- [x] **5. lépés:** commit `feat(model): Add configurable recipe deadline`.

### 2. feladat: Streamelt modellhívás

**Fájlok:**
- Módosul: `src/model/client.ts` (a `generate`, `generateObject`, `viaTool`)
- Új: `src/model/streaming.mock.ts` (csak teszt- és eval-segéd)
- Módosul: `tsconfig.build.json` (`exclude` += `"src/**/*.mock.ts"`)
- Módosul: `src/model/client.test.ts`, `src/pipeline.test.ts`, `evals/fixture-model.ts` (a mockok átállítása)

**Interfészek:**
- Felhasználja: `currentScope()` (1. feladat).
- Létrehozza:
  ```ts
  // streaming.mock.ts
  export function streamingMock(opts: { doGenerate: MockLanguageModelV4['doGenerate'] }): MockLanguageModelV4
  ```
  A `doGenerate` eredményéből `doStream`-et csinál: `stream-start`, a `text` tartalomból `text-start`/`text-delta`/`text-end`, a `tool-call` tartalomból `tool-call` rész, végül `finish` a `finishReason`-nel és a `usage`-dzsel. Ha a `doGenerate` dob, a `doStream` is dob. A meglévő mockokban így csak a `new MockLanguageModelV4({ doGenerate })` → `streamingMock({ doGenerate })` csere kell.
- A `ModelClient` felülete **nem változik**.

**A stream fogyasztása (ezt a jelek nem határozzák meg, ezért itt a döntés):** egy belső `drain(result, track)` függvény végigmegy a `result.fullStream`-en.
- `error` résznél az **eredeti** `part.error`-t dobja.
- `text-delta` (és a `viaTool`-nál a `tool-input-delta`) résznél, ha `track`, hozzáfűzi a szöveget a `currentScope().text`-hez.
- Ha a ciklus dob, vagy véget ér, és `scope?.signal.aborted`, akkor `scope.signal.reason`-t dob.

A `track` akkor igaz, ha `role !== 'judge'`. A nem judge hívás elején `scope.text = ''`. A hívás `abortSignal: currentScope()?.signal`-lal megy. Utána `await result.finishReason` → `ellenorizdAVeget`, majd `await result.text` / `await result.output` / `await result.toolCalls` / `await result.usage` / `await result.response`.

- [x] **1. lépés: a mockok átállítása, még `generateText` mellett.** A `streamingMock` a `doGenerate`-et is megtartja, ezért a csere után minden teszt zöld marad. Ez a lépés biztosítja, hogy a 4. lépés kódváltása ne a mockok miatt bukjon: `pnpm test` → PASS.
- [x] **2. lépés: a bukó tesztek** a `client.test.ts`-ben, új `describe('streamelt hívás')`:
  - `a hívás streamel`: egy `MockLanguageModelV4`, amelynek csak `doStream`-je van → `generate('draft', 'p')` visszaadja a szöveget és a használatot.
  - `a vázlat szövege a hatókörbe kerül, a judge-é nem`: `inScope(s, …)` alatt egy `draft` hívás után `s.text === 'egy két három'`; egy utána jövő `judge` hívás után is ugyanannyi.
  - `a megszakítás oka jön vissza, egyetlen hívással`: a `doStream` addig nem zár, amíg az `abortSignal` nem jelez; `retrying(client)` alatt `controller.abort(new RecipeTimeout('clean-deep', 25))` → a hívás `RecipeTimeout` példánnyal bukik, a `doStream` hívásszáma 1.
  - `az 503 a streamen át is újrapróbálódik`: a `doStream` első hívása `new APICallError({ statusCode: 503, … })`-t dob, a második szöveget ad → `retrying(client).generate` sikeres, a hívásszám 2.
- [x] **3. lépés:** `pnpm vitest run src/model/client.test.ts` → az új tesztek FAIL.
- [x] **4. lépés:** a `client.ts` három útvonala `streamText`-re vált, a `drain`-nel. A `createModelClient` fetch-alapú tesztjei (`keresElkapo`, `sorosFetch`) SSE-választ kapnak: `content-type: text/event-stream`, `data: {chat.completion.chunk}\n\n` sorok, végül `data: [DONE]\n\n`. A kérés törzsére vonatkozó állítások maradnak, a törzsben ezentúl `stream: true` is van.
- [x] **5. lépés:** `pnpm test` → PASS (a régi `finishReason`-, visszaesés- és sémás tesztek változatlan állításokkal).
- [x] **6. lépés:** commit `feat(model): Stream model calls to avoid header timeout`. A törzsbe: `Refs #258`.

### 3. feladat: 25 perces óra és életjel a `runRecipe`-ben

**Fájlok:**
- Módosul: `src/events.ts`, `src/pipeline.ts` (`runRecipe`, `processItem` recept-`catch`-ága), `src/cli.ts` (`render`)
- Teszt: `src/pipeline.test.ts`

**Interfészek:**
- Felhasználja: `RecipeTimeout`, `DEFAULT_RECIPE_TIMEOUT_MINUTES`, `DEFAULT_HEARTBEAT_MINUTES`, `inScope` (1. feladat); `recipeDeps.modelConfig.recipeTimeoutMinutes` / `heartbeatMinutes`; `countWords` (`src/normalize/dedupe.ts`). A percek: `modelConfig.recipeTimeoutMinutes ?? DEFAULT_RECIPE_TIMEOUT_MINUTES`, ugyanígy az életjelé; ms-ra `* 60_000`.
- Létrehozza:
  ```ts
  // events.ts — új eseménytag és mező
  | { type: 'item:progress'; itemId: string; recipe: string; words: number }
  // az 'item:failed' kap egy opcionális mezőt: timedOut?: true
  export function progressText(e: { recipe: string; words: number }): string
  //   words > 0: `${recipe}: kb. ${words.toLocaleString('hu-HU')} szó kész, még dolgozik`
  //   különben:  `Még dolgozik: ${recipe}`
  ```
- A `runRecipe` a `refine(...)` hívást így öleli körbe: `AbortController`, egy `setTimeout(<korlát ms>)`, ami `controller.abort(new RecipeTimeout(recipe.id, <korlát perc>))`-t hív, és egy `setInterval(<életjel ms>)`, ami `item:progress`-t küld `countWords(scope.text)`-tel. A hívás `inScope({ signal, text: '' }, () => refine(...))`, a `finally` mindkét órát törli.
- A `processItem` recept-`catch`-ága az `item:failed` eseménybe `...(error instanceof RecipeTimeout ? { timedOut: true as const } : {})`-t tesz.
- A `render`: `case 'item:progress': return \`  … ${event.itemId}: ${progressText(event)}\``.

- [x] **1. lépés: a bukó tesztek** a `pipeline.test.ts`-ben, `describe('hosszú recept')`, `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })`. A hamis `ModelClient` `generate`-je egy ígéretet old fel, amikor meghívják (ebből tudja a teszt, hogy a hívás elindult, és csak utána léptet órát). Utána `currentScope()!.signal` megszakításáig vár, és annak `reason`-jével bukik.
  - `a beállított korlátot tartja`: `recipeTimeoutMinutes: 40` mellett 25 perc léptetés után a hívás még fut, 40 percnél leáll, az `error` a `40 perc` szöveget tartalmazza; `heartbeatMinutes: 3` mellett 3 percnél jön az első `item:progress`.
  - `alapból 25 perc után megáll, újrapróbálkozás nélkül`: a mezők nélkül `await vi.advanceTimersByTimeAsync(25 * 60_000)` után a `processItem` eredménye `failed`. A `generate` hívásszáma 1. Az `item:failed` eseményben `timedOut: true`, a `kind` a recept azonosítója, az `error` tartalmazza a `25 perc` szöveget.
  - `10 percenként életjel a szószámmal`: a hamis `generate` a hívás elején `currentScope()!.text = 'egy két három'`. 10 perc léptetés után (alapérték) pontosan egy `item:progress` jön, `{ recipe, words: 3 }`. Újabb 10 perc után kettő.
  - `10 percen belül kész recept: nincs életjel, és nem marad óra`: azonnal válaszoló kliens → nincs `item:progress`, és `vi.getTimerCount() === 0`.
  - `a korlát a visszalépési várakozás alatt jár le`: az első hívás 503-at dob, a `recipeDeps.sleep` valódi `setTimeout` (fake). A 25 perces léptetés után az eredmény `failed`, `timedOut: true`.
  - `render`: `progressText({ recipe: 'clean-deep', words: 9000 })` → `clean-deep: kb. 9 000 szó kész, még dolgozik` (a `hu-HU` elválasztója nem törő szóköz: az elvárt értéket is `toLocaleString('hu-HU')`-val kell előállítani); `words: 0` → `Még dolgozik: clean-deep`.
- [x] **2. lépés:** `pnpm vitest run src/pipeline.test.ts` → FAIL.
- [x] **3. lépés:** megvalósítás a fentiek szerint.
- [x] **4. lépés:** `pnpm test` → PASS.
- [x] **5. lépés:** commit `feat(pipeline): Stop recipes after 25 minutes with heartbeat`.

### 4. feladat: A serve továbbítja az életjelet és a leállást

**Fájlok:**
- Módosul: `src/cli.ts` (`RunRuntime.onEvent`, a `printing` sinkben hívva)
- Módosul: `src/serve/summary.ts` (`runRecipes`), `src/serve/job.ts` (`CallbackBody`, `RecipesOutcome`, `JobEffects.refine`, `runRecipeJob`), `src/serve/command.ts` (a `refine` átadása)
- Teszt: `src/serve/summary.test.ts`, `src/serve/job.test.ts`

**Interfészek:**
- Felhasználja: `item:progress`, `item:failed.timedOut`, `progressText` (3. feladat).
- Létrehozza:
  ```ts
  // cli.ts
  interface RunRuntime { /* … */ onEvent?: (event: RunEvent) => void }
  // job.ts
  export type CallbackBody =
    | { status: 'ready'; title: string; noteUrl?: string }
    | { status: 'failed'; error: string; done?: string[] }
    | { status: 'progress'; text: string }
    | { status: 'stalled'; text: string }
  export type RecipesOutcome = { ok: true; noteUrl: string } | { ok: false; error: string; done?: string[] }
  // JobEffects.refine 5. paramétere: notify?: (body: CallbackBody) => void
  // runRecipes input: notify?: (body: CallbackBody) => void
  ```
- `runRecipes` az `onEvent`-ben:
  - `item:progress` → `notify({ status: 'progress', text: progressText(e) })`;
  - `item:failed` és `timedOut` → `notify({ status: 'stalled', text: \`${e.error} Újra próbáljam?\` })`, és a `kind` bekerül egy `stalled` halmazba.
- A futás végén, a push-ellenőrzés után, de a `code !== 0` ág előtt: ha a `stalled` nem üres, akkor `{ ok: false, error: <az első leállás üzenete>, done: ids.filter(id => !stalled.has(id) && <a jegyzetfájl létezik>) }`.
- `runRecipeJob`: a `notify` = `(body) => void report(effects, job.jobId, body)`; a `failed` kimenet `done`-ját továbbadja a callbackben.

- [x] **1. lépés: a bukó tesztek**
  - `summary.test.ts`: egy `createClient`, amelynek receptje `RecipeTimeout`-tal bukik (a hamis kliens maga dobja, óra nélkül). A `notify` egy `stalled` testet kap, a `text` a `Újra próbáljam?` szöveggel végződik. Az eredmény `{ ok: false, done: [] }`.
  - `summary.test.ts`: két fordítás (`summary-hu`, `notes-hu`), az egyik leáll → `done` = a másik azonosítója.
  - `summary.test.ts`: egy `item:progress` eseményből `progress` test lesz, a `progressText` szövegével.
  - `job.test.ts`: `refine` → `{ ok: false, error, done: ['x'] }` → a callback `{ status: 'failed', error, done: ['x'] }`.
- [x] **2. lépés:** a tesztek → FAIL.
- [x] **3. lépés:** megvalósítás.
- [x] **4. lépés:** `pnpm test` → PASS.
- [x] **5. lépés:** commit `feat(serve): Forward heartbeat and stalled recipes`.

### 5. feladat: A Worker fogadja az új callbackeket

**Fájlok:**
- Módosul: `worker/src/index.ts` (`isCallback`), `worker/src/handle.ts` (`CallbackBody`, `runCallback`, `handleCallback`), `worker/src/plan.ts` (`runReadyMessage` opcionális `kinds`), `worker/src/messages.ts` (`retryKeyboard`)
- Teszt: `worker/src/handle.test.ts`, `worker/src/entry.test.ts` (vagy ahol az `isCallback` tesztelt)

**Interfészek:**
- Létrehozza:
  ```ts
  // plan.ts
  export function runReadyMessage(title, run, linkBase, kinds: readonly string[] = runKinds(run)): string
  // messages.ts
  export function retryKeyboard(run: { jobId: string; recipes: readonly string[]; lang: string | null }): Key[][]
  //   [[{ text: 'Újra', data: lang === null ? `r:${recipes[0]}:${jobId}` : `l:${mask.toString(16)}:${lang}:${jobId}` },
  //     { text: 'Eldobás', data: `d:${jobId}` }]]
  //   mask = a recipes bitjeinek VAGY-a a RECIPES sorrendjében (mint a pickKeyboard)
  ```
- `isCallback`: a `progress` és a `stalled` `text: string`-gel érvényes; a `failed` `done`-ja, ha van, `string[]`.
- `runCallback`:
  - `cancelled` futásnál a `progress`/`stalled` elnyelődik;
  - `progress` → `send(chatId, text)`, állapotírás nélkül;
  - `stalled` → `send(chatId, text, retryKeyboard(run))`, állapotírás nélkül;
  - `failed` és `done !== undefined` → az állapot `failed` + `error` (mint ma), de üzenet csak akkor megy, ha `done.length > 0`: `runReadyMessage(row.title ?? row.videoId, run, linkBase, done)`.
- `handleCallback`: a futás nélküli (felirat-) sorhoz érkező `progress`/`stalled` → `200`, semmi más.

- [x] **1. lépés: a bukó tesztek** (`handle.test.ts`):
  - `progress` → egy üzenet a szöveggel, a futás állapota nem változik;
  - `stalled` → egy üzenet két gombbal; alapreceptnél az Újra adata `r:clean-deep:<jobId>`, fordításnál `l:<hex>:<lang>:<jobId>`, amit a `parseTap` ugyanarra a receptlistára fejt vissza;
  - `failed` + `done: []` → nincs üzenet, a futás `failed`;
  - `failed` + `done: ['summary-hu']` → egy üzenet, benne csak a `summary-hu` linkje;
  - `stalled` a `failed` **után** érkezik → ugyanúgy megy a gombos üzenet, a futás `failed` marad;
  - `cancelled` futás `progress`-e → nincs üzenet;
  - `isCallback`: `{ status: 'progress' }` szöveg nélkül → `400`.
- [x] **2. lépés:** `pnpm vitest run worker` → FAIL.
- [x] **3. lépés:** megvalósítás.
- [x] **4. lépés:** `pnpm test` → PASS.
- [x] **5. lépés:** commit `feat(worker): Relay heartbeat and ask before retrying`.

### 6. feladat: Újra és Eldobás gomb

**Fájlok:**
- Módosul: `worker/src/plan.ts` (`Tap`, `parseTap`), `worker/src/handle.ts` (`handleTap`), `worker/src/messages.ts` (`DROPPED_LINE`)
- Teszt: `worker/src/plan.test.ts`, `worker/src/handle.test.ts`

**Interfészek:**
- `Tap` += `{ type: 'drop'; jobId: string }`; `parseTap('d:<jobId>')` → ez, üres `jobId`-re `null`.
- `DROPPED_LINE = 'Eldobva, nem próbálom újra.'`
- `handleTap`: a sor- és jogosultság-ellenőrzés után `drop` → ha van `messageId`, `edit(row.chatId, messageId, DROPPED_LINE, [])`; futást nem kér.
- Az Újra külön kód nélkül a meglévő `recipe`/`lang` tapon megy: `requestRun` → `decideRun(failed)` → `retry`.

- [ ] **1. lépés: a bukó tesztek**
  - `plan.test.ts`: `parseTap('d:1:abcdefghijk')` → `{ type: 'drop', jobId: '1:abcdefghijk' }`; `parseTap('d:')` → `null`.
  - `handle.test.ts`: az Eldobás → egy `edit` a `DROPPED_LINE`-nal és üres billentyűzettel, `knock` nincs.
  - `handle.test.ts`: egy `failed` alapreceptfutásra az Újra (`r:clean-deep:<jobId>`) → egy kopogtatás ugyanazzal a `runId`-vel, és a futás `queued`.
  - `handle.test.ts`: egy `accepted` futásra az Újra → `alreadyLine`, kopogtatás nincs (a review 1. pontja).
- [ ] **2. lépés:** → FAIL.
- [ ] **3. lépés:** megvalósítás, a `retryKeyboard` fölé `// ponytail: futás közben az Újra „már folyamatban”-t ad; sorba állítás, ha zavaró lesz.`
- [ ] **4. lépés:** `pnpm test` → PASS.
- [ ] **5. lépés:** commit `feat(worker): Add retry and drop buttons for stalled recipes`.

### 7. feladat: Próba — leállítja-e a gateway a bontott streamet? (kézi, valódi költéssel)

Nem kód, nem kerül a repóba. **Indítás előtt a felhasználó jóváhagyása kell** (valódi pénz).

- [ ] **1. lépés:** költségbecslés a felhasználónak. Egy hívás `sub2api--claude-sonnet-5`-tel, ~60 s generálás után bontva, legfeljebb néhány ezer kimenő token. A becslést 2× ráhagyással kell megadni.
- [ ] **2. lépés:** egy eldobható szkript a `$CLAUDE_JOB_DIR/tmp`-ben. A `createModelClient`-tel, `inScope` alatt elindít egy hosszú `generate`-et a peter-mba LiteLLM-jére, és 60 s után `abort`-ol.
- [ ] **3. lépés:** a peter-mba-n (`ssh peter-mba`, `homelab-litellm-db`, `LiteLLM_SpendLogs`) a hívás sora: a `startTime`–`endTime` és a `completion_tokens`. Ha az idő ~60 s, és a token kevés, a gateway leállt; ha percekkel tovább tart, nem. A sub2api naplójában ugyanez a slot-felszabadulás ideje.
- [ ] **4. lépés:** az eredmény a spec 5. pontjába. Ha a gateway nem áll le, a felhasználó jóváhagyásával külön issue.
- [ ] **5. lépés:** commit `docs(plans): Record stream cancel probe result`.

### 8. feladat: PR és éles ellenőrzés

- [ ] **1. lépés:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → mind zöld.
- [ ] **2. lépés:** PR a `feat/hosszu-generalas` ágról, `Closes #258`; `gh pr checks` zöld a merge előtt.
- [ ] **3. lépés:** a merge után a kiadás a bevált menet szerint (verzióemelés, changelog, tag, `pnpm docker:publish`, `pnpm worker:deploy`), mert a konténer és a Worker kódja is változik.
- [ ] **4. lépés:** éles próba a peter-mba-n, a felhasználóval: a `zgWUhE6HjrI` `clean-deep` Telegramról. Elvárt: egy generáló LiteLLM-hívás `success`-szel, 429 nélkül; a ~10. percben életjel; a végén `ready`.
