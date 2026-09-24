# Terv — A vaultban már meglévő jegyzetek bepipálása

> **A végrehajtónak:** ez a terv lépésről lépésre hajtható végre
> (`superpowers:executing-plans`). Minden lépés egy művelet, checkbox jelöli.
> A spec és a terv együtt olvasandó.

**Cél:** A `scan --queue` a kész (videó, recept) párt — fordítást is — `[x]`
pipával és `✓` utótaggal jelöli; a „kész" forrása az állapottár `done`
rekordja, vagy ha az nincs, a lemezen lévő célfájl. A futás a modellhívás
előtt megnézi, létezik-e a célfájl, és a már meglévő jegyzetért nem fizet.

**Megközelítés:** Egy új, tiszta lépés a scan láncában: `migrateLegacy` →
`mergeQueue` → **`markDone`** → `renumberQueue`. A `markDone` helyben szerkeszt,
a sorok száma nem változik; a „kész" eldöntését egy befecskendezett
lekérdező (`doneLookup`) végzi, ami maga nem végez I/O-t. A futásvédelem a
`runRecipe` elejére kerül, a meglévő write-once elv korábbi érvényesítéseként.

**Eszközök:** TypeScript (ESM, `.js` importvégződéssel), vitest. Nulla új
függőség.

**Spec:** [`2026-09-23-jegyzetek-bepipalasa-spec.md`](<./2026-09-23-jegyzetek-bepipalasa-spec.md>)
· **Issue:** #63

## Globális megkötések

- Magyar dokumentáció, kódkomment, teszt-leírás, felhasználói kimenet és
  commit-üzenet; **angol** produkciós azonosító.
- **Nulla új függőség.** Az állapottár sémája nem változik.
- A `mergeQueue`, a `renumberQueue` és a `migrateLegacy` nem változik. A sor
  formátuma nem változik; csak pipa és utótag íródik.
- A scan nem hív modellt, `LITELLM_API_KEY` nélkül is fut, és **nem hoz létre
  állapottárat**.
- A meglévő `✓` utótag **bájtra marad**; a scan pipát soha nem vesz le.
- Minden teszt offline fut, valódi modellhívás nincs.
- Ág: `feat/jegyzetek-bepipalasa` a friss `main`-ről, **miután a spec + terv
  docs-PR-je bekerült**. Egy PR, `Closes #63`.
- Commit-üzenet a `commit-message` skillel.
- Minden task végén `pnpm test`, `pnpm typecheck` és `pnpm lint` fut, és zöld.

## A terv ellenőrzése

A Task 1–4 kódja és tesztjei a terv írásakor egy eldobható worktree-n, a
tervből szó szerint kivéve lefutottak: `tsc` hibátlan, `eslint src` hibátlan,
86 tesztfájl, 965 teszt zöld. Az új tesztek bukását az implementáció nélkül is
ellenőriztük: a pipeline-védelem nélkül 3, a CLI-bekötés nélkül 3 teszt bukik,
a pipeline-védelem nélkül a CLI „rekord nélküli jegyzet" tesztje is. A Task 6
az élő sor másolatán: pontosan 12 sor változott (a spec mérése), a
`pinchflat-minta` link a rekord útjára mutat, a második futás bájtra azonos. A
Task 5 (dokumentáció) nem futott.

## Review Focus

Amit a spec kimond vagy sugall, és egy felhasználót a legkönnyebben megharap —
mindegyikhez teszt tartozik a megnevezett taskban:

1. **Rekord nélküli, kézzel odatett jegyzet, amit a scan bepipál** — a következő
   `run --queue` erre nem hívhat modellt, és a fájl bájtra marad (Task 3 és
   Task 4, a CLI végponttól végpontig tartó tesztje).
2. **`[ ]` + már meglévő `✓` utótag** (az élő sorban 2 ilyen van) — csak a
   pipa változik, a régi pontszám és link bájtra marad (Task 2).
3. **A rekord útja eltér a mai célúttól** (`pinchflat-minta/…`) — a link a
   rekord útjára mutat, nem a mai célútra (Task 2, `doneLookup`).
4. **Duplikátum videóblokk és saját fejléc alatti pipás sor** — egyikhez sem
   nyúl, akkor sem, ha a lekérdező mindenre „kész"-t mond (Task 2).
5. **`--force` és `--dry-run`** — a force továbbra is hív és felülír; a dry-run
   nem hív, de nem is rögzít (Task 3).

## Fájlszerkezet

| fájl | mi történik vele |
|---|---|
| `src/queue/status.ts` | `IN_VAULT_STATUS`; `doneStatus` pontszám és költség nélküli esete |
| `src/queue/status.test.ts` | három új eset |
| `src/queue/done.ts` | **új** — `DoneLookup`, `DoneLookupDeps`, `doneLookup`, `markDone` |
| `src/queue/done.test.ts` | **új** |
| `src/vault/publish.ts` | az `exists` exportálva |
| `src/pipeline.ts` | a `runRecipe` elején a célfájl ellenőrzése |
| `src/pipeline.test.ts` | új `describe` blokk a fájl végén |
| `src/cli.ts` | `commandScanQueue`: `markDone` a lánc közepén, konzolsor |
| `src/cli.test.ts` | új `describe` blokk a fájl végén |
| `README.md`, `docs/architecture.md` | a sor és az ütközésvédelem leírása |

---

## Task 1: A „már a vaultban" utótag — `status.ts`

**Files:**
- Modify: `src/queue/status.ts` (a `doneStatus` és fölötte egy új konstans)
- Test: `src/queue/status.test.ts` (a `describe('doneStatus')` blokk vége)

**Interfaces:**
- Consumes: —
- Produces:
  - `export const IN_VAULT_STATUS = '✓ már a vaultban'`
  - `doneStatus(record: Pick<ArtifactRecord, 'score' | 'costUsd' | 'path'>, notesRoot: string): string`
    — változatlan aláírás; `score === null && costUsd === null` esetén
    `✓ már a vaultban` (+ ` · [jegyzet](<…>)`, ha van út).

- [ ] **Step 1: A bukó teszt**

