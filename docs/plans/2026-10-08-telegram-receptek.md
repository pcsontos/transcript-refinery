# Receptek és fordítás a boton át (4. szelet) — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A felirat után a bot nyolc receptgombot és egy `fordítás` gombot ad. Egy koppintás egy receptet futtat, a fordítás egy vagy több kész jegyzetet visz egy nyelvre, minden kérés egy futás a meglévő `cost_limit_usd` alatt, és minden jegyzet megnyílik az olvasóban.

**Architecture:** A mag `commandRun` egy `recipes` listát kap, ami `items × recipes` egységet gyárt a meglévő közös költségőr alatt. A konténer `runRecipes` hatása ezt hívja, fordításnál a futás idejére beállított `translate`-tel, és az átirat GitHub-címét adja vissza. A Worker új D1-táblája, a `runs`, a receptenkénti állapotot tartja, determinisztikus `run_id`-vel. A gombok kijelölése a `callback_data`-ban él. Az olvasó a kész futásokból dönti el, melyik fajta nyílik meg.

**Tech Stack:** TypeScript, Vitest, Node (konténer), Cloudflare Worker és D1, Telegram Bot API. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-08-telegram-receptek-spec.md`

Az implementáció az `impl-telegram-receptek` ágon indul, a `main` ágról, miután ez a terv bekerült. Szülő-issue: #161, label: `telegram-receptek`.

## Global Constraints

- A receptek, ebben a sorrendben (a maszk bitjei is ezt követik, a 0. bit a `summary`): `summary`, `notes`, `qa`, `flashcards`, `bloom`, `clean-mild`, `clean-moderate`, `clean-deep`.
- A nyelvek, ebben a sorrendben: `en`, `hu`, `nl`, `de`, `es`, `fr`, `it`.
- Gombadatok: `r:<recept>:<jobId>`, `f:<jobId>`, `t:<maszk>:<jobId>`, `n:<maszk>:<jobId>`, `l:<maszk>:<nyelv>:<jobId>`, és a régi `summary:<jobId>`. A maszk kisbetűs hexa, 1–2 jegy. Minden adat legfeljebb 64 bájt.
- A `run_id`: `<jobId>:<recept>`, fordításnál `<jobId>:<nyelv>:<recept>+<recept>` a receptlista sorrendjében.
- Mondatok, szó szerint: `Sorba került: notes` · `Sorba került: summary, notes → de` · `Már sorban van: <videoId>.` · `Melyik jegyzetet fordítsam?` · `Melyik nyelvre?` · `Előbb készíts egy jegyzetet.` · `<cím> · <recept>. A jegyzet megvan.` · `<cím> · <nyelv>. A fordítás megvan.` · `Ismeretlen recept.` · `Ismeretlen nyelv.` A kész üzenet minden további sora egy `<origin>/notes/<jobId>/<fajta>` link.
- A gombsorok: a receptek és a `fordítás` hármasával, a választó gombjai hármasával és alatta a `tovább`, a nyelvek négyesével. A kijelölt választógomb felirata `✓ <recept>`.
- A plafon a meglévő `cost_limit_usd`. Egy kérés egy `commandRun`. Új config-kulcs nincs.
- A konténer csak a `recipes` (nem üres sztringlista) és a `lang` (sztring) mezőt fogadja. A régi `recipe` mezős kopogtatás `400`.
- A recept- és nyelvazonosító ellenőrzése `Object.hasOwn`, nem `in`: a `toString` és a `__proto__` nem recept, nem nyelv.
- A `note_url` a futás `_transcript.md`-jének GitHub-címe. A fajta címe a `_transcript.md` utótag cseréje `_<fajta>.md`-re.
- A teszt nem éri el a GitHubot, a Telegramot és a Cloudflare-t.
- Minden feladat végén: `pnpm test` zöld, `pnpm typecheck` és `pnpm exec tsc -p worker/tsconfig.json` hibátlan, `pnpm lint` hibátlan.

## Review Focus

1. Recept- vagy nyelvazonosító, ami az `Object.prototype` kulcsa (`toString`, `__proto__`): a konténer `in`-nel átengedné, és a `commandRun` kivételt dobna a visszahívás helyett. `Ismeretlen recept.` vagy `Ismeretlen nyelv.` jár, modellhívás nélkül. (2. feladat, `job.test.ts`.)
2. Fordítás a videó saját nyelvére (magyar videó, `hu`): a futás kihagyja, és a Telegramba a kihagyás oka megy (`a forrás már magyar`), nem az általános `A futás megállt.` (2. feladat, `summary.test.ts`.)
3. A csevegés régebbi üzeneteinek `summary:<jobId>` gombja: a `summary` futást indítja, nem némul el. (4. feladat, `handle.test.ts`.)
4. Kapcsoló- vagy `tovább`-koppintás olyan üzeneten, ahol a `callback_query.message` hiányzik (a Telegram régi üzenetnél elhagyja): nincs `editMessageText`, nincs kivétel. Üres maszkkal a `tovább` nem csinál semmit. (4. feladat, `handle.test.ts`.)
5. A migráció előtti summary-jegyzetek: a régi `/notes/<jobId>/summary` link és a `/notes` lista a migráció után is ugyanazt mutatja. A `note_url` `_summary.md` végét a migráció `_transcript.md`-re írja át, és a `jobs`-sor `subtitle` és `ready` lesz, hogy a cron ne kopogtassa felirat-munkaként. (3. feladat, a helyi migráció próbája; 5. feladat, `reader.test.ts`.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/cli.ts` | `commandRun` `recipes` kapcsoló |
| `src/serve/summary.ts` | `runRecipes`: pull, `commandRun`, commit, push, az átirat linkje |
| `src/serve/job.ts`, `http.ts`, `command.ts` | `recipes` és `lang` a kopogtatásban, a `refine` hatás |
| `worker/migrations/0004_runs.sql` | a `runs` tábla és a régi summary-sorok átvitele |
| `worker/src/store.ts`, `d1.ts` | `RunRow`, a `runs` hívásai, a `jobs` sor szűkítése |
| `worker/src/messages.ts` | receptlista, nyelvlista, gombsorok, mondatok |
| `worker/src/plan.ts` | gombadat-elemzés, maszk, `run_id`, fajták, döntés, kész üzenet |
| `worker/src/handle.ts` | koppintás, visszahívás, cron a futásokra |
| `worker/src/index.ts` | `send` gombsorokkal, `edit` |
| `worker/src/reader.ts` | a fajta a kész futásokból |
| `src/recipe/registry.test.ts` | a Worker listái egyeznek a mag listáival |
| `docs/operations/telegram-worker-topology.md`, a brief | a gombok és a fordítás leírása |

---

### Task 1: `commandRun`, több recept egy futásban

**Files:**
- Modify: `src/cli.ts` (`commandRun`: a `flags` típusa, a `recipe` sor után, a modell feltétele, a nem-queue egységek, a riport `kinds` sora)
- Test: `src/cli.test.ts`

**Interfaces:**
- Produces: `commandRun(cfg, raw, { recipes: string[], dryRun, force, commit, command? }, runtime)`. A `recipes` minden eleme a regiszter azonosítója (`recipeFrom`), a fordítás is (`summary-de`), ha a `cfg.translate` kéri. A `recipes` a nem-queue ágban `items × recipes` egységet ad, egy `guard` alatt.

- [x] **Step 1: A bukó tesztek**

A `src/cli.test.ts` végére, új `describe` blokként:

```ts
describe('commandRun — több recept egy futásban', () => {
  it('a recipes lista receptenként egy egységet ad', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }
    await commandRun(
      cfg,
      raw,
      { recipes: ['summary', 'qa'], dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(hivasok.generate).toBe(2)
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const store = openState(cfg.statePath)
    expect(store.artifactOf(item!.itemId, 'summary')?.status).toBe('done')
    expect(store.artifactOf(item!.itemId, 'qa')).not.toBeNull()
    store.close()
  })

  it('a két recept egy közös plafon alatt fut: ami nem fér, el sem indul', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const egy = estimateItemUsd(words, getRecipe('summary').maxIterations, modelConfig)

    // A plafon egy receptre elég, kettőre nem: a qa marad.
    const limited = rawWithVault(egy * 1.5)
    const hivasok = { generate: 0 }
    await commandRun(
      loadConfig(limited, '/p/refinery.config.yaml'),
      limited,
      { recipes: ['summary', 'qa'], dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(hivasok.generate).toBe(1)
    const store = openState(cfg.statePath)
    expect(store.artifactOf(item!.itemId, 'qa')).toBeNull()
    store.close()
  })
})
```

- [x] **Step 2: A bukás ellenőrzése**

Run: `pnpm vitest run src/cli.test.ts -t "több recept"`
Expected: FAIL. A `tsc` a `recipes` mezőt nem ismeri, a futás pedig recept nélkül csak átiratot ír, ezért `hivasok.generate` `0`.

- [x] **Step 3: A megvalósítás**

A `commandRun` `flags` típusában, a `recipe?: string` mező után:

```ts
    /** Queue nélkül több recept egy futásban, egy közös plafon alatt (a `serve` hívja). */
    recipes?: string[]
```

A `const recipe = flags.recipe ? recipeFrom(registry, flags.recipe) : null` sor után:

```ts
  const listed = (flags.recipes ?? []).map((id) => recipeFrom(registry, id))
```

A modell feltétele:

```ts
  if (recipe || queueMode || listed.length > 0) {
```

A nem-queue ág utolsó sora (`units = items.map((item) => ({ item, recipe }))`) helyett:

```ts
      units =
        listed.length > 0
          ? items.flatMap((item) => listed.map((unitRecipe) => ({ item, recipe: unitRecipe })))
          : items.map((item) => ({ item, recipe }))
```

A riport `kinds` sora:

```ts
    const kinds =
      queueMode || listed.length > 0
        ? Object.keys(registry).filter((recipeId) => selected.some((unit) => unitKind(unit) === recipeId))
        : [artifactKind]
```

- [x] **Step 4: A teszt zöld**

Run: `pnpm vitest run src/cli.test.ts`
Expected: PASS, a régi tesztek is.

- [x] **Step 5: Ellenőrzés és commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat(run): Run several recipes under one cost guard"
```

---

### Task 2: A konténer receptlistát és nyelvet fogad

**Files:**
- Modify: `src/serve/summary.ts` (az egész fájl, lent)
- Modify: `src/serve/job.ts` (`ServeJob`, `JobEffects`, `runSummaryRecipe` → `runRecipeJob`, `runJob`)
- Modify: `src/serve/http.ts` (`isJob`)
- Modify: `src/serve/command.ts` (`serveEffects`)
- Test: `src/serve/summary.test.ts`, `src/serve/job.test.ts`, `src/serve/http.test.ts`, `src/serve/command.test.ts`

**Interfaces:**
- Consumes: `commandRun(..., { recipes, ... })` az 1. feladatból.
- Produces:
  - `type RecipesOutcome = { ok: true; noteUrl: string } | { ok: false; error: string }` (a `SummaryOutcome` új neve, `job.ts`).
  - `runRecipes(input: { videoId: string; outDir: string; recipes: readonly string[]; lang?: LanguageTag; createClient?; git?; load? }): Promise<RecipesOutcome>`. A `noteUrl` az átirat GitHub-címe.
  - `ServeJob = { jobId: string; videoId: string; url: string; recipes?: string[]; lang?: string }`.
  - `JobEffects.refine?: (videoId: string, recipes: readonly string[], lang?: LanguageTag) => Promise<RecipesOutcome>` (a `summarize` új neve).
  - `serveEffects({ ..., runRecipes? })`.

- [x] **Step 1: A meglévő tesztek átírása az új nevekre**

`src/serve/summary.test.ts`:
- Az import: `import { runRecipes } from './summary.js'`. A `describe('runSummary', …)` neve `describe('runRecipes', …)`.
- Minden `runSummary({` hívás neve `runRecipes({`, és a `videoId: ID,` sor után új sor kerül: `recipes: ['summary'],`.
- Az első teszt neve `'a jegyzet a vaultba kerül, a commit csak a két fájlt viszi, a link az átiratra mutat'`, és a várt `noteUrl` vége `%5D_summary.md` helyett `%5D_transcript.md`.
- A `'a git@ origin ugyanazt a linket adja'` teszt várt `noteUrl`-jének vége ugyanígy `%5D_transcript.md`.
- A commitolt fájlnevek listái (`_summary.md`, `_transcript.md`) változatlanok.

`src/serve/job.test.ts`:
- Minden `recipe: 'summary'` helyére `recipes: ['summary']` kerül.
- Minden `summarize:` kulcs neve `refine:` (az `emptyEffects`, az `effectsWith` és a tesztek hatásai).
- Az import: `import { runJob, subtitleArgv, type CallbackBody, type JobEffects, type ServeJob } from './job.js'`.
- A `'a más recept failed, fetch nélkül'` teszt helyére:

```ts
  it('az ismeretlen recept és nyelv failed, fetch és modell nélkül', async () => {
    const cases: [ServeJob, string][] = [
      [{ ...job, recipes: ['toString'] }, 'Ismeretlen recept.'],
      [{ ...job, recipes: ['summary', 'nincs'] }, 'Ismeretlen recept.'],
      [{ ...job, recipes: ['summary'], lang: 'pl' }, 'Ismeretlen nyelv.'],
      [{ ...job, recipes: ['summary'], lang: '__proto__' }, 'Ismeretlen nyelv.'],
    ]
    for (const [request, error] of cases) {
      const callbacks: CallbackBody[] = []
      await runJob(request, {
        ...emptyEffects(memoryStore()),
        callback: (_id, body) => {
          callbacks.push(body)
          return Promise.resolve()
        },
      })
      expect(callbacks).toEqual([{ status: 'failed', error }])
    }
  })

  it('a recept-út a recepteket és a nyelvet adja a refine-nak', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const seen: unknown[] = []
    await runJob({ ...job, recipes: ['summary', 'notes'], lang: 'de' }, {
      ...effectsWith(store, []),
      refine: (videoId, recipes, lang) => {
        seen.push({ videoId, recipes, lang })
        return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_transcript.md' })
      },
    })
    expect(seen).toEqual([{ videoId: ID, recipes: ['summary', 'notes'], lang: 'de' }])
  })
```

`src/serve/http.test.ts`: a `'a summary recept 202 és az onJob látja, a szám recept 400'` teszt helyére:

```ts
  it('a receptlista 202 és az onJob látja, a rossz lista, a rossz nyelv és a régi recipe mező 400', async () => {
    const seen: unknown[] = []
    server = createServeServer({
      secret: 'titok',
      gate,
      onJob: (job) => {
        seen.push([job.recipes, job.lang])
        return Promise.resolve()
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const job = {
      jobId: 'job-1',
      videoId: 'abcdefghijk',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      recipes: ['summary', 'notes'],
      lang: 'de',
    }
    expect(await post(port, 'titok', job)).toBe(202)
    expect(seen).toEqual([[['summary', 'notes'], 'de']])
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipes: 'summary' })).toBe(400)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipes: [] })).toBe(400)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipes: [1] })).toBe(400)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', lang: 1 })).toBe(400)
    expect(await post(port, 'titok', { jobId: 'job-2', videoId: job.videoId, url: job.url, recipe: 'summary' })).toBe(400)
  })
