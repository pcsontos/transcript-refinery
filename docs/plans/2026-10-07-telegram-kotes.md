# Google-kötés (3a) — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bot a `/start` után Google-belépéssel köti a Telegram-felhasználót egy Access-fiókhoz, és onnantól a parancsot a kötött, engedélyezett e-mail adja, nem a `TELEGRAM_OWNER_CHAT_ID`.

**Architecture:** Minden a meglévő `worker/` fájlokban marad. A tiszta döntések (`isAllowed`, `decideStart`, token, hash) a `plan.ts`-be kerülnek, a mondatok a `messages.ts`-be, a mellékhatások (`/start`, `handleLink`, engedélyezés) a `handle.ts`-be, a `/link` útvonal és a `ctx.access` kiolvasása az `index.ts`-be. A D1 két új táblát és egy oszlopot kap. A kötés két tokennel megy: a linktoken a bot üzenetében utazik, a visszatérő tokent a `/link` készíti a belépés után.

**Tech Stack:** TypeScript, Vitest, Cloudflare Worker és D1. A token a `crypto.getRandomValues`, a hash a `crypto.subtle` (Web Crypto) dolga. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-07-telegram-olvaso-spec.md` (1. és 2. szakasz, a 3a sorai az 5. és 6. szakaszban)

Az implementáció a `.worktrees/impl-telegram-kotes` worktree-n, az `impl-telegram-kotes` ágon indul, a `main` ágról, miután a spec és ez a terv bekerült.

## Global Constraints

- Csak a 3a. Az olvasó (`/notes`), a `VAULT_*` változók és a bot linkjének cseréje a 3b dolga.
- Az azonosító forrása a `ctx.access.getIdentity()`: `email` és `user_uuid`. A `sub` a `user_uuid`. Ha a `ctx.access` hiányzik, vagy bármelyik mező üres vagy nem szöveg, a `/link` válasza `403`. A `jose` és a kézi JWT-ellenőrzés nincs.
- Az útválasztás pontos: `url.pathname === '/link'` és `GET`. Minden más útvonal a mai. Ismeretlen útvonal `404`.
- A token 32 véletlen bájt, base64url kódolással, 43 karakter, kitöltés nélkül. A tárban csak az SHA-256 hash-e van, 64 kisbetűs hexa. Az élettartam 10 perc (`TOKEN_TTL = 600000`). Ami nem `^[A-Za-z0-9_-]{43}$`, az érvénytelen token, tárhívás nélkül.
- A `/link` csak függő fiók nélküli (link)tokent fogad el. A `/start <token>` csak függő fiókkal rendelkező (visszatérő) tokent. A visszatérő token a linktoken `telegram_user_id` és `expires_at` értékét örökli.
- Engedélyezett az a Telegram-felhasználó (`from.id`), akinek van kötése, és a kötött e-mail az `ALLOWED_EMAILS` vesszős listáján van, kis- és nagybetű nélkül, a szóközöket levágva. Üres e-mail sosem engedélyezett.
- A `send` a megadott chatre küld. A sor üzenetei a sor `chat_id` értékére mennek. A `TELEGRAM_OWNER_CHAT_ID` a Workerből megszűnik.
- A gomb csak akkor indít, ha a sor `sub` értéke egyezik a koppintó kötésének `sub` értékével.
- Mondatok, szó szerint: `Előbb kösd össze a Google-fiókoddal: /start` · `Kösd össze a Google-fiókoddal (10 percig érvényes): <link>` · `Bekötve: <e-mail>.` · `Már be vagy kötve: <e-mail>.` · `Ez a Google-fiók nincs engedélyezve: <e-mail>.` · `A link lejárt vagy már nem érvényes. Kérj újat: /start` · az oldalon: `A link lejárt vagy már nem érvényes. Kérj újat a botban: /start`
- A lejárt tokenek takarítása nincs. A teszt nem éri el a Telegramot, az Accesst és a Cloudflare-t. Új tesztfüggőség nincs.
- Minden feladat végén: `pnpm vitest run worker` zöld, `pnpm exec tsc -p worker/tsconfig.json` hibátlan, `pnpm lint` hibátlan.

## Review Focus

1. Az idegen kér linket, a tulajdonos lépteti be: sem az idegen linktokenje, sem a tulajdonos visszatérő tokenje nem köt. (3. feladat, „az idegen linkjét…” teszt)
2. A `ctx.access` megvan, de a `getIdentity()` üres vagy dob: `403`, nem kivétel. (4. feladat)
3. Az e-mail törlése az `ALLOWED_EMAILS` listáról azonnal kizár, a kötés megmaradása mellett. (3. feladat)
4. A Telegram ugyanazt a `/start` frissítést kétszer küldi: második token és második üzenet nincs. (3. feladat)
5. A `/link` frissítése a böngészőben (elhasznált linktoken) hibaoldalt ad, nem második visszatérő tokent. (3. feladat)

## File Structure

| Fájl | Felelősség |
|---|---|
| `worker/migrations/0003_bindings.sql` | `jobs.sub`, `bindings`, `link_tokens` |
| `worker/src/store.ts` | `Binding`, `LinkToken`, `JobRow.sub`, az új tárműveletek, `memoryStore` |
| `worker/src/d1.ts` | Ugyanez D1-ben |
| `worker/src/messages.ts` | A kötés mondatai |
| `worker/src/plan.ts` | `isAllowed`, `isToken`, `newToken`, `hashToken`, `decideStart`, `TOKEN_TTL` |
| `worker/src/handle.ts` | `/start`, `/start <token>`, `handleLink`, engedélyezés kötés alapján, `send(chatId, …)` |
| `worker/src/index.ts` | `/link` útvonal, `ctx.access`, új `Env`, `from` a frissítésekben |
| `.env.example`, `scripts/worker-dev-vars.sh`, `scripts/telegram-debug.sh`, `docs/operations/telegram-worker-topology.md` | Az új változók és a helyi kötés |

---

### Task 1: Adatréteg és migráció

**Files:**
- Create: `worker/migrations/0003_bindings.sql`
- Modify: `worker/src/store.ts` (teljes csere)
- Modify: `worker/src/d1.ts` (teljes csere)
- Test: `worker/src/entry.test.ts`

**Interfaces:**
- Produces: `Binding`, `LinkToken`, `JobRow.sub: string | null`, és a `JobStore` új metódusai: `bindingFor(telegramUserId)`, `bind(binding, chatId)`, `insertToken(token)`, `token(tokenHash)`, `saveToken(token)`. A `saveToken` csak a `pendingSub`, `pendingEmail` és `used` mezőt írja.

- [x] **Step 1: A migráció tesztje**

A `worker/src/entry.test.ts` „a wrangler percenként fut…” tesztjében a `expect(summary).toContain('seen_updates')` sor után:

```ts
    const bindings = await readFile('worker/migrations/0003_bindings.sql', 'utf8')
    expect(bindings).toContain('ALTER TABLE jobs ADD COLUMN sub TEXT')
    expect(bindings).toContain('CREATE TABLE bindings')
    expect(bindings).toContain('CREATE TABLE link_tokens')
```

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker/src/entry.test.ts`
Expected: FAIL, `ENOENT … 0003_bindings.sql`

- [x] **Step 3: A migráció**

`worker/migrations/0003_bindings.sql`:

```sql
ALTER TABLE jobs ADD COLUMN sub TEXT;
CREATE TABLE bindings (
  telegram_user_id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  email TEXT NOT NULL,
  bound_at INTEGER NOT NULL
);
CREATE TABLE link_tokens (
  token_hash TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  pending_sub TEXT,
  pending_email TEXT,
  used INTEGER NOT NULL DEFAULT 0
);
```

- [x] **Step 4: `worker/src/store.ts` teljes cseréje**

```ts
export type JobStatus = 'queued' | 'waiting' | 'accepted' | 'ready' | 'failed'
export type JobPhase = 'subtitle' | 'summary'

export interface JobRow {
  jobId: string
  updateId: number
  chatId: string
  messageId: number
  videoId: string
  url: string
  status: JobStatus
  phase: JobPhase
  error: string | null
  title: string | null
  noteUrl: string | null
  notifiedReady: boolean
  noteNotified: boolean
  acceptedAt: number | null
  sub: string | null
}

export interface Binding {
  telegramUserId: string
  sub: string
  email: string
  boundAt: number
}

export interface LinkToken {
  tokenHash: string
  telegramUserId: string
  expiresAt: number
  pendingSub: string | null
  pendingEmail: string | null
  used: boolean
}

export interface JobStore {
  listByUpdate(updateId: number): Promise<JobRow[]>
  activeByVideo(videoId: string): Promise<JobRow | null>
  insert(row: JobRow): Promise<void>
  save(row: JobRow): Promise<void>
  due(now: number): Promise<JobRow[]>
  claim(
    jobId: string,
    expect: { phase: JobPhase; status: JobStatus },
    next: { phase: JobPhase; status: JobStatus },
  ): Promise<JobRow | null>
  rememberUpdate(updateId: number): Promise<boolean>
  bindingFor(telegramUserId: string): Promise<Binding | null>
  bind(binding: Binding, chatId: string): Promise<void>
  insertToken(token: LinkToken): Promise<void>
  token(tokenHash: string): Promise<LinkToken | null>
  saveToken(token: LinkToken): Promise<void>
}

const OPEN: readonly JobStatus[] = ['queued', 'waiting', 'accepted']
const FIFTEEN_MINUTES = 15 * 60 * 1000

export function memoryStore(): JobStore {
  const rows: JobRow[] = []
  const seen = new Set<number>()
  const bindings = new Map<string, Binding>()
  const tokens = new Map<string, LinkToken>()
  return {
    listByUpdate: (updateId) => Promise.resolve(rows.filter((row) => row.updateId === updateId)),
    activeByVideo: (videoId) =>
      Promise.resolve(rows.find((row) => row.videoId === videoId && OPEN.includes(row.status)) ?? null),
    insert: (row) => {
      rows.push(row)
      return Promise.resolve()
    },
    save: (row) => {
      const index = rows.findIndex((item) => item.jobId === row.jobId)
      if (index === -1) rows.push(row)
      else rows[index] = row
      return Promise.resolve()
    },
    due: (now) =>
      Promise.resolve(
        rows.filter((row) => {
          if (row.status === 'queued' || row.status === 'waiting') return true
          if (row.status !== 'accepted' || row.acceptedAt === null) return false
          return row.acceptedAt < now - FIFTEEN_MINUTES
        }),
      ),
    claim: (jobId, expect, next) => {
      const row = rows.find((item) => item.jobId === jobId)
      if (row === undefined || row.phase !== expect.phase || row.status !== expect.status) return Promise.resolve(null)
      row.phase = next.phase
      row.status = next.status
      row.error = null
      row.acceptedAt = null
      return Promise.resolve(row)
    },
    rememberUpdate: (updateId) => {
      if (seen.has(updateId)) return Promise.resolve(false)
      seen.add(updateId)
      return Promise.resolve(true)
    },
    bindingFor: (telegramUserId) => {
      const binding = bindings.get(telegramUserId)
      return Promise.resolve(binding === undefined ? null : { ...binding })
    },
    bind: (binding, chatId) => {
      bindings.set(binding.telegramUserId, { ...binding })
      for (const row of rows) if (row.chatId === chatId) row.sub = binding.sub
      return Promise.resolve()
    },
    insertToken: (token) => {
      tokens.set(token.tokenHash, { ...token })
      return Promise.resolve()
    },
    token: (tokenHash) => {
      const token = tokens.get(tokenHash)
      return Promise.resolve(token === undefined ? null : { ...token })
    },
    saveToken: (token) => {
      const current = tokens.get(token.tokenHash)
      if (current !== undefined) {
        current.pendingSub = token.pendingSub
        current.pendingEmail = token.pendingEmail
        current.used = token.used
      }
      return Promise.resolve()
    },
  }
}
```

- [x] **Step 5: `worker/src/d1.ts` teljes cseréje**

