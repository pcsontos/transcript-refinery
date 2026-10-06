# Summary a vaultba — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saját chat YouTube-címe továbbra is az R2-be teszi a feliratot. A kész üzenet `summary` gombjára a konténer a meglévő `summary` receptet futtatja, a `_summary.md` a vaultba kerül, és a bot a jegyzet GitHub-linkjét küldi.

**Architecture:** A Worker ajtó marad. A felirat-lépés a mai `runJob` fetch-út. A summary lépés ugyanaz a `POST /jobs`, `recipe: "summary"` mezővel: az R2-készletből munkaállományt ír a `SERVE_OUT` mappába, a `runSummary` hatás a meglévő `commandRun`-t hívja erre az egy mappára, commitol és pushol, majd a GitHub-linket visszahívja. A D1 `phase` mezője választja szét a két lépést. A gombkoppintás feltételes írással indul, hogy két egyidejű koppintásból egy munka legyen.

**Tech Stack:** Node.js `>=26.2.0`, TypeScript, Vitest, `node:http`, `node:fs`, `node:child_process`. Cloudflare Worker és D1 a `worker/` csomagban. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-05-telegram-summary-spec.md`

Az implementáció a `.worktrees/impl-telegram-summary` worktree-n, az `impl-telegram-summary` ágon indul.

## Global Constraints

- Csak a második szelet. A többi recept, a többgombos választó, az olvasó oldal, a Google-kötés, a lejátszási lista, a `_queue.md` és a fiókonkénti költségplafon kimarad. A mostani futás költségőre erre az egy videóra érvényes.
- A felirat-lépés a mai fetch-út. A csővezetéket és a `.state/refinery.db` fájlt nem nyitja meg. Új config-kulcs nincs. Az `src/index.ts` barrelt ez a szelet sem bővíti.
- A `POST /jobs` teste a mai `{ jobId, videoId, url }`. A summary hozzáteszi: `recipe: "summary"`. Más `recipe` érték `202` után `failed`, a mondat `Ismeretlen recept.`
- A D1 státuszai maradnak: `queued`, `waiting`, `accepted`, `ready`, `failed`. A `phase` értéke `subtitle` vagy `summary`. A meglévő sorok `subtitle` fázisban maradnak. A `ready` sort a cron nem ébreszti. A nyitott sort a mai tizenöt perces szabály ébreszti. Summary fázisban a kopogtatás `recipe` mezője `summary`.
- A gomb felirata `summary`, az adata `summary:<jobId>`. Csak a felirat kész üzenetén van. Az üzenet szövegében álló `summary` szó nem munka.
- A jegyzet kész üzenete két sor: `<cím>. A jegyzet megvan.` és a `noteUrl`. Akkor is, ha modellhívás nem történt.
- A `noteUrl` csak sikeres push és összerakható link után megy ki. Alakja: `https://github.com/<tulaj>/<repo>/blob/<ág>/<útvonal>`. Az útvonal szegmensei kódolva vannak. A `.git` végződés elhagyható. A két elfogadott `origin` alak: `git@github.com:tulaj/repo.git` és `https://github.com/tulaj/repo.git`.
- A forrás neve a `SERVE_OUT` utolsó szegmense. Más config-forrás mappát a summary lépés nem olvas. Az elem azonosítója a videóazonosító. A munkaállomány a visszahívás előtt törlődik. A törlés hibája a visszahívást nem cseréli le.
- Mondatok, szó szerint: `A felirat nincs az R2-ben.` `A felirat nem olvasható az R2-ből.` `A vault frissítése nem sikerült.` `A push nem sikerült, a commit lokálisan maradt.` `A vault távoli címe nem GitHub-cím.` `Ismeretlen recept.` `A jegyzet linkje hiányzik.` `A jegyzet nem készült el.` Az utolsó csak akkor, ha a futás kilépője `0`, és a `_summary.md` még sincs a vaultban.
- A CLI saját megállásának mondata egy sor, a naplóból. A `run:aborted` sora: `A futás megállt: <reason> (<spent> $ / <limit> $)`, négy tizedessel. Az `item:failed` `error` mezőjének első sora megy ki.
- A teszt nem éri el a YouTube-ot, a Telegramot, az R2-t, a LiteLLM-et, és nem épít Docker-képet. Új tesztfüggőség nincs. A feladat végén az adott tesztfájl zöld, az utolsó feladat végén a `pnpm test` és a `pnpm typecheck` is.
- A `SummaryGit` a `runSummary` paraméterének típusa a `src/serve/summary.ts` fájlban, export nélkül. A `command.ts` az alap git-függvényeket hívja. Második git-megvalósítás nincs.
- A futás mondatát a `src/serve/summary.ts` helyi függvénye olvassa: a `logsDir` legutóbbi `.jsonl` fájlja, `run:aborted` és `item:failed`. Külön naplóolvasó modul nincs.
- A `serveEffects` gyártó a `src/serve/command.ts` fájlban marad, mert a teszt így nem indít szervert. Recept-regiszter nincs. A `memoryStore` másolata a `src/serve/command.test.ts` fájlban marad másolat. Közös teszt-segéd fájl nincs. A `src/serve/note-url.ts` külön fájl marad.

## Review Focus

Ezek a bemenetek egy elnézett ágon kétszer hívják a modellt, rossz linket küldenek, vagy a felirat-lépést törik el. Mindegyikhez a tulajdonos feladat tartalmaz tesztet.

