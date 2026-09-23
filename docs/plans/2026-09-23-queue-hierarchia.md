# Terv — Hierarchikus feldolgozási sor

> **A végrehajtónak:** ez a terv lépésről lépésre hajtható végre
> (`superpowers:executing-plans`). Minden lépés egy művelet, checkbox jelöli.
> A spec és a terv együtt olvasandó.

**Cél:** A `_queue.md` számozott H2 csoport- és H3 videófejlécet kap, a
fordítások a forrásreceptjük alá kerülnek behúzott nyelvi al-sorként, és a
célnyelvű videó alatt nincs fordítássor.

**Megközelítés:** Soronkénti szerkesztés, három tiszta lépés a scanben:
`migrateLegacy` (régi formátum → új, egyszer) → `mergeQueue` (új elemek,
hiányzó sorok, nyelvi szabály) → `renumberQueue` (a `N. ` előtag). A sorfajtákat
a `line.ts` ismeri, a szerkezetet a `parse.ts` építi; a fordítás a
`checkedPairs`-ban `<recept>-<nyelv>` párrá oldódik fel, így a futtató és a
felület változatlan.

**Eszközök:** TypeScript (ESM, `.js` importvégződéssel), vitest. Nulla új
függőség.

**Spec:** [`2026-09-23-queue-hierarchia-spec.md`](<./2026-09-23-queue-hierarchia-spec.md>)
· **Issue:** #58

## Globális megkötések

- Magyar dokumentáció, kódkomment, teszt-leírás, felhasználói kimenet és
  commit-üzenet; **angol** produkciós azonosító.
- **Nulla új függőség.** Az állapottár sémája nem változik.
- Nincs modellhívás ebben a szeletben: minden teszt offline fut.
- A pipák, az utótagok, a saját sorok és a kézi sorrend **bájtra
  érintetlenek**. Kivétel csak: a `N. ` sorszám-előtag (újraszámozás), a
  célnyelvű videó fordítássorainak törlése, és a régi formátum egyszeri
  átalakítása.
- Ág: `feat/queue-hierarchia` a friss `main`-ről, **miután a spec + terv
  docs-PR-je bekerült**. Egy PR, `Closes #58`.
- Commit-üzenet a `commit-message` skillel.
- Minden task végén `pnpm test`, `pnpm typecheck` és `pnpm lint` fut, és zöld.

## A terv ellenőrzése

A Task 1–5 kódja és tesztjei a terv írásakor egy eldobható worktree-n, a
tervből szó szerint kivéve lefutottak: `tsc` hibátlan, `eslint src` hibátlan,
84 tesztfájl, 931 teszt zöld. A Task 7 az élő sor másolatán: 28 csoport, 166
videó, 660 `hu` al-sor, mind a 10 pipa és utótag bájtra azonos, a magyar videó
alól 4 fordítássor törlődött, a második scan nem változtatott. A Task 6
(dokumentáció) és a `pnpm web:test` nem futott.

## Review Focus

Amit a spec kimond vagy sugall, és egy felhasználót a legkönnyebben megharap —
mindegyikhez teszt tartozik a megnevezett taskban:

1. **Régi formátumú sorra `run --queue` a scan előtt** — ma csendben nulla pár
   lenne. Elvárt: 1-es kilépőkód és a `scan --queue` javaslata (Task 5).
2. **Kézzel rossz helyre írt fordítássor** — recept előtt vagy videó előtt.
   Elvárt: nem kötődik semmihez, nem lesz belőle pár (Task 4, `parse.test.ts`).
3. **Saját `## Jegyzetek` fejléc az új formátumú sorban** — nem csoport, nem
   számozódik, és nem indít átalakítást (Task 2 és Task 3).
4. **Sorszámmal kezdődő cím** (`### 2. 1. rész: …`) és a `hu`-ra hasonlító, de
   nem fordítás sorok (`  - [ ] hun`, négy szóköz, `  - [ ] HU`) (Task 4,
   `line.test.ts`).
5. **Nyelvi címke változatai** (`hu-HU`, `HU`, `pt_BR`) — a szabály az
   elsődleges altagot kisbetűsítve hasonlítja (Task 1 és Task 4).

## Fájlszerkezet

| fájl | mi történik vele |
|---|---|
| `src/queue/layout.ts` | **új** — `QueueLayout`, `queueLayout`, `translationId`, `splitTranslationId`, `primaryLanguage` |
| `src/queue/layout.test.ts` | **új** |
| `src/queue/renumber.ts` | **új** — `renumberQueue` |
| `src/queue/renumber.test.ts` | **új** |
| `src/queue/legacy.ts` | **új** — `isLegacyQueue`, `migrateLegacy` |
| `src/queue/legacy.test.ts` | **új** |
| `src/queue/line.ts` | öt sorfajta; `headingLine`, `translationLine` új; `videoLine`, `recipeLine` új formátum |
| `src/queue/parse.ts` | `QueueTranslation`; a fordítás a recepthez kötődik; `checkedPairs` `<recept>-<nyelv>` |
| `src/queue/status.ts` | `applyStatuses` a fordítássorokra is ír |
| `src/queue/merge.ts` | `QueueLayout` paraméter, fordítássorok, nyelvi szabály, `removedTranslationLines` |
| `src/queue/{line,parse,status,merge}.test.ts` | új formátumra |
| `src/cli.ts` | scan: layout + átalakítás + újraszámozás + nyelv a tartalomból; run: régi formátum őre |
| `src/cli.test.ts`, `src/e2e.test.ts`, `src/view/overview.test.ts`, `web/test/e2e/fixture.ts` | új formátumú sorliterálok |
| `README.md`, `docs/architecture.md` | a sor leírása |

---

## Task 1: Sorelrendezés és nyelvi segédek — `layout.ts`

**Files:**
- Create: `src/queue/layout.ts`
- Test: `src/queue/layout.test.ts`

**Interfaces:**
- Consumes: `Registry` (`src/recipe/registry.ts`), `LanguageTag` (`src/lang/identify.ts`).
- Produces:
  - `interface QueueLayout { recipes: readonly string[]; translations: ReadonlyMap<string, LanguageTag> }`
  - `queueLayout(registry: Registry): QueueLayout`
  - `translationId(source: string, lang: string): string`
  - `splitTranslationId(layout: QueueLayout, id: string): { source: string; lang: LanguageTag } | null`
  - `primaryLanguage(tag: string | null): string | null`

- [ ] **Step 1: A bukó teszt**

`src/queue/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import { primaryLanguage, queueLayout, splitTranslationId, translationId } from './layout.js'

const FORDITASSAL = queueLayout(
  recipesFor({ translate: { to: 'hu', recipes: ['clean', 'summary'] }, configPath: '/p/c.yaml' }),
)

describe('queueLayout', () => {
  it('az alapreceptek a regiszter sorrendjében, a fordítások forrás → célnyelv párként', () => {
    expect(FORDITASSAL.recipes).toEqual(['summary', 'flashcards', 'qa', 'clean', 'bloom', 'notes'])
    expect([...FORDITASSAL.translations]).toEqual([
      ['clean', 'hu'],
      ['summary', 'hu'],
    ])
  })

  it('translate kulcs nélkül nincs fordítás', () => {
    const alap = queueLayout(recipesFor({ translate: null, configPath: '/p/c.yaml' }))
    expect(alap.translations.size).toBe(0)
    expect(alap.recipes).toHaveLength(6)
  })
})

describe('translationId és splitTranslationId', () => {
  it('a fordítórecept azonosítója kötőjellel áll össze, és visszabontható', () => {
    expect(translationId('summary', 'hu')).toBe('summary-hu')
    expect(splitTranslationId(FORDITASSAL, 'summary-hu')).toEqual({ source: 'summary', lang: 'hu' })
  })

  it('csak a layoutban szereplő fordítást bontja; alaprecept és ismeretlen fordítás null', () => {
    expect(splitTranslationId(FORDITASSAL, 'qa-hu')).toBeNull()
    expect(splitTranslationId(FORDITASSAL, 'summary')).toBeNull()
    expect(splitTranslationId(FORDITASSAL, 'nincsilyen')).toBeNull()
  })
})

describe('primaryLanguage', () => {
  it('az elsődleges altag kisbetűsítve', () => {
    expect(primaryLanguage('hu')).toBe('hu')
    expect(primaryLanguage('hu-HU')).toBe('hu')
    expect(primaryLanguage('EN')).toBe('en')
    expect(primaryLanguage('pt_BR')).toBe('pt')
  })

  it('hiányzó vagy üres címkére null', () => {
    expect(primaryLanguage(null)).toBeNull()
    expect(primaryLanguage('')).toBeNull()
  })
})
```

- [ ] **Step 2: Futtasd, bukjon el**

Run: `pnpm vitest run src/queue/layout.test.ts`
Expected: FAIL — `Failed to resolve import "./layout.js"`.

- [ ] **Step 3: A megvalósítás**

`src/queue/layout.ts`:

```ts
import type { LanguageTag } from '../lang/identify.js'
import type { Registry } from '../recipe/registry.js'

/** Mi kerül egy videó alá: az alapreceptek, és melyik alá milyen nyelvű fordítás. */
export interface QueueLayout {
  /** Az alaprecept-azonosítók, a regiszter sorrendjében. */
  recipes: readonly string[]
  /** Forrásrecept → célnyelv, pl. `clean` → `hu`. */
  translations: ReadonlyMap<string, LanguageTag>
}

/** A sor elrendezése a regiszterből: alaprecept az, aminek nincs `translation` mezője. */
export function queueLayout(registry: Registry): QueueLayout {
  const recipes: string[] = []
  const translations = new Map<string, LanguageTag>()
  for (const recipe of Object.values(registry)) {
    if (recipe.translation) translations.set(recipe.translation.source.id, recipe.translation.target)
    else recipes.push(recipe.id)
  }
  return { recipes, translations }
}

/** A fordítórecept azonosítója: `summary` + `hu` → `summary-hu`. */
export function translationId(source: string, lang: string): string {
  return `${source}-${lang}`
}

/** Egy fordítórecept azonosítójának forrása és nyelve — csak a layoutban szereplőre. */
export function splitTranslationId(
  layout: QueueLayout,
  id: string,
): { source: string; lang: LanguageTag } | null {
  for (const [source, lang] of layout.translations) {
    if (translationId(source, lang) === id) return { source, lang }
  }
  return null
}

/** A nyelvi címke elsődleges altagja kisbetűvel: `hu-HU` → `hu`. Üres címkére `null`. */
export function primaryLanguage(tag: string | null): string | null {
  if (tag === null) return null
  const primary = tag.toLowerCase().split(/[-_]/)[0]!
  return primary === '' ? null : primary
}
```

- [ ] **Step 4: Futtasd, legyen zöld**

Run: `pnpm vitest run src/queue/layout.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, 6 teszt; typecheck és lint hibátlan.

- [ ] **Step 5: Commit** (`commit-message` skill)

```bash
git add src/queue/layout.ts src/queue/layout.test.ts
```

Javasolt üzenet: `feat(queue): a sor elrendezése a regiszterből`, `Refs #58`.

---

## Task 2: Újraszámozás — `renumber.ts`

**Files:**
- Create: `src/queue/renumber.ts`
- Test: `src/queue/renumber.test.ts`

**Interfaces:**
- Consumes: semmi.
- Produces: `renumberQueue(text: string): string`