```ts
import type { Binding, JobRow, JobStatus, JobStore, LinkToken } from './store.js'

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface D1Like {
  prepare(sql: string): D1Statement
}

interface JobRecord {
  job_id: string
  update_id: number
  chat_id: string
  message_id: number
  video_id: string
  url: string
  status: JobStatus
  phase: JobRow['phase']
  error: string | null
  title: string | null
  note_url: string | null
  notified_ready: number
  note_notified: number
  accepted_at: number | null
  sub: string | null
}

interface BindingRecord {
  telegram_user_id: string
  sub: string
  email: string
  bound_at: number
}

interface TokenRecord {
  token_hash: string
  telegram_user_id: string
  expires_at: number
  pending_sub: string | null
  pending_email: string | null
  used: number
}

const FIFTEEN_MINUTES = 15 * 60 * 1000

function toRow(record: JobRecord): JobRow {
  return {
    jobId: record.job_id,
    updateId: record.update_id,
    chatId: record.chat_id,
    messageId: record.message_id,
    videoId: record.video_id,
    url: record.url,
    status: record.status,
    phase: record.phase,
    error: record.error,
    title: record.title,
    noteUrl: record.note_url,
    notifiedReady: record.notified_ready === 1,
    noteNotified: record.note_notified === 1,
    acceptedAt: record.accepted_at,
    sub: record.sub,
  }
}

function toBinding(record: BindingRecord): Binding {
  return {
    telegramUserId: record.telegram_user_id,
    sub: record.sub,
    email: record.email,
    boundAt: record.bound_at,
  }
}

function toToken(record: TokenRecord): LinkToken {
  return {
    tokenHash: record.token_hash,
    telegramUserId: record.telegram_user_id,
    expiresAt: record.expires_at,
    pendingSub: record.pending_sub,
    pendingEmail: record.pending_email,
    used: record.used === 1,
  }
}

export function createD1Store(db: D1Like): JobStore {
  return {
    async listByUpdate(updateId) {
      const result = await db.prepare('SELECT * FROM jobs WHERE update_id = ?').bind(updateId).all<JobRecord>()
      return result.results.map(toRow)
    },
    async activeByVideo(videoId) {
      const record = await db
        .prepare(
          "SELECT * FROM jobs WHERE video_id = ? AND status IN ('queued', 'waiting', 'accepted') LIMIT 1",
        )
        .bind(videoId)
        .first<JobRecord>()
      return record === null ? null : toRow(record)
    },
    async insert(row) {
      await db
        .prepare(
          `INSERT INTO jobs (
            job_id, update_id, chat_id, message_id, video_id, url, status, phase, error, title,
            note_url, notified_ready, note_notified, accepted_at, sub
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.jobId,
          row.updateId,
          row.chatId,
          row.messageId,
          row.videoId,
          row.url,
          row.status,
          row.phase,
          row.error,
          row.title,
          row.noteUrl,
          row.notifiedReady ? 1 : 0,
          row.noteNotified ? 1 : 0,
          row.acceptedAt,
          row.sub,
        )
        .run()
    },
    async save(row) {
      await db
        .prepare(
          `UPDATE jobs SET
            update_id = ?, chat_id = ?, message_id = ?, video_id = ?, url = ?, status = ?, phase = ?,
            error = ?, title = ?, note_url = ?, notified_ready = ?, note_notified = ?, accepted_at = ?, sub = ?
          WHERE job_id = ?`,
        )
        .bind(
          row.updateId,
          row.chatId,
          row.messageId,
          row.videoId,
          row.url,
          row.status,
          row.phase,
          row.error,
          row.title,
          row.noteUrl,
          row.notifiedReady ? 1 : 0,
          row.noteNotified ? 1 : 0,
          row.acceptedAt,
          row.sub,
          row.jobId,
        )
        .run()
    },
    async due(now) {
      const result = await db
        .prepare(
          `SELECT * FROM jobs
           WHERE status IN ('queued', 'waiting')
              OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_at < ?)`,
        )
        .bind(now - FIFTEEN_MINUTES)
        .all<JobRecord>()
      return result.results.map(toRow)
    },
    async claim(jobId, expect, next) {
      const result = await db
        .prepare(
          `UPDATE jobs SET phase = ?, status = ?, error = NULL, accepted_at = NULL
           WHERE job_id = ? AND phase = ? AND status = ?`,
        )
        .bind(next.phase, next.status, jobId, expect.phase, expect.status)
        .run()
      const changes = (result as { meta?: { changes?: number } }).meta?.changes
      if (changes !== 1) return null
      const record = await db.prepare('SELECT * FROM jobs WHERE job_id = ?').bind(jobId).first<JobRecord>()
      return record === null ? null : toRow(record)
    },
    async rememberUpdate(updateId) {
      try {
        const result = await db.prepare('INSERT INTO seen_updates (update_id) VALUES (?)').bind(updateId).run()
        const changes = (result as { meta?: { changes?: number } }).meta?.changes
        return changes === undefined || changes === 1
      } catch {
        return false
      }
    },
    async bindingFor(telegramUserId) {
      const record = await db
        .prepare('SELECT * FROM bindings WHERE telegram_user_id = ?')
        .bind(telegramUserId)
        .first<BindingRecord>()
      return record === null ? null : toBinding(record)
    },
    async bind(binding, chatId) {
      await db
        .prepare(
          `INSERT INTO bindings (telegram_user_id, sub, email, bound_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(telegram_user_id) DO UPDATE SET sub = excluded.sub, email = excluded.email, bound_at = excluded.bound_at`,
        )
        .bind(binding.telegramUserId, binding.sub, binding.email, binding.boundAt)
        .run()
      await db.prepare('UPDATE jobs SET sub = ? WHERE chat_id = ?').bind(binding.sub, chatId).run()
    },
    async insertToken(token) {
      await db
        .prepare(
          `INSERT INTO link_tokens (token_hash, telegram_user_id, expires_at, pending_sub, pending_email, used)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(token.tokenHash, token.telegramUserId, token.expiresAt, token.pendingSub, token.pendingEmail, token.used ? 1 : 0)
        .run()
    },
    async token(tokenHash) {
      const record = await db
        .prepare('SELECT * FROM link_tokens WHERE token_hash = ?')
        .bind(tokenHash)
        .first<TokenRecord>()
      return record === null ? null : toToken(record)
    },
    async saveToken(token) {
      await db
        .prepare('UPDATE link_tokens SET pending_sub = ?, pending_email = ?, used = ? WHERE token_hash = ?')
        .bind(token.pendingSub, token.pendingEmail, token.used ? 1 : 0, token.tokenHash)
        .run()
    },
  }
}
```

- [x] **Step 6: A `sub` a meglévő teszt-sorokban**

A `JobRow` literálok új kötelező mezőt kapnak. A tulajdonos `sub` értéke a tesztekben `sub-42`:

```bash
perl -0pi -e "s/^(\s*)acceptedAt: 1,\n/\$1acceptedAt: 1,\n\$1sub: 'sub-42',\n/mg" worker/src/handle.test.ts
perl -0pi -e "s/^(\s*)acceptedAt: null,\n(\s*)\.\.\.partial,/\$1acceptedAt: null,\n\$1sub: null,\n\$2...partial,/m" worker/src/plan.test.ts
```

Ellenőrzés: a `handle.test.ts` fájlban három, a `plan.test.ts` fájlban egy új `sub:` sor van.

A `worker/src/handle.ts` `handleUpdate` sor-literáljában az `acceptedAt: null,` sor után egy új sor: `sub: null,`. A 3. feladat ezt a fájlt úgyis teljesen lecseréli, ez csak a köztes typecheckhez kell.

- [x] **Step 7: Zöld**

Run: `pnpm vitest run worker`
Expected: PASS
Run: `pnpm exec tsc -p worker/tsconfig.json`
Expected: hibátlan

- [x] **Step 8: Commit**

```bash
git add worker/migrations/0003_bindings.sql worker/src/store.ts worker/src/d1.ts worker/src/entry.test.ts worker/src/handle.test.ts worker/src/plan.test.ts
git commit -m "feat(worker): Store Telegram bindings and link tokens"
```

---

### Task 2: Tiszta döntések és mondatok

**Files:**
- Modify: `worker/src/messages.ts` (hozzáfűzés)
- Modify: `worker/src/plan.ts`
- Test: `worker/src/plan.test.ts`

**Interfaces:**
- Consumes: `LinkToken`, `JobRow` (1. feladat)
- Produces: `TOKEN_TTL: number`, `isAllowed(email: string, allowedEmails: string): boolean`, `isToken(value: string): boolean`, `newToken(): string`, `hashToken(raw: string): Promise<string>`, `decideStart(token: LinkToken | null, userId: string, now: number, allowedEmails: string): StartAction`, `StartAction = { type: 'invalid' } | { type: 'denied'; email: string } | { type: 'bind'; sub: string; email: string }`. A `plan.ts` újraexportálja: `BIND_FIRST`, `LINK_INVALID`, `LINK_INVALID_PAGE`, `linkLine`, `boundLine`, `alreadyBoundLine`, `notAllowedLine`.

- [x] **Step 1: A bukó teszt**

A `worker/src/plan.test.ts` importja kiegészül (a meglévő `from './plan.js'` listába): `decideStart`, `hashToken`, `isAllowed`, `isToken`, `newToken`. A `./store.js` importba: `type LinkToken`. A fájl végére:

```ts
describe('kötési döntések', () => {
  it('az engedélyezőlista vesszős, kis- és nagybetű nem számít, üres e-mail nem megy át', () => {
    expect(isAllowed('En@Example.com', ' en@example.com , mas@example.com')).toBe(true)
    expect(isAllowed('harmadik@example.com', 'en@example.com')).toBe(false)
    expect(isAllowed('', 'en@example.com,')).toBe(false)
    expect(isAllowed('en@example.com', '')).toBe(false)
  })

  it('a token 43 karakteres base64url, a hash 64 hexa', async () => {
    const raw = newToken()
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isToken(raw)).toBe(true)
    expect(newToken()).not.toBe(raw)
    expect(await hashToken(raw)).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken(raw)).toBe(await hashToken(raw))
    expect(isToken('rövid')).toBe(false)
    expect(isToken(`${raw}x`)).toBe(false)
  })

  it('a decideStart csak egyező felhasználónál, élő, függő tokennel köt', () => {
    const token: LinkToken = {
      tokenHash: 'h',
      telegramUserId: '42',
      expiresAt: 100,
      pendingSub: 'sub-42',
      pendingEmail: 'en@example.com',
      used: false,
    }
    expect(decideStart(token, '42', 99, 'en@example.com')).toEqual({ type: 'bind', sub: 'sub-42', email: 'en@example.com' })
    expect(decideStart(token, '7', 99, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart(token, '42', 100, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart({ ...token, used: true }, '42', 99, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart({ ...token, pendingSub: null, pendingEmail: null }, '42', 99, 'en@example.com')).toEqual({
      type: 'invalid',
    })
    expect(decideStart(null, '42', 99, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart(token, '42', 99, 'mas@example.com')).toEqual({ type: 'denied', email: 'en@example.com' })
  })
})
```

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker/src/plan.test.ts`
Expected: FAIL, `isAllowed is not a function` (vagy hasonló import-hiba)

- [x] **Step 3: A mondatok**

A `worker/src/messages.ts` végére:

```ts
export const BIND_FIRST = 'Előbb kösd össze a Google-fiókoddal: /start'
export const LINK_INVALID = 'A link lejárt vagy már nem érvényes. Kérj újat: /start'
export const LINK_INVALID_PAGE = 'A link lejárt vagy már nem érvényes. Kérj újat a botban: /start'

export function linkLine(url: string): string {
  return `Kösd össze a Google-fiókoddal (10 percig érvényes): ${url}`
}

export function boundLine(email: string): string {
  return `Bekötve: ${email}.`
}

export function alreadyBoundLine(email: string): string {
  return `Már be vagy kötve: ${email}.`
}

export function notAllowedLine(email: string): string {
  return `Ez a Google-fiók nincs engedélyezve: ${email}.`
}
```

- [x] **Step 4: A döntések a `plan.ts`-ben**

A fájl eleje így változik: a `./store.js` import `import type { JobRow, LinkToken } from './store.js'`, az újraexport lista pedig:

```ts
export {
  alreadyLine,
  queuedLine,
  readyLine,
  waitingLine,
  REJECTED_SECRET,
  MISSING_NOTE_URL,
  noteReadyMessage,
  summaryButton,
  BIND_FIRST,
  LINK_INVALID,
  LINK_INVALID_PAGE,
  linkLine,
  boundLine,
  alreadyBoundLine,
  notAllowedLine,
} from './messages.js'
```

A `decideTap` második paraméterének neve `owner` helyett `allowed` (törzse változatlan, a két előfordulás átnevezve):

```ts
export function decideTap(row: JobRow | null, allowed: boolean): TapAction {
  if (row === null || allowed === false) return { type: 'ignore' }
```

A fájl végére:

```ts
export const TOKEN_TTL = 10 * 60 * 1000
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export function isAllowed(email: string, allowedEmails: string): boolean {
  const wanted = email.trim().toLowerCase()
  if (wanted === '') return false
  return allowedEmails.split(',').some((item) => item.trim().toLowerCase() === wanted)
}

export function isToken(value: string): boolean {
  return TOKEN.test(value)
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type StartAction = { type: 'invalid' } | { type: 'denied'; email: string } | { type: 'bind'; sub: string; email: string }

export function decideStart(
  token: LinkToken | null,
  userId: string,
  now: number,
  allowedEmails: string,
): StartAction {
  if (token === null || token.used || token.expiresAt <= now || token.telegramUserId !== userId) return { type: 'invalid' }
  if (token.pendingSub === null || token.pendingEmail === null) return { type: 'invalid' }
  if (!isAllowed(token.pendingEmail, allowedEmails)) return { type: 'denied', email: token.pendingEmail }
  return { type: 'bind', sub: token.pendingSub, email: token.pendingEmail }
}
```

- [x] **Step 5: Zöld**

Run: `pnpm vitest run worker/src/plan.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add worker/src/messages.ts worker/src/plan.ts worker/src/plan.test.ts
git commit -m "feat(worker): Decide Telegram binding from link tokens"
```

---

### Task 3: A kötés menete és a kötésen alapuló engedélyezés

**Files:**
- Modify: `worker/src/handle.ts` (teljes csere)
- Test: `worker/src/handle.test.ts`

**Interfaces:**
- Consumes: az 1. és a 2. feladat minden exportja
- Produces: `WorkerDeps` új alakja: `{ allowedEmails: string; botUsername: string; linkBase: string; store; now; newToken: () => string; knock; send: (chatId: string, text: string, button?) => Promise<boolean>; answerTap }`. `handleLink(raw: string, who: { sub: string; email: string }, deps: WorkerDeps): Promise<{ status: 302; location: string } | { status: 200 }>`. A `handleUpdate` frissítése `message.from?: { id: number }` mezőt kap, a `handleTap` `callback_query.from?: { id: number }` mezőt.

- [x] **Step 1: A meglévő tesztek átállítása a kötött felhasználóra**

```bash
perl -pi -e 's/const (\w+) = memoryStore\(\)/const $1 = await boundStore()/g; s/chat: \{ id: (\d+) \}, text/chat: { id: $1 }, from: { id: $1 }, text/g; s/message: \{ chat: \{ id: (\d+) \} \} \}/from: { id: $1 }, message: { chat: { id: $1 } } }/g; s/\{ \.\.\.update\.message, chat: \{ id: 42 \} \}/{ ...update.message, chat: { id: 42 }, from: { id: 42 } }/; s/send: \(text\) =>/send: (_chatId, text) =>/g' worker/src/handle.test.ts
```

Az utolsó csere azért kell, mert a `send` első paramétere mostantól a chat. A szövegre szűrő felülírások különben a chat-azonosítót néznék.

Az import sorok:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyKnocks,
  handleCallback,
  handleCron,
  handleLink,
  handleTap,
  handleUpdate,
  type PlannedKnock,
  type WorkerDeps,
} from './handle.js'
import { hashToken } from './plan.js'
import { memoryStore, type JobRow } from './store.js'

const ID = 'abcdefghijk'
const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const INVALID = 'A link lejárt vagy már nem érvényes. Kérj újat: /start'
```

A `function deps(…)` segéd teljes cseréje:

```ts
function deps(store: ReturnType<typeof memoryStore>, over: Partial<WorkerDeps> = {}): WorkerDeps & {
  sent: string[]
  chats: string[]
  knocked: string[]
  knocks: PlannedKnock[]
  buttons: { text: string; data: string }[]
  answered: string[]
} {
  const sent: string[] = []
  const chats: string[] = []
  const knocked: string[] = []
  const knocks: PlannedKnock[] = []
  const buttons: { text: string; data: string }[] = []
  const answered: string[] = []
  let next = 0
  return {
    allowedEmails: 'en@example.com',
    botUsername: 'refinery_bot',
    linkBase: 'https://worker.test',
    store,
    now: () => 1_000_000,
    newToken: () => String.fromCharCode(65 + next++).repeat(43),
    sent,
    chats,
    knocked,
    knocks,
    buttons,
    answered,
    answerTap: (callbackQueryId) => {
      answered.push(callbackQueryId)
      return Promise.resolve()
    },
    knock: (job) => {
      knocked.push(job.jobId)
      knocks.push(job)
      return Promise.resolve(202)
    },
    send: (chatId, text, button) => {
      chats.push(chatId)
      sent.push(text)
      if (button) buttons.push(button)
      return Promise.resolve(true)
    },
    ...over,
  }
}

async function boundStore(): Promise<ReturnType<typeof memoryStore>> {
  const store = memoryStore()
  await store.bind({ telegramUserId: '42', sub: 'sub-42', email: 'en@example.com', boundAt: 0 }, '42')
  return store
}
```

A `handleUpdate` első tesztjében a nem kötött 7-es felhasználó mostantól a „kösd össze” sort kapja. A teszt neve és első elvárása:

```ts
  it('a nem kötött felhasználó a kösd össze sort kapja, a kötött sora kopogtatás előtt megy ki', async () => {
```

```ts
    expect((await handleUpdate(update, foreign)).status).toBe(200)
    expect(foreign.sent).toEqual(['Előbb kösd össze a Google-fiókoddal: /start'])
```

- [x] **Step 2: Az új tesztek**

A `handle.test.ts` végére:

```ts
describe('kötés', () => {
  const message = (updateId: number, from: number, text: string) => ({
    update_id: updateId,
    message: { message_id: 1, chat: { id: from }, from: { id: from }, text },
  })
  const owner = { sub: 'sub-42', email: 'en@example.com' }

  it('a nem kötött felhasználó címe nem nyit sort, az ismételt /start nem ad második tokent', async () => {
    const store = memoryStore()
    const plain = deps(store)
    const result = await handleUpdate(message(1, 42, ID), plain)
    expect(result.knocks).toEqual([])
    expect(plain.sent).toEqual(['Előbb kösd össze a Google-fiókoddal: /start'])
    expect(await store.listByUpdate(1)).toEqual([])

    const flow = deps(store)
    await handleUpdate(message(2, 42, '/start'), flow)
    await handleUpdate(message(2, 42, '/start'), flow)
    expect(flow.sent).toEqual([`Kösd össze a Google-fiókoddal (10 percig érvényes): https://worker.test/link?t=${TOKEN_A}`])
    expect(await store.token(TOKEN_A)).toBeNull()
    expect(await store.token(await hashToken(TOKEN_A))).toMatchObject({
      telegramUserId: '42',
      expiresAt: 1_000_000 + 10 * 60 * 1000,
      pendingSub: null,
      used: false,
    })
    expect(await store.token(await hashToken(TOKEN_B))).toBeNull()
  })

  it('a /link visszatérő tokenre irányít, a visszatérés köt, és a régi sorok a fiókhoz kerülnek', async () => {
    const store = memoryStore()
    await store.insert(acceptedRow({ sub: null }))
    const flow = deps(store)
    await handleUpdate(message(1, 42, '/start'), flow)
    expect(await handleLink(TOKEN_A, owner, flow)).toEqual({
      status: 302,
      location: `https://t.me/refinery_bot?start=${TOKEN_B}`,
    })
    expect(await handleLink(TOKEN_A, owner, flow)).toEqual({ status: 200 })
    expect(await handleLink(TOKEN_B, owner, flow)).toEqual({ status: 200 })

    const back = deps(store)
    await handleUpdate(message(2, 42, `/start ${TOKEN_B}`), back)
    expect(back.sent).toEqual(['Bekötve: en@example.com.'])
    expect(await store.bindingFor('42')).toMatchObject({ sub: 'sub-42', email: 'en@example.com' })
    expect((await store.listByUpdate(5))[0]?.sub).toBe('sub-42')

    const again = deps(store)
    await handleUpdate(message(3, 42, `/start ${TOKEN_B}`), again)
    expect(again.sent).toEqual([INVALID])
    const plain = deps(store)
    await handleUpdate(message(4, 42, '/start'), plain)
    expect(plain.sent).toEqual(['Már be vagy kötve: en@example.com.'])
  })

  it('az idegen linkjét a tulajdonos lépteti be: sem az idegen, sem a tulajdonos nem köt', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 7, '/start'), flow)
    expect(await handleLink(TOKEN_A, owner, flow)).toEqual({
      status: 302,
      location: `https://t.me/refinery_bot?start=${TOKEN_B}`,
    })
    const stranger = deps(store)
    await handleUpdate(message(2, 7, `/start ${TOKEN_A}`), stranger)
    expect(stranger.sent).toEqual([INVALID])
    const victim = deps(store)
    await handleUpdate(message(3, 42, `/start ${TOKEN_B}`), victim)
    expect(victim.sent).toEqual([INVALID])
    expect(await store.bindingFor('7')).toBeNull()
    expect(await store.bindingFor('42')).toBeNull()
  })

  it('a lejárt, a kitalált és a rossz alakú token a /link-en hibaoldal', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 42, '/start'), flow)
    expect(await handleLink('rövid', owner, flow)).toEqual({ status: 200 })
    expect(await handleLink('C'.repeat(43), owner, flow)).toEqual({ status: 200 })
    const late = deps(store, { now: () => 1_000_000 + 10 * 60 * 1000 })
    expect(await handleLink(TOKEN_A, owner, late)).toEqual({ status: 200 })
  })

  it('a nem engedélyezett fiók visszatérése nem köt, és a token elhasználódik', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 42, '/start'), flow)
    await handleLink(TOKEN_A, { sub: 'sub-9', email: 'mas@example.com' }, flow)
    const back = deps(store)
    await handleUpdate(message(2, 42, `/start ${TOKEN_B}`), back)
    expect(back.sent).toEqual(['Ez a Google-fiók nincs engedélyezve: mas@example.com.'])
    expect(await store.bindingFor('42')).toBeNull()
    expect((await store.token(await hashToken(TOKEN_B)))?.used).toBe(true)
  })

  it('a listáról törölt e-mail kiesik, a gombja sem indít, és a sor üzenete a sor chatjére megy', async () => {
    const store = await boundStore()
    const removed = deps(store, { allowedEmails: 'mas@example.com' })
    expect((await handleUpdate(message(9, 42, ID), removed)).knocks).toEqual([])
    expect(removed.sent).toEqual(['Előbb kösd össze a Google-fiókoddal: /start'])
    await store.insert(acceptedRow({ status: 'ready', notifiedReady: true, title: 'Cím' }))
    const tap = {
      update_id: 90,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }
    expect(await handleTap(tap, removed)).toEqual([])

    const other = memoryStore()
    await other.insert(acceptedRow({ chatId: '77' }))
    const ok = deps(other)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.chats).toEqual(['77'])
  })

  it('más fiók sorára a gomb nem indít', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'ready', notifiedReady: true, title: 'Cím', sub: 'sub-9' }))
    const own = deps(store)
    const tap = {
      update_id: 91,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }
    expect(await handleTap(tap, own)).toEqual([])
    expect(own.sent).toEqual([])
  })
})
```

- [x] **Step 3: Fusson, bukjon**

Run: `pnpm vitest run worker/src/handle.test.ts`
Expected: FAIL, `handleLink is not a function`, és a régi tesztek a `send` új aláírása miatt

- [x] **Step 4: `worker/src/handle.ts` teljes cseréje**

```ts
import {
  BIND_FIRST,
  LINK_INVALID,
  MISSING_NOTE_URL,
  REJECTED_SECRET,
  TOKEN_TTL,
  alreadyBoundLine,
  alreadyLine,
  boundLine,
  decideStart,
  decideTap,
  hashToken,
  isAllowed,
  isToken,
  linesForMessage,
  linkLine,
  notAllowedLine,
  noteReadyMessage,
  queuedLine,
  readyLine,
  summaryButton,
  waitingLine,
} from './plan.js'
import type { Binding, JobRow, JobStore } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
  recipe?: 'summary'
}

