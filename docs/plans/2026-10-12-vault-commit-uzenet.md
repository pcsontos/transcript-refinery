# Vault-commit üzenete: jegyzetenként egy commit — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vault `git log --oneline` sorából derüljön ki, melyik videó melyik jegyzete került be: minden jegyzet saját commitot kap, amelynek első sora megnevezi a jegyzet fajtáját, a videó címét és teljes azonosítóját.

**Architecture:** Egy új modul (`src/vault/commit.ts`) két függvényt ad: a `noteCommitMessage` tiszta függvény állítja elő az első sort, a `commitPending` pedig a commitra váró jegyzeteket egyenként commitolja. Az állapottár új `listPendingNotes()` lekérdezése adja hozzá a jegyzetenkénti adatot. A `run` és a `watch` a `commitPending`-et hívja, a Telegram-út (`serve`) a saját fájllistáján megy végig a `noteCommitMessage`-dzsel.

**Tech Stack:** TypeScript, Vitest, Node (`node:sqlite`), git. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-12-vault-commit-uzenet-spec.md`

Az implementáció a `feat/impl-vault-commit-uzenet` ágon, külön worktree-ben indul a friss `main`-ről, miután ez a terv (a `docs/vault-commit-uzenet-terv` ágon) bekerült. Issue: #215. A terv kódja egy próbamegvalósításból származik (lezárt #216 PR), ott a teljes kör zöld volt.

## Global Constraints

- Az első sor formátuma, szó szerint: `docs(transcript-refinery): <fajta> | <cím> [<azonosító>]`; csonkolt címnél `docs(transcript-refinery): <fajta> | <csonka cím>…[<azonosító>]` (a `…` és a `[` között nincs szóköz).
- Az első sor legfeljebb 80 karakter, Unicode-kódpontban számolva. A cím rövidül, az azonosító soha; ha az azonosító mellett címnek nem marad hely, a sor átlépheti a korlátot.
- A scope mindenhol a `src/meta.ts` `COMMIT_SCOPE` konstansa (`transcript-refinery`), beégetett szöveg nincs.
- A fajta `transcript` vagy a recept azonosítója, ahogy a `pending_commits.kind` tárolja (`summary`, `qa`, `summary-hu`, …).
- Az azonosító az `items.video_id`; ha nincs, az `item_id`.
- A sor fájljának saját commitja, szó szerint: `docs(transcript-refinery): feldolgozási sor frissítése`. A `watch — ` előtag sehol nem szerepel.
- Megszűnő üzenetek: `átirat N videóhoz`, `N jegyzet a feldolgozási sorból`, `watch — átirat N videóhoz`, `watch — feldolgozási sor frissítése`.
- A `refinery scan --queue` commitja (`src/cli.ts:220`) és a `--no-commit` viselkedése nem változik.
- Push futásonként egyszer megy, a commitok után, és csak akkor, ha legalább egy commit készült.
- A `listPendingCommits()` megmarad; a meglévő tesztjei nem változnak.
- A teszt nem éri el a GitHubot, a Telegramot és a modellt; a gites tesztek ideiglenes mappában dolgoznak.
- Minden feladat végén: `pnpm test` zöld, `pnpm typecheck` és `pnpm lint` hibátlan.
- Commit üzenetet a `commit-message` skill ír; a lépésekben szereplő üzenet a javasolt tartalom.

## Review Focus

1. A cím csak az azonosítóból áll (`[dQw4w9WgXcQ]`, yt-dlp fájlnév cím nélkül): a sor `<fajta> | [<azonosító>]`, nem üres cím és nem dupla szóköz. (1. feladat, `commit.test.ts`.)
2. A vágás helyére több kódegységből álló karakter (emoji) esik: a sor pontosan 80 karakter, és nem marad benne fél karakter. (1. feladat, `commit.test.ts`.)
3. Egy jegyzet fájlja nem változott (már korábban bekerült): nincs róla commit, de lekerül a várólistáról, különben minden futás újra próbálná. (3. feladat, `commit.test.ts`.)
4. Második Telegram-kérés ugyanarra a videóra más recepttel: csak az új jegyzet kap commitot, az átirat nem kap másodikat. (6. feladat, `summary.test.ts`.)
5. A `watch` egy körben két új videót talál (induló felzárkózás): két commit készül, a terminálsor az utolsó hashét és a darabszámot írja ki. (5. feladat, `round.test.ts`.)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/vault/commit.ts` (új) | `noteCommitMessage`: az első sor; `commitPending`: jegyzetenkénti commit, a sor fájlja az utolsóval |
| `src/vault/commit.test.ts` (új) | A két függvény egységtesztjei |
| `src/state/db.ts` | `PendingNote` típus, `StateStore.listPendingNotes()` |
| `src/cli.ts` | A `run` commit-blokkja a `commitPending`-et hívja |
| `src/watch/round.ts` | A `watch` commit-blokkja a `commitPending`-et hívja; a terminálsor darabszáma |
| `src/serve/summary.ts` | A Telegram-út fájlonként commitol a `noteCommitMessage`-dzsel |

---

### Task 1: Az első sor (`noteCommitMessage`)

**Files:**
- Create: `src/vault/commit.ts`
- Test: `src/vault/commit.test.ts`

**Interfaces:**
- Consumes: `COMMIT_SCOPE` a `src/meta.ts`-ből.
- Produces: `noteCommitMessage(kind: string, title: string, id: string): string`

- [ ] **Step 1: Írd meg a bukó tesztet**

Hozd létre a `src/vault/commit.test.ts` fájlt:

```ts
import { describe, expect, it } from 'vitest'
import { noteCommitMessage } from './commit.js'

describe('noteCommitMessage', () => {
  it('rövid címnél a cím és az azonosító is ép', () => {
    expect(noteCommitMessage('summary', 'Beszéd', 'dQw4w9WgXcQ')).toBe(
      'docs(transcript-refinery): summary | Beszéd [dQw4w9WgXcQ]',
    )
  })

  it('hosszú címnél az első sor pontosan 80 karakter, az azonosító ép', () => {
    const message = noteCommitMessage('summary-hu', 'It took me 10+ years to realize what really matters', 'D0Vw5X2PSIQ')
    expect([...message].length).toBe(80)
    expect(message.startsWith('docs(transcript-refinery): summary-hu | It took me 10+ years')).toBe(true)
    expect(message.endsWith('…[D0Vw5X2PSIQ]')).toBe(true)
  })

  it('a címben ismétlődő azonosítót és a sortörést kiveszi', () => {
    expect(noteCommitMessage('qa', 'Beszéd\nmásodik sor [dQw4w9WgXcQ]', 'dQw4w9WgXcQ')).toBe(
      'docs(transcript-refinery): qa | Beszéd második sor [dQw4w9WgXcQ]',
    )
  })

  it('ha az azonosító mellett nem fér el cím, az azonosító akkor is teljes', () => {
    const id = 'x'.repeat(60)
    expect(noteCommitMessage('summary', 'Beszéd', id)).toBe(`docs(transcript-refinery): summary | …[${id}]`)
  })

  it('ha a cím csak az azonosítóból áll, a sorban csak az azonosító marad', () => {
    expect(noteCommitMessage('summary', '[dQw4w9WgXcQ]', 'dQw4w9WgXcQ')).toBe(
      'docs(transcript-refinery): summary | [dQw4w9WgXcQ]',
    )
  })

  it('a vágás nem töri ketté a több kódegységből álló karaktert', () => {
    const message = noteCommitMessage('summary', '😀'.repeat(60), 'dQw4w9WgXcQ')
    expect(message).toBe(`docs(transcript-refinery): summary | ${'😀'.repeat(29)}…[dQw4w9WgXcQ]`)
    expect([...message].length).toBe(80)
  })
})
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/vault/commit.test.ts`
Expected: FAIL, a `./commit.js` modul nem található.

- [ ] **Step 3: Írd meg a minimális megvalósítást**

Hozd létre a `src/vault/commit.ts` fájlt:

```ts
import { COMMIT_SCOPE } from '../meta.js'

/** A commit első sorának hosszkorlátja. */
const SUBJECT_MAX = 80

/**
 * Egy jegyzet commitjának első sora: `<fajta> | <cím> [<azonosító>]`. A cím
 * rövidül, az azonosító soha: ha mellette nem fér el cím, a sor inkább átlépi
 * a korlátot.
 */
export function noteCommitMessage(kind: string, title: string, id: string): string {
  const head = `docs(${COMMIT_SCOPE}): ${kind} | `
  // A yt-dlp fájlnevéből örökölt cím végén ott az azonosító: kétszer nem kell.
  const clean = title.replace(`[${id}]`, '').replace(/\s+/g, ' ').trim()
  const chars = [...clean]
  const room = SUBJECT_MAX - [...head].length - [...id].length - 2
  if (chars.length === 0) return `${head}[${id}]`
  if (chars.length + 1 <= room) return `${head}${clean} [${id}]`
  return `${head}${chars.slice(0, Math.max(room - 1, 0)).join('').trimEnd()}…[${id}]`
}
```

A `room` a címre és az előtte vagy utána álló egy karakterre (szóköz vagy `…`) jutó hely: a 80-ból lejön az előtag, az azonosító és a két szögletes zárójel. A `[...szöveg]` kódpontokra bont, ezért a vágás nem töri ketté az emojit.

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm vitest run src/vault/commit.test.ts`
Expected: PASS, 6 teszt.

- [ ] **Step 5: Típus és lint**

Run: `pnpm typecheck && pnpm lint`
Expected: hibátlan.

- [ ] **Step 6: Commit**

```bash
git add src/vault/commit.ts src/vault/commit.test.ts
git commit -m "feat(vault): Add the note commit subject line"
```

---

### Task 2: Jegyzetenkénti lekérdezés az állapottárban (`listPendingNotes`)

**Files:**
- Modify: `src/state/db.ts` (a `TranscriptRecord` interfész előtt; a `StateStore` interfészben a `listPendingCommits()` után; az `openState` visszaadott objektumában a `listPendingCommits()` után)
- Test: `src/state/db.test.ts` (a `StateStore — commitra váró műtermékek` blokk vége)

**Interfaces:**
- Consumes: a meglévő `pending_commits (item_id, kind, path)` és `items (item_id, title, video_id)` tábla.
- Produces: `interface PendingNote { id: string; title: string; kind: string; path: string }` és `StateStore.listPendingNotes(): PendingNote[]`, rögzítési (`rowid`) sorrendben.

- [ ] **Step 1: Írd meg a bukó tesztet**

A `src/state/db.test.ts` `StateStore — commitra váró műtermékek` blokkjának végére, a `rögzítés sorrendjében sorolja fel…` teszt után:

```ts
  it('jegyzetenként adja a videóazonosítót, a címet és a fajtát', () => {
    store.recordItem(item({ title: 'Első', metadata: { videoId: 'dQw4w9WgXcQ' } }))
    store.recordItem(item({ itemId: 'masik', title: 'Második' }))
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a-t.md', null, undefined, true)
    store.recordArtifact('masik', 'transcript', 'done', '/v/m-t.md', null, undefined, true)
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/a-s.md', null, undefined, true)
    expect(store.listPendingNotes()).toEqual([
      { id: 'dQw4w9WgXcQ', title: 'Első', kind: 'transcript', path: '/v/a-t.md' },
      { id: 'masik', title: 'Második', kind: 'transcript', path: '/v/m-t.md' },
      { id: 'dQw4w9WgXcQ', title: 'Első', kind: 'summary', path: '/v/a-s.md' },
    ])
  })
```

Az első elemnek van `videoId`-ja, a másodiknak nincs: a teszt mindkét azonosító-ágat és a rögzítési sorrendet is rögzíti.

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/state/db.test.ts`
Expected: FAIL, `store.listPendingNotes is not a function`.

- [ ] **Step 3: Írd meg a megvalósítást**

A `src/state/db.ts`-ben a séma záró `` ` `` sora után, az `export interface TranscriptRecord {` elé:

```ts
/** Egy commitra váró jegyzet. Az `id` a videóazonosító, annak híján az elem azonosítója. */
export interface PendingNote {
  id: string
  title: string
  /** `transcript` vagy a recept azonosítója. */
  kind: string
  path: string
}

```

A `StateStore` interfészben a `listPendingCommits(): string[]` sor után:

```ts
  /** Ugyanez jegyzetenként, a commit üzenetéhez kellő azonosítóval, címmel és fajtával. */
  listPendingNotes(): PendingNote[]
```

Az `openState` visszaadott objektumában a `listPendingCommits() { … },` metódus után, a `clearPendingCommits(paths) {` elé:

```ts
    listPendingNotes() {
      return db
        .prepare(
          `SELECT COALESCE(i.video_id, p.item_id) AS id, COALESCE(i.title, p.item_id) AS title, p.kind, p.path
           FROM pending_commits p LEFT JOIN items i ON i.item_id = p.item_id ORDER BY p.rowid`,
        )
        .all() as unknown as PendingNote[]
    },

```

A `LEFT JOIN` szándékos: ha egy várólistán lévő jegyzet eleme hiányozna az `items`-ből, a sima `JOIN` szó nélkül kihagyná, és a jegyzet soha nem kerülne commitba.

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm vitest run src/state/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Típus és lint**

Run: `pnpm typecheck && pnpm lint`
Expected: hibátlan.

- [ ] **Step 6: Commit**

```bash
git add src/state/db.ts src/state/db.test.ts
git commit -m "feat(state): List pending notes with video id and title"
```

---

### Task 3: Jegyzetenkénti commit (`commitPending`)

**Files:**
- Modify: `src/vault/commit.ts`
- Test: `src/vault/commit.test.ts`

**Interfaces:**
- Consumes: `noteCommitMessage(kind, title, id)` (1. feladat); `StateStore.listPendingNotes(): PendingNote[]` és `StateStore.clearPendingCommits(paths: readonly string[]): void` (2. feladat, illetve meglévő); `gitCommitPaths(repo: string, paths: readonly string[], message: string): Promise<boolean>` a `src/vault/git.ts`-ből (`false`, ha nem volt mit commitolni).
- Produces: `commitPending(repo: string, store: StateStore, queuePath: string | null): Promise<number>` — a készült commitok száma; pusht nem végez.

- [ ] **Step 1: Írd meg a bukó teszteket**

A `src/vault/commit.test.ts` import-blokkját cseréld erre (a `vi.mock` a `gitCommitPaths`-t helyettesíti; a `noteCommitMessage` tesztjeit nem érinti):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingNote, StateStore } from '../state/db.js'
import { commitPending, noteCommitMessage } from './commit.js'
import { gitCommitPaths } from './git.js'

vi.mock('./git.js', () => ({ gitCommitPaths: vi.fn() }))
```

A fájl végére, a `noteCommitMessage` blokk után:

```ts
describe('commitPending', () => {
  const note = (kind: string, path: string): PendingNote => ({ id: 'a1', title: 'Első videó', kind, path })

  function storeWith(notes: PendingNote[]) {
    const cleared: string[] = []
    const store = {
      listPendingNotes: () => notes,
      clearPendingCommits: (paths: readonly string[]) => {
        cleared.push(...paths)
      },
    } as unknown as StateStore
    return { store, cleared }
  }

  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockReset()
  })

  it('jegyzetenként egy commit; a sor fájlja az utolsóval megy', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValue(true)
    const { store, cleared } = storeWith([note('transcript', '/v/t.md'), note('summary', '/v/s.md')])

    expect(await commitPending('/v', store, '/v/_queue.md')).toBe(2)

    expect(vi.mocked(gitCommitPaths).mock.calls).toEqual([
      ['/v', ['/v/t.md'], 'docs(transcript-refinery): transcript | Első videó [a1]'],
      ['/v', ['/v/s.md', '/v/_queue.md'], 'docs(transcript-refinery): summary | Első videó [a1]'],
    ])
    expect(cleared).toEqual(['/v/t.md', '/v/s.md'])
  })

  it('jegyzet nélkül a sor saját commitot kap', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValue(true)
    const { store } = storeWith([])

    expect(await commitPending('/v', store, '/v/_queue.md')).toBe(1)

    expect(vi.mocked(gitCommitPaths).mock.calls).toEqual([
      ['/v', ['/v/_queue.md'], 'docs(transcript-refinery): feldolgozási sor frissítése'],
    ])
  })

  it('jegyzet és sor nélkül nem hív gitet', async () => {
    const { store } = storeWith([])

    expect(await commitPending('/v', store, null)).toBe(0)

    expect(vi.mocked(gitCommitPaths)).not.toHaveBeenCalled()
  })

  it('nem változott fájlról nincs commit, de a jegyzet lekerül a várólistáról', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValue(false)
    const { store, cleared } = storeWith([note('transcript', '/v/t.md')])

    expect(await commitPending('/v', store, null)).toBe(0)

    expect(cleared).toEqual(['/v/t.md'])
  })

  it('ha egy commit hibát dob, a sorozat megáll, és a hátralévő jegyzet a várólistán marad', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('git hiba'))
    const { store, cleared } = storeWith([note('transcript', '/v/t.md'), note('summary', '/v/s.md')])

    await expect(commitPending('/v', store, null)).rejects.toThrow('git hiba')

    expect(cleared).toEqual(['/v/t.md'])
  })
})
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/vault/commit.test.ts`
Expected: FAIL, a `commitPending` nem exportált (`commitPending is not a function`).

- [ ] **Step 3: Írd meg a megvalósítást**

A `src/vault/commit.ts` import-sorát cseréld erre:

```ts
import { COMMIT_SCOPE } from '../meta.js'
import type { StateStore } from '../state/db.js'
import { gitCommitPaths } from './git.js'
```

A fájl végére:

```ts

/**
 * A commitra váró jegyzeteket egyenként commitolja. A sor fájlja (ha
 * változott) az utolsó jegyzet commitjával megy, hogy ne szaporítsa a vault
 * történetét; saját commitot csak akkor kap, ha nincs jegyzet. Egy jegyzet
 * csak a saját commitja után kerül le a várólistáról: ha a sorozat
 * félbeszakad, a maradékot a következő futás pótolja. A commitok számát adja
 * vissza; push nincs benne.
 */
export async function commitPending(repo: string, store: StateStore, queuePath: string | null): Promise<number> {
  const notes = store.listPendingNotes()
  if (notes.length === 0) {
    if (queuePath === null) return 0
    return (await gitCommitPaths(repo, [queuePath], `docs(${COMMIT_SCOPE}): feldolgozási sor frissítése`)) ? 1 : 0
  }
  let commits = 0
  for (const [index, note] of notes.entries()) {
    const paths = queuePath !== null && index === notes.length - 1 ? [note.path, queuePath] : [note.path]
    if (await gitCommitPaths(repo, paths, noteCommitMessage(note.kind, note.title, note.id))) commits += 1
    store.clearPendingCommits([note.path])
  }
  return commits
}
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm vitest run src/vault/commit.test.ts`
Expected: PASS, 11 teszt.

- [ ] **Step 5: Típus és lint**

Run: `pnpm typecheck && pnpm lint`
Expected: hibátlan.

- [ ] **Step 6: Commit**

```bash
git add src/vault/commit.ts src/vault/commit.test.ts
git commit -m "feat(vault): Commit pending notes one by one"
```

---

### Task 4: A `run` jegyzetenként commitol

**Files:**
- Modify: `src/cli.ts` (import-blokk; a `runFinish` commit-blokkja, ma `src/cli.ts:608–619`)
- Test: `src/cli.test.ts` (`commandRun --queue`, `commandRun — fordítás`, `commandRun — a commit tartalma` blokk), `src/e2e.test.ts` (`végponttól végpontig — a feldolgozási sor valódi gittel`)

**Interfaces:**
- Consumes: `commitPending(repo: string, store: StateStore, queuePath: string | null): Promise<number>` (3. feladat); `StateStore.listPendingNotes()` (2. feladat, a tesztben).
- Produces: nincs új interfész.

Tudnivaló a `src/cli.test.ts`-hez: a fájl tetején a `gitCommitPaths` mockja alapból **hibát dob** (`szimulált git hiba a teszthez`). Egy teszt annyi `mockResolvedValueOnce(true)` értéket állítson be, ahány commitot vár: a fel nem használt egyszeri érték a következő tesztbe szivárog (a `beforeEach` csak `mockClear`-t hív).

- [ ] **Step 1: Írd át a `run --queue` tesztet**

A `commandRun --queue` blokkban cseréld a teszt nevét:

```ts
  it('a kipipált párokat dolgozza fel, csak azok sorait írja vissza, és jegyzetenként commitol', async () => {
```

Ugyanebben a tesztben a `const hivasok = { generate: 0 }` sor utáni `vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)` sort cseréld erre:

```ts
    for (let i = 0; i < 5; i += 1) vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)
```

A négy régi ellenőrző sort (`toHaveBeenCalledTimes(1)` … `5 jegyzet a feldolgozási sorból`) cseréld erre:

```ts
    // Jegyzetenként egy commit; a sor fájlja az utolsóval megy, nem sajátban.
    const hivasok2 = vi.mocked(gitCommitPaths).mock.calls.map(([, paths, uzenet]) => [paths[0], uzenet])
    expect(hivasok2).toHaveLength(5)
    expect(hivasok2).toEqual(
      expect.arrayContaining([
        [vart[0], 'docs(transcript-refinery): transcript | Első videó [a1]'],
        [vart[1], 'docs(transcript-refinery): summary | Első videó [a1]'],
        [vart[2], 'docs(transcript-refinery): qa | Első videó [a1]'],
        [vart[3], 'docs(transcript-refinery): transcript | Harmadik videó [b1]'],
        [vart[4], 'docs(transcript-refinery): summary | Harmadik videó [b1]'],
      ]),
    )
    const utak = vi.mocked(gitCommitPaths).mock.calls.map(([, paths]) => paths)
    expect(utak.slice(0, -1).every((paths) => paths.length === 1)).toBe(true)
    expect(utak.at(-1)).toEqual([expect.any(String), sor])
```

- [ ] **Step 2: Írd át a fordítás-tesztet**

A `commandRun — fordítás` blokk `egy indítás előbb a forrást, aztán a fordítást készíti el` tesztjében a `const hivasok = { generate: 0, translate: 0 }` sor utáni `mockResolvedValueOnce(true)` sort cseréld erre:

```ts
    // Három commit: átirat, tisztított leirat, fordítás. Több egyszeri érték a következő tesztbe szivárogna.
    for (let i = 0; i < 3; i += 1) vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)
```

A három régi ellenőrző sort (`toHaveBeenCalledTimes(1)`, a `const [, commitolt] = …` és az `arrayContaining([tiszta, magyar, sor])`) cseréld erre:

```ts
    const commitolt = vi.mocked(gitCommitPaths).mock.calls.map(([, paths]) => paths)
    expect(commitolt).toHaveLength(3)
    expect(commitolt.flat()).toEqual(expect.arrayContaining([tiszta, magyar]))
    expect(commitolt.at(-1)).toEqual([expect.any(String), sor])
```

- [ ] **Step 3: Írd át a commit-tartalom tesztet, és add hozzá a hibaágat**

A `commandRun — a commit tartalma` blokk egyetlen tesztjét cseréld erre a kettőre (a `beforeEach` marad):

```ts
  it('--recipe mellett az átirat és a recept jegyzete külön commit, a fajtával, a címmel és az azonosítóval', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true).mockResolvedValueOnce(true)

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: true },
      { createClient: () => hamisKliens({ generate: 0 }) },
    )

    expect(code).toBe(0)
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    expect(vi.mocked(gitCommitPaths).mock.calls).toEqual([
      [cfg.vaultPath, [noteFile(cfg.notesRoot, item!, '_transcript.md')], 'docs(transcript-refinery): transcript | Első videó [a1]'],
      [cfg.vaultPath, [noteFile(cfg.notesRoot, item!, '_summary.md')], 'docs(transcript-refinery): summary | Első videó [a1]'],
    ])
  })

  it('ha a második commit elhasal, az első jegyzet lekerül a várólistáról, a második rajta marad', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'b1', 'Második videó', 'Csatorna B')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    // Az első commit sikerül, a második a fájl tetején mockolt hibával elhasal.
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true)

    await expect(commandRun(cfg, raw, { dryRun: false, force: false, commit: true })).rejects.toThrow(
      'szimulált git hiba',
    )

    const store = openState(cfg.statePath)
    try {
      expect(store.listPendingNotes().map((note) => note.id)).toEqual(['b1'])
    } finally {
      store.close()
    }
  })
```

- [ ] **Step 4: Írd át az e2e tesztet**

A `src/e2e.test.ts` `scan --queue, pipálás, run --queue: pontosan a várt commitok, tiszta és pusholt munkafa` tesztjében az `expect(code).toBe(0)` utáni részt (a `const log = …` sortól az `expect(show.stdout…` kifejezés végéig) cseréld erre:

```ts
      const elso = (await discoverAll(cfg.sources, cfg.languages)).find((i) => i.baseName === 'Elso')!
      const log = await run('git', ['log', '--format=%s'], { cwd: repo })
      expect(log.stdout.trim().split('\n')).toEqual([
        `docs(transcript-refinery): summary | ${elso.title} [${elso.metadata.videoId ?? elso.itemId}]`,
        `docs(transcript-refinery): transcript | ${elso.title} [${elso.metadata.videoId ?? elso.itemId}]`,
        'docs(transcript-refinery): feldolgozási sor frissítése',
        'kezdet',
      ])

      // A sor fájlja az utolsó jegyzet commitjával megy.
      const show = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
      expect(show.stdout.trim().split('\n').sort()).toEqual(
        [relative(repo, noteFile(cfg.notesRoot, elso, '_summary.md')), relative(repo, sor)].sort(),
      )
```

A `feldolgozási sor frissítése` sor itt a teszt elején futó `scan --queue` commitja, nem a `run`-é.

- [ ] **Step 5: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/cli.test.ts src/e2e.test.ts`
Expected: FAIL az átírt teszteken (a régi kód egy commitot készít a régi üzenettel).

- [ ] **Step 6: Írd át a `run` commit-blokkját**

A `src/cli.ts` import-blokkjában a `./vault/git.js` sor elé:

```ts
import { commitPending } from './vault/commit.js'
```

A `runFinish`-ben ezt a blokkot:

```ts
        const notePaths = store.listPendingCommits()
        const paths = queueChanged ? [...notePaths, sorPath] : notePaths
        if (paths.length > 0) {
          const message = queueMode
            ? `docs(${COMMIT_SCOPE}): ${String(notePaths.length)} jegyzet a feldolgozási sorból`
            : `docs(${COMMIT_SCOPE}): átirat ${String(notePaths.length)} videóhoz`
          if (await gitCommitPaths(cfg.vaultPath, paths, message)) {
            const push = await gitPush(cfg.vaultPath)
            if (!push.pushed) console.log('A push nem sikerült, a commit lokálisan maradt.')
          }
          store.clearPendingCommits(notePaths)
        }
```

cseréld erre (a fölötte álló „MINDEN commitra váró jegyzetet felvesz…” megjegyzés marad):

```ts
        if ((await commitPending(cfg.vaultPath, store, queueChanged ? sorPath : null)) > 0) {
          const push = await gitPush(cfg.vaultPath)
          if (!push.pushed) console.log('A push nem sikerült, a commit lokálisan maradt.')
        }
```

A `COMMIT_SCOPE` és a `gitCommitPaths` importja marad: a `scan --queue` (`src/cli.ts:220`) továbbra is használja őket.

- [ ] **Step 7: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm vitest run src/cli.test.ts src/e2e.test.ts`
Expected: PASS.

- [ ] **Step 8: Típus és lint**

Run: `pnpm typecheck && pnpm lint`
Expected: hibátlan.

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts src/cli.test.ts src/e2e.test.ts
git commit -m "feat(run): Commit each note with its own subject"
```

---

### Task 5: A `watch` jegyzetenként commitol

**Files:**
- Modify: `src/watch/round.ts` (import-blokk; a commit-blokk, ma `src/watch/round.ts:89–109`)
- Test: `src/watch/round.test.ts` (`watchRound — commit` blokk)

**Interfaces:**
- Consumes: `commitPending(repo: string, store: StateStore, queuePath: string | null): Promise<number>` (3. feladat).
- Produces: nincs új interfész; a `RoundResult.commit` továbbra is az utolsó commit rövid hashe vagy `null`.

- [ ] **Step 1: Írd át a teszteket**

A `watchRound — commit` blokkban az első tesztet (`a jegyzeteket és a sort egy commitban viszi…`) cseréld erre:

```ts
  it('a jegyzetet és a sort egy commitban viszi, a hash-sel és a push eredményével', async () => {
    await felirat('Csatorna', 'Egy videó')
    const result = await round(null, true)

    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(lines.some((l) => l === `commit: ${result.commit!} (push ok)`)).toBe(true)
    const video = await git('git', ['-C', vault, 'show', '--name-only', '--format=%s', 'HEAD'])
    expect(video.stdout).toContain('_transcript.md')
    expect(video.stdout).toContain('_queue.md')
    expect(video.stdout.split('\n')[0]).toMatch(
      new RegExp(`^docs\\(${COMMIT_SCOPE}\\): transcript \\| Egy videó \\[.+\\]$`),
    )
  })

  it('két új videó két commit: a terminálsor az utolsó hashét és a darabszámot írja ki', async () => {
    await felirat('Csatorna', 'Egy videó')
    await felirat('Csatorna', 'Másik videó')
    const result = await round(null, true)

    expect(lines.some((l) => l === `commit: ${result.commit!} (2 commit, push ok)`)).toBe(true)
    const { stdout } = await git('git', ['-C', vault, 'log', '--format=%s', '-2'])
    expect(stdout.trim().split('\n')).toEqual([
      expect.stringMatching(/ transcript \| Másik videó \[.+\]$/),
      expect.stringMatching(/ transcript \| Egy videó \[.+\]$/),
    ])
  })
```

A következő teszt nevét és egy elvárását cseréld. A név:

```ts
  it('ha csak a sor változott, a sor saját commitot kap', async () => {
```

Az üzenet elvárása (`watch — ` nélkül):

```ts
    expect(stdout.split('\n')[0]).toBe(`docs(${COMMIT_SCOPE}): feldolgozási sor frissítése`)
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/watch/round.test.ts`
Expected: FAIL a három átírt, illetve új teszten.

- [ ] **Step 3: Írd át a `watch` commit-blokkját**

A `src/watch/round.ts` import-blokkjában a `../meta.js` sort cseréld erre:

```ts
import { VERSION } from '../meta.js'
```

a `../vault/git.js` sort pedig erre a kettőre:

```ts
import { commitPending } from '../vault/commit.js'
import { gitHeadShort, gitPullFfOnly, gitPush } from '../vault/git.js'
```

A commit-blokkot (a `let hash: string | null = null` sortól az `if (commit) { … }` záró kapcsáig) cseréld erre:

```ts
    let hash: string | null = null
    if (commit) {
      const commits = await commitPending(cfg.vaultPath, store, queueChanged ? queue.path : null)
      if (commits > 0) {
        hash = await gitHeadShort(cfg.vaultPath)
        // Jegyzetenként külön commit készül: a hash az utolsóé, a darabszám mellette áll.
        const count = commits > 1 ? `${String(commits)} commit, ` : ''
        const push = await gitPush(cfg.vaultPath)
        out(
          push.pushed
            ? `commit: ${hash} (${count}push ok)`
            : `commit: ${hash} (${count}push sikertelen: ${firstLine(push.reason ?? 'ismeretlen ok')})`,
        )
      }
    }
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm vitest run src/watch/round.test.ts`
Expected: PASS, 7 teszt.

- [ ] **Step 5: Típus és lint**

Run: `pnpm typecheck && pnpm lint`
Expected: hibátlan (a `COMMIT_SCOPE` és a `gitCommitPaths` importja a `round.ts`-ből kikerült, nem marad használatlan import).

- [ ] **Step 6: Commit**

```bash
git add src/watch/round.ts src/watch/round.test.ts
git commit -m "feat(watch): Commit each note with its own subject"
```

---

### Task 6: A Telegram-út jegyzetenként commitol

**Files:**
- Modify: `src/serve/summary.ts` (import-blokk; a commit-blokk, ma `src/serve/summary.ts:155–161`)
- Test: `src/serve/summary.test.ts`

**Interfaces:**
- Consumes: `noteCommitMessage(kind: string, title: string, id: string): string` (1. feladat); `discoverAll(sources, languages): Promise<SourceItem[]>` a `src/source/folder.ts`-ből (meglévő).
- Produces: nincs új interfész; a `runRecipes` visszatérési értékei nem változnak.

- [ ] **Step 1: Írd át a teszteket**

A `src/serve/summary.test.ts`-ben a fájllistát olvasó git-hívások eddig csak az utolsó commitot nézték; mostantól a teljes történetet olvassák. Az egész fájlban:

- minden `'show', '--name-only', '--pretty=format:', 'HEAD'` argumentumlistát cserélj erre: `'log', '--name-only', '--pretty=format:'` (négy hely);
- a `'log', '-1', '--name-only', '--pretty=format:'` argumentumlistát erre: `'log', '--name-only', '--pretty=format:'` (egy hely);
- minden `names.trim().split('\n').sort()` kifejezést erre: `names.split('\n').filter(Boolean).sort()` (négy hely; a commitok között üres sor áll).

Két teszt nevét cseréld:

```ts
  it('a jegyzet a vaultba kerül, a két fájl külön commitba megy, a link az átiratra mutat', async () => {
```

```ts
  it('két recept egy futásban: mindkét jegyzet és az átirat külön commitban', async () => {
```

Az első tesztben (`a jegyzet a vaultba kerül…`) a fájllista ellenőrzése után, a `const second = { generate: 0 }` sor elé:

```ts
    expect(execFileSync('git', ['log', '-2', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim().split('\n')).toEqual([
      'docs(transcript-refinery): summary | Beszéd [abcdefghijk]',
      'docs(transcript-refinery): transcript | Beszéd [abcdefghijk]',
    ])
```

A `két recept egy futásban…` teszt elé új teszt:

```ts
  it('második kérés ugyanarra a videóra más recepttel: csak az új jegyzet kap commitot', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const run = (recipes: string[]) =>
      runRecipes({ videoId: ID, outDir, recipes, createClient: () => client({ generate: 0 }), load, git: gitWith() })
    expect((await run(['summary'])).ok).toBe(true)
    expect((await run(['qa'])).ok).toBe(true)

    const log = execFileSync('git', ['log', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim().split('\n')
    expect(log).toEqual([
      'docs(transcript-refinery): qa | Beszéd [abcdefghijk]',
      'docs(transcript-refinery): summary | Beszéd [abcdefghijk]',
      'docs(transcript-refinery): transcript | Beszéd [abcdefghijk]',
      'init',
    ])
  })

```

A teszt jelenetében a fájl neve `Beszéd [abcdefghijk].hu.vtt`, az info.json címe `Beszéd`: az elvárt üzenetben ezért az azonosító egyszer szerepel.

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/serve/summary.test.ts`
Expected: FAIL a két üzenetet ellenőrző teszten (a régi kód egy commitot készít `átirat 1 videóhoz` üzenettel).

- [ ] **Step 3: Írd át a `serve` commit-blokkját**

A `src/serve/summary.ts` import-blokkjában a `../source/folder.js` sort cseréld erre:

```ts
import { discoverAll, splitSubtitleName } from '../source/folder.js'
```

és a `../vault/git.js` sor elé:

```ts
import { noteCommitMessage } from '../vault/commit.js'
```

Ezt a blokkot:

```ts
  const paths: string[] = []
  for (const path of transcriptPath === null ? [] : [transcriptPath, ...notePaths]) {
    if (await exists(path)) paths.push(path)
  }
  if (paths.length > 0) {
    await git.commit(cfg.vaultPath, paths, 'docs(transcript-refinery): átirat 1 videóhoz')
  }
```

cseréld erre:

```ts
  if (transcriptPath !== null && parsed !== null) {
    // A cím az info.json-ból jön, ha a letöltés írt ilyet; különben a fájl alapneve.
    const found = (await discoverAll(cfg.sources, cfg.languages)).find((item) => item.baseName === parsed.base)
    const title = found?.title ?? parsed.base
    // Jegyzetenként külön commit, az üzenetben a fajtával: az átirat elöl, utána a receptek.
    const kinds = ['transcript', ...ids]
    for (const [index, path] of [transcriptPath, ...notePaths].entries()) {
      if (await exists(path)) {
        await git.commit(cfg.vaultPath, [path], noteCommitMessage(kinds[index]!, title, input.videoId))
      }
    }
  }
```

A `notePaths` az `ids` sorrendjében épül (a fölötte álló `for (const id of ids) notePaths.push(…)` ciklusban), ezért a `kinds[index]` a megfelelő fájl fajtája. A `git.commit` (`gitCommitPaths`) `false`-t ad a nem változott fájlra, így a már bekerült átiratról nem készül új commit.

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `pnpm vitest run src/serve/summary.test.ts`
Expected: PASS, 13 teszt.

- [ ] **Step 5: Típus és lint**

Run: `pnpm typecheck && pnpm lint`
Expected: hibátlan.

- [ ] **Step 6: Commit**

```bash
git add src/serve/summary.ts src/serve/summary.test.ts
git commit -m "feat(serve): Commit each note with its own subject"
```

---

### Task 7: Záró ellenőrzés

- [ ] **Step 1: Teljes kör**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: minden zöld; a próbamegvalósításon 113 tesztfájl, 1367 teszt futott.

- [ ] **Step 2: A régi üzenetek eltűntek az éles kódból**

Run: `grep -rn "videóhoz\|jegyzet a feldolgozási sorból\|watch — " src --include="*.ts" | grep -v "\.test\.ts"`
Expected: pontosan négy találat, egyik sem commit-üzenet: `src/queue/parse.ts` és `src/queue/merge.ts` (két hely) megjegyzése és súgószövege, valamint a `src/serve/job.ts` `Nincs felirat a videóhoz` naplósora.

- [ ] **Step 3: Kézi próba éles vaulton (a felhasználó futtatja)**

Egy videó feldolgozása után a vaultban:

```bash
git -C <vault> log --oneline -5
```

Expected: jegyzetenként egy sor `docs(transcript-refinery): <fajta> | <cím> [<azonosító>]` alakban, legfeljebb 80 karakter hosszú első sorral; `run --queue` után az utolsó jegyzet commitja a `_queue.md`-t is tartalmazza (`git -C <vault> show --name-only HEAD`).

- [ ] **Step 4: Záró review és PR**

A teljes ágra szóló review Opuson fut. Utána PR a `main`-re `Closes #215` hivatkozással; a kiadás (v1.15.0, új Docker-kép) a merge után, a megszokott menettel.