A minták szándékosan ugyanazok, mint a Task 4 `classifyLine`-jában: csoport
`^## \d+\. .+$`, videó `^### \d+\. .*? %%.+?%%`. Ami ezekre nem illik — saját
`## ` fejléc, horgony nélküli `### ` —, azt nem számozza, és a számlálót sem
nullázza.

- [ ] **Step 1: A bukó teszt**

`src/queue/renumber.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renumberQueue } from './renumber.js'

const SOR = [
  '# Feldolgozási sor',
  '',
  '### 7. Árva videó %%z%%',
  '## 3. forras/a',
  '### 5. Első példavideó %%a%%',
  '- [x] summary — ✓ 0.97',
  '  - [ ] hu',
  '### 5. 1. rész: bevezető %%b%%',
  '### 9. Horgony nélküli saját fejléc',
  '## Saját jegyzetek',
  'Szabad szöveg.',
  '## 0. forras/b',
  '### 0. Harmadik példavideó %%c%%',
  '',
].join('\n')

describe('renumberQueue', () => {
  it('a csoportok végig, a videók csoportonként 1-től; csak az előtag változik', () => {
    expect(renumberQueue(SOR)).toBe(
      [
        '# Feldolgozási sor',
        '',
        '### 1. Árva videó %%z%%',
        '## 1. forras/a',
        '### 1. Első példavideó %%a%%',
        '- [x] summary — ✓ 0.97',
        '  - [ ] hu',
        '### 2. 1. rész: bevezető %%b%%',
        '### 9. Horgony nélküli saját fejléc',
        '## Saját jegyzetek',
        'Szabad szöveg.',
        '## 2. forras/b',
        '### 1. Harmadik példavideó %%c%%',
        '',
      ].join('\n'),
    )
  })

  it('idempotens', () => {
    const egyszer = renumberQueue(SOR)
    expect(renumberQueue(egyszer)).toBe(egyszer)
  })

  it('számozott sor nélküli szövegre bájtra azonos', () => {
    const szoveg = '# Feldolgozási sor\n\n## Saját\n- sima listaelem\n'
    expect(renumberQueue(szoveg)).toBe(szoveg)
  })
})
```

- [ ] **Step 2: Futtasd, bukjon el**

Run: `pnpm vitest run src/queue/renumber.test.ts`
Expected: FAIL — `Failed to resolve import "./renumber.js"`.

- [ ] **Step 3: A megvalósítás**

`src/queue/renumber.ts`:

```ts
/** A csoportfejléc sorszám-előtagja; a kulcs nem lehet üres. */
const GROUP = /^## \d+\. (?=.)/
/** A videófejléc sorszám-előtagja; csak horgonnyal együtt videó. */
const VIDEO = /^### \d+\. (?=.*? %%.+?%%)/

/**
 * A `N. ` előtag újraírása: a csoportok a jegyzeten végig, a videók
 * csoportonként 1-től. A sorszám a pipeline-é, mint az utótag; a fejléc többi
 * része és minden más sor bájtra érintetlen. Idempotens.
 */
export function renumberQueue(text: string): string {
  let group = 0
  let video = 0
  return text
    .split('\n')
    .map((line) => {
      if (GROUP.test(line)) {
        group++
        video = 0
        return line.replace(GROUP, `## ${String(group)}. `)
      }
      if (VIDEO.test(line)) {
        video++
        return line.replace(VIDEO, `### ${String(video)}. `)
      }
      return line
    })
    .join('\n')
}
```

- [ ] **Step 4: Futtasd, legyen zöld**

Run: `pnpm vitest run src/queue/renumber.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, 3 teszt.

- [ ] **Step 5: Commit** (`commit-message` skill)

```bash
git add src/queue/renumber.ts src/queue/renumber.test.ts
```

Javasolt üzenet: `feat(queue): a csoport- és videófejlécek újraszámozása`, `Refs #58`.

---

## Task 3: A régi formátum átalakítása — `legacy.ts`

**Files:**
- Create: `src/queue/legacy.ts`
- Test: `src/queue/legacy.test.ts`

**Interfaces:**
- Consumes: `QueueLayout`, `splitTranslationId` (Task 1).
- Produces:
  - `isLegacyQueue(text: string): boolean`
  - `migrateLegacy(text: string, layout: QueueLayout): { text: string; migrated: boolean }`

**Mi számít régi formátumnak:** van benne régi videósor (`- … %%id%%`, de nem
pipás sor), **vagy** nincs benne egyetlen számozott csoport- és videófejléc
sem, de van számozatlan `## ` fejléc (üres csoportok). Egy új formátumú sor
saját `## Jegyzetek` fejléce így nem indít átalakítást.

**Mit csinál:** a régi dokumentumban minden `## kulcs` → `## 0. kulcs`; minden
régi videósor → `### 0. ` + a sor a `- ` után; a videóblokkon belül a behúzott
receptsor behúzás nélkül marad meg, a layout szerinti fordítás (`clean-hu`) a
forrásreceptje alá kerül `  - [p] hu`-ként. Ha a forrásrecept sora hiányzik a
blokkból, az utolsó receptsor után `- [ ] <forrás>` szülősor keletkezik. Az első
videó előtti sorok és minden egyéb sor változatlan.

- [ ] **Step 1: A bukó teszt**

`src/queue/legacy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { recipesFor } from '../recipe/registry.js'
import { queueLayout } from './layout.js'
import { isLegacyQueue, migrateLegacy } from './legacy.js'

const LAYOUT = queueLayout(
  recipesFor({ translate: { to: 'hu', recipes: ['clean', 'summary'] }, configPath: '/p/c.yaml' }),
)

const REGI = [
  '# Feldolgozási sor',
  '',
  '  - [x] summary',
  '## forras/a',
  '- Első példavideó %%a%%',
  '  - [ ] summary',
  '  - [x] clean — ✓ 0.95 · $0.5328 · [jegyzet](<forras/a/Elso_clean.md>)',
  '\t- [X] qa',
  'Saját megjegyzés.',
  '  - [ ] clean-hu',
  '  - [x] summary-hu — ✓ 0.90 · $0.0100',
  '  - [ ] notes-hu',
  '',
  '## forras/b',
  '- Második példavideó %%b%% — ⚠ a felirat nem található',
  '  - [ ] nincsilyen',
  '  - [x] summary-hu — ⏸ előbb a summary recept kell',
  '',
].join('\n')

const UJ = [
  '# Feldolgozási sor',
  '',
  '  - [x] summary',
  '## 0. forras/a',
  '### 0. Első példavideó %%a%%',
  '- [ ] summary',
  '  - [x] hu — ✓ 0.90 · $0.0100',
  '- [x] clean — ✓ 0.95 · $0.5328 · [jegyzet](<forras/a/Elso_clean.md>)',
  '  - [ ] hu',
  '- [X] qa',
  'Saját megjegyzés.',
  '- [ ] notes-hu',
  '',
  '## 0. forras/b',
  '### 0. Második példavideó %%b%% — ⚠ a felirat nem található',
  '- [ ] nincsilyen',
  '- [ ] summary',
  '  - [x] hu — ⏸ előbb a summary recept kell',
  '',
].join('\n')

describe('isLegacyQueue', () => {
  it('a régi videósor régi formátumot jelez', () => {
    expect(isLegacyQueue(REGI)).toBe(true)
  })

  it('az új formátum — saját számozatlan fejléccel is — nem régi', () => {
    expect(isLegacyQueue(UJ)).toBe(false)
    expect(isLegacyQueue('## 1. forras/a\n### 1. Első %%a%%\n- [ ] summary\n\n## Jegyzetek\n')).toBe(
      false,
    )
  })

  it('csak számozatlan fejlécek, videó nélkül: régi', () => {
    expect(isLegacyQueue('# Feldolgozási sor\n\n## forras/a\n\n## forras/b\n')).toBe(true)
  })

  it('a pipás sor nem videósor, és a fej magában nem régi', () => {
    expect(isLegacyQueue('- [x] summary — %%nem horgony%%\n')).toBe(false)
    expect(isLegacyQueue('# Feldolgozási sor\n\nPipáld ki…\n')).toBe(false)
  })
})

describe('migrateLegacy', () => {
  it('átalakít: pipa és utótag megmarad, a fordítás a forrása alá kerül, a hiányzó forrás szülősort kap', () => {
    expect(migrateLegacy(REGI, LAYOUT)).toEqual({ text: UJ, migrated: true })
  })

  it('új formátumra bájtra azonos, és nem jelez átalakítást', () => {
    expect(migrateLegacy(UJ, LAYOUT)).toEqual({ text: UJ, migrated: false })
  })

  it('kétszer alkalmazva ugyanaz', () => {
    const egyszer = migrateLegacy(REGI, LAYOUT).text
    expect(migrateLegacy(egyszer, LAYOUT).text).toBe(egyszer)
  })
})
```

- [ ] **Step 2: Futtasd, bukjon el**

Run: `pnpm vitest run src/queue/legacy.test.ts`
Expected: FAIL — `Failed to resolve import "./legacy.js"`.

- [ ] **Step 3: A megvalósítás**

`src/queue/legacy.ts`:

```ts
import { splitTranslationId, type QueueLayout } from './layout.js'

/**
 * A régi, lapos formátum felismerése és egyszeri átalakítása. Ha már nincs
 * régi formátumú sor, ez a modul törölhető.
 */

/** Számozatlan csoportfejléc: a régi formátumé. */
const OLD_HEADING = /^## (?!\d+\. )(.+)$/
const NEW_HEADING = /^## \d+\. .+$/
const NEW_VIDEO = /^### \d+\. .*? %%.+?%%/
/** A régi videósor: listaelem horgonnyal, de nem pipás sor. */
const OLD_VIDEO = /^- (?!\[[ xX]\] ).*? %%.+?%%/
/** A régi receptsor: szóközzel vagy tabbal behúzott pipás sor. */
const OLD_RECIPE = /^[ \t]+- \[([ xX])\] ([A-Za-z0-9_-]+)(.*)$/

interface RecipeEntry {
  kind: 'recipe'
  line: string
  translations: string[]
}
type Entry = RecipeEntry | { kind: 'other'; line: string }

/** Régi formátumú-e a sor: van régi videósora, vagy csak számozatlan fejlécei vannak. */
export function isLegacyQueue(text: string): boolean {
  const lines = text.split('\n')
  if (lines.some((line) => OLD_VIDEO.test(line))) return true
  const numbered = lines.some((line) => NEW_HEADING.test(line) || NEW_VIDEO.test(line))
  return !numbered && lines.some((line) => OLD_HEADING.test(line))
}

/** Egy régi videóblokk sorai az új formátumban. */
function convertBlock(block: readonly string[], layout: QueueLayout): string[] {
  const entries: Entry[] = []
  const bySource = new Map<string, RecipeEntry>()
  const orphans: { source: string; line: string }[] = []

  for (const raw of block) {
    const match = OLD_RECIPE.exec(raw)
    if (!match) {
      entries.push({ kind: 'other', line: raw })
      continue
    }
    const mark = match[1]!
    const id = match[2]!
    const rest = match[3]!
    const translation = splitTranslationId(layout, id)
    if (translation) {
      orphans.push({ source: translation.source, line: `  - [${mark}] ${translation.lang}${rest}` })
      continue
    }
    const entry: RecipeEntry = { kind: 'recipe', line: `- [${mark}] ${id}${rest}`, translations: [] }
    entries.push(entry)
    if (!bySource.has(id)) bySource.set(id, entry)
  }

  for (const orphan of orphans) {
    let parent = bySource.get(orphan.source)
    if (!parent) {
      parent = { kind: 'recipe', line: `- [ ] ${orphan.source}`, translations: [] }
      entries.splice(entries.findLastIndex((entry) => entry.kind === 'recipe') + 1, 0, parent)
      bySource.set(orphan.source, parent)
    }
    parent.translations.push(orphan.line)
  }

  return entries.flatMap((entry) =>
    entry.kind === 'recipe' ? [entry.line, ...entry.translations] : [entry.line],
  )
}

/**
 * A régi formátum átírása az újra, a pipák és az utótagok megtartásával. A
 * sorszámok `0`-k: a `renumberQueue` írja be őket. Új formátumú szövegre
 * bájtra azonos, `migrated: false`.
 */
export function migrateLegacy(
  text: string,
  layout: QueueLayout,
): { text: string; migrated: boolean } {
  if (!isLegacyQueue(text)) return { text, migrated: false }

  const out: string[] = []
  let block: string[] | undefined
  for (const line of text.split('\n')) {
    const heading = OLD_HEADING.exec(line)
    if (heading || OLD_VIDEO.test(line)) {
      if (block) out.push(...convertBlock(block, layout))
      block = undefined
    }
    if (heading) {
      out.push(`## 0. ${heading[1]!}`)
    } else if (OLD_VIDEO.test(line)) {
      out.push(`### 0. ${line.slice(2)}`)
      block = []
    } else if (block) {
      block.push(line)
    } else {
      out.push(line)
    }
  }
  if (block) out.push(...convertBlock(block, layout))

  return { text: out.join('\n'), migrated: true }
}
```

- [ ] **Step 4: Futtasd, legyen zöld**

Run: `pnpm vitest run src/queue/legacy.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, 7 teszt.

