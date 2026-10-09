# A `/notes` a vaultból, a `serve`-en át — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/notes` minden jegyzetet mutat, bárhonnan indult a futása, a tartalmat a peter-mba vaultjából olvassa, és a vault olvasásához meg írásához sehol nem kell GitHub-specifikus kód.

**Architecture:** A `serve` új modulja (`src/serve/notes.ts`) a vault jegyzetmappáját olvassa: frontmatter alapján elemekbe csoportosít, és `markdown-it`-tel HTML-t renderel. Két új, Bearer-titkos GET útvonalon (`/notes`, `/notes/<itemId>/<fajta>`) JSON-t ad. A Worker `reader.ts`-e a D1 és a GitHub API helyett ezt hívja, a felület és az Access-belépés marad. A frontmatter új `origin` mezőt kap (`telegram` | `cli`), a `serve` callbackje pedig GitHub-URL helyett vault-relatív útvonalat küld.

**Tech Stack:** TypeScript, Vitest, Node (`node:http`, `node:fs/promises`), `yaml`, `markdown-it` (új gyökérfüggőség; a `web` már használja), Cloudflare Worker.

**Spec:** `docs/plans/2026-10-09-notes-serve-spec.md`

Az implementáció a `feat/notes-serve` ágon indul a friss `main`-ről, miután ez a terv (a `docs/notes-serve-terv` ágon) bekerült. Issue: #180 (a kód-PR zárja). A cache külön kör: #195.

## Global Constraints

- Mondatok, szó szerint (Worker, `worker/src/messages.ts`):
  - `A peter-mba nem érhető el, a jegyzetek most nem olvashatók.`
  - `A Worker és a serve titka nem egyezik.`
  - `A serve nem éri el a vaultot.`
  - `A serve hibás választ adott.`
  - `A vault most nem frissült, a lista régebbi lehet.`
  - A meglévő `NO_NOTES` és `NOTE_MISSING` szövege nem változik.
- Az `origin` értéke csak `telegram` vagy `cli`. Hiányában: `source: serve-out` → `telegram`, minden más → `cli`.
- A fajta mintája: `^[a-z]+(-[a-z]+)*$`.
- Időkorlát: a `git pull` és a Worker → `serve` hívás is 10 000 ms.
- `markdown-it` beállítása: `html: false`, `linkify: false`.
- A fajták sorrendje a `/notes` oldalon: a `RECIPES` sorrendje, minden recept után a fordításai a `LANGS` sorrendjében, utána az ismeretlen fajták ábécérendben, végül a `transcript`.
- A teszt nem éri el a GitHubot, a Telegramot, az R2-t és a Cloudflare-t; a CLI-tesztek nem indíthatnak `run`-t (a repó gyökerében valódi `refinery.config.yaml` van).
- Minden feladat végén: `pnpm test` zöld, `pnpm typecheck` és `pnpm exec tsc -p worker/tsconfig.json --noEmit` hibátlan, `pnpm lint` hibátlan.

## Review Focus

1. Egy Telegram-futás épp commitol, amikor valaki megnyitja a `/notes` listát: a lista nem pullolhat (git-zár ütközés), és `stale: true`-t ad. (3. feladat, `notes.test.ts`, `busy` eset.)
2. Egy kérés `..`-t csempész a fajtába vagy az azonosítóba (`/notes/x/..%2F..%2Fetc`): `404`, és a `serve` nem olvas a vaulton kívülről. (3. és 4. feladat.)
3. A modell által írt jegyzetben nyers `<script>` áll: a Worker oldalán szövegként jelenik meg. (3. feladat, `notes.test.ts`.)
4. Egy frontmatter `url` mezője `javascript:` kezdetű: nem kerül `href`-be. (6. feladat, `reader.test.ts`.)
5. A Telegramon már kiküldött régi link (`/notes/<update_id>:<videóazonosító>/<fajta>`): ugyanazt a jegyzetet nyitja meg. (6. feladat, `reader.test.ts` és `entry.test.ts`.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/vault/render.ts` | `NoteOrigin` típus; az `origin` frontmatter-mező a `source` után |
| `src/pipeline.ts` | `PipelineDeps.origin` → a renderelés |
| `src/cli.ts` | `commandRun` `flags.origin` → `processItem` |
| `src/serve/summary.ts` | `origin: 'telegram'`; a `noteUrl` vault-relatív útvonal; a remote/branch-lekérés megszűnik |
| `src/serve/note-url.ts`, `src/serve/note-url.test.ts` | törlődnek |
| `src/vault/git.ts` | `gitPullFfOnly(repo, timeoutMs?)` |
| `src/vault/lint.ts` | a `FRONTMATTER` minta exportja |
| `src/serve/notes.ts` (új) | vault-beolvasás, csoportosítás, `origin`, renderelés, `NotesSource` |
| `src/serve/http.ts` | `GET /notes`, `GET /notes/<itemId>/<fajta>` |
| `src/serve/command.ts` | a `NotesSource` bekötése (`busy` a `gate`-ből) |
| `worker/src/plan.ts` | `videoIdOf`; a bot-link `/notes/<videóazonosító>/<fajta>` |
| `worker/src/messages.ts` | új hibaszövegek; a GitHub-szövegek törlése |
| `worker/src/reader.ts` | a `serve`-ből olvasó lista és jegyzetoldal |
| `worker/src/index.ts` | az `Env` GitHub-mezőinek törlése; a `/notes` útvonal új bekötése |
| `worker/src/store.ts`, `worker/src/d1.ts` | a `notesFor` törlése |
| `.env.example`, `README.md`, `docs/operations/telegram-worker-topology.md` | a változások dokumentálása |

---

### Task 1: `origin` a frontmatterben

**Files:**
- Modify: `src/vault/render.ts`
- Modify: `src/pipeline.ts:36-50`, `:278-293`, `:390-396`
- Test: `src/vault/render.test.ts`, `src/pipeline.test.ts`

**Interfaces:**
- Produces: `export type NoteOrigin = 'telegram' | 'cli'` (`src/vault/render.ts`); `renderTranscriptNote(item, transcript, generatorVersion, origin: NoteOrigin = 'cli')`; `renderRecipeNote(item, transcript, content, meta, generatorVersion, origin: NoteOrigin = 'cli')`; `PipelineDeps.origin?: NoteOrigin`.

- [x] **Step 1: A bukó tesztek**

`src/vault/render.test.ts` végére:

```ts
describe('origin', () => {
  const meta = { recipe: 'summary', model: 'm', iterations: 1, score: 1, costUsd: 0 }

  it('az átiratban a source után áll, alapból cli', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note).toContain('source: youtube\norigin: cli\nsource_file:')
  })

  it('a megadott origin a receptjegyzetbe is bekerül', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0', 'telegram')
    expect(note).toContain('source: youtube\norigin: telegram\nsource_file:')
  })
})
```

`src/pipeline.test.ts`, a `describe('processItem', …)` blokk végére (az utolsó `it` után, a blokk záró `})` elé):

```ts
  it('a deps.origin a jegyzet frontmatterébe kerül, hiányában cli', async () => {
    const { sink } = collectEvents()
    const telegram = await processItem(item(), { notesRoot, store, sink, version: '0.1.0', options: {}, origin: 'telegram' })
    expect(await readFile(telegram.path!, 'utf8')).toContain('origin: telegram\n')
    const other = item({ itemId: 'd4e5f6', baseName: 'Másik', sourceFile: 'csatorna/Másik.en.srt' })
    const cli = await processItem(other, { notesRoot, store, sink, version: '0.1.0', options: {} })
    expect(await readFile(cli.path!, 'utf8')).toContain('origin: cli\n')
  })