A `src/queue/status.test.ts` `describe('doneStatus', …)` blokkjában az
`'útvonal nélküli receptnél a link elmarad'` eset után, a blokk záró `})`-e
elé:

```ts
  it('pontszám és költség nélkül: a jegyzet már a vaultban volt, linkkel', () => {
    expect(
      doneStatus({ score: null, costUsd: null, path: '/v/root/f/Elso_summary.md' }, '/v/root'),
    ).toBe('✓ már a vaultban · [jegyzet](<f/Elso_summary.md>)')
  })

  it('pontszám és költség nélkül, útvonal nélkül: csak a jelölés', () => {
    expect(doneStatus({ score: null, costUsd: null, path: null }, '/v/root')).toBe(
      '✓ már a vaultban',
    )
  })

  it('csak az egyik hiányzik: a régi formátum marad', () => {
    expect(doneStatus({ score: null, costUsd: 0.01, path: null }, '/v/root')).toBe(
      '✓ – · $0.0100',
    )
    expect(doneStatus({ score: 0.9, costUsd: null, path: null }, '/v/root')).toBe(
      '✓ 0.90 · $0.0000',
    )
  })
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/queue/status.test.ts`
Expected: FAIL — az első két új eset `✓ – · $0.0000`-t kap a várt
`✓ már a vaultban` helyett; a harmadik zöld (regressziós horgony).

- [ ] **Step 3: Az implementáció**

A `src/queue/status.ts`-ben a `doneStatus` dokumentációs kommentje elé kerül a
konstans, a függvény eleje pedig így változik (a link-rész változatlan):

```ts
/** A modell nélkül késznek talált pár jelölése: a jegyzet már a vaultban volt. */
export const IN_VAULT_STATUS = '✓ már a vaultban'

/**
 * Kész pár utótagja: pontszám, költség és a jegyzet relatív linkje. A költség
 * négy tizedes, mint az `item:refined` kiírásában — egy pár nagyságrendjében a
 * két tizedes minden összeget `0.00`-nak mutatna. Se pontszám, se költség: a
 * pár modell nélkül lett kész, mert a jegyzet már megvolt.
 */
export function doneStatus(
  record: Pick<ArtifactRecord, 'score' | 'costUsd' | 'path'>,
  notesRoot: string,
): string {
  const parts =
    record.score === null && record.costUsd === null
      ? [IN_VAULT_STATUS]
      : [
          `✓ ${record.score === null ? '–' : record.score.toFixed(2)}`,
          `$${(record.costUsd ?? 0).toFixed(4)}`,
        ]
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy zöld**

Run: `pnpm vitest run src/queue/status.test.ts`
Expected: PASS, 14 teszt.

- [ ] **Step 5: Teljes ellenőrzés**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: mind zöld.

- [ ] **Step 6: Commit** (a `commit-message` skillel)

```bash
git add src/queue/status.ts src/queue/status.test.ts
```

Javasolt üzenet: `feat(queue): kész utótag pontszám és költség nélküli párra`,
lábléc `Refs #63`.

---

## Task 2: A kész párok bepipálása — `done.ts`

**Files:**
- Create: `src/queue/done.ts`
- Test: `src/queue/done.test.ts`

**Interfaces:**
- Consumes: `doneStatus` (Task 1), `parseQueue` (`./parse.js`),
  `translationId` (`./layout.js`), `SEPARATOR`, `withSuffix` (`./line.js`),
  `noteFile` (`../vault/paths.js`), `lintVaultMarkdown`, `Registry`,
  `ArtifactRecord`, `SourceItem`.
- Produces:
  - `type DoneLookup = (itemId: string, kind: string) => string | null`
  - `interface DoneLookupDeps { items: ReadonlyMap<string, SourceItem>; registry: Registry; notesRoot: string; artifactOf: (itemId: string, kind: string) => Pick<ArtifactRecord, 'status' | 'score' | 'costUsd' | 'path'> | null; exists: (path: string) => boolean }`
  - `doneLookup(deps: DoneLookupDeps): DoneLookup`
  - `markDone(text: string, lookup: DoneLookup): { text: string; marked: number }`

- [ ] **Step 1: A bukó teszt**

