# Köteges feldolgozás és riport — implementációs terv

> **Ágens-végrehajtóknak:** KÖTELEZŐ AL-SKILL: használd a
> `superpowers:subagent-driven-development` (ajánlott) vagy a
> `superpowers:executing-plans` skillt a terv feladatonkénti végrehajtásához.
> A lépések checkbox (`- [ ]`) szintaxist használnak a követéshez.

**Cél:** A teljes korpusz felügyelet nélkül, egy éjszaka alatt menjen végig, és
reggelre álljon rendelkezésre egy riport arról, mennyi sikerült, mennyi nem,
miért, és hány elem készült automatikus, illetve kreátori feliratból.

**Architektúra:** A mag szerződése nem változik — a csővezeték továbbra sem ír
konzolra vagy fájlba, csak `RunEvent`-et küld a sinkbe. Ehhez a folyamhoz kap
két új fogyasztót (JSONL napló, Markdown riport), az állapottár pedig két új,
kizárólag **olvasó** lekérdezést a köteg-szintű állapothoz. A költségplafon a
tiltás helyett szeletel, a modellhívás pedig korlátos újrapróbálkozást kap egy
`ModelClient`-dekorátorban.

**Tech stack:** A meglévő stack változatlan (TypeScript 5.9, Node 26.2.0, pnpm
11.24.0, ESLint 10, `node:sqlite`, `zod@^4`, `vitest@^4`, `yaml`). **Új
futásidejű függőség nincs.**

**Spec:** [`2026-09-06-fazis-2-koteg-es-riport-spec.md`](<./2026-09-06-fazis-2-koteg-es-riport-spec.md>)

## Globális megkötések

Minden feladat követelményei implicit módon tartalmazzák ezt a szakaszt.

- **Node `26.2.0`, pnpm `11.24.0`** a `.mise.toml`-ból. Minden parancs
  `mise exec --` előtaggal fut, soha nem a shell PATH-ból.
- **A dokumentáció, a kódkommentek, a commit-üzenetek és a felhasználónak szóló
  kimenetek magyarul.** A kódazonosítók, típusnevek és a conventional commit
  előtagok (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) angolul.
- **TDD:** minden viselkedésváltozás előbb bukó tesztben jelenik meg. A meglévő
  tesztek átírandók, nem törlendők.
- **Az állapottár sémája nem változik** — a Fázis 2 csak olvas belőle. A
  `.state/refinery.db` továbbra is eldobható marad.
- **A `tsconfig.json` `strict` és `noUncheckedIndexedAccess`** — a tömbindexelés
  `T | undefined`-ot ad; a `!` a szándék kifejezése, engedélyezett.
- **A `docs/decisions/` és a `docs/plans/` korábbi állományait nem írjuk át** —
  történeti feljegyzések.
- A normalizálási, recept-, rubrika- és vault-réteg viselkedése **nem változik**.
- **Nincs párhuzamosság.** Szekvenciálisan a korpusz egy éjszakába belefér.
- **Commit:** az üzenetet **mindig a `commit-message` skill** készíti a staged
  változásokból — kézzel írt üzenet nincs. A tárgysor végén kötelezően
  `(Feladat N)` áll, a láblécben `Refs #12`. A feladatok `git commit` példái a
  tárgysor **tartalmát** mutatják, nem helyettesítik a skillt.
- **Minden feladat végén zöld:** `mise exec -- pnpm test`, `pnpm typecheck`,
  `pnpm lint`. Ez a terv nem hagy átmenetileg piros állapotot.

## Fájlszerkezet

| Fájl | Felelősség |
|---|---|
| `src/events.ts` | *bővítés* — elem-alapú összegzés felirat-forrás bontással, `item:retry` és `run:sliced` esemény |
| `src/run/id.ts` | **új** — fájlnév-biztos futásazonosító a futás kezdetéből |
| `src/run/log.ts` | **új** — JSONL eseménynapló, soronkénti azonnali kiírással |
| `src/run/report.ts` | **új** — Markdown riport renderelése; tiszta függvény, nulla I/O |
| `src/run/finish.ts` | **új** — a riport kiírása fájlba, és a SIGINT-kezelő beszerelése |
| `src/state/db.ts` | *bővítés* — `corpusStatus` és `listFailed`, kizárólag olvasó lekérdezések |
| `src/model/retry.ts` | **új** — `isTransient` és a `ModelClient` újrapróbálkozó dekorátora |
| `src/model/budget.ts` | *bővítés* — `sliceToBudget`: a köteg vágása a plafonig |
| `src/pipeline.ts` | *bővítés* — a receptfuttatás elemenként dekorált klienst használ |
| `src/config.ts` | *bővítés* — `logs.dir` kulcs, alapértelmezés `logs` |
| `src/cli.ts` | *bővítés* — napló, riport, SIGINT, szeletelés, `--retry-failed` |
| `refinery.config.example.yaml`, `.gitignore` | *bővítés* — `logs.dir` példa, `logs/` kizárása |
| `README.md`, `docs/roadmap.md`, `docs/architecture.md` | *bővítés* — a napló- és riportréteg dokumentálása |

## Egy ma is meglévő hiba, amit a Feladat 1 javít

A `summarize()` **eseményeket** számol, nem elemeket. Egy recepttel futtatott
elem két `item:published` eseményt küld (az átirat jegyzete és a recept
jegyzete, `src/pipeline.ts:96` és `:172`), tehát a mai „Kész: N sikeres" sor
recepttel futtatva **kétszer** számolja ugyanazt az elemet. A riport ezt nem
örökölheti meg: az összegzés elemazonosítóra dedupliká.

---

### Feladat 1: Elem-alapú összegzés felirat-forrás bontással

**Fájlok:**
- Módosítás: `src/events.ts:22` (`RunEvent` bővítése), `:56` (`RunSummary`), `:68` (`summarize`)
- Teszt: `src/events.test.ts`

**Interfészek:**
- Fogyaszt: a meglévő `RunEvent` unió.
- Termel: `RunSummary { succeeded, skipped, failed, byCaptionSource: Record<CaptionSource, number>, autoItems: string[], failures: RunFailure[] }`, valamint az `item:retry` és `run:sliced` eseménytípus. A Feladat 4 riportja és a Feladat 5 konzolkimenete ezekre épül.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/events.test.ts` — a meglévő `describe('summarize')` blokk **bővül** (a
meglévő eseteket ne töröld; a `toEqual` hívások a bővült alakhoz igazodnak):

```typescript
const EMPTY_SUMMARY = {
  succeeded: 0,
  skipped: 0,
  failed: 0,
  byCaptionSource: { creator: 0, auto: 0 },
  autoItems: [],
  failures: [],
}