1. Két egyidejű `summary` koppintásból egy kopogtatás indul, a másik a foglalt mondatot kapja. (5. feladat)
2. A summary `ready` test `noteUrl` nélkül nem küld linket. A sor csak a mondat sikeres küldése után `failed`. (4. feladat)
3. A push hibája után nincs GitHub-link, a commit a gépen marad. (8. feladat)
4. A címben lévő `/` egy fájlnév marad a `SERVE_OUT` gyökerében, a fetch nem indul. (7. feladat)
5. Az ismételt gomb-`update_id` nem kopogtat és nem üzen. A felirat fázisú cron recept nélkül kopogtat. (5. feladat)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/serve/note-url.ts` | Az `origin`, az ág és a vaultbeli út blob-linkje |
| `src/serve/summary.ts` | A summary hatás: pull, `commandRun`, commit, push, link |
| `src/serve/job.ts` | A `recipe` ág: R2-készlet, munkaállomány, hatás, törlés, visszahívás |
| `src/serve/http.ts` | A `recipe` mező elfogadása a testben |
| `src/serve/command.ts` | A hatás bekötése a `SERVE_OUT` mappára |
| `worker/src/store.ts` | `phase`, `noteUrl`, `noteNotified`, `claim`, `rememberUpdate` |
| `worker/src/d1.ts` | Ugyanez D1-ben |
| `worker/migrations/0002_summary.sql` | A három oszlop és a látott frissítések táblája |
| `worker/src/messages.ts` | A jegyzet mondata és a hiányzó link mondata |
| `worker/src/plan.ts` | A gomb adata és a koppintás döntése |
| `worker/src/handle.ts` | Kész üzenet gombbal, summary visszahívás, koppintás, cron |
| `worker/src/index.ts` | `callback_query`, üres gombválasz, a gomb a `sendMessage` testében |

---

### Task 1: A GitHub-link

**Files:**
- Create: `src/serve/note-url.ts`
- Test: `src/serve/note-url.test.ts`

**Interfaces:**
- Consumes: semmit.
- Produces: `export function githubNoteUrl(remote: string, branch: string, vaultRelativePath: string): string | null`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { githubNoteUrl } from './note-url.js'

const path = 'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md'

describe('githubNoteUrl', () => {
  it('a két origin alak, .git végződéssel és anélkül, ugyanazt a linket adja', () => {
    const expected =
      'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_summary.md'
    expect(githubNoteUrl('git@github.com:tulaj/repo.git', 'main', path)).toBe(expected)
    expect(githubNoteUrl('git@github.com:tulaj/repo', 'main', path)).toBe(expected)
    expect(githubNoteUrl('https://github.com/tulaj/repo.git', 'main', path)).toBe(expected)
    expect(githubNoteUrl('https://github.com/tulaj/repo', 'main', path)).toBe(expected)
  })

  it('más origin null', () => {
    expect(githubNoteUrl('https://gitlab.com/tulaj/repo.git', 'main', path)).toBeNull()
    expect(githubNoteUrl('nem-cím', 'main', path)).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/note-url.test.ts`
Expected: FAIL, a `./note-url.js` modul nem létezik.

- [x] **Step 3: Write minimal implementation**

```ts
const REMOTE = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/

export function githubNoteUrl(remote: string, branch: string, vaultRelativePath: string): string | null {
  const match = REMOTE.exec(remote.trim())
  if (match?.[1] === undefined || match[2] === undefined) return null
  const segments = vaultRelativePath.split('/').filter((segment) => segment !== '').map(encodeURIComponent)
  return `https://github.com/${match[1]}/${match[2]}/blob/${encodeURIComponent(branch)}/${segments.join('/')}`
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/note-url.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/serve/note-url.ts src/serve/note-url.test.ts
git commit -m "feat(serve): build the vault note's GitHub URL"
```

---

### Task 2: A sor fázisa

**Files:**
- Modify: `worker/src/store.ts`
- Modify: `worker/src/d1.ts`
- Modify: `worker/src/plan.test.ts`
- Modify: `worker/src/handle.test.ts`
- Modify: `worker/src/entry.test.ts`
- Create: `worker/migrations/0002_summary.sql`

**Interfaces:**
- Consumes: a mai `JobRow` és `JobStore`.
- Produces:
  - `export type JobPhase = 'subtitle' | 'summary'`
  - `JobRow` új mezői: `phase: JobPhase`, `noteUrl: string | null`, `noteNotified: boolean`
  - `claim(jobId: string, expect: { phase: JobPhase; status: JobStatus }, next: { phase: JobPhase; status: JobStatus }): Promise<JobRow | null>`
  - `rememberUpdate(updateId: number): Promise<boolean>` — `true`, ha ez az `update_id` először látszik

- [x] **Step 1: Write the failing test**

A `worker/src/plan.test.ts` `row` segédje kapja meg a három alapértéket: `phase: 'subtitle'`, `noteUrl: null`, `noteNotified: false`. A `memoryStore` blokk végére ez a teszt kerül:

```ts
it('a claim csak a várt állapotból ír, a rememberUpdate egyszer enged', async () => {
  const store = memoryStore()
  await store.insert(row({ status: 'ready', phase: 'subtitle' }))
  const lost = await store.claim(
    `1:${ID}`,
    { phase: 'summary', status: 'ready' },
    { phase: 'summary', status: 'queued' },
  )
  expect(lost).toBeNull()
  const won = await store.claim(
    `1:${ID}`,
    { phase: 'subtitle', status: 'ready' },
    { phase: 'summary', status: 'queued' },
  )
  expect(won?.phase).toBe('summary')
  expect(won?.status).toBe('queued')
  expect(won?.error).toBeNull()
  expect(won?.acceptedAt).toBeNull()
  const again = await store.claim(
    `1:${ID}`,
    { phase: 'subtitle', status: 'ready' },
    { phase: 'summary', status: 'queued' },
  )
  expect(again).toBeNull()
  expect(await store.rememberUpdate(9)).toBe(true)
  expect(await store.rememberUpdate(9)).toBe(false)
  await store.insert(row({ jobId: `4:${ID}`, updateId: 4, status: 'queued', phase: 'summary' }))
  expect(await store.activeByVideo(ID)).not.toBeNull()
})
```

A `worker/src/entry.test.ts` migrációs tesztje olvassa a `worker/migrations/0002_summary.sql` fájlt is, és várja a `phase`, a `note_url`, a `note_notified` és a `seen_updates` szöveget.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/plan.test.ts worker/src/entry.test.ts`
Expected: FAIL, a `claim` nincs a táron. A `handle.test.ts` fordítási hibája a hiányzó `JobRow` mező. Minden ottani objektumliterál kapja: `phase: 'subtitle'`, `noteUrl: null`, `noteNotified: false`.

- [x] **Step 3: Write minimal implementation**

A `worker/migrations/0002_summary.sql` tartalma:

```sql
ALTER TABLE jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'subtitle';
ALTER TABLE jobs ADD COLUMN note_url TEXT;
ALTER TABLE jobs ADD COLUMN note_notified INTEGER NOT NULL DEFAULT 0;
CREATE TABLE seen_updates (
  update_id INTEGER PRIMARY KEY
);
```

A `memoryStore` tömbje mellé egy `Set<number>` kerül. A `claim` csak akkor ír, ha a sor `phase` és `status` mezője a várt. Ilyenkor `phase`, `status`, `error: null`, `acceptedAt: null`. A `rememberUpdate` a halmazba teszi az azonosítót, és `false`, ha már benne volt. Az `insert` és a `save` a három új mezőt is tárolja.

A `d1.ts` `JobRecord` és `toRow` a `phase`, `note_url`, `note_notified` oszlopokat viszi. Az `insert` és a `save` SQL-je is. A `claim` egy feltételes `UPDATE`, utána `SELECT`. A `run()` eredményének `meta.changes` értéke `1`, különben `null`. A `rememberUpdate` `INSERT INTO seen_updates (update_id) VALUES (?)`. Egyedi ütközésnél `false`.

A `handle.ts` új sora a három alapértéket írja: `phase: 'subtitle'`, `noteUrl: null`, `noteNotified: false`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/plan.test.ts worker/src/handle.test.ts worker/src/entry.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add worker/src/store.ts worker/src/d1.ts worker/src/handle.ts worker/src/plan.test.ts worker/src/handle.test.ts worker/src/entry.test.ts worker/migrations/0002_summary.sql
git commit -m "feat(worker): remember the summary phase on a job"
```

---

### Task 3: A koppintás döntése

**Files:**
- Modify: `worker/src/messages.ts`
- Modify: `worker/src/plan.ts`
- Modify: `worker/src/plan.test.ts`

**Interfaces:**
- Consumes: `JobRow` a 2. feladatból. `readyLine`, `alreadyLine`.
- Produces:
  - `export const MISSING_NOTE_URL = 'A jegyzet linkje hiányzik.'`
  - `export function noteReadyMessage(title: string, noteUrl: string): string`
  - `export function summaryButton(jobId: string): { text: 'summary'; data: string }`
  - `export type TapAction = { type: 'start' } | { type: 'retry' } | { type: 'busy' } | { type: 'resend' } | { type: 'ignore' }`
  - `export function decideTap(row: JobRow | null, owner: boolean): TapAction`

- [x] **Step 1: Write the failing test**

```ts
it('a jegyzet mondata két sor, a gomb adata a munka azonosítója', () => {
  expect(noteReadyMessage('Cím', 'https://github.com/tulaj/repo/blob/main/a.md')).toBe(
    'Cím. A jegyzet megvan.\nhttps://github.com/tulaj/repo/blob/main/a.md',
  )
  expect(summaryButton(`1:${ID}`)).toEqual({ text: 'summary', data: `summary:1:${ID}` })
  expect(MISSING_NOTE_URL).toBe('A jegyzet linkje hiányzik.')
})