- [ ] **Step 5: Commit** (`commit-message` skill)

```bash
git add src/queue/legacy.ts src/queue/legacy.test.ts
```

Javasolt üzenet: `feat(queue): a régi sorformátum egyszeri átalakítása`, `Refs #58`.

---

## Task 4: Az új formátum — sorfajták, elemző, visszaírás, összefésülés, scan

Ez a task váltja át a formátumot. Mivel a scan és a futtató tesztjei a
formátumra épülnek, egy taskban kell zöldre hozni az egészet; a lépések
modulonként haladnak, a teljes suite a 11. lépésben zöld.

**Files:**
- Modify: `src/queue/line.ts`, `src/queue/parse.ts`, `src/queue/status.ts`, `src/queue/merge.ts`, `src/cli.ts` (`commandScanQueue`)
- Test: `src/queue/line.test.ts`, `src/queue/parse.test.ts`, `src/queue/status.test.ts`, `src/queue/merge.test.ts`, `src/cli.test.ts`, `src/e2e.test.ts`, `src/view/overview.test.ts`, `web/test/e2e/fixture.ts`

**Interfaces:**
- Consumes: Task 1 (`QueueLayout`, `queueLayout`, `translationId`, `primaryLanguage`), Task 2 (`renumberQueue`), Task 3 (`migrateLegacy`).
- Produces:
  - `QueueLine` új ága: `{ kind: 'translation'; lang: string; checked: boolean; head: string; suffix: string }`
  - `headingLine(key: string): string`, `videoLine(item: SourceItem): string`, `recipeLine(id: string): string`, `translationLine(lang: string): string`
  - `QueueTranslation { line: number; lang: string; checked: boolean; head: string; suffix: string }`, `QueueRecipe.translations: QueueTranslation[]`
  - `mergeQueue(current: string | null, items: readonly SourceItem[], layout: QueueLayout): { text: string; stats: MergeStats }`
  - `MergeStats { addedVideos; addedRecipeLines; removedTranslationLines; changedMarks }`

Eltérés a spec 1. szakaszától: a generálók nem kapnak sorszámot, mindig `0`-t
írnak (`## 0. …`, `### 0. …`) — a sorszámot kizárólag a `renumberQueue` adja.

### 4.1 Sorfajták — `line.ts`

- [ ] **Step 1: A bukó teszt** — a `src/queue/line.test.ts` `classifyLine` és
  `videoLine, recipeLine, withSuffix` blokkja helyére (a `cleanTitle` és a
  `groupKey` blokk marad):

```ts
describe('classifyLine', () => {
  it('a számozott csoportfejlécből a sorszám nélküli kulcsot veszi', () => {
    expect(classifyLine('## 1. feliratok/csatorna-a')).toEqual({
      kind: 'heading',
      key: 'feliratok/csatorna-a',
    })
    expect(classifyLine('## 12. x')).toEqual({ kind: 'heading', key: 'x' })
  })

  it('a videófejlécből az azonosítót, a sorszámmal együtti fejet és az utótagot veszi', () => {
    expect(classifyLine('### 3. Első — második rész %%abcDEF12345%% — ⚠ duplikátum')).toEqual({
      kind: 'video',
      itemId: 'abcDEF12345',
      head: '### 3. Első — második rész %%abcDEF12345%%',
      suffix: ' — ⚠ duplikátum',
    })
  })

  it('sorszámmal kezdődő cím is videó', () => {
    expect(classifyLine('### 2. 1. rész: bevezető %%x1%%')).toMatchObject({
      kind: 'video',
      itemId: 'x1',
      head: '### 2. 1. rész: bevezető %%x1%%',
    })
  })

  it('a behúzás nélküli receptsort kis és nagy x-szel is felismeri', () => {
    expect(classifyLine('- [x] summary — ✓ 0.97')).toEqual({
      kind: 'recipe',
      recipeId: 'summary',
      checked: true,
      head: '- [x] summary',
      suffix: ' — ✓ 0.97',
    })
    expect(classifyLine('- [X] qa')).toMatchObject({ kind: 'recipe', recipeId: 'qa', checked: true })
    expect(classifyLine('- [ ] flashcards')).toMatchObject({ kind: 'recipe', checked: false })
  })

  it('a pontosan két szóközzel behúzott kétbetűs nyelvkód fordítássor', () => {
    expect(classifyLine('  - [x] hu — ✓ 0.90')).toEqual({
      kind: 'translation',
      lang: 'hu',
      checked: true,
      head: '  - [x] hu',
      suffix: ' — ✓ 0.90',
    })
    expect(classifyLine('  - [ ] en')).toMatchObject({ kind: 'translation', lang: 'en', checked: false })
  })

  it('ami csak hasonlít, az saját sor', () => {
    for (const line of [
      '## feliratok/csatorna-a',
      '- Első %%abc%%',
      '  - [x] summary',
      '\t- [x] qa',
      '    - [ ] hu',
      '  - [ ] hun',
      '  - [ ] HU',
      '### 1. Horgony nélkül',
      'Saját megjegyzés.',
      '',
      '# Feldolgozási sor',
    ]) {
      expect(classifyLine(line)).toEqual({ kind: 'other' })
    }
  })
})
```

és a fájl végén:

```ts
describe('sorgenerálók és withSuffix', () => {
  it('a videósor 0-s sorszámmal, a tisztított címmel és az azonosítóval készül, és visszaolvasható', () => {
    const line = videoLine(elem({ title: 'Első\npéldavideó' }))
    expect(line).toBe('### 0. Első példavideó %%abcDEF12345%%')
    expect(classifyLine(line)).toMatchObject({ kind: 'video', itemId: 'abcDEF12345', suffix: '' })
  })

  it('a csoportfejléc 0-s sorszámmal készül, és visszaolvasható', () => {
    expect(headingLine('feliratok/csatorna-a')).toBe('## 0. feliratok/csatorna-a')
    expect(classifyLine(headingLine('feliratok/csatorna-a'))).toEqual({
      kind: 'heading',
      key: 'feliratok/csatorna-a',
    })
  })

  it('a recept- és a fordítássor üres pipával készül', () => {
    expect(recipeLine('summary')).toBe('- [ ] summary')
    expect(translationLine('hu')).toBe('  - [ ] hu')
    expect(classifyLine(translationLine('hu'))).toMatchObject({ kind: 'translation', lang: 'hu' })
  })

  it('az utótag a fej után, elválasztóval kerül; null esetén csak a fej marad', () => {
    expect(withSuffix('- [x] summary', '✓ 0.97')).toBe('- [x] summary — ✓ 0.97')
    expect(withSuffix('- [x] summary', null)).toBe('- [x] summary')
  })
})
```

Az import sor:

```ts
import {
  classifyLine,
  cleanTitle,
  groupKey,
  headingLine,
  recipeLine,
  translationLine,
  videoLine,
  withSuffix,
} from './line.js'
```

- [ ] **Step 2: Futtasd, bukjon el**

Run: `pnpm vitest run src/queue/line.test.ts`
Expected: FAIL — `headingLine`/`translationLine` nincs exportálva, a `classifyLine` a régi mintákat ismeri.

- [ ] **Step 3: A megvalósítás** — a `src/queue/line.ts` `QueueLine` típusa, a
  négy minta, a `classifyLine` és a három generáló helyére:

```ts
export type QueueLine =
  | { kind: 'heading'; key: string }
  | { kind: 'video'; itemId: string; head: string; suffix: string }
  | { kind: 'recipe'; recipeId: string; checked: boolean; head: string; suffix: string }
  | { kind: 'translation'; lang: string; checked: boolean; head: string; suffix: string }
  | { kind: 'other' }

/** Számozott csoportfejléc; a kulcs a sorszám nélküli rész. */
const HEADING = /^## \d+\. (.+)$/
// A cím nem-mohó: az ELSŐ `%%…%%` a horgony. A `cleanTitle` gondoskodik róla,
// hogy a címben ne maradjon `%%`. A fej a sorszámot is viszi: a `withSuffix`
// ebből írja vissza a sort, a sorszámot csak a `renumberQueue` írja át.
const VIDEO = /^(### \d+\. .*? %%(.+?)%%)(.*)$/
/** Receptsor: behúzás nélküli pipás sor a videófejléc alatt. */
const RECIPE = /^(- \[([ xX])\] ([A-Za-z0-9_-]+))(.*)$/
/** Fordítássor: pontosan két szóközzel behúzott, kétbetűs nyelvkódú pipás sor. */
const TRANSLATION = /^( {2}- \[([ xX])\] ([a-z]{2}))(?=$| )(.*)$/

/** Egy sor fajtája. Ami egyik mintára sem illik, az saját sor. */
export function classifyLine(line: string): QueueLine {
  const heading = HEADING.exec(line)
  if (heading) return { kind: 'heading', key: heading[1]! }

  const video = VIDEO.exec(line)
  if (video) {
    return { kind: 'video', itemId: video[2]!, head: video[1]!, suffix: video[3]! }
  }

  const recipe = RECIPE.exec(line)
  if (recipe) {
    return {
      kind: 'recipe',
      recipeId: recipe[3]!,
      checked: recipe[2] !== ' ',
      head: recipe[1]!,
      suffix: recipe[4]!,
    }
  }

  const translation = TRANSLATION.exec(line)
  if (translation) {
    return {
      kind: 'translation',
      lang: translation[3]!,
      checked: translation[2] !== ' ',
      head: translation[1]!,
      suffix: translation[4]!,
    }
  }

  return { kind: 'other' }
}
```

és a generálók (a `cleanTitle`, a `groupKey`, a `withSuffix` és a `SEPARATOR`
változatlan):