`src/queue/done.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import type { SourceItem } from '../types.js'
import { noteFile } from '../vault/paths.js'
import { doneLookup, markDone, type DoneLookup } from './done.js'
import { pairKey } from './status.js'

const sor = (...lines: string[]): string => ['# Feldolgozási sor', '', ...lines, ''].join('\n')

/** Lekérdező a megadott párokra: `[itemId, kind] → utótag`. */
function kesz(parok: Record<string, string>): DoneLookup {
  return (itemId, kind) => parok[pairKey(itemId, kind)] ?? null
}

const K = (itemId: string, kind: string): string => pairKey(itemId, kind)

describe('markDone', () => {
  it('az üres sor [x] pipát és utótagot kap', () => {
    const { text, marked } = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary', '- [ ] qa'),
      kesz({ [K('a1', 'summary')]: '✓ 0.97 · $0.0471' }),
    )
    expect(text).toBe(
      sor('## 1. f', '### 1. Első %%a1%%', '- [x] summary — ✓ 0.97 · $0.0471', '- [ ] qa'),
    )
    expect(marked).toBe(1)
  })

  it('a ✗, ⏸ és ⏳ utótagot felülírja', () => {
    const { text, marked } = markDone(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [x] summary — ✗ időtúllépés',
        '- [x] qa — ⏳ a plafon miatt a következő futásra maradt',
        '- [x] clean — ⏸ előbb a summary recept kell',
      ),
      kesz({
        [K('a1', 'summary')]: '✓ 0.90 · $0.0100',
        [K('a1', 'qa')]: '✓ 0.80 · $0.0200',
        [K('a1', 'clean')]: '✓ már a vaultban',
      }),
    )
    expect(text).toBe(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [x] summary — ✓ 0.90 · $0.0100',
        '- [x] qa — ✓ 0.80 · $0.0200',
        '- [x] clean — ✓ már a vaultban',
      ),
    )
    expect(marked).toBe(3)
  })

  it('[ ] + ✓: csak a pipa változik, az utótag bájtra marad', () => {
    const { text, marked } = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary — ✓ 0.00 · $0.0093 · [jegyzet](<./a.md>)'),
      kesz({ [K('a1', 'summary')]: '✓ 0.95 · $0.0500' }),
    )
    expect(text).toBe(
      sor('## 1. f', '### 1. Első %%a1%%', '- [x] summary — ✓ 0.00 · $0.0093 · [jegyzet](<./a.md>)'),
    )
    expect(marked).toBe(1)
  })

  it('[x] + ✓ és [X] + ✓ érintetlen', () => {
    const be = sor(
      '## 1. f',
      '### 1. Első %%a1%%',
      '- [x] summary — ✓ 0.97 · $0.0471',
      '- [X] qa — ✓ 0.98 · $0.0596',
    )
    const { text, marked } = markDone(
      be,
      kesz({ [K('a1', 'summary')]: '✓ 0.10 · $9.0000', [K('a1', 'qa')]: '✓ 0.10 · $9.0000' }),
    )
    expect(text).toBe(be)
    expect(marked).toBe(0)
  })

  it('a fordítássor a saját kulcsával jelölődik; a nem kész szülő érintetlen', () => {
    const { text } = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] clean', '  - [ ] hu'),
      kesz({ [K('a1', 'clean-hu')]: '✓ már a vaultban' }),
    )
    expect(text).toBe(sor('## 1. f', '### 1. Első %%a1%%', '- [ ] clean', '  - [x] hu — ✓ már a vaultban'))
  })

  it('a duplikátum videóblokkhoz nem nyúl', () => {
    const { text } = markDone(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [ ] summary',
        '### 2. Első újra %%a1%% — ⚠ duplikátum',
        '- [ ] summary',
      ),
      kesz({ [K('a1', 'summary')]: '✓ már a vaultban' }),
    )
    expect(text).toBe(
      sor(
        '## 1. f',
        '### 1. Első %%a1%%',
        '- [x] summary — ✓ már a vaultban',
        '### 2. Első újra %%a1%% — ⚠ duplikátum',
        '- [ ] summary',
      ),
    )
  })

  it('null lekérdezőre a szöveg bájtra azonos, saját sorokkal és fejlécekkel együtt', () => {
    const be = sor(
      'Saját megjegyzés.',
      '## 1. f',
      '### 1. Első %%a1%%',
      '- [ ] summary',
      '  - [ ] hu',
      '## Jegyzetek',
      '- [ ] summary',
    )
    expect(markDone(be, () => null)).toEqual({ text: be, marked: 0 })
  })

  it('a saját fejléc alatti pipás sor nem pár: akkor sem nyúl hozzá, ha a lekérdező mindenre igent mond', () => {
    const be = sor('## 1. f', '### 1. Első %%a1%%', '## Jegyzetek', '- [ ] summary')
    expect(markDone(be, () => '✓ már a vaultban').text).toBe(be)
  })

  it('kétszer alkalmazva ugyanazt adja', () => {
    const lookup = kesz({ [K('a1', 'summary')]: '✓ 0.97 · $0.0471', [K('a1', 'clean-hu')]: '✓ már a vaultban' })
    const elso = markDone(
      sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary', '- [ ] clean', '  - [ ] hu'),
      lookup,
    ).text
    expect(markDone(elso, lookup)).toEqual({ text: elso, marked: 0 })
  })

  it('linksértő utótagot nem ír ki', () => {
    expect(() =>
      markDone(sor('## 1. f', '### 1. Első %%a1%%', '- [ ] summary'), () => '✓ [[wikilink]]'),
    ).toThrow('vault írási szabályait')
  })
})

describe('doneLookup', () => {
  const notesRoot = '/v/root'
  const registry = recipesFor({ translate: { to: 'hu', recipes: ['clean'] }, configPath: '/p/c.yaml' })
  const elem: SourceItem = {
    itemId: 'a1',
    source: 'transcripts',
    sourceFile: 'youtube/Csatorna/Elso.en.srt',
    subtitlePath: '/src/transcripts/youtube/Csatorna/Elso.en.srt',
    baseName: 'Elso',
    title: 'Első',
    language: 'en',
    metadata: {},
  }
  const items = new Map([[elem.itemId, elem]])
  const summaryUt = noteFile(notesRoot, elem, '_summary.md')

  it('ismeretlen elemre és ismeretlen receptre null', () => {
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => ({ status: 'done', score: 1, costUsd: 0.1, path: null }),
      exists: () => true,
    })
    expect(lookup('nincs', 'summary')).toBeNull()
    expect(lookup('a1', 'nincsilyen')).toBeNull()
  })

  it('done rekordnál a rekord pontszáma, költsége és — eltérő — útja számít', () => {
    const regiUt = join(notesRoot, 'transcripts/pinchflat-minta/youtube/Csatorna/Elso_summary.md')
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => ({ status: 'done', score: 0.95, costUsd: 0.0719, path: regiUt }),
      exists: () => false,
    })
    expect(lookup('a1', 'summary')).toBe(
      '✓ 0.95 · $0.0719 · [jegyzet](<transcripts/pinchflat-minta/youtube/Csatorna/Elso_summary.md>)',
    )
  })

  it('rekord nélkül, létező célfájllal: már a vaultban, a célút linkjével', () => {
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => null,
      exists: (path) => path === summaryUt,
    })
    expect(lookup('a1', 'summary')).toBe(
      '✓ már a vaultban · [jegyzet](<transcripts/youtube/Csatorna/Elso_summary.md>)',
    )
    expect(lookup('a1', 'qa')).toBeNull()
  })

  it('failed rekord: fájl nélkül null, fájllal már a vaultban', () => {
    const failed = () => ({ status: 'failed', score: null, costUsd: null, path: null })
    expect(
      doneLookup({ items, registry, notesRoot, artifactOf: failed, exists: () => false })('a1', 'summary'),
    ).toBeNull()
    expect(
      doneLookup({ items, registry, notesRoot, artifactOf: failed, exists: () => true })('a1', 'summary'),
    ).toBe('✓ már a vaultban · [jegyzet](<transcripts/youtube/Csatorna/Elso_summary.md>)')
  })

  it('a fordítás célútja a fordítórecept fájlneve', () => {
    const lookup = doneLookup({
      items,
      registry,
      notesRoot,
      artifactOf: () => null,
      exists: (path) => path === noteFile(notesRoot, elem, '_clean-hu.md'),
    })
    expect(lookup('a1', 'clean-hu')).toBe(
      '✓ már a vaultban · [jegyzet](<transcripts/youtube/Csatorna/Elso_clean-hu.md>)',
    )
  })
})
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/queue/done.test.ts`
Expected: FAIL — `Failed to resolve import "./done.js"`.