```

- [x] **Step 2: Futtasd, bukjon**

Run: `pnpm vitest run src/vault/render.test.ts src/pipeline.test.ts`
Expected: FAIL — a render-tesztekben nincs `origin:` sor, a pipeline-tesztben a TypeScript-hiba (`origin` nem ismert mező) vagy a hiányzó sor.

- [x] **Step 3: `render.ts`**

A `baseFields` elé:

```ts
/** Honnan indult a jegyzetet író futás: a `serve` (Telegram) vagy a parancssor. */
export type NoteOrigin = 'telegram' | 'cli'
```

A `baseFields` aláírása és a `source` utáni sor:

```ts
function baseFields(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
  origin: NoteOrigin,
  extraTags?: readonly string[],
  /** A jegyzet nyelve, ha eltér az elemétől — fordításnál a célnyelv. */
  language?: string,
): FrontmatterField[] {
```

```ts
    ['source', item.source],
    ['origin', origin],
    ['source_file', item.sourceFile],
```

A két hívó:

```ts
export function renderTranscriptNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
  origin: NoteOrigin = 'cli',
): string {
  const frontmatter = renderFrontmatter(baseFields(item, transcript, generatorVersion, origin))
  return frontmatter + body(item, toParagraphs(transcript.lines))
}
```

```ts
export function renderRecipeNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  content: string,
  meta: RecipeNoteMeta,
  generatorVersion: string,
  origin: NoteOrigin = 'cli',
): string {
  const frontmatter = renderFrontmatter([
    ...baseFields(item, transcript, generatorVersion, origin, meta.tags, meta.translation?.language),
```

(A `renderRecipeNote` többi sora változatlan.)

- [x] **Step 4: `pipeline.ts`**

Az import:

```ts
import { renderRecipeNote, renderTranscriptNote, type NoteOrigin } from './vault/render.js'
```

A `PipelineDeps` végére (a `commit?: boolean` után):

```ts
  /** Honnan indult a futás; a jegyzet frontmatterének `origin` mezője. Hiányában `cli`. */
  origin?: NoteOrigin
```

A `renderRecipeNote(...)` hívás záró sora `}, deps.version)` helyett:

```ts
  }, deps.version, deps.origin)
```

A `processItem`-ben a `renderTranscriptNote(item, transcript, version),` sor helyett:

```ts
        renderTranscriptNote(item, transcript, version, deps.origin),
```

- [x] **Step 5: Futtasd, legyen zöld**

Run: `pnpm vitest run src/vault/render.test.ts src/pipeline.test.ts && pnpm typecheck`
Expected: PASS, típushiba nincs.

- [x] **Step 6: Commit**

```bash
git add src/vault/render.ts src/vault/render.test.ts src/pipeline.ts src/pipeline.test.ts
git commit -m "feat(vault): Record the run origin in note frontmatter"
```

---

### Task 2: A `serve` futása `telegram`, a `noteUrl` vault-relatív

**Files:**
- Modify: `src/cli.ts:360-377` (a `commandRun` kapcsolói), `:807-815` (a `processItem` hívás)
- Modify: `src/serve/summary.ts`
- Delete: `src/serve/note-url.ts`, `src/serve/note-url.test.ts`
- Test: `src/serve/summary.test.ts`

**Interfaces:**
- Consumes: `NoteOrigin`, `PipelineDeps.origin` (Task 1).
- Produces: `commandRun` `flags.origin?: NoteOrigin`; a `runRecipes` sikeres eredménye `{ ok: true, noteUrl: '<vault-relatív út>' }`, például `Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md`.

- [x] **Step 1: A tesztek átírása**

`src/serve/summary.test.ts`:

1. A fejlécből töröld az `import { execFile } from 'node:child_process'` és az `import { promisify } from 'node:util'` sort, valamint a `const execFileAsync = promisify(execFile)` sort. A `node:fs/promises` importja:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
```

2. A `gitFor` függvényt cseréld erre, és alá vedd fel a várt útvonalat:

```ts
function gitWith(push: typeof gitPush = gitPush) {
  return { pull: gitPullFfOnly, commit: gitCommitPaths, push }
}

const TRANSCRIPT = 'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md'
```

3. A hívások és a várt URL cseréje:

```bash
sed -i '' -E "s/gitFor\('[^']*', /gitWith(/g; s/gitFor\('[^']*'\)/gitWith()/g" src/serve/summary.test.ts
sed -i '' "s#'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_transcript.md'#TRANSCRIPT#g" src/serve/summary.test.ts
```

4. Töröld az `it('a git@ origin ugyanazt a linket adja', …)` és az `it('a nem GitHub originnak nincs linkje', …)` tesztet, és a helyükre írd ezt a kettőt:

```ts
  it('a vault remote-ja nem számít: alapértelmezett gittel, nem GitHub originnal is kész, vault-relatív úttal', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
    })
    expect(result).toEqual({ ok: true, noteUrl: TRANSCRIPT })
  })

  it('a serve futása origin: telegram jegyzetet ír', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitWith(),
    })
    expect(result.ok).toBe(true)
    for (const kind of ['transcript', 'summary']) {
      const note = await readFile(join(vault, 'Inbox/transcript-refinery/telegram', `Beszéd [${ID}]_${kind}.md`), 'utf8')
      expect(note).toContain('origin: telegram\n')
    }
  })
```

5. Ellenőrzés: `grep -n "github\|gitFor\|execFileAsync" src/serve/summary.test.ts` — nincs találat.

- [x] **Step 2: Futtasd, bukjon**

Run: `pnpm vitest run src/serve/summary.test.ts`
Expected: FAIL — a `noteUrl` még GitHub-URL, az alapértelmezett gittel a helyi origin „nem GitHub-cím” hibát ad, és a jegyzetben `origin: cli` áll.

- [x] **Step 3: `cli.ts`**

Az importok közé:

```ts
import type { NoteOrigin } from './vault/render.js'
```

A `commandRun` kapcsolóinak végére, a `command?: string` után:

```ts
    /** A jegyzetek frontmatterének `origin` mezője; hiányában `cli`. A `serve` `telegram`-ot ad. */
    origin?: NoteOrigin
```

A `processItem(unit.item, { … })` hívásban a `commit,` sor után:

```ts
        origin: flags.origin,
```

- [x] **Step 4: `summary.ts`**

1. A fejlécből töröld: `import { execFile } from 'node:child_process'`, `import { promisify } from 'node:util'`, `import { githubNoteUrl } from './note-url.js'` és a `const exec = promisify(execFile)` sort.

2. A git-függőség:

```ts
type SummaryGit = {
  pull(repo: string): Promise<void>
  commit(repo: string, paths: readonly string[], message: string): Promise<boolean>
  push(repo: string): Promise<{ pushed: boolean }>
}

const defaultGit: SummaryGit = {
  pull: gitPullFfOnly,
  commit: gitCommitPaths,
  push: gitPush,
}
```

3. A `commandRun` kapcsolói:

```ts
    { recipes: ids, dryRun: false, force: false, commit: false, command: 'serve recipes', origin: 'telegram' },
```

4. A függvény vége (a `vaultRelative` sortól):

```ts
  // A vaulton belüli út forge-független: a Worker nem olvassa, csak eltárolja.
  const noteUrl = relative(cfg.vaultPath, transcriptPath).split(sep).join('/')
  return { ok: true, noteUrl }
}
```

5. Töröld a `src/serve/note-url.ts` és a `src/serve/note-url.test.ts` fájlt:

```bash
git rm src/serve/note-url.ts src/serve/note-url.test.ts
```

- [x] **Step 5: Futtasd, legyen zöld**

Run: `pnpm vitest run src/serve && pnpm typecheck && pnpm lint`
Expected: PASS; `grep -rn "githubNoteUrl\|note-url" src` — nincs találat.

- [x] **Step 6: Commit**

```bash
git add src/cli.ts src/serve/summary.ts src/serve/summary.test.ts
git commit -m "fix(serve): Send a forge-neutral note path and mark Telegram runs"
```

---

### Task 3: Vault-beolvasás a `serve`-ben (`src/serve/notes.ts`)

**Files:**
- Modify: `package.json` (függőségek), `pnpm-lock.yaml`
- Modify: `src/vault/git.ts:15-17`
- Modify: `src/vault/lint.ts:6`
- Create: `src/serve/notes.ts`
- Test: `src/serve/notes.test.ts`