export interface WorkerDeps {
  allowedEmails: string
  botUsername: string
  linkBase: string
  store: JobStore
  now: () => number
  newToken: () => string
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  send: (chatId: string, text: string, button?: { text: string; data: string }) => Promise<boolean>
  answerTap: (callbackQueryId: string) => Promise<void>
}

type KnockResult = 202 | 409 | 401 | 'down'

const START = /^\/start(?:\s+(\S+))?\s*$/

async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
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

async function settle(row: JobRow, result: KnockResult, deps: WorkerDeps): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    row.status = 'accepted'
    row.acceptedAt = deps.now()
    await deps.store.save(row)
    return
  }
  if (result === 401) {
    const sent = await deps.send(row.chatId, REJECTED_SECRET)
    if (!sent) return
    row.status = 'failed'
    row.error = REJECTED_SECRET
    await deps.store.save(row)
    return
  }
  if (row.status === 'waiting') return
  const sent = await deps.send(row.chatId, waitingLine(row.videoId))
  if (!sent) return
  row.status = 'waiting'
  await deps.store.save(row)
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
  if (token === null || action.type === 'invalid') {
    await deps.send(chatId, LINK_INVALID)
    return
  }
  await deps.store.saveToken({ ...token, used: true })
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
    const row = await findRow(deps.store, knock.jobId)
    if (!row) continue
    await settle(row, await deps.knock(knock), deps)
  }
}