```

`src/serve/command.test.ts`: a `'a summary hatás a SERVE_OUT mappát és a videóazonosítót adja tovább'` teszt helyére:

```ts
  it('a recept hatás a SERVE_OUT mappát, a videót, a recepteket és a nyelvet adja tovább', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'refinery-serve-'))
    const seen: unknown[] = []
    const effects = serveEffects({
      outDir,
      languages: ['hu'],
      store: fakeStore,
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      runRecipes: (input) => {
        seen.push(input)
        return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_transcript.md' })
      },
    })
    await effects.writeFile(join(outDir, 'a.vtt'), new Uint8Array([1]))
    await effects.refine('abcdefghijk', ['summary'], 'de')
    expect(seen).toEqual([{ videoId: 'abcdefghijk', outDir, recipes: ['summary'], lang: 'de' }])
    await rm(outDir, { recursive: true })
  })
```

- [x] **Step 2: Az új `runRecipes` tesztek**

A `src/serve/summary.test.ts` `client` függvénye után:

```ts
const GERMAN = '## Zusammenfassung\n\nDas ist ein Satz aus der Notiz, und er ist für die Zusammenfassung nicht schlecht.\n'
const HUNGARIAN =
  '## Összefoglaló\n\nEz a videó arról szól, hogy a figyelem és a türelem hogyan segít a tanulásban, és a tanító azt mondja, hogy nem kell sietni.\n'

/** A summary-hívásra a `summaryText`-et, a német fordítás kérésére a német szöveget adja. */
function writer(calls: { generate: number }, summaryText: string): ReturnType<RunRuntime['createClient'] & object> {
  const base = client(calls)
  return {
    generateObject: base.generateObject,
    generate(_role, prompt) {
      calls.generate += 1
      return Promise.resolve({
        value: prompt.startsWith('Translate the note below into German') ? GERMAN : summaryText,
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    },
  }
}
```

A `describe('runRecipes', …)` végére:

```ts
  it('két recept egy futásban: mindkét jegyzet és az átirat egy commitban', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary', 'qa'],
      createClient: () => client(calls),
      load,
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(result).toEqual({
      ok: true,
      noteUrl:
        'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_transcript.md',
    })
    expect(calls.generate).toBe(2)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: vault, encoding: 'utf8' })
    expect(names.trim().split('\n').sort()).toEqual([
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_qa.md',
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
  })

  it('a fordítás a kért nyelvre a kész forrásból, a config fordítása nélkül', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const git = gitFor('https://github.com/tulaj/repo.git')
    const first = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], createClient: () => writer({ generate: 0 }, HUNGARIAN), load, git })
    expect(first.ok).toBe(true)
    const german = { generate: 0 }
    const result = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], lang: 'de', createClient: () => writer(german, HUNGARIAN), load, git })
    expect(result.ok).toBe(true)
    expect(german.generate).toBe(1)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: vault, encoding: 'utf8' })
    expect(names).toContain('Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary-de.md')
  })

  it('a videó saját nyelvére kért fordítás a kihagyás okát adja', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const git = gitFor('https://github.com/tulaj/repo.git')
    await runRecipes({ videoId: ID, outDir, recipes: ['summary'], createClient: () => writer({ generate: 0 }, HUNGARIAN), load, git })
    const calls = { generate: 0 }
    const result = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], lang: 'hu', createClient: () => writer(calls, HUNGARIAN), load, git })
    expect(result).toEqual({ ok: false, error: 'a forrás már magyar' })
    expect(calls.generate).toBe(0)
  })
```

- [x] **Step 3: A bukás ellenőrzése**

Run: `pnpm vitest run src/serve`
Expected: FAIL. A `runRecipes`, a `refine`, a `recipes` mező és az `Ismeretlen nyelv.` még nem létezik.

- [x] **Step 4: `src/serve/summary.ts`, az egész fájl**

```ts
import { execFile } from 'node:child_process'
import { access, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { commandRun, type RunRuntime } from '../cli.js'
import { loadCliConfig, type Config } from '../config.js'
import type { LanguageTag } from '../lang/identify.js'
import { recipesFor } from '../recipe/registry.js'
import { splitSubtitleName } from '../source/folder.js'
import type { SourceItem } from '../types.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from '../vault/git.js'
import { noteFile } from '../vault/paths.js'
import type { RecipesOutcome } from './job.js'
import { githubNoteUrl } from './note-url.js'

const exec = promisify(execFile)

type SummaryGit = {
  pull(repo: string): Promise<void>
  commit(repo: string, paths: readonly string[], message: string): Promise<boolean>
  push(repo: string): Promise<{ pushed: boolean }>
  remote(repo: string): Promise<string>
  branch(repo: string): Promise<string>
}

const defaultGit: SummaryGit = {
  pull: gitPullFfOnly,
  commit: gitCommitPaths,
  push: gitPush,
  async remote(repo) {
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: repo })
    return stdout.trim()
  },
  async branch(repo) {
    const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })
    return stdout.trim()
  },
}

type RunEvent = { type?: string; reason?: string; spentUsd?: number; limitUsd?: number; error?: string }

function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim() !== '')
  return line?.trim() ?? ''
}

async function runEvents(logsDir: string): Promise<RunEvent[]> {
  let names: string[]
  try {
    names = (await readdir(logsDir)).filter((name) => name.endsWith('.jsonl')).sort()
  } catch {
    return []
  }
  const latest = names.at(-1)
  if (latest === undefined) return []
  const text = await readFile(join(logsDir, latest), 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RunEvent)
}

/** A futás naplójából a Telegramnak szóló mondat: plafon, hiba, kihagyás, ebben a sorrendben. */
function failureLine(events: readonly RunEvent[], fallback: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'run:aborted' && typeof event.reason === 'string') {
      const spent = typeof event.spentUsd === 'number' ? event.spentUsd : 0
      const limit = typeof event.limitUsd === 'number' ? event.limitUsd : 0
      return `A futás megállt: ${event.reason} (${spent.toFixed(4)} $ / ${limit.toFixed(4)} $)`
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'item:failed' && typeof event.error === 'string') {
      const line = firstLine(event.error)
      return line === '' ? fallback : line
    }
  }
  const skipped = events.findLast((event) => event.type === 'item:skipped' && typeof event.reason === 'string')
  return skipped?.reason ?? fallback
}