```ts
/** A sorszámot a `renumberQueue` adja; a generált sor `0`-val indul. */
export function headingLine(key: string): string {
  return `## 0. ${key}`
}

export function videoLine(item: SourceItem): string {
  return `### 0. ${cleanTitle(item.title, item.itemId)} %%${item.itemId}%%`
}

export function recipeLine(recipeId: string): string {
  return `- [ ] ${recipeId}`
}

export function translationLine(lang: string): string {
  return `  - [ ] ${lang}`
}
```

- [ ] **Step 4: Futtasd**

Run: `pnpm vitest run src/queue/line.test.ts`
Expected: PASS. (A többi queue-teszt most bukik — a következő lépések hozzák rendbe.)

### 4.2 Elemző — `parse.ts`

- [ ] **Step 5: A bukó teszt** — a `src/queue/parse.test.ts` teljes tartalma:

```ts
import { describe, expect, it } from 'vitest'
import { checkedPairs, parseQueue } from './parse.js'

const JEGYZET = [
  '# Feldolgozási sor',
  '',
  '- [x] summary',
  '## 1. feliratok/csatorna-a',
  '### 1. Első példavideó %%abcDEF12345%%',
  '  - [x] hu',
  '- [x] summary — ✓ 0.97 · $0.0512',
  '  - [x] hu — ✓ 0.90 · $0.0100',
  '- [ ] flashcards',
  '- [X] qa',
  'Saját megjegyzés.',
  '  - [ ] hu',
  '### 2. Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található',
  '- [x] summary',
  '',
  '## 2. feliratok/csatorna-b',
  '- [x] qa',
  '### 1. Első példavideó másolata %%abcDEF12345%%',
  '- [x] summary',
  '  - [x] hu',
  '',
].join('\n')

describe('parseQueue', () => {
  it('a sorokat bájtra visszaadja', () => {
    expect(parseQueue(JEGYZET).lines.join('\n')).toBe(JEGYZET)
  })

  it('a fejléceket a soruk indexével és a sorszám nélküli kulccsal adja', () => {
    expect(parseQueue(JEGYZET).headings).toEqual([
      { line: 3, key: 'feliratok/csatorna-a' },
      { line: 15, key: 'feliratok/csatorna-b' },
    ])
  })

  it('a receptsort a videóhoz köti; videó előtt és fejléc után, videó előtt saját sor', () => {
    const { videos } = parseQueue(JEGYZET)
    expect(videos.map((v) => [v.itemId, v.line, v.recipes.map((r) => r.recipeId)])).toEqual([
      ['abcDEF12345', 4, ['summary', 'flashcards', 'qa']],
      ['0123456789abcdef', 12, ['summary']],
      ['abcDEF12345', 17, ['summary']],
    ])
    expect(videos[0]!.head).toBe('### 1. Első példavideó %%abcDEF12345%%')
  })

  it('a fordítássort a legközelebbi megelőző recepthez köti; recept előtt saját sor', () => {
    const [elso] = parseQueue(JEGYZET).videos
    expect(elso!.recipes.map((r) => r.translations)).toEqual([
      [{ line: 7, lang: 'hu', checked: true, head: '  - [x] hu', suffix: ' — ✓ 0.90 · $0.0100' }],
      [],
      [{ line: 11, lang: 'hu', checked: false, head: '  - [ ] hu', suffix: '' }],
    ])
  })

  it('az azonosító második előfordulását duplikátumnak jelöli', () => {
    expect(parseQueue(JEGYZET).videos.map((v) => v.duplicate)).toEqual([false, false, true])
  })
})

describe('checkedPairs', () => {
  it('a kipipált párokat a jegyzet sorrendjében adja, a fordítást <recept>-<nyelv> párként, duplikátum nélkül', () => {
    expect(checkedPairs(parseQueue(JEGYZET))).toEqual([
      { itemId: 'abcDEF12345', recipeId: 'summary' },
      { itemId: 'abcDEF12345', recipeId: 'summary-hu' },
      { itemId: 'abcDEF12345', recipeId: 'qa' },
      { itemId: '0123456789abcdef', recipeId: 'summary' },
    ])
  })
})
```

- [ ] **Step 6: A megvalósítás** — a `src/queue/parse.ts` teljes tartalma:

```ts
import { translationId } from './layout.js'
import { classifyLine } from './line.js'

export interface QueueTranslation {
  /** A sor indexe a jegyzetben, nullától. */
  line: number
  lang: string
  checked: boolean
  head: string
  suffix: string
}

export interface QueueRecipe {
  /** A sor indexe a jegyzetben, nullától. */
  line: number
  recipeId: string
  checked: boolean
  head: string
  suffix: string
  /** A recept alá behúzott fordítássorok. */
  translations: QueueTranslation[]
}

export interface QueueVideo {
  line: number
  itemId: string
  /** A sor eleje a horgonyig, a `### N. ` előtaggal együtt. */
  head: string
  suffix: string
  /** Igaz, ha ugyanez az azonosító egy korábbi videósoron már szerepelt. */
  duplicate: boolean
  recipes: QueueRecipe[]
}

export interface QueueHeading {
  line: number
  key: string
}

export interface QueueDoc {
  lines: string[]
  headings: QueueHeading[]
  videos: QueueVideo[]
}

export interface QueuePair {
  itemId: string
  recipeId: string
}

/**
 * A jegyzet szerkezete. Sorvégként `\n`-t feltételez — a vault macOS-en,
 * Obsidianból szerkesztődik. A receptsor a legközelebbi megelőző videóhoz, a
 * fordítássor a legközelebbi megelőző recepthez tartozik; a csoportfejléc
 * mindkét láncot megszakítja. Ami így nem köthető, saját sornak számít.
 */
export function parseQueue(text: string): QueueDoc {
  const lines = text.split('\n')
  const headings: QueueHeading[] = []
  const videos: QueueVideo[] = []
  const seen = new Set<string>()
  let current: QueueVideo | undefined
  let recipe: QueueRecipe | undefined

  lines.forEach((raw, line) => {
    const parsed = classifyLine(raw)
    switch (parsed.kind) {
      case 'heading':
        headings.push({ line, key: parsed.key })
        current = undefined
        recipe = undefined
        break
      case 'video':
        current = {
          line,
          itemId: parsed.itemId,
          head: parsed.head,
          suffix: parsed.suffix,
          duplicate: seen.has(parsed.itemId),
          recipes: [],
        }
        recipe = undefined
        seen.add(parsed.itemId)
        videos.push(current)
        break
      case 'recipe':
        if (current === undefined) break
        recipe = {
          line,
          recipeId: parsed.recipeId,
          checked: parsed.checked,
          head: parsed.head,
          suffix: parsed.suffix,
          translations: [],
        }
        current.recipes.push(recipe)
        break
      case 'translation':
        recipe?.translations.push({
          line,
          lang: parsed.lang,
          checked: parsed.checked,
          head: parsed.head,
          suffix: parsed.suffix,
        })
        break
      default:
        break
    }
  })

  return { lines, headings, videos }
}

/**
 * A kipipált párok a jegyzet sorrendjében — a duplikátum-blokkok nélkül. A
 * fordítás párja `<recept>-<nyelv>`: ugyanaz a recept-azonosító, amit a
 * regiszter a fordítórecepteknek ad.
 */
export function checkedPairs(doc: QueueDoc): QueuePair[] {
  return doc.videos
    .filter((video) => !video.duplicate)
    .flatMap((video) =>
      video.recipes.flatMap((recipe) => [
        ...(recipe.checked ? [{ itemId: video.itemId, recipeId: recipe.recipeId }] : []),
        ...recipe.translations
          .filter((translation) => translation.checked)
          .map((translation) => ({
            itemId: video.itemId,
            recipeId: translationId(recipe.recipeId, translation.lang),
          })),
      ]),
    )
}
```

Run: `pnpm vitest run src/queue/parse.test.ts` — Expected: PASS, 6 teszt.

### 4.3 Visszaírás — `status.ts`

- [ ] **Step 7: A teszt és a megvalósítás** — a `src/queue/status.test.ts`
  `SOR` konstansa és az `applyStatuses` blokk helyére:

```ts
const SOR = [
  '## 1. feliratok/csatorna-a',
  '### 1. Első példavideó %%abcDEF12345%%',
  '- [x] summary — ✗ régi hiba',
  '  - [x] hu',
  '- [x] qa',
  'Saját megjegyzés.',
  '### 2. Második példavideó %%0123456789abcdef%%',
  '- [x] summary',
  '### 3. Első példavideó újra %%abcDEF12345%%',
  '- [x] summary',
  '',
].join('\n')

describe('applyStatuses', () => {
  it('csak a megadott párok utótagját cseréli; minden más sor bájtra azonos', () => {
    const statuses = new Map([
      [pairKey('0123456789abcdef', 'summary'), DEFERRED_STATUS],
      [pairKey('abcDEF12345', 'summary'), '✓ 1.00 · $0.0100'],
    ])

    expect(applyStatuses(SOR, statuses)).toBe(
      [
        '## 1. feliratok/csatorna-a',
        '### 1. Első példavideó %%abcDEF12345%%',
        '- [x] summary — ✓ 1.00 · $0.0100',
        '  - [x] hu',
        '- [x] qa',
        'Saját megjegyzés.',
        '### 2. Második példavideó %%0123456789abcdef%%',
        `- [x] summary — ${DEFERRED_STATUS}`,
        '### 3. Első példavideó újra %%abcDEF12345%%',
        '- [x] summary',
        '',
      ].join('\n'),
    )
  })

  it('azonosító szerint talál: ugyanaz a recept egy másik videónál érintetlen marad', () => {
    const statuses = new Map([[pairKey('0123456789abcdef', 'summary'), '✓ 0.90 · $0.0200']])

    const out = applyStatuses(SOR, statuses).split('\n')

    expect(out[2]).toBe('- [x] summary — ✗ régi hiba')
    expect(out[7]).toBe('- [x] summary — ✓ 0.90 · $0.0200')
  })

  it('a fordítás állapota a behúzott al-sorra kerül, a szülő recept érintetlen', () => {
    const statuses = new Map([[pairKey('abcDEF12345', 'summary-hu'), '✓ 0.88 · $0.0030']])

    const out = applyStatuses(SOR, statuses).split('\n')

    expect(out[2]).toBe('- [x] summary — ✗ régi hiba')
    expect(out[3]).toBe('  - [x] hu — ✓ 0.88 · $0.0030')
  })

  it('üres állapotlistára a szöveg bájtra azonos', () => {
    expect(applyStatuses(SOR, new Map())).toBe(SOR)
  })

  it('linkszabályt sértő állapotot nem ír ki', () => {
    const statuses = new Map([[pairKey('abcDEF12345', 'qa'), '✓ [[x]]']])
    expect(() => applyStatuses(SOR, statuses)).toThrow(/vault írási szabályait/)
  })
})
```

A `src/queue/status.ts` `applyStatuses` függvénye (az import kiegészül:
`import { translationId } from './layout.js'`):

```ts
/**
 * A párok utótagjának cseréje **azonosító és receptId szerint**, nem sorszám
 * szerint. A fordítás párja `<recept>-<nyelv>`, és a behúzott al-sorra íródik.
 * Csak a `statuses`-ben szereplő párokhoz nyúl, és csak az azonosító első
 * előfordulásánál; minden más sor bájtra változatlan.
 */
