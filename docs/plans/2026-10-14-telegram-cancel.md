# Telegram-parancsok és a `/cancel` — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Telegram-botból megszakítható a saját, sorban álló vagy futó munka (`/cancel`), és a bot ismeri a `/help`, `/ping`, `/version` és `/status` parancsot.

**Architecture:** A serve új végpontja (`POST /jobs/<id>/cancel`) a futó job `AbortController`-ét állítja le. A signal a `runJob` → `refine` → `runRecipes` → `commandRun` úton jut el az egységhurokig, ahol a meglévő plafon-`break` mintáján áll meg. A Worker új `cancelled` állapotot kap, a `save`/`saveRun` nem írja felül, a parancsokat a `handleUpdate` a `linesForMessage` előtt kezeli. Új visszahívás-típus nincs: a megszakítás költsége a meglévő `failed` hibasorában érkezik.

**Tech Stack:** TypeScript, Vitest, Node (`node:http`), Cloudflare Worker + D1.

**Spec:** `docs/plans/2026-10-14-telegram-cancel-spec.md`

Az implementáció a `feat/telegram-cancel` ágon indul a friss `main`-ről, miután ez a terv (a `docs/telegram-cancel-spec` ágon) bekerült. Issue: #220 (a kód-PR zárja).

## Global Constraints

- Mondatok, szó szerint (`worker/src/messages.ts`):
  - `Melyiket szakítsam meg?`
  - `Nincs megszakítható munka.`
  - `Ez már lefutott vagy meg lett szakítva.`
  - `Most nem érem el a szervert, próbáld újra.`
  - `Megszakítva: <cím>.` (a cím a `flatTitle`-en át; cím hiányában a videóazonosító)
  - `Mind megszakítása` (gombfelirat)
  - `A szerver nem válaszol.`
  - `A szerver él (<ms> ms).`
  - `A szerver verziója: <verzió>.`
  - `Most nem dolgozik.` / `Most ezen dolgozik: <busy>.`
  - `Nyitott videó: <n>, nyitott receptfutás: <m>.`
  - A meglévő `BIND_FIRST`, `SERVE_SECRET_MISMATCH` és `NO_VIDEO_LINE` szövege nem változik.
- A `run:aborted` esemény `reason` mezője megszakításkor pontosan `megszakítva`.
- A gomb adata: `c:<jobId>` egy jobra, `c:*` mindre.
- A Worker → serve hívás időkorlátja 10 000 ms (a `reader.ts` `TIMEOUT_MS`-e).
- Új D1-migráció nincs (a `status` oszlop `TEXT`, `CHECK` nélkül).
- A teszt nem éri el a Telegramot, az R2-t, a Cloudflare-t és a modellt; a CLI-tesztek hamis klienssel futnak.
- Minden feladat végén: `pnpm test` zöld, `pnpm typecheck` és `pnpm exec tsc -p worker/tsconfig.json --noEmit` hibátlan, `pnpm lint` hibátlan.
- Kiadási sorrend (a kód-PR után, nem e terv része): előbb a serve-kép és a peter-mba frissítése, utána a Worker telepítése.

## Review Focus

1. A cron épp kopogtat, amikor a felhasználó megszakít: a `202` nem írhatja vissza `accepted`-re a `cancelled` sort, és a serve leállítást kap. (4. feladat, jobra és futásra is.)
2. Egy megszakított felirat-jobra késve befut a `ready` visszahívás: nem mehet ki a receptgombos "felirat megvan" üzenet. (4. feladat.)
3. Egy kész (`ready`) jobra recept fut, és a felhasználó azt szakítja meg: a futás `cancelled` lesz, a job `ready` marad, a receptgombjai működnek. (5. feladat.)
4. A serve nem érhető el egy futó munka megszakításakor: az állapot `accepted` marad, a bot újrapróbálást kér. (5. feladat.)
5. Ugyanazt a gombot kétszer nyomja meg, vagy a Telegram megismétli a webhookot: nincs dupla hatás és nincs dupla üzenet. (5. feladat.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/cli.ts` | `RunRuntime.signal`; megállás az egységhurok elején |
| `src/serve/summary.ts` | `runRecipes` `signal` bemenete → `commandRun` |
| `src/serve/job.ts` | `runJob(job, effects, signal?)` → `refine(…, signal)` |
| `src/serve/command.ts` | `serveEffects.refine` továbbadja a signalt; `onJob` a signallal hívja a `runJob`-ot |
| `src/serve/http.ts` | `ServeGate.abort`; `POST /jobs/<id>/cancel` |
| `worker/src/store.ts` | `cancelled` állapot, `OPEN` export, `claimJob`, őrzött `save`/`saveRun`, `openFor` |
| `worker/src/d1.ts` | ugyanezek D1-en |
| `worker/src/plan.ts` | `decideRun` (`cancelled` → `retry`), `parseTap` (`c:`), re-exportok |
| `worker/src/messages.ts` | a parancsok és a megszakítás szövegei, `cancelKeyboard`, `Probe` |
| `worker/src/handle.ts` | `settle` őre, visszahívás-őr, `/cancel` és a többi parancs, `cancelTap` |
| `worker/src/reader.ts` | `TIMEOUT_MS` export |
| `worker/src/index.ts` | a `cancel` és a `probe` függőség |
| `README.md`, `docs/operations/telegram-worker-topology.md` | a végpont és a parancsok |

---

### Task 1: A `commandRun` megáll a signalra

**Files:**
- Modify: `src/cli.ts` (a `RunRuntime` interfész ~338–345. sor; az egységhurok eleje ~794. sor)
- Test: `src/cli.test.ts`

**Interfaces:**
- Produces: `RunRuntime.signal?: AbortSignal`. Ha a signal megszakad, a következő egység előtt `run:aborted` (`reason: 'megszakítva'`) esemény, a hurok kilép, a `finish` lefut, a kód 0.

- [x] **Step 1: Írd meg a bukó teszteket**

A `src/cli.test.ts` végére (az utolsó `describe` után) új blokk:

```ts
describe('commandRun — megszakítás signallal', () => {
  it('a már megszakított signal nulla modellhívással megáll, a naplóban megszakítva', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }
    const controller = new AbortController()
    controller.abort()

    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { signal: controller.signal, createClient: () => hamisKliens(hivasok) },
    )

    expect(hivasok.generate).toBe(0)
    const aborted = (await naploEsemenyek(cfg.logsDir)).find((e) => e.type === 'run:aborted')
    expect(aborted).toMatchObject({ reason: 'megszakítva', spentUsd: 0 })
  })

  it('az első egység közben érkező megszakítás után nincs több modellhívás', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }
    const controller = new AbortController()

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { signal: controller.signal, createClient: () => hamisKliens(hivasok, () => controller.abort()) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(1)
  })
})
```

- [x] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm exec vitest run src/cli.test.ts -t "megszakítás signallal"`
Expected: FAIL — az első tesztben `hivasok.generate` 1, a másodikban 2.

- [x] **Step 3: Írd meg a megvalósítást**

`src/cli.ts`, a `RunRuntime` interfészben a `createClient` mező után:

```ts
  /** Kívülről jövő megszakítás (a `serve` cancel végpontja): a következő egység előtt áll meg. */
  signal?: AbortSignal
```

Az egységhurok elején, közvetlenül a `for (const [index, unit] of planned.entries()) {` sor után:

```ts
      // A megszakítás a plafon mintáját követi: a hátralévő egységek el sem indulnak,
      // a már kész jegyzeteket a `finish` commitolja.
      if (runtime.signal?.aborted) {
        printing({
          type: 'run:aborted',
          reason: 'megszakítva',
          spentUsd: model?.guard.spentUsd() ?? 0,
          limitUsd: model?.modelConfig.costLimitUsd ?? 0,
        })
        for (const rest of planned.slice(index)) capped.add(unitKey(rest))
        break
      }
```

- [x] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm exec vitest run src/cli.test.ts`
Expected: PASS (a régi tesztek is).

- [x] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat(run): Stop the run on an abort signal before the next unit"
```

---

### Task 2: A signal eljut a receptfutásig

**Files:**
- Modify: `src/serve/summary.ts` (`runRecipes` bemenete és a `commandRun` hívása)
- Modify: `src/serve/job.ts` (`JobEffects.refine`, `runRecipeJob`, `runJob`)
- Modify: `src/serve/command.ts` (`RecipesRun`, `serveEffects`)
- Test: `src/serve/summary.test.ts`, `src/serve/job.test.ts`, `src/serve/command.test.ts`

**Interfaces:**
- Consumes: `RunRuntime.signal` (1. feladat).
- Produces:
  - `runRecipes({ …, signal?: AbortSignal })`
  - `JobEffects.refine: (videoId: string, recipes: readonly string[], lang?: LanguageTag, signal?: AbortSignal) => Promise<RecipesOutcome>`
  - `runJob(job: ServeJob, effects: JobEffects, signal?: AbortSignal): Promise<void>`

- [x] **Step 1: Írd meg a bukó teszteket**

`src/serve/summary.test.ts`, a `describe('runRecipes', …)` blokk végére:

```ts
  it('két recept közül az első után megszakítva: egy modellhívás, a kész jegyzet commitban, a költségsor a hiba', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const controller = new AbortController()
    const inner = client(calls)
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary', 'qa'],
      signal: controller.signal,
      createClient: () => ({
        ...inner,
        generate(...args: Parameters<typeof inner.generate>) {
          controller.abort()
          return inner.generate(...args)
        },
      }),
      load,
      git: gitWith(),
    })
    expect(calls.generate).toBe(1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/^A futás megállt: megszakítva \(\d+\.\d{4} \$ \/ 5\.0000 \$\)$/)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--name-only', '--pretty=format:'], { cwd: vault, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    expect(names).toHaveLength(2)
    expect(names).toContain('Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md')
  })
```

`src/serve/job.test.ts`, a `describe('runJob', …)` blokk végére:

```ts
  it('a receptjob a signalt a refine-nak adja', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const controller = new AbortController()
    const seen: (AbortSignal | undefined)[] = []
    await runJob(
      { ...job, recipes: ['summary'] },
      {
        ...effectsWith(store, []),
        refine: (_videoId, _recipes, _lang, signal) => {
          seen.push(signal)
          return Promise.resolve({ ok: true, noteUrl: 'a_transcript.md' })
        },
      },
      controller.signal,
    )
    expect(seen).toEqual([controller.signal])
  })
```

`src/serve/command.test.ts`, a `megadott configArg mellett…` teszt után, ugyanabban a `describe`-ban:

```ts
  it('a refine a signalt a receptfuttatásnak adja', async () => {
    const seen: { signal?: AbortSignal }[] = []
    const effects = serveEffects({
      outDir: '/tmp',
      languages: ['hu'],
      store: memoryStore(),
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      runRecipes: (input) => {
        seen.push(input)
        return Promise.resolve({ ok: true, noteUrl: 'x' })
      },
    })
    const controller = new AbortController()
    await effects.refine('abcdefghijk', ['summary'], undefined, controller.signal)
    expect(seen[0]?.signal).toBe(controller.signal)
  })
```

- [x] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm exec vitest run src/serve/summary.test.ts src/serve/job.test.ts src/serve/command.test.ts`
Expected: FAIL — a `runRecipes` két modellhívást tesz, és `ok: true`-t ad; a másik kettőben a signal `undefined`.

- [x] **Step 3: Írd meg a megvalósítást**

`src/serve/summary.ts`, a `runRecipes` bemenetének típusában a `load?` mező után:

```ts
  /** A `serve` cancel végpontjának jele: a futás a következő egység előtt áll meg. */
  signal?: AbortSignal
```

és a `commandRun` hívásában a runtime:

```ts
    { createClient: input.createClient, signal: input.signal },
```

`src/serve/job.ts`, a `JobEffects` interfészben:

```ts
  refine?: (
    videoId: string,
    recipes: readonly string[],
    lang?: LanguageTag,
    signal?: AbortSignal,
  ) => Promise<RecipesOutcome>