describe('summarize — elemszintű összegzés', () => {
  it('egy elem két publikált jegyzete egyetlen sikernek számít', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:published', itemId: 'a', path: '/v/a_summary.md' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.byCaptionSource).toEqual({ creator: 1, auto: 0 })
  })

  it('felirat-forrás szerint bontja a sikeres elemeket, és felsorolja az automatikusakat', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a.md' },
      { type: 'item:normalized', itemId: 'b', wordsRaw: 200, wordsNormalized: 90, captionSource: 'auto' },
      { type: 'item:published', itemId: 'b', path: '/v/b.md' },
      { type: 'item:normalized', itemId: 'c', wordsRaw: 300, wordsNormalized: 120, captionSource: 'auto' },
      { type: 'item:published', itemId: 'c', path: '/v/c.md' },
    ])
    expect(summary.succeeded).toBe(3)
    expect(summary.byCaptionSource).toEqual({ creator: 1, auto: 2 })
    expect(summary.autoItems).toEqual(['b', 'c'])
  })

  it('a hiba erősebb a publikálásnál: a részben elkészült elem hibás', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'auto' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:failed', itemId: 'a', error: 'a bíró nem válaszolt' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      failed: 1,
      failures: [{ itemId: 'a', error: 'a bíró nem válaszolt' }],
    })
  })

  it('a publikálás elnyeli ugyanannak az elemnek a kihagyását', () => {
    const summary = summarize([
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a_transcript.md' },
      { type: 'item:skipped', itemId: 'a', reason: 'a fájl már létezik' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.skipped).toBe(0)
  })

  it('az újrapróbálkozás és a szeletelés nem torzítja az összegzést', () => {
    const summary = summarize([
      { type: 'run:sliced', planned: 2, deferred: 1, usd: 0.16, limitUsd: 5 },
      { type: 'item:retry', itemId: 'a', attempt: 1, delayMs: 1000, reason: '429' },
      { type: 'item:normalized', itemId: 'a', wordsRaw: 100, wordsNormalized: 40, captionSource: 'creator' },
      { type: 'item:published', itemId: 'a', path: '/v/a.md' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(0)
  })

  it('metaadat nélküli, normalizálás előtt elbukott elem nem kerül a bontásba', () => {
    const summary = summarize([
      { type: 'item:failed', itemId: 'x', error: 'olvashatatlan felirat' },
    ])
    expect(summary).toEqual({
      ...EMPTY_SUMMARY,
      failed: 1,
      failures: [{ itemId: 'x', error: 'olvashatatlan felirat' }],
    })
  })
})
```

A meglévő három teszt `toEqual`-jait igazítsd a bővült alakhoz, például:

```typescript
expect(summarize(events)).toEqual({
  ...EMPTY_SUMMARY,
  succeeded: 2,
  skipped: 1,
  failed: 1,
  byCaptionSource: { creator: 0, auto: 0 },
  failures: [{ itemId: 'c', error: 'nincs felirat' }],
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/events.test.ts`
Várható: FAIL — `byCaptionSource` nem létezik a visszatérési értéken, és a
`run:sliced` / `item:retry` típus nem eleme a `RunEvent` uniónak.

- [ ] **Step 3: Bővítsd az eseménytípust és az összegzést**

`src/events.ts` — az unióhoz add hozzá (a `run:aborted` sor után):

```typescript
  | {
      type: 'run:sliced'
      /** Ennyi elem indul ebben a futásban. */
      planned: number
      /** Ennyi maradt a következő futásra, mert nem fért a plafon alá. */
      deferred: number
      usd: number
      limitUsd: number
    }
  | {
      type: 'item:retry'
      itemId: string
      /** Hányadik kísérlet bukott el; egytől számozva. */
      attempt: number
      delayMs: number
      reason: string
    }
```

Az összegzés típusa és implementációja:

```typescript
export interface RunFailure {
  itemId: string
  error: string
}

export interface RunSummary {
  succeeded: number
  skipped: number
  failed: number
  /** A sikeres elemek felirat-forrás szerinti bontása. */
  byCaptionSource: Record<CaptionSource, number>
  /** Az automatikus feliratból készült sikeres elemek azonosítói, rendezve. */
  autoItems: string[]
  failures: RunFailure[]
}

/**
 * Az összegzés **elemet** számol, nem eseményt: egy elem két jegyzetet is
 * publikálhat (átirat és recept), és az ugyanaz az egy siker. A hiba erősebb
 * a publikálásnál — ha a recept elbukott, az elem hibás, akkor is, ha az
 * átirata már kiment.
 */
export function summarize(events: readonly RunEvent[]): RunSummary {
  const captionOf = new Map<string, CaptionSource>()
  const published = new Set<string>()
  const skipped = new Set<string>()
  const failed = new Map<string, string>()

  for (const e of events) {
    switch (e.type) {
      case 'item:normalized':
        captionOf.set(e.itemId, e.captionSource)
        break
      case 'item:published':
        published.add(e.itemId)
        break
      case 'item:skipped':
        skipped.add(e.itemId)
        break
      case 'item:failed':
        failed.set(e.itemId, e.error)
        break
      default:
        break
    }
  }

  for (const itemId of failed.keys()) {
    published.delete(itemId)
    skipped.delete(itemId)
  }
  for (const itemId of published) skipped.delete(itemId)

  const byCaptionSource: Record<CaptionSource, number> = { creator: 0, auto: 0 }
  const autoItems: string[] = []
  for (const itemId of published) {
    const caption = captionOf.get(itemId)
    if (caption === undefined) continue
    byCaptionSource[caption]++
    if (caption === 'auto') autoItems.push(itemId)
  }
  autoItems.sort()

  return {
    succeeded: published.size,
    skipped: skipped.size,
    failed: failed.size,
    byCaptionSource,
    autoItems,
    failures: [...failed].map(([itemId, error]) => ({ itemId, error })),
  }
}
```

A `run:done` esemény mezői ne változzanak (a `cli.ts` szórással tölti); a
`summarize` bővebb objektumot ad, amiből a `run:done` a három számot használja.
A `cli.ts:210` `printing({ type: 'run:done', ...summary })` hívása így
típushibát adna a felesleges mezőkre — írd át explicitre:

```typescript
    printing({
      type: 'run:done',
      succeeded: summary.succeeded,
      skipped: summary.skipped,
      failed: summary.failed,
    })
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm vitest run src/events.test.ts && mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/events.ts src/events.test.ts src/cli.ts
# commit-message skill; tárgysor tartalma:
# fix(events): az összegzés elemet számol, nem eseményt (Feladat 1)
```

---

### Feladat 2: Futásazonosító, `logs.dir` konfiguráció és JSONL napló

**Fájlok:**
- Létrehozás: `src/run/id.ts`, `src/run/log.ts`
- Teszt: `src/run/id.test.ts`, `src/run/log.test.ts`
- Módosítás: `src/config.ts:44` (séma), `:60` (`Config`), `:110` (`loadConfig`), `refinery.config.example.yaml`, `.gitignore`
- Teszt: `src/config.test.ts`

**Interfészek:**
- Fogyaszt: `RunEvent`, `EventSink` (`src/events.ts`).
- Termel: `runId(now: Date): string`; `openRunLog(path: string): RunLog` ahol
  `RunLog { readonly path: string; sink: EventSink; close(): void }`;
  `Config.logsDir: string` (abszolút útvonal). A Feladat 5 CLI-je ezeket használja.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/run/id.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { runId } from './id.js'

describe('runId', () => {
  it('fájlnév-biztos azonosítót ad a futás kezdetéből', () => {
    expect(runId(new Date('2026-09-07T02:14:03.512Z'))).toBe('2026-09-07T02-14-03')
  })

  it('két különböző másodperc két különböző azonosítót ad', () => {
    const a = runId(new Date('2026-09-07T02:14:03Z'))
    const b = runId(new Date('2026-09-07T02:14:04Z'))
    expect(a).not.toBe(b)
  })

  it('nem tartalmaz olyan karaktert, ami fájlnévben gondot okoz', () => {
    expect(runId(new Date('2026-01-02T03:04:05Z'))).not.toMatch(/[:/\\]/)
  })
})
```

`src/run/log.test.ts`:

```typescript
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRunLog } from './log.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-log-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('openRunLog', () => {
  it('eseményenként egy önállóan értelmezhető JSON sort ír', async () => {
    const log = openRunLog(join(work, 'naplo', '2026-09-07T02-14-03.jsonl'))
    log.sink({ type: 'scan:found', count: 2 })
    log.sink({ type: 'item:failed', itemId: 'a', error: 'olvashatatlan felirat' })
    log.close()

    const lines = (await readFile(log.path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: 'scan:found', count: 2 },
      { type: 'item:failed', itemId: 'a', error: 'olvashatatlan felirat' },
    ])
  })

  it('a sorok lezárás előtt is a lemezen vannak', async () => {
    const log = openRunLog(join(work, 'run.jsonl'))
    log.sink({ type: 'item:published', itemId: 'a', path: '/v/a.md' })

    const content = await readFile(log.path, 'utf8')
    expect(content).toContain('item:published')
    log.close()
  })

  it('létrehozza a hiányzó naplómappát', () => {
    const log = openRunLog(join(work, 'melyen', 'lent', 'run.jsonl'))
    log.close()
    expect(existsSync(log.path)).toBe(true)
  })

  it('a kétszeri lezárás nem dob', () => {
    const log = openRunLog(join(work, 'run.jsonl'))
    log.close()
    expect(() => log.close()).not.toThrow()
  })
})
```

`src/config.test.ts` — új eset a meglévő `loadConfig` blokkba:

```typescript
  it('a logs.dir alapértelmezése a logs mappa, és a projekt gyökeréhez képest oldódik fel', () => {
    const cfg = loadConfig(
      { vault: { path: '/v' }, sources: ['/s'] },
      '/p/refinery.config.yaml',
    )
    expect(cfg.logsDir).toBe(resolve(process.cwd(), 'logs'))
  })

  it('a logs.dir megadható a YAML-ban', () => {
    const cfg = loadConfig(
      { vault: { path: '/v' }, sources: ['/s'], logs: { dir: 'naplok' } },
      '/p/refinery.config.yaml',
    )
    expect(cfg.logsDir).toBe(resolve(process.cwd(), 'naplok'))
  })
```

(A fájl tetején a `resolve` importja a `node:path`-ból kell hozzá.)

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/run src/config.test.ts`
Várható: FAIL — `Cannot find module './id.js'`, illetve `cfg.logsDir` `undefined`.

- [ ] **Step 3: Írd meg a modulokat**

`src/run/id.ts`:

```typescript
/**
 * Fájlnév-biztos futásazonosító a futás kezdetéből: `2026-09-07T02-14-03`.
 *
 * A napló és a riport is ezt a nevet kapja, tehát a kettő párban marad, és
 * a mappa listázása időrendbe rendezi őket.
 */
export function runId(now: Date): string {
  return now.toISOString().slice(0, 19).replaceAll(':', '-')
}
```

`src/run/log.ts`:

```typescript
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EventSink } from '../events.js'

export interface RunLog {
  /** A napló útvonala; a riport és a konzol ezt nevezi meg. */
  readonly path: string
  sink: EventSink
  close(): void
}

/**
 * JSONL eseménynapló: eseményenként egy sor, azonnali kiírással.
 *
 * A szinkron `writeSync` szándékos. Ennek a naplónak az egyetlen
 * létjogosultsága, hogy egy éjszaka közepén megszakadt futás után is legyen
 * nyom — egy pufferelt stream pont abban a pillanatban veszítené el az utolsó
 * sorokat, amiért a napló egyáltalán készül.
 */
export function openRunLog(path: string): RunLog {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'a')
  let closed = false

  return {
    path,

    sink(event) {
      if (closed) return
      writeSync(fd, `${JSON.stringify(event)}\n`)
    },

    // Idempotens, mint az állapottár `close()`-a: a hívónak nem feladata
    // számon tartani, hogy a napló már zárva van-e.
    close() {
      if (closed) return
      closed = true
      closeSync(fd)
    },
  }
}
```

`src/config.ts` — a `CoreSchema`-ba, a `state` mögé:

```typescript
  logs: z.object({ dir: z.string().min(1) }).default({ dir: 'logs' }),
```

a `Config` interfészbe:

```typescript
  /** A futásnaplók és riportok mappája, abszolút útvonalként. */
  logsDir: string
```

és a `loadConfig` visszatérési objektumába:

```typescript
    logsDir: resolve(process.cwd(), c.logs.dir),
```

`refinery.config.example.yaml` — a `state` blokk után:

```yaml
logs:
  # A futásnaplók és riportok mappája. Relatív útvonal a projekt gyökeréhez
  # képest. Futásonként két fájl keletkezik: egy JSONL eseménynapló és egy
  # Markdown riport. Rotáció nincs — a régiek törlése a te dolgod.
  dir: logs
```

`.gitignore` — a `.state/` melletti szakaszba:

```
logs/
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/run src/config.ts src/config.test.ts refinery.config.example.yaml .gitignore
# commit-message skill; tárgysor tartalma:
# feat(run): JSONL futásnapló és logs.dir konfiguráció (Feladat 2)
```

---

### Feladat 3: Köteg-szintű állapot az állapottárból

**Fájlok:**
- Módosítás: `src/state/db.ts:71` (`StateStore` interfész), `:265` (a visszaadott objektum)
- Teszt: `src/state/db.test.ts`

**Interfészek:**
- Fogyaszt: `SourceItem` (`src/types.ts`), a meglévő `items`, `transcripts`, `artifacts` táblák. **A séma nem változik.**
- Termel:
  - `corpusStatus(items: SourceItem[], kind: string): CorpusStatus`
  - `listFailed(items: SourceItem[], kind: string): SourceItem[]`
  - `CorpusStatus { bySource: SourceStatus[]; byCaptionSource: Record<CaptionSource, number>; done: number; failed: number; pending: number; totalCostUsd: number }`
  - `SourceStatus { source: string; total: number; done: number; failed: number; pending: number }`

  A Feladat 4 riportja a `CorpusStatus`-ra épül, a Feladat 8 a `listFailed`-re.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/state/db.test.ts` — új blokkok. **A fájl meglévő segédeit használd:** a
`store` a `beforeEach`-ben nyílik és az `afterEach`-ben zárul (tesztben ne zárd),
az elemeket pedig az `item(overrides)` gyártja:

```typescript
describe('corpusStatus', () => {
  it('forrásonként bontja a készet, a hibásat és a hátralévőt', () => {
    const a = item({ itemId: 'a', source: 'youtube' })
    const b = item({ itemId: 'b', source: 'youtube' })
    const c = item({ itemId: 'c', source: 'meetings' })
    for (const i of [a, b, c]) store.recordItem(i)

    store.recordArtifact('a', 'summary', 'done', '/v/a.md', null, {
      iterations: 1,
      score: 0.9,
      costUsd: 0.08,
      model: 'draft-modell',
    })
    store.recordArtifact('b', 'summary', 'failed', null, 'a bíró nem válaszolt')

    const status = store.corpusStatus([a, b, c], 'summary')
    expect(status.bySource).toEqual([
      { source: 'meetings', total: 1, done: 0, failed: 0, pending: 1 },
      { source: 'youtube', total: 2, done: 1, failed: 1, pending: 0 },
    ])
    expect(status.done).toBe(1)
    expect(status.failed).toBe(1)
    expect(status.pending).toBe(1)
  })

  it('a felirat-forrás bontása az átiratokból jön, és csak a megadott elemeket számolja', () => {
    const a = item({ itemId: 'a' })
    const b = item({ itemId: 'b' })
    for (const i of [a, b]) store.recordItem(i)
    store.recordTranscript('a', 'creator', 100, 40)
    store.recordTranscript('b', 'auto', 200, 90)

    expect(store.corpusStatus([a], 'summary').byCaptionSource).toEqual({
      creator: 1,
      auto: 0,
    })
  })

  it('összegzi az eddig elköltött dollárt', () => {
    const a = item({ itemId: 'a' })
    const b = item({ itemId: 'b' })
    for (const i of [a, b]) store.recordItem(i)
    store.recordArtifact('a', 'summary', 'done', '/v/a.md', null, {
      iterations: 1,
      score: 0.9,
      costUsd: 0.08,
      model: 'm',
    })
    store.recordArtifact('b', 'summary', 'done', '/v/b.md', null, {
      iterations: 2,
      score: 0.8,
      costUsd: 0.12,
      model: 'm',
    })

    expect(store.corpusStatus([a, b], 'summary').totalCostUsd).toBeCloseTo(0.2, 6)
  })

  it('üres állapottáron minden elem hátralévő', () => {
    expect(store.corpusStatus([item({ itemId: 'a' })], 'summary')).toEqual({
      bySource: [{ source: 'youtube', total: 1, done: 0, failed: 0, pending: 1 }],
      byCaptionSource: { creator: 0, auto: 0 },
      done: 0,
      failed: 0,
      pending: 1,
      totalCostUsd: 0,
    })
  })
})

describe('listFailed', () => {
  it('csak a hibás státuszú elemeket adja vissza', () => {
    const a = item({ itemId: 'a' })
    const b = item({ itemId: 'b' })
    const c = item({ itemId: 'c' })
    for (const i of [a, b, c]) store.recordItem(i)
    store.recordArtifact('a', 'summary', 'done', '/v/a.md', null)
    store.recordArtifact('b', 'summary', 'failed', null, 'időtúllépés')

    expect(store.listFailed([a, b, c], 'summary').map((i) => i.itemId)).toEqual(['b'])
  })

  it('a hibás státusz típusonként külön él', () => {
    const a = item({ itemId: 'a' })
    store.recordItem(a)
    store.recordArtifact('a', 'transcript', 'failed', null, 'olvashatatlan felirat')

    expect(store.listFailed([a], 'summary')).toEqual([])
    expect(store.listFailed([a], 'transcript').map((i) => i.itemId)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/state/db.test.ts`
Várható: FAIL — `store.corpusStatus is not a function`.

- [ ] **Step 3: Írd meg a lekérdezéseket**

`src/state/db.ts` — új típusok az `ArtifactRecord` mögé:

```typescript
/** Egy forrásmappa állapota a köteg szempontjából. */
export interface SourceStatus {
  source: string
  total: number
  done: number
  failed: number
  pending: number
}

/**
 * A teljes korpusz állapota egy adott műtermék-típusra. Kizárólag olvasó
 * összegzés: ez teszi a riportot újraindítás után is teljessé.
 */
export interface CorpusStatus {
  bySource: SourceStatus[]
  byCaptionSource: Record<CaptionSource, number>
  done: number
  failed: number
  pending: number
  totalCostUsd: number
}
```

a `StateStore` interfészbe:

```typescript
  corpusStatus(items: readonly SourceItem[], kind: string): CorpusStatus
  listFailed(items: readonly SourceItem[], kind: string): SourceItem[]
```

és az implementáció (a `listPending` mellé):

```typescript
    corpusStatus(items, kind) {
      const rows = db
        .prepare('SELECT item_id, status FROM artifacts WHERE kind = ?')
        .all(kind) as { item_id: string; status: string }[]
      const statusOf = new Map(rows.map((r) => [r.item_id, r.status]))

      const captions = db
        .prepare('SELECT item_id, source FROM transcripts')
        .all() as { item_id: string; source: string }[]
      const captionOf = new Map(captions.map((r) => [r.item_id, r.source as CaptionSource]))

      const bySourceName = new Map<string, SourceStatus>()
      const byCaptionSource: Record<CaptionSource, number> = { creator: 0, auto: 0 }
      let done = 0
      let failed = 0

      for (const item of items) {
        const entry = bySourceName.get(item.source) ?? {
          source: item.source,
          total: 0,
          done: 0,
          failed: 0,
          pending: 0,
        }
        entry.total++

        const status = statusOf.get(item.itemId)
        if (status === 'done') {
          entry.done++
          done++
        } else if (status === 'failed') {
          entry.failed++
          failed++
        } else {
          entry.pending++
        }
        bySourceName.set(item.source, entry)

        const caption = captionOf.get(item.itemId)
        if (caption !== undefined) byCaptionSource[caption]++
      }

      // A költés minden műtermék-típusra összegződik: a kérdés az, hogy erre
      // a korpuszra eddig mennyit költöttünk, nem az, hogy melyik recept vitte.
      const cost = db
        .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM artifacts')
        .get() as { total: number }

      return {
        bySource: [...bySourceName.values()].sort((a, b) => a.source.localeCompare(b.source)),
        byCaptionSource,
        done,
        failed,
        pending: items.length - done - failed,
        totalCostUsd: cost.total,
      }
    },

    listFailed(items, kind) {
      const failed = new Set(
        (
          db
            .prepare("SELECT item_id FROM artifacts WHERE kind = ? AND status = 'failed'")
            .all(kind) as { item_id: string }[]
        ).map((r) => r.item_id),
      )
      return items.filter((item) => failed.has(item.itemId))
    },
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/state/db.ts src/state/db.test.ts
# commit-message skill; tárgysor tartalma:
# feat(state): köteg-szintű állapot és a hibás elemek listája (Feladat 3)
```

---

### Feladat 4: A Markdown riport renderelése

**Fájlok:**
- Létrehozás: `src/run/report.ts`
- Teszt: `src/run/report.test.ts`

**Interfészek:**
- Fogyaszt: `RunSummary` (Feladat 1), `CorpusStatus` (Feladat 3).
- Termel: `renderReport(input: ReportInput): string`, ahol
  `ReportInput { runId, startedAt: Date, finishedAt: Date, command: string, summary: RunSummary, corpus: CorpusStatus, runs: number, logPath: string, cost?: { spentUsd: number; limitUsd: number; capped: boolean }, nextCommand?: string }`.
  A Feladat 5 `finishRun`-ja ezt hívja.

**Megjegyzés a spec „eddigi futások száma" mezőjéhez:** az állapottár sémája
nem változhat, futás-táblát tehát nem vezetünk be. A szám a naplómappában lévő
`.jsonl` fájlok darabszáma — a riport ezt így is nevezi meg („futás naplója"),
hogy ne állítson többet, mint amit tud.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/run/report.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { renderReport, type ReportInput } from './report.js'

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    runId: '2026-09-07T02-14-03',
    startedAt: new Date('2026-09-07T02:14:03Z'),
    finishedAt: new Date('2026-09-07T06:41:00Z'),
    command: 'run --recipe summary',
    summary: {
      succeeded: 2,
      skipped: 1,
      failed: 1,
      byCaptionSource: { creator: 1, auto: 1 },
      autoItems: ['eloadas-02'],
      failures: [{ itemId: 'mit-6-042-l14', error: 'olvashatatlan felirat' }],
    },
    corpus: {
      bySource: [
        { source: 'meetings', total: 1, done: 1, failed: 0, pending: 0 },
        { source: 'youtube', total: 4, done: 2, failed: 1, pending: 1 },
      ],
      byCaptionSource: { creator: 3, auto: 2 },
      done: 3,
      failed: 1,
      pending: 1,
      totalCostUsd: 11.9,
    },
    runs: 3,
    logPath: '/p/logs/2026-09-07T02-14-03.jsonl',
    ...overrides,
  }
}

describe('renderReport', () => {
  it('a futás bontását a felirat-forrás szerint írja ki', () => {
    const md = renderReport(input())
    expect(md).toContain('kreátori 1 / automatikus 1')
    expect(md).toContain('| sikeres | 2 |')
  })

  it('felsorolja az automatikus feliratból készült elemeket', () => {
    const md = renderReport(input())
    expect(md).toContain('eloadas-02')
  })

  it('a hibát az elemmel és az okkal együtt nevezi meg', () => {
    const md = renderReport(input())
    expect(md).toContain('mit-6-042-l14')
    expect(md).toContain('olvashatatlan felirat')
  })

  it('forrásonként kiírja a korpusz állapotát', () => {
    const md = renderReport(input())
    expect(md).toContain('| youtube | 4 | 2 | 1 | 1 |')
    expect(md).toContain('| meetings | 1 | 1 | 0 | 0 |')
  })

  it('a hátralévő elemekhez folytató parancsot ajánl', () => {
    const md = renderReport(input({ nextCommand: 'refinery run --recipe summary' }))
    expect(md).toContain('1 elem hátravan')
    expect(md).toContain('refinery run --recipe summary')
  })

  it('hátralévő elem nélkül nem ajánl folytatást', () => {
    const md = renderReport(
      input({
        corpus: { ...input().corpus, pending: 0, done: 4 },
        nextCommand: undefined,
      }),
    )
    expect(md).toContain('A korpusz feldolgozva')
    expect(md).not.toContain('Folytatás:')
  })

  it('a plafon elérését kiírja a fejlécben', () => {
    const md = renderReport(input({ cost: { spentUsd: 4.87, limitUsd: 5, capped: true } }))
    expect(md).toContain('4.87 $ / 5.00 $')
    expect(md).toContain('plafon elérve')
  })

  it('modell nélküli futásból kimarad a költségsor', () => {
    const md = renderReport(input({ cost: undefined }))
    expect(md).not.toContain('Költés')
  })

  it('hiba nélküli futásból kimarad a hibaszakasz', () => {
    const md = renderReport(
      input({ summary: { ...input().summary, failed: 0, failures: [] } }),
    )
    expect(md).not.toContain('## Hibák')
  })

  it('automatikus feliratú elem nélkül nem ír üres felsorolást', () => {
    const md = renderReport(
      input({
        summary: { ...input().summary, autoItems: [], byCaptionSource: { creator: 2, auto: 0 } },
      }),
    )
    expect(md).not.toContain('Automatikus feliratból készült')
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/run/report.test.ts`
Várható: FAIL — `Cannot find module './report.js'`.

- [ ] **Step 3: Írd meg a renderelőt**

`src/run/report.ts`:

```typescript
import type { RunSummary } from '../events.js'
import type { CorpusStatus } from '../state/db.js'

export interface ReportCost {
  spentUsd: number
  limitUsd: number
  /** A futás azért állt meg, mert elérte a plafont. */
  capped: boolean
}

export interface ReportInput {
  runId: string
  startedAt: Date
  finishedAt: Date
  /** A futást indító parancs, kapcsolókkal — a riport reprodukálhatósága. */
  command: string
  summary: RunSummary
  corpus: CorpusStatus
  /** Ennyi futás naplója van a naplómappában, ezt is beleértve. */
  runs: number
  logPath: string
  cost?: ReportCost
  /** A folytatáshoz javasolt parancs; hátralévő elem nélkül hiányzik. */
  nextCommand?: string
}

/** `2026-09-07 02:14` — a riport fejlécének olvasható időpontja. */
function stamp(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * A futás riportja Markdownban. Tiszta függvény: nem ír fájlt és nem olvas
 * órát — így a tesztje a szövegről szól, nem a környezetről.
 */
export function renderReport(input: ReportInput): string {
  const { summary, corpus } = input
  const lines: string[] = []

  lines.push(`# Futás — ${stamp(input.startedAt)} → ${stamp(input.finishedAt)}`)
  lines.push('')
  lines.push(`Parancs: \`${input.command}\``)
  if (input.cost) {
    const { spentUsd, limitUsd, capped } = input.cost
    const suffix = capped ? ' — plafon elérve' : ''
    lines.push(`Költés: ${spentUsd.toFixed(2)} $ / ${limitUsd.toFixed(2)} $${suffix}`)
  }
  lines.push(`Napló: \`${input.logPath}\``)
  lines.push('')

  lines.push('## Ez a futás')
  lines.push('')
  lines.push('| | |')
  lines.push('|---|---|')
  lines.push(
    `| sikeres | ${String(summary.succeeded)} ` +
      `(kreátori ${String(summary.byCaptionSource.creator)} / ` +
      `automatikus ${String(summary.byCaptionSource.auto)}) |`,
  )
  lines.push(`| kihagyva | ${String(summary.skipped)} |`)
  lines.push(`| hibás | ${String(summary.failed)} |`)
  lines.push('')

  if (summary.autoItems.length > 0) {
    lines.push(
      `Automatikus feliratból készült (${String(summary.autoItems.length)}): ` +
        summary.autoItems.map((id) => `\`${id}\``).join(', '),
    )
    lines.push('')
  }

  if (summary.failures.length > 0) {
    lines.push('## Hibák')
    lines.push('')
    lines.push('| elem | ok |')
    lines.push('|---|---|')
    for (const failure of summary.failures) {
      lines.push(`| \`${failure.itemId}\` | ${failure.error} |`)
    }
    lines.push('')
  }

  lines.push('## A korpusz állapota')
  lines.push('')
  lines.push('| forrás | összes | kész | hibás | hátra |')
  lines.push('|---|---|---|---|---|')
  for (const s of corpus.bySource) {
    lines.push(
      `| ${s.source} | ${String(s.total)} | ${String(s.done)} | ` +
        `${String(s.failed)} | ${String(s.pending)} |`,
    )
  }
  lines.push('')
  lines.push(
    `Kreátori ${String(corpus.byCaptionSource.creator)} / ` +
      `automatikus ${String(corpus.byCaptionSource.auto)} · ` +
      `${String(input.runs)} futás naplója · ` +
      `összköltés: ${corpus.totalCostUsd.toFixed(2)} $`,
  )
  lines.push('')

  lines.push('## Következő lépés')
  lines.push('')
  if (corpus.pending > 0) {
    lines.push(`${String(corpus.pending)} elem hátravan.`)
    if (input.nextCommand) lines.push(`Folytatás: \`${input.nextCommand}\``)
  } else if (corpus.failed > 0) {
    lines.push('A korpusz feldolgozva, de maradtak hibás elemek.')
    if (input.nextCommand) lines.push(`Újrapróbálás: \`${input.nextCommand}\``)
  } else {
    lines.push('A korpusz feldolgozva.')
  }
  lines.push('')

  return lines.join('\n')
}
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/run/report.ts src/run/report.test.ts
# commit-message skill; tárgysor tartalma:
# feat(run): Markdown riport a futásról és a korpuszról (Feladat 4)
```

---

### Feladat 5: A riport kiírása, SIGINT-kezelő és a CLI bekötése

**Fájlok:**
- Létrehozás: `src/run/finish.ts`
- Teszt: `src/run/finish.test.ts`
- Módosítás: `src/cli.ts:29` (USAGE), `:113` (`commandRun` törzse), `:209` (záró összegzés)
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `openRunLog`, `runId` (Feladat 2), `renderReport` (Feladat 4), `StateStore.corpusStatus` (Feladat 3), `summarize` (Feladat 1).
- Termel:
  - `writeReport(path: string, markdown: string): Promise<void>`
  - `countRunLogs(dir: string): number`
  - `installSigint(handler: () => void, target?: { on(event: string, listener: () => void): unknown }): void`

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/run/finish.test.ts`:

```typescript
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countRunLogs, installSigint, writeReport } from './finish.js'

let work: string

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-finish-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('writeReport', () => {
  it('létrehozza a mappát és kiírja a riportot', async () => {
    const path = join(work, 'naplok', 'run.md')
    await writeReport(path, '# Futás\n')
    expect(await readFile(path, 'utf8')).toBe('# Futás\n')
  })
})

describe('countRunLogs', () => {
  it('a naplófájlokat számolja, mást nem', async () => {
    await writeFile(join(work, 'a.jsonl'), '')
    await writeFile(join(work, 'b.jsonl'), '')
    await writeFile(join(work, 'b.md'), '')
    expect(countRunLogs(work)).toBe(2)
  })

  it('nem létező mappára nullát ad', () => {
    expect(countRunLogs(join(work, 'nincs'))).toBe(0)
  })
})

describe('installSigint', () => {
  it('a SIGINT-re egyszer futtatja a kezelőt', () => {
    const target = new EventEmitter()
    let calls = 0
    installSigint(() => void calls++, target)

    target.emit('SIGINT')
    target.emit('SIGINT')
    expect(calls).toBe(1)
  })
})
```

`src/cli.test.ts` — **előbb két meglévő segédet kell igazítani.** A `rawConfig`
ma a projekt gyökerébe mutató naplómappát és nem létező vaultot ad; a riport
így a repó `logs/` mappájába írna, a publikálás pedig elhasalna:

```typescript
// A `rawConfig`-ba, a `state` mellé — a teszt SOHA nem írhat a projekt
// `logs/` mappájába:
  logs: { dir: join(work, 'logs') },

/** Konfiguráció valódi, ideiglenes vaulttal: a publikálás így tényleg lefut. */
const rawWithVault = (costLimitUsd: number) => ({
  ...rawConfig(costLimitUsd),
  vault: { path: vault },
})
```

a `beforeEach`-be pedig `vault = join(work, 'vault')` és
`await mkdir(vault, { recursive: true })` (a `vault` új modulszintű `let`).

Az új esetek:

```typescript
describe('commandRun — napló és riport', () => {
  it('a futás után napló és riport is van a naplómappában', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    expect(code).toBe(0)
    const files = await readdir(cfg.logsDir)
    expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(1)
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(1)
  })

  it('a napló minden sora önállóan értelmezhető JSON', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const lines = (await readFile(join(cfg.logsDir, jsonl), 'utf8')).trim().split('\n')

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
  })

  it('a riport megnevezi a felirat-forrás szerinti bontást', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    await commandRun(cfg, raw, { dryRun: false, force: false, commit: false })

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')

    expect(report).toMatch(/kreátori \d+ \/ automatikus \d+/)
    expect(report).toContain('## A korpusz állapota')
  })

  it('a megszakítás riportot hagy maga után, és 130-cal lép ki', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    let exitCode: number | undefined
    let megszakadt: () => void
    const kilepett = new Promise<void>((resolve) => (megszakadt = resolve))

    await commandRun(
      cfg,
      raw,
      { dryRun: false, force: false, commit: false },
      {
        // A megszakítás közvetlenül a kezelő beszerelése után érkezik.
        signals: {
          on(_event: string, listener: () => void) {
            setTimeout(listener, 0)
            return this
          },
        },
        exit: (code: number) => {
          exitCode = code
          megszakadt()
        },
      },
    )
    await kilepett

    expect(exitCode).toBe(130)
    expect((await readdir(cfg.logsDir)).some((f) => f.endsWith('.md'))).toBe(true)
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/run/finish.test.ts src/cli.test.ts`
Várható: FAIL — `Cannot find module './finish.js'`, illetve a naplómappa üres.

- [ ] **Step 3: Írd meg a `finish.ts`-t és kösd be a CLI-be**

`src/run/finish.ts`:

```typescript
import { readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Kiírja a riportot, a hiányzó mappát létrehozva. */
export async function writeReport(path: string, markdown: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, markdown, 'utf8')
}

/**
 * Hány futás naplója van a mappában. Az állapottár sémája nem tud a
 * futásokról, és nem is fog: ez a szám a naplófájlokból jön, és a riport is
 * így nevezi meg.
 */
export function countRunLogs(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}

/**
 * A Ctrl+C is riportot hagy maga után. Egyszeri lefutás: a második SIGINT ne
 * írjon félbehagyott riportot az elsőre.
 */
export function installSigint(
  handler: () => void,
  target: { on(event: string, listener: () => void): unknown } = process,
): void {
  let fired = false
  target.on('SIGINT', () => {
    if (fired) return
    fired = true
    handler()
  })
}
```

`src/cli.ts` — a `commandRun` új, **opcionális negyedik paramétert** kap. Ez a
seam teszi megfigyelhetővé a megszakítást és — a Feladat 6-tól — a
receptfuttatást is, valódi hálózat nélkül:

```typescript
export interface RunRuntime {
  /** A SIGINT forrása. A tesztek saját kibocsátót adnak. */
  signals?: { on(event: string, listener: () => void): unknown }
  /** Kilépés megszakításkor. */
  exit?: (code: number) => void
  /** A modellkliens gyártása; alapértelmezésben a valódi LiteLLM-kliens. */
  createClient?: (cfg: ModelConfig) => ModelClient
}

export async function commandRun(
  cfg: Config,
  raw: unknown,
  flags: {
    source?: string
    channel?: string
    limit?: number
    recipe?: string
    dryRun: boolean
    force: boolean
    commit: boolean
    /** Opcionális, hogy a meglévő hívások változtatás nélkül forduljanak. */
    retryFailed?: boolean
  },
  runtime: RunRuntime = {},
): Promise<number>
```

a kliens építése a `runtime`-ból jön:

```typescript
      client: (runtime.createClient ?? createModelClient)(modelConfig),
```

a `commandRun` elején, a `store` megnyitása után:

```typescript
  const startedAt = new Date()
  const id = runId(startedAt)
  const logPath = join(cfg.logsDir, `${id}.jsonl`)
  const reportPath = join(cfg.logsDir, `${id}.md`)
  const log = openRunLog(logPath)
```

a `printing` sink bővül a naplóval:

```typescript
  const printing = (e: RunEvent) => {
    sink(e)
    log.sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }
```

a riport összeállítása egy helyi függvénybe kerül, hogy a normál befejezés és a
SIGINT is ugyanazt hívja:

```typescript
  const finish = async (interrupted: boolean): Promise<void> => {
    const summary = summarize(events)
    const kind = recipeDeps?.recipe.id ?? 'transcript'
    const corpus = store.corpusStatus(discovered, kind)
    const markdown = renderReport({
      runId: id,
      startedAt,
      finishedAt: new Date(),
      command: commandLine,
      summary,
      corpus,
      runs: countRunLogs(cfg.logsDir),
      logPath,
      cost: recipeDeps
        ? {
            spentUsd: recipeDeps.guard.spentUsd(),
            limitUsd: recipeDeps.modelConfig.costLimitUsd,
            capped: recipeDeps.guard.exceeded(),
          }
        : undefined,
      nextCommand: corpus.pending > 0 ? commandLine : undefined,
    })
    await writeReport(reportPath, markdown)
    log.close()
    console.log(
      `${interrupted ? '\nMegszakítva. ' : ''}Riport: ${reportPath}`,
    )
  }
```

- A `discovered` a `discoverAll` teljes, szűretlen eredménye: a korpusz
  állapota a **teljes** korpuszról szól, nem a szűrt szeletről. Vedd fel a
  `finish` **előtt** `let discovered: SourceItem[] = []` néven, és a
  `discoverAll` eredményét ebbe töltsd — így egy korán érkező SIGINT is
  riportot ír (üres korpusszal), nem `undefined`-ra hivatkozik. Az
  `applyFilters` ezen a listán fusson.
- A `commandLine` a futást indító parancs szövege; a `main` adja át a
  `flags`-ben (`command: 'run --recipe summary'` alakban, a tényleges
  kapcsolókból összefűzve).
- A SIGINT beszerelése közvetlenül a `finish` definíciója után:

```typescript
  installSigint(() => {
    void finish(true).then(() => (runtime.exit ?? process.exit)(130))
  }, runtime.signals)
```

  A kezelő **nem zárja** az állapottárat. Egy valódi Ctrl+C-nél a
  `process.exit` úgyis véget vet a folyamatnak, és az állapottár minden írása
  már commitolva van; a tesztben pedig a hamis `exit` után a futás
  zavartalanul befejeződik, ami egy lezárt adatbázison hibát dobna.
- A `finally { store.close() }` blokk előtt, a normál úton: `await finish(false)`.
- A záró konzolsor bővül a bontással:

```typescript
    console.log(
      `\nKész: ${summary.succeeded} sikeres ` +
        `(kreátori ${summary.byCaptionSource.creator} / automatikus ${summary.byCaptionSource.auto}), ` +
        `${summary.skipped} kihagyva, ${summary.failed} hibás.`,
    )
```

- A `USAGE` szövege egy sorral bővül a naplómappáról:

```
  A futás naplója és riportja a konfigurációban megadott logs.dir alá kerül.
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/run/finish.ts src/run/finish.test.ts src/cli.ts src/cli.test.ts
# commit-message skill; tárgysor tartalma:
# feat(cli): futásnapló, riport és megszakításbiztos lezárás (Feladat 5)
```

---

### Feladat 6: A költségplafon szeletel a tiltás helyett

**Fájlok:**
- Módosítás: `src/model/budget.ts:55` (`estimateRunUsd` mellé), `src/cli.ts:155-181` (a becslési ág)
- Teszt: `src/model/budget.test.ts`, `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `estimateItemUsd`, `ModelConfig`.
- Termel: `sliceToBudget<T>(entries: readonly BudgetEntry<T>[], maxIterations: number, cfg: ModelConfig): BudgetSlice<T>`, ahol
  `BudgetEntry<T> { value: T; words: number }` és
  `BudgetSlice<T> { planned: T[]; deferred: T[]; usd: number; tokens: number }`.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/model/budget.test.ts` — új blokk. A fájl meglévő `CFG: ModelConfig`
konstansát használd, a plafont szórással írd felül:

```typescript
describe('sliceToBudget', () => {
  const limitel = (costLimitUsd: number): ModelConfig => ({ ...CFG, costLimitUsd })

  it('addig vág, amíg a becslés a plafon alá fér', () => {
    const egy = estimateItemUsd(1_000, 0, CFG)
    const cfg = limitel(egy * 2.5)
    const slice = sliceToBudget(
      [
        { value: 'a', words: 1_000 },
        { value: 'b', words: 1_000 },
        { value: 'c', words: 1_000 },
      ],
      0,
      cfg,
    )

    expect(slice.planned).toEqual(['a', 'b'])
    expect(slice.deferred).toEqual(['c'])
    expect(slice.usd).toBeLessThanOrEqual(cfg.costLimitUsd)
  })

  it('a plafon alá férő teljes köteget elindítja', () => {
    const slice = sliceToBudget([{ value: 'a', words: 100 }], 0, limitel(1_000))
    expect(slice.planned).toEqual(['a'])
    expect(slice.deferred).toEqual([])
  })

  it('ha az első elem sem fér be, üres tervet ad', () => {
    const slice = sliceToBudget([{ value: 'a', words: 5_000 }], 0, limitel(0.000001))
    expect(slice.planned).toEqual([])
    expect(slice.deferred).toEqual(['a'])
    expect(slice.usd).toBe(0)
  })

  it('üres bemenetre üres tervet ad', () => {
    expect(sliceToBudget([], 0, limitel(5))).toEqual({
      planned: [],
      deferred: [],
      usd: 0,
      tokens: 0,
    })
  })

  it('a tokenbecslés ugyanazt adja, mint az estimateRunUsd a tervezett elemekre', () => {
    const cfg = limitel(1_000)
    const slice = sliceToBudget(
      [
        { value: 'a', words: 800 },
        { value: 'b', words: 1_200 },
      ],
      1,
      cfg,
    )

    expect(slice.tokens).toBe(estimateRunUsd([800, 1_200], 1, cfg).tokens)
  })
})
```

`src/cli.test.ts` — a szeletelés megfigyelhető viselkedése. A modellhívás a
`runtime.createClient`-en át egy hamis kliensre megy, tehát a teszt hálózat
nélkül fut. Vedd fel a fájl segédei közé:

```typescript
/**
 * Hamis modellkliens: a generálás fix szöveget ad, a bíró mindig egyest.
 * A `hivasok` a tényleges generálások számát számolja — ezen múlik, hogy a
 * szeletelés tényleg csak a tervezett elemeket futtatta-e.
 */
function hamisKliens(hivasok: { generate: number }): ModelClient {
  return {
    async generate() {
      hivasok.generate++
      return {
        value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
    async generateObject<T>() {
      // A bíró ítéletének alakja: pontszám és hiánylista (rubric/judge.ts).
      return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }
    },
  }
}
```

és az eseteket:

```typescript
describe('commandRun — a plafon szeletel', () => {
  it('a plafon alá férő elemeket futtatja, a többit a következő futásra hagyja', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')
    await makeVideo(downloads, 'a3', 'Harmadik videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    const recipe = getRecipe('summary')
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    const words = (await normalizeItem(item!)).wordsNormalized
    const egy = estimateItemUsd(words, recipe.maxIterations, modelConfig)

    // A plafon két elemre elég, háromra nem: a harmadik marad.
    const limited = { ...rawWithVault(egy * 2.5) }
    const hivasok = { generate: 0 }
    const code = await commandRun(
      loadConfig(limited, '/p/refinery.config.yaml'),
      limited,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(2)

    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    expect(await readFile(join(cfg.logsDir, md), 'utf8')).toContain('1 elem hátravan')
  })

  it('ha egy elem sem fér a plafon alá, el sem indul', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')

    const limited = rawWithVault(0.000001)
    const hivasok = { generate: 0 }
    const code = await commandRun(
      loadConfig(limited, '/p/refinery.config.yaml'),
      limited,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(code).toBe(2)
    expect(hivasok.generate).toBe(0)
  })
})
```

**Figyelem a fixtúrára:** a három videó szószámának nagyjából egyeznie kell,
különben a „két elem fér be" küszöb elcsúszik. A `makeVideo` ugyanazt az `SRT`-t
írja mindhárom fájlba, tehát ez adott — csak ne cseréld le egyiket sem.

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/model/budget.test.ts src/cli.test.ts`
Várható: FAIL — `sliceToBudget is not a function`.

- [ ] **Step 3: Írd meg a szeletelést és kösd be**

`src/model/budget.ts`:

```typescript
export interface BudgetEntry<T> {
  value: T
  /** A normalizált átirat szószáma — ebből jön a becslés. */
  words: number
}

export interface BudgetSlice<T> {
  /** Ezek indulnak ebben a futásban. */
  planned: T[]
  /** Ezek maradnak a következőre, mert nem fértek a plafon alá. */
  deferred: T[]
  usd: number
  tokens: number
}

/**
 * A köteg vágása a plafonig.
 *
 * A tiltás helyett szeletelünk: egy 153 elemes korpusz becsült költsége
 * sokszorosa lehet a futásonkénti plafonnak, és ilyenkor a helyes válasz nem
 * az, hogy a köteg indíthatatlan, hanem az, hogy annyi megy át, amennyi
 * belefér — a maradékot az állapottár tartja számon.
 */
export function sliceToBudget<T>(
  entries: readonly BudgetEntry<T>[],
  maxIterations: number,
  cfg: ModelConfig,
): BudgetSlice<T> {
  const planned: T[] = []
  const deferred: T[] = []
  let usd = 0
  let tokens = 0
  let full = false

  for (const entry of entries) {
    if (full) {
      deferred.push(entry.value)
      continue
    }
    const itemUsd = estimateItemUsd(entry.words, maxIterations, cfg)
    if (usd + itemUsd > cfg.costLimitUsd) {
      full = true
      deferred.push(entry.value)
      continue
    }
    usd += itemUsd
    tokens += estimateRunUsd([entry.words], maxIterations, cfg).tokens
    planned.push(entry.value)
  }

  return { planned, deferred, usd, tokens }
}
```

`src/cli.ts` — a becslési ág átírása (a mai `if (recipeDeps) { ... }` blokk
helyére). A `wordCounts` tömb helyett elem–szószám párokat gyűjtünk, hogy a
szeletelés az elemeket is tudja vágni:

```typescript
    let planned = items
    if (recipeDeps) {
      const pending = flags.force ? items : store.listPending(items, recipeDeps.recipe.id)
      const entries: BudgetEntry<SourceItem>[] = []
      for (const item of pending) {
        try {
          entries.push({ value: item, words: (await normalizeItem(item)).wordsNormalized })
        } catch {
          // Az olvashatatlan feliratot a feldolgozás jelenti majd; a
          // becslésből egyszerűen kimarad.
        }
      }

      const slice = sliceToBudget(entries, maxIterations, recipeDeps.modelConfig)
      const limitUsd = recipeDeps.modelConfig.costLimitUsd

      printing({
        type: 'run:estimate',
        items: slice.planned.length,
        tokens: slice.tokens,
        usd: slice.usd,
        limitUsd,
      })

      if (slice.planned.length === 0) {
        const first = entries[0]
        const firstUsd = first
          ? estimateItemUsd(first.words, maxIterations, recipeDeps.modelConfig)
          : 0
        printing({
          type: 'run:aborted',
          reason:
            first === undefined
              ? 'nincs feldolgozható elem'
              : `már az első elem becsült költsége (${firstUsd.toFixed(2)} $) meghaladja a plafont`,
          spentUsd: 0,
          limitUsd,
        })
        await finish(false)
        return 2
      }

      if (slice.deferred.length > 0) {
        printing({
          type: 'run:sliced',
          planned: slice.planned.length,
          deferred: slice.deferred.length,
          usd: slice.usd,
          limitUsd,
        })
      }

      planned = slice.planned
    }
```

majd a feldolgozó ciklus a `planned` listán fut (`for (const item of planned)`).

A `render` függvény új ága:

```typescript
    case 'run:sliced':
      return `  A plafon alá ${String(event.planned)} elem fér; ${String(event.deferred)} a következő futásra marad.`
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/model/budget.ts src/model/budget.test.ts src/cli.ts src/cli.test.ts
# commit-message skill; tárgysor tartalma:
# feat(budget): a köteg a plafonig fut, majd tisztán megáll (Feladat 6)
```

---

### Feladat 7: Korlátos újrapróbálkozás átmeneti modellhibára

**Fájlok:**
- Létrehozás: `src/model/retry.ts`
- Teszt: `src/model/retry.test.ts`
- Módosítás: `src/pipeline.ts:100-115` (`runRecipe` kliensbekötése)
- Teszt: `src/pipeline.test.ts`

**Interfészek:**
- Fogyaszt: `ModelClient` (`src/model/client.ts`), `EventSink`.
- Termel: `isTransient(error: unknown): boolean`; `retrying(client: ModelClient, opts?: RetryOptions): ModelClient`, ahol
  `RetryOptions { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void }`.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/model/retry.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ModelClient } from './client.js'
import { isTransient, retrying } from './retry.js'

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${String(status)}`), { statusCode: status })
}

describe('isTransient', () => {
  it('a 429 és az 5xx átmeneti', () => {
    expect(isTransient(httpError(429))).toBe(true)
    expect(isTransient(httpError(500))).toBe(true)
    expect(isTransient(httpError(503))).toBe(true)
    expect(isTransient(httpError(408))).toBe(true)
  })

  it('a 400 és a 401 végleges', () => {
    expect(isTransient(httpError(400))).toBe(false)
    expect(isTransient(httpError(401))).toBe(false)
  })

  it('a hálózati hibakódok átmenetiek', () => {
    expect(isTransient(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isTransient(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('a megszakított kérés átmeneti', () => {
    const error = new Error('megszakadt')
    error.name = 'AbortError'
    expect(isTransient(error)).toBe(true)
  })

  it('az ok-láncban lévő átmeneti hibát is felismeri', () => {
    expect(isTransient(new Error('burkolt', { cause: httpError(503) }))).toBe(true)
  })

  it('a séma- és egyéb hibák véglegesek', () => {
    expect(isTransient(new Error('a válasz nem felel meg a sémának'))).toBe(false)
    expect(isTransient('nem is hiba')).toBe(false)
    expect(isTransient(null)).toBe(false)
  })
})

function fakeClient(behaviour: (call: number) => string): {
  client: ModelClient
  calls: () => number
} {
  let calls = 0
  const client: ModelClient = {
    async generate() {
      calls++
      return { value: behaviour(calls), usage: { inputTokens: 1, outputTokens: 1 } }
    },
    async generateObject() {
      calls++
      return { value: JSON.parse(behaviour(calls)) as never, usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
  return { client, calls: () => calls }
}

describe('retrying', () => {
  it('két 429 után a harmadik hívás sikerét adja vissza', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call < 3) throw httpError(429)
      return 'kész'
    })
    const sleep = vi.fn(async () => {})
    const result = await retrying(client, { sleep }).generate('draft', 'prompt')

    expect(result.value).toBe('kész')
    expect(calls()).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('exponenciálisan növeli a várakozást', async () => {
    const { client } = fakeClient((call) => {
      if (call < 3) throw httpError(500)
      return 'kész'
    })
    const delays: number[] = []
    await retrying(client, { sleep: async (ms) => void delays.push(ms) }).generate('draft', 'p')

    expect(delays).toEqual([1000, 2000])
  })

  it('a kísérletek számát nem lépi túl', async () => {
    const { client, calls } = fakeClient(() => {
      throw httpError(503)
    })
    await expect(
      retrying(client, { sleep: async () => {} }).generate('draft', 'p'),
    ).rejects.toThrow('HTTP 503')
    expect(calls()).toBe(3)
  })

  it('végleges hibára nem próbálkozik újra', async () => {
    const { client, calls } = fakeClient(() => {
      throw httpError(400)
    })
    await expect(
      retrying(client, { sleep: async () => {} }).generate('draft', 'p'),
    ).rejects.toThrow('HTTP 400')
    expect(calls()).toBe(1)
  })

  it('minden újrapróbálkozásról értesít', async () => {
    const { client } = fakeClient((call) => {
      if (call < 2) throw httpError(429)
      return 'kész'
    })
    const onRetry = vi.fn()
    await retrying(client, { sleep: async () => {}, onRetry }).generate('draft', 'p')

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1, delayMs: 1000 })
  })

  it('a strukturált hívást ugyanúgy védi', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call < 2) throw httpError(429)
      return '{"ok":true}'
    })
    const result = await retrying(client, { sleep: async () => {} }).generateObject(
      'judge',
      'p',
      z.object({ ok: z.boolean() }),
    )

    expect(result.value).toEqual({ ok: true })
    expect(calls()).toBe(2)
  })
})
```

`src/pipeline.test.ts` — a bekötés bizonyítása. A fájl meglévő segédeit
használd: `item()`, `alapDeps()`, `ATMENO_RECEPT` (ez a recept nem hív bírót,
tehát a számláló tisztán a generálásokat méri), `MODELL_CFG`, `createCostGuard`.
A `sleep` azonnalira cserélve, hogy a teszt ne várjon másodperceket:

```typescript
  it('átmeneti modellhiba után újrapróbálkozik, és eseményt küld róla', async () => {
    let hivasok = 0
    const client: ModelClient = {
      async generate() {
        hivasok++
        if (hivasok === 1) {
          throw Object.assign(new Error('HTTP 429'), { statusCode: 429 })
        }
        return { value: '## Jegyzet\n', usage: { inputTokens: 10, outputTokens: 5 } }
      },
      async generateObject<T>() {
        return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 1, outputTokens: 1 } }
      },
    }

    const { sink, events } = collectEvents()
    const outcome = await processItem(item(), {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client,
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
        sleep: async () => {},
      },
    })

    expect(outcome.status).toBe('published')
    expect(hivasok).toBe(2)
    expect(events.filter((e) => e.type === 'item:retry')).toHaveLength(1)
  })

  it('végleges modellhibára nem próbálkozik újra, és az elem hibás lesz', async () => {
    let hivasok = 0
    const client: ModelClient = {
      async generate() {
        hivasok++
        throw Object.assign(new Error('HTTP 400'), { statusCode: 400 })
      },
      async generateObject<T>() {
        return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 1, outputTokens: 1 } }
      },
    }

    const { sink, events } = collectEvents()
    await processItem(item(), {
      ...alapDeps(),
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client,
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
        sleep: async () => {},
      },
    })

    expect(hivasok).toBe(1)
    expect(events.filter((e) => e.type === 'item:retry')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'item:failed')).toHaveLength(1)
  })