it('a koppintás a fázis és a státusz szerint dönt', () => {
  expect(decideTap(null, true)).toEqual({ type: 'ignore' })
  expect(decideTap(row({ status: 'ready' }), false)).toEqual({ type: 'ignore' })
  expect(decideTap(row({ status: 'ready', phase: 'subtitle' }), true)).toEqual({ type: 'start' })
  expect(decideTap(row({ status: 'accepted', phase: 'summary' }), true)).toEqual({ type: 'busy' })
  expect(decideTap(row({ status: 'ready', phase: 'summary', noteNotified: true }), true)).toEqual({ type: 'resend' })
  expect(decideTap(row({ status: 'failed', phase: 'summary' }), true)).toEqual({ type: 'retry' })
  expect(decideTap(row({ status: 'queued', phase: 'subtitle' }), true)).toEqual({ type: 'ignore' })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/plan.test.ts`
Expected: FAIL, a `decideTap` nincs exportálva.

- [x] **Step 3: Write minimal implementation**

```ts
export const MISSING_NOTE_URL = 'A jegyzet linkje hiányzik.'

export function noteReadyMessage(title: string, noteUrl: string): string {
  return `${title}. A jegyzet megvan.\n${noteUrl}`
}

export function summaryButton(jobId: string): { text: 'summary'; data: string } {
  return { text: 'summary', data: `summary:${jobId}` }
}
```

A `decideTap` sorrendje: `row === null` vagy `owner === false` esetén `{ type: 'ignore' }`. `phase === 'subtitle' && status === 'ready'` esetén `{ type: 'start' }`. `phase === 'summary'` és a státusz `queued`, `waiting` vagy `accepted` esetén `{ type: 'busy' }`. `phase === 'summary' && status === 'ready' && noteNotified` esetén `{ type: 'resend' }`. `phase === 'summary' && status === 'failed'` esetén `{ type: 'retry' }`. Minden más `{ type: 'ignore' }`.

A `plan.ts` a `messages.ts` új neveit is újraexportálja, ahogy a mai mondatokat.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/plan.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add worker/src/messages.ts worker/src/plan.ts worker/src/plan.test.ts
git commit -m "feat(worker): decide what a summary tap does"
```

---

### Task 4: A kész üzenet és a summary visszahívás

**Files:**
- Modify: `worker/src/handle.ts`
- Modify: `worker/src/handle.test.ts`

**Interfaces:**
- Consumes: `noteReadyMessage`, `summaryButton`, `MISSING_NOTE_URL`, `readyLine`, a `JobRow` új mezői.
- Produces: a `handleCallback` a felirat kész üzenetéhez gombot kér, a summary fázisú kész testet a linküzenettel zárja. A `WorkerDeps.send` második, elhagyható paramétere: `{ text: string; data: string }`.

- [x] **Step 1: Write the failing test**

A teszt `deps` segédjének `send` függvénye a második paramétert is feljegyzi egy `buttons` tömbbe. Az alap `send` továbbra is a szöveget teszi a `sent` tömbbe.

```ts
it('a felirat kész üzenete summary gombot kap', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow())
  const ok = deps(store)
  await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
  expect(ok.sent).toEqual(['Cím. A felirat megvan.'])
  expect(ok.buttons).toEqual([{ text: 'summary', data: `summary:5:${ID}` }])
})

it('a summary kész linkje kimegy, noteUrl nélkül a mondat failed', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow({ phase: 'summary' }))
  const missing = deps(store)
  await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, missing)
  expect(missing.sent).toEqual(['A jegyzet linkje hiányzik.'])
  expect((await store.listByUpdate(5))[0]?.status).toBe('failed')

  const quiet = memoryStore()
  await quiet.insert(acceptedRow({ phase: 'summary' }))
  const held = deps(quiet, { send: () => Promise.resolve(false) })
  await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, held)
  expect((await quiet.listByUpdate(5))[0]?.status).toBe('accepted')

  const unsent = memoryStore()
  await unsent.insert(acceptedRow({ phase: 'summary' }))
  const dropped = deps(unsent, { send: () => Promise.resolve(false) })
  const keptUrl = 'https://github.com/tulaj/repo/blob/main/a_summary.md'
  await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím', noteUrl: keptUrl }, dropped)
  const kept = (await unsent.listByUpdate(5))[0]
  expect(kept?.status).toBe('accepted')
  expect(kept?.noteUrl).toBe(keptUrl)
  expect(kept?.noteNotified).toBe(false)

  const linked = memoryStore()
  await linked.insert(acceptedRow({ phase: 'summary' }))
  const ok = deps(linked)
  const url = 'https://github.com/tulaj/repo/blob/main/a_summary.md'
  await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím', noteUrl: url }, ok)
  expect(ok.sent).toEqual([`Cím. A jegyzet megvan.\n${url}`])
  const row = (await linked.listByUpdate(5))[0]
  expect(row?.status).toBe('ready')
  expect(row?.noteNotified).toBe(true)
  expect(row?.noteUrl).toBe(url)

  const repeat = deps(linked)
  await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím', noteUrl: url }, repeat)
  expect(repeat.sent).toEqual([])
})
```

Az `acceptedRow` a mai `handleCallback` teszt sorát adja, `phase: 'subtitle'` alapértékkel. A második paraméter felülírja.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/handle.test.ts`
Expected: FAIL, a gomb tömb üres, és a `noteUrl` nincs a visszahívás típusán.

- [x] **Step 3: Write minimal implementation**

A `handleCallback` kész ága a sor `phase` mezője szerint megy.

Summary fázis, `body.status === 'ready'`: ha `row.noteNotified`, visszatér `200` küldés nélkül. Ha `body.noteUrl` hiányzik vagy üres, elküldi a `MISSING_NOTE_URL` mondatot. Sikertelen küldésnél a sor `accepted` marad. Sikeres küldésnél `status: 'failed'`, `error` a mondat. Ha van `noteUrl`, a sor `title` és `noteUrl` mezője megkapja, majd a `noteReadyMessage` kimegy gomb nélkül. Sikertelen küldésnél a státusz `accepted`, a `noteNotified` hamis, a `noteUrl` megmarad. Sikeres küldésnél `status: 'ready'`, `noteNotified: true`.

Felirat fázis: a mai ág, a `send` második paramétere `summaryButton(row.jobId)`. A `noteUrl` mezőt ez az ág nem olvassa.

A visszahívás típusa a `handle.ts` és az `index.ts` `isCallback` függvényében: `ready` mellett a `title` szöveg, és ha a `noteUrl` jelen van, az is szöveg. Hiányzó `noteUrl` érvényes.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/handle.test.ts`
Expected: PASS. A régi kész-üzenet teszt továbbra is a `Cím. A felirat megvan.` szöveget várja.

- [x] **Step 5: Commit**

```bash
git add worker/src/handle.ts worker/src/handle.test.ts worker/src/index.ts
git commit -m "feat(worker): attach the summary button and accept the note link"
```

---

### Task 5: A gomb és a cron

**Files:**
- Modify: `worker/src/handle.ts`
- Modify: `worker/src/handle.test.ts`

**Interfaces:**
- Consumes: `decideTap`, `claim`, `rememberUpdate`, `alreadyLine`, `noteReadyMessage`, `PlannedKnock`.
- Produces:
  - `export async function handleTap(update: { update_id: number; callback_query: { id: string; data?: string; message?: { chat: { id: number } } } }, deps: WorkerDeps): Promise<PlannedKnock[]>`
  - `PlannedKnock` új, elhagyható mezője: `recipe?: 'summary'`
  - `WorkerDeps.answerTap(callbackQueryId: string): Promise<void>`
  - A `handleCron` summary fázisban `recipe: 'summary'` kopogtatást ad

- [x] **Step 1: Write the failing test**

```ts
it('két ready koppintásból egy summary kopogtatás indul', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow({ status: 'ready', phase: 'subtitle', notifiedReady: true, title: 'Cím' }))
  const first = deps(store)
  const second = deps(store)
  const tap = {
    update_id: 20,
    callback_query: { id: 'cq', data: `summary:5:${ID}`, message: { chat: { id: 42 } } },
  }
  expect(await handleTap(tap, first)).toEqual([
    { jobId: `5:${ID}`, videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, recipe: 'summary' },
  ])
  expect(first.answered).toEqual(['cq'])
  expect(await handleTap({ ...tap, update_id: 21, callback_query: { ...tap.callback_query, id: 'cq2' } }, second)).toEqual([])
  expect(second.sent).toEqual([`Már sorban van: ${ID}.`])
})

it('az ismételt update_id nem kopogtat, a failed gomb újra queued', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow({ status: 'failed', phase: 'summary', error: 'A vault frissítése nem sikerült.' }))
  const depsOnce = deps(store)
  const tap = {
    update_id: 30,
    callback_query: { id: 'cq', data: `summary:5:${ID}`, message: { chat: { id: 42 } } },
  }
  expect(await handleTap(tap, depsOnce)).toHaveLength(1)
  expect(await handleTap(tap, depsOnce)).toEqual([])
  expect((await store.listByUpdate(5))[0]?.status).toBe('queued')
  expect((await store.listByUpdate(5))[0]?.phase).toBe('summary')
})

it('idegen chat és a kiment link nem kopogtat', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow({
    status: 'ready',
    phase: 'summary',
    title: 'Cím',
    noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md',
    noteNotified: true,
  }))
  const foreign = deps(store)
  await handleTap({
    update_id: 40,
    callback_query: { id: 'cq', data: `summary:5:${ID}`, message: { chat: { id: 7 } } },
  }, foreign)
  expect(foreign.knocked).toEqual([])
  expect(foreign.sent).toEqual([])
  expect(foreign.answered).toEqual(['cq'])

  const own = deps(store)
  await handleTap({
    update_id: 41,
    callback_query: { id: 'cq2', data: `summary:5:${ID}`, message: { chat: { id: 42 } } },
  }, own)
  expect(own.sent).toEqual(['Cím. A jegyzet megvan.\nhttps://github.com/tulaj/repo/blob/main/a.md'])
  expect(own.knocked).toEqual([])
  const held = deps(store, { send: () => Promise.resolve(false) })
  await handleTap({
    update_id: 42,
    callback_query: { id: 'cq3', data: `summary:5:${ID}`, message: { chat: { id: 42 } } },
  }, held)
  expect((await store.listByUpdate(5))[0]?.noteNotified).toBe(true)
})

it('a cron a summary fázist recepttel ébreszti, a felirat fázist anélkül', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow({ status: 'queued', phase: 'subtitle' }))
  await store.insert(acceptedRow({
    jobId: `6:${ID}`,
    updateId: 6,
    status: 'queued',
    phase: 'summary',
  }))
  const clock = deps(store)
  await handleCron(clock)
  expect(clock.knocks).toEqual([
    { jobId: `5:${ID}`, videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` },
    { jobId: `6:${ID}`, videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, recipe: 'summary' },
  ])
})