```

a `runRecipeJob` fejléce és a `refine` hívása:

```ts
async function runRecipeJob(
  job: ServeJob & { recipes: string[] },
  effects: JobEffects,
  signal?: AbortSignal,
): Promise<void> {
```

```ts
    outcome = await effects.refine(job.videoId, job.recipes, lang, signal)
```

a `runJob` fejléce és első ága:

```ts
/** A `signal` csak a receptjobot állítja meg; a felirat-job lefut, az eredményét a Worker elnyeli. */
export async function runJob(job: ServeJob, effects: JobEffects, signal?: AbortSignal): Promise<void> {
  if (job.recipes !== undefined) {
    await runRecipeJob({ ...job, recipes: job.recipes }, effects, signal)
    return
  }
```

`src/serve/command.ts`, a `RecipesRun` típusban a `lang?` után:

```ts
  signal?: AbortSignal
```

a `serveEffects` visszatérési típusában:

```ts
  refine: (
    videoId: string,
    recipes: readonly string[],
    lang?: LanguageTag,
    signal?: AbortSignal,
  ) => Promise<RecipesOutcome>
```

és a megvalósításban:

```ts
    refine: (videoId, recipes, lang, signal) =>
      refineWith({ videoId, outDir: input.outDir, recipes, lang, signal, load: () => loadCliConfig(input.configArg) }),
```

- [x] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm exec vitest run src/serve`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/serve/summary.ts src/serve/job.ts src/serve/command.ts src/serve/summary.test.ts src/serve/job.test.ts src/serve/command.test.ts
git commit -m "feat(serve): Pass the abort signal down to the recipe run"
```

---

### Task 3: A serve cancel végpontja

**Files:**
- Modify: `src/serve/http.ts`
- Modify: `src/serve/command.ts` (`onJob`)
- Test: `src/serve/http.test.ts`

**Interfaces:**
- Consumes: `runJob(job, effects, signal?)` (2. feladat).
- Produces:
  - `ServeGate.abort?: AbortController`
  - `ServeServerInput.onJob: (job: ServeJob, signal: AbortSignal) => Promise<void>`
  - `POST /jobs/<id>/cancel` (Bearer): `200`, ha a `gate.current === id` és van controller (ismételve is); egyébként `404`; rossz titokra `401`.

- [x] **Step 1: Írd meg a bukó teszteket**

`src/serve/http.test.ts`: az `afterEach`-be a `gate.current = null` mellé:

```ts
  gate.abort = undefined
```

a `post` segédfüggvény után:

```ts
async function cancel(port: number, secret: string, id: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  })
  return response.status
}
```

és a `describe('createServeServer', …)` blokk végére:

```ts
  it('a cancel a futó job signalját megszakítja: rossz titokra 401, más azonosítóra 404, ismételve is 200', async () => {
    let signal: AbortSignal | undefined
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server = createServeServer({
      secret: 'titok',
      gate,
      version: '9.9.9',
      onJob: (_job, jobSignal) => {
        signal = jobSignal
        return held
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const job = { jobId: '5:abcdefghijk:summary', videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', recipes: ['summary'] }
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await cancel(port, 'rossz', job.jobId)).toBe(401)
    expect(await cancel(port, 'titok', '5:abcdefghijk:qa')).toBe(404)
    expect(signal?.aborted).toBe(false)
    expect(await cancel(port, 'titok', job.jobId)).toBe(200)
    expect(signal?.aborted).toBe(true)
    expect(await cancel(port, 'titok', job.jobId)).toBe(200)
    release()
  })

  it('a notes foglalta kapura és üres kapura a cancel 404', async () => {
    server = createServeServer({ secret: 'titok', gate, version: '9.9.9', onJob: () => Promise.resolve() })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    expect(await cancel(port, 'titok', 'notes')).toBe(404)
    const free = claimGate(gate, 'notes')
    expect(await cancel(port, 'titok', 'notes')).toBe(404)
    free?.()
  })
```

- [x] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm exec vitest run src/serve/http.test.ts`
Expected: FAIL — a cancel útvonal ma `404` minden kérésre, a rossz titokra is.

- [x] **Step 3: Írd meg a megvalósítást**

`src/serve/http.ts`:

```ts
export interface ServeGate {
  current: string | null
  /** A futó job megszakítója; a nem-job foglalásnál (`notes`) nincs. */
  abort?: AbortController
}
```

```ts
  onJob: (job: ServeJob, signal: AbortSignal) => Promise<void>
```

a `NOTE_PATH` mellé:

```ts
const CANCEL_PATH = /^\/jobs\/([^/]+)\/cancel$/
```

a `handle` függvényben, közvetlenül az `if (request.method !== 'POST' || path !== '/jobs') {` sor elé:

```ts
  const cancel = CANCEL_PATH.exec(path)
  if (request.method === 'POST' && cancel !== null) {
    if (!authorized(request.headers.authorization, input.secret)) {
      rejectUnauthorized(request, response)
      return
    }
    const id = decoded(cancel[1])
    // Csak a futó jobot lehet megszakítani; a `200` azt jelenti, hogy a jel megérkezett.
    const controller = id !== null && id === input.gate.current ? input.gate.abort : undefined
    controller?.abort()
    const status = controller === undefined ? 404 : 200
    console.log(`[serve] POST /jobs/${id ?? '?'}/cancel -> HTTP ${status}`)
    send(response, status)
    return
  }
```

a friss job indítása:

```ts
  if (status === 202 && fresh) {
    const controller = new AbortController()
    input.gate.abort = controller
    void Promise.resolve()
      .then(() => input.onJob(body, controller.signal))
      .finally(() => {
        input.gate.current = null
        input.gate.abort = undefined
      })
  }
```

`src/serve/command.ts`, az `onJob`:

```ts
    onJob: async (job: ServeJob, signal: AbortSignal) => {
      console.log(`[serve] Munka végrehajtása indult: ${job.jobId} (${job.url})`)
      try {
        await runJob(job, effects, signal)
        console.log(`[serve] Munka ${signal.aborted ? 'megszakítva' : 'kész'}: ${job.jobId}`)
      } catch (err) {
        console.error(`[serve] Munka sikertelen: ${job.jobId}:`, err)
      }
    },
```

- [x] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm exec vitest run src/serve && pnpm typecheck`
Expected: PASS, típushiba nélkül.

- [x] **Step 5: Commit**

```bash
git add src/serve/http.ts src/serve/command.ts src/serve/http.test.ts
git commit -m "feat(serve): Add a cancel endpoint for the running job"
```

---

### Task 4: Worker — `cancelled` állapot, a verseny őre és a késői visszahívás

**Files:**
- Modify: `worker/src/store.ts`, `worker/src/d1.ts`, `worker/src/plan.ts`, `worker/src/handle.ts`, `worker/src/reader.ts`, `worker/src/index.ts`
- Test: `worker/src/handle.test.ts`

**Interfaces:**
- Produces:
  - `JobStatus` = `'queued' | 'waiting' | 'accepted' | 'ready' | 'failed' | 'cancelled'`
  - `export const OPEN: readonly JobStatus[]` (`store.ts`)
  - `JobStore.save(row): Promise<boolean>`, `JobStore.saveRun(run): Promise<boolean>` — `cancelled` sort nem írnak felül, `false`, ha nem hatottak.
  - `JobStore.claimJob(jobId: string, expect: JobStatus, next: JobStatus): Promise<boolean>`
  - `WorkerDeps.cancel: (id: string) => Promise<'ok' | 'unknown' | 'unreachable'>`
  - `export const TIMEOUT_MS = 10_000` (`reader.ts`)

- [x] **Step 1: Írd meg a bukó teszteket**

`worker/src/handle.test.ts`: az importban a `handle.js`-ből a `findRow` is kell:

```ts
import {
  applyKnocks,
  findRow,
  handleCallback,
  handleCron,
  handleLink,
  handleTap,
  handleUpdate,
  type PlannedKnock,
  type WorkerDeps,
} from './handle.js'
```

a `deps` segédfüggvény visszatérési típusába `cancelled: string[]`, a törzsébe:

```ts
  const cancelled: string[] = []
```

a visszaadott objektumba (a `...over` elé):

```ts
    cancelled,
    cancel: (id) => {
      cancelled.push(id)
      return Promise.resolve('ok')
    },
```

és a fájl végére:

```ts
describe('megszakítás: verseny és késői visszahívás', () => {
  it('a kopogtatás közben megszakított sort a 202 nem írja vissza, és a serve leállítást kap', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    const d = deps(store, {
      knock: async (job) => {
        await store.claimJob(job.jobId, 'queued', 'cancelled')
        return 202
      },
    })
    await handleCron(d)
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
    expect(d.cancelled).toEqual([`5:${ID}`])
  })

  it('a kopogtatás közben megszakított futás nem indul el, és a serve leállítást kap', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['summary'], null, { status: 'queued', noteUrl: null, notified: false, acceptedAt: null })
    await store.insertRun(run)
    const d = deps(store, {
      knock: async (job) => {
        await store.claimRun(job.jobId, 'queued', 'cancelled')
        return 202
      },
    })
    await handleCron(d)
    expect((await store.run(run.runId))?.status).toBe('cancelled')
    expect(d.cancelled).toEqual([run.runId])
    expect(d.sent).toEqual([])
  })

  it('megszakított feliratsorra a késői ready és failed visszahívás csendes', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'cancelled' }))
    const d = deps(store)
    expect(await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, d)).toBe(200)
    expect(await handleCallback(`5:${ID}`, { status: 'failed', error: 'Nincs felirat' }, d)).toBe(200)
    expect(d.sent).toEqual([])
    expect(d.keyboards).toEqual([])
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
  })

  it('megszakított futásra a failed a hibasort, a ready a linkeket küldi, az állapot marad', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['summary', 'qa'], null, { status: 'cancelled', noteUrl: null, notified: false })
    await store.insertRun(run)
    const d = deps(store)
    await handleCallback(run.runId, { status: 'failed', error: 'A futás megállt: megszakítva (0.0040 $ / 5.0000 $)' }, d)
    await handleCallback(run.runId, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, d)
    expect(d.sent).toEqual([
      'summary, qa: A futás megállt: megszakítva (0.0040 $ / 5.0000 $)',
      `Cím · summary, qa. A jegyzet megvan.\nhttps://worker.test/notes/${ID}/summary\nhttps://worker.test/notes/${ID}/qa`,
    ])
    expect((await store.run(run.runId))?.status).toBe('cancelled')
  })

  it('a megszakított futást a receptgomb újraindítja', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['summary'], null, { status: 'cancelled', noteUrl: null, notified: false }))
    const d = deps(store)
    const knocks = await handleTap(tap(60, `r:summary:5:${ID}`), d)
    expect(knocks.map((knock) => knock.jobId)).toEqual([runId(`5:${ID}`, ['summary'], null)])
    expect((await store.run(runId(`5:${ID}`, ['summary'], null)))?.status).toBe('queued')
    expect(d.sent).toEqual(['Sorba került: summary'])
  })

  it('a cron a megszakított sort és futást nem kopogtatja', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'cancelled' }))
    await store.insertRun(readyRun(['qa'], null, { status: 'cancelled' }))
    const d = deps(store)
    await handleCron(d)
    expect(d.knocked).toEqual([])
  })
})
```

- [x] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm exec vitest run worker/src/handle.test.ts -t "megszakítás: verseny"`
Expected: FAIL — `store.claimJob is not a function`, a futás `accepted` lesz, a késői `ready` kiküldi a receptgombokat, a `cancelled` futásra a gomb nem indít.