```

Az `alapDeps()` a saját sinkjét adja; a fenti szórás után az általunk átadott
`sink` nyer — ellenőrizd, hogy a szórás sorrendje ezt tényleg biztosítja.

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/model/retry.test.ts src/pipeline.test.ts`
Várható: FAIL — `Cannot find module './retry.js'`.

- [ ] **Step 3: Írd meg a dekorátort és kösd be**

`src/model/retry.ts`:

```typescript
import type { ModelClient } from './client.js'

/** Ennyi kísérlet fér bele egy hívásba, az elsőt is beleszámítva. */
export const DEFAULT_ATTEMPTS = 3

/** Az első várakozás; minden további a duplája. */
export const BASE_DELAY_MS = 1000

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
])

const TRANSIENT_NAMES = new Set(['AbortError', 'TimeoutError'])

/**
 * Átmeneti-e a hiba, tehát van-e értelme újrapróbálni.
 *
 * A besorolás szándékosan szigorú: a 4xx (a 408 és a 429 kivételével), a
 * séma- és validációs hibák véglegesek. Egy végleges hiba újrapróbálása
 * háromszor fizetteti ki ugyanazt a kudarcot.
 */
export function isTransient(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {
    statusCode?: unknown
    status?: unknown
    code?: unknown
    name?: unknown
    cause?: unknown
  }

  const status =
    typeof e.statusCode === 'number'
      ? e.statusCode
      : typeof e.status === 'number'
        ? e.status
        : undefined
  if (status !== undefined) return status === 408 || status === 429 || status >= 500

  if (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code)) return true
  if (typeof e.name === 'string' && TRANSIENT_NAMES.has(e.name)) return true

  return e.cause !== undefined && isTransient(e.cause)
}

export interface RetryInfo {
  /** Hányadik kísérlet bukott el; egytől számozva. */
  attempt: number
  delayMs: number
  reason: string
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  /** Tesztelhetőség: az alapértelmezés valódi várakozás. */
  sleep?: (ms: number) => Promise<void>
  onRetry?: (info: RetryInfo) => void
}

/**
 * Újrapróbálkozó dekorátor a modellkliens köré.
 *
 * A védelem a **hívás** szintjén van, nem az elemén: egy elem teljes
 * újrafuttatása másodszor is kifizettetné a már sikeres generálásokat.
 */
export function retrying(client: ModelClient, opts: RetryOptions = {}): ModelClient {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS
  const baseDelayMs = opts.baseDelayMs ?? BASE_DELAY_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call()
      } catch (error) {
        if (!isTransient(error) || attempt >= attempts) throw error
        const delayMs = baseDelayMs * 2 ** (attempt - 1)
        opts.onRetry?.({ attempt, delayMs, reason: (error as Error).message })
        await sleep(delayMs)
      }
    }
  }

  return {
    generate: (role, prompt) => withRetry(() => client.generate(role, prompt)),
    generateObject: (role, prompt, schema) =>
      withRetry(() => client.generateObject(role, prompt, schema)),
  }
}
```