**Interfaces:**
- Consumes: `NoteOrigin` (Task 1); `Config` (`vaultPath`, `notesRoot`) a `src/config.ts`-ből.
- Produces:
  - `gitPullFfOnly(repo: string, timeoutMs?: number): Promise<void>`
  - `export const FRONTMATTER` (`src/vault/lint.ts`)
  - `src/serve/notes.ts`: `KIND`, `NoteListItem`, `NoteList`, `NoteView`, `NotesSource { list(): Promise<NoteList>; note(itemId: string, kind: string): Promise<NoteView | null> }`, `class NotesUnavailable extends Error`, `originOf(fields)`, `scanNotes(notesRoot)`, `createNotesSource({ load, busy, pull? })`.

- [x] **Step 1: Függőség, git-időkorlát, export**

```bash
pnpm add -w markdown-it@^15.0.2
pnpm add -w -D @types/markdown-it@^14.2.0
```

Expected: a `package.json` `dependencies`-ében `"markdown-it": "^15.0.2"`, a `devDependencies`-ben `"@types/markdown-it": "^14.2.0"`; a lockfile a meglévő `markdown-it@15.0.2`-t használja.

`src/vault/git.ts`:

```ts
/** `timeoutMs` után a git folyamat leáll, és a hívás hibát dob. */
export async function gitPullFfOnly(repo: string, timeoutMs?: number): Promise<void> {
  await run('git', ['pull', '--ff-only'], { cwd: repo, timeout: timeoutMs })
}
```

`src/vault/lint.ts:6`: a `const FRONTMATTER` elé `export`:

```ts
export const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/
```

- [x] **Step 2: A bukó tesztek**

`src/serve/notes.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { createNotesSource, NotesUnavailable, originOf } from './notes.js'

const ID = 'abcdefghijk'
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-notes-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function note(path: string, fields: Record<string, string>, body = '# Cím\n\nSzöveg.\n'): Promise<void> {
  const head = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), `---\n${head}\n---\n${body}`)
}

function source(options: { busy?: boolean; pull?: (repo: string) => Promise<void> } = {}) {
  const pulls: string[] = []
  const notes = createNotesSource({
    load: () => Promise.resolve({ cfg: { vaultPath: root, notesRoot: root } as Config }),
    busy: () => options.busy ?? false,
    pull: (repo) => {
      pulls.push(repo)
      return options.pull ? options.pull(repo) : Promise.resolve()
    },
  })
  return { notes, pulls }
}

describe('originOf', () => {
  it('az origin mező dönt, hiányában a serve-out telegram, minden más cli', () => {
    expect(originOf({ source: 'serve-out' })).toBe('telegram')
    expect(originOf({ source: 'youtube' })).toBe('cli')
    expect(originOf({ source: 'serve-out', origin: 'cli' })).toBe('cli')
    expect(originOf({ source: 'youtube', origin: 'telegram' })).toBe('telegram')
    expect(originOf({ source: 'youtube', origin: 'web' })).toBe('cli')
  })
})

describe('createNotesSource.list', () => {
  it('két mappában ugyanaz az item_id egy elem; fajtánként a frissebb generated_at nyer', async () => {
    const yt = { item_id: ID, title: 'Beszéd', source: 'youtube', url: `"https://www.youtube.com/watch?v=${ID}"` }
    const tg = { ...yt, source: 'serve-out' }
    await note('youtube/csatorna/Beszéd_transcript.md', { ...yt, generated_at: '2026-10-01T10:00:00.000Z' })
    await note('youtube/csatorna/Beszéd_summary.md', { ...yt, generated_at: '2026-10-01T11:00:00.000Z' }, '# Cím\n\nrégi összefoglaló\n')
    await note('youtube/csatorna/Beszéd_notes-hu.md', { ...yt, generated_at: '2026-10-01T12:00:00.000Z' })
    await note(`serve-out/Beszéd [${ID}]_transcript.md`, { ...tg, generated_at: '2026-10-05T09:00:00.000Z' })
    await note(`serve-out/Beszéd [${ID}]_summary.md`, { ...tg, generated_at: '2026-10-05T10:00:00.000Z' }, '# Cím\n\núj összefoglaló\n')
    const { notes } = source()
    const list = await notes.list()
    expect(list.stale).toBe(false)
    expect(list.items).toHaveLength(1)
    const item = list.items[0]!
    expect(item).toMatchObject({
      itemId: ID,
      title: 'Beszéd',
      url: `https://www.youtube.com/watch?v=${ID}`,
      origin: 'telegram',
      generatedAt: '2026-10-05T10:00:00.000Z',
    })
    expect([...item.kinds].sort()).toEqual(['notes-hu', 'summary', 'transcript'])
    const view = await notes.note(ID, 'summary')
    expect(view?.html).toContain('új összefoglaló')
    expect(view?.html).not.toContain('régi összefoglaló')
  })

  it('az elemek a legfrissebb jegyzetük szerint csökkenőek; url nélkül null', async () => {
    await note('felvetel/a_transcript.md', { item_id: 'a1b2c3d4e5f6a7b8', title: 'Régi', source: 'recording', generated_at: '2026-10-01T10:00:00.000Z' })
    await note('felvetel/b_transcript.md', { item_id: 'b1b2c3d4e5f6a7b8', title: 'Új', source: 'recording', generated_at: '2026-10-03T10:00:00.000Z' })
    const { items } = await source().notes.list()
    expect(items.map((item) => item.title)).toEqual(['Új', 'Régi'])
    expect(items[0]!.url).toBeNull()
    expect(items[0]!.origin).toBe('cli')
  })

  it('a _queue.md, a frontmatter nélküli, a hibás YAML-ű és az item_id nélküli fájl kimarad, a lista nem bukik', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube', generated_at: '2026-10-01T10:00:00.000Z' })
    await writeFile(join(root, '_queue.md'), '---\nitem_id: q\n---\n')
    await writeFile(join(root, 'nincs_transcript.md'), '# Csak törzs\n')
    await writeFile(join(root, 'torott_transcript.md'), '---\ntitle: [\n---\n')
    await note('azonosito-nelkul_transcript.md', { title: 'Névtelen', source: 'youtube' })
    await note('jo_Rossz.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const { items } = await source().notes.list()
    expect(items.map((item) => item.itemId)).toEqual([ID])
    expect(items[0]!.kinds).toEqual(['transcript'])
  })

  it('pullol a vaultban; a pull hibájánál a helyi állapotból, stale: true', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const ok = source()
    expect((await ok.notes.list()).stale).toBe(false)
    expect(ok.pulls).toEqual([root])
    const failing = source({ pull: () => Promise.reject(new Error('timeout')) })
    const list = await failing.notes.list()
    expect(list.stale).toBe(true)
    expect(list.items).toHaveLength(1)
  })

  it('amíg a serve dolgozik, nem pullol, és stale: true', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const busy = source({ busy: true })
    const list = await busy.notes.list()
    expect(busy.pulls).toEqual([])
    expect(list.stale).toBe(true)
    expect(list.items).toHaveLength(1)
  })

  it('hiányzó jegyzetmappánál üres lista', async () => {
    const notes = createNotesSource({
      load: () => Promise.resolve({ cfg: { vaultPath: root, notesRoot: join(root, 'nincs') } as Config }),
      busy: () => false,
      pull: () => Promise.resolve(),
    })
    expect(await notes.list()).toEqual({ stale: false, items: [] })
  })

  it('a config hibája NotesUnavailable', async () => {
    const notes = createNotesSource({ load: () => Promise.reject(new Error('nincs config')), busy: () => false })
    await expect(notes.list()).rejects.toBeInstanceOf(NotesUnavailable)
    await expect(notes.note(ID, 'summary')).rejects.toBeInstanceOf(NotesUnavailable)
  })
})