- [x] **Step 3: Írd meg a megvalósítást — store**

`worker/src/store.ts`:

```ts
export type JobStatus = 'queued' | 'waiting' | 'accepted' | 'ready' | 'failed' | 'cancelled'
```

a `JobStore` interfészben:

```ts
  /** `false`, ha nem hatott: a `cancelled` sort semmi nem írja felül. */
  save(row: JobRow): Promise<boolean>
  /** Feltételes állapotváltás, mint a `claimRun`. */
  claimJob(jobId: string, expect: JobStatus, next: JobStatus): Promise<boolean>
```

```ts
  /** `false`, ha nem hatott: a `cancelled` futást semmi nem írja felül. */
  saveRun(run: RunRow): Promise<boolean>
```

az `OPEN` exportált lesz:

```ts
export const OPEN: readonly JobStatus[] = ['queued', 'waiting', 'accepted']
```

a `memoryStore`-ban a `save` helyére:

```ts
    save: (row) => {
      const index = rows.findIndex((item) => item.jobId === row.jobId)
      // A cron 202-je és a megszakítás versenyének őre, mint a D1-ben.
      if (rows[index]?.status === 'cancelled') return Promise.resolve(false)
      if (index === -1) rows.push(row)
      else rows[index] = row
      return Promise.resolve(true)
    },
    claimJob: (jobId, expect, next) => {
      const index = rows.findIndex((item) => item.jobId === jobId)
      const row = rows[index]
      if (row === undefined || row.status !== expect) return Promise.resolve(false)
      // Új objektum, mint a D1-nél: aki a régit tartja, elavult másolatot lát.
      rows[index] = { ...row, status: next }
      return Promise.resolve(true)
    },
```

a `saveRun` és a `claimRun` helyére:

```ts
    saveRun: (run) => {
      const index = runs.findIndex((item) => item.runId === run.runId)
      if (runs[index]?.status === 'cancelled') return Promise.resolve(false)
      if (index === -1) runs.push(run)
      else runs[index] = run
      return Promise.resolve(true)
    },
    claimRun: (runId, expect, next) => {
      const index = runs.findIndex((item) => item.runId === runId)
      const run = runs[index]
      if (run === undefined || run.status !== expect) return Promise.resolve(false)
      runs[index] = { ...run, status: next, error: null, notified: false, acceptedAt: null }
      return Promise.resolve(true)
    },
```

`worker/src/d1.ts`, a `save` vége:

```ts
    async save(row) {
      const result = await db
        .prepare(
          `UPDATE jobs SET
            update_id = ?, chat_id = ?, message_id = ?, video_id = ?, url = ?, status = ?,
            error = ?, title = ?, notified_ready = ?, accepted_at = ?, sub = ?
          WHERE job_id = ? AND status != 'cancelled'`,
        )
        .bind(
          row.updateId,
          row.chatId,
          row.messageId,
          row.videoId,
          row.url,
          row.status,
          row.error,
          row.title,
          row.notifiedReady ? 1 : 0,
          row.acceptedAt,
          row.sub,
          row.jobId,
        )
        .run()
      return changed(result)
    },
    async claimJob(jobId, expect, next) {
      const result = await db
        .prepare('UPDATE jobs SET status = ? WHERE job_id = ? AND status = ?')
        .bind(next, jobId, expect)
        .run()
      return changed(result)
    },
```

```ts
    async saveRun(run) {
      const result = await db
        .prepare(
          "UPDATE runs SET status = ?, error = ?, note_url = ?, notified = ?, accepted_at = ? WHERE run_id = ? AND status != 'cancelled'",
        )
        .bind(run.status, run.error, run.noteUrl, run.notified ? 1 : 0, run.acceptedAt, run.runId)
        .run()
      return changed(result)
    },
```

- [x] **Step 4: Írd meg a megvalósítást — plan, handle, index**

`worker/src/plan.ts`, a `decideRun`-ban:

```ts
  if (run.status === 'failed' || run.status === 'cancelled') return { type: 'retry' }
```

`worker/src/handle.ts`, a `WorkerDeps`-ben a `knock` után:

```ts
  /** A serve futó jobjának leállítása: `ok` 200, `unknown` 404, minden más `unreachable`. */
  cancel: (id: string) => Promise<'ok' | 'unknown' | 'unreachable'>
```

a `settle` doc-kommentjének végére:

```ts
 * Ha a sort vagy a futást a kopogtatás közben megszakították, a 202 nem írja
 * vissza, hanem a serve leállítást kap.
```

a `settle` paramétere és `202`-es ága:

```ts
  save: () => Promise<boolean>,
```

```ts
  if (result === 202) {
    const fresh = target.status !== 'accepted'
    const won = fresh && started !== undefined && (await deps.store.claimRun(started.runId, target.status, 'accepted'))
    if (fresh && started !== undefined && !won) {
      if ((await deps.store.run(started.runId))?.status === 'cancelled') await deps.cancel(started.runId)
      return
    }
    target.status = 'accepted'
    target.acceptedAt = deps.now()
    if (!(await save())) {
      await deps.cancel(started?.runId ?? row.jobId)
      return
    }
    if (won) await deps.send(row.chatId, started.text)
    return
  }
```

a `runCallback` eleje:

```ts
async function runCallback(run: RunRow, body: CallbackBody, deps: WorkerDeps): Promise<void> {
  const row = await findRow(deps.store, run.jobId)
  if (row === null) return
  // A megszakított futás késői eredménye csak üzenet: az állapot marad, a cron nem kopogtatja.
  if (run.status === 'cancelled') {
    await deps.send(
      row.chatId,
      body.status === 'failed'
        ? runFailedLine(run.recipes, run.lang, body.error)
        : runReadyMessage(body.title, run, deps.linkBase),
    )
    return
  }
```