async function keepThisVideo(outDir: string, videoId: string): Promise<void> {
  const names = await readdir(outDir)
  await Promise.all(
    names
      .filter((name) => !name.includes(videoId))
      .map((name) => rm(join(outDir, name), { recursive: true, force: true })),
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function runRecipes(input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
  createClient?: RunRuntime['createClient']
  git?: SummaryGit
  load?: () => Promise<{ cfg: Config; raw: unknown }>
}): Promise<RecipesOutcome> {
  const git = input.git ?? defaultGit
  let loaded: { cfg: Config; raw: unknown }
  try {
    loaded = input.load ? await input.load() : await loadCliConfig(undefined)
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    return { ok: false, error: message === '' ? 'A futás megállt.' : message }
  }
  try {
    await git.pull(loaded.cfg.vaultPath)
  } catch {
    return { ok: false, error: 'A vault frissítése nem sikerült.' }
  }
  const lang = input.lang
  const cfg: Config = {
    ...loaded.cfg,
    sources: [{ name: basename(input.outDir), path: input.outDir }],
    // A célnyelv a kérésé, nem a configé: a futás idejére a kért forrásokból lesz fordítórecept.
    ...(lang === undefined ? {} : { translate: { to: lang, recipes: [...input.recipes] } }),
  }
  const ids = lang === undefined ? [...input.recipes] : input.recipes.map((id) => `${id}-${lang}`)
  await keepThisVideo(input.outDir, input.videoId)
  const code = await commandRun(
    cfg,
    loaded.raw,
    { recipes: ids, dryRun: false, force: false, commit: false, command: 'serve recipes' },
    { createClient: input.createClient },
  )
  const events = await runEvents(cfg.logsDir)
  const names = await readdir(input.outDir)
  const fileName = names.find((name) => {
    const parsed = splitSubtitleName(name)
    return parsed !== null && parsed.base.includes(input.videoId)
  })
  const parsed = fileName === undefined ? null : splitSubtitleName(fileName)
  let transcriptPath: string | null = null
  const notePaths: string[] = []
  if (fileName !== undefined && parsed !== null) {
    const item: SourceItem = {
      itemId: input.videoId,
      source: basename(input.outDir),
      sourceFile: fileName,
      subtitlePath: join(input.outDir, fileName),
      baseName: parsed.base,
      title: parsed.base,
      language: parsed.language,
      metadata: {},
    }
    const registry = recipesFor(cfg)
    transcriptPath = noteFile(cfg.notesRoot, item, '_transcript.md')
    for (const id of ids) notePaths.push(noteFile(cfg.notesRoot, item, registry[id]!.outputFile))
  }
  const paths: string[] = []
  for (const path of transcriptPath === null ? [] : [transcriptPath, ...notePaths]) {
    if (await exists(path)) paths.push(path)
  }
  if (paths.length > 0) {
    await git.commit(cfg.vaultPath, paths, 'docs(transcript-refinery): átirat 1 videóhoz')
  }
  const pushed = await git.push(cfg.vaultPath)
  if (!pushed.pushed) return { ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' }
  if (code !== 0) return { ok: false, error: failureLine(events, 'A futás megállt.') }
  if (transcriptPath === null) return { ok: false, error: 'A jegyzet nem készült el.' }
  for (const path of notePaths) {
    if (!(await exists(path))) return { ok: false, error: failureLine(events, 'A jegyzet nem készült el.') }
  }
  const vaultRelative = relative(cfg.vaultPath, transcriptPath).split(sep).join('/')
  const noteUrl = githubNoteUrl(await git.remote(cfg.vaultPath), await git.branch(cfg.vaultPath), vaultRelative)
  if (noteUrl === null) return { ok: false, error: 'A vault távoli címe nem GitHub-cím.' }
  return { ok: true, noteUrl }
}
```

- [x] **Step 5: `src/serve/job.ts`**

Importok a fájl elejére:

```ts
import { LANGUAGE_NAMES, type LanguageTag } from '../lang/identify.js'
import { RECIPES } from '../recipe/registry.js'
```

A típusok:

```ts
export interface ServeJob {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
}

export type RecipesOutcome = { ok: true; noteUrl: string } | { ok: false; error: string }
```

A `JobEffects` utolsó mezője:

```ts
  refine?: (videoId: string, recipes: readonly string[], lang?: LanguageTag) => Promise<RecipesOutcome>
```

Az `UNKNOWN_RECIPE` sor után:

```ts
const UNKNOWN_LANGUAGE = 'Ismeretlen nyelv.'
```

A `runSummaryRecipe` függvény neve `runRecipeJob`, a feje és az első ellenőrzése:

```ts
async function runRecipeJob(job: ServeJob & { recipes: string[] }, effects: JobEffects): Promise<void> {
  // Object.hasOwn: az `in` a `toString`-et is receptnek látná.
  if (!job.recipes.every((id) => Object.hasOwn(RECIPES, id))) {
    await report(effects, job.jobId, { status: 'failed', error: UNKNOWN_RECIPE })
    return
  }
  if (job.lang !== undefined && !Object.hasOwn(LANGUAGE_NAMES, job.lang)) {
    await report(effects, job.jobId, { status: 'failed', error: UNKNOWN_LANGUAGE })
    return
  }
  const lang = job.lang as LanguageTag | undefined
```

A függvény többi része marad, két cserével: az `effects.summarize === undefined` feltétel `effects.refine === undefined`, és a hívás:

```ts
  let outcome: RecipesOutcome
  try {
    outcome = await effects.refine(job.videoId, job.recipes, lang)
```

A `runJob` eleje:

```ts
export async function runJob(job: ServeJob, effects: JobEffects): Promise<void> {
  if (job.recipes !== undefined) {
    await runRecipeJob({ ...job, recipes: job.recipes }, effects)
    return
  }
```

- [x] **Step 6: `src/serve/http.ts`, `isJob`**

```ts
function isJob(value: unknown): value is ServeJob {
  if (typeof value !== 'object' || value === null) return false
  const job = value as { jobId?: unknown; videoId?: unknown; url?: unknown; recipe?: unknown; recipes?: unknown; lang?: unknown }
  if (typeof job.jobId !== 'string' || typeof job.videoId !== 'string' || typeof job.url !== 'string') return false
  // A régi, egyreceptes alakot a felirat-munka helyett hibaként kell látni.
  if (job.recipe !== undefined) return false
  if (job.recipes !== undefined) {
    if (!Array.isArray(job.recipes) || job.recipes.length === 0) return false
    if (!job.recipes.every((id) => typeof id === 'string')) return false
  }
  return job.lang === undefined || typeof job.lang === 'string'
}
```

- [x] **Step 7: `src/serve/command.ts`**

Az importok: `type SummaryOutcome` helyett `type RecipesOutcome`, a `runSummary as defaultRunSummary` helyett `runRecipes as defaultRunRecipes`, és új import: `import type { LanguageTag } from '../lang/identify.js'`.

```ts
type RecipesRun = (input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
}) => Promise<RecipesOutcome>
```

A `serveEffects` bemenetében `runSummary?: SummaryRun` helyett `runRecipes?: RecipesRun`. A visszatérési típusban a `summarize` sor helyett:

```ts
  refine: (videoId: string, recipes: readonly string[], lang?: LanguageTag) => Promise<RecipesOutcome>
```

A törzsben:

```ts
  const refineWith = input.runRecipes ?? defaultRunRecipes
```

és a `summarize: …` sor helyett:

```ts
    refine: (videoId, recipes, lang) => refineWith({ videoId, outDir: input.outDir, recipes, lang }),
```

- [x] **Step 8: A teszt zöld**

Run: `pnpm vitest run src/serve`
Expected: PASS. Ha a fordítás tesztje a nyelvkapun bukik (a `GERMAN` szöveget a nyelvfelismerő nem ismeri fel németnek), a `GERMAN` mondatát kell bővíteni német funkciószavakkal. A kód nem változik.

- [x] **Step 9: Ellenőrzés és commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`

```bash
git add src/serve
git commit -m "feat(serve): Accept recipe lists and a target language"
```

---

### Task 3: A futások tára, a gombok és a döntések a Workerben

Ez a feladat csak hozzáad: a mai `summary`-út változatlanul fut tovább, amíg a 4. feladat át nem köti.

**Files:**
- Create: `worker/migrations/0004_runs.sql`
- Modify: `worker/src/store.ts` (`RunRow`, `JobStore`, `memoryStore`)
- Modify: `worker/src/d1.ts` (`RunRecord`, `toRun`, a hat új hívás)
- Modify: `worker/src/messages.ts` (listák, gombsorok, mondatok, a `flatTitle` exportja)
- Modify: `worker/src/plan.ts` (`parseTap`, `maskRecipes`, `runId`, `runKinds`, `decideRun`, `readyBases`, `runReadyMessage`, újraexportok)
- Test: `worker/src/plan.test.ts`, `worker/src/entry.test.ts`, `src/recipe/registry.test.ts`

**Interfaces:**
- Produces (`store.ts`):
  ```ts
  export interface RunRow {
    runId: string; jobId: string; recipes: string[]; lang: string | null
    status: JobStatus; error: string | null; noteUrl: string | null; notified: boolean; acceptedAt: number | null
  }
  // JobStore új hívásai
  run(runId: string): Promise<RunRow | null>
  insertRun(run: RunRow): Promise<boolean>          // false, ha a run_id már van
  saveRun(run: RunRow): Promise<void>
  claimRun(runId: string, expect: JobStatus, next: JobStatus): Promise<boolean>  // error és acceptedAt nullázva
  runsFor(jobId: string): Promise<RunRow[]>          // beszúrási sorrendben
  dueRuns(now: number): Promise<RunRow[]>            // a due szabálya
  ```
- Produces (`messages.ts`): `RECIPES`, `LANGS` (`as const` tömbök), `interface Key { text: string; data: string }`, `recipeKeyboard(jobId): Key[][]`, `pickKeyboard(mask, ready, jobId): Key[][]`, `langKeyboard(mask, jobId): Key[][]`, `PICK_LINE`, `LANG_LINE`, `NOTHING_TO_TRANSLATE`, `runQueuedLine(recipes, lang): string`, `flatTitle(title): string`.
- Produces (`plan.ts`):
  ```ts
  export type Tap =
    | { type: 'recipe'; recipe: string; jobId: string }
    | { type: 'translate'; jobId: string }
    | { type: 'toggle' | 'next'; mask: number; jobId: string }
    | { type: 'lang'; mask: number; lang: string; jobId: string }
  parseTap(data: string): Tap | null
  maskRecipes(mask: number): string[]
  runId(jobId: string, recipes: readonly string[], lang: string | null): string
  runKinds(run: Pick<RunRow, 'recipes' | 'lang'>): string[]
  decideRun(run: RunRow | null): TapAction        // start | retry | busy | resend | ignore
  readyBases(runs: readonly RunRow[]): string[]
  runReadyMessage(title: string, run: Pick<RunRow, 'jobId' | 'recipes' | 'lang'>, linkBase: string): string
  ```

- [ ] **Step 1: A bukó tesztek**

`worker/src/plan.test.ts`: az importok közé `memoryStore, type JobRow, type LinkToken` mellé `type RunRow`, a `plan.js` importjába `decideRun`, `langKeyboard`, `maskRecipes`, `parseTap`, `pickKeyboard`, `readyBases`, `recipeKeyboard`, `runId`, `runKinds`, `runQueuedLine`, `runReadyMessage`. A `row` függvény után:

```ts
function run(partial: Partial<RunRow>): RunRow {
  return {
    runId: `1:${ID}:summary`,
    jobId: `1:${ID}`,
    recipes: ['summary'],
    lang: null,
    status: 'queued',
    error: null,
    noteUrl: null,
    notified: false,
    acceptedAt: null,
    ...partial,
  }
}
```

A fájl végére:

```ts
describe('futások', () => {
  it('a gombadat öt alakja és a régi summary gomb, a rossz recept, maszk és nyelv null', () => {
    expect(parseTap(`r:notes:5:${ID}`)).toEqual({ type: 'recipe', recipe: 'notes', jobId: `5:${ID}` })
    expect(parseTap(`summary:5:${ID}`)).toEqual({ type: 'recipe', recipe: 'summary', jobId: `5:${ID}` })
    expect(parseTap(`f:5:${ID}`)).toEqual({ type: 'translate', jobId: `5:${ID}` })
    expect(parseTap(`t:3:5:${ID}`)).toEqual({ type: 'toggle', mask: 3, jobId: `5:${ID}` })
    expect(parseTap(`n:ff:5:${ID}`)).toEqual({ type: 'next', mask: 255, jobId: `5:${ID}` })
    expect(parseTap(`l:3:de:5:${ID}`)).toEqual({ type: 'lang', mask: 3, lang: 'de', jobId: `5:${ID}` })
    for (const bad of [`r:toString:5:${ID}`, `t:g:5:${ID}`, `t:100:5:${ID}`, `l:3:pl:5:${ID}`, `l:3:__proto__:5:${ID}`, `x:5:${ID}`, '']) {
      expect(parseTap(bad)).toBeNull()
    }
  })

  it('a maszk a receptlista bitjei, az azonosító és a fajták a kérésből', () => {
    expect(maskRecipes(0b101)).toEqual(['summary', 'qa'])
    expect(maskRecipes(0)).toEqual([])
    expect(runId(`5:${ID}`, ['notes'], null)).toBe(`5:${ID}:notes`)
    expect(runId(`5:${ID}`, ['summary', 'notes'], 'de')).toBe(`5:${ID}:de:summary+notes`)
    expect(runKinds({ recipes: ['summary', 'notes'], lang: 'de' })).toEqual(['summary-de', 'notes-de'])
    expect(runKinds({ recipes: ['qa'], lang: null })).toEqual(['qa'])
  })

  it('a futás döntése az állapot szerint', () => {
    expect(decideRun(null)).toEqual({ type: 'start' })
    for (const status of ['queued', 'waiting', 'accepted'] as const) {
      expect(decideRun(run({ status }))).toEqual({ type: 'busy' })
    }
    expect(decideRun(run({ status: 'failed' }))).toEqual({ type: 'retry' })
    expect(decideRun(run({ status: 'ready', notified: true }))).toEqual({ type: 'resend' })
    expect(decideRun(run({ status: 'ready', notified: false }))).toEqual({ type: 'ignore' })
  })

  it('a kész alaprecept a lista sorrendjében, a fordítás és a nem kész nem', () => {
    expect(
      readyBases([
        run({ recipes: ['notes'], status: 'ready' }),
        run({ recipes: ['summary'], status: 'ready' }),
        run({ recipes: ['qa'], status: 'failed' }),
        run({ recipes: ['bloom'], lang: 'de', status: 'ready' }),
      ]),
    ).toEqual(['summary', 'notes'])
  })

  it('a gombsorok: kilenc gomb hármasával, a kapcsoló a saját bitjét fordítja, a nyelvek négyesével, 64 bájt alatt', () => {
    const keys = recipeKeyboard(`5:${ID}`)
    expect(keys.map((line) => line.length)).toEqual([3, 3, 3])
    expect(keys[0]?.[1]).toEqual({ text: 'notes', data: `r:notes:5:${ID}` })
    expect(keys[2]?.[2]).toEqual({ text: 'fordítás', data: `f:5:${ID}` })
    expect(pickKeyboard(1, ['summary', 'notes'], `5:${ID}`)).toEqual([
      [
        { text: '✓ summary', data: `t:0:5:${ID}` },
        { text: 'notes', data: `t:3:5:${ID}` },
      ],
      [{ text: 'tovább', data: `n:1:5:${ID}` }],
    ])
    const langs = langKeyboard(3, `5:${ID}`)
    expect(langs.map((line) => line.length)).toEqual([4, 3])
    expect(langs[0]?.[3]).toEqual({ text: 'de', data: `l:3:de:5:${ID}` })
    const longest = [...recipeKeyboard(`9999999999:${ID}`), ...langKeyboard(255, `9999999999:${ID}`)]
      .flat()
      .map((key) => new TextEncoder().encode(key.data).length)
    expect(Math.max(...longest)).toBeLessThanOrEqual(64)
  })

  it('a futás mondatai', () => {
    expect(runQueuedLine(['notes'], null)).toBe('Sorba került: notes')
    expect(runQueuedLine(['summary', 'notes'], 'de')).toBe('Sorba került: summary, notes → de')
    expect(runReadyMessage('Cím\n', run({ recipes: ['notes'] }), 'https://w.test')).toBe(
      `Cím · notes. A jegyzet megvan.\nhttps://w.test/notes/1:${ID}/notes`,
    )
    expect(runReadyMessage('Cím', run({ recipes: ['summary', 'notes'], lang: 'de' }), 'https://w.test')).toBe(
      `Cím · de. A fordítás megvan.\nhttps://w.test/notes/1:${ID}/summary-de\nhttps://w.test/notes/1:${ID}/notes-de`,
    )
  })

  it('a futás egyszer szúrható be, a claimRun csak a várt állapotból ír, a dueRuns a due szabálya', async () => {
    const store = memoryStore()
    expect(await store.insertRun(run({ status: 'failed', error: 'x', acceptedAt: 5 }))).toBe(true)
    expect(await store.insertRun(run({}))).toBe(false)
    expect(await store.claimRun(`1:${ID}:summary`, 'queued', 'accepted')).toBe(false)
    expect(await store.claimRun(`1:${ID}:summary`, 'failed', 'queued')).toBe(true)
    expect(await store.run(`1:${ID}:summary`)).toMatchObject({ status: 'queued', error: null, acceptedAt: null })
    await store.insertRun(run({ runId: `1:${ID}:qa`, recipes: ['qa'], status: 'accepted', acceptedAt: 1 }))
    await store.insertRun(run({ runId: `1:${ID}:notes`, recipes: ['notes'], status: 'accepted', acceptedAt: 999_999 }))
    await store.insertRun(run({ runId: `2:${ID}:qa`, jobId: `2:${ID}`, recipes: ['qa'], status: 'ready' }))
    expect((await store.dueRuns(1_000_000)).map((item) => item.runId)).toEqual([`1:${ID}:summary`, `1:${ID}:qa`])
    expect((await store.runsFor(`1:${ID}`)).map((item) => item.runId)).toEqual([
      `1:${ID}:summary`,
      `1:${ID}:qa`,
      `1:${ID}:notes`,
    ])
    expect(await store.run('nincs')).toBeNull()
  })
})
```

`worker/src/entry.test.ts`, a `'a wrangler percenként fut, és a D1 kötés neve DB'` teszt végére:

```ts
    const runs = await readFile('worker/migrations/0004_runs.sql', 'utf8')
    expect(runs).toContain('CREATE TABLE runs')
    expect(runs).toContain("WHERE phase = 'summary'")
```

`src/recipe/registry.test.ts`: az importok közé

```ts
import { LANGS, RECIPES as BOT_RECIPES } from '../../worker/src/messages.js'
import { LANGUAGE_NAMES } from '../lang/identify.js'
```

és a fájl végére:

```ts
describe('a bot listái', () => {
  it('a bot receptlistája és nyelvlistája a mag listája', () => {
    expect([...BOT_RECIPES].sort()).toEqual([...RECIPE_IDS].sort())
    expect([...LANGS].sort()).toEqual(Object.keys(LANGUAGE_NAMES).sort())
  })
})
```

(Ha a `RECIPE_IDS` vagy a `describe` még nincs importálva a fájlban, az importsorba kerül: `RECIPE_IDS` a `./registry.js`-ből, `describe` a `vitest`-ből.)

- [ ] **Step 2: A bukás ellenőrzése**

Run: `pnpm vitest run worker src/recipe/registry.test.ts`
Expected: FAIL. Az új függvények, a `runs` hívások és a `0004_runs.sql` még nem léteznek.

- [ ] **Step 3: `worker/migrations/0004_runs.sql`**

```sql
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  recipes TEXT NOT NULL,
  lang TEXT,
  status TEXT NOT NULL,
  error TEXT,
  note_url TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  accepted_at INTEGER
);
CREATE INDEX runs_job ON runs(job_id);
INSERT INTO runs (run_id, job_id, recipes, lang, status, error, note_url, notified, accepted_at)
  SELECT job_id || ':summary', job_id, 'summary', NULL, status, error,
         replace(note_url, '_summary.md', '_transcript.md'), note_notified, accepted_at
  FROM jobs WHERE phase = 'summary';
