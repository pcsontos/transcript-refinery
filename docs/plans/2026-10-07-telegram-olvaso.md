# Olvasó (3b) — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A summary linkje egy Access mögötti `/notes/<jobId>/summary` oldalra visz, ami a jegyzetet a vaultból, a GitHub renderelt HTML-jével mutatja. Ugyanígy nyílik a hozzá tartozó `_transcript.md` a `/notes/<jobId>/transcript` címen. A `/notes` a belépett fiók jegyzeteinek listája, videónként mindkét linkkel.

**Architecture:** Új fájl a `worker/src/reader.ts`: a `note_url` → vault-útvonal (a fajtánál a `_summary.md` vég `_<fajta>.md`-re cserélődik), a GitHub-hívás és az oldal-HTML. A tár egy új olvasást kap (`notesFor`), az `index.ts` két új útvonalat, a `handle.ts` a bot linkjének cseréjét. Első lépésként a bot csak privát chatet fogad (#147, M2), mert a `/notes` a sor `sub` értéke szerint mutat, és csoportban a kötés más sorait is átírná. Gyorsítótár nincs.

**Tech Stack:** TypeScript, Vitest, Cloudflare Worker és D1, a GitHub contents API. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-07-telegram-olvaso-spec.md` (az 1. szakasz `/notes` sorai, a 2. szakasz „Az engedélyezés” része, a 3. szakasz, és a 3b sorai az 5. és 6. szakaszban)

Az implementáció az `impl-telegram-olvaso` ágon indul, a `main` ágról, miután ez a terv bekerült.

## Global Constraints

- Csak a 3b és a #147 M2. Az M3–M5, a lapozás, a gyorsítótár és a `refinery serve` változása nincs benne.
- A bot csak privát chatet fogad: ha a `message.chat.id !== message.from.id`, a válasz `200`, sor, üzenet és tárhívás nélkül.
- Útvonalak, pontos, kisbetűs illesztéssel, csak `GET`: `/notes` és `/notes/<jobId>/<fajta>` (`^\/notes\/([^/]+)\/([^/]+)$`). A `/Notes`, a `/notes/`, a `//notes`, a `/notes/<jobId>` fajta nélkül, a `/notes/a/b/c` és a `POST /notes` `404`. A `<jobId>` és a `<fajta>` nem dekódolódik.
- A fajták: `NOTE_KINDS = ['summary', 'transcript']`, ebben a sorrendben. Ismeretlen fajta `404`. A 4. szelet bővíti a listát.
- Az azonosító a 3a `identity(ctx)` függvénye. Ha `null`, a válasz `403`, a tár és a GitHub hívása nélkül.
- A lista a belépett `sub` sorai, amelyeknek van `note_url` értéke, az `accepted_at` szerint csökkenő sorrendben. Soronként `<li>cím · ÉÉÉÉ-HH-NN — <a href="/notes/<jobId>/summary">summary</a> · <a href="/notes/<jobId>/transcript">transcript</a></li>` (UTC dátum). Cím nélküli sornál a videóazonosító a cím.
- Az idegen, a nem létező, a `note_url` nélküli, az idegen előtagú, a nem `_summary.md`-re végződő sor és az ismeretlen fajta válasza ugyanaz: `404`, üres törzs, GitHub-hívás nélkül.
- Az előtag: `https://github.com/<VAULT_REPO>/blob/<encodeURIComponent(VAULT_BRANCH)>/`. A maradék `/` mentén szakaszokra bomlik, mindegyik `decodeURIComponent`. Ha a dekódolás hibát dob, vagy az utolsó szakasz nem `_summary.md`-re végződik, a válasz `404`. A `..` és az üres szakasz szűrése nincs: a `note_url`-t csak a titokkal hívó konténer írja, és a token csak a vault-repót olvassa. Az utolsó szakasz `_summary.md` vége `_<fajta>.md`-re cserélődik.
- A GitHub-hívás: `GET https://api.github.com/repos/<VAULT_REPO>/contents/<szakaszok encodeURIComponent-tel, / jellel>?ref=<encodeURIComponent(VAULT_BRANCH)>`. Fejlécek: `accept: application/vnd.github.html+json`, `authorization: Bearer <VAULT_GITHUB_TOKEN>`, `user-agent: transcript-refinery`.
- A „Megnyitás a GitHubon” link a fajta saját GitHub-címe: `https://github.com/<VAULT_REPO>/blob/<encodeURIComponent(VAULT_BRANCH)>/<a kódolt szakaszok>`. Az oldal `<title>` eleme `<cím> · <fajta>`.
- A Worker által beírt minden érték (cím, GitHub-link, `jobId`, hibamondat) a `escapeHtml` függvényen megy át: `& < > " '` → `&#<kód>;`. A GitHub HTML-je változatlanul kerül az oldalba.
- Mondatok, szó szerint: `Még nincs jegyzet. Küldj egy YouTube-címet a botnak.` · `A jegyzet nincs a vaultban.` (GitHub `404`) · `A vault nem olvasható.` (`401`, `403`) · `A GitHub nem érhető el.` (minden más állapot és a hálózati hiba) · `Megnyitás a GitHubon`. A hibaoldal állapota `502`.
- A summary kész üzenetének második sora `<a kérés originje>/notes/<jobId>/summary`. A `note_url` a D1-ben GitHub-cím marad. A visszahívás teste nem változik.
- A hiányzó `VAULT_*` változó nem dob kivételt: a Worker `''`-t használ helyette, ami `404`-et vagy a hibaoldalt adja.
- A teszt nem éri el a GitHubot, az Accesst és a Cloudflare-t. Új tesztfüggőség nincs.
- Minden feladat végén: `pnpm vitest run worker` zöld, `pnpm exec tsc -p worker/tsconfig.json` hibátlan, `pnpm lint` hibátlan.

## Review Focus

1. A konténer visszahívása más hosztnévre érkezik, mint amit az Access véd: a bot linkje `403`-at adna. A link a visszahívó kérés originjéből jön. (4. feladat, entry-teszt; 6. feladat, 6. lépés.)
2. A GitHub API `User-Agent` nélkül `403`-at ad, ami élesben `A vault nem olvasható.` lenne, miközben a hamis `fetch`-csel minden teszt zöld. (2. feladat, a fejlécek pontos ellenőrzése.)
3. A vault fájlnevei szóközt, szögletes zárójelet, ékezetet és teljes szélességű `：` és `｜` jelet tartalmaznak. A kódolás oda-vissza útja nem rontja el őket. (2. feladat, a `NAME` állandó.)
4. Kitalált vagy más fiókhoz tartozó `jobId`: `404`, ugyanaz, mint a nem létező, és nincs GitHub-hívás. (2. feladat.)
5. A `VAULT_*` titkok még nincsenek feltöltve: `404`, kivétel nélkül. (2. feladat, a `vaultPath(NOTE_URL, '', '', …)` eset.)
6. A transcript a summary-fájl nevéből jön: ha a cserét rossz helyen végzi (például a mappanévben is), más fájlt kér. (2. feladat, a `transcript` útvonal és a GitHub-link pontos ellenőrzése.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `worker/src/handle.ts` | Csak privát chat. A `findRow` exportja. A summary link a `/notes/<jobId>/summary` címre. |
| `worker/src/store.ts`, `worker/src/d1.ts` | `notesFor(sub)` |
| `worker/src/messages.ts` | Az olvasó mondatai |
| `worker/src/reader.ts` | `NOTE_KINDS`, `escapeHtml`, `vaultPath`, `notesPage`, `notePage`, az oldal-HTML |
| `worker/src/index.ts` | A `/notes` útvonalak, a `VAULT_*` változók, a visszahívás originje |
| `.env.example`, `docs/operations/telegram-worker-topology.md` | Az új változók és az olvasó |

Migráció nincs: a `notesFor` a meglévő `sub`, `note_url` és `accepted_at` oszlopot olvassa.

---

### Task 1: A bot csak privát chatet fogad (#147, M2)

**Files:**
- Modify: `worker/src/handle.ts` (`handleUpdate`)
- Test: `worker/src/handle.test.ts` (`kötés` blokk)

**Interfaces:**
- Produces: a `handleUpdate` csoportüzenetre `{ status: 200, knocks: [] }` választ ad, minden mellékhatás nélkül.

- [x] **Step 1: A bukó teszt**

A `worker/src/handle.test.ts` `describe('kötés', …)` blokkjának végére, a „más fiók sorára a gomb nem indít” teszt után:

```ts
  it('csoportban a bot hallgat: a /start <token> nem köt, más sorának sub-ja marad, és a cím nem nyit sort', async () => {
    const store = memoryStore()
    await store.insert(acceptedRow({ chatId: '-100', sub: 'sub-42' }))
    const flow = deps(store)
    await handleUpdate(message(1, 7, '/start'), flow)
    await handleLink(TOKEN_A, { sub: 'sub-7', email: 'en@example.com' }, flow)
    const group = deps(store)
    const result = await handleUpdate(
      { update_id: 2, message: { message_id: 1, chat: { id: -100 }, from: { id: 7 }, text: `/start ${TOKEN_B}` } },
      group,
    )
    expect(result).toEqual({ status: 200, knocks: [] })
    expect(group.sent).toEqual([])
    expect(await store.bindingFor('7')).toBeNull()
    expect((await store.listByUpdate(5))[0]?.sub).toBe('sub-42')

    const bound = await boundStore()
    const groupUrl = deps(bound)
    expect(
      await handleUpdate(
        { update_id: 3, message: { message_id: 1, chat: { id: -100 }, from: { id: 42 }, text: ID } },
        groupUrl,
      ),
    ).toEqual({ status: 200, knocks: [] })
    expect(groupUrl.sent).toEqual([])
    expect(await bound.listByUpdate(3)).toEqual([])
  })
```

A `flow` ugyanazzal a `newToken` számlálóval adja a linktokent (`TOKEN_A`) és a visszatérő tokent (`TOKEN_B`). A visszatérő token a `7`-es felhasználóé, engedélyezett e-maillel, tehát a javítás nélkül a csoportban kötne, és a `-100` chat sorát `sub-7`-re írná.

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker/src/handle.test.ts -t "csoportban a bot hallgat"`
Expected: FAIL. A `group.sent` értéke `['Bekötve: en@example.com.']`, nem `[]`.

- [x] **Step 3: A javítás**

A `worker/src/handle.ts` `handleUpdate` függvényében ezt a sort:

```ts
  if (!message?.from) return { status: 200, knocks: [] }
```

erre cseréld:

```ts
  if (!message?.from) return { status: 200, knocks: [] }
  // A bot csak privát chatre készült: csoportban a kötés a többi tag sorait is átírná.
  if (message.chat.id !== message.from.id) return { status: 200, knocks: [] }
```

- [x] **Step 4: Fusson, menjen át, és a teljes ellenőrzés**

Run: `pnpm vitest run worker && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: minden zöld. A meglévő tesztek mind privát chatet használnak (`chat.id` = `from.id`), ezért nem változnak.

Mutációs próba: töröld ideiglenesen az új `if` sort, és futtasd újra a `-t "csoportban a bot hallgat"` szűrővel. FAIL kell, utána állítsd vissza.

- [x] **Step 5: Commit**

```bash
git add worker/src/handle.ts worker/src/handle.test.ts
git commit -m "fix(worker): Ignore messages outside private chats"
```

---

### Task 2: Az olvasó (tár, mondatok, `reader.ts`)

**Files:**
- Modify: `worker/src/store.ts` (`JobStore`, `memoryStore`)
- Modify: `worker/src/d1.ts` (`createD1Store`)
- Modify: `worker/src/messages.ts`
- Modify: `worker/src/handle.ts` (a `findRow` exportja)
- Create: `worker/src/reader.ts`
- Test: `worker/src/reader.test.ts`

**Interfaces:**
- Consumes: `findRow(store, jobId): Promise<JobRow | null>` a `handle.ts`-ből (eddig privát, most exportált).
- Produces:
  - `JobStore.notesFor(sub: string): Promise<JobRow[]>`: a `sub` sorai `note_url` értékkel, az `acceptedAt` szerint csökkenő sorrendben.
  - `ReaderDeps { store: JobStore; vaultRepo: string; vaultBranch: string; vaultToken: string }`. A GitHubot a globális `fetch` hívja.
  - `NOTE_KINDS: readonly ['summary', 'transcript']`
  - `escapeHtml(text: string): string`
  - `vaultPath(noteUrl: string, repo: string, branch: string, kind: string): string[] | null`: a fajta fájljának dekódolt szakaszai, vagy `null`
  - `notesPage(sub: string, deps: ReaderDeps): Promise<Response>`
  - `notePage(jobId: string, kind: string, sub: string, deps: ReaderDeps): Promise<Response>`

- [x] **Step 1: A bukó tesztek**

Új fájl, `worker/src/reader.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { notePage, notesPage, vaultPath, type ReaderDeps } from './reader.js'
import { memoryStore, type JobRow, type JobStore } from './store.js'

const ID = 'zw_kFlCTPKY'
const REPO = 'tulaj/vault'
const NAME = `Feldmár András： Csak úgy ｜ [${ID}]_summary.md`
const NOTE_URL = `https://github.com/${REPO}/blob/main/Inbox/transcript-refinery/${encodeURIComponent(NAME)}`
const API = `https://api.github.com/repos/${REPO}/contents/Inbox/transcript-refinery/${encodeURIComponent(NAME)}?ref=main`
const TRANSCRIPT = `Feldmár András： Csak úgy ｜ [${ID}]_transcript.md`
const TRANSCRIPT_URL = `https://github.com/${REPO}/blob/main/Inbox/transcript-refinery/${encodeURIComponent(TRANSCRIPT)}`
const TRANSCRIPT_API = `https://api.github.com/repos/${REPO}/contents/Inbox/transcript-refinery/${encodeURIComponent(TRANSCRIPT)}?ref=main`

function row(updateId: number, partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: `${updateId}:${ID}`,
    updateId,
    chatId: '42',
    messageId: 1,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'ready',
    phase: 'summary',
    error: null,
    title: 'Cím',
    noteUrl: NOTE_URL,
    notifiedReady: true,
    noteNotified: true,
    acceptedAt: Date.UTC(2026, 9, 7),
    sub: 'sub-42',
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
  it('a GitHub-címből a fajta fájljának szakaszai, minden más null', () => {
    expect(vaultPath(NOTE_URL, REPO, 'main', 'summary')).toEqual(['Inbox', 'transcript-refinery', NAME])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'transcript')).toEqual(['Inbox', 'transcript-refinery', TRANSCRIPT])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'qa')).toBeNull()
    expect(vaultPath(NOTE_URL, 'mas/vault', 'main', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, REPO, 'dev', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, '', '', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/a_bloom.md`, REPO, 'main', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/x_summary.md/a_summary.md`, REPO, 'main', 'transcript')).toEqual(['x_summary.md', 'a_transcript.md'])
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/%E0_summary.md`, REPO, 'main', 'summary')).toBeNull()
  })
})

describe('notesPage', () => {
  it('csak a saját, jegyzettel bíró sorok, újak elöl, escape-elt címmel', async () => {
    const store = memoryStore()
    await store.insert(row(5, { title: 'Régi', acceptedAt: Date.UTC(2026, 9, 6) }))
    await store.insert(row(6, { title: '<b>Új</b>' }))
    await store.insert(row(7, { title: 'Idegen', sub: 'sub-7' }))
    await store.insert(row(8, { title: 'Félkész', noteUrl: null }))
    const response = await notesPage('sub-42', reader(store))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    expect(html).toContain(
      `<li>&#60;b&#62;Új&#60;/b&#62; · 2026-10-07 — <a href="/notes/6:${ID}/summary">summary</a> · <a href="/notes/6:${ID}/transcript">transcript</a></li>`,
    )
    expect(html).toContain(
      `<li>Régi · 2026-10-06 — <a href="/notes/5:${ID}/summary">summary</a> · <a href="/notes/5:${ID}/transcript">transcript</a></li>`,
    )
    expect(html.indexOf(`/notes/6:`)).toBeLessThan(html.indexOf(`/notes/5:`))
    expect(html).not.toContain('Idegen')
    expect(html).not.toContain('Félkész')
  })

  it('jegyzet nélkül a biztató mondat', async () => {
    const html = await (await notesPage('sub-42', reader(memoryStore()))).text()
    expect(html).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
  })
})