describe('createNotesSource.note', () => {
  it('a törzs HTML-je frontmatter nélkül, a nyers HTML szövegként', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'serve-out', generated_at: '2026-10-01T10:00:00.000Z' })
    await note('jo_summary.md', { item_id: ID, title: 'Jó', source: 'youtube', origin: 'cli', generated_at: '2026-10-02T10:00:00.000Z' }, '# Jó\n\n<script>alert(1)</script>\n')
    const view = await source().notes.note(ID, 'summary')
    expect(view).toMatchObject({ title: 'Jó', url: null, origin: 'cli', generatedAt: '2026-10-02T10:00:00.000Z' })
    expect(view!.html).toContain('<h1>Jó</h1>')
    expect(view!.html).toContain('&lt;script&gt;')
    expect(view!.html).not.toContain('<script>')
    expect(view!.html).not.toContain('item_id')
  })

  it('rossz fajta, ..-s fajta, ismeretlen elem és hiányzó fajta: null', async () => {
    await note('jo_transcript.md', { item_id: ID, title: 'Jó', source: 'youtube' })
    const { notes } = source()
    expect(await notes.note(ID, 'Summary')).toBeNull()
    expect(await notes.note(ID, '../../kint')).toBeNull()
    expect(await notes.note('../kint', 'transcript')).toBeNull()
    expect(await notes.note('ismeretlen', 'transcript')).toBeNull()
    expect(await notes.note(ID, 'summary')).toBeNull()
    expect(await notes.note(ID, 'transcript')).not.toBeNull()
  })
})
```

- [x] **Step 3: Futtasd, bukjon**

Run: `pnpm vitest run src/serve/notes.test.ts`
Expected: FAIL — `Cannot find module './notes.js'`.

- [x] **Step 4: `src/serve/notes.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import MarkdownIt from 'markdown-it'
import { parse as parseYaml } from 'yaml'
import type { Config } from '../config.js'
import { gitPullFfOnly } from '../vault/git.js'
import { FRONTMATTER } from '../vault/lint.js'
import type { NoteOrigin } from '../vault/render.js'

// A jegyzet modell írta szöveg: nyers HTML nem kerülhet belőle az oldalba
// (ugyanúgy, mint a `web/server/utils/markdown.ts`-ben). Teszt őrzi.
const markdown = new MarkdownIt({ html: false, linkify: false })

/** Egy fajta neve: kisbetűs szavak kötőjellel (`summary`, `notes-hu`, `clean-moderate-hu`). */
export const KIND = /^[a-z]+(-[a-z]+)*$/

const TRANSCRIPT_END = '_transcript.md'

/** A `serve` kimeneti mappájának neve: az `origin` nélküli régi jegyzeteknél ebből látszik a Telegram. */
const SERVE_SOURCE = 'serve-out'

const PULL_TIMEOUT_MS = 10_000

export interface NoteListItem {
  itemId: string
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
  kinds: string[]
}

export interface NoteList {
  stale: boolean
  items: NoteListItem[]
}

export interface NoteView {
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
  html: string
}

export interface NotesSource {
  list(): Promise<NoteList>
  note(itemId: string, kind: string): Promise<NoteView | null>
}

/** A config nem tölthető be, tehát a `serve` nem éri el a vaultot. A HTTP-réteg 503-at ad rá. */
export class NotesUnavailable extends Error {}

interface NoteFile {
  path: string
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
}

interface ScannedItem {
  itemId: string
  files: Map<string, NoteFile>
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value
  if (value instanceof Date) return value.toISOString()
  return null
}

export function originOf(fields: Record<string, unknown>): NoteOrigin {
  if (fields.origin === 'telegram' || fields.origin === 'cli') return fields.origin
  return fields.source === SERVE_SOURCE ? 'telegram' : 'cli'
}