`src/pipeline.ts` — a `RecipeDeps` egy opcionális mezővel bővül:

```typescript
export interface RecipeDeps {
  recipe: Recipe
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
  /** Az újrapróbálkozás várakozása; a tesztek azonnalira cserélik. */
  sleep?: (ms: number) => Promise<void>
}
```

és a `runRecipe` a nyers kliens helyett dekoráltat használ:

```typescript
  // A dekorátor elemenként készül, hogy az esemény meg tudja nevezni, melyik
  // elem hívása bukott el.
  const client = retrying(recipeDeps.client, {
    sleep: recipeDeps.sleep,
    onRetry: ({ attempt, delayMs, reason }) =>
      deps.sink({ type: 'item:retry', itemId: item.itemId, attempt, delayMs, reason }),
  })

  const result = await refine(recipe, { item, transcript: text }, client)
```

(a `const { recipe, client, modelConfig, guard } = recipeDeps` destrukturálásból
a `client` kikerül, hogy ne fedje el a dekoráltat).

`src/cli.ts` — a `render` új ága:

```typescript
    case 'item:retry':
      return `  ↻ ${event.itemId}: ${event.reason} — újrapróba ${String(event.attempt)}., ${String(event.delayMs / 1000)} mp múlva`
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/model/retry.ts src/model/retry.test.ts src/pipeline.ts src/pipeline.test.ts src/cli.ts
# commit-message skill; tárgysor tartalma:
# feat(model): korlátos újrapróbálkozás átmeneti hibára (Feladat 7)
```