- [ ] **Step 3: Az implementáció**

`src/queue/done.ts`:

```ts
import type { Registry } from '../recipe/registry.js'
import type { ArtifactRecord } from '../state/db.js'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { noteFile } from '../vault/paths.js'
import { translationId } from './layout.js'
import { SEPARATOR, withSuffix } from './line.js'
import { parseQueue } from './parse.js'
import { doneStatus } from './status.js'

/** A kész pár utótagja, vagy `null`, ha a pár nem kész. */
export type DoneLookup = (itemId: string, kind: string) => string | null

export interface DoneLookupDeps {
  /** A felderített elemek, azonosító szerint. */
  items: ReadonlyMap<string, SourceItem>
  registry: Registry
  notesRoot: string
  artifactOf: (
    itemId: string,
    kind: string,
  ) => Pick<ArtifactRecord, 'status' | 'score' | 'costUsd' | 'path'> | null
  exists: (path: string) => boolean
}

/**
 * A „kész" forrása: előbb az állapottár `done` rekordja — a rekord útjával,
 * akkor is, ha az eltér a mai célúttól —, aztán a lemezen lévő célfájl. A
 * `failed` rekord nem kész. I/O-t nem végez: az `artifactOf` és az `exists`
 * befecskendezett.
 */
export function doneLookup(deps: DoneLookupDeps): DoneLookup {
  return (itemId, kind) => {
    const item = deps.items.get(itemId)
    const recipe = deps.registry[kind]
    if (item === undefined || recipe === undefined) return null
    const record = deps.artifactOf(itemId, kind)
    if (record?.status === 'done') return doneStatus(record, deps.notesRoot)
    if (!recipe.publishable) return null
    const path = noteFile(deps.notesRoot, item, recipe.outputFile)
    return deps.exists(path) ? doneStatus({ score: null, costUsd: null, path }, deps.notesRoot) : null
  }
}

/** A már meglévő `✓` utótag: a futás saját eredménye, a scan nem írja felül. */
const DONE_SUFFIX = `${SEPARATOR}✓`

/** A fej pipája bepipálva; a `[x]` és `[X]` marad, ahogy van. */
function checkedHead(head: string): string {
  return head.replace('[ ]', '[x]')
}

/**
 * A kész párok sora `[x]` pipát és `✓` utótagot kap. Tiszta függvény: a sorok
 * száma nem változik, a meglévő `✓` utótag bájtra marad, és minden sor, amire
 * a `lookup` `null`-t ad, érintetlen. A duplikátum videó kimarad. Kétszer
 * alkalmazva ugyanazt adja.
 */
export function markDone(text: string, lookup: DoneLookup): { text: string; marked: number } {
  const doc = parseQueue(text)
  const lines = [...doc.lines]
  let marked = 0

  const mark = (
    line: number,
    row: { head: string; suffix: string },
    itemId: string,
    kind: string,
  ): void => {
    const status = lookup(itemId, kind)
    if (status === null) return
    const head = checkedHead(row.head)
    let next: string
    if (row.suffix.startsWith(DONE_SUFFIX)) {
      next = `${head}${row.suffix}`
    } else {
      const errors = lintVaultMarkdown(status)
      if (errors.length > 0) {
        throw new Error(`a kész jelölés megsérti a vault írási szabályait: ${errors.join('; ')}`)
      }
      next = withSuffix(head, status)
    }
    if (next !== lines[line]) {
      lines[line] = next
      marked++
    }
  }

  for (const video of doc.videos) {
    if (video.duplicate) continue
    for (const recipe of video.recipes) {
      mark(recipe.line, recipe, video.itemId, recipe.recipeId)
      for (const translation of recipe.translations) {
        mark(translation.line, translation, video.itemId, translationId(recipe.recipeId, translation.lang))
      }
    }
  }

  return { text: lines.join('\n'), marked }
}
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy zöld**

Run: `pnpm vitest run src/queue/done.test.ts`
Expected: PASS, 15 teszt.

- [ ] **Step 5: Mutációs ellenőrzés** (mindegyik után a tesztnek buknia kell,
  majd állítsd vissza)

1. A `markDone`-ban a `row.suffix.startsWith(DONE_SUFFIX)` ágat cseréld
   `false`-ra → a `'[ ] + ✓: csak a pipa változik…'` és az `'[x] + ✓ és
   [X] + ✓ érintetlen'` eset bukik.
2. A `if (video.duplicate) continue` sort töröld → a duplikátum-eset bukik.
3. A `doneLookup`-ban a `record?.status === 'done'` feltételt cseréld
   `record !== null`-ra → a `failed` rekordos eset bukik.

Run: `pnpm vitest run src/queue/done.test.ts` mindhárom után.

- [ ] **Step 6: Teljes ellenőrzés**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: mind zöld.

- [ ] **Step 7: Commit** (a `commit-message` skillel)

```bash
git add src/queue/done.ts src/queue/done.test.ts
```

Javasolt üzenet: `feat(queue): kész párok bepipálása a sorban`, lábléc
`Refs #63`.

---

## Task 3: Futásvédelem — a célfájl a modellhívás előtt

**Files:**
- Modify: `src/vault/publish.ts` (az `exists` exportálása)
- Modify: `src/pipeline.ts` (import; a `runRecipe` eleje)
- Test: `src/pipeline.test.ts` (új `describe` a fájl végén)