a `handleCallback`-ben a sor keresése után:

```ts
  const row = await findRow(deps.store, id)
  // A megszakított felirat-job késői eredményét elnyeljük.
  if (!row || row.status === 'cancelled') return 200
```

a `requestRun`-ban a `claimed` számítása:

```ts
  const claimed =
    action.type === 'start'
      ? await deps.store.insertRun(fresh)
      : run !== null && (await deps.store.claimRun(id, run.status, 'queued'))
```

`worker/src/reader.ts`:

```ts
export const TIMEOUT_MS = 10_000
```

`worker/src/index.ts`, az importban:

```ts
import { notePage, notesPage, TIMEOUT_MS, type ReaderDeps } from './reader.js'
```

a `deps(env, …)` objektumban a `knock` után:

```ts
    cancel: async (id) => {
      try {
        const response = await fetch(`${env.SERVE_URL.replace(/\/$/, '')}/jobs/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.REFINERY_SERVE_SECRET}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (response.status === 200) return 'ok'
        return response.status === 404 ? 'unknown' : 'unreachable'
      } catch {
        return 'unreachable'
      }
    },
```

- [x] **Step 5: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm exec vitest run worker && pnpm exec tsc -p worker/tsconfig.json --noEmit`
Expected: PASS, típushiba nélkül. Ha egy régi teszt a `memoryStore` objektumainak közös hivatkozására épült, és most bukik, állj meg és jelezd; ne írd át a tesztet a viselkedés ellenőrzése nélkül.

- [x] **Step 6: Commit**

```bash
git add worker/src/store.ts worker/src/d1.ts worker/src/plan.ts worker/src/handle.ts worker/src/reader.ts worker/src/index.ts worker/src/handle.test.ts
git commit -m "feat(worker): Add the cancelled state and guard it against late writes"
```

---

### Task 5: Worker — a `/cancel` parancs és a gombjai

**Files:**
- Modify: `worker/src/store.ts`, `worker/src/d1.ts`, `worker/src/messages.ts`, `worker/src/plan.ts`, `worker/src/handle.ts`
- Test: `worker/src/handle.test.ts`

**Interfaces:**
- Consumes: `OPEN`, `claimJob`, `claimRun`, `WorkerDeps.cancel` (4. feladat).
- Produces:
  - `JobStore.openFor(sub: string): Promise<{ jobs: JobRow[]; runs: RunRow[] }>` — a felhasználó jobjai, amelyek nyitottak vagy van nyitott futásuk; és a nyitott futásaik.
  - `Tap` új ága: `{ type: 'cancel'; jobId: string }` (`'*'` = mind).
  - `cancelKeyboard(jobs)`, `cancelledLine(title)`, `CANCEL_LINE`, `NOTHING_TO_CANCEL`, `CANCEL_CLOSED`, `CANCEL_RETRY` (`messages.ts`, a `plan.ts` re-exportálja).
  - `handleCommand(updateId, command, userId, chatId, deps)` (`handle.ts`, belső).

- [x] **Step 1: Írd meg a bukó teszteket**

`worker/src/handle.test.ts`, a `tap` segédfüggvény után:

```ts
function command(updateId: number, text: string, from = 42) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: from }, from: { id: from }, text } }
}

const ID2 = 'bcdefghijkl'
```

és a fájl végére:

```ts
describe('/cancel', () => {
  it('nyitott munka nélkül ezt mondja, kötés nélkül a kösd össze sort', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(70, '/cancel'), d)
    await handleUpdate(command(71, '/cancel', 99), d)
    expect(d.sent).toEqual(['Nincs megszakítható munka.', 'Előbb kösd össze a Google-fiókoddal: /start'])
  })

  it('csak a saját nyitott munkákat listázza, a kész jobot a nyitott futása miatt, alul a Mind gombbal', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    await store.insert(acceptedRow({ jobId: `6:${ID}`, updateId: 6, sub: 'sub-masik', status: 'queued' }))
    await store.insert(readyRow({ jobId: `7:${ID2}`, updateId: 7, videoId: ID2, title: 'Cím' }))
    await store.insertRun({ ...readyRun(['qa'], null, { status: 'accepted', noteUrl: null, notified: false }), runId: `7:${ID2}:qa`, jobId: `7:${ID2}` })
    await store.insert(readyRow({ jobId: `8:${ID2}`, updateId: 8, videoId: ID2 }))
    const d = deps(store)
    await handleUpdate(command(70, '/cancel@refinery_bot'), d)
    expect(d.sent).toEqual(['Melyiket szakítsam meg?'])
    expect(d.keyboards).toEqual([
      [
        [{ text: ID, data: `c:5:${ID}` }],
        [{ text: 'Cím', data: `c:7:${ID2}` }],
        [{ text: 'Mind megszakítása', data: 'c:*' }],
      ],
    ])
  })

  it('a sorban álló job megszakítása kopogtatás és serve-hívás nélkül cancelled, és a cron sem éleszti', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    const d = deps(store)
    expect(await handleTap(tap(80, `c:5:${ID}`), d)).toEqual([])
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
    expect(d.cancelled).toEqual([])
    expect(d.sent).toEqual([`Megszakítva: ${ID}.`])
    await handleCron(d)
    expect(d.knocked).toEqual([])
  })

  it('a futó job: ok és unknown után cancelled, elérhetetlen serve mellett accepted marad és újrapróbálást kér', async () => {
    for (const [answer, status, line] of [
      ['ok', 'cancelled', `Megszakítva: ${ID}.`],
      ['unknown', 'cancelled', `Megszakítva: ${ID}.`],
      ['unreachable', 'accepted', 'Most nem érem el a szervert, próbáld újra.'],
    ] as const) {
      const store = await boundStore()
      await store.insert(acceptedRow())
      const d = deps(store, { cancel: () => Promise.resolve(answer) })
      await handleTap(tap(81, `c:5:${ID}`), d)
      expect((await findRow(store, `5:${ID}`))?.status).toBe(status)
      expect(d.sent).toEqual([line])
    }
  })

  it('a második koppintás hatástalan, az ismételt update hallgat', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const d = deps(store)
    await handleTap(tap(82, `c:5:${ID}`), d)
    await handleTap(tap(82, `c:5:${ID}`), d)
    await handleTap(tap(83, `c:5:${ID}`), d)
    expect(d.cancelled).toEqual([`5:${ID}`])
    expect(d.sent).toEqual([`Megszakítva: ${ID}.`, 'Ez már lefutott vagy meg lett szakítva.'])
  })

  it('más fiók jobjára a koppintás nem változtat semmit', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ jobId: `6:${ID}`, updateId: 6, sub: 'sub-masik' }))
    const d = deps(store)
    await handleTap(tap(84, `c:6:${ID}`), d)
    expect((await findRow(store, `6:${ID}`))?.status).toBe('accepted')
    expect(d.cancelled).toEqual([])
    expect(d.sent).toEqual(['Ez már lefutott vagy meg lett szakítva.'])
  })

  it('a kész job futó receptjét állítja le: a futás cancelled, a job ready marad', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['summary'], null, { status: 'accepted', noteUrl: null, notified: false })
    await store.insertRun(run)
    const d = deps(store)
    await handleTap(tap(85, `c:5:${ID}`), d)
    expect((await store.run(run.runId))?.status).toBe('cancelled')
    expect((await findRow(store, `5:${ID}`))?.status).toBe('ready')
    expect(d.cancelled).toEqual([run.runId])
    expect(d.sent).toEqual(['Megszakítva: Cím.'])
  })

  it('a Mind gomb minden saját nyitott munkát megszakít', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    await store.insert(acceptedRow({ jobId: `7:${ID2}`, updateId: 7, videoId: ID2 }))
    const d = deps(store)
    await handleTap(tap(86, 'c:*'), d)
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
    expect((await findRow(store, `7:${ID2}`))?.status).toBe('cancelled')
    expect(d.sent).toEqual([`Megszakítva: ${ID}.`, `Megszakítva: ${ID2}.`])
  })
})
```