---

### Feladat 8: A hibás elemek célzott újrafuttatása

**Fájlok:**
- Módosítás: `src/cli.ts:29` (USAGE), `:113` (`commandRun` szűrése), `:245` (`parseArgs` kapcsolói)
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `StateStore.listFailed` (Feladat 3).
- Termel: a `--retry-failed` kapcsoló; `commandRun` `flags.retryFailed: boolean`.

- [ ] **Step 1: Írd meg a bukó teszteket**

`src/cli.test.ts` — a futásnapló a megfigyelés eszköze: abban elemazonosító
szerint látszik, mi futott le.

```typescript
describe('commandRun — --retry-failed', () => {
  it('csak a korábban elbukott elemeket futtatja', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const pre = openState(cfg.statePath)
    for (const i of await folderSource({ name: 'downloads', path: downloads }, []).discover()) {
      pre.recordItem(i)
    }
    pre.recordArtifact('a1', 'transcript', 'done', '/v/a1.md', null)
    pre.recordArtifact('a2', 'transcript', 'failed', null, 'olvashatatlan felirat')
    pre.close()

    const code = await commandRun(cfg, raw, {
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const log = await readFile(join(cfg.logsDir, jsonl), 'utf8')
    expect(log).toContain('"itemId":"a2"')
    expect(log).not.toContain('"itemId":"a1"')
  })

  it('hibás elem nélkül nulla elemmel fut le', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(cfg, raw, {
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    expect(await readFile(join(cfg.logsDir, jsonl), 'utf8')).toContain(
      '"type":"scan:found","count":0',
    )
  })

  it('a --retry-failed a --limit szűrővel együtt is működik', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const pre = openState(cfg.statePath)
    for (const i of await folderSource({ name: 'downloads', path: downloads }, []).discover()) {
      pre.recordItem(i)
    }
    pre.recordArtifact('a1', 'transcript', 'failed', null, 'hiba')
    pre.recordArtifact('a2', 'transcript', 'failed', null, 'hiba')
    pre.close()

    const code = await commandRun(cfg, raw, {
      limit: 1,
      dryRun: false,
      force: false,
      commit: false,
      retryFailed: true,
    })

    expect(code).toBe(0)
    const jsonl = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.jsonl'))!
    const log = await readFile(join(cfg.logsDir, jsonl), 'utf8')
    expect(log).toContain('"type":"scan:found","count":1')
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/cli.test.ts`
Várható: FAIL — a `retryFailed` kapcsoló nem létezik, minden elem lefut.