export async function handleCallback(
  jobId: string,
  body: { status: 'ready'; title: string; noteUrl?: string } | { status: 'failed'; error: string },
  deps: WorkerDeps,
): Promise<number> {
  const row = await findRow(deps.store, jobId)
  if (!row) return 200
  if (body.status === 'failed') {
    const sent = await deps.send(row.chatId, body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.phase === 'summary') {
    if (row.noteNotified) return 200
    if (body.noteUrl === undefined || body.noteUrl === '') {
      const sent = await deps.send(row.chatId, MISSING_NOTE_URL)
      if (!sent) return 200
      row.status = 'failed'
      row.error = MISSING_NOTE_URL
      await deps.store.save(row)
      return 200
    }
    row.title = body.title
    row.noteUrl = body.noteUrl
    const sent = await deps.send(row.chatId, noteReadyMessage(body.title, body.noteUrl))
    if (!sent) {
      row.status = 'accepted'
      row.noteNotified = false
      await deps.store.save(row)
      return 200
    }
    row.status = 'ready'
    row.noteNotified = true
    await deps.store.save(row)
    return 200
  }
  if (row.notifiedReady) return 200
  row.title = body.title
  const sent = await deps.send(row.chatId, readyLine(body.title), summaryButton(row.jobId))
  if (!sent) {
    await deps.store.save(row)
    return 200
  }
  row.status = 'ready'
  row.notifiedReady = true
  await deps.store.save(row)
  return 200
}

export async function handleTap(
  update: {
    update_id: number
    callback_query: { id: string; data?: string; from?: { id: number }; message?: { chat: { id: number } } }
  },
  deps: WorkerDeps,
): Promise<PlannedKnock[]> {
  await deps.answerTap(update.callback_query.id)
  if (!(await deps.store.rememberUpdate(update.update_id))) return []
  const from = update.callback_query.from
  const binding = await allowedBinding(from === undefined ? undefined : String(from.id), deps)
  if (binding === null) return []
  const data = update.callback_query.data ?? ''
  if (!data.startsWith('summary:')) return []
  const jobId = data.slice('summary:'.length)
  const row = await findRow(deps.store, jobId)
  const action = decideTap(row, row?.sub === binding.sub)
  if (action.type === 'busy') {
    if (row) await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  if (action.type === 'resend') {
    if (row?.title && row.noteUrl) await deps.send(row.chatId, noteReadyMessage(row.title, row.noteUrl))
    return []
  }
  if (action.type === 'ignore') return []
  const claimed =
    action.type === 'start'
      ? await deps.store.claim(jobId, { phase: 'subtitle', status: 'ready' }, { phase: 'summary', status: 'queued' })
      : await deps.store.claim(jobId, { phase: 'summary', status: 'failed' }, { phase: 'summary', status: 'queued' })
  if (claimed === null) {
    if (row) await deps.send(row.chatId, alreadyLine(row.videoId))
    return []
  }
  return [{ jobId: claimed.jobId, videoId: claimed.videoId, url: claimed.url, recipe: 'summary' }]
}

export async function handleCron(deps: WorkerDeps): Promise<void> {
  for (const row of await deps.store.due(deps.now())) {
    const knock: PlannedKnock = { jobId: row.jobId, videoId: row.videoId, url: row.url }
    if (row.phase === 'summary') knock.recipe = 'summary'
    await settle(row, await deps.knock(knock), deps)
  }
}
```

- [x] **Step 5: Zöld**

Run: `pnpm vitest run worker/src/handle.test.ts worker/src/plan.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add worker/src/handle.ts worker/src/handle.test.ts
git commit -m "feat(worker): Bind Telegram users and authorize by e-mail"
```

---

### Task 4: A `/link` útvonal és a Worker-belépés

**Files:**
- Modify: `worker/src/index.ts` (teljes csere)
- Test: `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: `handleLink`, `WorkerDeps` (3. feladat), `newToken`, `LINK_INVALID_PAGE` (2. feladat)
- Produces: `Env` új alakja: `DB`, `ALLOWED_EMAILS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `REFINERY_SERVE_SECRET`, `SERVE_URL`. `ExecutionContext.access?: { getIdentity(): Promise<{ email?: unknown; user_uuid?: unknown } | undefined> }`.

- [x] **Step 1: A belépési tesztek átállítása**

```bash
perl -0pi -e "s/TELEGRAM_OWNER_CHAT_ID: '42',/ALLOWED_EMAILS: 'en\@example.com',\n      TELEGRAM_BOT_USERNAME: 'refinery_bot',/g; s/message: \{ message_id: 1, chat: \{ id: 42 \}, text/message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text/; s/message: \{ chat: \{ id: 7 \} \} \}/from: { id: 7 }, message: { chat: { id: 7 } } }/" worker/src/entry.test.ts
```

A `memoryDb` `first: <T>() => Promise.resolve(null as T | null),` sorát erre cseréld. A kötés-lekérdezés így mindig kötést ad vissza, tehát a 42-es felhasználó kötött. (A 7-es is, de az ő gombjához nincs sor, ezért a gombteszt változatlanul csak az `answerCallbackQuery` hívást várja.)

```ts
        first: <T>() =>
          Promise.resolve(
            (state.sql.includes('FROM bindings')
              ? { telegram_user_id: '42', sub: 'sub-42', email: 'en@example.com', bound_at: 0 }
              : null) as T | null,
          ),
```

A „worker belépés” `describe` végére:

```ts
  it('a /link azonosító nélkül 403, a /Link és a //link 404, ismeretlen tokenre a hibaoldal', async () => {
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 200 }))
    const env = {
      DB: memoryDb(),
      ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const link = `/link?t=${'A'.repeat(43)}`
    const get = (path: string) => new Request(`https://worker.test${path}`)
    const plain = { waitUntil: () => undefined }
    const signed = {
      waitUntil: () => undefined,
      access: { getIdentity: () => Promise.resolve({ email: 'en@example.com', user_uuid: 'sub-42' }) },
    }
    const empty = { waitUntil: () => undefined, access: { getIdentity: () => Promise.resolve(undefined) } }
    const broken = { waitUntil: () => undefined, access: { getIdentity: () => Promise.reject(new Error('nincs')) } }
    const noUuid = {
      waitUntil: () => undefined,
      access: { getIdentity: () => Promise.resolve({ email: 'en@example.com', user_uuid: '' }) },
    }
    expect((await worker.fetch(get(link), env, plain)).status).toBe(403)
    expect((await worker.fetch(get(link), env, empty)).status).toBe(403)
    expect((await worker.fetch(get(link), env, broken)).status).toBe(403)
    expect((await worker.fetch(get(link), env, noUuid)).status).toBe(403)
    expect((await worker.fetch(get('/Link?t=x'), env, signed)).status).toBe(404)
    expect((await worker.fetch(get('//link?t=x'), env, signed)).status).toBe(404)
    const page = await worker.fetch(get(link), env, signed)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('A link lejárt vagy már nem érvényes. Kérj újat a botban: /start')
  })