export function applyStatuses(text: string, statuses: ReadonlyMap<string, string>): string {
  const doc = parseQueue(text)
  const lines = [...doc.lines]
  const apply = (line: number, head: string, key: string): void => {
    const status = statuses.get(key)
    if (status === undefined) return
    const errors = lintVaultMarkdown(status)
    if (errors.length > 0) {
      throw new Error(`a visszaírt állapot megsérti a vault írási szabályait: ${errors.join('; ')}`)
    }
    lines[line] = withSuffix(head, status)
  }
  for (const video of doc.videos) {
    if (video.duplicate) continue
    for (const recipe of video.recipes) {
      apply(recipe.line, recipe.head, pairKey(video.itemId, recipe.recipeId))
      for (const translation of recipe.translations) {
        apply(
          translation.line,
          translation.head,
          pairKey(video.itemId, translationId(recipe.recipeId, translation.lang)),
        )
      }
    }
  }
  return lines.join('\n')
}
```

Run: `pnpm vitest run src/queue/status.test.ts` — Expected: PASS.

### 4.4 Összefésülés — `merge.ts`

- [ ] **Step 8: A bukó teszt** — a `src/queue/merge.test.ts` teljes tartalma:

```ts
import { describe, expect, it } from 'vitest'
import type { LanguageTag } from '../lang/identify.js'
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import type { QueueLayout } from './layout.js'
import { QUEUE_HEADER, mergeQueue } from './merge.js'
import { renumberQueue } from './renumber.js'

function elem(
  itemId: string,
  sourceFile: string,
  title: string,
  language: string | null = 'en',
): SourceItem {
  return {
    itemId,
    source: 'feliratok',
    sourceFile,
    subtitlePath: `/nemletezo/feliratok/${sourceFile}`,
    baseName: title,
    title,
    language,
    metadata: {},
  }
}

const layout = (
  recipes: string[],
  translations: [string, LanguageTag][] = [],
): QueueLayout => ({ recipes, translations: new Map(translations) })

const ALAP = layout(['summary', 'flashcards', 'qa'])
const FORDITASSAL = layout(['summary', 'flashcards', 'qa'], [['summary', 'hu']])
const NULLA = { addedVideos: 0, addedRecipeLines: 0, removedTranslationLines: 0, changedMarks: 0 }

const A1 = elem('abcDEF12345', 'csatorna-a/Elso.en.srt', 'Első példavideó')
const A2 = elem('0123456789abcdef', 'csatorna-a/Masodik.en.srt', 'Második példavideó')
const B1 = elem('bbbBBB22222', 'csatorna-b/Harmadik.en.srt', 'Harmadik példavideó')

describe('mergeQueue', () => {
  it('friss sort ír: fej, csoportonként a videók, receptenként egy üres pipa, 0-s sorszámmal', () => {
    const { text, stats } = mergeQueue(null, [A1, A2, B1], ALAP)

    expect(text).toBe(
      QUEUE_HEADER +
        [
          '',
          '## 0. feliratok/csatorna-a',
          '### 0. Első példavideó %%abcDEF12345%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '### 0. Második példavideó %%0123456789abcdef%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '',
          '## 0. feliratok/csatorna-b',
          '### 0. Harmadik példavideó %%bbbBBB22222%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '',
        ].join('\n'),
    )
    expect(stats).toEqual({ ...NULLA, addedVideos: 3 })
  })

  it('az újraszámozott sorra újra alkalmazva bájtra azonos, és nincs változás', () => {
    const elso = renumberQueue(mergeQueue(null, [A1, A2, B1], FORDITASSAL).text)
    const masodik = mergeQueue(elso, [A1, A2, B1], FORDITASSAL)

    expect(masodik.text).toBe(elso)
    expect(masodik.stats).toEqual(NULLA)
  })

  it('a pipák, az utótagok, a saját sorok és a kézi sorrend érintetlen marad', () => {
    const kezi = [
      '# Saját fejléc',
      '',
      '## 1. feliratok/csatorna-a',
      'Ezeket nézem meg először.',
      '### 1. Második példavideó %%0123456789abcdef%%',
      '- [x] summary — ✓ 0.97 · $0.0512',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Első példavideó %%abcDEF12345%%',
      '- [X] qa',
      '- [ ] summary',
      '- [ ] flashcards',
      '',
      '## 2. feliratok/csatorna-b',
      '',
    ].join('\n')
    const uj = elem('cccCCC33333', 'csatorna-a/Negyedik.en.srt', 'Negyedik példavideó')

    const { text, stats } = mergeQueue(kezi, [A1, A2, uj], ALAP)

    expect(text).toBe(
      kezi.replace(
        '- [ ] flashcards\n\n## 2.',
        '- [ ] flashcards\n### 0. Negyedik példavideó %%cccCCC33333%%\n' +
          '- [ ] summary\n- [ ] flashcards\n- [ ] qa\n\n## 2.',
      ),
    )
    expect(stats).toEqual({ ...NULLA, addedVideos: 1 })
  })

  it('ismeretlen csoport a jegyzet végére kerül, üres sorral elválasztva', () => {
    const elso = mergeQueue(null, [A1], ALAP).text

    const { text } = mergeQueue(elso, [A1, B1], ALAP)

    expect(text).toBe(
      elso +
        [
          '',
          '## 0. feliratok/csatorna-b',
          '### 0. Harmadik példavideó %%bbbBBB22222%%',
          '- [ ] summary',
          '- [ ] flashcards',
          '- [ ] qa',
          '',
        ].join('\n'),
    )
  })

  it('az eltűnt videó a fejlécén kap jelölést, és a jelölés lekerül, ha visszajön', () => {
    const elso = mergeQueue(null, [A1, A2], ALAP).text

    const eltunt = mergeQueue(elso, [A1], ALAP)
    expect(eltunt.text).toContain(
      '### 0. Második példavideó %%0123456789abcdef%% — ⚠ a felirat nem található\n',
    )
    expect(eltunt.stats.changedMarks).toBe(1)

    const vissza = mergeQueue(eltunt.text, [A1, A2], ALAP)
    expect(vissza.text).toBe(elso)
    expect(vissza.stats.changedMarks).toBe(1)
  })

  it('a duplikátum fejléce jelölést kap, és alá nem kerül receptsor', () => {
    const kezi = [
      '## 1. feliratok/csatorna-a',
      '### 1. Első példavideó %%abcDEF12345%%',
      '- [ ] summary',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Első példavideó újra %%abcDEF12345%%',
      '',
    ].join('\n')

    const { text, stats } = mergeQueue(kezi, [A1], ALAP)

    expect(text).toBe(
      kezi.replace('újra %%abcDEF12345%%', 'újra %%abcDEF12345%% — ⚠ duplikátum'),
    )
    expect(stats).toEqual({ ...NULLA, changedMarks: 1 })
  })

  it('új recept a regiszterben: a meglévő videó alá, az utolsó receptsora után kerül', () => {
    const regi = mergeQueue(null, [A1], layout(['summary', 'qa'])).text.replace(
      '- [ ] summary',
      '- [x] summary — ✓ 1.00',
    )

    const { text, stats } = mergeQueue(regi, [A1], layout(['summary', 'qa', 'flashcards']))

    expect(text).toBe(regi.replace('- [ ] qa', '- [ ] qa\n- [ ] flashcards'))
    expect(stats).toEqual({ ...NULLA, addedRecipeLines: 1 })
  })

  it('szögletes zárójeles cím sem sérti a vault linkszabályait', () => {
    const furcsa = elem('dddDDD44444', 'csatorna-a/Furcsa.en.srt', 'Rész [[1]] és [link](cél)')

    const { text } = mergeQueue(null, [furcsa], ALAP)

    expect(lintVaultMarkdown(text)).toEqual([])
  })
})

describe('mergeQueue — fordítások', () => {
  it('a fordítássor a forrásrecept alá kerül', () => {
    const { text } = mergeQueue(null, [A1], FORDITASSAL)

    expect(text).toContain(
      '### 0. Első példavideó %%abcDEF12345%%\n- [ ] summary\n  - [ ] hu\n- [ ] flashcards\n- [ ] qa\n',
    )
  })

  it('célnyelvű videó alá nem kerül fordítássor — a címke változataira sem', () => {
    for (const language of ['hu', 'hu-HU', 'HU']) {
      const magyar = elem('hhhHHH55555', 'csatorna-a/Magyar.srt', 'Magyar videó', language)
      expect(mergeQueue(null, [magyar], FORDITASSAL).text).not.toContain('  - [ ] hu')
    }
  })

  it('ismeretlen nyelvű videó alá kerül fordítássor', () => {
    const ismeretlen = elem('nnnNNN66666', 'csatorna-a/Ismeretlen.srt', 'Ismeretlen', null)
    expect(mergeQueue(null, [ismeretlen], FORDITASSAL).text).toContain('- [ ] summary\n  - [ ] hu\n')
  })

  it('meglévő videó: a hiányzó fordítássor közvetlenül a forrásrecept alá kerül', () => {
    const regi = mergeQueue(null, [A1], ALAP).text.replace('- [ ] summary', '- [x] summary — ✓ 1.00')

    const { text, stats } = mergeQueue(regi, [A1], FORDITASSAL)

    expect(text).toBe(regi.replace('- [x] summary — ✓ 1.00', '- [x] summary — ✓ 1.00\n  - [ ] hu'))
    expect(stats).toEqual({ ...NULLA, addedRecipeLines: 1 })
  })

  it('a meglévő recept fordítása előbb jön, mint a hiányzó recept a blokk végén', () => {
    const kezi = ['## 1. feliratok/csatorna-a', '### 1. Első példavideó %%abcDEF12345%%', '- [ ] qa', ''].join(
      '\n',
    )
    const ketto = layout(['summary', 'qa'], [
      ['summary', 'hu'],
      ['qa', 'hu'],
    ])

    const { text, stats } = mergeQueue(kezi, [A1], ketto)

    expect(text).toBe(
      kezi.replace('- [ ] qa', '- [ ] qa\n  - [ ] hu\n- [ ] summary\n  - [ ] hu'),
    )
    expect(stats).toEqual({ ...NULLA, addedRecipeLines: 3 })
  })

  it('célnyelvű videó alól minden ilyen nyelvű fordítássor törlődik, a pipált és az utótagos is', () => {
    const magyar = elem('hhhHHH55555', 'csatorna-a/Magyar.srt', 'Magyar videó', 'hu')
    const kezi = [
      '## 1. feliratok/csatorna-a',
      '### 1. Magyar videó %%hhhHHH55555%%',
      '- [x] summary — ✓ 0.95',
      '  - [x] hu — ✓ 0.90 · [jegyzet](<a/b_summary-hu.md>)',
      '- [ ] flashcards',
      '- [ ] qa',
      '  - [ ] hu',
      '',
    ].join('\n')

    const { text, stats } = mergeQueue(kezi, [magyar], FORDITASSAL)

    expect(text).toBe(
      [
        '## 1. feliratok/csatorna-a',
        '### 1. Magyar videó %%hhhHHH55555%%',
        '- [x] summary — ✓ 0.95',
        '- [ ] flashcards',
        '- [ ] qa',
        '',
      ].join('\n'),
    )
    expect(stats).toEqual({ ...NULLA, removedTranslationLines: 2 })
    expect(mergeQueue(text, [magyar], FORDITASSAL).text).toBe(text)
  })

  it('a nem talált és az ismeretlen nyelvű videó fordítássoraihoz nem nyúl', () => {
    const kezi = [
      '## 1. feliratok/csatorna-a',
      '### 1. Eltűnt videó %%eltunt00001%%',
      '- [ ] summary',
      '  - [x] hu',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Ismeretlen %%nnnNNN66666%%',
      '- [ ] summary',
      '  - [x] hu',
      '- [ ] flashcards',
      '- [ ] qa',
      '',
    ].join('\n')
    const ismeretlen = elem('nnnNNN66666', 'csatorna-a/Ismeretlen.srt', 'Ismeretlen', null)

    const { text, stats } = mergeQueue(kezi, [ismeretlen], FORDITASSAL)

    expect(text).toBe(
      kezi.replace('%%eltunt00001%%', '%%eltunt00001%% — ⚠ a felirat nem található'),
    )
    expect(stats).toEqual({ ...NULLA, changedMarks: 1 })
  })
})
```

- [ ] **Step 9: A megvalósítás** — a `src/queue/merge.ts` teljes tartalma:

```ts
import type { SourceItem } from '../types.js'
import { lintVaultMarkdown } from '../vault/lint.js'
import { primaryLanguage, type QueueLayout } from './layout.js'
import { groupKey, headingLine, recipeLine, translationLine, videoLine, withSuffix } from './line.js'
import { parseQueue, type QueueDoc, type QueueRecipe } from './parse.js'