it('a 401 a summary fázist failedre teszi, a fázis summary marad', async () => {
  const store = memoryStore()
  await store.insert(acceptedRow({ status: 'queued', phase: 'summary' }))
  const rejected = deps(store, { knock: () => Promise.resolve(401) })
  await handleCron(rejected)
  const row = (await store.listByUpdate(5))[0]
  expect(row?.status).toBe('failed')
  expect(row?.phase).toBe('summary')
  expect(row?.error).toBe('A konténer elutasította a hívást.')
})
```

A `deps` a `knock` egész testét a `knocks` tömbbe teszi, és az `answerTap` az `answered` tömbbe írja az azonosítót.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/handle.test.ts`
Expected: FAIL, a `handleTap` nincs exportálva.

- [x] **Step 3: Write minimal implementation**

A `handleTap` először meghívja a `deps.answerTap(callback_query.id)` függvényt. Utána a `rememberUpdate`. Ha `false`, üres tömb. Ha a chat nem a `ownerChatId`, üres tömb. A `data` eleje `summary:`, a maradék a `jobId`. A `decideTap` eredménye:

- `busy`: kimegy az `alreadyLine(row.videoId)`, kopogtatás nincs.
- `resend`: ha `title` és `noteUrl` van, kimegy a `noteReadyMessage`. A `noteNotified` nem változik. Kopogtatás nincs.
- `ignore`: üres tömb.
- `start`: `claim(jobId, { phase: 'subtitle', status: 'ready' }, { phase: 'summary', status: 'queued' })`.
- `retry`: `claim(jobId, { phase: 'summary', status: 'failed' }, { phase: 'summary', status: 'queued' })`.

Ha a `claim` `null`, kimegy az `alreadyLine`, kopogtatás nincs. Ha sort ad, a visszatérő kopogtatás `{ jobId, videoId, url, recipe: 'summary' }`.

A `handleCron` a mai kopogtatást adja. Ha `row.phase === 'summary'`, a test `recipe` mezője `'summary'`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/handle.test.ts worker/src/plan.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add worker/src/handle.ts worker/src/handle.test.ts
git commit -m "feat(worker): start the summary from the button"
```

---

### Task 6: A Worker belépése

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: `handleTap`, `PlannedKnock.recipe`, `answerTap`, a `send` gombparamétere.
- Produces: a `/telegram` út a `callback_query` frissítést a `handleTap` felé viszi. Az `answerCallbackQuery` üres testű. A `sendMessage` a gombot `reply_markup.inline_keyboard` alatt küldi. A kopogtatás JSON-ja a `recipe` mezőt is viszi, ha van.

- [x] **Step 1: Write the failing test**

```ts
it('a gombkoppintás üres answerCallbackQuery választ kér, idegen chatnél kopogtatás nélkül', async () => {
  const calls: { url: string; body: string }[] = []
  globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    return Promise.resolve(new Response(null, { status: 200 }))
  }
  const request = new Request('https://worker.test/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'hook' },
    body: JSON.stringify({
      update_id: 50,
      callback_query: { id: 'cq', data: 'summary:5:abcdefghijk', message: { chat: { id: 7 } } },
    }),
  })
  const response = await worker.fetch(request, env, { waitUntil: () => undefined })
  expect(response.status).toBe(200)
  expect(calls.map((call) => call.url)).toEqual([
    'https://api.telegram.org/bottoken/answerCallbackQuery',
  ])
  expect(JSON.parse(calls[0]!.body)).toEqual({ callback_query_id: 'cq' })
})
```

Az `env` a fájlban már meglévő tesztkörnyezet. A `waitUntil` azonnal futtatja a kapott ígéretet, hogy a kopogtatás hiánya látszódjon.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/entry.test.ts`
Expected: FAIL, a hívások üresek.

- [x] **Step 3: Write minimal implementation**

Az `isTap` igaz, ha az `update_id` szám, és a `callback_query.id` szöveg. A `/telegram` ág az `isTap` vizsgálatot az `isUpdate` elé teszi. Igaz ágon meghívja a `handleTap` függvényt, a kopogtatásokat a `ctx.waitUntil(applyKnocks(...))` viszi, és `200` a válasz.

A `deps.answerTap` a `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery` címre `POST` `{ callback_query_id }` testet küld. A hiba elnyelődik.

A `deps.send` a mai `sendMessage` testét küldi. Ha a második paraméter megvan, a test `reply_markup` mezője `{ inline_keyboard: [[{ text, callback_data: data }]] }`.

