# Verzió, súgó, indulási üzenet, `/notes` csoportosítás, `serve --config` — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `serve` lekérdezhetően mondja meg, él-e és melyik verzió fut, és tiszteletben tartja a `--config` kapcsolót. A CLI parancsonkénti súgót és `version` parancsot kap. A bot szól, amikor egy receptfuttatás ténylegesen elindul. A `/notes` oldalon egy videó egyszer szerepel, alatta az összes kész fajtával.

**Architecture:** A `serve` HTTP-kezelője három GET útvonalat kap a `POST /jobs` mellé. A `commandServe` argv-t is kap, és a megadott `--config` utat indításkor betölti, majd a receptfuttatásnak is továbbadja. A súgó egy új `src/help.ts` parancsleíró táblázatából készül, ezt a `main()` és a `fetch` is használja. A Worker `settle()`-je receptfuttatás 202-es elfogadásakor egy indulási üzenetet küld; a `notesPage` `videoId` szerint csoportosít.

**Tech Stack:** TypeScript, Vitest, Node (`node:http`, `node:util` `parseArgs`), Cloudflare Worker. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-09-serve-sugo-notes-spec.md`

Az implementáció a `feat/kor-177-182-cli-serve-telegram` ágon indul a friss `main`-ről, miután ez a terv (a `docs/kor-177-182-cli-serve-telegram` ágon) bekerült. Issue-k: #177, #178, #179, #181, #182.

## Global Constraints

- Mondatok, szó szerint:
  - `Hibás konfiguráció: <a hiba első sora>` (serve, hibás `--config`)
  - `Ismeretlen parancs: <név>` (help és ismeretlen parancs)
  - `Elkezdődött a feldolgozás: <runLabel>. Hamarosan jelzem az eredményt.` — a `runLabel` a meglévő formázó: `summary`, `summary, notes → de`
  - `Részletek: refinery help <parancs>` (az áttekintés utolsó sora)
- Végpontok: `GET /ping` → `200`, `text/plain; charset=utf-8`, törzs `ok`. `GET /version` → `200`, `application/json`, `{"version":"<VERSION>"}`. `GET /status` → Bearer `REFINERY_SERVE_SECRET`, `200`, `application/json`, `{"version":"<VERSION>","busy":<jobId vagy null>}`; rossz vagy hiányzó titokkal `401`.
- A verzió mindenhol a `src/meta.ts` `VERSION` konstansa.
- Kilépési kódok: paraméter nélküli `refinery` → 1; `refinery help`, `--help`, `-h`, parancsonkénti súgó, `version`, `--version` → 0; `refinery help <ismeretlen>` → 1; `serve` ismeretlen kapcsolóval vagy hibás `--config`-gal → 1.
- A `--help`/`-h` elsőbbséget élvez a `--version`-nel szemben, a `--version` pedig bármely parancs futtatásával szemben. Egyik sem tölt be configot.
- `--config` nélkül a `serve` viselkedése a mai marad (munkakönyvtárbeli config, csendes visszaesés a nyelveknél `['hu', 'en']`-re).
- A fajták sorrendje a `/notes` oldalon: a `RECIPES` sorrendje, minden recept után a fordításai a `LANGS` sorrendjében, utána az ismeretlen fajták ábécérendben, végül a `transcript`.
- A teszt nem éri el a GitHubot, a Telegramot, az R2-t és a Cloudflare-t; a CLI-tesztek nem indíthatnak `run`-t (a repó gyökerében valódi `refinery.config.yaml` van!).
- Minden feladat végén: `pnpm test` zöld, `pnpm typecheck` és `pnpm exec tsc -p worker/tsconfig.json` hibátlan, `pnpm lint` hibátlan.

## Review Focus

1. `refinery list --version` (vagy bármely parancs `--version`-nel): a verziót írja ki, és nem tölt be configot, nem futtat semmit. (3. feladat, `cli.test.ts`.)
2. `GET /status` `Authorization` fejléc nélkül: `401`, nem kivétel, és a `busy` értéke nem szivárog ki. (1. feladat, `http.test.ts`.)
3. A cron 15 perc után újrakopogtatja a már `accepted` futást, és a `serve` megint 202-t ad: nem mehet második „Elkezdődött” üzenet. (4. feladat, `handle.test.ts`.)
4. `serve --config` nem létező fájlra: a szerver el sem indul, és a receptfuttatás `load`-ja is a megadott utat tölti be, nem a munkakönyvtárét. (2. feladat, `command.test.ts`.)
5. A `/notes` oldalon a YouTube-cím `&`-et tartalmaz (`watch?v=…&t=1`): escape-elve kerül az attribútumba; és ugyanaz a fajta két jobban is kész: a link a legfrissebbre mutat. (5. feladat, `reader.test.ts`.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/serve/http.ts` | `/ping`, `/version`, `/status` útvonalak; `createServeServer` `version` bemenete |
| `src/serve/command.ts` | `commandServe(argv, env)`: `--config` beolvasása és betöltése; `serveEffects` `configArg`-ja a receptfuttatás `load`-jához |
| `src/help.ts` (új) | Parancsleíró táblázat, `overview()`, `helpText(name)` |
| `src/cli.ts` | `main()`: súgó, verzió, `serve` argv-továbbadás; a `USAGE` megszűnik |
| `src/fetch/command.ts` | A saját `USAGE` helyett `helpText('fetch subtitle')` |
| `worker/src/messages.ts`, `worker/src/plan.ts` | `runStartedLine` és re-exportja |
| `worker/src/handle.ts` | `settle()` indulási üzenete receptfuttatásra (`applyKnocks` és `handleCron`) |
| `worker/src/reader.ts` | `notesPage` videónkénti csoportosítása |
| `README.md` | A `serve` végpontjai és `--config`-ja, a súgó |

---

### Task 1: `serve` végpontok (#177)