- [x] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm exec vitest run worker/src/handle.test.ts -t "/cancel"`
Expected: FAIL — a `/cancel` ma `Nincs YouTube-videó az üzenetben.` választ kap, a `c:` gomb `null`.

- [x] **Step 3: Írd meg a megvalósítást — store**

`worker/src/store.ts`, a `JobStore` interfészben:

```ts
  /** A felhasználó jobjai, amelyek nyitottak vagy van nyitott futásuk, és a nyitott futásaik. */
  openFor(sub: string): Promise<{ jobs: JobRow[]; runs: RunRow[] }>
```

a `memoryStore`-ban:

```ts
    openFor: (sub) => {
      const openRuns = runs.filter((run) => OPEN.includes(run.status))
      const jobs = rows.filter(
        (row) => row.sub === sub && (OPEN.includes(row.status) || openRuns.some((run) => run.jobId === row.jobId)),
      )
      return Promise.resolve({ jobs, runs: openRuns.filter((run) => jobs.some((row) => row.jobId === run.jobId)) })
    },
```

`worker/src/d1.ts`:

```ts
    async openFor(sub) {
      const jobs = await db
        .prepare(
          `SELECT * FROM jobs WHERE sub = ? AND (
             status IN ('queued', 'waiting', 'accepted')
             OR job_id IN (SELECT job_id FROM runs WHERE status IN ('queued', 'waiting', 'accepted'))
           ) ORDER BY rowid`,
        )
        .bind(sub)
        .all<JobRecord>()
      const runs = await db
        .prepare(
          `SELECT runs.* FROM runs JOIN jobs ON jobs.job_id = runs.job_id
           WHERE jobs.sub = ? AND runs.status IN ('queued', 'waiting', 'accepted') ORDER BY runs.rowid`,
        )
        .bind(sub)
        .all<RunRecord>()
      return { jobs: jobs.results.map(toRow), runs: runs.results.map(toRun) }
    },
```

- [x] **Step 4: Írd meg a megvalósítást — szövegek és gomb**

`worker/src/messages.ts` végére:

```ts
export const CANCEL_LINE = 'Melyiket szakítsam meg?'
export const NOTHING_TO_CANCEL = 'Nincs megszakítható munka.'
export const CANCEL_CLOSED = 'Ez már lefutott vagy meg lett szakítva.'
export const CANCEL_RETRY = 'Most nem érem el a szervert, próbáld újra.'

export function cancelledLine(title: string): string {
  return `Megszakítva: ${flatTitle(title)}.`
}

/** Jobonként egy gomb, alul a „Mind megszakítása”; a `c:*` a felhasználó minden nyitott munkája. */
export function cancelKeyboard(jobs: readonly { jobId: string; videoId: string; title: string | null }[]): Key[][] {
  return [
    ...jobs.map((job) => [{ text: flatTitle(job.title ?? job.videoId), data: `c:${job.jobId}` }]),
    [{ text: 'Mind megszakítása', data: 'c:*' }],
  ]
}
```

`worker/src/plan.ts`, a `./messages.js` re-export listájába:

```ts
  CANCEL_LINE,
  NOTHING_TO_CANCEL,
  CANCEL_CLOSED,
  CANCEL_RETRY,
  cancelledLine,
  cancelKeyboard,
```

a `Tap` típusba:

```ts
  | { type: 'cancel'; jobId: string }
```

a `parseTap`-ben a `summary` ág után:

```ts
  if (head === 'c') {
    const jobId = rest.join(':')
    return jobId === '' ? null : { type: 'cancel', jobId }
  }
```

- [x] **Step 5: Írd meg a megvalósítást — handle**

`worker/src/handle.ts`, az importokban a `./plan.js` listájába `CANCEL_CLOSED`, `CANCEL_LINE`, `CANCEL_RETRY`, `NOTHING_TO_CANCEL`, `cancelKeyboard`, `cancelledLine`; a `./store.js` importja (a mai `import type` sor helyére):

```ts
import { OPEN, type Binding, type JobRow, type JobStatus, type JobStore, type RunRow } from './store.js'
```

a `START` után:

```ts
const COMMAND = /^\/(cancel)(?:@\w+)?\s*$/
```

az `allowedBinding` után:

```ts
async function handleCommand(
  updateId: number,
  command: string,
  userId: string,
  chatId: string,
  deps: WorkerDeps,
): Promise<void> {
  if (!(await deps.store.rememberUpdate(updateId))) return
  const binding = await allowedBinding(userId, deps)
  if (binding === null) {
    await deps.send(chatId, BIND_FIRST)
    return
  }
  const open = await deps.store.openFor(binding.sub)
  if (open.jobs.length === 0) await deps.send(chatId, NOTHING_TO_CANCEL)
  else await deps.send(chatId, CANCEL_LINE, cancelKeyboard(open.jobs))
}

/**
 * Egy sor vagy futás megszakítása: a futót előbb a serve állítja le, utána a
 * feltételes írás. Ha az írás közben a cron átírta az állapotot, egyszer újra próbál.
 */
async function cancelOne(
  id: string,
  load: () => Promise<{ status: JobStatus } | null>,
  claim: (expect: JobStatus) => Promise<boolean>,
  deps: WorkerDeps,
): Promise<'cancelled' | 'unreachable' | 'closed'> {
  // ponytail: egy újrapróba; a harmadik versenyhez két kopogtatás kellene a koppintás alatt.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const item = await load()
    if (item === null || !OPEN.includes(item.status)) return 'closed'
    if (item.status === 'accepted' && (await deps.cancel(id)) === 'unreachable') return 'unreachable'
    if (await claim(item.status)) return 'cancelled'
  }
  return 'closed'
}

async function cancelTap(target: string, sub: string, chatId: string, deps: WorkerDeps): Promise<void> {
  const open = await deps.store.openFor(sub)
  const jobs = target === '*' ? open.jobs : open.jobs.filter((job) => job.jobId === target)
  if (jobs.length === 0) {
    await deps.send(chatId, CANCEL_CLOSED)
    return
  }
  for (const job of jobs) {
    const outcomes = [
      await cancelOne(
        job.jobId,
        () => findRow(deps.store, job.jobId),
        (expect) => deps.store.claimJob(job.jobId, expect, 'cancelled'),
        deps,
      ),
    ]
    for (const run of open.runs.filter((item) => item.jobId === job.jobId)) {
      outcomes.push(
        await cancelOne(
          run.runId,
          () => deps.store.run(run.runId),
          (expect) => deps.store.claimRun(run.runId, expect, 'cancelled'),
          deps,
        ),
      )
    }
    if (outcomes.includes('unreachable')) await deps.send(chatId, CANCEL_RETRY)
    else if (outcomes.includes('cancelled')) await deps.send(chatId, cancelledLine(job.title ?? job.videoId))
    else await deps.send(chatId, CANCEL_CLOSED)
  }
}
```

a `handleUpdate`-ben a `/start` ága után:

```ts
  const command = COMMAND.exec(message.text ?? '')?.[1]
  if (command !== undefined) {
    await handleCommand(update.update_id, command, userId, chatId, deps)
    return { status: 200, knocks: [] }
  }