UPDATE jobs SET status = 'ready', phase = 'subtitle' WHERE phase = 'summary';
```

- [ ] **Step 4: `worker/src/store.ts`**

A `Binding` interfész elé:

```ts
export interface RunRow {
  runId: string
  jobId: string
  recipes: string[]
  lang: string | null
  status: JobStatus
  error: string | null
  noteUrl: string | null
  notified: boolean
  acceptedAt: number | null
}
```

A `JobStore` végére, a `notesFor` után:

```ts
  run(runId: string): Promise<RunRow | null>
  insertRun(run: RunRow): Promise<boolean>
  saveRun(run: RunRow): Promise<void>
  claimRun(runId: string, expect: JobStatus, next: JobStatus): Promise<boolean>
  runsFor(jobId: string): Promise<RunRow[]>
  dueRuns(now: number): Promise<RunRow[]>
```

A `FIFTEEN_MINUTES` sor után:

```ts
function isDue(item: { status: JobStatus; acceptedAt: number | null }, now: number): boolean {
  if (item.status === 'queued' || item.status === 'waiting') return true
  return item.status === 'accepted' && item.acceptedAt !== null && item.acceptedAt < now - FIFTEEN_MINUTES
}
```

A `memoryStore`-ban a `const tokens` sor után `const runs: RunRow[] = []`. A `due` helyett:

```ts
    due: (now) => Promise.resolve(rows.filter((row) => isDue(row, now))),
```

A `notesFor` után:

```ts
    run: (runId) => Promise.resolve(runs.find((item) => item.runId === runId) ?? null),
    insertRun: (run) => {
      if (runs.some((item) => item.runId === run.runId)) return Promise.resolve(false)
      runs.push(run)
      return Promise.resolve(true)
    },
    saveRun: (run) => {
      const index = runs.findIndex((item) => item.runId === run.runId)
      if (index === -1) runs.push(run)
      else runs[index] = run
      return Promise.resolve()
    },
    claimRun: (runId, expect, next) => {
      const run = runs.find((item) => item.runId === runId)
      if (run === undefined || run.status !== expect) return Promise.resolve(false)
      run.status = next
      run.error = null
      run.acceptedAt = null
      return Promise.resolve(true)
    },
    runsFor: (jobId) => Promise.resolve(runs.filter((item) => item.jobId === jobId)),
    dueRuns: (now) => Promise.resolve(runs.filter((item) => isDue(item, now))),
```

- [ ] **Step 5: `worker/src/d1.ts`**

Az import: `import type { Binding, JobRow, JobStatus, JobStore, LinkToken, RunRow } from './store.js'`. A `TokenRecord` után:

```ts
interface RunRecord {
  run_id: string
  job_id: string
  recipes: string
  lang: string | null
  status: JobStatus
  error: string | null
  note_url: string | null
  notified: number
  accepted_at: number | null
}

function toRun(record: RunRecord): RunRow {
  return {
    runId: record.run_id,
    jobId: record.job_id,
    recipes: record.recipes.split(' '),
    lang: record.lang,
    status: record.status,
    error: record.error,
    noteUrl: record.note_url,
    notified: record.notified === 1,
    acceptedAt: record.accepted_at,
  }
}

function changed(result: unknown): boolean {
  const changes = (result as { meta?: { changes?: number } }).meta?.changes
  return changes === undefined || changes === 1
}
```

A `rememberUpdate` ugyanezt a segédet használja:

```ts
    async rememberUpdate(updateId) {
      try {
        return changed(await db.prepare('INSERT INTO seen_updates (update_id) VALUES (?)').bind(updateId).run())
      } catch {
        return false
      }
    },
```

A `createD1Store` visszaadott objektumának végére, a `notesFor` után:

```ts
    async run(runId) {
      const record = await db.prepare('SELECT * FROM runs WHERE run_id = ?').bind(runId).first<RunRecord>()
      return record === null ? null : toRun(record)
    },
    async insertRun(run) {
      const result = await db
        .prepare(
          `INSERT INTO runs (run_id, job_id, recipes, lang, status, error, note_url, notified, accepted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING`,
        )
        .bind(
          run.runId,
          run.jobId,
          run.recipes.join(' '),
          run.lang,
          run.status,
          run.error,
          run.noteUrl,
          run.notified ? 1 : 0,
          run.acceptedAt,
        )
        .run()
      return changed(result)
    },
    async saveRun(run) {
      await db
        .prepare('UPDATE runs SET status = ?, error = ?, note_url = ?, notified = ?, accepted_at = ? WHERE run_id = ?')
        .bind(run.status, run.error, run.noteUrl, run.notified ? 1 : 0, run.acceptedAt, run.runId)
        .run()
    },
    async claimRun(runId, expect, next) {
      const result = await db
        .prepare('UPDATE runs SET status = ?, error = NULL, accepted_at = NULL WHERE run_id = ? AND status = ?')
        .bind(next, runId, expect)
        .run()
      return changed(result)
    },
    async runsFor(jobId) {
      const result = await db.prepare('SELECT * FROM runs WHERE job_id = ? ORDER BY rowid').bind(jobId).all<RunRecord>()
      return result.results.map(toRun)
    },
    async dueRuns(now) {
      const result = await db
        .prepare(
          `SELECT * FROM runs
           WHERE status IN ('queued', 'waiting')
              OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_at < ?)`,
        )
        .bind(now - FIFTEEN_MINUTES)
        .all<RunRecord>()
      return result.results.map(toRun)
    },
```

- [ ] **Step 6: `worker/src/messages.ts`**

A `function flatTitle` elé `export` kerül (`export function flatTitle`). A fájl végére:

```ts
export const RECIPES = [
  'summary',
  'notes',
  'qa',
  'flashcards',
  'bloom',
  'clean-mild',
  'clean-moderate',
  'clean-deep',
] as const
export const LANGS = ['en', 'hu', 'nl', 'de', 'es', 'fr', 'it'] as const

export interface Key {
  text: string
  data: string
}

function inRows(keys: readonly Key[], size: number): Key[][] {
  const rows: Key[][] = []
  for (let index = 0; index < keys.length; index += size) rows.push(keys.slice(index, index + size))
  return rows
}

export function recipeKeyboard(jobId: string): Key[][] {
  const keys = RECIPES.map((recipe) => ({ text: recipe, data: `r:${recipe}:${jobId}` }))
  return inRows([...keys, { text: 'fordítás', data: `f:${jobId}` }], 3)
}

/** A kapcsoló adata a koppintás utáni maszk, ezért a Workernek nem kell emlékeznie a kijelölésre. */
export function pickKeyboard(mask: number, ready: readonly string[], jobId: string): Key[][] {
  const keys = ready.map((recipe) => {
    const bit = 1 << (RECIPES as readonly string[]).indexOf(recipe)
    return {
      text: (mask & bit) !== 0 ? `✓ ${recipe}` : recipe,
      data: `t:${(mask ^ bit).toString(16)}:${jobId}`,
    }
  })
  return [...inRows(keys, 3), [{ text: 'tovább', data: `n:${mask.toString(16)}:${jobId}` }]]
}

export function langKeyboard(mask: number, jobId: string): Key[][] {
  return inRows(
    LANGS.map((lang) => ({ text: lang, data: `l:${mask.toString(16)}:${lang}:${jobId}` })),
    4,
  )
}

export const PICK_LINE = 'Melyik jegyzetet fordítsam?'
export const LANG_LINE = 'Melyik nyelvre?'
export const NOTHING_TO_TRANSLATE = 'Előbb készíts egy jegyzetet.'

export function runQueuedLine(recipes: readonly string[], lang: string | null): string {
  return `Sorba került: ${recipes.join(', ')}${lang === null ? '' : ` → ${lang}`}`
}
```

- [ ] **Step 7: `worker/src/plan.ts`**

Az importok:

```ts
import { classifyInput } from 'transcript-refinery/classify'
import { LANGS, NO_VIDEO_LINE, NOT_YOUTUBE_LINE, PLAYLIST_LINE, RECIPES, alreadyLine, flatTitle, queuedLine } from './messages.js'
import type { JobRow, LinkToken, RunRow } from './store.js'
```

Az újraexport-lista végére (`notAllowedLine,` után):

```ts
  RECIPES,
  LANGS,
  type Key,
  recipeKeyboard,
  pickKeyboard,
  langKeyboard,
  PICK_LINE,
  LANG_LINE,
  NOTHING_TO_TRANSLATE,
  runQueuedLine,
```

A `decideTap` függvény után:

```ts
export function decideRun(run: RunRow | null): TapAction {
  if (run === null) return { type: 'start' }
  if (OPEN.has(run.status)) return { type: 'busy' }
  if (run.status === 'failed') return { type: 'retry' }
  if (run.status === 'ready' && run.notified) return { type: 'resend' }
  return { type: 'ignore' }
}

export type Tap =
  | { type: 'recipe'; recipe: string; jobId: string }
  | { type: 'translate'; jobId: string }
  | { type: 'toggle' | 'next'; mask: number; jobId: string }
  | { type: 'lang'; mask: number; lang: string; jobId: string }

const MASK = /^[0-9a-f]{1,2}$/

function maskOf(hex: string | undefined): number | null {
  return hex !== undefined && MASK.test(hex) ? parseInt(hex, 16) : null
}

/** A gomb adata. A `jobId` maga is `:`-ot tartalmaz, ezért a maradék egyben a `jobId`. */
export function parseTap(data: string): Tap | null {
  const [head, ...rest] = data.split(':')
  if (head === 'summary') return { type: 'recipe', recipe: 'summary', jobId: rest.join(':') }
  if (head === 'f') return { type: 'translate', jobId: rest.join(':') }
  if (head === 'r') {
    const [recipe, ...job] = rest
    if (recipe === undefined || !(RECIPES as readonly string[]).includes(recipe)) return null
    return { type: 'recipe', recipe, jobId: job.join(':') }
  }
  if (head === 't' || head === 'n') {
    const [hex, ...job] = rest
    const mask = maskOf(hex)
    if (mask === null) return null
    return { type: head === 't' ? 'toggle' : 'next', mask, jobId: job.join(':') }
  }
  if (head === 'l') {
    const [hex, lang, ...job] = rest
    const mask = maskOf(hex)
    if (mask === null || lang === undefined || !(LANGS as readonly string[]).includes(lang)) return null
    return { type: 'lang', mask, lang, jobId: job.join(':') }
  }
  return null
}

export function maskRecipes(mask: number): string[] {
  return RECIPES.filter((_, index) => (mask & (1 << index)) !== 0)
}

export function runId(jobId: string, recipes: readonly string[], lang: string | null): string {
  return lang === null ? `${jobId}:${recipes.join('+')}` : `${jobId}:${lang}:${recipes.join('+')}`
}

/** A futás jegyzetfajtái: a fordítás `<recept>-<nyelv>`, ahogy a vault fájlneve. */
export function runKinds(run: Pick<RunRow, 'recipes' | 'lang'>): string[] {
  const lang = run.lang
  return lang === null ? [...run.recipes] : run.recipes.map((recipe) => `${recipe}-${lang}`)
}

export function readyBases(runs: readonly RunRow[]): string[] {
  return RECIPES.filter((recipe) =>
    runs.some((run) => run.status === 'ready' && run.lang === null && run.recipes.includes(recipe)),
  )
}

export function runReadyMessage(
  title: string,
  run: Pick<RunRow, 'jobId' | 'recipes' | 'lang'>,
  linkBase: string,
): string {
  const head =
    run.lang === null
      ? `${flatTitle(title)} · ${run.recipes.join(', ')}. A jegyzet megvan.`
      : `${flatTitle(title)} · ${run.lang}. A fordítás megvan.`
  return [head, ...runKinds(run).map((kind) => `${linkBase}/notes/${run.jobId}/${kind}`)].join('\n')
}
```

- [ ] **Step 8: A teszt zöld**

Run: `pnpm vitest run worker src/recipe/registry.test.ts`
Expected: PASS, a régi tesztek is.

- [ ] **Step 9: A migráció próbája a helyi D1-en**

Run: `pnpm worker:migrate:local`, utána `npx wrangler d1 execute transcript-refinery --local --config worker/wrangler.toml --command "SELECT run_id, recipes, status, note_url FROM runs; SELECT job_id, phase, status FROM jobs WHERE job_id IN (SELECT job_id FROM runs)"`
Expected: a `0004_runs.sql` hiba nélkül lefut. Ha a helyi D1-ben volt summary-sor, a `runs`-ban a `<jobId>:summary` sora áll `_transcript.md`-re végződő `note_url`-lel, a `jobs`-sora pedig `subtitle` és `ready`. Üres helyi D1-nél a két lekérdezés üres.

- [ ] **Step 10: Ellenőrzés és commit**

Run: `pnpm test && pnpm typecheck && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`

```bash
git add worker/migrations/0004_runs.sql worker/src/store.ts worker/src/d1.ts worker/src/messages.ts worker/src/plan.ts worker/src/plan.test.ts worker/src/entry.test.ts src/recipe/registry.test.ts
git commit -m "feat(worker): Add the runs table and recipe buttons"
```

---

### Task 4: A bot a futásokra köt

**Files:**
- Modify: `worker/src/handle.ts` (az egész fájl, lent)
- Modify: `worker/src/index.ts` (`send`, `edit`, `isTap`)
- Modify: `worker/src/store.ts`, `worker/src/d1.ts` (a régi `claim` törlése)
- Modify: `worker/src/messages.ts`, `worker/src/plan.ts` (a `summaryButton`, a `noteReadyMessage` és a `decideTap` törlése)
- Test: `worker/src/handle.test.ts`, `worker/src/plan.test.ts`, `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: a 3. feladat összes `Produces` eleme.
- Produces:
  - `PlannedKnock = { jobId: string; videoId: string; url: string; recipes?: string[]; lang?: string }`. Futásnál a `jobId` a `run_id`.
  - `WorkerDeps.send: (chatId: string, text: string, keyboard?: Key[][]) => Promise<boolean>`.
  - `WorkerDeps.edit: (chatId: string, messageId: number, text: string, keyboard: Key[][]) => Promise<boolean>`.
  - `handleTap(update: { update_id: number; callback_query: { id: string; data?: string; from?: { id: number }; message?: { message_id?: number; chat: { id: number } } } }, deps)`.
  - `handleCallback(id, body, deps)`: az `id` futás vagy felirat-sor.