**Interfaces:**
- Consumes: `noteFile`, `publishNote` mellé az `exists`.
- Produces: `export async function exists(path: string): Promise<boolean>`
  (`src/vault/publish.ts`). A `processItem` viselkedése: publikálható
  receptnél, `force` nélkül, létező célfájlra nincs modellhívás, `done`
  rekord (útvonallal, metrikák nélkül; `dryRun`-nál nincs rekord),
  `item:skipped` esemény `a fájl már létezik` okkal.

- [ ] **Step 1: A bukó teszt**

A `src/pipeline.test.ts` végére (a meglévő `ATMENO_RECEPT`, `fixModell`,
`MODELL_CFG`, `alapDeps`, `item`, `MAGYAR_FORDITAS`, `translationOf`,
`noteFile`, `mkdir`, `dirname`, `writeFile` és `readFile` már importálva vagy
definiálva van a fájlban):

```ts
describe('processItem — a már meglévő jegyzet a modellhívás előtt', () => {
  /** Egy kézzel odatett jegyzet a recept célútján, állapottár-rekord nélkül. */
  async function meglevoJegyzet(outputFile: string): Promise<string> {
    const path = noteFile(notesRoot, item(), outputFile)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '# Kézzel írt jegyzet\n', 'utf8')
    return path
  }

  it('létező célfájlnál nem hív modellt, done-ként rögzíti, és a fájl bájtra marad', async () => {
    const deps = alapDeps()
    const path = await meglevoJegyzet('_proba.md')
    const draft = fixModell('## Új jegyzet\n')
    const { sink, events } = collectEvents()

    const outcome = await processItem(item(), {
      ...deps,
      sink,
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: modelClientFrom({ draft, judge: fixModell('nem hívjuk') }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(draft.doGenerateCalls).toHaveLength(0)
    expect(await readFile(path, 'utf8')).toBe('# Kézzel írt jegyzet\n')
    expect(deps.store.artifactOf(item().itemId, 'proba')).toMatchObject({
      status: 'done',
      path,
      score: null,
      costUsd: null,
    })
    expect(events).toContainEqual({
      type: 'item:skipped',
      itemId: item().itemId,
      reason: 'a fájl már létezik',
    })
    expect(outcome.skipReason).toBeUndefined()
  })

  it('force mellett hív modellt, és felülírja a fájlt', async () => {
    const deps = alapDeps()
    const path = await meglevoJegyzet('_proba.md')
    const draft = fixModell('## Új jegyzet\n')

    await processItem(item(), {
      ...deps,
      options: { force: true },
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: modelClientFrom({ draft, judge: fixModell('nem hívjuk') }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(draft.doGenerateCalls).toHaveLength(1)
    expect(await readFile(path, 'utf8')).toContain('## Új jegyzet')
  })

  it('dry-run mellett sem hív modellt, de nem rögzít', async () => {
    const deps = alapDeps()
    await meglevoJegyzet('_proba.md')
    const draft = fixModell('## Új jegyzet\n')

    await processItem(item(), {
      ...deps,
      options: { dryRun: true },
      recipeDeps: {
        recipe: ATMENO_RECEPT,
        client: modelClientFrom({ draft, judge: fixModell('nem hívjuk') }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(draft.doGenerateCalls).toHaveLength(0)
    expect(deps.store.artifactOf(item().itemId, 'proba')).toBeNull()
  })

  it('fordításnál a forrásjegyzetet sem keresi: kész forrás nélkül is done', async () => {
    const deps = alapDeps()
    await meglevoJegyzet('_proba-hu.md')
    const draft = fixModell(MAGYAR_FORDITAS)

    await processItem(item(), {
      ...deps,
      recipeDeps: {
        recipe: translationOf(ATMENO_RECEPT, 'hu'),
        client: modelClientFrom({ draft, judge: fixModell('nem hívjuk') }),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    expect(draft.doGenerateCalls).toHaveLength(0)
    expect(deps.store.artifactOf(item().itemId, 'proba-hu')!.status).toBe('done')
  })
})
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/pipeline.test.ts`
Expected: FAIL, 3 teszt — a `létező célfájlnál…`, a `dry-run mellett…` és a
`fordításnál…` eset. A `force` eset zöld (regressziós horgony).

- [ ] **Step 3: Az `exists` exportálása**

`src/vault/publish.ts`, a mai `async function exists(path: string)` sor
helyett:

```ts
/** Létezik-e a fájl. A futás a modellhívás előtt ezzel nézi meg a célfájlt. */
export async function exists(path: string): Promise<boolean> {
```

- [ ] **Step 4: A védelem**

`src/pipeline.ts`, az import:

```ts
import { exists, publishNote, type PublishOptions } from './vault/publish.js'
```

A `runRecipe`-ben közvetlenül a `const { recipe, modelConfig, guard } =
recipeDeps` sor után, a `// Fordításnál a bemenet…` komment elé:

```ts
  // A write-once elv a modellhívás ELŐTT: a már meglévő jegyzetért nem
  // fizetünk. A `force` felülírja a fájlt, ezért ott a hívás is kell.
  if (recipe.publishable && !deps.options.force) {
    const target = noteFile(deps.notesRoot, item, recipe.outputFile)
    if (await exists(target)) {
      if (!deps.options.dryRun) {
        deps.store.recordArtifact(item.itemId, recipe.id, 'done', target, null, undefined, deps.commit)
      }
      deps.sink({ type: 'item:skipped', itemId: item.itemId, reason: 'a fájl már létezik' })
      return { status: 'skipped', recipePath: target }
    }
  }
```

A `runRecipe` végén lévő, hívás utáni write-once ág **marad** biztonsági
hálónak.

- [ ] **Step 5: Futtasd, és nézd meg, hogy zöld**

Run: `pnpm vitest run src/pipeline.test.ts`
Expected: PASS, 38 teszt.

- [ ] **Step 6: Mutációs ellenőrzés** (bukjon, majd állítsd vissza)