describe('notePage', () => {
  it('a summary és a transcript a GitHub renderelt HTML-jével és a saját GitHub-linkjével, pontos fejlécekkel', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    const deps = reader(store)
    const response = await notePage(`5:${ID}`, 'summary', 'sub-42', deps)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<title>Cím · summary</title>')
    expect(html).toContain(`<a href="${NOTE_URL}">Megnyitás a GitHubon</a>`)
    expect(html).toContain('<article><h1>Cím</h1></article>')
    expect(html).toContain('color-scheme:light dark')

    const transcript = await (await notePage(`5:${ID}`, 'transcript', 'sub-42', deps)).text()
    expect(transcript).toContain('<title>Cím · transcript</title>')
    expect(transcript).toContain(`<a href="${TRANSCRIPT_URL}">Megnyitás a GitHubon</a>`)

    const headers = {
      accept: 'application/vnd.github.html+json',
      authorization: 'Bearer olvaso',
      'user-agent': 'transcript-refinery',
    }
    expect(deps.calls).toEqual([
      { url: API, headers },
      { url: TRANSCRIPT_API, headers },
    ])
  })

  it('az idegen, a nem létező, a link nélküli, az idegen előtagú sor és az ismeretlen fajta ugyanaz a 404, GitHub-hívás nélkül', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    await store.insert(row(6, { noteUrl: 'https://github.com/mas/repo/blob/main/a_summary.md' }))
    await store.insert(row(7, { noteUrl: null }))
    const deps = reader(store)
    const cases: [string, string, string][] = [
      [`5:${ID}`, 'summary', 'sub-7'],
      [`5:${ID}`, 'qa', 'sub-42'],
      [`9:${ID}`, 'summary', 'sub-42'],
      [`6:${ID}`, 'summary', 'sub-42'],
      [`7:${ID}`, 'summary', 'sub-42'],
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

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker/src/reader.test.ts`
Expected: FAIL, `Failed to resolve import "./reader.js"`

- [x] **Step 3: A tár olvasása**

A `worker/src/store.ts` `JobStore` interfészében a `saveToken(token: LinkToken): Promise<void>` sor után:

```ts
  notesFor(sub: string): Promise<JobRow[]>
```

A `memoryStore` visszaadott objektumában a `saveToken` után:

```ts
    notesFor: (sub) =>
      Promise.resolve(
        rows
          .filter((row) => row.sub === sub && row.noteUrl !== null)
          .sort((a, b) => (b.acceptedAt ?? 0) - (a.acceptedAt ?? 0)),
      ),
```

A `worker/src/d1.ts` `createD1Store` visszaadott objektumában a `saveToken` után:

```ts
    async notesFor(sub) {
      const result = await db
        .prepare('SELECT * FROM jobs WHERE sub = ? AND note_url IS NOT NULL ORDER BY accepted_at DESC')
        .bind(sub)
        .all<JobRecord>()
      return result.results.map(toRow)
    },
```

- [x] **Step 4: A mondatok**

A `worker/src/messages.ts` végére:

```ts
export const NO_NOTES = 'Még nincs jegyzet. Küldj egy YouTube-címet a botnak.'
export const NOTE_MISSING = 'A jegyzet nincs a vaultban.'
export const VAULT_LOCKED = 'A vault nem olvasható.'
export const GITHUB_DOWN = 'A GitHub nem érhető el.'
export const OPEN_ON_GITHUB = 'Megnyitás a GitHubon'
```

- [x] **Step 5: A `findRow` exportja**

A `worker/src/handle.ts`-ben:

```ts
async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
```

erre:

```ts
export async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
```

- [x] **Step 6: `worker/src/reader.ts`**

```ts
import { findRow } from './handle.js'
import { GITHUB_DOWN, NO_NOTES, NOTE_MISSING, OPEN_ON_GITHUB, VAULT_LOCKED } from './messages.js'
import type { JobStore } from './store.js'

export interface ReaderDeps {
  store: JobStore
  vaultRepo: string
  vaultBranch: string
  vaultToken: string
}

export const NOTE_KINDS = ['summary', 'transcript'] as const
const SUMMARY_END = '_summary.md'

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

export function vaultPath(noteUrl: string, repo: string, branch: string, kind: string): string[] | null {
  if (!(NOTE_KINDS as readonly string[]).includes(kind)) return null
  const prefix = `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/`
  if (!noteUrl.startsWith(prefix)) return null
  try {
    const segments = noteUrl.slice(prefix.length).split('/').map((segment) => decodeURIComponent(segment))
    const last = segments.pop() ?? ''
    if (!last.endsWith(SUMMARY_END)) return null
    return [...segments, `${last.slice(0, -SUMMARY_END.length)}_${kind}.md`]
  } catch {
    return null
  }
}

export async function notesPage(sub: string, deps: ReaderDeps): Promise<Response> {
  const rows = await deps.store.notesFor(sub)
  if (rows.length === 0) return page('Jegyzetek', `<h1>Jegyzetek</h1><p>${NO_NOTES}</p>`)
  const items = rows.map((row) => {
    const links = NOTE_KINDS.map((kind) => `<a href="/notes/${escapeHtml(row.jobId)}/${kind}">${kind}</a>`).join(' · ')
    const day = row.acceptedAt === null ? '' : new Date(row.acceptedAt).toISOString().slice(0, 10)
    return `<li>${escapeHtml(row.title ?? row.videoId)} · ${day} — ${links}</li>`
  })
  return page('Jegyzetek', `<h1>Jegyzetek</h1><ul>${items.join('')}</ul>`)
}

export async function notePage(jobId: string, kind: string, sub: string, deps: ReaderDeps): Promise<Response> {
  const row = await findRow(deps.store, jobId)
  if (row === null || row.sub !== sub || row.noteUrl === null) return new Response(null, { status: 404 })
  const segments = vaultPath(row.noteUrl, deps.vaultRepo, deps.vaultBranch, kind)
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

A `vaultRepo: ''` esetben az előtag `https://github.com//blob/…`, ami egyetlen valódi `note_url` elejével sem egyezik, ezért külön feltétel nem kell. A csere csak az utolsó szakasz végén történik, ezért egy `_summary.md`-t tartalmazó mappanév nem változik. A jegyzet saját első címsora a GitHub HTML-jében van, ezért a Worker nem tesz elé `<h1>`-et (a spec 3. szakasza, 4. lépés).

- [x] **Step 7: Fusson, menjen át, és a teljes ellenőrzés**

Run: `pnpm vitest run worker && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: minden zöld.

Mutációs próbák, egyenként, mindegyik után FAIL kell, utána vissza:
- a `notePage` első feltételéből töröld a `row.sub !== sub ||` részt → a 404-es teszt bukik;
- töröld a `'user-agent': 'transcript-refinery',` sort → a fejléces teszt bukik;
- a `vaultPath` első sorát (a fajta-ellenőrzést) töröld → a `qa` fajta tesztje bukik;
- a `notesPage` `items` sorában az első `escapeHtml(…)` hívást cseréld a puszta `row.title ?? row.videoId` értékre → a lista tesztje bukik.

- [x] **Step 8: Commit**

```bash
git add worker/src/store.ts worker/src/d1.ts worker/src/messages.ts worker/src/handle.ts worker/src/reader.ts worker/src/reader.test.ts
git commit -m "feat(worker): Render vault notes for the signed-in account"
```

---

### Task 3: A `/notes` útvonalak

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/src/entry.test.ts` (`worker belépés` blokk)

**Interfaces:**
- Consumes: `notesPage`, `notePage`, `ReaderDeps` a `reader.ts`-ből; a meglévő `identity(ctx)` és `createD1Store`.
- Produces: `GET /notes` és `GET /notes/<jobId>/<fajta>` a Workerben.

- [x] **Step 1: A bukó teszt**

A `worker/src/entry.test.ts` `describe('worker belépés', …)` blokkjának végére, a „/link azonosító nélkül 403…” teszt után:

```ts
  it('a /notes azonosító nélkül 403, a pontatlan útvonal 404, belépve lista, az ismeretlen jegyzet 404', async () => {
    globalThis.fetch = () => Promise.reject(new Error('a GitHub nem hívható'))
    const env = {
      DB: memoryDb(),
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const get = (path: string) => new Request(`https://worker.test${path}`)
    const plain = { waitUntil: () => undefined }
    const signed = {
      waitUntil: () => undefined,
      access: { getIdentity: () => Promise.resolve({ email: 'en@example.com', user_uuid: 'sub-42' }) },
    }
    expect((await worker.fetch(get('/notes'), env, plain)).status).toBe(403)
    expect((await worker.fetch(get('/notes/5:abcdefghijk/summary'), env, plain)).status).toBe(403)
    for (const path of ['/Notes', '/notes/', '//notes', '/notes/5:abcdefghijk', '/notes/a/b/c']) {
      expect((await worker.fetch(get(path), env, signed)).status).toBe(404)
    }
    expect((await worker.fetch(new Request('https://worker.test/notes', { method: 'POST' }), env, signed)).status).toBe(404)
    const list = await worker.fetch(get('/notes'), env, signed)
    expect(list.status).toBe(200)
    expect(await list.text()).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
    expect((await worker.fetch(get('/notes/5:abcdefghijk/summary'), env, signed)).status).toBe(404)
  })
```

A `memoryDb` minden `all` hívásra üres listát ad, ezért a lista üres, és a jegyzet sora nem létezik. Az `env`-ből szándékosan hiányoznak a `VAULT_*` változók.

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker/src/entry.test.ts -t "a /notes azonosító nélkül"`
Expected: FAIL, az első `expect` `404`-et kap `403` helyett.

- [x] **Step 3: Az útvonalak**

A `worker/src/index.ts`-ben az importok után, az `import { LINK_INVALID_PAGE, newToken } from './plan.js'` sor alá:

```ts
import { notePage, notesPage, type ReaderDeps } from './reader.js'
```

Az `Env` interfészben a `SERVE_URL: string` sor után:

```ts
  VAULT_GITHUB_TOKEN?: string
  VAULT_REPO?: string
  VAULT_BRANCH?: string
```

A `fetch` metódusban a `/link` blokk záró `}` jele után, a `const match = /^\/internal\/jobs\/([^/]+)$/.exec(url.pathname)` sor elé:

```ts
    const note = /^\/notes\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if ((url.pathname === '/notes' || note !== null) && request.method === 'GET') {
      const who = await identity(ctx)
      if (who === null) return new Response(null, { status: 403 })
      const reader: ReaderDeps = {
        store: createD1Store(env.DB),
        vaultRepo: env.VAULT_REPO ?? '',
        vaultBranch: env.VAULT_BRANCH ?? '',
        vaultToken: env.VAULT_GITHUB_TOKEN ?? '',
      }
      return note?.[1] === undefined || note[2] === undefined
        ? notesPage(who.sub, reader)
        : notePage(note[1], note[2], who.sub, reader)
    }
```

- [x] **Step 4: Fusson, menjen át, és a teljes ellenőrzés**

Run: `pnpm vitest run worker && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: minden zöld.

Mutációs próba: a `if (who === null) return new Response(null, { status: 403 })` sort töröld ideiglenesen. A teszt bukjon (a `plain` kontextus `200`-at vagy `404`-et kap), utána vissza.

- [x] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/entry.test.ts
git commit -m "feat(worker): Serve the notes reader behind Access"
```

---

### Task 4: A bot linkje az olvasóra mutat

**Files:**
- Modify: `worker/src/handle.ts` (`handleCallback`, `handleTap`)
- Modify: `worker/src/index.ts` (az `/internal/jobs/:id` útvonal)
- Test: `worker/src/handle.test.ts`, `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: `WorkerDeps.linkBase` (a 3a óta létezik, a kérés originje).
- Produces: a summary kész üzenetének második sora `${linkBase}/notes/${jobId}/summary`, a visszahívásnál és a gomb `resend` ágán is.

- [x] **Step 1: A bukó tesztek**

A `worker/src/handle.test.ts` „a summary kész linkje kimegy…” tesztjében:

```ts
    expect(ok.sent).toEqual([`Cím. A jegyzet megvan.\n${url}`])
```

erre:

```ts
    expect(ok.sent).toEqual([`Cím. A jegyzet megvan.\nhttps://worker.test/notes/5:${ID}/summary`])
```

A „idegen chat és a kiment link nem kopogtat” tesztjében:

```ts
    expect(own.sent).toEqual(['Cím. A jegyzet megvan.\nhttps://github.com/tulaj/repo/blob/main/a.md'])
```

erre:

```ts
    expect(own.sent).toEqual([`Cím. A jegyzet megvan.\nhttps://worker.test/notes/5:${ID}/summary`])
```

A `worker/src/entry.test.ts` `describe('worker belépés', …)` blokkjának végére:

```ts
  it('a summary visszahívása a kérés saját címére tett /notes linket küldi', async () => {
    const bodies: string[] = []
    globalThis.fetch = (_input, init) => {
      const raw = init?.body
      bodies.push(typeof raw === 'string' ? raw : '')
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    // A visszahívás csak ezeket a mezőket olvassa, a többit a toRow undefined-ként adja át.
    const record = { job_id: '5:abcdefghijk', update_id: 5, chat_id: '42', phase: 'summary' }
    const db: D1Like = {
      prepare(sql: string): D1Statement {
        const statement: D1Statement = {
          bind: () => statement,
          all: <T>() => Promise.resolve({ results: (sql.includes('WHERE update_id') ? [record] : []) as T[] }),
          first: <T>() => Promise.resolve(null as T | null),
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
      new Request('https://worker.test/internal/jobs/5%3Aabcdefghijk', {
        method: 'POST',
        headers: { authorization: 'Bearer titok' },
        body: JSON.stringify({ status: 'ready', title: 'Cím', noteUrl: 'https://github.com/tulaj/vault/blob/main/a.md' }),
      }),
      env,
      { waitUntil: () => undefined },
    )
    expect(response.status).toBe(200)
    expect(bodies).toHaveLength(1)
    expect((JSON.parse(bodies[0]!) as { text: string }).text).toBe(
      'Cím. A jegyzet megvan.\nhttps://worker.test/notes/5:abcdefghijk/summary',
    )
  })
```

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker`
Expected: FAIL a három érintett tesztben, mert a második sor még a GitHub-cím.

- [x] **Step 3: A link**

A `worker/src/handle.ts`-ben a `findRow` függvény után:

```ts
function readerLink(jobId: string, deps: WorkerDeps): string {
  return `${deps.linkBase}/notes/${jobId}/summary`
}
```

A `handleCallback` summary-ágában:

```ts
    const sent = await deps.send(row.chatId, noteReadyMessage(body.title, body.noteUrl))
```

erre:

```ts
    const sent = await deps.send(row.chatId, noteReadyMessage(body.title, readerLink(row.jobId, deps)))
```

A `handleTap` `resend` ágában:

```ts
    if (row?.title && row.noteUrl) await deps.send(row.chatId, noteReadyMessage(row.title, row.noteUrl))
```

erre:

```ts
    if (row?.title && row.noteUrl) await deps.send(row.chatId, noteReadyMessage(row.title, readerLink(row.jobId, deps)))
```

A `worker/src/index.ts` `/internal/jobs/:id` blokkjában:

```ts
      const status = await handleCallback(decodeURIComponent(match[1]), body, deps(env))
```

erre:

```ts
      const status = await handleCallback(decodeURIComponent(match[1]), body, deps(env, url.origin))
```

A `noteReadyMessage` és a `plan.test.ts` nem változik: a függvény bármilyen linket a második sorba tesz.

- [x] **Step 4: Fusson, menjen át, és a teljes ellenőrzés**

Run: `pnpm vitest run worker && pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: minden zöld.

Mutációs próba: az `index.ts`-ben a `deps(env, url.origin)` helyére ideiglenesen `deps(env)` → az entry-teszt bukik (`/notes/…` origin nélkül), utána vissza.

- [x] **Step 5: Commit**

```bash
git add worker/src/handle.ts worker/src/index.ts worker/src/handle.test.ts worker/src/entry.test.ts
git commit -m "feat(worker): Link summary notes to the reader page"
```

---

### Task 5: Változók és üzemeltetési leírás

**Files:**
- Modify: `.env.example`
- Modify: `docs/operations/telegram-worker-topology.md`

A `scripts/worker-dev-vars.sh` nem változik. Helyben nincs Access, ezért a `/notes` helyben mindig `403`, a `VAULT_*` változók ott fölöslegesek.

- [x] **Step 1: `.env.example`**

Ez után a blokk után:

```
# A bot felhasználóneve `@` nélkül. A kötés a `t.me/<név>` címre irányít vissza.
TELEGRAM_BOT_USERNAME=
```

szúrd be:

```

# Fine-grained GitHub token: csak a vault-repóra, Contents: Read-only.
# Az olvasó oldal (`/notes`) ezzel kéri le a jegyzetet.
VAULT_GITHUB_TOKEN=

# A vault-repó `<tulaj>/<repo>` alakban, betűre úgy, ahogy a jegyzetlinkekben áll.
VAULT_REPO=

# A vault ága, amelyre a jegyzetek kerülnek.
VAULT_BRANCH=
```

- [x] **Step 2: `docs/operations/telegram-worker-topology.md`**

Az „Életciklus üzenetek a chaten:” lista `- **Hiba**: …` sora után új sor:

```
- **Kész jegyzet** (a `summary` gomb után): `<cím>. A jegyzet megvan.` és a második sorban `https://<worker>/notes/<jobId>/summary`. Az oldal Cloudflare Access mögött van, és a jegyzetet a vault-repóból, a GitHub renderelt HTML-jével mutatja. A `/notes/<jobId>/transcript` ugyanígy a hozzá tartozó `_transcript.md`. A `https://<worker>/notes` a belépett fiók jegyzeteinek listája, videónként mindkét linkkel. A bot csak privát chatben válaszol.
```

A „Biztonsági szűrés” megjegyzés utolsó mondatát:

```
A kötés útvonala a `/link`, ezt Cloudflare Access védi.
```

erre cseréld:

```
A kötés útvonala a `/link`, az olvasóé a `/notes`, mindkettőt Cloudflare Access védi. Csoportchatben a bot hallgat.
```

Ellenőrzés: `grep -n '/notes' docs/operations/telegram-worker-topology.md` két sort mutat.

- [x] **Step 3: Commit**

```bash
git add .env.example docs/operations/telegram-worker-topology.md
git commit -m "docs(worker): Describe the notes reader and its variables"
```

---

### Task 6: Élesítés (kézi, minden lépés a felhasználó jóváhagyásával)

Kifelé ható lépések. Mindegyik előtt szólj, és várd meg az igent. Migráció nincs.

- [ ] **Step 1: GitHub-token.** A vault-repó tulajdonosának fiókjában: Settings → Developer settings → Fine-grained tokens → új token, Repository access: csak a vault-repó, Permissions: Contents → Read-only. Ezt a felhasználó csinálja a böngészőben.
- [ ] **Step 2: Infisical.** A `/peter-mba` úton (az éles titkok forrása): `VAULT_GITHUB_TOKEN`, `VAULT_REPO` (a jegyzetlinkekben álló `<tulaj>/<repo>`, betűre), `VAULT_BRANCH`.
- [ ] **Step 3: Access.** A meglévő, hosztnév-alapú Access-alkalmazáshoz (ma a `link` útvonal) új útvonal: `notes`. Az Access fül „Protect this Worker” gombját NEM szabad használni, mert az egész Workert, a webhookot is védené. Ellenőrzés privát ablakban: a `https://<worker>/notes` és a `https://<worker>/notes/x/summary` is a Google-belépésre visz. Ha a második nem, add hozzá a `notes/*` útvonalat is.
- [ ] **Step 4: Titkok.** `npx wrangler secret put VAULT_GITHUB_TOKEN --config worker/wrangler.toml`, `npx wrangler secret put VAULT_REPO --config worker/wrangler.toml`, `npx wrangler secret put VAULT_BRANCH --config worker/wrangler.toml`
- [ ] **Step 5: Telepítés.** `pnpm worker:deploy`
- [ ] **Step 6: A siker.** Telegramon egy YouTube-cím, majd a `summary` gomb. A kész üzenet második sora `https://<worker>/notes/<jobId>/summary`. Ha a link más hosztra mutat, mint amit az Access véd, a konténer visszahívási címe (`.env.example`: a Worker nyilvános címe) nem egyezik a webhook hosztjával. A link a böngészőben belépés után a jegyzetet mutatja, a frontmatter-táblázattal az elején. A „Megnyitás a GitHubon” a GitHubra visz. A `https://<worker>/notes` listában ott a jegyzet, és a `transcript` linkje a tisztított átiratot nyitja. Privát ablakban, belépés nélkül, a link a Google-belépést kéri, nem a jegyzetet.

Ha a jegyzet helyén `A vault nem olvasható.` áll, a token hatóköre vagy a `VAULT_REPO` betűzése a hibás. Ha `404` jön, a `VAULT_REPO` vagy a `VAULT_BRANCH` nem egyezik a `note_url` elejével.