- [ ] **Step 1: A teszt-segédek és a bukó tesztek, `worker/src/handle.test.ts`**

Az importok:

```ts
import { langKeyboard, pickKeyboard, recipeKeyboard, runId, hashToken, type Key } from './plan.js'
import { memoryStore, type JobRow, type RunRow } from './store.js'
```

A `deps` függvényben a `buttons` mező és tömb helyett `keyboards: Key[][][]` és `edits: { chatId: string; messageId: number; text: string; keyboard: Key[][] }[]` (a visszatérési típusban és az objektumban is), a `send` és az új `edit`:

```ts
    send: (chatId, text, keyboard) => {
      chats.push(chatId)
      sent.push(text)
      if (keyboard) keyboards.push(keyboard)
      return Promise.resolve(true)
    },
    edit: (chatId, messageId, text, keyboard) => {
      edits.push({ chatId, messageId, text, keyboard })
      return Promise.resolve(true)
    },
```

Az `acceptedRow` után:

```ts
const VIDEO_URL = `https://www.youtube.com/watch?v=${ID}`
const TRANSCRIPT_URL = 'https://github.com/tulaj/repo/blob/main/a_transcript.md'

function readyRow(partial: Partial<JobRow> = {}): JobRow {
  return acceptedRow({ status: 'ready', notifiedReady: true, title: 'Cím', ...partial })
}

function readyRun(recipes: string[], lang: string | null = null, partial: Partial<RunRow> = {}): RunRow {
  return {
    runId: runId(`5:${ID}`, recipes, lang),
    jobId: `5:${ID}`,
    recipes,
    lang,
    status: 'ready',
    error: null,
    noteUrl: TRANSCRIPT_URL,
    notified: true,
    acceptedAt: 1,
    ...partial,
  }
}

function tap(updateId: number, data: string, from = 42, messageId?: number) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq${updateId}`,
      data,
      from: { id: from },
      message: messageId === undefined ? { chat: { id: from } } : { message_id: messageId, chat: { id: from } },
    },
  }
}
```

A `describe('handleCallback', …)` blokkban a `'a felirat kész üzenete summary gombot kap'` és a `'a summary kész linkje kimegy, noteUrl nélkül a mondat failed'` teszt helyére:

```ts
  it('a felirat kész üzenete a kilenc gombot kapja', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const ok = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.sent).toEqual(['Cím. A felirat megvan.'])
    expect(ok.keyboards).toEqual([recipeKeyboard(`5:${ID}`)])
  })

  it('a futás kész linkje kimegy, noteUrl nélkül failed, küldési hibánál accepted, az ismétlés nem küld', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['notes'], null, { status: 'accepted', noteUrl: null, notified: false }))
    const missing = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím' }, missing)
    expect(missing.sent).toEqual(['A jegyzet linkje hiányzik.'])
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('failed')

    await store.saveRun(readyRun(['notes'], null, { status: 'accepted', noteUrl: null, notified: false }))
    const dropped = deps(store, { send: () => Promise.resolve(false) })
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, dropped)
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'accepted', noteUrl: TRANSCRIPT_URL, notified: false })

    const ok = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, ok)
    expect(ok.sent).toEqual([`Cím · notes. A jegyzet megvan.\nhttps://worker.test/notes/5:${ID}/notes`])
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'ready', notified: true })
    const repeat = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, repeat)
    expect(repeat.sent).toEqual([])
  })

  it('a futás hibasora a chatbe megy, a futás failed, a felirat sora marad', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['qa'], null, { status: 'accepted', notified: false }))
    const own = deps(store)
    await handleCallback(`5:${ID}:qa`, { status: 'failed', error: 'A futás megállt.' }, own)
    expect(own.sent).toEqual(['A futás megállt.'])
    expect(await store.run(`5:${ID}:qa`)).toMatchObject({ status: 'failed', error: 'A futás megállt.' })
    expect((await store.listByUpdate(5))[0]?.status).toBe('ready')
  })
```

A teljes `describe('handleTap', …)` blokk helyére:

```ts
describe('handleTap', () => {
  it('a receptgomb futást nyit és kopogtat, a második koppintás már sorban, az ismételt update hallgat', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const first = deps(store)
    const knocks = await handleTap(tap(20, `r:notes:5:${ID}`), first)
    expect(knocks).toEqual([{ jobId: `5:${ID}:notes`, videoId: ID, url: VIDEO_URL, recipes: ['notes'] }])
    expect(first.answered).toEqual(['cq20'])
    expect(first.sent).toEqual(['Sorba került: notes'])
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'queued', recipes: ['notes'], lang: null })
    await applyKnocks(knocks, first)
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('accepted')

    const second = deps(store)
    expect(await handleTap(tap(21, `r:notes:5:${ID}`), second)).toEqual([])
    expect(second.sent).toEqual([`Már sorban van: ${ID}.`])
    const repeated = deps(store)
    expect(await handleTap(tap(20, `r:notes:5:${ID}`), repeated)).toEqual([])
    expect(repeated.sent).toEqual([])
  })

  it('a régi summary gomb a summary futás, a bukott futás újraindul, a kész újraküldi a linket', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    expect(await handleTap(tap(30, `summary:5:${ID}`), deps(store))).toEqual([
      { jobId: `5:${ID}:summary`, videoId: ID, url: VIDEO_URL, recipes: ['summary'] },
    ])
    await store.saveRun(readyRun(['summary'], null, { status: 'failed', error: 'x' }))
    expect(await handleTap(tap(31, `r:summary:5:${ID}`), deps(store))).toHaveLength(1)
    expect(await store.run(`5:${ID}:summary`)).toMatchObject({ status: 'queued', error: null })
    await store.saveRun(readyRun(['summary']))
    const again = deps(store)
    expect(await handleTap(tap(32, `r:summary:5:${ID}`), again)).toEqual([])
    expect(again.sent).toEqual([`Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/5:${ID}/summary`])
  })

  it('idegen fiók, idegen sor, a még nem kész felirat sora és az ismeretlen recept nem indít', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insert(readyRow({ jobId: `6:${ID}`, updateId: 6, sub: 'sub-9' }))
    await store.insert(readyRow({ jobId: `7:${ID}`, updateId: 7, status: 'accepted' }))
    const foreign = deps(store)
    expect(await handleTap(tap(40, `r:qa:5:${ID}`, 7), foreign)).toEqual([])
    expect(foreign.answered).toEqual(['cq40'])
    const own = deps(store)
    expect(await handleTap(tap(41, `r:qa:6:${ID}`), own)).toEqual([])
    expect(await handleTap(tap(42, `r:qa:7:${ID}`), own)).toEqual([])
    expect(await handleTap(tap(43, `r:toString:5:${ID}`), own)).toEqual([])
    expect(own.sent).toEqual([])
    expect(await store.runsFor(`5:${ID}`)).toEqual([])
  })

  it('a fordítás: kész jegyzet nélkül a mondat, utána a választó, a kapcsoló és a tovább szerkeszt, a nyelv indít', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const empty = deps(store)
    expect(await handleTap(tap(50, `f:5:${ID}`), empty)).toEqual([])
    expect(empty.sent).toEqual(['Előbb készíts egy jegyzetet.'])

    await store.insertRun(readyRun(['notes']))
    await store.insertRun(readyRun(['summary']))
    const picker = deps(store)
    await handleTap(tap(51, `f:5:${ID}`), picker)
    expect(picker.sent).toEqual(['Melyik jegyzetet fordítsam?'])
    expect(picker.keyboards).toEqual([pickKeyboard(0, ['summary', 'notes'], `5:${ID}`)])

    const toggled = deps(store)
    expect(await handleTap(tap(52, `t:3:5:${ID}`, 42, 9), toggled)).toEqual([])
    expect(toggled.edits).toEqual([
      { chatId: '42', messageId: 9, text: 'Melyik jegyzetet fordítsam?', keyboard: pickKeyboard(3, ['summary', 'notes'], `5:${ID}`) },
    ])
    const blank = deps(store)
    await handleTap(tap(53, `n:0:5:${ID}`, 42, 9), blank)
    expect(blank.edits).toEqual([])
    const next = deps(store)
    await handleTap(tap(54, `n:3:5:${ID}`, 42, 9), next)
    expect(next.edits).toEqual([{ chatId: '42', messageId: 9, text: 'Melyik nyelvre?', keyboard: langKeyboard(3, `5:${ID}`) }])
    const noMessage = deps(store)
    await handleTap(tap(55, `n:3:5:${ID}`), noMessage)
    expect(noMessage.edits).toEqual([])

    const lang = deps(store)
    expect(await handleTap(tap(56, `l:3:de:5:${ID}`, 42, 9), lang)).toEqual([
      { jobId: `5:${ID}:de:summary+notes`, videoId: ID, url: VIDEO_URL, recipes: ['summary', 'notes'], lang: 'de' },
    ])
    expect(lang.sent).toEqual(['Sorba került: summary, notes → de'])
  })

  it('a cron a felirat sorát recept nélkül, a futást a recipes és a lang mezővel ébreszti, a 401 failed', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued' }))
    await store.insert(readyRow({ jobId: `6:${ID}`, updateId: 6 }))
    await store.insertRun(
      readyRun(['summary', 'notes'], 'de', {
        jobId: `6:${ID}`,
        runId: `6:${ID}:de:summary+notes`,
        status: 'queued',
        notified: false,
      }),
    )
    const clock = deps(store)
    await handleCron(clock)
    expect(clock.knocks).toEqual([
      { jobId: `5:${ID}`, videoId: ID, url: VIDEO_URL },
      { jobId: `6:${ID}:de:summary+notes`, videoId: ID, url: VIDEO_URL, recipes: ['summary', 'notes'], lang: 'de' },
    ])
    expect((await store.run(`6:${ID}:de:summary+notes`))?.status).toBe('accepted')

    const rejected = await boundStore()
    await rejected.insert(readyRow())
    await rejected.insertRun(readyRun(['qa'], null, { status: 'queued', notified: false }))
    await handleCron(deps(rejected, { knock: () => Promise.resolve(401) }))
    expect(await rejected.run(`5:${ID}:qa`)).toMatchObject({ status: 'failed', error: 'A konténer elutasította a hívást.' })
  })
})
```

`worker/src/plan.test.ts`:
- Az importokból a `decideTap`, a `noteReadyMessage` és a `summaryButton` kimarad.
- A `'a claim csak a várt állapotból ír, a rememberUpdate egyszer enged'` teszt helyére:

```ts
  it('a rememberUpdate egyszer enged, a queued sor aktív', async () => {
    const store = memoryStore()
    expect(await store.rememberUpdate(9)).toBe(true)
    expect(await store.rememberUpdate(9)).toBe(false)
    await store.insert(row({ jobId: `4:${ID}`, updateId: 4, status: 'queued' }))
    expect(await store.activeByVideo(ID)).not.toBeNull()
  })
```

- A `'a jegyzet mondata két sor, a gomb adata a munka azonosítója'` teszt helyére:

```ts
  it('a hiányzó link mondata', () => {
    expect(MISSING_NOTE_URL).toBe('A jegyzet linkje hiányzik.')
  })
```

- A `'a cím újsora és vezérlőkaraktere egy szóköz, a link marad a második sor'` teszt törzse:

```ts
    expect(runReadyMessage('Cím\nhttps://evil.example\u0007', run({ recipes: ['notes'] }), 'https://w.test')).toBe(
      `Cím https://evil.example · notes. A jegyzet megvan.\nhttps://w.test/notes/1:${ID}/notes`,
    )
    expect(readyLine('Cím\r\nmásodik')).toBe('Cím második. A felirat megvan.')