```

a `handleTap`-ben, közvetlenül az `if (tap === null) return []` után:

```ts
  // A privát chatben a chat azonosítója a feladóé.
  if (tap.type === 'cancel') {
    if (from !== undefined) await cancelTap(tap.jobId, binding.sub, String(from.id), deps)
    return []
  }
```

- [x] **Step 6: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm exec vitest run worker && pnpm exec tsc -p worker/tsconfig.json --noEmit && pnpm lint`
Expected: PASS, típus- és lint-hiba nélkül.

- [x] **Step 7: Commit**

```bash
git add worker/src/store.ts worker/src/d1.ts worker/src/messages.ts worker/src/plan.ts worker/src/handle.ts worker/src/handle.test.ts
git commit -m "feat(worker): Cancel open jobs from Telegram with /cancel"
```

---

### Task 6: Worker — `/help`, `/ping`, `/version`, `/status`

**Files:**
- Modify: `worker/src/messages.ts`, `worker/src/plan.ts`, `worker/src/handle.ts`, `worker/src/index.ts`
- Test: `worker/src/handle.test.ts`, `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: `handleCommand`, `openFor`, `OPEN` (5. feladat), `TIMEOUT_MS` (4. feladat).
- Produces:
  - `type Probe = { ok: true; ms: number; version: string; busy: string | null } | { ok: false; reason: 'secret' | 'down' }` (`messages.ts`)
  - `WorkerDeps.probe: () => Promise<Probe>` — `GET /status` a titokkal; `401` → `secret`, minden más hiba → `down`.
  - `HELP_TEXT`, `pingLine(probe)`, `versionLine(probe)`, `statusText(probe, jobs, runs)`.

- [x] **Step 1: Írd meg a bukó teszteket**

`worker/src/handle.test.ts`: az importban a `memoryStore` mellé a `Probe` típus a `./plan.js`-ből:

```ts
import { langKeyboard, pickKeyboard, recipeKeyboard, runId, hashToken, type Key, type Probe } from './plan.js'
```

a `deps` segédfüggvény visszaadott objektumába (a `...over` elé):

```ts
    probe: () => Promise.resolve({ ok: true, ms: 7, version: '1.16.0', busy: null }),
```

és a fájl végére:

```ts
describe('tájékoztató parancsok', () => {
  const HELP = [
    'Küldj egy YouTube-linket, és letöltöm a feliratát.',
    '',
    '/start – a bot összekötése a Google-fiókoddal',
    '/cancel – nyitott munka megszakítása',
    '/status – a szerver állapota és a nyitott munkák',
    '/ping – a szerver elérhetősége',
    '/version – a szerver verziója',
    '/help – ez a súgó',
  ].join('\n')

  it('a /help kötés nélkül is megy, a többi parancs kötést kér', async () => {
    const d = deps(memoryStore())
    await handleUpdate(command(90, '/help'), d)
    await handleUpdate(command(91, '/ping'), d)
    expect(d.sent).toEqual([HELP, 'Előbb kösd össze a Google-fiókoddal: /start'])
  })

  it('a /ping, a /version és a /status a serve válaszából', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const d = deps(store, {
      probe: () => Promise.resolve({ ok: true, ms: 7, version: '1.16.0', busy: `5:${ID}` }),
    })
    await handleUpdate(command(92, '/ping'), d)
    await handleUpdate(command(93, '/version'), d)
    await handleUpdate(command(94, '/status'), d)
    expect(d.sent).toEqual([
      'A szerver él (7 ms).',
      'A szerver verziója: 1.16.0.',
      `A szerver verziója: 1.16.0. Most ezen dolgozik: 5:${ID}.\nNyitott videó: 1, nyitott receptfutás: 0.`,
    ])
  })

  it('nem elérhető serve mellett a /status a D1 számait is adja, titokeltérésnél a titok-sor megy', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['qa'], null, { status: 'queued', noteUrl: null, notified: false }))
    const down = (): Promise<Probe> => Promise.resolve({ ok: false, reason: 'down' })
    const secret = (): Promise<Probe> => Promise.resolve({ ok: false, reason: 'secret' })
    const d = deps(store, { probe: down })
    await handleUpdate(command(95, '/status'), d)
    await handleUpdate(command(96, '/ping'), d)
    await handleUpdate(command(97, '/version'), deps(store, { probe: secret, send: d.send }))
    expect(d.sent).toEqual([
      'A szerver nem válaszol.\nNyitott videó: 0, nyitott receptfutás: 1.',
      'A szerver nem válaszol.',
      'A Worker és a serve titka nem egyezik.',
    ])
  })

  it('az ismeretlen parancs a mai választ kapja', async () => {
    const d = deps(await boundStore())
    await handleUpdate(command(98, '/foo'), d)
    expect(d.sent).toEqual(['Nincs YouTube-videó az üzenetben.'])
  })
})
```

`worker/src/entry.test.ts`, a `describe('worker belépés', …)` blokk végére:

```ts
  it('a /ping a serve /status-át hívja a titokkal, és a válaszidőt küldi', async () => {
    const calls: { url: string; body: string; auth: string | null }[] = []
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const raw = init?.body
      calls.push({ url, body: typeof raw === 'string' ? raw : '', auth: new Headers(init?.headers).get('authorization') })
      if (url === 'http://127.0.0.1:8787/status') return Promise.resolve(Response.json({ version: '1.16.0', busy: null }))
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    const env = {
      DB: memoryDb(),
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const request = new Request('https://worker.test/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook' },
      body: JSON.stringify({ update_id: 60, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: '/ping' } }),
    })
    const response = await worker.fetch(request, env, { waitUntil: () => undefined })
    expect(response.status).toBe(200)
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:8787/status', auth: 'Bearer titok' })
    expect((JSON.parse(calls[1]!.body) as { text: string }).text).toMatch(/^A szerver él \(\d+ ms\)\.$/)
  })
```

- [x] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm exec vitest run worker/src/handle.test.ts worker/src/entry.test.ts -t "tájékoztató parancsok|/ping"`
Expected: FAIL — a `/help` és a `/ping` ma `Nincs YouTube-videó az üzenetben.` választ kap.

- [x] **Step 3: Írd meg a megvalósítást — szövegek**

`worker/src/messages.ts` végére:

```ts
export type Probe = { ok: true; ms: number; version: string; busy: string | null } | { ok: false; reason: 'secret' | 'down' }

export const HELP_TEXT = [
  'Küldj egy YouTube-linket, és letöltöm a feliratát.',
  '',
  '/start – a bot összekötése a Google-fiókoddal',
  '/cancel – nyitott munka megszakítása',
  '/status – a szerver állapota és a nyitott munkák',
  '/ping – a szerver elérhetősége',
  '/version – a szerver verziója',
  '/help – ez a súgó',
].join('\n')

export const SERVE_SILENT = 'A szerver nem válaszol.'

function probeFailure(probe: { reason: 'secret' | 'down' }): string {
  return probe.reason === 'secret' ? SERVE_SECRET_MISMATCH : SERVE_SILENT
}

export function pingLine(probe: Probe): string {
  return probe.ok ? `A szerver él (${probe.ms} ms).` : probeFailure(probe)
}

export function versionLine(probe: Probe): string {
  return probe.ok ? `A szerver verziója: ${probe.version}.` : probeFailure(probe)
}

export function statusText(probe: Probe, jobs: number, runs: number): string {
  const busy = probe.ok && probe.busy !== null ? `Most ezen dolgozik: ${probe.busy}.` : 'Most nem dolgozik.'
  const head = probe.ok ? `${versionLine(probe)} ${busy}` : probeFailure(probe)
  return `${head}\nNyitott videó: ${jobs}, nyitott receptfutás: ${runs}.`
}
```

`worker/src/plan.ts`, a re-export listába:

```ts
  type Probe,
  HELP_TEXT,
  pingLine,
  versionLine,
  statusText,
```

- [x] **Step 4: Írd meg a megvalósítást — handle és index**

`worker/src/handle.ts`, az importban a `./plan.js` listájába `HELP_TEXT`, `pingLine`, `statusText`, `versionLine`, `type Probe`. A `WorkerDeps`-ben a `cancel` után:

```ts
  /** A serve `GET /status`-a, mért válaszidővel; ebből dolgozik a `/ping`, a `/version` és a `/status`. */
  probe: () => Promise<Probe>
```

a `COMMAND` minta:

```ts
const COMMAND = /^\/(help|cancel|ping|version|status)(?:@\w+)?\s*$/
```

a `handleCommand` teljes új alakja:

```ts
async function handleCommand(
  updateId: number,
  command: string,
  userId: string,
  chatId: string,
  deps: WorkerDeps,
): Promise<void> {
  if (!(await deps.store.rememberUpdate(updateId))) return
  if (command === 'help') {
    await deps.send(chatId, HELP_TEXT)
    return
  }
  const binding = await allowedBinding(userId, deps)
  if (binding === null) {
    await deps.send(chatId, BIND_FIRST)
    return
  }
  if (command === 'cancel') {
    const open = await deps.store.openFor(binding.sub)
    if (open.jobs.length === 0) await deps.send(chatId, NOTHING_TO_CANCEL)
    else await deps.send(chatId, CANCEL_LINE, cancelKeyboard(open.jobs))
    return
  }
  const probe = await deps.probe()
  if (command === 'ping') {
    await deps.send(chatId, pingLine(probe))
    return
  }
  if (command === 'version') {
    await deps.send(chatId, versionLine(probe))
    return
  }
  const open = await deps.store.openFor(binding.sub)
  const jobs = open.jobs.filter((job) => OPEN.includes(job.status)).length
  await deps.send(chatId, statusText(probe, jobs, open.runs.length))
}
```

`worker/src/index.ts`, a `deps(env, …)` objektumban a `cancel` után:

```ts
    probe: async () => {
      const started = Date.now()
      try {
        const response = await fetch(`${env.SERVE_URL.replace(/\/$/, '')}/status`, {
          headers: { authorization: `Bearer ${env.REFINERY_SERVE_SECRET}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (response.status === 401) return { ok: false, reason: 'secret' }
        if (!response.ok) return { ok: false, reason: 'down' }
        const body = (await response.json()) as { version?: unknown; busy?: unknown }
        if (typeof body.version !== 'string') return { ok: false, reason: 'down' }
        const busy = typeof body.busy === 'string' ? body.busy : null
        return { ok: true, ms: Date.now() - started, version: body.version, busy }
      } catch {
        return { ok: false, reason: 'down' }
      }
    },
```

- [x] **Step 5: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm test && pnpm typecheck && pnpm exec tsc -p worker/tsconfig.json --noEmit && pnpm lint`
Expected: PASS, típus- és lint-hiba nélkül.

- [x] **Step 6: Commit**

```bash
git add worker/src/messages.ts worker/src/plan.ts worker/src/handle.ts worker/src/index.ts worker/src/handle.test.ts worker/src/entry.test.ts
git commit -m "feat(worker): Add the help, ping, version and status commands"
```

---

### Task 7: Dokumentáció

**Files:**
- Modify: `README.md` (a `serve` végpontjai, ~87–90. sor)
- Modify: `docs/operations/telegram-worker-topology.md` (4. szakasz eleje)

- [x] **Step 1: README**

A `README.md`-ben a `GET /status` bekezdése után új bekezdés:

```markdown
A `POST /jobs/<id>/cancel` (ugyanazzal a Bearer-tokennel) a futó munkát
állítja le: `200`, ha a megadott azonosító fut, és a jelzés megérkezett; a
receptfutás a következő egység előtt áll meg, a kész jegyzetek commitolódnak.
Más azonosítóra `404`. A felirat-letöltés nem szakad meg.
```

- [x] **Step 2: Topológia-dokumentum**

A `docs/operations/telegram-worker-topology.md` 4. szakaszában a „A botnak nincsenek hagyományos `/parancsai`;” kezdetű mondat helyére:

```markdown
A bot öt parancsot ismer; minden más üzenetet szóközök mentén szavakra bont, és minden elemet önállóan értékel (`worker/src/plan.ts`):

| Parancs | Mit csinál |
|---|---|
| `/help` | A parancsok listája; kötés nélkül is megy. |
| `/cancel` | Gombos lista a saját nyitott munkákról, alul `Mind megszakítása`. A sorban álló munka azonnal `cancelled`; a futót a Worker a serve `POST /jobs/<id>/cancel` végpontjával állítja le, és csak a `200`/`404` után írja `cancelled`-re. Ha a serve nem érhető el, az állapot marad, és a bot újrapróbálást kér. |
| `/ping` | A serve elérhetősége és válaszideje (`GET /status`). |
| `/version` | A serve verziója. |
| `/status` | A serve verziója, az épp futó munka, és a nyitott videók és receptfutások száma a D1-ből. |

A szöveges üzenetek értelmezése:
```

- [x] **Step 3: Ellenőrzés**

Run: `pnpm test && pnpm lint`
Expected: PASS (a dokumentum nem tesztelt, de a lint a markdownt nem érinti).

- [x] **Step 4: Commit**

```bash
git add README.md docs/operations/telegram-worker-topology.md
git commit -m "docs: Describe the Telegram commands and the cancel endpoint"
```

---

## Kézi próba a kiadás után (nem automatizált)

A serve-kép és a peter-mba frissítése, utána a Worker telepítése után:

1. Telegramban `/ping`: `A szerver él (… ms).`
2. Egy kész videóra kétreceptes futás (a fordítás-gombbal két jegyzetre), majd azonnal `/cancel` és a videó gombja.
3. Elvárt: a bot `Megszakítva: <cím>.` üzenetet küld; a peter-mba naplójában `[serve] POST /jobs/<id>/cancel -> HTTP 200`, majd `[serve] Munka megszakítva: <id>`; a `/status` `Most nem dolgozik.` sort ad; a vaultban legfeljebb az első jegyzet és az átirat van; a bot továbbítja a `… A futás megállt: megszakítva (… $ / … $)` sort.