A `deps.knock` a mai fetch. A `JSON.stringify(job)` a `recipe` mezőt is viszi, mert az a `PlannedKnock` része.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/entry.test.ts worker/src/handle.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/entry.test.ts
git commit -m "feat(worker): route the summary button through the webhook"
```

---

### Task 7: A summary munka a serve-ben

**Files:**
- Modify: `src/serve/job.ts`
- Modify: `src/serve/job.test.ts`
- Modify: `src/serve/http.ts`
- Modify: `src/serve/http.test.ts`

**Interfaces:**
- Consumes: `remoteReady` a `job.ts`-ben, `deletePair`, `ObjectStore`.
- Produces:
  - `ServeJob.recipe?: string`
  - `export type SummaryOutcome = { ok: true; noteUrl: string } | { ok: false; error: string }`
  - `JobEffects` új, elhagyható mezői: `outDir?: string`, `writeFile?: (path: string, body: Uint8Array) => Promise<void>`, `summarize?: (videoId: string) => Promise<SummaryOutcome>`
  - A `runJob` recept nélkül a mai fetch. `recipe: "summary"` mellett a hatás fut, YouTube nélkül.

- [x] **Step 1: Write the failing test**

```ts
it('a summary teljes R2-készletnél nem hív fetch-et, és a linket visszahívja', async () => {
  const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Kész cím', language: 'hu' }))
  const vtt = new TextEncoder().encode('WEBVTT\n')
  const store = memoryStore({
    [`videos/${ID}/hu.vtt`]: vtt,
    [`videos/${ID}/info.json`]: info,
  })
  const written: { path: string; body: Uint8Array }[] = []
  const callbacks: CallbackBody[] = []
  let summarized = 0
  await runJob({ ...job, recipe: 'summary' }, {
    store,
    languages: ['hu', 'en'],
    outDir: '/data/telegram',
    readPair: () => Promise.resolve(pair({})),
    deletePair: () => {
      written.push({ path: 'deleted', body: new Uint8Array() })
      return Promise.resolve()
    },
    readFile: () => Promise.resolve(new Uint8Array()),
    writeFile: (path, body) => {
      written.push({ path, body })
      return Promise.resolve()
    },
    fetchSubtitle: () => {
      throw new Error('fetch')
    },
    summarize: () => {
      summarized += 1
      return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a_summary.md' })
    },
    callback: (_id, body) => {
      callbacks.push(body)
      return Promise.resolve()
    },
  })
  expect(summarized).toBe(1)
  expect(written.map((item) => item.path).sort()).toEqual([
    '/data/telegram/Kész cím [abcdefghijk].hu.vtt',
    '/data/telegram/Kész cím [abcdefghijk].info.json',
    'deleted',
  ].sort())
  expect(callbacks).toEqual([
    { status: 'ready', title: 'Kész cím', noteUrl: 'https://github.com/tulaj/repo/blob/main/a_summary.md' },
  ])
})

it('a cím perjele egy fájlnév marad', async () => {
  const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'A/B', language: 'hu' }))
  const store = memoryStore({
    [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
    [`videos/${ID}/info.json`]: info,
  })
  const paths: string[] = []
  await runJob({ ...job, recipe: 'summary' }, effectsWith(store, paths))
  expect(paths).toContain('/data/telegram/A⧸B [abcdefghijk].hu.vtt')
  expect(paths).toContain('/data/telegram/A⧸B [abcdefghijk].info.json')
})

it('hiányos R2-nél nincs fetch és nincs summary', async () => {
  const store = memoryStore()
  const callbacks: CallbackBody[] = []
  await runJob({ ...job, recipe: 'summary' }, {
    ...emptyEffects(store),
    callback: (_id, body) => {
      callbacks.push(body)
      return Promise.resolve()
    },
  })
  expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nincs az R2-ben.' }])
})

it('az olvashatatlan R2 a saját mondatát adja', async () => {
  const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
  const store = memoryStore({ [`videos/${ID}/info.json`]: info, [`videos/${ID}/hu.vtt`]: new Uint8Array([1]) })
  store.get = () => Promise.resolve(null)
  const callbacks: CallbackBody[] = []
  await runJob({ ...job, recipe: 'summary' }, {
    ...emptyEffects(store),
    callback: (_id, body) => {
      callbacks.push(body)
      return Promise.resolve()
    },
  })
  expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nem olvasható az R2-ből.' }])
})