```

- A `'a koppintás a fázis és a státusz szerint dönt'` teszt törlődik.

`worker/src/entry.test.ts`: a `'a summary visszahívása a kérés saját címére tett /notes linket küldi'` teszt helyére:

```ts
  it('a futás visszahívása a kérés saját címére tett /notes linket küldi', async () => {
    const bodies: string[] = []
    globalThis.fetch = (_input, init) => {
      const raw = init?.body
      bodies.push(typeof raw === 'string' ? raw : '')
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    // A visszahívás csak ezeket a mezőket olvassa, a többit a toRow és a toRun undefined-ként adja át.
    const job = { job_id: '5:abcdefghijk', update_id: 5, chat_id: '42' }
    const run = { run_id: '5:abcdefghijk:summary', job_id: '5:abcdefghijk', recipes: 'summary', lang: null, status: 'accepted', notified: 0 }
    const db: D1Like = {
      prepare(sql: string): D1Statement {
        const statement: D1Statement = {
          bind: () => statement,
          all: <T>() => Promise.resolve({ results: (sql.includes('WHERE update_id') ? [job] : []) as T[] }),
          first: <T>() => Promise.resolve((sql.includes('FROM runs WHERE run_id') ? run : null) as T | null),
          run: () => Promise.resolve({}),
        }
        return statement
      },
    }
    const env = {
      DB: db,
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const response = await worker.fetch(
      new Request('https://worker.test/internal/jobs/5%3Aabcdefghijk%3Asummary', {
        method: 'POST',
        headers: { authorization: 'Bearer titok' },
        body: JSON.stringify({ status: 'ready', title: 'Cím', noteUrl: 'https://github.com/tulaj/vault/blob/main/a_transcript.md' }),
      }),
      env,
      { waitUntil: () => undefined },
    )
    expect(response.status).toBe(200)
    expect(bodies).toHaveLength(1)
    expect((JSON.parse(bodies[0]!) as { text: string }).text).toBe(
      'Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/5:abcdefghijk/summary',
    )
  })

  it('a felirat kész üzenete gombsort küld, a kapcsoló editMessageText-et', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') })
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    const job = { job_id: '5:abcdefghijk', update_id: 5, chat_id: '42', video_id: 'abcdefghijk', status: 'ready', notified_ready: 0, sub: 'sub-42' }
    const run = { run_id: '5:abcdefghijk:summary', job_id: '5:abcdefghijk', recipes: 'summary', lang: null, status: 'ready', notified: 1 }
    const binding = { telegram_user_id: '42', sub: 'sub-42', email: 'en@example.com', bound_at: 0 }
    const db: D1Like = {
      prepare(sql: string): D1Statement {
        const statement: D1Statement = {
          bind: () => statement,
          all: <T>() =>
            Promise.resolve({
              results: (sql.includes('WHERE update_id') ? [job] : sql.includes('FROM runs WHERE job_id') ? [run] : []) as T[],
            }),
          first: <T>() => Promise.resolve((sql.includes('FROM bindings') ? binding : null) as T | null),
          run: () => Promise.resolve({}),
        }
        return statement
      },
    }
    const env = {
      DB: db,
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const ctx = { waitUntil: () => undefined }
    await worker.fetch(
      new Request('https://worker.test/internal/jobs/5%3Aabcdefghijk', {
        method: 'POST',
        headers: { authorization: 'Bearer titok' },
        body: JSON.stringify({ status: 'ready', title: 'Cím' }),
      }),
      env,
      ctx,
    )
    expect(calls[0]?.url).toBe('https://api.telegram.org/bottoken/sendMessage')
    const sent = calls[0]?.body as { reply_markup: { inline_keyboard: unknown[][] } }
    expect(sent.reply_markup.inline_keyboard[2]?.[2]).toEqual({ text: 'fordítás', callback_data: 'f:5:abcdefghijk' })

    calls.length = 0
    await worker.fetch(
      new Request('https://worker.test/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'hook' },
        body: JSON.stringify({
          update_id: 60,
          callback_query: { id: 'cq', data: 't:1:5:abcdefghijk', from: { id: 42 }, message: { message_id: 9, chat: { id: 42 } } },
        }),
      }),
      env,
      ctx,
    )
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.telegram.org/bottoken/answerCallbackQuery',
      'https://api.telegram.org/bottoken/editMessageText',
    ])
    expect(calls[1]?.body).toEqual({
      chat_id: '42',
      message_id: 9,
      text: 'Melyik jegyzetet fordítsam?',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✓ summary', callback_data: 't:0:5:abcdefghijk' }],
          [{ text: 'tovább', callback_data: 'n:1:5:abcdefghijk' }],
        ],
      },
    })
  })
```

- [ ] **Step 2: A bukás ellenőrzése**

Run: `pnpm vitest run worker`
Expected: FAIL. A `handleTap` a `r:` adatot nem ismeri, a felirat üzenete még egy `summary` gombot küld, és a `deps` `edit` mezőjét a típus nem ismeri.

- [ ] **Step 3: `worker/src/handle.ts`, az egész fájl**

```ts
import {
  BIND_FIRST,
  LANG_LINE,
  LINK_INVALID,
  MISSING_NOTE_URL,
  NOTHING_TO_TRANSLATE,
  PICK_LINE,
  REJECTED_SECRET,
  TOKEN_TTL,
  alreadyBoundLine,
  alreadyLine,
  boundLine,
  decideRun,
  decideStart,
  hashToken,
  isAllowed,
  isToken,
  langKeyboard,
  linesForMessage,
  linkLine,
  maskRecipes,
  notAllowedLine,
  parseTap,
  pickKeyboard,
  queuedLine,
  readyBases,
  readyLine,
  recipeKeyboard,
  runId,
  runQueuedLine,
  runReadyMessage,
  waitingLine,
  type Key,
} from './plan.js'
import type { Binding, JobRow, JobStatus, JobStore, RunRow } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
}

export interface WorkerDeps {
  allowedEmails: string
  botUsername: string
  linkBase: string
  store: JobStore
  now: () => number
  newToken: () => string
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  send: (chatId: string, text: string, keyboard?: Key[][]) => Promise<boolean>
  edit: (chatId: string, messageId: number, text: string, keyboard: Key[][]) => Promise<boolean>
  answerTap: (callbackQueryId: string) => Promise<void>
}

type KnockResult = 202 | 409 | 401 | 'down'

const START = /^\/start(?:\s+(\S+))?\s*$/

export async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
  const head = jobId.split(':')[0]
  if (head === undefined || !/^\d+$/.test(head)) return null
  const rows = await store.listByUpdate(Number(head))
  return rows.find((row) => row.jobId === jobId) ?? null
}

async function allowedBinding(userId: string | undefined, deps: WorkerDeps): Promise<Binding | null> {
  if (userId === undefined) return null
  const binding = await deps.store.bindingFor(userId)
  if (binding === null || !isAllowed(binding.email, deps.allowedEmails)) return null
  return binding
}

/** A felirat sora és a futás sora is így áll be a kopogtatás eredménye szerint. */
async function settle(
  target: { status: JobStatus; acceptedAt: number | null; error: string | null },
  row: JobRow,
  save: () => Promise<void>,
  result: KnockResult,
  deps: WorkerDeps,
): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    target.status = 'accepted'
    target.acceptedAt = deps.now()
    await save()
    return
  }
  if (result === 401) {
    const sent = await deps.send(row.chatId, REJECTED_SECRET)
    if (!sent) return
    target.status = 'failed'
    target.error = REJECTED_SECRET
    await save()
    return
  }
  if (target.status === 'waiting') return
  const sent = await deps.send(row.chatId, waitingLine(row.videoId))
  if (!sent) return
  target.status = 'waiting'
  await save()
}

function knockFor(run: RunRow, row: JobRow): PlannedKnock {
  const knock: PlannedKnock = { jobId: run.runId, videoId: row.videoId, url: row.url, recipes: run.recipes }
  if (run.lang !== null) knock.lang = run.lang
  return knock
}

async function handleStart(
  updateId: number,
  userId: string,
  chatId: string,
  arg: string | undefined,
  deps: WorkerDeps,
): Promise<void> {
  if (!(await deps.store.rememberUpdate(updateId))) return
  if (arg === undefined) {
    const binding = await allowedBinding(userId, deps)
    if (binding !== null) {
      await deps.send(chatId, alreadyBoundLine(binding.email))
      return
    }
    const raw = deps.newToken()
    await deps.store.insertToken({
      tokenHash: await hashToken(raw),
      telegramUserId: userId,
      expiresAt: deps.now() + TOKEN_TTL,
      pendingSub: null,
      pendingEmail: null,
      used: false,
    })
    await deps.send(chatId, linkLine(`${deps.linkBase}/link?t=${raw}`))
    return
  }
  const token = isToken(arg) ? await deps.store.token(await hashToken(arg)) : null
  const action = decideStart(token, userId, deps.now(), deps.allowedEmails)
  // A visszatérő token az első felhasználásnál elhasználódik, akkor is, ha más küldi: kiszivárogva se kössön.
  if (token !== null && token.pendingSub !== null && !token.used) await deps.store.saveToken({ ...token, used: true })
  if (token === null || action.type === 'invalid') {
    await deps.send(chatId, LINK_INVALID)
    return
  }
  if (action.type === 'denied') {
    await deps.send(chatId, notAllowedLine(action.email))
    return
  }
  await deps.store.bind({ telegramUserId: userId, sub: action.sub, email: action.email, boundAt: deps.now() }, chatId)
  await deps.send(chatId, boundLine(action.email))
}

export async function handleLink(
  raw: string,
  who: { sub: string; email: string },
  deps: WorkerDeps,
): Promise<{ status: 302; location: string } | { status: 200 }> {
  const token = isToken(raw) ? await deps.store.token(await hashToken(raw)) : null
  if (token === null || token.used || token.pendingSub !== null || token.expiresAt <= deps.now()) return { status: 200 }
  await deps.store.saveToken({ ...token, used: true })
  const back = deps.newToken()
  await deps.store.insertToken({
    tokenHash: await hashToken(back),
    telegramUserId: token.telegramUserId,
    expiresAt: token.expiresAt,
    pendingSub: who.sub,
    pendingEmail: who.email,
    used: false,
  })
  return { status: 302, location: `https://t.me/${deps.botUsername}?start=${back}` }
}

export async function handleUpdate(
  update: {
    update_id: number
    message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string }
  },
  deps: WorkerDeps,
): Promise<{ status: number; knocks: PlannedKnock[] }> {
  const message = update.message
  if (!message?.from) return { status: 200, knocks: [] }
  // A bot csak privát chatre készült: csoportban a kötés a többi tag sorait is átírná.
  if (message.chat.id !== message.from.id) return { status: 200, knocks: [] }
  const userId = String(message.from.id)
  const chatId = String(message.chat.id)
  const start = START.exec(message.text ?? '')
  if (start) {
    await handleStart(update.update_id, userId, chatId, start[1], deps)
    return { status: 200, knocks: [] }
  }
  const binding = await allowedBinding(userId, deps)
  if (binding === null) {
    await deps.send(chatId, BIND_FIRST)
    return { status: 200, knocks: [] }
  }
  if ((await deps.store.listByUpdate(update.update_id)).length > 0) return { status: 200, knocks: [] }
  const planned = linesForMessage(message.text ?? '', [])
  const lines = [...planned.lines]
  const knocks: PlannedKnock[] = []
  for (const job of planned.jobs) {
    const active = await deps.store.activeByVideo(job.videoId)
    if (active) {
      const at = lines.indexOf(queuedLine(job.videoId))
      if (at !== -1) lines[at] = alreadyLine(job.videoId)
      continue
    }
    const row: JobRow = {
      jobId: `${update.update_id}:${job.videoId}`,
      updateId: update.update_id,
      chatId,
      messageId: message.message_id,
      videoId: job.videoId,
      url: job.url,
      status: 'queued',
      phase: 'subtitle',
      error: null,
      title: null,
      noteUrl: null,
      notifiedReady: false,
      noteNotified: false,
      acceptedAt: null,
      sub: binding.sub,
    }
    await deps.store.insert(row)
    knocks.push({ jobId: row.jobId, videoId: row.videoId, url: row.url })
  }
  if (lines.length > 0) await deps.send(chatId, lines.join('\n'))
  return { status: 200, knocks }
}

export async function applyKnocks(knocks: readonly PlannedKnock[], deps: WorkerDeps): Promise<void> {
  for (const knock of knocks) {
    if (knock.recipes !== undefined) {
      const run = await deps.store.run(knock.jobId)
      const row = run === null ? null : await findRow(deps.store, run.jobId)
      if (run === null || row === null) continue
      await settle(run, row, () => deps.store.saveRun(run), await deps.knock(knock), deps)
      continue
    }
    const row = await findRow(deps.store, knock.jobId)
    if (!row) continue
    await settle(row, row, () => deps.store.save(row), await deps.knock(knock), deps)
  }
}

type CallbackBody = { status: 'ready'; title: string; noteUrl?: string } | { status: 'failed'; error: string }

async function runCallback(run: RunRow, body: CallbackBody, deps: WorkerDeps): Promise<void> {
  const row = await findRow(deps.store, run.jobId)
  if (row === null) return
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return
    run.status = 'failed'
    run.error = body.error
    await deps.store.saveRun(run)
    return
  }
  if (run.notified) return
  if (body.noteUrl === undefined || body.noteUrl === '') {
    const sent = await deps.send(row.chatId, MISSING_NOTE_URL)
    if (!sent) return
    run.status = 'failed'
    run.error = MISSING_NOTE_URL
    await deps.store.saveRun(run)
    return
  }
  run.noteUrl = body.noteUrl
  const sent = await deps.send(row.chatId, runReadyMessage(body.title, run, deps.linkBase))
  if (!sent) {
    run.status = 'accepted'
    await deps.store.saveRun(run)
    return
  }
  run.status = 'ready'
  run.notified = true
  await deps.store.saveRun(run)
}

export async function handleCallback(id: string, body: CallbackBody, deps: WorkerDeps): Promise<number> {
  const run = await deps.store.run(id)
  if (run !== null) {
    await runCallback(run, body, deps)
    return 200
  }
  const row = await findRow(deps.store, id)
  if (!row) return 200
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.notifiedReady) return 200
  row.title = body.title
  const sent = await deps.send(row.chatId, readyLine(body.title), recipeKeyboard(row.jobId))
  if (!sent) {
    await deps.store.save(row)
    return 200
  }
  row.status = 'ready'
  row.notifiedReady = true
  await deps.store.save(row)
  return 200
}