```

- [x] **Step 2: Fusson, bukjon**

Run: `pnpm vitest run worker/src/entry.test.ts`
Expected: FAIL, a `/link` `404`-et ad a `403` helyett

- [x] **Step 3: `worker/src/index.ts` teljes cseréje**

```ts
import { createD1Store, type D1Like } from './d1.js'
import {
  applyKnocks,
  handleCallback,
  handleCron,
  handleLink,
  handleTap,
  handleUpdate,
  type WorkerDeps,
} from './handle.js'
import { LINK_INVALID_PAGE, newToken } from './plan.js'

interface Env {
  DB: D1Like
  ALLOWED_EMAILS: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_BOT_USERNAME: string
  TELEGRAM_WEBHOOK_SECRET: string
  REFINERY_SERVE_SECRET: string
  SERVE_URL: string
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  access?: { getIdentity(): Promise<{ email?: unknown; user_uuid?: unknown } | undefined> }
}

const INVALID_LINK_PAGE = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Transcript Refinery</title><p>${LINK_INVALID_PAGE}</p></html>`

function sameText(actual: string | undefined, expected: string | undefined): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected === '' || actual.length !== expected.length) {
    return false
  }
  let diff = 0
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

async function identity(ctx: ExecutionContext): Promise<{ sub: string; email: string } | null> {
  if (ctx.access === undefined) return null
  try {
    const who = await ctx.access.getIdentity()
    if (who === undefined || typeof who.email !== 'string' || who.email === '') return null
    if (typeof who.user_uuid !== 'string' || who.user_uuid === '') return null
    return { sub: who.user_uuid, email: who.email }
  } catch {
    return null
  }
}

function deps(env: Env, linkBase = ''): WorkerDeps {
  return {
    allowedEmails: env.ALLOWED_EMAILS,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    linkBase,
    store: createD1Store(env.DB),
    now: () => Date.now(),
    newToken,
    knock: async (job) => {
      try {
        const response = await fetch(`${env.SERVE_URL.replace(/\/$/, '')}/jobs`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.REFINERY_SERVE_SECRET}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(job),
        })
        if (response.status === 202 || response.status === 409 || response.status === 401) return response.status
        return 'down'
      } catch {
        return 'down'
      }
    },
    send: async (chatId, text, button) => {
      const payload: {
        chat_id: string
        text: string
        reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] }
      } = { chat_id: chatId, text }
      if (button) payload.reply_markup = { inline_keyboard: [[{ text: button.text, callback_data: button.data }]] }
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return response.ok
      } catch {
        return false
      }
    },
    answerTap: async (callbackQueryId) => {
      try {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQueryId }),
        })
      } catch {
        return undefined
      }
    },
  }
}

function hasNumericId(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number'
}

function isTap(value: unknown): value is {
  update_id: number
  callback_query: { id: string; data?: string; from?: { id: number }; message?: { chat: { id: number } } }
} {
  if (typeof value !== 'object' || value === null) return false
  const update = value as { update_id?: unknown; callback_query?: unknown }
  if (typeof update.update_id !== 'number') return false
  if (typeof update.callback_query !== 'object' || update.callback_query === null) return false
  const query = update.callback_query as { id?: unknown; from?: unknown }
  if (query.from !== undefined && !hasNumericId(query.from)) return false
  return typeof query.id === 'string'
}

function isUpdate(value: unknown): value is {
  update_id: number
  message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string }
} {
  if (typeof value !== 'object' || value === null) return false
  const update = value as { update_id?: unknown; message?: unknown }
  if (typeof update.update_id !== 'number') return false
  if (update.message === undefined) return true
  if (typeof update.message !== 'object' || update.message === null) return false
  const message = update.message as { message_id?: unknown; chat?: unknown; from?: unknown }
  if (typeof message.message_id !== 'number') return false
  if (message.from !== undefined && !hasNumericId(message.from)) return false
  return hasNumericId(message.chat)
}

function isCallback(
  value: unknown,
): value is { status: 'ready'; title: string; noteUrl?: string } | { status: 'failed'; error: string } {
  if (typeof value !== 'object' || value === null) return false
  const body = value as { status?: unknown; title?: unknown; error?: unknown; noteUrl?: unknown }
  if (body.status === 'ready') {
    if (typeof body.title !== 'string') return false
    return body.noteUrl === undefined || typeof body.noteUrl === 'string'
  }
  if (body.status === 'failed') return typeof body.error === 'string'
  return false
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/telegram' && request.method === 'POST') {
      const hook = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
      if (!sameText(hook, env.TELEGRAM_WEBHOOK_SECRET)) return new Response(null, { status: 401 })
      let update: unknown
      try {
        update = await request.json()
      } catch {
        return new Response(null, { status: 400 })
      }
      const workerDeps = deps(env, url.origin)
      if (isTap(update)) {
        const knocks = await handleTap(update, workerDeps)
        ctx.waitUntil(applyKnocks(knocks, workerDeps))
        return new Response(null, { status: 200 })
      }
      if (!isUpdate(update)) return new Response(null, { status: 400 })
      const result = await handleUpdate(update, workerDeps)
      ctx.waitUntil(applyKnocks(result.knocks, workerDeps))
      return new Response(null, { status: 200 })
    }
    if (url.pathname === '/link' && request.method === 'GET') {
      const who = await identity(ctx)
      if (who === null) return new Response(null, { status: 403 })
      const result = await handleLink(url.searchParams.get('t') ?? '', who, deps(env, url.origin))
      if (result.status === 302) return Response.redirect(result.location, 302)
      return new Response(INVALID_LINK_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    const match = /^\/internal\/jobs\/([^/]+)$/.exec(url.pathname)
    if (match?.[1] !== undefined && request.method === 'POST') {
      if (!sameText(request.headers.get('authorization') ?? '', `Bearer ${env.REFINERY_SERVE_SECRET}`)) {
        return new Response(null, { status: 401 })
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response(null, { status: 400 })
      }
      if (!isCallback(body)) return new Response(null, { status: 400 })
      const status = await handleCallback(decodeURIComponent(match[1]), body, deps(env))
      return new Response(null, { status })
    }
    return new Response(null, { status: 404 })
  },
  async scheduled(_controller: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleCron(deps(env))
  },
}

export default worker
```