1. A `!deps.options.force` feltételt töröld → a `force` eset bukik.
2. A `if (!deps.options.dryRun)` feltételt töröld (a rögzítés feltétel nélkül
   fut) → a `dry-run` eset bukik.

- [ ] **Step 7: Teljes ellenőrzés**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: mind zöld.

- [ ] **Step 8: Commit** (a `commit-message` skillel)

```bash
git add src/vault/publish.ts src/pipeline.ts src/pipeline.test.ts
```

Javasolt üzenet: `feat(pipeline): meglévő jegyzetért nincs modellhívás`,
lábléc `Refs #63`.

---

## Task 4: A scan bekötése — `cli.ts`

**Files:**
- Modify: `src/cli.ts` (importok; `commandScanQueue`)
- Test: `src/cli.test.ts` (a `node:path` import; új `describe` a fájl végén)

**Interfaces:**
- Consumes: `doneLookup`, `markDone` (Task 2); a futásvédelem (Task 3) a
  végponttól végpontig tartó teszthez; `openState`, `existsSync`.
- Produces: a `scan --queue` kimenetén új sor, ha `marked > 0`:
  `N sor késznek jelölve (állapottár vagy meglévő jegyzet alapján).`

- [ ] **Step 1: A bukó teszt**

A `src/cli.test.ts` elején a `node:path` import:

```ts
import { dirname, join, relative } from 'node:path'
```

A fájl végére (a `makeVideo`, `rawWithVault`, `folderSource`, `noteFile`,
`openState`, `queuePath`, `videoBlokk`, `sorKliens`, `commandRun`,
`commandScanQueue`, `gitCommitPaths`, `existsSync` már elérhető a fájlban):

```ts
describe('commandScanQueue — a kész párok bepipálása', () => {
  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockClear()
  })

  /** Az egyetlen felderített elem. */
  async function elsoElem() {
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
    return item!
  }

  it('az állapottár done rekordja [x]-et és a futás utótagját adja; a második scan nem változtat', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')
    const item = await elsoElem()
    const jegyzet = noteFile(cfg.notesRoot, item, '_summary.md')
    const pre = openState(cfg.statePath)
    pre.recordItem(item)
    pre.recordArtifact('a1', 'summary', 'done', jegyzet, null, {
      iterations: 1,
      score: 0.97,
      costUsd: 0.0471,
      model: 'proba-draft',
    })
    pre.close()
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await commandScanQueue(cfg, { dryRun: false, commit: false })
    const elso = await readFile(queuePath(cfg.notesRoot), 'utf8')
    await commandScanQueue(cfg, { dryRun: false, commit: false })

    const link = relative(cfg.notesRoot, jegyzet)
    expect(videoBlokk(elso, 'a1')).toEqual([
      '### 1. Első videó %%a1%%',
      `- [x] summary — ✓ 0.97 · $0.0471 · [jegyzet](<${link}>)`,
      '- [ ] flashcards',
      '- [ ] qa',
      '- [ ] clean',
      '- [ ] bloom',
      '- [ ] notes',
    ])
    expect(await readFile(queuePath(cfg.notesRoot), 'utf8')).toBe(elso)
    expect(naplo.mock.calls.flat().join('\n')).toContain(
      '1 sor késznek jelölve (állapottár vagy meglévő jegyzet alapján).',
    )
    naplo.mockRestore()
  })

  it('rekord nélküli meglévő jegyzet: a scan bepipálja, a futás nem hív rá modellt, a fájl marad', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const jegyzet = noteFile(cfg.notesRoot, await elsoElem(), '_summary.md')
    await mkdir(dirname(jegyzet), { recursive: true })
    await writeFile(jegyzet, '# Kézzel írt jegyzet\n', 'utf8')
    const sor = queuePath(cfg.notesRoot)

    await commandScanQueue(cfg, { dryRun: false, commit: false })
    const scanUtan = await readFile(sor, 'utf8')
    expect(videoBlokk(scanUtan, 'a1')).toContain(
      `- [x] summary — ✓ már a vaultban · [jegyzet](<${relative(cfg.notesRoot, jegyzet)}>)`,
    )

    const hivasok = { generate: 0 }
    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(0)
    expect(hivasok.generate).toBe(0)
    expect(await readFile(jegyzet, 'utf8')).toBe('# Kézzel írt jegyzet\n')
    expect(await readFile(sor, 'utf8')).toBe(scanUtan)
    const store = openState(cfg.statePath)
    expect(store.artifactOf('a1', 'summary')).toMatchObject({ status: 'done', path: jegyzet })
    store.close()
  })

  it('állapottár nélkül nem hoz létre állapottárat', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')

    await commandScanQueue(cfg, { dryRun: false, commit: false })

    expect(existsSync(cfg.statePath)).toBe(false)
  })

  it('--dry-run mellett kiírja a számot, de a sort nem írja', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const cfg = loadConfig(rawWithVault(5), '/p/refinery.config.yaml')
    const jegyzet = noteFile(cfg.notesRoot, await elsoElem(), '_qa.md')
    await mkdir(dirname(jegyzet), { recursive: true })
    await writeFile(jegyzet, '# Kézzel írt jegyzet\n', 'utf8')
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await commandScanQueue(cfg, { dryRun: true, commit: false })

    expect(existsSync(queuePath(cfg.notesRoot))).toBe(false)
    expect(naplo.mock.calls.flat().join('\n')).toContain('1 sor késznek jelölve')
    naplo.mockRestore()
  })
})
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `pnpm vitest run src/cli.test.ts -t "bepipálása"`
Expected: FAIL, 3 teszt; az `állapottár nélkül…` eset zöld (regressziós
horgony).

- [ ] **Step 3: Az implementáció**

`src/cli.ts`, az első import:

```ts
import { existsSync, realpathSync } from 'node:fs'
```

A `./queue/file.js` import elé:

```ts
import { doneLookup, markDone } from './queue/done.js'
```

A `commandScanQueue`-ban a mai

```ts
  const merged = mergeQueue(legacy?.text ?? null, items, layout)
  const text = renumberQueue(merged.text)