async function requestRun(row: JobRow, recipes: string[], lang: string | null, deps: WorkerDeps): Promise<PlannedKnock[]> {
  const id = runId(row.jobId, recipes, lang)
  const run = await deps.store.run(id)
  const action = decideRun(run)
  if (action.type === 'ignore') return []
  if (action.type === 'busy') {
    await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  if (action.type === 'resend') {
    if (run !== null) await deps.send(row.chatId, runReadyMessage(row.title ?? row.videoId, run, deps.linkBase))
    return []
  }
  const fresh: RunRow = {
    runId: id,
    jobId: row.jobId,
    recipes,
    lang,
    status: 'queued',
    error: null,
    noteUrl: null,
    notified: false,
    acceptedAt: null,
  }
  const claimed =
    action.type === 'start' ? await deps.store.insertRun(fresh) : await deps.store.claimRun(id, 'failed', 'queued')
  if (!claimed) {
    await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  await deps.send(row.chatId, runQueuedLine(recipes, lang))
  return [knockFor(fresh, row)]
}

export async function handleTap(
  update: {
    update_id: number
    callback_query: {
      id: string
      data?: string
      from?: { id: number }
      message?: { message_id?: number; chat: { id: number } }
    }
  },
  deps: WorkerDeps,
): Promise<PlannedKnock[]> {
  await deps.answerTap(update.callback_query.id)
  if (!(await deps.store.rememberUpdate(update.update_id))) return []
  const from = update.callback_query.from
  const binding = await allowedBinding(from === undefined ? undefined : String(from.id), deps)
  if (binding === null) return []
  const tap = parseTap(update.callback_query.data ?? '')
  if (tap === null) return []
  const row = await findRow(deps.store, tap.jobId)
  if (row === null || row.sub !== binding.sub || row.status !== 'ready') return []
  if (tap.type === 'recipe') return requestRun(row, [tap.recipe], null, deps)
  if (tap.type === 'lang') {
    const recipes = maskRecipes(tap.mask)
    return recipes.length === 0 ? [] : requestRun(row, recipes, tap.lang, deps)
  }
  const ready = readyBases(await deps.store.runsFor(row.jobId))
  if (tap.type === 'translate') {
    if (ready.length === 0) await deps.send(row.chatId, NOTHING_TO_TRANSLATE)
    else await deps.send(row.chatId, PICK_LINE, pickKeyboard(0, ready, row.jobId))
    return []
  }
  // A Telegram a régi üzenetnél elhagyhatja a message mezőt: ilyenkor nincs mit szerkeszteni.
  const messageId = update.callback_query.message?.message_id
  if (typeof messageId !== 'number') return []
  if (tap.type === 'toggle') await deps.edit(row.chatId, messageId, PICK_LINE, pickKeyboard(tap.mask, ready, row.jobId))
  else if (tap.mask !== 0) await deps.edit(row.chatId, messageId, LANG_LINE, langKeyboard(tap.mask, row.jobId))
  return []
}

export async function handleCron(deps: WorkerDeps): Promise<void> {
  for (const row of await deps.store.due(deps.now())) {
    const knock: PlannedKnock = { jobId: row.jobId, videoId: row.videoId, url: row.url }
    await settle(row, row, () => deps.store.save(row), await deps.knock(knock), deps)
  }
  for (const run of await deps.store.dueRuns(deps.now())) {
    const row = await findRow(deps.store, run.jobId)
    if (row === null) continue
    await settle(run, row, () => deps.store.saveRun(run), await deps.knock(knockFor(run, row)), deps)
  }
}
```

- [ ] **Step 4: `worker/src/index.ts`**

Az import: `import { LINK_INVALID_PAGE, newToken, type Key } from './plan.js'`. Az `identity` függvény után:

```ts
function markup(keyboard: Key[][]): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return { inline_keyboard: keyboard.map((row) => row.map((key) => ({ text: key.text, callback_data: key.data }))) }
}

async function telegram(token: string, method: string, payload: unknown): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return response.ok
  } catch {
    return false
  }
}
```

A `deps` függvényben a `send` helyett:

```ts
    send: (chatId, text, keyboard) =>
      telegram(env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
        chat_id: chatId,
        text,
        ...(keyboard === undefined ? {} : { reply_markup: markup(keyboard) }),
      }),
    edit: (chatId, messageId, text, keyboard) =>
      telegram(env.TELEGRAM_BOT_TOKEN, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: markup(keyboard),
      }),
```

Az `answerTap` is ezt a segédet hívja:

```ts
    answerTap: async (callbackQueryId) => {
      await telegram(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: callbackQueryId })
    },
```

Az `isTap` típusőrében a `message?: { chat: { id: number } }` helyett `message?: { message_id?: number; chat: { id: number } }`.

- [ ] **Step 5: A régi `summary`-út törlése**

- `worker/src/messages.ts`: a `noteReadyMessage` és a `summaryButton` függvény törlődik.
- `worker/src/plan.ts`: az újraexport-listából a `noteReadyMessage` és a `summaryButton` kimarad. A `decideTap` függvény törlődik (a `TapAction` típus marad, a `decideRun` használja).
- `worker/src/store.ts`: a `JobStore` `claim` hívása és a `memoryStore` `claim` megvalósítása törlődik.
- `worker/src/d1.ts`: a `claim` megvalósítása törlődik.

- [ ] **Step 6: A teszt zöld**

Run: `pnpm vitest run worker`
Expected: PASS.

- [ ] **Step 7: Ellenőrzés és commit**

Run: `pnpm test && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`

```bash
git add worker/src
git commit -m "feat(worker): Offer every recipe and translation in the bot"
```

---

### Task 5: Az olvasó a futásokból, a `jobs` sor szűkítése

**Files:**
- Modify: `worker/src/reader.ts` (az egész fájl, lent)
- Modify: `worker/src/store.ts` (`JobRow`, `JobPhase`, `memoryStore.notesFor`)
- Modify: `worker/src/d1.ts` (`JobRecord`, `toRow`, `insert`, `save`, `notesFor`)
- Modify: `worker/src/handle.ts` (a `handleUpdate` sorának három mezője)
- Test: `worker/src/reader.test.ts` (az egész fájl, lent), `worker/src/handle.test.ts`, `worker/src/plan.test.ts`

**Interfaces:**
- Consumes: `runKinds`, `RunRow`, `runsFor` a 3. feladatból.
- Produces:
  - `JobRow` a `phase`, a `noteUrl` és a `noteNotified` mező nélkül.
  - `notesFor(sub)`: a fiók azon `jobs`-sorai, amelyeknek van `ready` futása, az `acceptedAt` szerint csökkenő sorrendben.
  - `vaultPath(noteUrl, repo, branch, kind)`: a `_transcript.md`-re végződő címből a fajta szakaszai.

- [ ] **Step 1: A bukó tesztek, `worker/src/reader.test.ts`, az egész fájl**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { notePage, notesPage, vaultPath, type ReaderDeps } from './reader.js'
import { memoryStore, type JobRow, type JobStore, type RunRow } from './store.js'

const ID = 'zw_kFlCTPKY'
const REPO = 'tulaj/vault'
const DIR = 'Inbox/transcript-refinery'
const STEM = `Feldmár András： Csak úgy ｜ [${ID}]`
const blob = (kind: string) => `https://github.com/${REPO}/blob/main/${DIR}/${encodeURIComponent(`${STEM}_${kind}.md`)}`
const api = (kind: string) =>
  `https://api.github.com/repos/${REPO}/contents/${DIR}/${encodeURIComponent(`${STEM}_${kind}.md`)}?ref=main`
const NOTE_URL = blob('transcript')

function row(updateId: number, partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: `${updateId}:${ID}`,
    updateId,
    chatId: '42',
    messageId: 1,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'ready',
    error: null,
    title: 'Cím',
    notifiedReady: true,
    acceptedAt: Date.UTC(2026, 9, 7),
    sub: 'sub-42',
    ...partial,
  }
}

function run(updateId: number, recipes: string[], partial: Partial<RunRow> = {}): RunRow {
  const lang = partial.lang ?? null
  return {
    runId: `${updateId}:${ID}:${lang === null ? '' : `${lang}:`}${recipes.join('+')}`,
    jobId: `${updateId}:${ID}`,
    recipes,
    lang,
    status: 'ready',
    error: null,
    noteUrl: NOTE_URL,
    notified: true,
    acceptedAt: 1,
    ...partial,
  }
}

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

function reader(
  store: JobStore,
  respond: () => Promise<Response> = () => Promise.resolve(new Response('<article><h1>Cím</h1></article>')),
): ReaderDeps & { calls: { url: string; headers: Record<string, string> }[] } {
  const calls: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (input, init) => {
    calls.push({ url: input as string, headers: init?.headers as Record<string, string> })
    return respond()
  }
  return { store, vaultRepo: REPO, vaultBranch: 'main', vaultToken: 'olvaso', calls }
}

describe('vaultPath', () => {
  it('az átirat GitHub-címéből a fajta fájljának szakaszai, minden más null', () => {
    expect(vaultPath(NOTE_URL, REPO, 'main', 'summary')).toEqual(['Inbox', 'transcript-refinery', `${STEM}_summary.md`])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'transcript')).toEqual(['Inbox', 'transcript-refinery', `${STEM}_transcript.md`])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'notes-de')).toEqual(['Inbox', 'transcript-refinery', `${STEM}_notes-de.md`])
    expect(vaultPath(NOTE_URL, 'mas/vault', 'main', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, REPO, 'dev', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, '', '', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/a_summary.md`, REPO, 'main', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/x_transcript.md/a_transcript.md`, REPO, 'main', 'qa')).toEqual([
      'x_transcript.md',
      'a_qa.md',
    ])
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/%E0_transcript.md`, REPO, 'main', 'summary')).toBeNull()
  })
})

describe('notesPage', () => {
  it('csak a saját, kész futással bíró sorok, újak elöl, a kész fajtákkal és a transcripttel, escape-elt címmel', async () => {
    const store = memoryStore()
    await store.insert(row(5, { title: 'Régi', acceptedAt: Date.UTC(2026, 9, 6) }))
    await store.insertRun(run(5, ['summary']))
    await store.insert(row(6, { title: '<b>Új</b>' }))
    await store.insertRun(run(6, ['notes']))
    await store.insertRun(run(6, ['summary', 'notes'], { lang: 'de' }))
    await store.insertRun(run(6, ['qa'], { status: 'failed' }))
    await store.insert(row(7, { title: 'Idegen', sub: 'sub-7' }))
    await store.insertRun(run(7, ['summary']))
    await store.insert(row(8, { title: 'Félkész' }))
    await store.insertRun(run(8, ['summary'], { status: 'queued' }))
    const response = await notesPage('sub-42', reader(store))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    const link = (job: number, kind: string) => `<a href="/notes/${job}:${ID}/${kind}">${kind}</a>`
    expect(html).toContain(
      `<li>&#60;b&#62;Új&#60;/b&#62; · 2026-10-07 — ${[link(6, 'notes'), link(6, 'summary-de'), link(6, 'notes-de'), link(6, 'transcript')].join(' · ')}</li>`,
    )
    expect(html).toContain(`<li>Régi · 2026-10-06 — ${link(5, 'summary')} · ${link(5, 'transcript')}</li>`)
    expect(html.indexOf(`/notes/6:`)).toBeLessThan(html.indexOf(`/notes/5:`))
    expect(html).not.toContain('Idegen')
    expect(html).not.toContain('Félkész')
    expect(html).not.toContain('/qa"')
  })

  it('jegyzet nélkül a biztató mondat', async () => {
    const html = await (await notesPage('sub-42', reader(memoryStore()))).text()
    expect(html).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
  })
})

describe('notePage', () => {
  it('a kész fajta és a transcript a GitHub renderelt HTML-jével és a saját GitHub-linkjével, pontos fejlécekkel', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    await store.insertRun(run(5, ['summary']))
    await store.insertRun(run(5, ['summary'], { lang: 'de' }))
    const deps = reader(store)
    const response = await notePage(`5:${ID}`, 'summary', 'sub-42', deps)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<title>Cím · summary</title>')
    expect(html).toContain(`<a href="${blob('summary')}">Megnyitás a GitHubon</a>`)
    expect(html).toContain('<article><h1>Cím</h1></article>')
    expect(html).toContain('color-scheme:light dark')

    const transcript = await (await notePage(`5:${ID}`, 'transcript', 'sub-42', deps)).text()
    expect(transcript).toContain('<title>Cím · transcript</title>')
    expect(transcript).toContain(`<a href="${blob('transcript')}">Megnyitás a GitHubon</a>`)
    const german = await (await notePage(`5:${ID}`, 'summary-de', 'sub-42', deps)).text()
    expect(german).toContain(`<a href="${blob('summary-de')}">Megnyitás a GitHubon</a>`)

    const headers = {
      accept: 'application/vnd.github.html+json',
      authorization: 'Bearer olvaso',
      'user-agent': 'transcript-refinery',
    }
    expect(deps.calls).toEqual([
      { url: api('summary'), headers },
      { url: api('transcript'), headers },
      { url: api('summary-de'), headers },
    ])
  })

  it('az idegen, a nem létező, a kész futás nélküli, az idegen előtagú sor és a nem kész fajta ugyanaz a 404, GitHub-hívás nélkül', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    await store.insertRun(run(5, ['summary']))
    await store.insertRun(run(5, ['qa'], { status: 'failed' }))
    await store.insert(row(6))
    await store.insertRun(run(6, ['summary'], { noteUrl: 'https://github.com/mas/repo/blob/main/a_transcript.md' }))
    await store.insert(row(7))
    await store.insertRun(run(7, ['summary'], { status: 'queued', noteUrl: null }))
    const deps = reader(store)
    const cases: [string, string, string][] = [
      [`5:${ID}`, 'summary', 'sub-7'],
      [`5:${ID}`, 'qa', 'sub-42'],
      [`5:${ID}`, 'notes', 'sub-42'],
      [`9:${ID}`, 'summary', 'sub-42'],
      [`6:${ID}`, 'summary', 'sub-42'],
      [`7:${ID}`, 'summary', 'sub-42'],
      [`7:${ID}`, 'transcript', 'sub-42'],
      ['x', 'summary', 'sub-42'],
    ]
    for (const [jobId, kind, sub] of cases) {
      const response = await notePage(jobId, kind, sub, deps)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
    }
    expect(deps.calls).toEqual([])
  })

  it('a GitHub hibája a táblázat mondata 502-vel, a cím escape-elve', async () => {
    const store = memoryStore()
    await store.insert(row(5, { title: '<script>x</script>' }))
    await store.insertRun(run(5, ['summary']))
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.resolve(new Response(null, { status: 404 })), 'A jegyzet nincs a vaultban.'],
      [() => Promise.resolve(new Response(null, { status: 401 })), 'A vault nem olvasható.'],
      [() => Promise.resolve(new Response(null, { status: 403 })), 'A vault nem olvasható.'],
      [() => Promise.resolve(new Response(null, { status: 500 })), 'A GitHub nem érhető el.'],
      [() => Promise.reject(new Error('hálózat')), 'A GitHub nem érhető el.'],
    ]
    for (const [respond, line] of cases) {
      const response = await notePage(`5:${ID}`, 'summary', 'sub-42', reader(store, respond))
      expect(response.status).toBe(502)
      const html = await response.text()
      expect(html).toContain(`<p>${line}</p>`)
      expect(html).toContain('&#60;script&#62;x&#60;/script&#62;')
      expect(html).not.toContain('<script>')
    }
  })
})
```

`worker/src/handle.test.ts`: az `acceptedRow`-ban és a `describe('handleCallback', …)` két beágyazott `JobRow`-literáljában a `phase: 'subtitle',`, a `noteUrl: null,` és a `noteNotified: false,` sor törlődik.

`worker/src/plan.test.ts`: a `row` függvényben ugyanez a három sor törlődik.

- [ ] **Step 2: A bukás ellenőrzése**

Run: `pnpm vitest run worker/src/reader.test.ts`
Expected: FAIL. A `vaultPath` `_summary.md` véget vár, és a lista a `noteUrl` alapján szűr.

- [ ] **Step 3: `worker/src/reader.ts`, az egész fájl**

```ts
import { findRow } from './handle.js'
import { GITHUB_DOWN, NO_NOTES, NOTE_MISSING, OPEN_ON_GITHUB, VAULT_LOCKED } from './messages.js'
import { runKinds } from './plan.js'
import type { JobStore, RunRow } from './store.js'