export const NOT_FOUND_MARK = '⚠ a felirat nem található'
export const DUPLICATE_MARK = '⚠ duplikátum'

/**
 * A sor feje, amit az első `scan --queue` ír. Onnantól saját szöveg: a
 * pipeline többé nem írja.
 */
export const QUEUE_HEADER = [
  '# Feldolgozási sor',
  '',
  'Pipáld ki, melyik videóhoz melyik jegyzet készüljön, majd futtasd: `refinery run --queue`.',
  'Új feliratok után: `refinery scan --queue`. A recept neve utáni szöveget a pipeline írja,',
  'saját megjegyzés külön sorba kerüljön.',
  '',
].join('\n')

export interface MergeStats {
  /** Új videóblokkok száma. */
  addedVideos: number
  /** Meglévő videó alá beszúrt recept- és fordítássorok száma. */
  addedRecipeLines: number
  /** Célnyelvű videó alól törölt fordítássorok száma. */
  removedTranslationLines: number
  /** Videófejléc-jelölések változása: felkerült vagy lekerült `⚠`. */
  changedMarks: number
}

function assertLint(fragment: string): void {
  const errors = lintVaultMarkdown(fragment)
  if (errors.length > 0) {
    throw new Error(
      `a feldolgozási sor generált része megsérti a vault írási szabályait: ${errors.join('; ')}`,
    )
  }
}

/** A fejléc szakaszának utolsó nem üres sora, a következő csoportfejléc előtt. */
function sectionEnd(doc: QueueDoc, lines: readonly string[], headingIndex: number): number {
  const next = doc.headings.find((heading) => heading.line > headingIndex)?.line ?? lines.length
  let end = headingIndex
  for (let i = headingIndex + 1; i < next; i++) {
    if (lines[i]!.trim() !== '') end = i
  }
  return end
}

/** Kell-e fordítássor a videó alá: a célnyelvű videónál nem, ismeretlen nyelvnél igen. */
function wantsTranslation(language: string | null, target: string): boolean {
  const lang = primaryLanguage(language)
  return lang === null || lang !== target
}

/** Egy recept generált sorai: a receptsor, és ha kell, alatta a fordítássora. */
function recipeBlock(id: string, layout: QueueLayout, language: string | null): string[] {
  const target = layout.translations.get(id)
  return target !== undefined && wantsTranslation(language, target)
    ? [recipeLine(id), translationLine(target)]
    : [recipeLine(id)]
}

/** A recept és a fordítássorai közül az utolsó sor indexe. */
function recipeEnd(recipe: QueueRecipe): number {
  return recipe.translations.at(-1)?.line ?? recipe.line
}

/**
 * A felderített elemek összefésülése a sorba. Tiszta függvény.
 *
 * Új videó a csoportja szakaszának végére kerül, vagy új csoportként a
 * jegyzet végére; meglévő videóhoz csak a hiányzó recept- és fordítássor; a
 * videófejléc utótagja a `⚠` jelölés. A célnyelvű videó ilyen nyelvű
 * fordítássorai törlődnek — ez az egyetlen törlés. Minden más sor — pipák,
 * saját sorok, sorrend — bájtra érintetlen. Az új fejlécek `0`-s sorszámot
 * kapnak, a `renumberQueue` írja át őket. Kétszer alkalmazva ugyanazt adja.
 */