function frontmatter(source: string): Record<string, unknown> | null {
  const match = FRONTMATTER.exec(source)
  if (match === null) return null
  try {
    const parsed: unknown = parseYaml(match[1]!)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** `a` frissebb-e `b`-nél. A hiányzó idő a legrégebbi; ISO-időbélyegeknél a szöveges sorrend az időrend. */
function newer(a: string | null, b: string | null): boolean {
  if (a === null) return false
  return b === null || a > b
}

async function listing(root: string): Promise<string[]> {
  try {
    return await readdir(root, { recursive: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
}

/**
 * A `notesRoot` minden `*_transcript.md` fájlja egy elem kiindulópontja, és
 * ugyanabban a mappában az `<alapnév>_<fajta>.md` fájlok a jegyzetei. Az
 * elemek kulcsa a frontmatter `item_id` mezője, így két mappa ugyanarról a
 * videóról egy elem lesz; egy fajtából a legfrissebb (`generated_at`) marad.
 */
export async function scanNotes(notesRoot: string): Promise<Map<string, ScannedItem>> {
  const paths = await listing(notesRoot)
  const items = new Map<string, ScannedItem>()
  // ponytail: kiindulópontonként végigmegy az összes úton (O(n²)); néhány száz fájlig elég, mappánkénti csoportosítás, ha lassú lesz.
  for (const anchor of paths) {
    const name = basename(anchor)
    if (!name.endsWith(TRANSCRIPT_END) || name.startsWith('_')) continue
    const dir = dirname(anchor)
    const prefix = join(dir, `${name.slice(0, -TRANSCRIPT_END.length)}_`)
    for (const path of paths) {
      if (!path.startsWith(prefix) || !path.endsWith('.md') || dirname(path) !== dir) continue
      const kind = path.slice(prefix.length, -'.md'.length)
      if (!KIND.test(kind)) continue
      const fields = frontmatter(await readFile(join(notesRoot, path), 'utf8'))
      const itemId = fields === null ? null : text(fields.item_id)
      if (fields === null || itemId === null) continue
      const file: NoteFile = {
        path: join(notesRoot, path),
        title: text(fields.title) ?? itemId,
        url: text(fields.url),
        origin: originOf(fields),
        generatedAt: text(fields.generated_at),
      }
      let item = items.get(itemId)
      if (item === undefined) {
        item = { itemId, files: new Map() }
        items.set(itemId, item)
      }
      const current = item.files.get(kind)
      if (current === undefined || newer(file.generatedAt, current.generatedAt)) item.files.set(kind, file)
    }
  }
  return items
}

function latest(item: ScannedItem): NoteFile {
  let best: NoteFile | undefined
  for (const file of item.files.values()) {
    if (best === undefined || newer(file.generatedAt, best.generatedAt)) best = file
  }
  return best!
}

export function createNotesSource(input: {
  load: () => Promise<{ cfg: Config }>
  /** Igaz, amíg a `serve` munkát végez: ilyenkor a lista nem pullol, hogy ne ütközzön a futás commitjával. */
  busy: () => boolean
  pull?: (repo: string) => Promise<void>
}): NotesSource {
  const pull = input.pull ?? ((repo: string) => gitPullFfOnly(repo, PULL_TIMEOUT_MS))

  async function config(): Promise<Config> {
    try {
      return (await input.load()).cfg
    } catch (cause) {
      throw new NotesUnavailable(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return {
    async list() {
      const cfg = await config()
      let stale = input.busy()
      if (!stale) {
        try {
          await pull(cfg.vaultPath)
        } catch {
          stale = true
        }
      }
      const items = [...(await scanNotes(cfg.notesRoot)).values()].map((item): NoteListItem => {
        const head = latest(item)
        return {
          itemId: item.itemId,
          title: head.title,
          url: head.url,
          origin: head.origin,
          generatedAt: head.generatedAt,
          kinds: [...item.files.keys()],
        }
      })
      items.sort((a, b) => (newer(a.generatedAt, b.generatedAt) ? -1 : newer(b.generatedAt, a.generatedAt) ? 1 : 0))
      return { stale, items }
    },

    async note(itemId, kind) {
      if (!KIND.test(kind)) return null
      const cfg = await config()
      const file = (await scanNotes(cfg.notesRoot)).get(itemId)?.files.get(kind)
      if (file === undefined) return null
      const source = await readFile(file.path, 'utf8')
      const match = FRONTMATTER.exec(source)
      const body = match === null ? source : source.slice(match[0].length)
      return {
        title: file.title,
        url: file.url,
        origin: file.origin,
        generatedAt: file.generatedAt,
        html: markdown.render(body),
      }
    },
  }
}
```

- [x] **Step 5: Futtasd, legyen zöld**

Run: `pnpm vitest run src/serve/notes.test.ts src/vault && pnpm typecheck && pnpm lint`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/vault/git.ts src/vault/lint.ts src/serve/notes.ts src/serve/notes.test.ts
git commit -m "feat(serve): Read and render vault notes for the notes page"
```

---

### Task 4: A `serve` `/notes` útvonalai

**Files:**
- Modify: `src/serve/http.ts`
- Modify: `src/serve/command.ts` (a `createServeServer` hívás)
- Test: `src/serve/http.test.ts`

**Interfaces:**
- Consumes: `NotesSource`, `NotesUnavailable` (Task 3); `createNotesSource` (Task 3).
- Produces: `ServeServerInput.notes?: NotesSource`. HTTP: `GET /notes` → `200` JSON (`NoteList`); `GET /notes/<itemId>/<fajta>` → `200` JSON (`NoteView`) vagy `404`; titok nélkül `401`; `notes` nélkül vagy `NotesUnavailable`-nél `503`; más hibánál `500`.

- [x] **Step 1: A bukó tesztek**

`src/serve/http.test.ts`: az importokhoz:

```ts
import { NotesUnavailable, type NotesSource } from './notes.js'
```

A fájl végére:

```ts
describe('createServeServer /notes', () => {
  async function start(notes?: NotesSource): Promise<number> {
    server = createServeServer({ secret: 'titok', gate, version: '9.9.9', notes, onJob: () => Promise.resolve() })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return (server.address() as { port: number }).port
  }

  const get = (port: number, path: string, secret = 'titok') =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${secret}` } })

  const view = { title: 'Cím', url: null, origin: 'cli' as const, generatedAt: null, html: '<p>x</p>' }

  function fake(): NotesSource & { asked: [string, string][] } {
    const asked: [string, string][] = []
    return {
      asked,
      list: () => Promise.resolve({ stale: false, items: [] }),
      note: (itemId, kind) => {
        asked.push([itemId, kind])
        return Promise.resolve(itemId === 'abcdefghijk' && kind === 'summary' ? view : null)
      },
    }
  }

  it('titok nélkül mindkét útvonal 401', async () => {
    const port = await start(fake())
    expect((await get(port, '/notes', 'rossz')).status).toBe(401)
    expect((await get(port, '/notes/abcdefghijk/summary', 'rossz')).status).toBe(401)
  })

  it('a lista és a jegyzet JSON, a dekódolt szakaszokkal', async () => {
    const notes = fake()
    const port = await start(notes)
    const list = await get(port, '/notes')
    expect(list.status).toBe(200)
    expect(list.headers.get('content-type')).toBe('application/json')
    expect(await list.json()).toEqual({ stale: false, items: [] })
    const one = await get(port, '/notes/abcdefghijk/summary')
    expect(one.status).toBe(200)
    expect(await one.json()).toEqual(view)
    expect((await get(port, '/notes/abcdefghijk/..%2F..%2Fetc')).status).toBe(404)
    expect(notes.asked).toEqual([
      ['abcdefghijk', 'summary'],
      ['abcdefghijk', '../../etc'],
    ])
  })

  it('a hibás kódolás, a hiányzó fajta és a POST 404', async () => {
    const notes = fake()
    const port = await start(notes)
    expect((await get(port, '/notes/%E0/summary')).status).toBe(404)
    expect((await get(port, '/notes/abcdefghijk')).status).toBe(404)
    expect((await get(port, '/notes/')).status).toBe(404)
    const post = await fetch(`http://127.0.0.1:${port}/notes`, { method: 'POST', headers: { authorization: 'Bearer titok' } })
    expect(post.status).toBe(404)
    expect(notes.asked).toEqual([])
  })

  it('vault nélkül 503, váratlan hibánál 500', async () => {
    const none = await start()
    expect((await get(none, '/notes')).status).toBe(503)
    server?.close()
    await once(server!, 'close')
    const unavailable = await start({
      list: () => Promise.reject(new NotesUnavailable('nincs config')),
      note: () => Promise.reject(new NotesUnavailable('nincs config')),
    })
    expect((await get(unavailable, '/notes')).status).toBe(503)
    expect((await get(unavailable, '/notes/abcdefghijk/summary')).status).toBe(503)
    server?.close()
    await once(server!, 'close')
    const broken = await start({ list: () => Promise.reject(new Error('váratlan')), note: () => Promise.resolve(null) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await get(broken, '/notes')).status).toBe(500)
    spy.mockRestore()
  })
})
```

- [x] **Step 2: Futtasd, bukjon**

Run: `pnpm vitest run src/serve/http.test.ts`
Expected: FAIL — a `/notes` ma `404` (és a `notes` mező ismeretlen a bemenetben).

- [x] **Step 3: `http.ts`**

Az importokhoz:

```ts
import { NotesUnavailable, type NotesSource } from './notes.js'
```

A `ServeServerInput`:

```ts
export interface ServeServerInput {
  secret: string
  gate: ServeGate
  version: string
  /** A `/notes` útvonalak forrása; hiányában a két útvonal `503`. */
  notes?: NotesSource
  onJob: (job: ServeJob) => Promise<void>
}
```

A `createServeServer` elé:

```ts
const NOTE_PATH = /^\/notes\/([^/]+)\/([^/]+)$/

function decoded(segment: string | undefined): string | null {
  if (segment === undefined) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

async function notesRoute(
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  input: ServeServerInput,
): Promise<void> {
  if (!authorized(request.headers.authorization, input.secret)) {
    rejectUnauthorized(request, response)
    return
  }
  if (input.notes === undefined) {
    send(response, 503)
    return
  }
  try {
    if (path === '/notes') {
      sendBody(response, 200, 'application/json', JSON.stringify(await input.notes.list()))
      return
    }
    // Az útvonalból soha nem lesz fájlút: a forrás a beolvasott jegyzetek közül választ.
    const match = NOTE_PATH.exec(path)
    const itemId = decoded(match?.[1])
    const kind = decoded(match?.[2])
    const view = itemId === null || kind === null ? null : await input.notes.note(itemId, kind)
    if (view === null) {
      send(response, 404)
      return
    }
    sendBody(response, 200, 'application/json', JSON.stringify(view))
  } catch (cause) {
    if (cause instanceof NotesUnavailable) {
      console.warn(`[serve] 503 A vault nem érhető el: ${cause.message}`)
      send(response, 503)
      return
    }
    console.error('[serve] /notes hiba:', cause)
    send(response, 500)
  }
}
```

A `handle`-ben, a `GET /status` blokk után, a `if (request.method !== 'POST' || path !== '/jobs')` elé:

```ts
  if (request.method === 'GET' && (path === '/notes' || path.startsWith('/notes/'))) {
    await notesRoute(path, request, response, input)
    return
  }
```

- [x] **Step 4: `command.ts`**

Az importokhoz:

```ts
import { createNotesSource } from './notes.js'
```

A `createServeServer({ … })` hívásban a `version: VERSION,` sor után:

```ts
    // A config kérésenként töltődik, mint a receptfuttatásnál: a vault-config szerkesztése újraindítás nélkül hat.
    notes: createNotesSource({ load: () => loadCliConfig(configArg), busy: () => gate.current !== null }),
```

- [x] **Step 5: Futtasd, legyen zöld**

Run: `pnpm vitest run src/serve && pnpm typecheck && pnpm lint`
Expected: PASS.

- [x] **Step 6: README**

`README.md`, a „A `serve` három lekérdező végpontot is ad: …” bekezdés után új bekezdés:

```markdown
A `/notes` oldal adatait is a `serve` adja, a `REFINERY_SERVE_SECRET`
Bearer-tokenjével: a `GET /notes` a vault jegyzetmappájának listáját
(elemenként cím, YouTube-cím, `origin`, a legfrissebb jegyzet ideje és a kész
fajták), a `GET /notes/<itemId>/<fajta>` egy jegyzet renderelt HTML-jét. A
lista előtt a `serve` `git pull`-t futtat a vaulton; ha ez nem sikerül, vagy
épp munka fut, a válasz `stale: true`.
```

- [x] **Step 7: Commit**

```bash
git add src/serve/http.ts src/serve/http.test.ts src/serve/command.ts README.md
git commit -m "feat(serve): Serve the notes list and note pages from the vault"
```

---

### Task 5: A bot-link videóazonosítóval (`worker/src/plan.ts`)

**Files:**
- Modify: `worker/src/plan.ts:100-110`
- Test: `worker/src/plan.test.ts`, `worker/src/handle.test.ts`, `worker/src/entry.test.ts`

**Interfaces:**
- Produces: `export function videoIdOf(jobId: string): string` — a `jobId` utolsó kettőspontja utáni rész; kettőspont nélkül maga a bemenet. A `runReadyMessage` linkjei: `${linkBase}/notes/${videoIdOf(run.jobId)}/${kind}`.

- [x] **Step 1: A tesztek átírása (bukjanak)**

`worker/src/plan.test.ts`: az importlistába `videoIdOf`; a `/notes/1:${ID}/` szakaszok cseréje:

```bash
sed -i '' 's#/notes/1:\${ID}/#/notes/\${ID}/#g' worker/src/plan.test.ts
```

Új teszt a `runReadyMessage`-et tartalmazó `describe` végére:

```ts
  it('a videoIdOf az utolsó kettőspont utáni rész, kettőspont nélkül maga a bemenet', () => {
    expect(videoIdOf(`123:${ID}`)).toBe(ID)
    expect(videoIdOf(ID)).toBe(ID)
    expect(videoIdOf('a1b2c3d4e5f6a7b8')).toBe('a1b2c3d4e5f6a7b8')
  })
```

`worker/src/handle.test.ts`:

```bash
sed -i '' 's#/notes/5:\${ID}/#/notes/\${ID}/#g' worker/src/handle.test.ts
```

`worker/src/entry.test.ts`, „a futás visszahívása a kérés saját címére tett /notes linket küldi” teszt: a `noteUrl` legyen `'Inbox/a_transcript.md'`, a várt szöveg:

```ts
      'Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/abcdefghijk/summary',
```

Ellenőrzés: `grep -n "notes/[0-9]*:" worker/src/plan.test.ts worker/src/handle.test.ts worker/src/entry.test.ts` — csak az `entry.test.ts` `/notes`-tesztjének `get('/notes/5:abcdefghijk/summary')` sorai maradnak (ezeket a 6. feladat kezeli).

- [x] **Step 2: Futtasd, bukjon**

Run: `pnpm vitest run worker/src/plan.test.ts worker/src/handle.test.ts worker/src/entry.test.ts`
Expected: FAIL — `videoIdOf` nincs exportálva, a linkek még `1:`/`5:` előtagúak.

- [x] **Step 3: `plan.ts`**

A `runReadyMessage` elé:

```ts
/** A `jobId` (`<update_id>:<videóazonosító>`) videóazonosító része; kettőspont nélkül maga a bemenet. */
export function videoIdOf(jobId: string): string {
  return jobId.slice(jobId.lastIndexOf(':') + 1)
}
```

A `runReadyMessage` utolsó sora:

```ts
  return [head, ...runKinds(run).map((kind) => `${linkBase}/notes/${videoIdOf(run.jobId)}/${kind}`)].join('\n')
```

- [x] **Step 4: Futtasd, legyen zöld**

Run: `pnpm vitest run worker && pnpm exec tsc -p worker/tsconfig.json --noEmit`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add worker/src/plan.ts worker/src/plan.test.ts worker/src/handle.test.ts worker/src/entry.test.ts
git commit -m "feat(worker): Link notes by video id in bot messages"
```

---

### Task 6: A Worker olvasója a `serve`-ből

**Files:**
- Modify: `worker/src/messages.ts:55-59`
- Modify (teljes csere): `worker/src/reader.ts`
- Modify: `worker/src/index.ts` (`Env`, a `/notes` útvonal)
- Modify: `worker/src/store.ts` (a `notesFor` törlése az interfészből és a `memoryStore`-ból), `worker/src/d1.ts` (a `notesFor` törlése)
- Test (teljes csere): `worker/src/reader.test.ts`; Modify: `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: `videoIdOf` (Task 5); a `serve` JSON-alakjai (Task 3–4): lista `{ stale: boolean, items: { itemId, title, url: string|null, origin, generatedAt: string|null, kinds: string[] }[] }`, jegyzet `{ title, url, origin, generatedAt, html }`.
- Produces: `ReaderDeps { serveUrl: string; secret: string }`; `notesPage(deps): Promise<Response>`; `notePage(id: string, kind: string, deps): Promise<Response>` (az `id` lehet régi `jobId` is).

- [x] **Step 1: A bukó tesztek**

`worker/src/reader.test.ts` teljes tartalma:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { notePage, notesPage, type ReaderDeps } from './reader.js'

const ID = 'zw_kFlCTPKY'
const REC = 'a1b2c3d4e5f6a7b8'
const DEPS: ReaderDeps = { serveUrl: 'http://serve.test/', secret: 'titok' }

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

type Call = { url: string; headers: Record<string, string>; signal: unknown }

function serve(respond: (url: string) => Promise<Response>): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, headers: init?.headers as Record<string, string>, signal: init?.signal })
    return respond(url)
  }
  return calls
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const link = (id: string, kind: string) => `<li><a href="/notes/${id}/${kind}">${kind}</a></li>`

describe('notesPage', () => {
  it('a serve listája: címke, dátum, KIND_ORDER szerinti fajták, a transcript a végén', async () => {
    const calls = serve(() =>
      json({
        stale: false,
        items: [
          {
            itemId: ID,
            title: '<b>Új</b>',
            url: `https://www.youtube.com/watch?v=${ID}&t=1`,
            origin: 'telegram',
            generatedAt: '2026-10-07T10:00:00.000Z',
            kinds: ['transcript', 'zz-uj', 'qa', 'summary-de', 'summary', 'aa-uj'],
          },
          { itemId: REC, title: 'Felvétel', url: null, origin: 'cli', generatedAt: '2026-10-05T10:00:00.000Z', kinds: ['transcript'] },
        ],
      }),
    )
    const response = await notesPage(DEPS)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://serve.test/notes')
    expect(calls[0]!.headers).toEqual({ authorization: 'Bearer titok' })
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
    const html = await response.text()
    expect(html).toContain(
      `<li><a href="https://www.youtube.com/watch?v=${ID}&#38;t=1">&#60;b&#62;Új&#60;/b&#62;</a> · 2026-10-07 · <span class="origin">telegram</span><ul>` +
        link(ID, 'summary') +
        link(ID, 'summary-de') +
        link(ID, 'qa') +
        link(ID, 'aa-uj') +
        link(ID, 'zz-uj') +
        link(ID, 'transcript') +
        '</ul></li>',
    )
    expect(html).toContain(`<li>Felvétel · 2026-10-05 · <span class="origin">cli</span><ul>${link(REC, 'transcript')}</ul></li>`)
    expect(html.indexOf(ID)).toBeLessThan(html.indexOf('Felvétel'))
    expect(html).not.toContain('A vault most nem frissült')
  })

  it('nem http(s) címből nem lesz link', async () => {
    serve(() =>
      json({
        stale: false,
        items: [{ itemId: ID, title: 'Gonosz', url: 'javascript:alert(1)', origin: 'cli', generatedAt: null, kinds: ['transcript'] }],
      }),
    )
    const html = await (await notesPage(DEPS)).text()
    expect(html).toContain('<li>Gonosz ·  · <span class="origin">cli</span>')
    expect(html).not.toContain('javascript:')
  })

  it('stale: true esetén a figyelmeztető sor; üres listánál a biztató mondat', async () => {
    serve(() => json({ stale: true, items: [] }))
    const html = await (await notesPage(DEPS)).text()
    expect(html).toContain('A vault most nem frissült, a lista régebbi lehet.')
    expect(html).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
  })

  it('a serve hibái 502-t adnak a megfelelő mondattal', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.reject(new DOMException('lejárt', 'TimeoutError')), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => Promise.reject(new Error('hálózat')), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => json(null, 404), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => json(null, 401), 'A Worker és a serve titka nem egyezik.'],
      [() => json(null, 503), 'A serve nem éri el a vaultot.'],
      [() => json({ items: 'x' }), 'A serve hibás választ adott.'],
      [() => Promise.resolve(new Response('nem json')), 'A serve hibás választ adott.'],
    ]
    for (const [respond, line] of cases) {
      serve(respond)
      const response = await notesPage(DEPS)
      expect(response.status).toBe(502)
      expect(await response.text()).toContain(line)
    }
  })
})