**Files:**
- Modify: `src/serve/http.ts`
- Modify: `src/serve/command.ts` (a `createServeServer` hívása)
- Test: `src/serve/http.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `VERSION` (`src/meta.ts`), meglévő `authorized`, `ServeGate`.
- Produces: `createServeServer(input: ServeServerInput): Server`, ahol `interface ServeServerInput { secret: string; gate: ServeGate; version: string; onJob: (job: ServeJob) => Promise<void> }`.

- [ ] **Step 1: A meglévő tesztek `version`-t kapnak, és új teszt az útvonalakra**

A `src/serve/http.test.ts` két meglévő `createServeServer({...})` hívásába tegyél `version: '9.9.9',` sort a `gate,` után. Az importsorba vedd fel a `vi`-t: `import { afterEach, describe, expect, it, vi } from 'vitest'`. A `describe('createServeServer', …)` blokk végére (a második `it` után, a blokk záró `})` elé) írd:

```ts
  it('a /ping és a /version titok nélkül válaszol, a /status csak titokkal, a busy a futó job', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server = createServeServer({ secret: 'titok', gate, version: '9.9.9', onJob: () => held })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${port}`

    const ping = await fetch(`${base}/ping`)
    expect(ping.status).toBe(200)
    expect(ping.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await ping.text()).toBe('ok')

    const version = await fetch(`${base}/version`)
    expect(version.status).toBe(200)
    expect(version.headers.get('content-type')).toBe('application/json')
    expect(await version.json()).toEqual({ version: '9.9.9' })

    const status = (secret?: string) =>
      fetch(`${base}/status`, secret === undefined ? {} : { headers: { authorization: `Bearer ${secret}` } })
    const anonymous = await status()
    expect(anonymous.status).toBe(401)
    expect(await anonymous.text()).toBe('')
    expect((await status('rossz')).status).toBe(401)
    const idle = await status('titok')
    expect(idle.status).toBe(200)
    expect(idle.headers.get('content-type')).toBe('application/json')
    expect(await idle.json()).toEqual({ version: '9.9.9', busy: null })

    const job = { jobId: 'job-1', videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' }
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await (await status('titok')).json()).toEqual({ version: '9.9.9', busy: 'job-1' })
    release()
    await vi.waitFor(async () => {
      expect(await (await status('titok')).json()).toEqual({ version: '9.9.9', busy: null })
    })

    expect((await fetch(`${base}/ismeretlen`)).status).toBe(404)
    expect((await fetch(`${base}/ping`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/jobs`)).status).toBe(404)
  })
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `pnpm exec vitest run src/serve/http.test.ts`
Expected: FAIL — a `/ping` 404-et ad 200 helyett (és a typecheck a `version` mezőt még nem ismeri).

- [ ] **Step 3: Implementáció a `src/serve/http.ts`-ben**

A `send` függvény után add hozzá:

```ts
function sendBody(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { 'content-type': contentType })
  response.end(body)
}

function rejectUnauthorized(request: IncomingMessage, response: ServerResponse): void {
  const rawIp = request.headers['x-forwarded-for'] ?? request.socket.remoteAddress
  const clientIp = Array.isArray(rawIp) ? rawIp[0] : (rawIp ?? 'unknown')
  console.warn(`[serve] 401 Jogosulatlan kérés: ${clientIp}`)
  send(response, 401)
}

export interface ServeServerInput {
  secret: string
  gate: ServeGate
  version: string
  onJob: (job: ServeJob) => Promise<void>
}
```

A `createServeServer` és a `handle` fejlécét cseréld erre (a törzsük eleje változik):

```ts
export function createServeServer(input: ServeServerInput): Server {
  return createServer((request, response) => {
    void handle(request, response, input)
  })
}

async function handle(request: IncomingMessage, response: ServerResponse, input: ServeServerInput): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && path === '/ping') {
    sendBody(response, 200, 'text/plain; charset=utf-8', 'ok')
    return
  }
  if (request.method === 'GET' && path === '/version') {
    sendBody(response, 200, 'application/json', JSON.stringify({ version: input.version }))
    return
  }
  if (request.method === 'GET' && path === '/status') {
    if (!authorized(request.headers.authorization, input.secret)) {
      rejectUnauthorized(request, response)
      return
    }
    sendBody(response, 200, 'application/json', JSON.stringify({ version: input.version, busy: input.gate.current }))
    return
  }
  if (request.method !== 'POST' || path !== '/jobs') {
    send(response, 404)
    return
  }
  if (!authorized(request.headers.authorization, input.secret)) {
    rejectUnauthorized(request, response)
    return
  }
```

A `handle` többi része (a `let body: unknown` sortól) változatlan. A régi, inline 401-naplózó blokk törlődik (a `rejectUnauthorized` váltja).

- [ ] **Step 4: A `commandServe` átadja a verziót**

`src/serve/command.ts`: az importok közé:

```ts
import { VERSION } from '../meta.js'
```

és a `createServeServer({` hívásban a `gate,` sor után:

```ts
    version: VERSION,
```

- [ ] **Step 5: README**

`README.md`, a „A `refinery serve` egy videó feliratát és `info.json` fájlját az R2-be tölti. A Telegram-ajtó a `worker/` csomag.” bekezdés után új bekezdés:

```markdown
A `serve` három lekérdező végpontot is ad: a `GET /ping` és a `GET /version`
hitelesítés nélkül válaszol (`ok`, illetve `{"version": …}`), a `GET /status`
a `REFINERY_SERVE_SECRET` Bearer-tokenjével a verziót és az éppen futó munka
azonosítóját adja (`{"version": …, "busy": <jobId> | null}`).
```

- [ ] **Step 6: Ellenőrzés**

Run: `pnpm exec vitest run src/serve/http.test.ts src/serve/command.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, hibátlan typecheck és lint.

Mutációs próba: a `/status` ágban kommenteld ki az `authorized`-ellenőrzést → a tesztnek el kell buknia (`anonymous.status` 200). Állítsd vissza.

- [ ] **Step 7: Commit**

```bash
git add src/serve/http.ts src/serve/command.ts src/serve/http.test.ts README.md
git commit -m "feat(serve): Add ping, version and status endpoints"
```

---

### Task 2: `serve --config` (#182)

**Files:**
- Modify: `src/serve/command.ts`
- Modify: `src/serve/summary.ts:42` (a `firstLine` exportja)
- Modify: `src/cli.ts:929` (a `serve` elágazás)
- Test: `src/serve/command.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `loadCliConfig(configArg, cwd?)` (`src/config.ts`), `firstLine(text: string): string` (`src/serve/summary.ts`, ebben a feladatban exportálva), `runRecipes` `load?: () => Promise<{ cfg: Config; raw: unknown }>` paramétere (`src/serve/summary.ts`, már létezik).
- Produces: `commandServe(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number>`; `serveEffects({ …, configArg?: string })`, amely a `refine`-nál mindig `load: () => loadCliConfig(configArg)`-ot ad a `runRecipes`-nek (`undefined`-dal ez a munkakönyvtár configja, mint a `runRecipes` alapértéke).

- [ ] **Step 1: Failing tesztek**

`src/serve/command.test.ts`: az első sor importja legyen `import { mkdtemp, rm } from 'node:fs/promises'` (változatlan), a vitest-import:

```ts
import { describe, expect, it, vi } from 'vitest'
```

A meglévő `commandServe({})` hívás legyen `commandServe([], {})`, a második teszté `commandServe([], { … })` (az env-objektum változatlan). A fájl elején, a `fakeStore` után:

```ts
const FULL_ENV = {
  REFINERY_SERVE_SECRET: 'test-secret',
  WORKER_CALLBACK_URL: 'http://localhost',
  SERVE_OUT: '/tmp',
  SERVE_PORT: '8799',
  R2_ACCOUNT_ID: 'acc',
  R2_BUCKET: 'bkt',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'sec',
}
```

A meglévő „a recept hatás a SERVE_OUT mappát…” tesztben az `expect(seen).toEqual(…)` legyen `expect(seen).toMatchObject(…)` (ugyanazzal az elvárt tömbbel): a `refine` mostantól mindig ad egy `load` függvényt is.

A `describe` blokk végére:

```ts
  it('ismeretlen kapcsolóval és pozicionális argumentummal 1, a szerver nem indul', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await commandServe(['--port', '1'], FULL_ENV)).toBe(1)
      expect(await commandServe(['valami'], FULL_ENV)).toBe(1)
      expect(errorSpy).toHaveBeenCalledTimes(2)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('nem betölthető --config esetén Hibás konfiguráció és 1, a szerver nem indul', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await commandServe(['--config', '/nincs/ilyen/refinery.config.yaml'], FULL_ENV)).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith('Hibás konfiguráció: Nincs konfigurációs fájl: /nincs/ilyen/refinery.config.yaml')
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Refinery daemon elindult'))
    } finally {
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('megadott configArg mellett a receptfuttatás a megadott utat tölti be', async () => {
    const seen: { load?: () => Promise<unknown> }[] = []
    const effects = serveEffects({
      outDir: '/tmp',
      languages: ['hu'],
      store: fakeStore,
      fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      callback: () => Promise.resolve(),
      configArg: '/nincs/ilyen/refinery.config.yaml',
      runRecipes: (input) => {
        seen.push(input)
        return Promise.resolve({ ok: true, noteUrl: 'x' })
      },
    })
    await effects.refine('abcdefghijk', ['summary'])
    const load = seen[0]?.load
    expect(load).toBeTypeOf('function')
    // A repó gyökerében van refinery.config.yaml: ha a load a munkakönyvtárét
    // töltené, nem bukna el.
    await expect(load?.()).rejects.toThrow('Nincs konfigurációs fájl: /nincs/ilyen/refinery.config.yaml')
  })
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `pnpm exec vitest run src/serve/command.test.ts`
Expected: FAIL — a `commandServe` két argumentumot még nem fogad (a `['--port', '1']` futás a szervert indítaná: a teszt itt timeoutolhat, ez is FAIL), a `configArg`-os tesztben a `load` `undefined`.

- [ ] **Step 3: Implementáció a `src/serve/command.ts`-ben**

`src/serve/summary.ts:42`: a `function firstLine(text: string)` elé `export` kerül (a törzse változatlan).

Importok (a meglévők mellé):

```ts
import { parseArgs } from 'node:util'
import { loadCliConfig, type Config } from '../config.js'
```

(a régi `import { loadCliConfig } from '../config.js'` sor helyett), és a `./summary.js` import:

```ts
import { firstLine, runRecipes as defaultRunRecipes } from './summary.js'
```

A `RecipesRun` típus:

```ts
type RecipesRun = (input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
  load?: () => Promise<{ cfg: Config; raw: unknown }>
}) => Promise<RecipesOutcome>
```

A `serveEffects` bemenete kap egy mezőt a `runRecipes?: RecipesRun` után:

```ts
  configArg?: string
```

és a `refine` sora:

```ts
    refine: (videoId, recipes, lang) =>
      refineWith({ videoId, outDir: input.outDir, recipes, lang, load: () => loadCliConfig(input.configArg) }),