export function mergeQueue(
  current: string | null,
  items: readonly SourceItem[],
  layout: QueueLayout,
): { text: string; stats: MergeStats } {
  const doc = parseQueue(current ?? QUEUE_HEADER)
  const lines = [...doc.lines]
  const stats: MergeStats = {
    addedVideos: 0,
    addedRecipeLines: 0,
    removedTranslationLines: 0,
    changedMarks: 0,
  }
  const discovered = new Map(items.map((item) => [item.itemId, item] as const))

  // 1. Jelölések helyben: a sorok száma nem változik, az indexek érvényesek maradnak.
  for (const video of doc.videos) {
    const mark = video.duplicate
      ? DUPLICATE_MARK
      : discovered.has(video.itemId)
        ? null
        : NOT_FOUND_MARK
    const next = withSuffix(video.head, mark)
    if (next !== lines[video.line]) {
      assertLint(next)
      lines[video.line] = next
      stats.changedMarks++
    }
  }

  // 2. Törlések és beszúrások: sorindexek. A végén egyszerre fűzzük össze,
  //    hogy a korábbi indexek érvényesek maradjanak.
  const dropped = new Set<number>()
  const after = new Map<number, string[]>()
  const insertAfter = (line: number, added: readonly string[]): void => {
    after.set(line, [...(after.get(line) ?? []), ...added])
  }

  for (const video of doc.videos) {
    if (video.duplicate) continue
    // A nem talált videó nyelvét nem ismerjük: a fordítássoraihoz nem nyúlunk.
    const language = discovered.get(video.itemId)?.language ?? null
    const lang = primaryLanguage(language)
    if (lang !== null) {
      for (const recipe of video.recipes) {
        for (const translation of recipe.translations) {
          if (translation.lang !== lang) continue
          dropped.add(translation.line)
          stats.removedTranslationLines++
        }
      }
    }

    const present = new Map<string, QueueRecipe>()
    for (const recipe of video.recipes) {
      if (!present.has(recipe.recipeId)) present.set(recipe.recipeId, recipe)
    }

    // Előbb a meglévő receptek hiányzó fordítássora — így egy ugyanoda
    // horgonyzott hiányzó recept mögéjük kerül, nem közéjük.
    for (const [id, recipe] of present) {
      const target = layout.translations.get(id)
      if (target === undefined || !wantsTranslation(language, target)) continue
      if (recipe.translations.some((translation) => translation.lang === target)) continue
      insertAfter(recipeEnd(recipe), [translationLine(target)])
      stats.addedRecipeLines++
    }

    const missing = layout.recipes
      .filter((id) => !present.has(id))
      .flatMap((id) => recipeBlock(id, layout, language))
    if (missing.length > 0) {
      const last = video.recipes.at(-1)
      insertAfter(last ? recipeEnd(last) : video.line, missing)
      stats.addedRecipeLines += missing.length
    }
  }

  // 3. Új videók, csoportonként, a felderítés sorrendjében.
  const listed = new Set(doc.videos.map((video) => video.itemId))
  const groups = new Map<string, SourceItem[]>()
  for (const item of items) {
    if (listed.has(item.itemId)) continue
    listed.add(item.itemId)
    const key = groupKey(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const tail: string[] = []
  for (const [key, groupItems] of groups) {
    const block = groupItems.flatMap((item) => [
      videoLine(item),
      ...layout.recipes.flatMap((id) => recipeBlock(id, layout, item.language)),
    ])
    assertLint([headingLine(key), ...block].join('\n'))
    stats.addedVideos += groupItems.length
    const heading = doc.headings.find((h) => h.key === key)
    if (heading) {
      insertAfter(sectionEnd(doc, lines, heading.line), block)
    } else {
      tail.push(headingLine(key), ...block, '')
    }
  }

  const out: string[] = []
  lines.forEach((line, index) => {
    if (!dropped.has(index)) out.push(line)
    const added = after.get(index)
    if (added) out.push(...added)
  })

  if (tail.length > 0) {
    // A fájl végi újsort jelző üres utolsó elem helyére a `tail` kerül, ami
    // maga is üres sorral zár.
    if (out.at(-1) === '') out.pop()
    if (out.length > 0 && out.at(-1)!.trim() !== '') out.push('')
    out.push(...tail)
  }

  return { text: out.join('\n'), stats }
}
```

Run: `pnpm vitest run src/queue/` — Expected: PASS (layout, renumber, legacy, line, parse, status, merge).

### 4.5 A scan bekötése és a formátumra épülő tesztek

- [ ] **Step 10: A scan** — a `src/cli.ts`-ben az importok:

```ts
import { queueLayout } from './queue/layout.js'
import { migrateLegacy } from './queue/legacy.js'
import { mergeQueue } from './queue/merge.js'
import { renumberQueue } from './queue/renumber.js'
```

A `commandScanQueue` törzsében a `const items = …` sortól a `console.log(…)`
blokk végéig:

```ts
  const layout = queueLayout(registry)
  const items = await discoverAll(cfg.sources, cfg.languages)
  const path = queuePath(cfg.notesRoot)
  const current = await readQueueFile(path)
  // A régi formátumot egyszer átalakítjuk; utána a merge és az újraszámozás
  // már az újat látja.
  const legacy = current === null ? null : migrateLegacy(current, layout)
  const merged = mergeQueue(legacy?.text ?? null, items, layout)
  const text = renumberQueue(merged.text)
  const { stats } = merged

  console.log(
    `${String(items.length)} feldolgozható felirat · ${String(stats.addedVideos)} új videó, ` +
      `${String(stats.addedRecipeLines)} új receptsor meglévő videó alatt, ` +
      `${String(stats.changedMarks)} jelölés-változás`,
  )
  if (legacy?.migrated) {
    console.log('A sor átalakítva az új formátumra: számozott fejlécek, behúzott fordítások.')
  }
  if (stats.removedTranslationLines > 0) {
    console.log(
      `${String(stats.removedTranslationLines)} fordítássor törölve célnyelvű videó alól.`,
    )
  }
```

A függvény többi része (dry-run, `text === current`, írás, commit) változatlan.

- [ ] **Step 11: A formátumra épülő tesztek** — pontos cserék:

**`src/cli.test.ts`**

1. Import: `import { renumberQueue } from './queue/renumber.js'`.
2. A `pipal` segéd teljes cseréje:

```ts
/** Kipipálja a megadott (videó, recept) sorokat; a fordítás párja `<recept>-<nyelv>`. */
function pipal(text: string, parok: readonly (readonly [string, string])[]): string {
  let video: string | undefined
  let recept: string | undefined
  return text
    .split('\n')
    .map((line) => {
      const id = /^### \d+\. .*? %%(.+?)%%/.exec(line)?.[1]
      if (id !== undefined) {
        video = id
        recept = undefined
      }
      const recipe = /^- \[([ xX])\] (\S+)$/.exec(line)
      if (recipe) recept = recipe[2]
      const translation = /^ {2}- \[([ xX])\] ([a-z]{2})$/.exec(line)
      const pairId = recipe
        ? recipe[2]
        : translation && recept !== undefined
          ? `${recept}-${translation[2]!}`
          : undefined
      const unchecked = (recipe ?? translation)?.[1] === ' '
      return unchecked && pairId !== undefined && parok.some(([v, r]) => v === video && r === pairId)
        ? line.replace('- [ ]', '- [x]')
        : line
    })
    .join('\n')
}
```

3. „a kipipált párokat dolgozza fel, csak azok sorait írja vissza…” teszt:
   - `'## downloads/youtube/Csatorna B'` → `'## 2. downloads/youtube/Csatorna B'` (mindkét előfordulás a `.replace(…)` hívásban);
   - `expect(await readFile(sor, 'utf8')).toBe(kezi)` → `expect(await readFile(sor, 'utf8')).toBe(renumberQueue(kezi))` — a kézi csere után a scan csak a sorszámokat javítja;
   - `const elotte = kezi.split('\n')` → `const elotte = renumberQueue(kezi).split('\n')`;
   - `/^ {2}- \[x\] (summary|qa) — ✓ 1\.00 · \$\d\.\d{4} · \[jegyzet\]\(<.+>\)$/` → `/^- \[x\] (summary|qa) — ✓ 1\.00 · \$\d\.\d{4} · \[jegyzet\]\(<.+>\)$/`.
4. A `commandRun --queue` blokk többi tesztjében:
   - `/ {2}- \[x\] summary — ✓ /` → `/^- \[x\] summary — ✓ /m`;
   - `'  - [x] flashcards — ⏳ a plafon miatt a következő futásra maradt'` → `'- [x] flashcards — ⏳ a plafon miatt a következő futásra maradt'`, ugyanígy a `qa` és a `summary` ⏳-os sora;
   - `/ {2}- \[x\] qa — ✓ /` → `/^- \[x\] qa — ✓ /m`;
   - `expect(note).toContain('  - [x] summary\n')` → `expect(note).toContain('\n- [x] summary\n')`;
   - `'  - [x] summary — ✗ a felirat nem található'` → `'- [x] summary — ✗ a felirat nem található'`;
   - `.replace('  - [ ] qa', '  - [x] nincsilyen')` → `.replace('- [ ] qa', '- [x] nincsilyen')`.
5. A `commandRun — fordítás` blokk:
   - az első teszt neve: `'egy indítás előbb a forrást, aztán a fordítást készíti el'`; a sorok
     átrendezése törlődik (a `const sorok = … .split('\n')`, a két `splice` és a
     `writeFile(sor, sorok.join('\n'), …)` helyére):

     ```ts
     await writeFile(
       sor,
       pipal(await readFile(sor, 'utf8'), [
         ['e1', 'clean'],
         ['e1', 'clean-hu'],
       ]),
       'utf8',
     )
     ```

     Az új formátumban a fordítás nem állhat a forrása előtt: a `checkedPairs`
     mindig a recept után adja. A `sourcesFirst` őre a futtatóban marad, a saját
     tesztje fedi.
   - `/ {2}- \[x\] clean-hu — ✓ 1\.00 · /` → `/^ {2}- \[x\] hu — ✓ 1\.00 · /m`;
     `/ {2}- \[x\] clean — ✓ 1\.00 · /` → `/^- \[x\] clean — ✓ 1\.00 · /m`;
   - `'  - [x] clean-hu — ⏸ előbb a clean recept kell'` → `'  - [x] hu — ⏸ előbb a clean recept kell'`;
   - `/ {2}- \[x\] clean — ✓ /` → `/^- \[x\] clean — ✓ /m`;
     `'  - [x] clean-hu — ⏸ a forrás már magyar'` → `'  - [x] hu — ⏸ a forrás már magyar'`;
   - `/ {2}- \[x\] clean — ✗ /` → `/^- \[x\] clean — ✗ /m`;
     `'  - [x] clean-hu — ⏸ a clean recept jegyzete nem készült el'` → `'  - [x] hu — ⏸ a clean recept jegyzete nem készült el'`;
   - `'  - [x] clean — ⏳ a plafon miatt a következő futásra maradt'` → `'- [x] clean — ⏳ a plafon miatt a következő futásra maradt'`;
     `'  - [x] clean-hu — ⏳ a plafon miatt a következő futásra maradt'` → `'  - [x] hu — ⏳ a plafon miatt a következő futásra maradt'`.
   - A riport-sorok (`'- clean-hu — Angol videó: …'`, `'| clean-hu | 1 | …'`) nem változnak: a riport recept-azonosítóval ír.
6. A `commandScanQueue` blokk:
   - az első teszt két `toContain`-je:

     ```ts
     expect(note).toContain(
       '## 1. downloads/youtube/Csatorna A\n### 1. Első videó %%a1%%\n- [ ] summary\n- [ ] flashcards\n- [ ] qa\n',
     )
     expect(note).toContain(
       '## 2. downloads/youtube/Csatorna B\n### 1. Második videó %%b1%%\n- [ ] summary\n- [ ] flashcards\n- [ ] qa\n',
     )
     ```
   - a translate-es teszt `toContain`-je:

     ```ts
     expect(elso).toContain(
       '### 1. Első videó %%a1%%\n- [ ] summary\n  - [ ] hu\n- [ ] flashcards\n- [ ] qa\n' +
         '- [ ] clean\n  - [ ] hu\n- [ ] bloom\n- [ ] notes\n',
     )
     ```
   - új teszt a blokk végére:

     ```ts
     it('a régi formátumú sort egyszer átalakítja, a pipákkal és az utótagokkal együtt', async () => {
       await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
       const cfg = loadConfig(
         { ...rawWithVault(5), translate: { to: 'hu', recipes: ['summary'] } },
         '/p/refinery.config.yaml',
       )
       const sor = queuePath(cfg.notesRoot)
       await mkdir(cfg.notesRoot, { recursive: true })
       await writeFile(
         sor,
         [
           '# Feldolgozási sor',
           '',
           '## downloads/youtube/Csatorna A',
           '- Első videó %%a1%%',
           '  - [x] summary — ✓ 0.97 · $0.0512',
           '  - [ ] flashcards',
           '  - [ ] qa',
           '  - [ ] clean',
           '  - [ ] bloom',
           '  - [ ] notes',
           '  - [x] summary-hu — ⏸ előbb a summary recept kell',
           '',
         ].join('\n'),
         'utf8',
       )
       const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)

       await commandScanQueue(cfg, { dryRun: false, commit: false })

       expect(await readFile(sor, 'utf8')).toBe(
         [
           '# Feldolgozási sor',
           '',
           '## 1. downloads/youtube/Csatorna A',
           '### 1. Első videó %%a1%%',
           '- [x] summary — ✓ 0.97 · $0.0512',
           '  - [x] hu — ⏸ előbb a summary recept kell',
           '- [ ] flashcards',
           '- [ ] qa',
           '- [ ] clean',
           '- [ ] bloom',
           '- [ ] notes',
           '',
         ].join('\n'),
       )
       expect(naplo.mock.calls.flat().join('\n')).toContain('átalakítva az új formátumra')
       naplo.mockRestore()
     })
     ```

**`src/e2e.test.ts`** — `.replace('  - [ ] summary', '  - [x] summary')` → `.replace('- [ ] summary', '- [x] summary')`.

**`src/view/overview.test.ts`**
- a `queueOverview` blokk `SOR`-ja:

  ```ts
  const SOR = [
    '## 1. youtube',
    '### 1. Első példavideó %%a%%',
    '- [x] summary',
    '- [ ] flashcards',
    '- [x] qa',
    '### 2. Második példavideó %%b%%',
    '- [x] summary',
    '### 3. Harmadik példavideó %%c%%',
    '- [x] summary',
    '- [x] ismeretlen',
    '',
  ].join('\n')
  ```
- `'- Első példavideó %%szint0001%%\n  - [x] summary\n'` → `'### 1. Első példavideó %%szint0001%%\n- [x] summary\n'`.

**`web/test/e2e/fixture.ts`** — a `_queue.md` tartalma:

```ts
    [
      '## 1. youtube/Szintetikus Csatorna',
      '### 1. Első példavideó %%szint0001%%',
      '- [x] summary',
      '- [ ] flashcards',
      '- [ ] qa',
      '### 2. Második példavideó %%szint0002%%',
      '- [ ] summary',
      '',
    ].join('\n'),
```

- [ ] **Step 12: Futtasd a teljes suite-ot**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: minden zöld. Ha a `cli.test.ts`-ben maradt régi formátumú literál,
keresd őket:
`grep -nE "'  - \[x\] (summary|qa|flashcards|clean)" src/cli.test.ts` és
`grep -nF '/ {2}- ' src/cli.test.ts` (a régi, `^` nélküli regexek)
— a találat üres kell legyen.

- [ ] **Step 13: Commit** (`commit-message` skill)

```bash
git add src/queue src/cli.ts src/cli.test.ts src/e2e.test.ts src/view/overview.test.ts web/test/e2e/fixture.ts
```

Javasolt üzenet: `feat(queue): számozott fejlécek és behúzott fordítássorok`, `Refs #58`.

---

## Task 5: Nyelv a tartalomból a scanben, és a régi sor őre a futásnál

**Files:**
- Modify: `src/cli.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: `normalizeItem` (`src/pipeline.ts`), `isLegacyQueue` (Task 3).
- Produces: semmi új export.

- [ ] **Step 1: A bukó tesztek** — `src/cli.test.ts`:

A `makeVideo` kap egy utolsó, elhagyható paramétert, a felirat fájlnevében
álló nyelvkódot:

```ts
async function makeVideo(
  downloads: string,
  id: string,
  title: string,
  channel: string,
  srt: string = SRT,
  lang: string | null = 'en',
) {
  const dir = join(downloads, 'youtube', channel)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${title}.info.json`),
    JSON.stringify({
      id,
      title,
      channel,
      upload_date: '20260714',
      webpage_url: `https://www.youtube.com/watch?v=${id}`,
    }),
    'utf8',
  )
  await writeFile(join(dir, lang === null ? `${title}.srt` : `${title}.${lang}.srt`), srt, 'utf8')
}
```

Az `SRT` konstans után:

```ts
/** Hosszabb magyar felirat: a nyelvfelismerés ebből biztosan magyart mond. */
const MAGYAR_SRT = `1
00:00:00,000 --> 00:00:04,000
Ez a videó arról szól, hogy a figyelem és a türelem hogyan segít a tanulásban.

2
00:00:04,000 --> 00:00:08,000
A tanító azt mondja, hogy nem kell sietni, mert a megértés idővel jön el.
`

/** Felirat, amelynek a nyelve a tartalomból sem ismerhető fel. */
const ISMERETLEN_SRT = `1
00:00:00,000 --> 00:00:02,000
Xyzzy quux foobar plugh grault. Waldo fred garply.
`