describe('notePage', () => {
  const view = { title: 'Cím', url: null, origin: 'cli', generatedAt: '2026-10-07T10:00:00.000Z', html: '<h1>Cím</h1><p>Szöveg.</p>' }

  it('a serve HTML-je a meta-sor alatt, GitHub-link nélkül', async () => {
    const calls = serve(() => json(view))
    const response = await notePage(ID, 'summary-de', DEPS)
    expect(response.status).toBe(200)
    expect(calls[0]!.url).toBe(`http://serve.test/notes/${ID}/summary-de`)
    const html = await response.text()
    expect(html).toContain('<title>Cím · summary-de</title>')
    expect(html).toContain('<p class="meta">summary-de · cli · 2026-10-07</p><h1>Cím</h1><p>Szöveg.</p>')
    expect(html).not.toContain('GitHub')
  })

  it('a régi bot-link jobId-jából a videóazonosítót kéri', async () => {
    const calls = serve(() => json(view))
    await notePage(`123:${ID}`, 'summary', DEPS)
    expect(calls[0]!.url).toBe(`http://serve.test/notes/${ID}/summary`)
  })

  it('404 → 404 a jegyzet hiányával; a többi hiba 502', async () => {
    serve(() => json(null, 404))
    const missing = await notePage(ID, 'summary', DEPS)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('A jegyzet nincs a vaultban.')
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.reject(new Error('hálózat')), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => json(null, 401), 'A Worker és a serve titka nem egyezik.'],
      [() => json(null, 503), 'A serve nem éri el a vaultot.'],
      [() => json({ title: 'Cím' }), 'A serve hibás választ adott.'],
    ]
    for (const [respond, line] of cases) {
      serve(respond)
      const response = await notePage(ID, 'summary', DEPS)
      expect(response.status).toBe(502)
      expect(await response.text()).toContain(line)
    }
  })
})
```

`worker/src/entry.test.ts`, „a /notes azonosító nélkül 403, …” teszt: a `globalThis.fetch = …` sor helyett:

```ts
    const asked: string[] = []
    globalThis.fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      asked.push(url)
      return Promise.resolve(
        url.endsWith('/notes') ? new Response(JSON.stringify({ stale: false, items: [] })) : new Response(null, { status: 404 }),
      )
    }