```

A `commandServe` fejléce és eleje:

```ts
export async function commandServe(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let configArg: string | undefined
  try {
    const { values } = parseArgs({ args: [...argv], options: { config: { type: 'string' } }, allowPositionals: false })
    configArg = values.config
  } catch (cause) {
    console.error(`${(cause as Error).message}\nSúgó: refinery help serve`)
    return 1
  }
  const error = missing(env)
```

A nyelvek kiválasztása (a `let languages…` blokk teljes cseréje):

```ts
  // A --config nélküli hiba csendes: dedikált serve konténerben nincs refinery.config.yaml.
  let configLanguages: readonly string[] = []
  try {
    configLanguages = (await loadCliConfig(configArg)).cfg.languages
  } catch (cause) {
    if (configArg !== undefined) {
      console.error(`Hibás konfiguráció: ${firstLine(cause instanceof Error ? cause.message : String(cause))}`)
      return 1
    }
  }
  const fromEnv = env.REFINERY_SUB_LANG?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  const languages: readonly string[] =
    fromEnv.length > 0 ? fromEnv : configLanguages.length > 0 ? configLanguages : ['hu', 'en']
```

A `serveEffects({` hívásban az `outDir,` után:

```ts
    configArg,
```

Megjegyzés: a `--config` betöltése a `missing(env)` és a `SERVE_PORT`-ellenőrzés **után** fut (a fenti blokk a `SERVE_PORT`-ellenőrzés után áll, ahol ma a `let languages` volt). A config mostantól akkor is betöltődik, ha a `REFINERY_SUB_LANG` meg van adva (ma ilyenkor nem); a mellette lévő `.env` a már beállított környezeti változókat nem írja felül.

- [ ] **Step 4: A `main()` átadja az argv-t**

`src/cli.ts`, a `serve` elágazás:

```ts
  if (command === 'serve') return commandServe(argv.slice(1), process.env)
```

- [ ] **Step 5: README**

A Task 1-ben írt végpont-bekezdés után:

```markdown
A `refinery serve --config <út>` a megadott konfigurációt használja a
feliratnyelvekhez és a receptfuttatásokhoz is; ha a fájl nem tölthető be, a
`serve` el sem indul. A `--config` nélkül a munkakönyvtár
`refinery.config.yaml`-ja érvényes, ha van.
```

- [ ] **Step 6: Ellenőrzés**

Run: `pnpm exec vitest run src/serve && pnpm typecheck && pnpm lint`
Expected: PASS, hibátlan.

Mutációs próba: a `refine`-ban a `loadCliConfig(input.configArg)`-ot írd `loadCliConfig(undefined)`-ra → a „megadott configArg mellett…” tesztnek el kell buknia. Állítsd vissza.

- [ ] **Step 7: Commit**

```bash
git add src/serve/command.ts src/serve/summary.ts src/serve/command.test.ts src/cli.ts README.md
git commit -m "fix(serve): Honour --config and fail fast on a broken file"
```

---

### Task 3: Verzió és parancsonkénti súgó (#177, #178)

**Files:**
- Create: `src/help.ts`
- Modify: `src/cli.ts` (a `USAGE` törlése, `main()` eleje és vége)
- Modify: `src/fetch/command.ts` (a saját `USAGE` törlése)
- Test: `src/cli.test.ts`, `src/cli.entrypoint.test.ts`, `src/serve/http.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `VERSION` (`src/meta.ts`).
- Produces (`src/help.ts`):
  - `interface CommandHelp { name: string; summary: string; usage: string; description: string; options: readonly (readonly [string, string])[]; examples: readonly string[] }`
  - `const COMMANDS: readonly CommandHelp[]`
  - `function overview(): string`
  - `function helpText(name: string): string | undefined`

- [ ] **Step 1: A `src/help.ts` létrehozása**

```ts
/**
 * A CLI súgója. Ebből a táblázatból készül az áttekintés (`refinery help`) és
 * a parancsonkénti súgó (`refinery help <parancs>`, `refinery <parancs> --help`),
 * így a kettő nem csúszhat el egymástól.
 */
export interface CommandHelp {
  name: string
  summary: string
  usage: string
  description: string
  options: readonly (readonly [string, string])[]
  examples: readonly string[]
}

const CONFIG = ['--config <út>', 'konfigurációs fájl (alapértelmezés: refinery.config.yaml)'] as const
const HELP = ['--help, -h', 'megjeleníti ezt a súgót'] as const
const SOURCE = ['--source <név>', 'csak a megadott forrásmappából'] as const
const CHANNEL = ['--channel <név>', 'csak a megadott csatorna (metaadat nélküli elemre nem illik)'] as const
const LIMIT = ['--limit <szám>', 'legfeljebb ennyi elem'] as const
const NO_COMMIT = ['--no-commit', 'nem commitol és nem pushol a vault repójába'] as const

export const COMMANDS: readonly CommandHelp[] = [
  {
    name: 'scan',
    summary: 'Felderíti a feldolgozható videókat, és nem ír semmit.',
    usage: 'refinery scan [kapcsolók]',
    description:
      'Felderíti a forrásmappák feldolgozható videóit, és kiírja őket.\n' +
      'A --queue mellett a vault _queue.md sorába fésüli az új tételeket.',
    options: [
      CONFIG,
      ['--queue', 'a vault _queue.md sorába fésül'],
      ['--dry-run', '--queue mellett: nem írja a sort, csak kiírja a változást'],
      ['--no-commit', '--queue mellett: nem commitol és nem pushol a vault repójába'],
      HELP,
    ],
    examples: ['refinery scan', 'refinery scan --queue --dry-run'],
  },
  {
    name: 'run',
    summary: 'Átiratot készít és a vaultba írja.',
    usage: 'refinery run [kapcsolók]',
    description:
      'Átiratot készít a feldolgozható videókból, és a vaultba írja.\n' +
      'A --recipe receptet is futtat; a --queue a vault _queue.md sorának kipipált párjait dolgozza fel.',
    options: [
      CONFIG,
      SOURCE,
      CHANNEL,
      LIMIT,
      ['--recipe <id>', 'receptet is futtat (pl. summary); enélkül csak átirat'],
      ['--queue', 'a sor kipipált (videó, recept) párjait dolgozza fel'],
      ['--dry-run', 'nem ír fájlt és nem rögzít állapotot; recepttel a modellhívások VALÓS költséggel megtörténnek'],
      [
        '--force',
        'létező fájlt is felülír; --queue mellett a sor minden kipipált párját, a késznek jelölteket is újrafuttatja',
      ],
      NO_COMMIT,
      ['--retry-failed', 'csak a korábban hibára futott elemek'],
      ['--no-judge', 'a bíró pontozói nem futnak (a determinisztikus kapuk igen); felülírja a model.judge_enabled beállítást'],
      HELP,
    ],
    examples: ['refinery run --limit 3', 'refinery run --recipe summary --limit 1', 'refinery run --queue'],
  },
  {
    name: 'check-pricing',
    summary: 'Összeveti a config árazását a LiteLLM élő áraival.',
    usage: 'refinery check-pricing [kapcsolók]',
    description: 'Összeveti a konfiguráció modellárazását a LiteLLM élő áraival, és kiírja az eltéréseket.',
    options: [CONFIG, ['--fix', 'a talált árazási eltéréseket visszaírja a konfigurációs fájlba'], HELP],
    examples: ['refinery check-pricing', 'refinery check-pricing --fix'],
  },
  {
    name: 'list',
    summary: 'Kilistázza az elemeket típusonkénti állapottal; nem ír semmit.',
    usage: 'refinery list [kapcsolók]',
    description: 'Kilistázza a feldolgozott elemeket típusonkénti állapottal. Nem ír semmit.',
    options: [
      CONFIG,
      SOURCE,
      CHANNEL,
      ['--recipe <id>', 'csak ennek a típusnak az állapota'],
      ['--status <érték>', 'done, failed vagy pending; --recipe nélkül bármely típusra illik'],
      ['--channels', 'csatornánkénti összesítő'],
      LIMIT,
      HELP,
    ],
    examples: ['refinery list --status failed', 'refinery list --channels'],
  },
  {
    name: 'fetch subtitle',
    summary: 'YouTube-feliratot és .info.json fájlt tölt egy mappába.',
    usage:
      'refinery fetch subtitle <url|id> [kapcsolók]\n' + '           refinery fetch subtitle --list <fájl> [kapcsolók]',
    description:
      'YouTube-feliratot és .info.json metaadatot tölt egy helyi mappába a yt-dlp segítségével.\n' +
      'Ami már ott van, azt átugorja. A run és a watch nem hívja.',
    options: [
      ['--out <út>', 'célmappa, abszolút; hiányában a config első sources eleme'],
      ['--list <fájl>', 'soronkénti címek; a # sor és az üres sor kimarad'],
      ['--sub-lang <kód>', 'vesszős nyelvkódok; alap a config languages, vagy hu,en'],
      ['--sub-format <f>', 'vtt és srt, vesszővel; alap: vtt,srt'],
      ['--overwrite', 'meglévő felirat és .info.json újraírása'],
      ['--flat', 'minden fájl az --out gyökerébe'],
      ['--playlist-items <elemek>', 'lista szűrése, a yt-dlp -I értékeként'],
      ['--yes-playlist', 'a watch?v=&list= cím a teljes listát jelenti'],
      CONFIG,
      HELP,
    ],
    examples: [
      'refinery fetch subtitle https://www.youtube.com/watch?v=<id>',
      'refinery fetch subtitle --list videok.txt --out /abs/mappa',
    ],
  },
  {
    name: 'serve',
    summary: 'A Worker munkáit fogadó démon: felirat az R2-be, receptek a vaultba.',
    usage: 'refinery serve [kapcsolók]',
    description:
      'A Worker POST /jobs kéréseit fogadja: a videó feliratát és info.json fájlját az R2-be tölti,\n' +
      'a receptfuttatások jegyzeteit a vaultba írja.\n' +
      'Végpontok: GET /ping és GET /version hitelesítés nélkül, GET /status a REFINERY_SERVE_SECRET Bearer-tokenjével.\n' +
      '\n' +
      'Kötelező környezeti változók: REFINERY_SERVE_SECRET, WORKER_CALLBACK_URL, SERVE_OUT,\n' +
      '  R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\n' +
      'Opcionális: SERVE_PORT (alap: 8787), SERVE_HOST (alap: 127.0.0.1), REFINERY_SUB_LANG',
    options: [
      ['--config <út>', 'konfigurációs fájl; ha meg van adva és nem tölthető be, a serve el sem indul'],
      HELP,
    ],
    examples: ['refinery serve', 'refinery serve --config /abs/refinery.config.yaml'],
  },
  {
    name: 'watch',
    summary: 'Figyeli a forrásmappákat; az új feliratból átirat és _queue.md-sor lesz.',
    usage: 'refinery watch [kapcsolók]',
    description:
      'Figyeli a forrásmappákat: az új feliratból átirat és _queue.md-sor lesz; modellt nem hív.\n' +
      'Leállítás: Ctrl+C. Csak az itt felsorolt kapcsolókat ismeri.',
    options: [CONFIG, ['--source <név>', 'csak a megadott forrásmappát figyeli'], NO_COMMIT, HELP],
    examples: ['refinery watch', 'refinery watch --no-commit'],
  },
  {
    name: 'version',
    summary: 'Kiírja a verziószámot.',
    usage: 'refinery version',
    description: 'Kiírja a refinery verziószámát. Ugyanezt adja a --version kapcsoló bármely parancs mellett.',
    options: [HELP],
    examples: ['refinery version', 'refinery --version'],
  },
  {
    name: 'help',
    summary: 'Súgó: áttekintés vagy egy parancs részletei.',
    usage: 'refinery help [parancs]',
    description:
      'Paraméter nélkül a parancsok áttekintését adja, paraméterrel az adott parancs súgóját.\n' +
      'Ugyanezt adja a refinery <parancs> --help.',
    options: [],
    examples: ['refinery help run', 'refinery help fetch subtitle'],
  },
]

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([left]) => left.length)) + 2
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`)
}

export function overview(): string {
  return [
    'refinery <parancs> [kapcsolók]',
    '',
    'Parancsok:',
    ...table(COMMANDS.map((command) => [command.name, command.summary] as const)),
    '',
    'Általános kapcsolók:',
    ...table([HELP, ['--version', 'kiírja a verziószámot']]),
    '',
    'Részletek: refinery help <parancs>',
  ].join('\n')
}

export function helpText(name: string): string | undefined {
  const command = COMMANDS.find((item) => item.name === name)
  if (command === undefined) return undefined
  const lines = [`Használat: ${command.usage}`, '', command.description]
  if (command.options.length > 0) lines.push('', 'Kapcsolók:', ...table(command.options))
  lines.push('', 'Példák:', ...command.examples.map((example) => `  ${example}`))
  return lines.join('\n')
}
```

- [ ] **Step 2: A tesztek átírása és az újak (failing)**

`src/cli.test.ts`:

- Az import-listából (14. sor körül) töröld a `USAGE,` sort. A fájl importjai közé:

```ts
import { COMMANDS, helpText, overview } from './help.js'
import { VERSION } from './meta.js'
```

(Ha a `VERSION` már importálva van, ne duplikáld.)

- A `describe('main és súgó', …)` első tesztjét (`'a USAGE tartalmazza az összes új kapcsolót (--no-judge, --fix, --help)'`) cseréld erre:

```ts
  it('az áttekintés minden parancsot felsorol, és a súgóra és a verzióra utal', () => {
    const text = overview()
    for (const command of COMMANDS) expect(text).toContain(`  ${command.name} `)
    expect(text).toContain('--help, -h')
    expect(text).toContain('--version')
    expect(text.endsWith('Részletek: refinery help <parancs>')).toBe(true)
  })
```

- A `'a main([]) 1-gyel tér vissza és kiírja a súgót'` tesztben a `expect(logSpy).toHaveBeenCalledWith(USAGE)` legyen `expect(logSpy).toHaveBeenCalledWith(overview())`.

- A `describe('main és súgó', …)` blokk végére:

```ts
  const OPTIONS: Record<string, string[]> = {
    scan: ['--config', '--queue', '--dry-run', '--no-commit'],
    run: [
      '--config',
      '--source',
      '--channel',
      '--limit',
      '--recipe',
      '--queue',
      '--dry-run',
      '--force',
      '--no-commit',
      '--retry-failed',
      '--no-judge',
    ],
    'check-pricing': ['--config', '--fix'],
    list: ['--config', '--source', '--channel', '--recipe', '--status', '--channels', '--limit'],
    'fetch subtitle': [
      '--out',
      '--list',
      '--sub-lang',
      '--sub-format',
      '--overwrite',
      '--flat',
      '--playlist-items',
      '--yes-playlist',
      '--config',
    ],
    serve: ['--config'],
    watch: ['--config', '--source', '--no-commit'],
    version: [],
    help: [],
  }

  it('a táblázat pontosan a várt parancsokat írja le', () => {
    expect(COMMANDS.map((command) => command.name).sort()).toEqual(Object.keys(OPTIONS).sort())
  })

  it.each(Object.entries(OPTIONS))('a(z) %s súgója a használattal kezdődik és minden kapcsolóját felsorolja', (name, flags) => {
    const text = helpText(name)
    expect(text?.startsWith(`Használat: refinery ${name}`)).toBe(true)
    for (const flag of flags) expect(text).toContain(flag)
  })

  it.each(COMMANDS.map((command) => command.name).filter((name) => name !== 'help'))(
    'a(z) %s súgója a --help és a help alakban is ugyanaz, 0-val',
    async (name) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        expect(await main([...name.split(' '), '--help'])).toBe(0)
        expect(await main(['help', ...name.split(' ')])).toBe(0)
        expect(logSpy.mock.calls).toEqual([[helpText(name)], [helpText(name)]])
      } finally {
        logSpy.mockRestore()
      }
    },
  )

  it('a help parancs saját súgója, a fetch mód nélkül is a fetch subtitle súgója, az áttekintés 0-val', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await main(['help', 'help'])).toBe(0)
      expect(await main(['help', 'fetch'])).toBe(0)
      expect(await main(['fetch', '--help'])).toBe(0)
      expect(await main(['help'])).toBe(0)
      expect(await main(['--help'])).toBe(0)
      expect(await main(['-h'])).toBe(0)
      expect(logSpy.mock.calls).toEqual([
        [helpText('help')],
        [helpText('fetch subtitle')],
        [helpText('fetch subtitle')],
        [overview()],
        [overview()],
        [overview()],
      ])
    } finally {
      logSpy.mockRestore()
    }
  })

  it('a help ismeretlen paranccsal hibát és áttekintést ad, 1-gyel', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main(['help', 'nincs'])).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith('Ismeretlen parancs: nincs')
      expect(logSpy).toHaveBeenCalledWith(overview())
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it('a version és a --version a verziószámot írja, config betöltése és futtatás nélkül, 0-val', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await main(['version'])).toBe(0)
      expect(await main(['--version'])).toBe(0)
      // Csak olvasó parancs: ha a --version-t nem kezelné a main, a list futna le, nem a run.
      expect(await main(['list', '--version'])).toBe(0)
      expect(logSpy.mock.calls).toEqual([[VERSION], [VERSION], [VERSION]])
    } finally {
      logSpy.mockRestore()
    }
  })

  it('a --help elsőbbséget élvez a --version-nel szemben', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await main(['version', '--help'])).toBe(0)
      expect(logSpy.mock.calls).toEqual([[helpText('version')]])
    } finally {
      logSpy.mockRestore()
    }
  })