/** Egy videó blokkja a sorban: a fejlécétől a következő fejlécig vagy üres sorig. */
function videoBlokk(sor: string, id: string): string[] {
  const lines = sor.split('\n')
  const start = lines.findIndex((line) => line.includes(`%%${id}%%`))
  const end = lines.findIndex(
    (line, i) => i > start && (line.startsWith('#') || line.trim() === ''),
  )
  return lines.slice(start, end === -1 ? undefined : end)
}
```

(Ellenőrzés a terv írásakor: `identifyLanguage` a `MAGYAR_SRT` szövegére `hu`,
az `ISMERETLEN_SRT`-ére `null`.)

A `commandScanQueue` blokk végére:

```ts
  it('nyelvkód nélküli magyar feliratnál a tartalom dönt: a videó alá nem kerül hu sor', async () => {
    await makeVideo(downloads, 'h1', 'Magyar videó', 'Csatorna A', MAGYAR_SRT, null)
    await makeVideo(downloads, 'e1', 'Angol videó', 'Csatorna A', ANGOL_SRT)
    const cfg = loadConfig(
      { ...rawWithVault(5), translate: { to: 'hu', recipes: ['summary'] } },
      '/p/refinery.config.yaml',
    )

    await commandScanQueue(cfg, { dryRun: false, commit: false })

    const sor = await readFile(queuePath(cfg.notesRoot), 'utf8')
    expect(videoBlokk(sor, 'h1')).not.toContain('  - [ ] hu')
    expect(videoBlokk(sor, 'e1')).toContain('  - [ ] hu')
  })

  it('ha a tartalom nyelve sem ismerhető fel, a scan nem áll meg, és a hu sor megmarad', async () => {
    await makeVideo(downloads, 'x1', 'Ismeretlen videó', 'Csatorna A', ISMERETLEN_SRT, null)
    const cfg = loadConfig(
      { ...rawWithVault(5), translate: { to: 'hu', recipes: ['summary'] } },
      '/p/refinery.config.yaml',
    )

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)

    const sor = await readFile(queuePath(cfg.notesRoot), 'utf8')
    expect(videoBlokk(sor, 'x1')).toContain('  - [ ] hu')
  })
```

A `commandRun --queue` blokkban, a „sor nélkül indulás előtt…” teszt után:

```ts
  it('régi formátumú sorra indulás előtt hibával megáll, és a scan --queue-t javasolja', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const sor = queuePath(cfg.notesRoot)
    await mkdir(cfg.notesRoot, { recursive: true })
    await writeFile(sor, '## downloads/youtube/Csatorna A\n- Első videó %%a1%%\n  - [x] summary\n', 'utf8')
    const hiba = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const hivasok = { generate: 0 }

    const code = await commandRun(
      cfg,
      raw,
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => sorKliens(hivasok) },
    )

    expect(code).toBe(1)
    expect(hivasok.generate).toBe(0)
    expect(hiba.mock.calls.flat().join('\n')).toContain('refinery scan --queue')
    expect(existsSync(cfg.logsDir)).toBe(false)
    hiba.mockRestore()
  })
```

- [ ] **Step 2: Futtasd, bukjon el**

Run: `pnpm vitest run src/cli.test.ts -t "nyelvkód nélküli magyar|régi formátumú sorra"`
Expected: FAIL — a magyar videó alatt ott a `hu` sor; a régi sorra a futás 0-val lép ki.

- [ ] **Step 3: A megvalósítás** — `src/cli.ts`:

Import: `normalizeItem` a meglévő `pipeline.js` importba
(`import { ARTIFACT_KIND, normalizeItem, processItem, type RecipeDeps } from './pipeline.js'`),
a Task 4-ben felvett legacy-import pedig kiegészül:
`import { isLegacyQueue, migrateLegacy } from './queue/legacy.js'`.

A `commandScanQueue` elé:

```ts
/**
 * Nyelvkód nélküli feliratnál a tartalom dönt a nyelvről, ugyanúgy, mint a
 * futásban (`normalizeItem`). Az eredeti elemet nem módosítja. Ha a nyelv a
 * tartalomból sem ismerhető fel, vagy a felirat nem olvasható, `null` marad:
 * a scan ettől nem áll meg, a fordítássor pedig megmarad.
 */
async function withContentLanguage(items: readonly SourceItem[]): Promise<SourceItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.language !== null) return item
      const copy = { ...item }
      try {
        await normalizeItem(copy)
      } catch {
        // A nyelv null marad.
      }
      return copy
    }),
  )
}
```

A `commandScanQueue`-ban:

```ts
  const items = await withContentLanguage(await discoverAll(cfg.sources, cfg.languages))
```

A `commandRun`-ban, a `queueText === null` ág után:

```ts
  if (queueMode && queueText !== null && isLegacyQueue(queueText)) {
    console.error(
      `A feldolgozási sor még a régi formátumú: ${sorPath}\n` +
        'Előbb: refinery scan --queue — ez átalakítja, a pipákkal együtt.',
    )
    return 1
  }
```

- [ ] **Step 4: Futtasd, legyen zöld**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: minden zöld.

- [ ] **Step 5: Commit** (`commit-message` skill)

```bash
git add src/cli.ts src/cli.test.ts
```

Javasolt üzenet: `feat(cli): a scan a tartalomból ismeri fel a hiányzó nyelvet`, `Refs #58`.

---

## Task 6: Dokumentáció

**Files:**
- Modify: `README.md`, `docs/architecture.md`

- [ ] **Step 1: README** — a „A feldolgozási sor a válogatást Obsidianba viszi.”
  bekezdés helyére:

~~~markdown
A feldolgozási sor a válogatást Obsidianba viszi. A `scan --queue` a vault
`_queue.md` jegyzetébe fésüli a felderített videókat: forrásmappánként egy
számozott `##` fejléc, alatta videónként egy számozott `###` fejléc, és
receptenként egy üres pipa. A fordítás a forrásreceptje alá kerül, behúzott
nyelvi al-sorként — a célnyelvű videó alá nem, mert ott nincs mit fordítani:

```markdown
## 1. transcripts/youtube/Csatorna
### 1. Egy videó címe %%dQw4w9WgXcQ%%
- [x] summary — ✓ 0.97 · $0.0471 · [jegyzet](<…>)
  - [ ] hu
- [ ] flashcards
```

A `run --queue` a kipipált (videó, recept) párokat dolgozza fel — egyetlen
közös becsléssel és költségplafonnal —, és az eredményt pontszámmal,
költséggel és a jegyzet linkjével ugyanazokba a sorokba írja vissza. A
pipákhoz és a saját sorokhoz nem nyúl, a sorszámokat minden scan újraírja, a
jegyzetet atomian írja, és ha nincs mit feldolgozni, nulla modellhívással,
commit nélkül fut le. A korábbi, lapos formátumú sort az első `scan --queue`
egyszer átalakítja, a pipákkal együtt.
~~~

- [ ] **Step 2: `docs/architecture.md`**

A 184. sor körüli bekezdésben a „Csak a saját részeit írja — új videóblokk, a
videósor jelölése, a receptsor állapota —” helyére: „Csak a saját részeit írja
— új videóblokk, a fejlécek sorszáma, a videófejléc jelölése, a recept- és
fordítássor állapota, és a célnyelvű videó fordítássorainak törlése —”.

A 369. sor körüli felsorolásban a „videónként receptenként egy pipálható sor.”
helyére: „számozott csoport- és videófejlécek, alattuk receptenként egy
pipálható sor, a fordítás behúzva a forrásreceptje alatt.”.

- [ ] **Step 3: Ellenőrzés és commit**

Run: `pnpm lint` — Expected: hibátlan (a Markdown nincs lintelve, de a kódblokk
nem törhet el semmit).

```bash
git add README.md docs/architecture.md
```

Javasolt üzenet: `docs: a hierarchikus feldolgozási sor leírása`, `Refs #58`.

---

## Task 7: Ellenőrzés valódi adaton

A spec 1–2. sikerkritériuma. Az élő sort **nem** érinti: másolaton fut.

- [ ] **Step 1: Másolat és ideiglenes konfig**

```bash
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/vault/Inbox/transcript-refinery"
git init -q "$SCRATCH/vault"   # a konfig git-repót vár a vault.path-on
cp "/Users/peteroncode/github/peteroncode/peteroncode-github-vault/Inbox/transcript-refinery/_queue.md" \
   "$SCRATCH/vault/Inbox/transcript-refinery/_queue.md"
cp "$SCRATCH/vault/Inbox/transcript-refinery/_queue.md" "$SCRATCH/eredeti.md"
sed "s#^  path: /Users/peteroncode/github/peteroncode/peteroncode-github-vault#  path: $SCRATCH/vault#" \
  refinery.config.yaml > "$SCRATCH/refinery.config.yaml"
grep -n "path: $SCRATCH/vault" "$SCRATCH/refinery.config.yaml"
```

Expected: a `grep` egy sort talál. Ha a konfig relatív útvonalai (`state`,
`logs`) a konfig mappájához képest értődnek, a scan ezeket nem használja.

- [ ] **Step 2: Scan a másolaton**

```bash
pnpm build
node dist/cli.js scan --queue --no-commit --config "$SCRATCH/refinery.config.yaml"
```

Expected: a kimenetben `A sor átalakítva az új formátumra` és
`4 fordítássor törölve célnyelvű videó alól.`

- [ ] **Step 3: A megfigyelhető eredmény**

```bash
UJ="$SCRATCH/vault/Inbox/transcript-refinery/_queue.md"
grep -c '^## [0-9]\+\. ' "$UJ"            # 28
grep -c '^### [0-9]\+\. ' "$UJ"           # 166
grep -c '^  - \[ \] hu$' "$UJ"            # 660 = 165 × 4
diff <(grep '\[[xX]\]' "$SCRATCH/eredeti.md" | sed 's/^[ \t]*//') <(grep '\[[xX]\]' "$UJ") && echo pipak-rendben
awk '/%%FPg1oNlifJk%%/{b=1;next} /^#/{b=0} b && /^  - \[.\] hu/{print "HIBA: hu sor a magyar videó alatt"}' "$UJ"
```

Expected: 28, 166, 660, `pipak-rendben`, és az `awk` nem ír semmit. Ha
bármelyik eltér: **állj meg**, és jelezd a felhasználónak a kimenettel — ne
javíts az adaton.

- [ ] **Step 4: A második scan nem változtat**

```bash
cp "$UJ" "$SCRATCH/elso.md"
node dist/cli.js scan --queue --no-commit --config "$SCRATCH/refinery.config.yaml"
cmp "$SCRATCH/elso.md" "$UJ" && echo idempotens
```

Expected: `A sor naprakész`, majd `idempotens`.

- [ ] **Step 5: A felület is olvassa**

```bash
pnpm web:test
```

Expected: zöld.

---

## Záró ellenőrzés

- [ ] `pnpm test && pnpm typecheck && pnpm lint && pnpm web:typecheck` — minden zöld.
- [ ] `git log --oneline main..` — hat commit (Task 1–6), mind `Refs #58`.
- [ ] Záró, teljes ágra szóló review **Opuson** (`superpowers:requesting-code-review`), a Review Focus öt pontja mentén.
- [ ] PR a `main`-re, `Closes #58`; `gh pr checks` zöld. A merge a felhasználó döntése.
- [ ] A merge után kiadás: `chore/release-v1.1.0` ág, changelog a `changelog-generator` skillel, `bumpp 1.1.0 --no-tag --no-push`, PR, majd a `v1.1.0` tag.

## Ami nyitva marad

- A webes áttekintő (`view/overview.ts`) régi formátumú sorra nem mutat
  pipát; a scan első futása után helyreáll. Külön őr nem kell: a futtató
  őre (Task 5) a veszélyes esetet fogja meg.
- A `legacy.ts` törlése, ha már nincs régi formátumú sor — külön issue.
- Több célnyelv egyszerre (a `translate.to` ma egy nyelv).