export interface ReaderDeps {
  store: JobStore
  vaultRepo: string
  vaultBranch: string
  vaultToken: string
}

const TRANSCRIPT_END = '_transcript.md'

const STYLE =
  ':root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1rem}' +
  'table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #8886;padding:.25rem .5rem;text-align:left;vertical-align:top}' +
  'img{max-width:100%}.anchor{display:none}'

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style><body>${body}</body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/** A fajta fájlja az átirat mellett: a `_transcript.md` vég cseréje. A fajtát a hívó a kész futásokból ellenőrzi. */
export function vaultPath(noteUrl: string, repo: string, branch: string, kind: string): string[] | null {
  const prefix = `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/`
  if (!noteUrl.startsWith(prefix)) return null
  try {
    const segments = noteUrl.slice(prefix.length).split('/').map((segment) => decodeURIComponent(segment))
    const last = segments.pop() ?? ''
    if (!last.endsWith(TRANSCRIPT_END)) return null
    return [...segments, `${last.slice(0, -TRANSCRIPT_END.length)}_${kind}.md`]
  } catch {
    return null
  }
}

function readyRuns(runs: readonly RunRow[]): RunRow[] {
  return runs.filter((run) => run.status === 'ready' && run.noteUrl !== null)
}

export async function notesPage(sub: string, deps: ReaderDeps): Promise<Response> {
  const rows = await deps.store.notesFor(sub)
  if (rows.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1><p>${NO_NOTES}</p>`)
  const items: string[] = []
  // ponytail: videónként egy runsFor-lekérés; egy fióknál néhány tucat sor, JOIN, ha a lista lassú lesz.
  for (const row of rows) {
    const kinds = [...new Set(readyRuns(await deps.store.runsFor(row.jobId)).flatMap(runKinds)), 'transcript']
    const links = kinds.map((kind) => `<a href="/notes/${escapeHtml(row.jobId)}/${escapeHtml(kind)}">${escapeHtml(kind)}</a>`).join(' · ')
    const day = row.acceptedAt === null ? '' : new Date(row.acceptedAt).toISOString().slice(0, 10)
    items.push(`<li>${escapeHtml(row.title ?? row.videoId)} · ${day} — ${links}</li>`)
  }
  return page('Jegyzetek', `<h1>Jegyzetek</h1><ul>${items.join('')}</ul>`)
}

export async function notePage(jobId: string, kind: string, sub: string, deps: ReaderDeps): Promise<Response> {
  const row = await findRow(deps.store, jobId)
  if (row === null || row.sub !== sub) return new Response(null, { status: 404 })
  const runs = readyRuns(await deps.store.runsFor(jobId))
  const run = kind === 'transcript' ? runs[0] : runs.find((item) => runKinds(item).includes(kind))
  if (run === undefined || run.noteUrl === null) return new Response(null, { status: 404 })
  const segments = vaultPath(run.noteUrl, deps.vaultRepo, deps.vaultBranch, kind)
  if (segments === null) return new Response(null, { status: 404 })
  const title = `${row.title ?? row.videoId} · ${kind}`
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/')
  const branch = encodeURIComponent(deps.vaultBranch)
  const url = `https://api.github.com/repos/${deps.vaultRepo}/contents/${path}?ref=${branch}`
  let line = GITHUB_DOWN
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github.html+json',
        authorization: `Bearer ${deps.vaultToken}`,
        'user-agent': 'transcript-refinery',
      },
    })
    if (response.ok) {
      const github = `https://github.com/${deps.vaultRepo}/blob/${branch}/${path}`
      const link = `<p><a href="${escapeHtml(github)}">${OPEN_ON_GITHUB}</a></p>`
      return page(title, `${link}${await response.text()}`)
    }
    if (response.status === 404) line = NOTE_MISSING
    if (response.status === 401 || response.status === 403) line = VAULT_LOCKED
  } catch {
    // Hálózati hiba: a GITHUB_DOWN marad.
  }
  return page(title, `<p>${line}</p>`, 502)
}
```

- [ ] **Step 4: `worker/src/store.ts`**

- `export type JobPhase = 'subtitle' | 'summary'` törlődik.
- A `JobRow`-ból a `phase: JobPhase`, a `noteUrl: string | null` és a `noteNotified: boolean` mező törlődik.
- A `memoryStore` `notesFor` hívása:

```ts
    notesFor: (sub) =>
      Promise.resolve(
        rows
          .filter((row) => row.sub === sub && runs.some((run) => run.jobId === row.jobId && run.status === 'ready'))
          .sort((a, b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0)),
      ),
```

- [ ] **Step 5: `worker/src/d1.ts`**

- A `JobRecord`-ból a `phase`, a `note_url` és a `note_notified` mező, a `toRow`-ból a `phase`, a `noteUrl` és a `noteNotified` sor törlődik.
- Az `insert`:

```ts
    async insert(row) {
      await db
        .prepare(
          `INSERT INTO jobs (
            job_id, update_id, chat_id, message_id, video_id, url, status, error, title,
            notified_ready, accepted_at, sub
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.jobId,
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
        )
        .run()
    },
```

- A `save`:

```ts
    async save(row) {
      await db
        .prepare(
          `UPDATE jobs SET
            update_id = ?, chat_id = ?, message_id = ?, video_id = ?, url = ?, status = ?,
            error = ?, title = ?, notified_ready = ?, accepted_at = ?, sub = ?
          WHERE job_id = ?`,
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
    },
```

- A `notesFor`:

```ts
    async notesFor(sub) {
      const result = await db
        .prepare(
          `SELECT * FROM jobs WHERE sub = ? AND job_id IN (SELECT job_id FROM runs WHERE status = 'ready')
           ORDER BY accepted_at DESC`,
        )
        .bind(sub)
        .all<JobRecord>()
      return result.results.map(toRow)
    },
```

A `jobs` tábla `phase`, `note_url` és `note_notified` oszlopa marad: a D1-en a `DROP COLUMN` felesleges kockázat, és az új sor a régi alapértéket kapja.

- [ ] **Step 6: `worker/src/handle.ts`**

A `handleUpdate` `const row: JobRow = { … }` literáljából a `phase: 'subtitle',`, a `noteUrl: null,` és a `noteNotified: false,` sor törlődik.

- [ ] **Step 7: A teszt zöld**

Run: `pnpm vitest run worker`
Expected: PASS.

- [ ] **Step 8: Ellenőrzés és commit**

Run: `pnpm test && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`

```bash
git add worker/src
git commit -m "feat(worker): Open every finished note kind in the reader"
```

---

### Task 6: Leírás

**Files:**
- Modify: `docs/operations/telegram-worker-topology.md` (a „Kész jegyzet” sor)
- Modify: `docs/plans/2026-10-04-telegram-cloudflare-brief.md` (a „Receptválasztás” állapotsora)

- [ ] **Step 1: A topológia leírása**

A `docs/operations/telegram-worker-topology.md` `- **Kész jegyzet** (a `summary` gomb után): …` kezdetű sora helyére:

```markdown
- **Receptgombok** (a felirat kész üzenete alatt): `summary`, `notes`, `qa`, `flashcards`, `bloom`, `clean-mild`, `clean-moderate`, `clean-deep` és `fordítás`. Egy koppintás egy recept, egy futás a konténer `cost_limit_usd` plafonja alatt. A `fordítás` a videó kész jegyzeteit kínálja kapcsolható gombként, a `tovább` után a hét nyelvből (`en`, `hu`, `nl`, `de`, `es`, `fr`, `it`) egyet. A kért jegyzetek egy futásban, egy közös plafon alatt készülnek. A receptenkénti állapot a D1 `runs` táblájában van.
- **Kész jegyzet:** `<cím> · <recept>. A jegyzet megvan.`, fordításnál `<cím> · <nyelv>. A fordítás megvan.`, és jegyzetenként egy sor: `https://<worker>/notes/<jobId>/<fajta>` (például `notes`, `summary-de`). Az oldal Cloudflare Access mögött van, és a jegyzetet a vault-repóból, a GitHub renderelt HTML-jével mutatja. A `/notes/<jobId>/transcript` a hozzá tartozó `_transcript.md`. A `https://<worker>/notes` a belépett fiók jegyzeteinek listája, videónként a kész fajtákkal. A bot csak privát chatben válaszol.
```

- [ ] **Step 2: A brief állapotsora**

A `docs/plans/2026-10-04-telegram-cloudflare-brief.md` `**Állapot:** javaslat, 2026-10-04. A brainstorming ne vegye lezártnak.` sora helyére:

```markdown
**Állapot:** lezárva 2026-10-08-án: csak gombbal, receptnév gépelése nélkül. Lásd [`2026-10-08-telegram-receptek-spec.md`](./2026-10-08-telegram-receptek-spec.md). Az alábbi javaslat a döntés előzménye.
```

- [ ] **Step 3: Commit**

Run: `pnpm lint`

```bash
git add docs/operations/telegram-worker-topology.md docs/plans/2026-10-04-telegram-cloudflare-brief.md
git commit -m "docs(worker): Describe the recipe buttons and translation"
```

---

### Task 7: Élesítés (kézi, minden lépés a felhasználó jóváhagyásával)

Kifelé ható lépések. Mindegyik előtt szólj, és várd meg az igent. A kód-PR merge-e és a kiadás (`chore/release-v1.12.0`, changelog, tag) után.

A sorrend számít. A régi Worker a régi `recipe` mezőt küldi, amit az új konténer `400`-zal elutasít. Ha a migráció és az új Worker között valaki a régi `summary` gombra koppint, a sor `summary` fázisban ragad. **A 2–4. lépés alatt ne koppints a botban.**

- [ ] **Step 1: Konténerkép.** `pnpm docker:publish`. Utána a `peter-mba`-n a `~/homelab/services/refinery/docker-compose.yml` `image:` sora `ghcr.io/pcsontos/transcript-refinery:1.12.0` lesz (ma `1.9.0`), és `ssh peter-mba 'cd ~/homelab/services/refinery && docker compose pull && docker compose up -d'`. Ellenőrzés: `ssh peter-mba 'docker logs --tail 5 homelab-refinery'` a `[serve] Refinery daemon elindult` sort mutatja.
- [ ] **Step 2: Migráció.** `pnpm worker:migrate`. Ellenőrzés: `npx wrangler d1 execute transcript-refinery --remote --config worker/wrangler.toml --command "SELECT run_id, status, note_url FROM runs"` a korábbi summary-jegyzetek sorait mutatja, `_transcript.md`-re végződő `note_url`-lel.
- [ ] **Step 3: Worker.** `pnpm worker:deploy`.
- [ ] **Step 4: A régi jegyzetek.** A `https://<worker>/notes` lista a korábbi videókat mutatja, a régi `/notes/<jobId>/summary` link a summaryt nyitja.
- [ ] **Step 5: A siker.** Telegramon egy rövid YouTube-cím. A „felirat megvan” üzenet alatt kilenc gomb. A `notes` gomb után „Sorba került: notes”, majd „<cím> · notes. A jegyzet megvan.” és a link, ami a jegyzetet nyitja. A `fordítás` után a választóban a `notes`, ✓-val kijelölve, `tovább`, `de`. Utána „Sorba került: notes → de”, majd a fordítás linkje. A `/notes` listában a videó sorában `notes · notes-de · transcript`. A becsült költés néhány tized dollár, a plafon 5 $.

Ha a gombra nem jön válasz, a `npx wrangler tail --config worker/wrangler.toml` és a `ssh peter-mba 'docker logs -f homelab-refinery'` mutatja, hol akad el. A `[serve] 400 Nem érvényes ServeJob body` sor azt jelenti, hogy a Worker még a régi.