- [x] **Step 4: Zöld, teljes ellenőrzés**

Run: `pnpm vitest run worker`
Expected: PASS
Run: `pnpm exec tsc -p worker/tsconfig.json && pnpm lint`
Expected: hibátlan

- [x] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/entry.test.ts
git commit -m "feat(worker): Serve the Access-protected binding link"
```

---

### Task 5: Változók, helyi kötés, üzemeltetési leírás

**Files:**
- Modify: `.env.example`
- Modify: `scripts/worker-dev-vars.sh`
- Modify: `scripts/telegram-debug.sh`
- Modify: `docs/operations/telegram-worker-topology.md`

Helyben nincs Access, ezért a debug-script a saját Telegram-azonosítóhoz közvetlenül beír egy kötést a helyi D1-be. A `TELEGRAM_OWNER_CHAT_ID` az Infisicalban marad, de csak erre szolgál.

- [ ] **Step 1: `.env.example`**

Ezt a blokkot:

```
# A saját privát chat `message.chat.id` értéke. Csak ez a chat nyit sort.
TELEGRAM_OWNER_CHAT_ID=
```

erre cseréld:

```
# Vesszővel elválasztott e-mailek. Csak az ezekhez kötött Telegram-felhasználó nyit sort.
ALLOWED_EMAILS=