```

helyett:

```ts
  const merged = mergeQueue(legacy?.text ?? null, items, layout)
  // Az állapottárat csak olvassuk, és csak ha már van: a scan nem hoz létre
  // állapottárat. Nélküle a „kész" forrása a lemezen lévő jegyzet.
  const store = existsSync(cfg.statePath) ? openState(cfg.statePath) : null
  let done: ReturnType<typeof markDone>
  try {
    done = markDone(
      merged.text,
      doneLookup({
        items: new Map(items.map((item) => [item.itemId, item] as const)),
        registry,
        notesRoot: cfg.notesRoot,
        artifactOf: (itemId, kind) => store?.artifactOf(itemId, kind) ?? null,
        exists: existsSync,
      }),
    )
  } finally {
    store?.close()
  }
  const text = renumberQueue(done.text)
```

A `removedTranslationLines` kiírása után, a `if (flags.dryRun)` elé:

```ts
  if (done.marked > 0) {
    console.log(
      `${String(done.marked)} sor késznek jelölve (állapottár vagy meglévő jegyzet alapján).`,
    )
  }
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy zöld**

Run: `pnpm vitest run src/cli.test.ts -t "bepipálása"`
Expected: PASS, 4 teszt.

- [ ] **Step 5: Mutációs ellenőrzés** (bukjon, majd állítsd vissza)

1. A `existsSync(cfg.statePath) ? openState(cfg.statePath) : null` helyett
   feltétel nélkül `openState(cfg.statePath)` → az `állapottár nélkül…` eset
   bukik.
2. A `const text = renumberQueue(done.text)` helyett `merged.text` → az első
   két eset bukik (a `--dry-run` eset a számot a `done.marked`-ból írja, az
   zöld marad).

- [ ] **Step 6: Teljes ellenőrzés**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: mind zöld; 86 tesztfájl, 965 teszt.

- [ ] **Step 7: Commit** (a `commit-message` skillel)

```bash
git add src/cli.ts src/cli.test.ts
```

Javasolt üzenet: `feat(queue): a scan bepipálja a kész párokat`, lábléc
`Refs #63`.

---

## Task 5: Dokumentáció

**Files:**
- Modify: `README.md` (a feldolgozási sor bekezdései, ~133–154. sor)
- Modify: `docs/architecture.md` (Ütközésvédelem, ~180–191. sor; a sor
  leírása, ~371–377. sor)

**Interfaces:** —

- [ ] **Step 1: README — a `run --queue` bekezdés**

A mai

```markdown
A `run --queue` a kipipált (videó, recept) párokat dolgozza fel —
egyetlen közös becsléssel és költségplafonnal —, és az eredményt pontszámmal,
költséggel és a jegyzet linkjével ugyanazokba a sorokba írja vissza. A
pipákhoz és a saját sorokhoz nem nyúl, a sorszámokat minden scan újraírja, a
jegyzetet atomian írja, és ha nincs mit feldolgozni, nulla modellhívással,
commit nélkül fut le. A korábbi, lapos formátumú sort az első `scan --queue`
egyszer átalakítja, a pipákkal együtt.
```

helyett:

```markdown
A `run --queue` a kipipált (videó, recept) párokat dolgozza fel —
egyetlen közös becsléssel és költségplafonnal —, és az eredményt pontszámmal,
költséggel és a jegyzet linkjével ugyanazokba a sorokba írja vissza. A
sorszámokat minden scan újraírja, a jegyzetet atomian írja, és ha nincs mit
feldolgozni, nulla modellhívással, commit nélkül fut le. A korábbi, lapos
formátumú sort az első `scan --queue` egyszer átalakítja, a pipákkal együtt.

A scan a már kész párokat is bepipálja, akkor is, ha a jegyzet a soron kívül
(`run --recipe`) készült: az állapottár szerinti eredménnyel, vagy ha csak a
jegyzetfájl van meg, `✓ már a vaultban` utótaggal. A meglévő `✓` utótaghoz
nem nyúl, pipát nem vesz le, és a saját sorokat érintetlenül hagyja. A futás a
modellhívás előtt megnézi, létezik-e már a jegyzet; ha igen, késznek veszi, és
nem fizet érte (`--force` nélkül).
```

- [ ] **Step 2: architecture.md — Ütközésvédelem**

A mai

```markdown
Írás csak akkor, ha a célfájl nem létezik. Felülírás kizárólag explicit
`--force`-szal. A vaultban évek kézi munkája van; a pipeline nem írhatja felül.
```

helyett:

```markdown
Írás csak akkor, ha a célfájl nem létezik. Felülírás kizárólag explicit
`--force`-szal. A vaultban évek kézi munkája van; a pipeline nem írhatja felül.
A létezést a futás már a modellhívás **előtt** megnézi: a meglévő jegyzet
`done`-ként rögzül, és nem kerül pénzbe. A hívás utáni write-once ellenőrzés
biztonsági hálóként megmarad.
```

A következő bekezdésben a mai

```markdown
Csak a saját részeit írja — új videóblokk, a fejlécek sorszáma, a videófejléc
jelölése, a recept- és fordítássor állapota, és a célnyelvű videó
fordítássorainak törlése —, a pipákhoz és a saját sorokhoz (a törölt
fordítássor kivételével) soha nem nyúl. És **atomian** ír,
```

helyett:

```markdown
Csak a saját részeit írja — új videóblokk, a fejlécek sorszáma, a videófejléc
jelölése, a recept- és fordítássor állapota, a kész pár pipája, és a
célnyelvű videó fordítássorainak törlése —, a saját sorokhoz soha nem nyúl,
pipát pedig csak bekapcsol: kész párnál, soha nem veszi le. És **atomian** ír,
```

- [ ] **Step 3: architecture.md — a sor leírása**

A mai

```markdown
  forrásreceptje alatt. A `scan --queue` fésüli bele a felderített
  elemeket, a `run --queue` a kipipált (videó, recept) párokat dolgozza fel,
  és az eredményt ugyanazokba a sorokba írja vissza. A receptválasztás így
```

helyett:

```markdown
  forrásreceptje alatt. A `scan --queue` fésüli bele a felderített
  elemeket, és bepipálja a már kész párokat (`migrateLegacy` → `mergeQueue` →
  `markDone` → `renumberQueue`); a „kész" forrása az állapottár `done`
  rekordja, vagy ha az nincs, a lemezen lévő jegyzet. A `run --queue` a
  kipipált (videó, recept) párokat dolgozza fel, és az eredményt ugyanazokba
  a sorokba írja vissza. A receptválasztás így
```

- [ ] **Step 4: Ellenőrzés**

Run: `pnpm lint`
Expected: zöld. Olvasd újra a három módosított bekezdést a környezetükben:
a mondatok folytonosak, és egyik sem állítja, hogy a pipeline a pipákhoz nem
nyúl.

- [ ] **Step 5: Commit** (a `commit-message` skillel)

```bash
git add README.md docs/architecture.md
```

Javasolt üzenet: `docs: a kész párok bepipálása és a futásvédelem`, lábléc
`Refs #63`.

---

## Task 6: Valódi adat — az élő sor másolatán

**Files:** nincs repóbeli változás. Minden a munkamenet scratchpad
könyvtárában (`$S`) készül; a vaultba **nem** írunk.

- [ ] **Step 1: A mérőszkript**

`$S/scan-copy.mts` — ugyanaz a lánc, mint a `commandScanQueue`-ban, de a
bemenet és a kimenet egy-egy megadott fájl. A `REPO` környezeti változó a
repó abszolút útja (a `feat/jegyzetek-bepipalasa` ágon); a `CONFIG`
elhagyható, alapból a `$REPO/refinery.config.yaml`:

```ts
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const REPO = process.env.REPO!
const src = (path: string) => import(`${REPO}/src/${path}`)
const { loadConfig, readConfigFile } = await src('config.js')
const { normalizeItem } = await src('pipeline.js')
const { doneLookup, markDone } = await src('queue/done.js')
const { readQueueFile } = await src('queue/file.js')
const { queueLayout } = await src('queue/layout.js')
const { migrateLegacy } = await src('queue/legacy.js')
const { mergeQueue } = await src('queue/merge.js')
const { renumberQueue } = await src('queue/renumber.js')
const { recipesFor } = await src('recipe/registry.js')
const { discoverAll } = await src('source/folder.js')
const { openState } = await src('state/db.js')

const [inPath, outPath] = process.argv.slice(2)
// A konfig a repó gyökerében van, és nincs verziókezelve; a relatív
// állapottár-út hozzá képest értendő.
const cfgPath = process.env.CONFIG ?? `${REPO}/refinery.config.yaml`
const cfg = loadConfig(await readConfigFile(cfgPath), cfgPath, dirname(cfgPath))
const registry = recipesFor(cfg)
const layout = queueLayout(registry)
const items = await Promise.all(
  (await discoverAll(cfg.sources, cfg.languages)).map(async (item: { language: string | null }) => {
    if (item.language !== null) return item
    const copy = { ...item }
    try {
      await normalizeItem(copy)
    } catch {
      // A nyelv null marad, mint a scanben.
    }
    return copy
  }),
)
const current = await readQueueFile(inPath!)
const legacy = current === null ? null : migrateLegacy(current, layout)
const merged = mergeQueue(legacy?.text ?? null, items, layout)
const store = existsSync(cfg.statePath) ? openState(cfg.statePath) : null
const done = markDone(
  merged.text,
  doneLookup({
    items: new Map(items.map((item: { itemId: string }) => [item.itemId, item] as const)),
    registry,
    notesRoot: cfg.notesRoot,
    artifactOf: (itemId: string, kind: string) => store?.artifactOf(itemId, kind) ?? null,
    exists: existsSync,
  }),
)
store?.close()
await writeFile(outPath!, renumberQueue(done.text))
console.log('marked', done.marked, 'merge', merged.stats)
```

(A `withContentLanguage` a `cli.ts`-ben nincs exportálva; a szkript ugyanazt
a néhány sort ismétli.)

- [ ] **Step 2: Futtatás két körben**

```bash
cp <vault>/Inbox/transcript-refinery/_queue.md $S/queue-live.md
REPO=$PWD npx tsx $S/scan-copy.mts $S/queue-live.md $S/queue-1.md
REPO=$PWD npx tsx $S/scan-copy.mts $S/queue-1.md $S/queue-2.md
cmp $S/queue-1.md $S/queue-2.md && echo IDEMPOTENS
diff $S/queue-live.md $S/queue-1.md | grep -c '^>'
```

Expected — a mérés a spec szerinti állapotra; ha a sor vagy az állapottár
azóta változott (új futás), előbb a spec mérőszámait kell frissíteni:

- első kör: `marked 12`, a `merge` minden számlálója 0;
- második kör: `marked 0`, és `IDEMPOTENS`;
- a `diff` pontosan 12 sort cserél: 10 üres sor `[x]`-et és
  `✓ <pont> · $<költség> · [jegyzet](<…>)`-t kap, az `FPg1oNlifJk` `summary`
  és `qa` sora csak `[x]`-et;
- a `wjZofJX0v4M` `summary` linkje a `transcripts/pinchflat-minta/…` útra
  mutat, és a fájl ott megvan.

- [ ] **Step 3: Az eredmény a PR leírásába**

A számokat és a `diff` összegzését a kód-PR leírásába írd. A vault
`_queue.md`-jét a felhasználó a saját `scan --queue`-jával frissíti a merge
után.

---

## Önellenőrzés

- **Spec-lefedés:** 1. szakasz → Task 1; 2–3. → Task 2; 4. → Task 3; 5. →
  Task 4; 6. (a `run` konzolja változatlan) → a Task 3 eseményteszt; a
  sikerkritériumok 1–2. → Task 6, 3–4. → Task 4 és Task 3, 5. (webes
  áttekintő) → a `queueOverview` a `done` rekordot számolja, a 12 pár mind
  rekordos, és a Task 6 után mind `[x]`; 6. → minden task végén.
- **Dokumentáció:** Task 5.
- **Kimaradt, szándékosan:** lásd a spec utolsó szakaszát.