```

és a teszt végén (az utolsó `expect` után):

```ts
    expect(asked).toContain('http://127.0.0.1:8787/notes/abcdefghijk/summary')
    expect((await worker.fetch(get('/notes/%E0/summary'), env, signed)).status).toBe(404)
```

- [x] **Step 2: Futtasd, bukjon**

Run: `pnpm vitest run worker/src/reader.test.ts worker/src/entry.test.ts`
Expected: FAIL — a `ReaderDeps` alakja más, a `notesPage` a D1-et olvassa.

- [x] **Step 3: `messages.ts`**

A `VAULT_LOCKED`, `GITHUB_DOWN` és `OPEN_ON_GITHUB` sor helyére:

```ts
export const SERVE_DOWN = 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'
export const SERVE_SECRET_MISMATCH = 'A Worker és a serve titka nem egyezik.'
export const SERVE_NO_VAULT = 'A serve nem éri el a vaultot.'
export const SERVE_BAD_REPLY = 'A serve hibás választ adott.'
export const NOTES_STALE = 'A vault most nem frissült, a lista régebbi lehet.'
```

- [x] **Step 4: `reader.ts` (teljes csere)**

```ts
import {
  LANGS,
  NO_NOTES,
  NOTE_MISSING,
  NOTES_STALE,
  RECIPES,
  SERVE_BAD_REPLY,
  SERVE_DOWN,
  SERVE_NO_VAULT,
  SERVE_SECRET_MISMATCH,
} from './messages.js'
import { videoIdOf } from './plan.js'

export interface ReaderDeps {
  serveUrl: string
  secret: string
}

const TIMEOUT_MS = 10_000

const STYLE =
  ':root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:1rem}' +
  'table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #8886;padding:.25rem .5rem;text-align:left;vertical-align:top}' +
  'img{max-width:100%}.meta,.origin{opacity:.7}'

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style><body>${body}</body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

interface ListItem {
  itemId: string
  title: string
  url: string | null
  origin: string
  generatedAt: string | null
  kinds: string[]
}

interface NoteView {
  title: string
  url: string | null
  origin: string
  generatedAt: string | null
  html: string
}

const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string'

function isItem(value: unknown): value is ListItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.itemId === 'string' &&
    typeof item.title === 'string' &&
    nullableText(item.url) &&
    typeof item.origin === 'string' &&
    nullableText(item.generatedAt) &&
    Array.isArray(item.kinds) &&
    item.kinds.every((kind) => typeof kind === 'string')
  )
}

function isList(value: unknown): value is { stale: boolean; items: ListItem[] } {
  if (typeof value !== 'object' || value === null) return false
  const list = value as { stale?: unknown; items?: unknown }
  return typeof list.stale === 'boolean' && Array.isArray(list.items) && list.items.every(isItem)
}

function isView(value: unknown): value is NoteView {
  if (typeof value !== 'object' || value === null) return false
  const view = value as Record<string, unknown>
  return (
    typeof view.title === 'string' &&
    nullableText(view.url) &&
    typeof view.origin === 'string' &&
    nullableText(view.generatedAt) &&
    typeof view.html === 'string'
  )
}