```

- A `'a USAGE felsorolja a list parancsot és az új kapcsolókat'` teszt (a `commandList` describe végén) helyett:

```ts
  it('a list súgója felsorolja az új kapcsolókat', () => {
    expect(overview()).toContain('  list ')
    expect(helpText('list')).toContain('--status <érték>')
    expect(helpText('list')).toContain('--channels')
  })
```

- A `describe('fetch a CLI-ben', …)` két `USAGE`-tesztje helyett:

```ts
  it('az áttekintés felsorolja a serve parancsot', () => {
    expect(overview()).toContain('  serve ')
    expect(overview()).toContain('A Worker munkáit fogadó démon: felirat az R2-be, receptek a vaultba.')
  })

  it('a fetch subtitle súgója felsorolja a saját kapcsolóit', () => {
    const text = helpText('fetch subtitle')
    expect(overview()).toContain('fetch subtitle')
    for (const flag of ['--out <út>', '--list <fájl>', '--sub-lang', '--sub-format', '--overwrite', '--flat', '--playlist-items', '--yes-playlist']) {
      expect(text).toContain(flag)
    }
  })
```

(Ha a `describe('fetch a CLI-ben', …)` blokkban további, `USAGE`-re hivatkozó sor van, azt is `overview()`-ra vagy `helpText('fetch subtitle')`-re írd át ugyanígy; a `grep -n USAGE src/cli.test.ts` a végén üres legyen.)

`src/serve/http.test.ts`: az `import { USAGE, main } from '../cli.js'` sor legyen `import { main } from '../cli.js'`, és új import: `import { overview } from '../help.js'`. A `'a USAGE felsorolja a serve parancsot'` teszt:

```ts
  it('az áttekintés felsorolja a serve parancsot', () => {
    expect(overview()).toContain('  serve ')
  })