it('a törlés hibája a kész linket nem cseréli le', async () => {
  const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Cím', language: 'hu' }))
  const store = memoryStore({
    [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
    [`videos/${ID}/info.json`]: info,
  })
  const callbacks: CallbackBody[] = []
  await runJob({ ...job, recipe: 'summary' }, {
    ...emptyEffects(store),
    summarize: () => Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' }),
    deletePair: () => Promise.reject(new Error('a lemez tele')),
    callback: (_id, body) => {
      callbacks.push(body)
      return Promise.resolve()
    },
  })
  expect(callbacks).toEqual([
    { status: 'ready', title: 'Cím', noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' },
  ])
})

it('a más recept failed, fetch nélkül', async () => {
  const callbacks: CallbackBody[] = []
  await runJob({ ...job, recipe: 'qa' }, {
    ...emptyEffects(memoryStore()),
    callback: (_id, body) => {
      callbacks.push(body)
      return Promise.resolve()
    },
  })
  expect(callbacks).toEqual([{ status: 'failed', error: 'Ismeretlen recept.' }])
})
```

A két segéd a tesztfájlban:

```ts
function emptyEffects(store: ReturnType<typeof memoryStore>): JobEffects {
  return {
    store,
    languages: ['hu', 'en'],
    outDir: '/data/telegram',
    readPair: () => Promise.resolve(pair({})),
    deletePair: () => Promise.resolve(),
    readFile: () => Promise.resolve(new Uint8Array()),
    writeFile: () => Promise.resolve(),
    fetchSubtitle: () => Promise.reject(new Error('fetch')),
    summarize: () => Promise.reject(new Error('summary')),
    callback: () => Promise.resolve(),
  }
}

function effectsWith(store: ReturnType<typeof memoryStore>, paths: string[]): JobEffects {
  return {
    ...emptyEffects(store),
    writeFile: (path) => {
      paths.push(path)
      return Promise.resolve()
    },
    summarize: () => Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' }),
  }
}
```

A `CallbackBody` kész ága elhagyható `noteUrl` szöveget kap. A `JobEffects` importja a tesztbe kerül.

A `src/serve/http.test.ts` egy esete: a `{ jobId, videoId, url, recipe: 'summary' }` test `202`, és az `onJob` ezt a `recipe` mezőt látja. A `recipe: 1` test `400`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/job.test.ts src/serve/http.test.ts`
Expected: FAIL, a `recipe` nincs a `ServeJob` típuson.

- [x] **Step 3: Write minimal implementation**

A `runJob` elején, ha `job.recipe !== undefined`, a summary ág fut, és a függvény visszatér. A mai fetch-út ettől nem változik.

A summary ág:

1. `recipe !== 'summary'` → `failed`, `Ismeretlen recept.`
2. `remoteReady`. Ha nem teljes → `deletePair`, majd `failed`, `A felirat nincs az R2-ben.` Fetch és `summarize` nincs.
3. `materialize`. A cím a `sanitizeSegment(remote.title)`. A feliratfájl neve `<cím> [<videóazonosító>].<nyelv>.<kiterjesztés>`, az info neve `<cím> [<videóazonosító>].info.json`, mindkettő az `outDir` gyökerében. Az R2-kulcs neve a `job.ts` `SUB_NAME` kifejezése. Üres vagy hiányzó `get`, hiányzó `outDir`, `writeFile` vagy `summarize`, és a `writeFile` dobása egyaránt `A felirat nem olvasható az R2-ből.` Utána `deletePair`.
4. `summarize(videoId)`. Dobásnál a hiba első sora a `failed` mondat. Utána `deletePair`. A `deletePair` dobása csak napló, a már eldöntött test megy ki.
5. `ok: true` → `{ status: 'ready', title: remote.title, noteUrl }`. `ok: false` → `{ status: 'failed', error }`.

A `http.ts` `isJob` a három mai mező mellett elfogadja a hiányzó `recipe` értéket. Ha jelen van, szövegnek kell lennie, és a visszaadott munka viszi. A `createServeServer` `onJob` ezt a testet kapja.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/job.test.ts src/serve/http.test.ts`
Expected: PASS. A recept nélküli fetch tesztek zöldek.

- [x] **Step 5: Commit**

```bash
git add src/serve/job.ts src/serve/job.test.ts src/serve/http.ts src/serve/http.test.ts
git commit -m "feat(serve): run a summary job from the R2 pair"
```

---

### Task 8: A summary hatás

**Files:**
- Create: `src/serve/summary.ts`
- Create: `src/serve/summary.test.ts`

**Interfaces:**
- Consumes: `githubNoteUrl` az 1. feladatból, `commandRun`, `loadConfig`, `readConfigFile`, `gitPullFfOnly`, `gitCommitPaths`, `gitPush`, `noteFile`, `splitSubtitleName`.
- Produces:
  - A `SummaryGit` nem exportált típus a `summary.ts` fájlban: `{ pull(repo: string): Promise<void>; commit(repo: string, paths: readonly string[], message: string): Promise<boolean>; push(repo: string): Promise<{ pushed: boolean }>; remote(repo: string): Promise<string>; branch(repo: string): Promise<string> }`. Második git-megvalósítás nincs.
  - `export async function runSummary(input: { videoId: string; outDir: string; createClient?: RunRuntime['createClient']; git?: SummaryGit; load?: () => Promise<{ cfg: Config; raw: unknown }> }): Promise<SummaryOutcome>`
  - A `SummaryOutcome` a 7. feladat típusa. A `summary.ts` onnan importálja.

- [x] **Step 1: Write the failing test**

A teszt ideiglenes vaultot és csupasz `origin` repót készít, `main` ággal, `user.email` és `user.name` beállítással. A `LITELLM_API_KEY` a teszt idejére `sk-proba`, utána a régi érték. A forrásmappa egy `Beszéd [abcdefghijk].hu.vtt` és egy `Beszéd [abcdefghijk].info.json`. A felirat egy cue: `Hello from the video.` Az info `id`, `title: 'Beszéd'`, `language: 'hu'`. A `raw` a `cli.test.ts` `rawConfig` alakja, `cost_limit_usd: 5`, a vault útja a teszt vaultja, a `sources` a forrásmappa, a `state` és a `logs` a teszt saját mappája. A `load` ezt adja `loadConfig` eredményével.

A hamis kliens a `generate` hívásokat számolja, és ezt adja: `{ value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n', usage: { inputTokens: 10, outputTokens: 5 } }`. A `generateObject` `{ value: { score: 1, gaps: [] }, usage: { inputTokens: 5, outputTokens: 2 } }`.

```ts
it('a jegyzet a vaultba kerül, a commit csak a két fájlt viszi, a link a summaryra mutat', async () => {
  const calls = { generate: 0 }
  const result = await runSummary({
    videoId: ID,
    outDir,
    createClient: () => client(calls),
    load,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.noteUrl).toBe(
    'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_summary.md',
  )
  const names = execFileSync('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: vault, encoding: 'utf8' })
  expect(names.trim().split('\n').sort()).toEqual([
    'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md',
    'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md',
  ].sort())
  const second = { generate: 0 }
  const again = await runSummary({ videoId: ID, outDir, createClient: () => client(second), load })
  expect(again).toEqual(result)
  expect(second.generate).toBe(0)
})
```

A csupasz remote URL-je `file://` lenne, ezért a teszt a sikeres futásnál a `git` paraméter `remote` függvényét cseréli `https://github.com/tulaj/repo.git` értékre, a `push` a valódi `gitPush`. Egy külön eset a `remote` függvényt `git@github.com:tulaj/repo` értékre cseréli, és ugyanazt a linket várja. A `https://gitlab.com/tulaj/repo.git` a `A vault távoli címe nem GitHub-cím.` mondatot adja, `ok: false`.

A pull teszt a `git.pull` függvényt dobásra cseréli. A `createClient` számlálója `0` marad, a mondat `A vault frissítése nem sikerült.`

A push teszt a valódi futás után `{ pushed: false }` értéket ad. Az eredmény `{ ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' }`. A `git log -1 --name-only` a két jegyzetet mutatja.

A plafon teszt `cost_limit_usd: 0.0001`. Az eredmény `ok: false`, az `error` illeszkedik: `/^A futás megállt: már az első elem becsült költsége/`. A `generate` számláló `0`.

A recept hiba tesztje a `generate` függvényt `Error('szimulált hiba')` dobásra cseréli. Az eredmény `ok: false`, az `error` `szimulált hiba`. A `_transcript.md` a vaultban megvan.

A config teszt `load` függvénye `Error('Nincs konfigurációs fájl: x\nMásodik sor')` hibát dob. Az eredmény `{ ok: false, error: 'Nincs konfigurációs fájl: x' }`. A `createClient` nem hívódik.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/summary.test.ts`
Expected: FAIL, a `./summary.js` modul nem létezik.

- [x] **Step 3: Write minimal implementation**

A `runSummary` sorrendje:

1. `load`. Dobásnál az első sor a hiba.
2. `git.pull(cfg.vaultPath)`. Dobásnál `A vault frissítése nem sikerült.` A modellkliens ettől a ponttól még nem készül.
3. A `commandRun` configja a betöltött config másolata, egyetlen forrással: `{ name: basename(outDir), path: outDir }`. A zászlók: `recipe: 'summary'`, `dryRun: false`, `force: false`, `commit: false`, `command: 'serve summary'`. A `createClient` a hívóé.
4. Ha a kilépő nem `0`, a mondatot a `summary.ts` helyi függvénye adja, külön modul nélkül. A `logsDir` legutóbbi `.jsonl` fájlját olvassa. `run:aborted` esetén `A futás megállt: ${reason} (${spentUsd.toFixed(4)} $ / ${limitUsd.toFixed(4)} $)`. `item:failed` esetén az `error` első sora. Ha egyik sincs, `A futás megállt.`
5. A feliratfájl a `outDir` gyökerében a `splitSubtitleName` alapneve. A `noteFile` adja a `_transcript.md` és a `_summary.md` útját, a forrásnév a mappa neve, a `sourceFile` a fájlnév. A létező utak a `git.commit` listája. Az üzenet: `docs(transcript-refinery): átirat 1 videóhoz`.
6. Sikertelen futásnál is lefut a commit és a push, ha van fájl. Ha a push `pushed: false`, a mondat `A push nem sikerült, a commit lokálisan maradt.` Különben a 4. pont mondata marad.
7. Sikeres futásnál, ha a `_summary.md` nincs a lemezen, a mondat `A jegyzet nem készült el.`
8. Sikeres push után a `githubNoteUrl(remote, branch, vaulthoz képesti posix út)`. `null` esetén `A vault távoli címe nem GitHub-cím.` Különben `{ ok: true, noteUrl }`.

Az alap `git` a `gitPullFfOnly`, a `gitCommitPaths`, a `gitPush`, a `git remote get-url origin` és a `git rev-parse --abbrev-ref HEAD`. A `SummaryGit` típus export nélkül marad a fájlban. A `command.ts` ezt az alapot hívja.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/summary.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/serve/summary.ts src/serve/summary.test.ts
git commit -m "feat(serve): write the summary note and its GitHub link"
```

---

### Task 9: A serve bekötése

**Files:**
- Modify: `src/serve/command.ts`
- Modify: `src/serve/command.test.ts`

**Interfaces:**
- Consumes: `runSummary` a 8. feladatból, a `JobEffects.summarize` és `writeFile` a 7. feladatból.
- Produces: a `refinery serve` a summary kopogtatásra a `runSummary` hatást hívja, a `SERVE_OUT` mappával. A felirat-lépés config nélkül is elindul.

- [x] **Step 1: Write the failing test**

A `command.ts` exportálja a `serveEffects` gyártót. Recept-regiszter nincs. A teszt nem indít szervert és nem hív LiteLLM-et.

```ts
it('a summary hatás a SERVE_OUT mappát és a videóazonosítót adja tovább', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'refinery-serve-'))
  const seen: { videoId: string; outDir: string }[] = []
  const effects = serveEffects({
    outDir,
    languages: ['hu'],
    store: fakeStore,
    fetchSubtitle: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
    callback: () => Promise.resolve(),
    runSummary: (input) => {
      seen.push({ videoId: input.videoId, outDir: input.outDir })
      return Promise.resolve({ ok: true, noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' })
    },
  })
  await effects.writeFile(join(outDir, 'a.vtt'), new Uint8Array([1]))
  await effects.summarize('abcdefghijk')
  expect(seen).toEqual([{ videoId: 'abcdefghijk', outDir }])
  await rm(outDir, { recursive: true })
})
```

A `fakeStore` a `job.test.ts` `memoryStore` üres példánya, ide másolva. Közös teszt-segéd fájl nincs. A `writeFile` és a `summarize` a gyártó visszatérésén kötelező mező.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/command.test.ts`
Expected: FAIL, a `serveEffects` nincs exportálva.

- [x] **Step 3: Write minimal implementation**

A `commandServe` a mai hatásobjektumot a `serveEffects` gyártójától kapja. A gyártó paramétereinek `runSummary` mezője elhagyható, az alapértéke a 8. feladat `runSummary` függvénye, git-paraméter nélkül, tehát az alap git-függvényekkel. Recept-regiszter nincs: a `recipe: "summary"` ág a 7. feladat `runJob` korai visszatérése. A visszaadott hatás `writeFile` és `summarize` mezője kötelező. A `writeFile` létrehozza a szülőmappát, és kiírja a bájtokat. A `summarize` a kapott `runSummary({ videoId, outDir })` hívás. A felirat-lépés továbbra sem hívja. A `loadCliConfig` a nyelvekhez a mai `catch` ágon marad: hiányzó fájlnál `hu,en`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/command.test.ts src/serve/job.test.ts src/serve/summary.test.ts worker/src/handle.test.ts worker/src/entry.test.ts && pnpm test && pnpm typecheck`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/serve/command.ts src/serve/command.test.ts
git commit -m "feat(serve): wire the summary effect into refinery serve"
```