- [ ] **Step 3: Vezesd be a kapcsolót**

`src/cli.ts` — a `commandRun` flags típusa bővül `retryFailed: boolean`-nal, és
a szűrés a `scan:found` esemény **előtt**, a `applyFilters` **után** történik:

```typescript
    const discovered = await discoverAll(cfg.sources, cfg.languages)
    let items = applyFilters(discovered, flags)
    if (flags.retryFailed) {
      const kind = recipeDeps?.recipe.id ?? 'transcript'
      items = store.listFailed(items, kind)
    }
    printing({ type: 'scan:found', count: items.length })
```

a `parseArgs` options-ébe:

```typescript
      'retry-failed': { type: 'boolean', default: false },
```

a `main` átadásába:

```typescript
      retryFailed: values['retry-failed'],
```

és a `USAGE`-be:

```
  --retry-failed    csak a korábban hibára futott elemek
```

- [ ] **Step 4: Futtasd a teszteket**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
# commit-message skill; tárgysor tartalma:
# feat(cli): --retry-failed a hibás elemek újrafuttatásához (Feladat 8)
```

---

### Feladat 9: Végponttól végpontig bizonyítás és dokumentáció

**Fájlok:**
- Módosítás: `src/e2e.test.ts`, `src/cli.test.ts`
- Módosítás: `README.md:6` (állapotsor), `README.md:105` (tesztszám), `docs/roadmap.md` (Fázis 2), `docs/architecture.md` (napló- és riportréteg)

**Interfészek:** nincs új felület; ez a feladat a fázis sikerkritériumait
bizonyítja és dokumentálja.

- [ ] **Step 1: Írd meg a bukó e2e teszteket**

`src/cli.test.ts` — a spec 3. sikerkritériuma **modellhívásban** mérve. A
Feladat 6 `hamisKliens` segédjét használja; a hamis jegyzet szándékosan
átmegy a formátum-kritériumon (nincs benne wikilink, link, kódkerítés és
nyitó `---`), ezért elemenként pontosan egy generálás történik:

```typescript
  it('a megszakadt köteg folytatása a kész elemre nulla modellhívást tesz', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    await makeVideo(downloads, 'a2', 'Második videó', 'Csatorna A')

    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const hivasok = { generate: 0 }

    // Első futás: csak egy elem — ez a „megszakadt" köteg.
    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', limit: 1, dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )
    const elsoUtan = hivasok.generate
    expect(elsoUtan).toBeGreaterThan(0)

    // Második futás: mindkét elem sorra kerül, de a kész elem egyetlen
    // hívást sem termel — a második elem ugyanannyiba kerül, mint az első.
    await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      { createClient: () => hamisKliens(hivasok) },
    )

    expect(hivasok.generate).toBe(elsoUtan * 2)
  })