# A bot felhasználóneve `@` nélkül. A kötés a `t.me/<név>` címre irányít vissza.
TELEGRAM_BOT_USERNAME=
```

- [ ] **Step 2: `scripts/worker-dev-vars.sh`**

```bash
perl -pi -e 's/keys="TELEGRAM_BOT_TOKEN TELEGRAM_OWNER_CHAT_ID /keys="TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME ALLOWED_EMAILS /; s/A Worker öt változó/A Worker hat változó/g' scripts/worker-dev-vars.sh
```

Ellenőrzés: `grep -n 'keys=\|hat változó' scripts/worker-dev-vars.sh` két sort mutat, a `keys=` sorban hat név van.

- [ ] **Step 3: `scripts/telegram-debug.sh`**

A `.dev.vars` írásában a `printf 'TELEGRAM_OWNER_CHAT_ID=%s\n' "$owner"` sor helyére:

```sh
  printf 'ALLOWED_EMAILS=%s\n' "debug@localhost"
  printf 'TELEGRAM_BOT_USERNAME=%s\n' "debug"
```

A hiányzó titkok ellenőrzése (`if [ "${#webhook_secret}" -lt 16 ] … fi`) után, új blokként:

```sh
# Helyben nincs Access. A saját Telegram-azonosító kötése közvetlenül a helyi D1-be kerül.
case $owner in
  ''|*[!0-9]*)
    echo "A TELEGRAM_OWNER_CHAT_ID nem szám." >&2
    exit 1
    ;;
esac
npx wrangler d1 execute transcript-refinery --local --config worker/wrangler.toml --command \
  "INSERT OR REPLACE INTO bindings (telegram_user_id, sub, email, bound_at) VALUES ('$owner', 'debug', 'debug@localhost', 0)"
```

Ellenőrzés: `bash -n scripts/telegram-debug.sh` hibátlan.

- [ ] **Step 4: `docs/operations/telegram-worker-topology.md`**

A debug-táblázat `| TELEGRAM_OWNER_CHAT_ID | TELEGRAM_OWNER_CHAT_ID |` sora helyére:

```
| `TELEGRAM_OWNER_CHAT_ID` | — (a helyi D1 `bindings` sora, `debug@localhost`) |
| — | `ALLOWED_EMAILS=debug@localhost` |
| — | `TELEGRAM_BOT_USERNAME=debug` |
```

A „Biztonsági szűrés” megjegyzés helyére:

```
> [!NOTE]
> **Biztonsági szűrés**: A bot csak attól a Telegram-felhasználótól (`from.id`) fogad parancsot, aki a `/start` után Google-belépéssel kötötte magát, és akinek a kötött e-mailje az `ALLOWED_EMAILS` listán van. Mindenki más a `Előbb kösd össze a Google-fiókoddal: /start` sort kapja, sor és kopogtatás nélkül. A kötés útvonala a `/link`, ezt Cloudflare Access védi.
```

A szimulált frissítés `curl` példájában a `\"chat\": {\"id\": $TELEGRAM_OWNER_CHAT_ID}` után: `, \"from\": {\"id\": $TELEGRAM_OWNER_CHAT_ID}`.

- [ ] **Step 5: Commit**

```bash
git add .env.example scripts/worker-dev-vars.sh scripts/telegram-debug.sh docs/operations/telegram-worker-topology.md
git commit -m "docs(worker): Describe binding variables and local binding"
```

---

### Task 6: Élesítés (kézi, minden lépés a felhasználó jóváhagyásával)

Kifelé ható lépések. Mindegyik előtt szólj, és várd meg az igent.

- [ ] **Step 1: Infisical.** A `/peter-mbp` úton, `dev` környezetben: `ALLOWED_EMAILS` (a saját e-mail) és `TELEGRAM_BOT_USERNAME` (a bot neve `@` nélkül).
- [ ] **Step 2: Access.** Zero Trust → Settings → Authentication: Google login method. Workers & Pages → `transcript-refinery` → Settings → Domains & Routes → `workers.dev` → Enable Cloudflare Access, majd Manage Cloudflare Access. Az alkalmazás célja a Worker hosztneve, `link` útvonallal. A szabály: Include → Emails → a saját e-mail. A fiókszintű „minden Worker védelme” kapcsoló ki marad.
- [ ] **Step 3: Migráció.** `pnpm worker:migrate`
- [ ] **Step 4: Titkok.** `npx wrangler secret put ALLOWED_EMAILS --config worker/wrangler.toml`, `npx wrangler secret put TELEGRAM_BOT_USERNAME --config worker/wrangler.toml`, `npx wrangler secret delete TELEGRAM_OWNER_CHAT_ID --config worker/wrangler.toml`
- [ ] **Step 5: Telepítés.** `pnpm worker:deploy`
- [ ] **Step 6: A siker.** Telegramon egy YouTube-cím → a bot az `Előbb kösd össze…` sort adja. Ez azt is igazolja, hogy az Access nem fedi a webhookot. Utána `/start` → a link a rendszer böngészőjében → Google-belépés → vissza a Telegramba → `Bekötve: <e-mail>.` Végül egy YouTube-cím → `Sorba került: …`.

Ha a 6. lépés első üzenete nem érkezik meg, az Access valószínűleg a teljes hosztnevet fedi. Ilyenkor az alkalmazás célját kell a `link` útvonalra szűkíteni.