```

`src/cli.entrypoint.test.ts`: az első két teszt elvárásai:

```ts
  it('tsx-szel, forrásból (.ts) meghívva is lefut a main() — nem csak dist/cli.js néven', async () => {
    // A `--help` a config beolvasása előtt visszatér (lásd `main()` eleje),
    // tehát a teszt hermetikus: friss klónon, config nélkül is lefut.
    const { stdout } = await run(TSX, ['src/cli.ts', '--help'])
    expect(stdout).toContain('refinery <parancs>')
    expect(stdout).toContain('--help, -h')
    expect(stdout).toContain('Részletek: refinery help <parancs>')
  })

  it('alparancs után megadott --help kapcsolóval az alparancs súgóját adja', async () => {
    const { stdout } = await run(TSX, ['src/cli.ts', 'run', '--help'])
    expect(stdout).toContain('Használat: refinery run')
    expect(stdout).toContain('--no-judge')
    expect(stdout).toContain('--dry-run')
  })
```

(A szimlinkes teszt `'refinery <parancs>'` elvárása változatlanul igaz.)

- [ ] **Step 3: Futtasd, és nézd meg, hogy elbukik**

Run: `pnpm exec vitest run src/cli.test.ts src/cli.entrypoint.test.ts src/serve/http.test.ts`
Expected: FAIL — a `main` még a régi `USAGE`-t írja (a `helpText`/`overview` elvárások nem teljesülnek, a `version` ismeretlen parancs).

- [ ] **Step 4: A `main()` átírása (`src/cli.ts`)**

- Töröld a teljes `export const USAGE = \`…\`` konstanst.
- Import: `import { helpText, overview } from './help.js'`.
- A `main` előtt:

```ts
/** A súgó tárgya: az első szó, ha nem kapcsoló. A `fetch` egyetlen módja a `subtitle`. */
function helpTopic(words: readonly string[]): string | undefined {
  const first = words[0]
  if (first === undefined || first.startsWith('-')) return undefined
  return first === 'fetch' ? 'fetch subtitle' : first
}

function printHelp(topic: string | undefined): number {
  if (topic === undefined) {
    console.log(overview())
    return 0
  }
  const text = helpText(topic)
  if (text === undefined) {
    console.error(`Ismeretlen parancs: ${topic}`)
    console.log(overview())
    return 1
  }
  console.log(text)
  return 0
}
```

- A `main` eleje (a `const command = argv[0]` sortól a `fetch` elágazásig):

```ts
export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0]
  if (command === 'help') return printHelp(helpTopic(argv.slice(1)))
  if (argv.includes('--help') || argv.includes('-h')) return printHelp(helpTopic(argv))
  if (command === 'version' || argv.includes('--version')) {
    console.log(VERSION)
    return 0
  }
  if (!command) {
    console.log(overview())
    return 1
  }

  if (command === 'fetch') return commandFetch(argv.slice(1))
```

- A `main` utolsó hibasora:

```ts
  console.error(`Ismeretlen parancs: ${command}\n\n${overview()}`)
  return 1
```

- [ ] **Step 5: A `fetch` súgója (`src/fetch/command.ts`)**

Töröld a `const USAGE = \`Használat: refinery fetch subtitle …\`` konstanst. Import: `import { helpText } from '../help.js'`. A `--help` ág:

```ts
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout(helpText('fetch subtitle') ?? '')
    return 0
  }
```

- [ ] **Step 6: README**

A Task 2-ben írt `--config`-bekezdés után:

```markdown
A súgó parancsonként is elérhető: `refinery help <parancs>` vagy
`refinery <parancs> --help`; a `refinery help` a parancsok áttekintése.
A verziót a `refinery version` (vagy `refinery --version`) írja ki.
```

- [ ] **Step 7: Ellenőrzés**

Run: `pnpm test && pnpm typecheck && pnpm lint && grep -rn "USAGE" src --include=*.ts`
Expected: minden teszt zöld, hibátlan typecheck és lint; a `grep` üres.

Mutációs próba: a `main`-ben cseréld meg a `--help` és a `--version` ág sorrendjét → a „--help elsőbbséget élvez…” tesztnek el kell buknia. Állítsd vissza.

- [ ] **Step 8: Commit**

```bash
git add src/help.ts src/cli.ts src/fetch/command.ts src/cli.test.ts src/cli.entrypoint.test.ts src/serve/http.test.ts README.md
git commit -m "feat(cli): Add per-command help and the version command"
```

---

### Task 4: Indulási üzenet a Telegramon (#179)

**Files:**
- Modify: `worker/src/messages.ts`, `worker/src/plan.ts` (re-export)
- Modify: `worker/src/handle.ts` (`settle`, `applyKnocks`, `handleCron`)
- Test: `worker/src/handle.test.ts`

**Interfaces:**
- Consumes: meglévő `runLabel` (`messages.ts`, nem exportált), `settle`, `knockFor`.
- Produces: `runStartedLine(recipes: readonly string[], lang: string | null): string`; `settle(…, started?: string)`.

- [ ] **Step 1: Failing tesztek**

`worker/src/handle.test.ts` végére:

```ts
describe('indulási üzenet', () => {
  const STARTED = (label: string) => `Elkezdődött a feldolgozás: ${label}. Hamarosan jelzem az eredményt.`

  it('a receptfuttatás 202-es elfogadása után egyszer megy, a fordításé a nyelvvel', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const own = deps(store)
    const knocks = await handleTap(tap(60, `r:notes:5:${ID}`), own)
    await applyKnocks(knocks, own)
    expect(own.sent).toEqual(['Sorba került: notes', STARTED('notes')])
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('accepted')

    const translate = deps(store)
    const planned = await handleTap(tap(61, `l:3:de:5:${ID}`), translate)
    await applyKnocks(planned, translate)
    expect(translate.sent.at(-1)).toBe(STARTED('summary, notes → de'))
  })

  it('a 409 csendes, a cron későbbi 202-je küldi; a már elfogadott futás újrakopogtatása nem', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const busy = deps(store, { knock: () => Promise.resolve(409) })
    const knocks = await handleTap(tap(62, `r:qa:5:${ID}`), busy)
    await applyKnocks(knocks, busy)
    expect(busy.sent).toEqual(['Sorba került: qa'])
    expect((await store.run(`5:${ID}:qa`))?.status).toBe('queued')

    const cron = deps(store)
    await handleCron(cron)
    expect(cron.sent).toEqual([STARTED('qa')])
    expect((await store.run(`5:${ID}:qa`))?.status).toBe('accepted')

    const again = deps(store)
    await applyKnocks([{ jobId: `5:${ID}:qa`, videoId: ID, url: VIDEO_URL, recipes: ['qa'] }], again)
    expect(again.sent).toEqual([])
  })

  it('a feliratjob elfogadása után nincs indulási üzenet, a sikertelen küldés nem tartja vissza az állapotot', async () => {
    const store = await boundStore()
    const own = deps(store)
    const planned = await handleUpdate(
      { update_id: 5, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID } },
      own,
    )
    await applyKnocks(planned.knocks, own)
    expect(own.sent).toEqual([`Sorba került: ${ID}`])

    await store.insert(readyRow({ jobId: `6:${ID}`, updateId: 6 }))
    const mute = deps(store, { send: () => Promise.resolve(false) })
    const knocks = await handleTap(tap(63, `r:bloom:6:${ID}`), mute)
    await applyKnocks(knocks, mute)
    expect((await store.run(`6:${ID}:bloom`))?.status).toBe('accepted')
  })
})
```

Megjegyzés: a `l:<maszk>:<nyelv>:<jobId>` gombadat maszkja kisbetűs hexa, a 0. bit a `summary`, az 1. a `notes`; a `3` = `summary` + `notes`. A nyelvgomb nem követel meg kész alapreceptet (`handleTap` → `maskRecipes` → `requestRun`), a cron pedig minden `queued` futást kopogtat (`isDue`).

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `pnpm exec vitest run worker/src/handle.test.ts`
Expected: FAIL — az `own.sent` csak a `Sorba került: notes` sort tartalmazza.

- [ ] **Step 3: Az üzenet (`worker/src/messages.ts`)**

A `runQueuedLine` után:

```ts
export function runStartedLine(recipes: readonly string[], lang: string | null): string {
  return `Elkezdődött a feldolgozás: ${runLabel(recipes, lang)}. Hamarosan jelzem az eredményt.`
}
```

`worker/src/plan.ts`: a `./messages.js`-ből re-exportált listában a `runQueuedLine,` után:

```ts
  runStartedLine,
```

- [ ] **Step 4: A `settle()` és hívói (`worker/src/handle.ts`)**

Az import-listába (`from './plan.js'`) a `runReadyMessage,` után: `runStartedLine,`.

A `settle` 202-es ága és fejléce:

```ts
/**
 * A felirat sora és a futás sora is így áll be a kopogtatás eredménye szerint.
 * A `started` üzenet csak az első elfogadáskor megy: a cron a régóta elfogadott
 * futást újra kopogtatja, és arra a konténer megint 202-t ad.
 */
async function settle(
  target: { status: JobStatus; acceptedAt: number | null; error: string | null },
  row: JobRow,
  save: () => Promise<void>,
  result: KnockResult,
  deps: WorkerDeps,
  started?: string,
): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    const fresh = target.status !== 'accepted'
    target.status = 'accepted'
    target.acceptedAt = deps.now()
    await save()
    if (fresh && started !== undefined) await deps.send(row.chatId, started)
    return
  }
```

(A függvény többi része változatlan; a régi egysoros doc-komment helyére kerül a fenti.)

Az `applyKnocks` receptes ága:

```ts
      await settle(
        run,
        row,
        () => deps.store.saveRun(run),
        await deps.knock(knock),
        deps,
        runStartedLine(run.recipes, run.lang),
      )
```

A `handleCron` futás-ciklusa:

```ts
    await settle(
      run,
      row,
      () => deps.store.saveRun(run),
      await deps.knock(knockFor(run, row)),
      deps,
      runStartedLine(run.recipes, run.lang),
    )
```

- [ ] **Step 5: Ellenőrzés**

Run: `pnpm exec vitest run worker && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: PASS, hibátlan.

Mutációs próba: a `settle`-ben a `fresh &&` feltételt töröld → az „újrakopogtatása nem” elvárásnak el kell buknia. Állítsd vissza.

- [ ] **Step 6: Commit**

```bash
git add worker/src/messages.ts worker/src/plan.ts worker/src/handle.ts worker/src/handle.test.ts
git commit -m "feat(worker): Tell the user when a recipe run starts"
```

---

### Task 5: `/notes` videónként (#181)

**Files:**
- Modify: `worker/src/reader.ts` (`notesPage`)
- Test: `worker/src/reader.test.ts`

**Interfaces:**
- Consumes: `RECIPES`, `LANGS` (`worker/src/messages.ts`), `runKinds` (`plan.ts`), `JobStore.notesFor` (a sorok `accepted_at` szerint csökkenőek), `JobRow.url`.
- Produces: `notesPage(sub, deps)` változatlan aláírással, új HTML-lel.

- [ ] **Step 1: Failing teszt**

`worker/src/reader.test.ts`, a `describe('notesPage', …)` első tesztje helyett:

```ts
  it('videónként egy bejegyzés, YouTube-linkkel, rögzített fajtasorrenddel, a legfrissebb kész jobra linkelve', async () => {
    const ID2 = 'abcdefghijk'
    const other = (updateId: number, partial: Partial<JobRow> = {}) =>
      row(updateId, { jobId: `${updateId}:${ID2}`, videoId: ID2, url: `https://www.youtube.com/watch?v=${ID2}&t=1`, ...partial })
    const otherRun = (updateId: number, recipes: string[]) =>
      run(updateId, recipes, { jobId: `${updateId}:${ID2}`, runId: `${updateId}:${ID2}:${recipes.join('+')}` })

    const store = memoryStore()
    await store.insert(row(5, { title: 'Régi', acceptedAt: Date.UTC(2026, 9, 6) }))
    await store.insertRun(run(5, ['summary']))
    await store.insertRun(run(5, ['qa']))
    await store.insert(row(6, { title: '<b>Új</b>' }))
    await store.insertRun(run(6, ['notes']))
    await store.insertRun(run(6, ['summary']))
    await store.insertRun(run(6, ['summary', 'notes'], { lang: 'de' }))
    await store.insertRun(run(6, ['qa'], { status: 'failed' }))
    await store.insert(other(9, { title: 'Másik', acceptedAt: Date.UTC(2026, 9, 5) }))
    await store.insertRun(otherRun(9, ['zz-uj']))
    await store.insertRun(otherRun(9, ['summary']))
    await store.insertRun(otherRun(9, ['aa-uj']))
    await store.insert(row(7, { title: 'Idegen', sub: 'sub-7' }))
    await store.insertRun(run(7, ['summary']))
    await store.insert(row(8, { title: 'Félkész' }))
    await store.insertRun(run(8, ['summary'], { status: 'queued' }))

    const response = await notesPage('sub-42', reader(store))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    const item = (jobId: string, kind: string) => `<li><a href="/notes/${jobId}/${kind}">${kind}</a></li>`
    expect(html).toContain(
      `<li><a href="https://www.youtube.com/watch?v=${ID}">&#60;b&#62;Új&#60;/b&#62;</a> · 2026-10-07<ul>` +
        item(`6:${ID}`, 'summary') +
        item(`6:${ID}`, 'summary-de') +
        item(`6:${ID}`, 'notes') +
        item(`6:${ID}`, 'notes-de') +
        item(`5:${ID}`, 'qa') +
        item(`6:${ID}`, 'transcript') +
        '</ul></li>',
    )
    expect(html).toContain(
      `<li><a href="https://www.youtube.com/watch?v=${ID2}&#38;t=1">Másik</a> · 2026-10-05<ul>` +
        item(`9:${ID2}`, 'summary') +
        item(`9:${ID2}`, 'aa-uj') +
        item(`9:${ID2}`, 'zz-uj') +
        item(`9:${ID2}`, 'transcript') +
        '</ul></li>',
    )
    expect(html.match(new RegExp(`watch\\?v=${ID}"`, 'g'))).toHaveLength(1)
    expect(html.indexOf(`watch?v=${ID}"`)).toBeLessThan(html.indexOf(`watch?v=${ID2}`))
    expect(html).not.toContain('Régi')
    expect(html).not.toContain('Idegen')
    expect(html).not.toContain('Félkész')
  })