```

`src/e2e.test.ts` — új esetek a meglévő `processAll` segéd mintájára (ez
`{ written, summary, notesRoot, events, items }`-et ad vissza, és a `config()`
ugyanazt az állapotfájlt használja a hívások között):

```typescript
  it('a köteg közepén megszakadt futás után az újrafuttatás nem ír újra', async () => {
    await write(join(subsA, 'Cs', 'Elso.en.srt'), SRT)
    await write(join(subsA, 'Cs', 'Masodik.en.srt'), SRT)

    // Első futás: a köteg az első elem után „megszakad".
    const elso = await processSome([subsA], 1)
    expect(elso.summary.succeeded).toBe(1)

    // Második futás: mindkét elem sorra kerül, de a kész kimarad.
    const masodik = await processAll([subsA])
    expect(masodik.summary.succeeded).toBe(1)
    expect(masodik.summary.skipped).toBe(1)

    // A köteg-szintű állapot a két futás összegét mutatja.
    const cfg = config([subsA])
    const store = openState(cfg.statePath)
    const corpus = store.corpusStatus(masodik.items, 'transcript')
    store.close()

    expect(corpus.done).toBe(2)
    expect(corpus.pending).toBe(0)
  })

  it('a riport a felirat-forrás szerint bont, és megnevezi az automatikus elemet', async () => {
    await write(join(subsA, 'Cs', 'Kreatori.en.srt'), SRT)
    await write(join(subsB, 'Cs', 'Automatikus.en.srt'), AUTO_SRT)

    const { summary, items } = await processAll([subsA, subsB])
    expect(summary.byCaptionSource).toEqual({ creator: 1, auto: 1 })
    expect(summary.autoItems).toHaveLength(1)

    const cfg = config([subsA, subsB])
    const store = openState(cfg.statePath)
    const corpus = store.corpusStatus(items, 'transcript')
    store.close()

    const markdown = renderReport({
      runId: '2026-09-07T02-14-03',
      startedAt: new Date('2026-09-07T02:14:03Z'),
      finishedAt: new Date('2026-09-07T02:20:00Z'),
      command: 'run',
      summary,
      corpus,
      runs: 1,
      logPath: join(cfg.logsDir, '2026-09-07T02-14-03.jsonl'),
    })

    expect(markdown).toContain('kreátori 1 / automatikus 1')
    expect(markdown).toContain(summary.autoItems[0]!)
    expect(markdown).toContain('| youtube |')
    expect(markdown).toContain('| meetings |')
  })