/** A `serve` válasza: siker esetén a JSON-törzs (hibás JSON-nál `undefined`), különben a státusz (hálózati hibánál 0). */
async function ask(path: string, deps: ReaderDeps): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  let response: Response
  try {
    response = await fetch(`${deps.serveUrl.replace(/\/$/, '')}${path}`, {
      headers: { authorization: `Bearer ${deps.secret}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, status: 0 }
  }
  if (!response.ok) return { ok: false, status: response.status }
  try {
    const body: unknown = await response.json()
    return { ok: true, body }
  } catch {
    return { ok: true, body: undefined }
  }
}

function failure(title: string, status: number): Response {
  if (status === 404) return page(title, `<p>${NOTE_MISSING}</p>`, 404)
  const line = status === 401 ? SERVE_SECRET_MISMATCH : status === 503 ? SERVE_NO_VAULT : SERVE_DOWN
  return page(title, `<p>${line}</p>`, 502)
}

const day = (generatedAt: string | null) => (generatedAt === null ? '' : generatedAt.slice(0, 10))

/** Csak `http(s)` címből lesz link: a frontmatter `url` mezője nem kerülhet `javascript:`-tal `href`-be. */
const linkable = (url: string | null): url is string => url !== null && /^https?:\/\//.test(url)

/** A receptek a gombok sorrendjében, mindegyik után a fordításai a nyelvek sorrendjében; az ismeretlen fajta a végén. */
const KIND_ORDER: readonly string[] = RECIPES.flatMap((recipe) => [recipe, ...LANGS.map((lang) => `${recipe}-${lang}`)])
const rank = (kind: string) => KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length + 1

function ordered(kinds: readonly string[]): string[] {
  const rest = kinds.filter((kind) => kind !== 'transcript').sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return kinds.includes('transcript') ? [...rest, 'transcript'] : rest
}

export async function notesPage(deps: ReaderDeps): Promise<Response> {
  const asked = await ask('/notes', deps)
  // A listára adott 404 régi, `/notes` útvonal nélküli serve-et jelent: az elérhetetlen eset.
  if (!asked.ok) return failure('Jegyzetek', asked.status === 404 ? 0 : asked.status)
  if (!isList(asked.body)) return page('Jegyzetek', `<p>${SERVE_BAD_REPLY}</p>`, 502)
  const { stale, items } = asked.body
  const warning = stale ? `<p>${NOTES_STALE}</p>` : ''
  if (items.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1>${warning}<p>${NO_NOTES}</p>`)
  const rows = items.map((item) => {
    const id = escapeHtml(encodeURIComponent(item.itemId))
    const links = ordered(item.kinds)
      .map((kind) => `<li><a href="/notes/${id}/${escapeHtml(encodeURIComponent(kind))}">${escapeHtml(kind)}</a></li>`)
      .join('')
    const title = escapeHtml(item.title)
    const name = linkable(item.url) ? `<a href="${escapeHtml(item.url)}">${title}</a>` : title
    return `<li>${name} · ${day(item.generatedAt)} · <span class="origin">${escapeHtml(item.origin)}</span><ul>${links}</ul></li>`
  })
  return page('Jegyzetek', `<h1>Jegyzetek</h1>${warning}<ul>${rows.join('')}</ul>`)
}

/** Az `id` videó- vagy elemazonosító, vagy egy régi bot-link `jobId`-ja (`<update_id>:<videóazonosító>`). */
export async function notePage(id: string, kind: string, deps: ReaderDeps): Promise<Response> {
  const asked = await ask(`/notes/${encodeURIComponent(videoIdOf(id))}/${encodeURIComponent(kind)}`, deps)
  if (!asked.ok) return failure('Jegyzet', asked.status)
  if (!isView(asked.body)) return page('Jegyzet', `<p>${SERVE_BAD_REPLY}</p>`, 502)
  const view = asked.body
  // A cím és a YouTube-link a jegyzet saját `# cím` és `🌐 <url>` sorából látszik.
  const meta = `<p class="meta">${escapeHtml(kind)} · ${escapeHtml(view.origin)} · ${day(view.generatedAt)}</p>`
  return page(`${view.title} · ${kind}`, `${meta}${view.html}`)
}
```

- [x] **Step 5: `index.ts`**

Az `Env`-ből töröld a `VAULT_GITHUB_TOKEN?`, `VAULT_REPO?` és `VAULT_BRANCH?` sort.

A `sameText` után:

```ts
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}
```

A `/notes` blokk:

```ts
    const note = /^\/notes\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if ((url.pathname === '/notes' || note !== null) && request.method === 'GET') {
      const who = await identity(ctx)
      if (who === null) return new Response(null, { status: 403 })
      const reader: ReaderDeps = { serveUrl: env.SERVE_URL, secret: env.REFINERY_SERVE_SECRET }
      if (note?.[1] === undefined || note[2] === undefined) return notesPage(reader)
      const id = decoded(note[1])
      const kind = decoded(note[2])
      if (id === null || kind === null) return new Response(null, { status: 404 })
      return notePage(id, kind, reader)
    }
```

- [x] **Step 6: `store.ts` és `d1.ts`**

`worker/src/store.ts`: töröld a `notesFor(sub: string): Promise<JobRow[]>` sort a `JobStore` interfészből, és a `notesFor: (sub) => …` bejegyzést (6 sor) a `memoryStore`-ból.

`worker/src/d1.ts`: töröld az `async notesFor(sub) { … }` metódust (10 sor).

Ellenőrzés: `grep -rn "notesFor\|VAULT_\|GITHUB\|github" worker/src` — nincs találat.

- [x] **Step 7: Futtasd, legyen zöld**

Run: `pnpm test && pnpm exec tsc -p worker/tsconfig.json --noEmit && pnpm lint`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add worker/src
git commit -m "feat(worker): Read the notes page from serve instead of GitHub"
```

---

### Task 7: Dokumentáció és záró ellenőrzés

**Files:**
- Modify: `.env.example` (a vault-változók blokkja)
- Modify: `docs/operations/telegram-worker-topology.md:229`

- [x] **Step 1: `.env.example`**

Töröld ezt a blokkot (a sorok közti üres sorral együtt):

```text
# Fine-grained GitHub token: csak a vault-repóra, Contents: Read-only.
# Az olvasó oldal (`/notes`) ezzel kéri le a jegyzetet.
VAULT_GITHUB_TOKEN=

# A vault-repó `<tulaj>/<repo>` alakban, betűre úgy, ahogy a jegyzetlinkekben áll.
VAULT_REPO=

# A vault ága, amelyre a jegyzetek kerülnek.
VAULT_BRANCH=

```

- [x] **Step 2: Az üzemeltetési leírás**

`docs/operations/telegram-worker-topology.md`, a „**Kész jegyzet:**” kezdetű sor helyére:

```markdown
- **Kész jegyzet:** `<cím> · <recept>. A jegyzet megvan.`, fordításnál `<cím> · <nyelv>. A fordítás megvan.`, és jegyzetenként egy sor: `https://<worker>/notes/<videóazonosító>/<fajta>` (például `notes`, `summary-de`). Az oldal Cloudflare Access mögött van; a Worker a jegyzetet a peter-mba `serve`-étől kéri (`GET /notes/<itemId>/<fajta>`), az a vaultból olvassa és rendereli. A régi, `/notes/<update_id>:<videóazonosító>/<fajta>` alakú linkek is működnek. A `https://<worker>/notes` a vault összes jegyzetének listája, bárhonnan indult a futás, elemenként `telegram`/`cli` címkével és a kész fajtákkal. Ha a peter-mba alszik, az oldal ezt jelzi. A bot csak privát chatben válaszol.
```

- [x] **Step 3: Záró ellenőrzés**

Run:

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm exec tsc -p worker/tsconfig.json --noEmit
pnpm lint
grep -rni "github" src worker/src --include='*.ts' | grep -v '\.test\.ts'
```

Expected: minden zöld; a `grep` nem ad találatot.

- [x] **Step 4: Commit**

```bash
git add .env.example docs/operations/telegram-worker-topology.md
git commit -m "docs: Describe the vault-backed notes page"
```

---

## Telepítés és élő próba (a felhasználó végzi, a merge és a kiadás után)

1. Konténerkép: `pnpm docker:publish`, majd a peter-mba konténer frissítése a új képre.
2. Worker: `pnpm worker:deploy`. (Fordított sorrendben a köztes időben a `/notes` 502-t ad, más hiba nincs.)
3. `wrangler secret delete VAULT_GITHUB_TOKEN` a Workeren (és ha titokként szerepelnek, a `VAULT_REPO` és a `VAULT_BRANCH`), majd a GitHub-token visszavonása.
4. Ezt kell látni:
   - A `https://transcript-refinery.peteroncode.workers.dev/notes` lapon a `refinery run`-nal készült jegyzetek is megjelennek (például a 3Blue1Brown-videó `bloom`, `notes` és `notes-hu` jegyzete), `cli` címkével.
   - Egy régi Telegram-link ugyanazt a jegyzetet nyitja meg, GitHub-link nélkül.
   - Egy új Telegram-recept után a jegyzet frontmatterében `origin: telegram` áll, és a bot linkje `/notes/<videóazonosító>/…` alakú.
   - Ha a peter-mba alszik, a lap a „nem érhető el” üzenetet adja.