```

Megjegyzés: a `Régi` cím azért nem jelenik meg, mert a videó címe a legfrissebb jobé. A `qa` az `5:`-re linkel, mert a 6-os job `qa` futása bukott.

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `pnpm exec vitest run worker/src/reader.test.ts`
Expected: FAIL — a mai kimenet jobonként egy `<li>`-t ír, `—`-vel elválasztott linkekkel.

- [ ] **Step 3: Implementáció (`worker/src/reader.ts`)**

Az importsor a `./messages.js`-ből:

```ts
import { GITHUB_DOWN, LANGS, NO_NOTES, NOTE_MISSING, OPEN_ON_GITHUB, RECIPES, VAULT_LOCKED } from './messages.js'
```

A `readyRuns` után:

```ts
/** A receptek a gombok sorrendjében, mindegyik után a fordításai a nyelvek sorrendjében; az ismeretlen fajta a végén. */
const KIND_ORDER: readonly string[] = RECIPES.flatMap((recipe) => [recipe, ...LANGS.map((lang) => `${recipe}-${lang}`)])
const rank = (kind: string) => KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length + 1
```

A `notesPage` teljes cseréje:

```ts
export async function notesPage(sub: string, deps: ReaderDeps): Promise<Response> {
  const rows = await deps.store.notesFor(sub)
  if (rows.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1><p>${NO_NOTES}</p>`)
  // A sorok `accepted_at` szerint csökkenőek: egy videó első sora a legfrissebb
  // job, és egy fajta első előfordulása a legfrissebb kész változata.
  const videos = new Map<string, { latest: JobRow; jobOf: Map<string, string> }>()
  // ponytail: jobonként egy runsFor-lekérés; egy fióknál néhány tucat sor, JOIN, ha a lista lassú lesz.
  for (const row of rows) {
    let video = videos.get(row.videoId)
    if (video === undefined) {
      video = { latest: row, jobOf: new Map() }
      videos.set(row.videoId, video)
    }
    for (const kind of readyRuns(await deps.store.runsFor(row.jobId)).flatMap(runKinds)) {
      if (!video.jobOf.has(kind)) video.jobOf.set(kind, row.jobId)
    }
  }
  const items = [...videos.values()].map(({ latest, jobOf }) => {
    const links = [...[...jobOf].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)), ['transcript', latest.jobId] as const]
      .map(([kind, jobId]) => `<li><a href="/notes/${escapeHtml(jobId)}/${escapeHtml(kind)}">${escapeHtml(kind)}</a></li>`)
      .join('')
    const day = latest.acceptedAt === null ? '' : new Date(latest.acceptedAt).toISOString().slice(0, 10)
    const title = `<a href="${escapeHtml(latest.url)}">${escapeHtml(latest.title ?? latest.videoId)}</a>`
    return `<li>${title} · ${day}<ul>${links}</ul></li>`
  })
  return page('Jegyzetek', `<h1>Jegyzetek</h1><ul>${items.join('')}</ul>`)
}
```

A `JobRow` típust importáld a `./store.js`-ből, ha még nincs: `import type { JobRow, JobStore, RunRow } from './store.js'`.

- [ ] **Step 4: Ellenőrzés**

Run: `pnpm exec vitest run worker && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: PASS, hibátlan.

Mutációs próba: a `if (!video.jobOf.has(kind))` feltételt töröld (így a régebbi job írná felül a linket) → a tesztnek el kell buknia (`summary` az `5:`-re mutatna). Állítsd vissza.

- [ ] **Step 5: Commit**

```bash
git add worker/src/reader.ts worker/src/reader.test.ts
git commit -m "feat(worker): Group the notes page by video"
```

---

### Task 6: Záró ellenőrzés

- [ ] **Step 1: Teljes kör**

Run: `pnpm test && pnpm typecheck && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: minden zöld.

- [ ] **Step 2: Kézi próba a CLI-n (költség nélkül)**

```bash
pnpm exec tsx src/cli.ts --version
pnpm exec tsx src/cli.ts help
pnpm exec tsx src/cli.ts help run
pnpm exec tsx src/cli.ts fetch subtitle --help
pnpm exec tsx src/cli.ts help nincs; echo "kód: $?"
```

Expected: a verziószám; az áttekintés `Részletek: refinery help <parancs>` sorral; a `run` súgója; a `fetch subtitle` súgója; `Ismeretlen parancs: nincs`, utána az áttekintés, `kód: 1`.

- [ ] **Step 3: Kézi próba a `serve`-en (a felhasználó futtatja, Infisical-titkokkal)**

A felhasználó indítja: `! pnpm serve`, majd egy másik terminálban:

```bash
curl -s http://127.0.0.1:8787/ping
curl -s http://127.0.0.1:8787/version
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/status
```

Expected: `ok`; `{"version":"…"}`; `401`. A `--config`-próba: `SERVE_OUT=… pnpm exec tsx src/cli.ts serve --config /nincs.yaml` → `Hibás konfiguráció: Nincs konfigurációs fájl: /nincs.yaml`, kilépési kód 1.

A Worker két változása (#179, #181) élesben a kiadás utáni Worker-telepítéssel próbálható: egy receptgomb után két üzenet, a `/notes` oldalon videónként egy bejegyzés.