```

Az `AUTO_SRT` egy írásjelek nélküli felirat (a minőségi kapu ez alapján
osztályoz automatikusnak); vedd fel a fájl tetején a `SRT` mellé:

```typescript
const AUTO_SRT = `1
00:00:00,000 --> 00:00:02,000
ez egy automatikus felirat irasjelek nelkul

2
00:00:02,000 --> 00:00:04,000
a masodik sor is irasjel nelkul jon
`
```

Ellenőrizd a `classifyCaptions` küszöbét (`src/normalize/classify.ts`), és
annyi írásjel nélküli szót adj a fixtúrához, hogy a besorolás egyértelműen
`auto` legyen.

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/e2e.test.ts`
Várható: FAIL — a `processSome` segéd és a `corpusOf` még nem létezik.

- [ ] **Step 3: Írd meg a segédeket, és futtasd zöldre**

Vedd fel a `processAll` mellé az egyetlen új segédet:

```typescript
/** Az első `limit` elemet dolgozza fel — a megszakadt köteget utánozza. */
async function processSome(sources: string[], limit: number) {
  const cfg = config(sources)
  const store = openState(cfg.statePath)
  const { sink, events } = collectEvents()
  const items = (await discoverAll(cfg.sources, cfg.languages)).slice(0, limit)
  for (const item of items) {
    await processItem(item, {
      notesRoot: cfg.notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    })
  }
  store.close()
  return { summary: summarize(events), events, items }
}
```

A korpusz állapotát a tesztek közvetlenül kérdezik le (`store.corpusStatus`),
a `processAll` által visszaadott `items` listával — külön segéd nem kell hozzá.

- [ ] **Step 4: Futtasd a teljes csomagot**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várható: minden zöld. Jegyezd fel a tesztek számát — a README-be ez kerül.

- [ ] **Step 5: Frissítsd a dokumentációt**

`README.md` — az állapotsor:

```markdown
> **Állapot: a Fázis 2 kész.** A teljes korpusz felügyelet nélkül végigfut: a
> futás JSONL naplót és Markdown riportot hagy maga után, a költségplafon a
> tiltás helyett szeletel, az átmeneti modellhibát korlátos újrapróbálkozás
> nyeli el. A további receptek és a felület hátravannak. Lásd:
> [`docs/roadmap.md`](<./docs/roadmap.md>).
```

és a tesztszám sora a mért értékre.

`docs/roadmap.md` — a Fázis 2 szakasz elé a teljesülés ténye, a kritériumok
átírása nélkül:

```markdown
**Státusz: kész** (2026-09-06). A riport, a napló, a szeletelő plafon és az
újrapróbálkozás a helyén; a negyedik kritériumot a `0008` utáni forrásfüggetlen
mag adja.
```

`docs/architecture.md` — a csővezeték szakaszába egy bekezdés arról, hogy az
eseményfolyamnak három fogyasztója van (konzol, JSONL napló, Markdown riport),
és hogy a köteg-szintű riport az állapottárból olvas, nem a futás memóriájából.

- [ ] **Step 6: Commit**

```bash
git add src/e2e.test.ts README.md docs/roadmap.md docs/architecture.md
# commit-message skill; tárgysor tartalma:
# test(e2e): a megszakított köteg folytatása és a riport bontása (Feladat 9)
```

---

## Záró ellenőrzés

A fázis akkor kész, ha a spec mind a tíz sikerkritériuma teljesül. A
végrehajtás végén futtasd le egyben:

```bash
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm lint
```

és nyiss PR-t a `feat/koteg-es-riport` ágról, `Closes #12` láblécccel.
