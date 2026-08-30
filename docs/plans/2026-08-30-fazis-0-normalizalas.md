# Fázis 0 — Normalizálás és vault-írás, modell nélkül

> **Ágens-végrehajtóknak:** KÖTELEZŐ AL-SKILL: használd a
> `superpowers:subagent-driven-development` (ajánlott) vagy a
> `superpowers:executing-plans` skillt a terv feladatonkénti végrehajtásához.
> A lépések checkbox (`- [ ]`) szintaxist használnak a követéshez.

**Cél:** A Pinchflat letöltési mappájából felszedett feliratfájlokból
deduplikált, olvasható átirat készül az Obsidian vaultba — nulla modellhívás,
végig determinisztikusan és unit-tesztelve.

**Architektúra:** Egy TypeScript könyvtár (a „mag"), aminek a CLI az első
kliense. A csővezeték a kilenc lépésből az elsőt négyet és a hetediktől
kilencedikig tartót fedi: felderítés → értelmezés → normalizálás → minőségi
besorolás → renderelés → publikálás → állapotrögzítés. A mag struktúrált
eseményeket bocsát ki, nem `console.log`-ol.

**Tech stack:** TypeScript, Node 26.2.0, pnpm 11.24.0, Vitest, ESLint 10 +
typescript-eslint 8 (flat config), bumpp 12 a verziózáshoz, `node:sqlite`
(beépített), `zod` a konfiguráció validálásához. Futásidejű npm-függőség
minimális: egyedül a `zod`.

**Spec:** [`../architecture.md`](<../architecture.md>),
[`../roadmap.md`](<../roadmap.md>) (Fázis 0),
[`../decisions/0007-elso-szelet.md`](<../decisions/0007-elso-szelet.md>)

## Globális megkötések

Minden feladat követelményei implicit módon tartalmazzák ezt a szakaszt.

- **Node `26.2.0`, pnpm `11.24.0`** — a `.mise.toml`-ból. Minden parancs
  `mise exec --` előtaggal fut, soha nem a shell PATH-ból.
- **Nulla modellhívás ebben a fázisban.** Ha egy feladat LLM-et igényelne, a
  feladat rossz — állj meg és jelezd.
- **A dokumentáció, a commit-üzenetek és a felhasználónak szóló kimenetek
  magyarul.** A kódazonosítók, típusnevek és a conventional commit előtagok
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) angolul.
- **A commit-üzenetekbe nem kerül `Co-Authored-By` trailer.**
- **A vault linkelési szabálya kötelező:** minden Markdown-link célja
  szögletes zárójelben, `[Név](<./út.md>)`. Wikilink (`[[X]]`) **tilos**.
  Belső link emoji 📓, külső 🌐.
- **A vault-írás write-once:** létező fájlt soha nem írunk felül `--force`
  nélkül.
- **Minden fájl UTF-8.** A címek tartalmaznak emojit, ékezetet és teljes
  szélességű írásjeleket — ezek nem hibák, meg kell őrizni őket.
- **TDD kötelező:** előbb bukó teszt, aztán a minimális implementáció.
- **Commit előtt `pnpm lint` és `pnpm typecheck` is fut, nem csak `pnpm test`.**
  Egy feladat akkor kész, ha mindhárom zöld.
- **Verziót csak `pnpm release` emel** (bumpp). Kézzel a `package.json`
  `version` mezőjéhez nem nyúlunk.

---

## Fájlszerkezet

| Fájl | Felelősség |
|---|---|
| `src/types.ts` | közös típusok: `Cue`, `SourceItem`, `NormalizedTranscript`, `CaptionSource` |
| `src/subtitle/timestamp.ts` | időbélyeg-értelmezés SRT és VTT alakban |
| `src/subtitle/parse-srt.ts` | SRT → `Cue[]` |
| `src/subtitle/parse-vtt.ts` | VTT → `Cue[]`, inline tagek eltávolításával |
| `src/subtitle/parse.ts` | kiterjesztés szerinti választás |
| `src/normalize/dedupe.ts` | egymás utáni ismétlődések kiejtése, bekezdésképzés |
| `src/normalize/classify.ts` | írásjel-sűrűség → `creator` \| `auto` |
| `src/vault/sanitize.ts` | yt-dlp-kompatibilis fájlnév-szanitizálás |
| `src/vault/paths.ts` | csatorna és cím → vault-útvonal, kis-nagybetű-egyeztetéssel |
| `src/vault/render.ts` | frontmatter + Markdown előállítása |
| `src/vault/lint.ts` | wikilink-tilalom és angle-bracket linkek ellenőrzése |
| `src/vault/publish.ts` | write-once fájlírás |
| `src/vault/git.ts` | `pull --ff-only`, útvonalra szűkített commit és push |
| `src/state/db.ts` | `node:sqlite` séma és műveletek |
| `src/source/types.ts` | `Source` interfész |
| `src/source/folder.ts` | Pinchflat mappa-adapter |
| `src/config.ts` | környezeti változók betöltése és validálása |
| `src/events.ts` | struktúrált eseményfolyam |
| `src/pipeline.ts` | a lépések összekötése egyetlen elemre |
| `src/cli.ts` | `scan` és `run` parancsok |
| `eslint.config.js` | ESLint flat config, típusellenőrzött szabálykészlettel |
| `bump.config.ts` | bumpp: magyar kiadási commit-üzenet és tag-formátum |
| `tsconfig.build.json` | build-konfiguráció, ami kihagyja a teszteket |

A tesztek a forrás mellett élnek: `src/**/*.test.ts`.

---

### Feladat 1: Projektváz, linter és verziózó eszköz

**Fájlok:**
- Létrehoz: `package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`, `eslint.config.js`, `bump.config.ts`
- Létrehoz: `src/types.ts`
- Teszt: `src/types.test.ts`

**Interfészek:**
- Fogyaszt: semmit
- Előállít: `Cue`, `CaptionSource`, `SourceItem`, `NormalizedTranscript`
  típusok, amikre minden későbbi feladat épül.

> **Miért egy feladat a váz és a szerszámok.** A linter a *második* feladattól
> kezdve minden során lefut — ha később kerülne be, tizenegy feladatnyi kódot
> kellene visszamenőleg igazítani hozzá. A bumpp ugyanígy: a `version` mező
> gazdáját az elején kell kijelölni, különben menet közben kézzel írjuk át.

- [ ] **1. lépés: Hozd létre a `package.json`-t**

```json
{
  "name": "transcript-refinery",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.24.0",
  "engines": { "node": ">=26.2.0" },
  "bin": { "refinery": "./dist/cli.js" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "build": "tsc -p tsconfig.build.json",
    "release": "bumpp"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^26.0.0",
    "bumpp": "^12.2.2",
    "eslint": "^10.9.1",
    "typescript": "^5.9.0",
    "typescript-eslint": "^8.68.0",
    "vitest": "^3.2.0"
  },
  "dependencies": {
    "zod": "^4.4.3"
  }
}
```

- [ ] **2. lépés: Hozd létre a két TypeScript-konfigurációt**

Két fájl kell, mert az ESLint típusellenőrzött szabályaihoz a **teszteknek is**
benne kell lenniük a projektben, a buildből viszont ki kell maradniuk.

`tsconfig.json` — ezt látja a szerkesztő, a `typecheck` és az ESLint:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

`tsconfig.build.json` — csak a `pnpm build` használja:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **3. lépés: Hozd létre a `vitest.config.ts`-t**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **4. lépés: Hozd létre az `eslint.config.js`-t**

Az ESLint 10 flat configot használ. A típusellenőrzött szabálykészlet kell,
mert a hibák java része itt típusinformációból derül ki:

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', '.state/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A `noUncheckedIndexedAccess` miatt a tömbindexelés `T | undefined`-ot
      // ad, ezért a `!` itt a szándék kifejezése, nem elhanyagolás.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Az alulvonással kezdődő paraméter szándékosan kihasználatlan.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
```

- [ ] **5. lépés: Hozd létre a `bump.config.ts`-t**

A bumpp alapból elvégzi a commitot, a tagelést és a pusht (ezek `--no-commit`,
`--no-tag`, `--no-push` kapcsolókkal kikapcsolhatók). Csak a magyar
commit-üzenetet és a tag alakját állítjuk be:

```ts
import { defineConfig } from 'bumpp'

export default defineConfig({
  commit: 'chore: {tag} kiadás',
  tag: 'v{version}',
})
```

- [ ] **6. lépés: Írd meg a bukó tesztet**

`src/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CAPTION_SOURCES } from './types.js'

describe('types', () => {
  it('a felirat-eredet két értéket vesz fel', () => {
    expect(CAPTION_SOURCES).toEqual(['creator', 'auto'])
  })
})
```

- [ ] **7. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm install && mise exec -- pnpm test`
Elvárt: FAIL — `Cannot find module './types.js'`

- [ ] **8. lépés: Írd meg a minimális implementációt**

`src/types.ts`:

```ts
export const CAPTION_SOURCES = ['creator', 'auto'] as const
export type CaptionSource = (typeof CAPTION_SOURCES)[number]

/** Egy feliratblokk: időtartomány és a hozzá tartozó szövegsorok. */
export interface Cue {
  /** kezdet másodpercben */
  start: number
  /** vég másodpercben */
  end: number
  lines: string[]
}

/** Egy feldolgozandó videó a forrás-adaptertől. */
export interface SourceItem {
  videoId: string
  title: string
  channel: string
  uploadedAt: string
  url: string
  subtitlePath: string
  mediaPath: string | null
}

/** A normalizálás eredménye. */
export interface NormalizedTranscript {
  lines: string[]
  wordsRaw: number
  wordsNormalized: number
  captionSource: CaptionSource
  punctuationDensity: number
}
```

- [ ] **9. lépés: Futtasd mind a hármat, és győződj meg róla, hogy zöldek**

Futtasd:
`mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: 1 teszt PASS, típushiba nincs, ESLint-hiba nincs

Ha az ESLint a `projectService` miatt hibázik, ellenőrizd, hogy a
`tsconfig.json` `include`-ja tényleg lefedi-e a `.test.ts` fájlokat is —
a `tsconfig.build.json` az, aminek ki kell hagynia őket, nem a fő konfignak.

- [ ] **10. lépés: Commitolj**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json \
        vitest.config.ts eslint.config.js bump.config.ts \
        src/types.ts src/types.test.ts
git commit -m "chore: TypeScript projektváz linterrel, verziózóval és alaptípusokkal"
```

---

### Feladat 2: Időbélyeg-értelmezés

**Fájlok:**
- Létrehoz: `src/subtitle/timestamp.ts`
- Teszt: `src/subtitle/timestamp.test.ts`

**Interfészek:**
- Fogyaszt: semmit
- Előállít: `parseTimestamp(text: string): number`,
  `parseCueTiming(line: string): { start: number; end: number } | null`

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/subtitle/timestamp.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCueTiming, parseTimestamp } from './timestamp.js'

describe('parseTimestamp', () => {
  it('SRT alakot értelmez (vessző az ezredmásodperc előtt)', () => {
    expect(parseTimestamp('00:00:08,000')).toBe(8)
  })

  it('VTT alakot értelmez (pont az ezredmásodperc előtt)', () => {
    expect(parseTimestamp('00:00:04.550')).toBe(4.55)
  })

  it('órát, percet és másodpercet is összead', () => {
    expect(parseTimestamp('01:02:03,500')).toBe(3723.5)
  })
})

describe('parseCueTiming', () => {
  it('SRT időzítő sort értelmez', () => {
    expect(parseCueTiming('00:00:00,160 --> 00:00:08,000')).toEqual({
      start: 0.16,
      end: 8,
    })
  })

  it('a VTT cue-beállításokat figyelmen kívül hagyja', () => {
    expect(
      parseCueTiming('00:00:01.880 --> 00:00:04.550 align:start position:0%'),
    ).toEqual({ start: 1.88, end: 4.55 })
  })

  it('null-t ad, ha a sor nem időzítő', () => {
    expect(parseCueTiming('Jó napot kívánok.')).toBeNull()
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/timestamp.test.ts`
Elvárt: FAIL — `Cannot find module './timestamp.js'`

- [ ] **3. lépés: Írd meg a minimális implementációt**

`src/subtitle/timestamp.ts`:

```ts
const TIMESTAMP = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/
const CUE_TIMING = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/

/** `HH:MM:SS,mmm` vagy `HH:MM:SS.mmm` → másodperc. */
export function parseTimestamp(text: string): number {
  const m = TIMESTAMP.exec(text.trim())
  if (!m) throw new Error(`Értelmezhetetlen időbélyeg: ${text}`)
  const [, h, min, s, ms] = m
  return (
    Number(h) * 3600 +
    Number(min) * 60 +
    Number(s) +
    Number(ms.padEnd(3, '0')) / 1000
  )
}

/**
 * Egy `--> ` sort értelmez. A VTT cue-beállításai (pl. `align:start
 * position:0%`) az időbélyegek után állnak, és figyelmen kívül maradnak.
 */
export function parseCueTiming(
  line: string,
): { start: number; end: number } | null {
  const m = CUE_TIMING.exec(line.trim())
  if (!m) return null
  try {
    return { start: parseTimestamp(m[1]), end: parseTimestamp(m[2]) }
  } catch {
    return null
  }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/timestamp.test.ts`
Elvárt: PASS, 6 teszt

- [ ] **5. lépés: Commitolj**

```bash
git add src/subtitle/timestamp.ts src/subtitle/timestamp.test.ts
git commit -m "feat(subtitle): időbélyeg-értelmezés SRT és VTT alakban"
```

---

### Feladat 3: SRT és VTT értelmezés

**Fájlok:**
- Létrehoz: `src/subtitle/parse-srt.ts`, `src/subtitle/parse-vtt.ts`,
  `src/subtitle/parse.ts`
- Teszt: `src/subtitle/parse-srt.test.ts`, `src/subtitle/parse-vtt.test.ts`,
  `src/subtitle/parse.test.ts`

**Interfészek:**
- Fogyaszt: `parseCueTiming` (Feladat 2), `Cue` (Feladat 1)
- Előállít: `parseSrt(input: string): Cue[]`,
  `parseVtt(input: string): Cue[]`,
  `parseSubtitle(input: string, filename: string): Cue[]`

> **Miért egy feladat a három:** ugyanaz a felelősség (feliratfájl → `Cue[]`),
> és a `parse.ts` értelmetlen a két értelmező nélkül. Egy bíráló nem tudná az
> egyiket elfogadni a másik nélkül.

- [ ] **1. lépés: Írd meg a bukó SRT tesztet**

`src/subtitle/parse-srt.test.ts` — a minta valós, yt-dlp által előállított
fájlból származik, ezért a cue-k időben **átfedik** egymást:

```ts
import { describe, expect, it } from 'vitest'
import { parseSrt } from './parse-srt.js'

const SAMPLE = `1
00:00:00,160 --> 00:00:08,000
Agent orchestration, otherwise known as

2
00:00:03,919 --> 00:00:11,599
what? Yes, the latest hot trend for vibe

3
00:00:08,000 --> 00:00:12,719
coders or agentic engineers is here. In
`

describe('parseSrt', () => {
  it('minden blokkot cue-vá alakít', () => {
    const cues = parseSrt(SAMPLE)
    expect(cues).toHaveLength(3)
    expect(cues[0]).toEqual({
      start: 0.16,
      end: 8,
      lines: ['Agent orchestration, otherwise known as'],
    })
  })

  it('megtartja az átfedő időzítést', () => {
    const cues = parseSrt(SAMPLE)
    expect(cues[1]!.start).toBeLessThan(cues[0]!.end)
  })

  it('több szövegsort is összegyűjt egy cue-ba', () => {
    const cues = parseSrt('1\n00:00:00,000 --> 00:00:01,000\nelső\nmásodik\n')
    expect(cues[0]!.lines).toEqual(['első', 'második'])
  })

  it('elviseli a sorszám nélküli blokkot', () => {
    const cues = parseSrt('00:00:00,000 --> 00:00:01,000\nszöveg\n')
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })

  it('üres bemenetre üres tömböt ad', () => {
    expect(parseSrt('')).toEqual([])
  })

  it('elviseli a CRLF sorvégeket', () => {
    const cues = parseSrt('1\r\n00:00:00,000 --> 00:00:01,000\r\nszöveg\r\n')
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/parse-srt.test.ts`
Elvárt: FAIL — `Cannot find module './parse-srt.js'`

- [ ] **3. lépés: Írd meg az SRT értelmezőt**

`src/subtitle/parse-srt.ts`:

```ts
import type { Cue } from '../types.js'
import { parseCueTiming } from './timestamp.js'

/**
 * SRT → cue-k. A blokkokat üres sorok választják el; a sorszám opcionális,
 * mert a gyakorlatban nem mindig van jelen.
 */
export function parseSrt(input: string): Cue[] {
  const cues: Cue[] = []
  const blocks = input.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length === 0) continue

    let timing = parseCueTiming(lines[0]!)
    let textStart = 1
    if (!timing && lines.length > 1) {
      timing = parseCueTiming(lines[1]!)
      textStart = 2
    }
    if (!timing) continue

    const text = lines.slice(textStart).map((l) => l.trim())
    if (text.length === 0) continue
    cues.push({ start: timing.start, end: timing.end, lines: text })
  }

  return cues
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/parse-srt.test.ts`
Elvárt: PASS, 6 teszt

- [ ] **5. lépés: Írd meg a bukó VTT tesztet**

`src/subtitle/parse-vtt.test.ts` — a minta valós, gördülő ablakos, inline
időbélyeg-tagekkel:

```ts
import { describe, expect, it } from 'vitest'
import { parseVtt } from './parse-vtt.js'

const SAMPLE = `WEBVTT
Kind: captions
Language: hu

00:00:01.880 --> 00:00:04.550 align:start position:0%
 
Jó<00:00:02.080><c> napot</c><00:00:02.399><c> kívánok.</c>

00:00:04.550 --> 00:00:04.560 align:start position:0%
Jó napot kívánok.
 

00:00:04.560 --> 00:00:06.670 align:start position:0%
Jó napot kívánok.
fájdalomkezelő,<00:00:05.520><c> szakorvos,</c>
`

describe('parseVtt', () => {
  it('a WEBVTT fejlécet és a metaadatokat kihagyja', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues).toHaveLength(3)
  })

  it('eltávolítja az inline időbélyeg- és <c> tageket', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues[0]!.lines).toEqual(['Jó napot kívánok.'])
  })

  it('a cue-beállításokat nem tekinti szövegnek', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues[0]!.start).toBe(1.88)
    expect(cues[0]!.end).toBe(4.55)
  })

  it('kidobja a csak szóközt tartalmazó sorokat', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues.every((c) => c.lines.every((l) => l.trim() !== ''))).toBe(true)
  })

  it('megőrzi a gördülő ablak ismétlődéseit (a dedup nem itt történik)', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues[1]!.lines).toEqual(['Jó napot kívánok.'])
    expect(cues[2]!.lines).toEqual([
      'Jó napot kívánok.',
      'fájdalomkezelő, szakorvos,',
    ])
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/parse-vtt.test.ts`
Elvárt: FAIL — `Cannot find module './parse-vtt.js'`

- [ ] **7. lépés: Írd meg a VTT értelmezőt**

`src/subtitle/parse-vtt.ts`:

```ts
import type { Cue } from '../types.js'
import { parseCueTiming } from './timestamp.js'

/** `<00:00:02.080>` és `<c>…</c>` alakú inline tagek. */
const INLINE_TAG = /<[^>]*>/g

function stripTags(line: string): string {
  return line.replace(INLINE_TAG, '').replace(/\s+/g, ' ').trim()
}

/**
 * WebVTT → cue-k. A fejléc (`WEBVTT`, `Kind:`, `Language:`) és a
 * `NOTE`/`STYLE` blokkok kimaradnak. Az inline időbélyeg-tagek eltávolításra
 * kerülnek, mert a deduplikáció szöveg szerint hasonlít — tagekkel a
 * gördülő ablak ismétlődései nem egyeznének meg.
 */
export function parseVtt(input: string): Cue[] {
  const cues: Cue[] = []
  const blocks = input.replace(/\r\n/g, '\n').split(/\n{2,}/)

  for (const block of blocks) {
    const raw = block.split('\n')
    if (raw.length === 0) continue

    const head = raw[0]!.trim()
    if (head.startsWith('WEBVTT') || head === 'NOTE' || head === 'STYLE') {
      continue
    }

    let timing = parseCueTiming(raw[0]!)
    let textStart = 1
    if (!timing && raw.length > 1) {
      timing = parseCueTiming(raw[1]!)
      textStart = 2
    }
    if (!timing) continue

    const lines = raw
      .slice(textStart)
      .map(stripTags)
      .filter((l) => l !== '')
    if (lines.length === 0) continue

    cues.push({ start: timing.start, end: timing.end, lines })
  }

  return cues
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/parse-vtt.test.ts`
Elvárt: PASS, 5 teszt

- [ ] **9. lépés: Írd meg a választó bukó tesztjét**

`src/subtitle/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSubtitle } from './parse.js'

describe('parseSubtitle', () => {
  it('.srt kiterjesztésre az SRT értelmezőt hívja', () => {
    const cues = parseSubtitle(
      '1\n00:00:00,000 --> 00:00:01,000\nszöveg\n',
      'video.en.srt',
    )
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })

  it('.vtt kiterjesztésre a VTT értelmezőt hívja', () => {
    const cues = parseSubtitle(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<c>szöveg</c>\n',
      'video.hu.vtt',
    )
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })

  it('ismeretlen kiterjesztésre hibát dob', () => {
    expect(() => parseSubtitle('bármi', 'video.txt')).toThrow(
      /Nem támogatott feliratformátum/,
    )
  })
})
```

- [ ] **10. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/subtitle/parse.test.ts`
Elvárt: FAIL — `Cannot find module './parse.js'`

- [ ] **11. lépés: Írd meg a választót**

`src/subtitle/parse.ts`:

```ts
import type { Cue } from '../types.js'
import { parseSrt } from './parse-srt.js'
import { parseVtt } from './parse-vtt.js'

/** Kiterjesztés alapján választ értelmezőt. A vaultban mindkét formátum él. */
export function parseSubtitle(input: string, filename: string): Cue[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.srt')) return parseSrt(input)
  if (lower.endsWith('.vtt')) return parseVtt(input)
  throw new Error(`Nem támogatott feliratformátum: ${filename}`)
}
```

- [ ] **12. lépés: Futtasd az egész csomagot**

Futtasd: `mise exec -- pnpm test`
Elvárt: PASS, 20 teszt

- [ ] **13. lépés: Commitolj**

```bash
git add src/subtitle/
git commit -m "feat(subtitle): SRT és VTT értelmezés inline tagek eltávolításával"
```

---

### Feladat 4: Normalizálás — deduplikáció és bekezdésképzés

**Fájlok:**
- Létrehoz: `src/normalize/dedupe.ts`
- Teszt: `src/normalize/dedupe.test.ts`

**Interfészek:**
- Fogyaszt: `Cue` (Feladat 1)
- Előállít: `dedupeLines(cues: Cue[]): string[]`,
  `countWords(text: string): number`,
  `toParagraphs(lines: string[], linesPerParagraph?: number): string`

> **Ez a fázis legnagyobb hozamú lépése**, és teljesen determinisztikus: valós
> korpuszon 11 468 → 3 939 szó átlagosan, 66% csökkenés, nulla modellhívással.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/normalize/dedupe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Cue } from '../types.js'
import { countWords, dedupeLines, toParagraphs } from './dedupe.js'

const cue = (lines: string[]): Cue => ({ start: 0, end: 1, lines })

describe('dedupeLines', () => {
  it('kiejti a háromszorozott sorokat', () => {
    const cues = [
      cue(["Today I'm trying out the new"]),
      cue(["Today I'm trying out the new"]),
      cue(["Today I'm trying out the new"]),
      cue(['experiments platform']),
    ]
    expect(dedupeLines(cues)).toEqual([
      "Today I'm trying out the new",
      'experiments platform',
    ])
  })

  it('kezeli a gördülő ablakot, ahol a cue megismétli az előző sorát', () => {
    const cues = [
      cue(['Jó napot kívánok.']),
      cue(['Jó napot kívánok.', 'fájdalomkezelő, szakorvos,']),
      cue(['fájdalomkezelő, szakorvos,', 'és hipnoterapeuta.']),
    ]
    expect(dedupeLines(cues)).toEqual([
      'Jó napot kívánok.',
      'fájdalomkezelő, szakorvos,',
      'és hipnoterapeuta.',
    ])
  })

  it('a nem egymás utáni ismétlődést megtartja', () => {
    const cues = [cue(['alfa']), cue(['béta']), cue(['alfa'])]
    expect(dedupeLines(cues)).toEqual(['alfa', 'béta', 'alfa'])
  })

  it('kidobja az üres és csak szóközt tartalmazó sorokat', () => {
    const cues = [cue(['alfa']), cue(['   ']), cue(['']), cue(['béta'])]
    expect(dedupeLines(cues)).toEqual(['alfa', 'béta'])
  })

  it('üres bemenetre üres tömböt ad', () => {
    expect(dedupeLines([])).toEqual([])
  })
})

describe('countWords', () => {
  it('szóközzel elválasztott szavakat számol', () => {
    expect(countWords('egy két három')).toBe(3)
  })

  it('a többszörös szóközt nem számolja külön szónak', () => {
    expect(countWords('  egy   két  ')).toBe(2)
  })

  it('üres szövegre nullát ad', () => {
    expect(countWords('   ')).toBe(0)
  })
})

describe('toParagraphs', () => {
  it('a megadott soronként bekezdést tör', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    expect(toParagraphs(lines, 2)).toBe('a b\n\nc d\n\ne')
  })

  it('üres listára üres szöveget ad', () => {
    expect(toParagraphs([], 2)).toBe('')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/normalize/dedupe.test.ts`
Elvárt: FAIL — `Cannot find module './dedupe.js'`

- [ ] **3. lépés: Írd meg az implementációt**

`src/normalize/dedupe.ts`:

```ts
import type { Cue } from '../types.js'

/**
 * A cue-kat sorfolyammá lapítja, és kiejti az **egymás utáni** ismétlődéseket.
 *
 * Ez a naiv változat szándékos: valós korpuszon az egymás utáni dedup
 * gyakorlatilag azonos eredményt ad a teljes egyedi-sor deduppal
 * (602 744 vs 602 073 szó), tehát okos algoritmus nem indokolt. A nem egymás
 * utáni ismétlődés megőrzése helyes — az a beszélő valódi ismétlése.
 */
export function dedupeLines(cues: Cue[]): string[] {
  const out: string[] = []
  for (const cue of cues) {
    for (const raw of cue.lines) {
      const line = raw.trim()
      if (line === '') continue
      if (out[out.length - 1] === line) continue
      out.push(line)
    }
  }
  return out
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length
}

/** Sorokból olvasható bekezdések, alapértelmezetten 8 soronként. */
export function toParagraphs(lines: string[], linesPerParagraph = 8): string {
  const paragraphs: string[] = []
  for (let i = 0; i < lines.length; i += linesPerParagraph) {
    paragraphs.push(lines.slice(i, i + linesPerParagraph).join(' '))
  }
  return paragraphs.join('\n\n')
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/normalize/dedupe.test.ts`
Elvárt: PASS, 10 teszt

- [ ] **5. lépés: Commitolj**

```bash
git add src/normalize/dedupe.ts src/normalize/dedupe.test.ts
git commit -m "feat(normalize): egymás utáni ismétlődések kiejtése és bekezdésképzés"
```

---

### Feladat 5: Minőségi kapu — írásjel-sűrűség

**Fájlok:**
- Létrehoz: `src/normalize/classify.ts`
- Teszt: `src/normalize/classify.test.ts`

**Interfészek:**
- Fogyaszt: `CaptionSource` (Feladat 1), `countWords` (Feladat 4)
- Előállít: `PUNCTUATION_THRESHOLD`,
  `punctuationDensity(text: string): number`,
  `classifyCaptions(text: string, threshold?: number): CaptionSource`

> **A 2,0-s küszöb nem hangolt paraméter**, hanem egy mért szakadék közepe:
> 153 valós fájlon az 1,0 és 4,0 közötti teljes sávban egyetlen fájl van.
> A nagybetű-arány szándékosan **nem** része a kapunak — az újabb ASR
> nagybetűsít, de nem tesz ki írásjelet, tehát használhatatlan diszkriminátor.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/normalize/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PUNCTUATION_THRESHOLD,
  classifyCaptions,
  punctuationDensity,
} from './classify.js'

describe('punctuationDensity', () => {
  it('száz szóra vetített írásjelszámot ad', () => {
    // 4 szó, 2 írásjel → 50 / 100 szó
    expect(punctuationDensity('szia, világ. hogy vagy')).toBe(50)
  })

  it('nullát ad írásjel nélküli szövegre', () => {
    expect(punctuationDensity('agent orchestration otherwise known as')).toBe(0)
  })

  it('nullát ad üres szövegre, nem oszt nullával', () => {
    expect(punctuationDensity('   ')).toBe(0)
  })
})

describe('classifyCaptions', () => {
  it('az írásjel nélküli ASR-szöveget automatikusnak sorolja', () => {
    const text =
      'agent orchestration otherwise known as what yes the latest hot ' +
      'trend for vibe coders or agentic engineers is here in this video'
    expect(classifyCaptions(text)).toBe('auto')
  })

  it('a rendesen központozott szöveget szerzőinek sorolja', () => {
    const text =
      'Agent orchestration, otherwise known as what? Yes, the latest hot ' +
      'trend for vibe coders is here. In this video, we take a look.'
    expect(classifyCaptions(text)).toBe('creator')
  })

  it('a küszöböt pontosan a mért szakadék közepére teszi', () => {
    expect(PUNCTUATION_THRESHOLD).toBe(2)
  })

  it('a küszöb felülbírálható', () => {
    expect(classifyCaptions('a, b', 1000)).toBe('auto')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/normalize/classify.test.ts`
Elvárt: FAIL — `Cannot find module './classify.js'`

- [ ] **3. lépés: Írd meg az implementációt**

`src/normalize/classify.ts`:

```ts
import type { CaptionSource } from '../types.js'
import { countWords } from './dedupe.js'

/** Mondatzáró és tagoló írásjelek. */
const PUNCTUATION = /[.,!?;:]/g

/**
 * A mért szakadék közepe. 153 valós feliratfájlon az 1,0 és 4,0 közötti
 * sávban egyetlen fájl található, tehát a küszöb megbízhatóan oszt.
 */
export const PUNCTUATION_THRESHOLD = 2

/** Írásjelek száma 100 szóra vetítve. */
export function punctuationDensity(text: string): number {
  const words = countWords(text)
  if (words === 0) return 0
  const marks = text.match(PUNCTUATION)?.length ?? 0
  return (marks / words) * 100
}

/**
 * Eldönti, hogy a felirat szerzői-e vagy automatikus. Modellhívás nélkül.
 */
export function classifyCaptions(
  text: string,
  threshold = PUNCTUATION_THRESHOLD,
): CaptionSource {
  return punctuationDensity(text) < threshold ? 'auto' : 'creator'
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/normalize/classify.test.ts`
Elvárt: PASS, 7 teszt

- [ ] **5. lépés: Commitolj**

```bash
git add src/normalize/classify.ts src/normalize/classify.test.ts
git commit -m "feat(normalize): felirat-minőségi kapu írásjel-sűrűség alapján"
```

---

### Feladat 6: Vault-útvonalak — szanitizálás és csatornaegyeztetés

**Fájlok:**
- Létrehoz: `src/vault/sanitize.ts`, `src/vault/paths.ts`
- Teszt: `src/vault/sanitize.test.ts`, `src/vault/paths.test.ts`

**Interfészek:**
- Fogyaszt: semmit
- Előállít: `sanitizeSegment(name: string): string`,
  `resolveChannelDir(root: string, channel: string): Promise<string>`,
  `videoDir(root: string, channelDir: string, title: string): string`,
  `transcriptFile(videoDirPath: string, title: string): string`

> **Miért így, és nem másképp.** A vault meglévő mappanevei yt-dlp
> szanitizálást használnak: a `/` helyén `⧸` (U+29F8), az idézőjel helyén `＂`
> (U+FF02) áll. Ha ettől eltérünk, a publisher **új mappát hoz létre a
> meglévő mellé**, és a jegyzetek kettéválnak. A csatornaegyeztetés
> kis-nagybetű-érzéketlen, különben ugyanannak a csatornának két mappája lesz.

- [ ] **1. lépés: Írd meg a szanitizálás bukó tesztjét**

`src/vault/sanitize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeSegment } from './sanitize.js'

describe('sanitizeSegment', () => {
  it('a perjelet nagy törtvonalra cseréli, ahogy a vault meglévő mappái', () => {
    expect(sanitizeSegment('My AI Business Makes Me $362,000/Month')).toBe(
      'My AI Business Makes Me $362,000⧸Month',
    )
  })

  it('az idézőjelet teljes szélességű idézőjelre cseréli', () => {
    expect(sanitizeSegment('"Semmiféle bűntudatuk nincs"')).toBe(
      '＂Semmiféle bűntudatuk nincs＂',
    )
  })

  it('megőrzi az emojit és az ékezetet', () => {
    const cim = 'Ruff MEGDORGÁLTA a Tuzsont 👨‍⚖️ #734'
    expect(sanitizeSegment(cim)).toBe(cim)
  })

  it('idempotens: kétszer futtatva ugyanaz jön ki', () => {
    const once = sanitizeSegment('a/b:c?d')
    expect(sanitizeSegment(once)).toBe(once)
  })

  it('levágja a záró pontot és szóközt, amit a macOS nem szeret', () => {
    expect(sanitizeSegment('Here is What Will. ')).toBe('Here is What Will')
  })

  it('eltávolítja a vezérlőkaraktereket', () => {
    const withBell = 'a' + String.fromCharCode(7) + 'bc'
    expect(sanitizeSegment(withBell)).toBe('abc')
  })

  it('nem üres eredményt ad akkor is, ha minden karakter elveszne', () => {
    expect(sanitizeSegment('...')).toBe('névtelen')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/sanitize.test.ts`
Elvárt: FAIL — `Cannot find module './sanitize.js'`

- [ ] **3. lépés: Írd meg a szanitizálást**

`src/vault/sanitize.ts`:

```ts
/**
 * yt-dlp-kompatibilis karaktercsere. A vault meglévő mappanevei pontosan
 * ezeket a helyettesítéseket használják — az eltérés duplikált mappát
 * eredményezne a már meglévő mellett.
 */
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\//g, '⧸'], // BIG SOLIDUS
  [/\\/g, '⧹'], // BIG REVERSE SOLIDUS
  [/"/g, '＂'], // FULLWIDTH QUOTATION MARK
  [/:/g, '：'], // FULLWIDTH COLON
  [/\?/g, '？'], // FULLWIDTH QUESTION MARK
  [/\*/g, '＊'], // FULLWIDTH ASTERISK
  [/</g, '＜'], // FULLWIDTH LESS-THAN SIGN
  [/>/g, '＞'], // FULLWIDTH GREATER-THAN SIGN
  [/\|/g, '｜'], // FULLWIDTH VERTICAL LINE
]

/**
 * Vezérlőkarakterek Unicode-kategória szerint (Cc). Szándékosan
 * kategória-escape, nem karaktertartomány: így a forrásban nem kell literál
 * vezérlőkaraktert tárolni.
 */
const CONTROL_CHARS = /\p{Cc}/gu

/**
 * Egyetlen útvonalszegmens (csatornanév vagy videócím) biztonságossá tétele.
 * Idempotens: a helyettesítő karakterek maguk már nem tiltottak.
 */
export function sanitizeSegment(name: string): string {
  let out = name
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement)
  }
  out = out.replace(CONTROL_CHARS, '')
  out = out.replace(/\s+/g, ' ').trim()
  out = out.replace(/[. ]+$/, '')
  return out === '' ? 'névtelen' : out
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/vault/sanitize.test.ts`
Elvárt: PASS, 7 teszt

- [ ] **5. lépés: Írd meg az útvonalszámítás bukó tesztjét**

`src/vault/paths.test.ts`:

```ts
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveChannelDir, transcriptFile, videoDir } from './paths.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-paths-'))
})

describe('resolveChannelDir', () => {
  it('a meglévő mappát adja vissza, ha csak a kis-nagybetű tér el', async () => {
    await mkdir(join(root, 'Zen van Riel'), { recursive: true })
    expect(await resolveChannelDir(root, 'Zen Van Riel')).toBe('Zen van Riel')
  })

  it('a szanitizált nevet adja, ha nincs meglévő mappa', async () => {
    expect(await resolveChannelDir(root, 'Új/Csatorna')).toBe('Új⧸Csatorna')
  })

  it('a pontos egyezést részesíti előnyben', async () => {
    await mkdir(join(root, 'Alex Finn'), { recursive: true })
    expect(await resolveChannelDir(root, 'Alex Finn')).toBe('Alex Finn')
  })

  it('nem létező gyökérnél sem dob hibát', async () => {
    expect(await resolveChannelDir(join(root, 'nincs'), 'X')).toBe('X')
  })
})

describe('videoDir és transcriptFile', () => {
  it('beágyazott elrendezést ad: <Csatorna>/<Cím>', () => {
    expect(videoDir(root, 'Alex Finn', 'A: cím?')).toBe(
      join(root, 'Alex Finn', 'A： cím？'),
    )
  })

  it('a vault fájlnév-konvencióját követi', () => {
    expect(transcriptFile('/x/y', 'A cím')).toBe(
      '/x/y/Youtube - A cím_transcript.md',
    )
  })

  it('a fájlnévben is szanitizál', () => {
    expect(transcriptFile('/x/y', 'a/b')).toBe(
      '/x/y/Youtube - a⧸b_transcript.md',
    )
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/paths.test.ts`
Elvárt: FAIL — `Cannot find module './paths.js'`

- [ ] **7. lépés: Írd meg az útvonalszámítást**

`src/vault/paths.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSegment } from './sanitize.js'

/**
 * Megkeresi a csatorna meglévő mappáját a vaultban, kis-nagybetű-érzéketlenül.
 * Ha nincs, a szanitizált nevet adja vissza — a mappát a publisher hozza létre.
 */
export async function resolveChannelDir(
  root: string,
  channel: string,
): Promise<string> {
  const wanted = sanitizeSegment(channel)
  let entries: string[]
  try {
    const dirents = await readdir(root, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return wanted
  }

  const exact = entries.find((e) => e === wanted)
  if (exact) return exact

  const lower = wanted.toLocaleLowerCase()
  return entries.find((e) => e.toLocaleLowerCase() === lower) ?? wanted
}

/** A videó mappája: `<gyökér>/<Csatorna>/<Cím>` — a többségi, beágyazott alak. */
export function videoDir(
  root: string,
  channelDir: string,
  title: string,
): string {
  return join(root, channelDir, sanitizeSegment(title))
}

/** A vault konvenciója: `Youtube - <cím>_<típus>.md`. */
export function transcriptFile(videoDirPath: string, title: string): string {
  return join(videoDirPath, `Youtube - ${sanitizeSegment(title)}_transcript.md`)
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/vault/paths.test.ts`
Elvárt: PASS, 7 teszt

- [ ] **9. lépés: Commitolj**

```bash
git add src/vault/sanitize.ts src/vault/sanitize.test.ts src/vault/paths.ts src/vault/paths.test.ts
git commit -m "feat(vault): yt-dlp-kompatibilis útvonalszámítás csatornaegyeztetéssel"
```

---

### Feladat 7: Renderelés és Markdown-linter

**Fájlok:**
- Létrehoz: `src/vault/lint.ts`, `src/vault/render.ts`
- Teszt: `src/vault/lint.test.ts`, `src/vault/render.test.ts`

**Interfészek:**
- Fogyaszt: `SourceItem`, `NormalizedTranscript` (Feladat 1),
  `toParagraphs` (Feladat 4)
- Előállít: `lintVaultMarkdown(md: string): string[]`,
  `renderTranscriptNote(item, transcript, generatorVersion): string`

> A linter nem kényelmi funkció: a vault linkelési szabálya invariáns, és ez
> teszi teszteltté ahelyett, hogy remény maradna.

- [ ] **1. lépés: Írd meg a linter bukó tesztjét**

`src/vault/lint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lintVaultMarkdown } from './lint.js'

describe('lintVaultMarkdown', () => {
  it('elfogadja a szögletes zárójeles linket', () => {
    expect(lintVaultMarkdown('lásd [Terv](<./terv.md>)')).toEqual([])
  })

  it('elutasítja a wikilinket', () => {
    const errors = lintVaultMarkdown('lásd [[Terv]]')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/wikilink/i)
  })

  it('elutasítja a szögletes zárójel nélküli linket', () => {
    const errors = lintVaultMarkdown('lásd [Terv](./terv.md)')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/szögletes/i)
  })

  it('a képhivatkozást is ellenőrzi', () => {
    expect(lintVaultMarkdown('![kép](kep.png)')).toHaveLength(1)
  })

  it('több hibát is összegyűjt', () => {
    expect(lintVaultMarkdown('[[A]] és [B](c.md)')).toHaveLength(2)
  })

  it('a nyers URL-t nem tekinti Markdown-linknek', () => {
    expect(lintVaultMarkdown('🌐 <https://example.com>')).toEqual([])
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/lint.test.ts`
Elvárt: FAIL — `Cannot find module './lint.js'`

- [ ] **3. lépés: Írd meg a lintert**

`src/vault/lint.ts`:

```ts
const WIKILINK = /\[\[[^\]]+\]\]/g
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]*)\)/g

/**
 * A vault írási szabályai invariánsok, nem konvenciók: wikilink tilos, és
 * minden link célja szögletes zárójelben áll. Hibalistát ad; üres lista = jó.
 */
export function lintVaultMarkdown(md: string): string[] {
  const errors: string[] = []

  for (const m of md.matchAll(WIKILINK)) {
    errors.push(`wikilink tiltott: ${m[0]}`)
  }

  for (const m of md.matchAll(MARKDOWN_LINK)) {
    const dest = m[1]!
    if (!(dest.startsWith('<') && dest.endsWith('>'))) {
      errors.push(`a link célja nem szögletes zárójelben áll: ${m[0]}`)
    }
  }

  return errors
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/vault/lint.test.ts`
Elvárt: PASS, 6 teszt

- [ ] **5. lépés: Írd meg a renderelés bukó tesztjét**

`src/vault/render.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { NormalizedTranscript, SourceItem } from '../types.js'
import { lintVaultMarkdown } from './lint.js'
import { renderTranscriptNote } from './render.js'

const ITEM: SourceItem = {
  videoId: 'q6p-_W6_VoM',
  title: 'Agent Orchestration',
  channel: 'Burke Holland',
  uploadedAt: '2026-07-14',
  url: 'https://www.youtube.com/watch?v=q6p-_W6_VoM',
  subtitlePath: '/downloads/x.en.srt',
  mediaPath: '/downloads/x.mp4',
}

const TRANSCRIPT: NormalizedTranscript = {
  lines: ['Első sor.', 'Második sor.'],
  wordsRaw: 11468,
  wordsNormalized: 3939,
  captionSource: 'creator',
  punctuationDensity: 5.4,
}

describe('renderTranscriptNote', () => {
  it('YAML frontmatterrel kezdődik', () => {
    expect(renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0').startsWith('---\n')).toBe(true)
  })

  it('rögzíti a származást, hogy a mérés tudja, mit mér', () => {
    const md = renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0')
    expect(md).toContain('video_id: q6p-_W6_VoM')
    expect(md).toContain('transcript_source: creator_captions')
    expect(md).toContain('words_raw: 11468')
    expect(md).toContain('words_normalized: 3939')
    expect(md).toContain('generator: transcript-refinery@0.1.0')
  })

  it('automatikus feliratnál más származást ír', () => {
    const md = renderTranscriptNote(
      ITEM,
      { ...TRANSCRIPT, captionSource: 'auto' },
      '0.1.0',
    )
    expect(md).toContain('transcript_source: auto_captions')
  })

  it('a külső hivatkozást 🌐 emojival és szögletes zárójellel adja', () => {
    const md = renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0')
    expect(md).toContain('🌐 <https://www.youtube.com/watch?v=q6p-_W6_VoM>')
  })

  it('a szöveget bekezdésbe fűzi, nem soronként adja', () => {
    const md = renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0')
    expect(md).toContain('Első sor. Második sor.')
  })

  it('átmegy a vault linterén', () => {
    expect(lintVaultMarkdown(renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0'))).toEqual([])
  })

  it('a kettőspontot tartalmazó címet idézőjelezi a YAML-ben', () => {
    const md = renderTranscriptNote({ ...ITEM, title: 'Cím: alcím' }, TRANSCRIPT, '0.1.0')
    expect(md).toContain('title: "Cím: alcím"')
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/render.test.ts`
Elvárt: FAIL — `Cannot find module './render.js'`

- [ ] **7. lépés: Írd meg a renderelést**

`src/vault/render.ts`:

```ts
import { toParagraphs } from '../normalize/dedupe.js'
import type { NormalizedTranscript, SourceItem } from '../types.js'

/** YAML-biztos skalár: idézőjelezünk, ha a szöveg különleges karaktert tartalmaz. */
function yamlScalar(value: string): string {
  if (/^[\w .@-]+$/u.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Normalizált átirat → vault-jegyzet. A frontmatter rögzíti a származást;
 * enélkül a későbbi mérés nem tudná, milyen minőségű bemeneten dolgozott.
 */
export function renderTranscriptNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
): string {
  const source =
    transcript.captionSource === 'creator' ? 'creator_captions' : 'auto_captions'

  const frontmatter = [
    '---',
    `video_id: ${yamlScalar(item.videoId)}`,
    `title: ${yamlScalar(item.title)}`,
    `channel: ${yamlScalar(item.channel)}`,
    `uploaded: ${yamlScalar(item.uploadedAt)}`,
    `url: ${yamlScalar(item.url)}`,
    `transcript_source: ${source}`,
    'transcript_model: null',
    `words_raw: ${transcript.wordsRaw}`,
    `words_normalized: ${transcript.wordsNormalized}`,
    `punctuation_density: ${transcript.punctuationDensity.toFixed(2)}`,
    `generated_at: ${new Date().toISOString()}`,
    `generator: transcript-refinery@${generatorVersion}`,
    '---',
  ].join('\n')

  const body = [
    '',
    `# ${item.title}`,
    '',
    `🌐 <${item.url}>`,
    '',
    '---',
    '',
    toParagraphs(transcript.lines),
    '',
  ].join('\n')

  return frontmatter + body
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/vault/render.test.ts`
Elvárt: PASS, 7 teszt

- [ ] **9. lépés: Commitolj**

```bash
git add src/vault/lint.ts src/vault/lint.test.ts src/vault/render.ts src/vault/render.test.ts
git commit -m "feat(vault): jegyzet-renderelés frontmatterrel és linkszabály-linter"
```

---

### Feladat 8: Állapottár

**Fájlok:**
- Létrehoz: `src/state/db.ts`
- Teszt: `src/state/db.test.ts`

**Interfészek:**
- Fogyaszt: `SourceItem`, `CaptionSource` (Feladat 1)
- Előállít: `openState(path: string): StateStore`, és rajta:
  `recordVideo(item: SourceItem): void`,
  `recordTranscript(videoId, source, wordsRaw, wordsNormalized): void`,
  `recordArtifact(videoId, kind, status, path, error): void`,
  `isDone(videoId: string, kind: string): boolean`,
  `listPending(items: SourceItem[], kind: string): SourceItem[]`,
  `close(): void`

> **Miért SQLite és nem JSON:** egy több órás, több száz elemű futás alatt a
> teljes fájl elemenkénti újraírása korrupciós kockázat. A `node:sqlite`
> beépített (verifikálva Node 26.2.0-n), tehát nulla függőség és nincs natív
> fordítás. A folytathatóság ebből ingyen adódik: az újrafuttatás kihagyja a
> késznek jelölt elemeket.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/state/db.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { openState, type StateStore } from './db.js'

const item = (videoId: string): SourceItem => ({
  videoId,
  title: `Cím ${videoId}`,
  channel: 'Csatorna',
  uploadedAt: '2026-07-14',
  url: `https://www.youtube.com/watch?v=${videoId}`,
  subtitlePath: `/d/${videoId}.srt`,
  mediaPath: null,
})

let store: StateStore

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'refinery-state-'))
  store = openState(join(dir, 'state.db'))
})

afterEach(() => store.close())

describe('StateStore', () => {
  it('egy videó kétszeri rögzítése nem hoz létre duplikátumot', () => {
    store.recordVideo(item('abc'))
    store.recordVideo(item('abc'))
    expect(store.listPending([item('abc')], 'transcript')).toHaveLength(1)
  })

  it('a sikeresen kész elemet kihagyja a függőben lévők közül', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.listPending([item('abc')], 'transcript')).toEqual([])
  })

  it('a hibás elemet nem tekinti késznek, hogy újrapróbálható legyen', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'failed', null, 'nincs felirat')
    expect(store.listPending([item('abc')], 'transcript')).toHaveLength(1)
  })

  it('megkülönbözteti a soha nem próbáltat a hibásan végződőtől', () => {
    store.recordVideo(item('abc'))
    expect(store.isDone('abc', 'transcript')).toBe(false)
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('abc', 'transcript')).toBe(true)
  })

  it('a típusokat külön követi', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    expect(store.isDone('abc', 'summary')).toBe(false)
  })

  it('rögzíti az átirat származását és szószámait', () => {
    store.recordVideo(item('abc'))
    store.recordTranscript('abc', 'auto', 11468, 3939)
    expect(store.transcriptOf('abc')).toEqual({
      source: 'auto',
      wordsRaw: 11468,
      wordsNormalized: 3939,
    })
  })

  it('újranyitás után is emlékszik', () => {
    store.recordVideo(item('abc'))
    store.recordArtifact('abc', 'transcript', 'done', '/v/a.md', null)
    const path = store.path
    store.close()
    const again = openState(path)
    expect(again.isDone('abc', 'transcript')).toBe(true)
    again.close()
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/state/db.test.ts`
Elvárt: FAIL — `Cannot find module './db.js'`

- [ ] **3. lépés: Írd meg az állapottárat**

`src/state/db.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CaptionSource, SourceItem } from '../types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  video_id      TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  channel       TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL,
  url           TEXT NOT NULL,
  subtitle_path TEXT NOT NULL,
  media_path    TEXT,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcripts (
  video_id         TEXT PRIMARY KEY REFERENCES videos(video_id),
  source           TEXT NOT NULL,
  words_raw        INTEGER NOT NULL,
  words_normalized INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  video_id   TEXT NOT NULL REFERENCES videos(video_id),
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT,
  error      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, kind)
);
`

export interface TranscriptRecord {
  source: CaptionSource
  wordsRaw: number
  wordsNormalized: number
}

export interface StateStore {
  readonly path: string
  recordVideo(item: SourceItem): void
  recordTranscript(
    videoId: string,
    source: CaptionSource,
    wordsRaw: number,
    wordsNormalized: number,
  ): void
  recordArtifact(
    videoId: string,
    kind: string,
    status: 'done' | 'failed',
    path: string | null,
    error: string | null,
  ): void
  transcriptOf(videoId: string): TranscriptRecord | null
  isDone(videoId: string, kind: string): boolean
  listPending(items: SourceItem[], kind: string): SourceItem[]
  close(): void
}

/**
 * Megnyitja (és szükség esetén létrehozza) az állapottárat. A séma
 * idempotens, tehát az újranyitás biztonságos.
 */
export function openState(path: string): StateStore {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  const now = () => new Date().toISOString()

  // Önálló függvény, nem objektum-metódus: a `listPending` így hivatkozhat rá
  // `this` nélkül, ami strict módban típushibát adna.
  const isDone = (videoId: string, kind: string): boolean =>
    db
      .prepare(
        "SELECT 1 AS ok FROM artifacts WHERE video_id = ? AND kind = ? AND status = 'done'",
      )
      .get(videoId, kind) !== undefined

  return {
    path,

    recordVideo(item) {
      db.prepare(
        `INSERT INTO videos
           (video_id, title, channel, uploaded_at, url, subtitle_path, media_path, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           title = excluded.title,
           subtitle_path = excluded.subtitle_path,
           media_path = excluded.media_path`,
      ).run(
        item.videoId,
        item.title,
        item.channel,
        item.uploadedAt,
        item.url,
        item.subtitlePath,
        item.mediaPath,
        now(),
      )
    },

    recordTranscript(videoId, source, wordsRaw, wordsNormalized) {
      db.prepare(
        `INSERT INTO transcripts
           (video_id, source, words_raw, words_normalized, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           source = excluded.source,
           words_raw = excluded.words_raw,
           words_normalized = excluded.words_normalized`,
      ).run(videoId, source, wordsRaw, wordsNormalized, now())
    },

    recordArtifact(videoId, kind, status, path, error) {
      db.prepare(
        `INSERT INTO artifacts (video_id, kind, status, path, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id, kind) DO UPDATE SET
           status = excluded.status,
           path = excluded.path,
           error = excluded.error,
           created_at = excluded.created_at`,
      ).run(videoId, kind, status, path, error, now())
    },

    transcriptOf(videoId) {
      const row = db
        .prepare(
          'SELECT source, words_raw, words_normalized FROM transcripts WHERE video_id = ?',
        )
        .get(videoId) as
        | { source: string; words_raw: number; words_normalized: number }
        | undefined
      if (!row) return null
      return {
        source: row.source as CaptionSource,
        wordsRaw: row.words_raw,
        wordsNormalized: row.words_normalized,
      }
    },

    isDone,

    listPending(items, kind) {
      return items.filter((i) => !isDone(i.videoId, kind))
    },

    close() {
      db.close()
    },
  }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/state/db.test.ts`
Elvárt: PASS, 7 teszt

- [ ] **5. lépés: Commitolj**

```bash
git add src/state/db.ts src/state/db.test.ts
git commit -m "feat(state): SQLite állapottár folytatható futásokhoz"
```

---

### Feladat 9: Konfiguráció és eseményfolyam

**Fájlok:**
- Létrehoz: `src/config.ts`, `src/events.ts`
- Teszt: `src/config.test.ts`, `src/events.test.ts`

**Interfészek:**
- Fogyaszt: `CaptionSource` (Feladat 1)
- Előállít: `loadConfig(env): Config`, `validateConfig(cfg): Promise<void>`,
  `RunEvent`, `EventSink`, `collectEvents()`

> **Miért most, és miért a magban:** a mag struktúrált eseményeket bocsát ki,
> nem `console.log`-ol. Ha ez utólag kerülne be, a mag addigra tele lenne
> kiírással, és a későbbi felületek (élő haladásjelzés, naplófájl) nem
> tudnának rákapcsolódni. A konfiguráció validálása pedig azért indulási
> feltétel, mert két gépen két útvonal van — beégetett útvonal egyiken sem jó.

- [ ] **1. lépés: Írd meg az események bukó tesztjét**

`src/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectEvents, summarize } from './events.js'

describe('collectEvents', () => {
  it('sorrendben gyűjti az eseményeket', () => {
    const { sink, events } = collectEvents()
    sink({ type: 'scan:start', source: 'folder' })
    sink({ type: 'scan:found', count: 3 })
    expect(events.map((e) => e.type)).toEqual(['scan:start', 'scan:found'])
  })
})

describe('summarize', () => {
  it('megszámolja a sikeres, kihagyott és hibás elemeket', () => {
    const { sink, events } = collectEvents()
    sink({ type: 'item:published', videoId: 'a', path: '/x/a.md' })
    sink({ type: 'item:skipped', videoId: 'b', reason: 'már feldolgozva' })
    sink({ type: 'item:failed', videoId: 'c', error: 'nincs felirat' })
    sink({ type: 'item:published', videoId: 'd', path: '/x/d.md' })
    expect(summarize(events)).toEqual({ succeeded: 2, skipped: 1, failed: 1 })
  })

  it('üres folyamra nullákat ad', () => {
    expect(summarize([])).toEqual({ succeeded: 0, skipped: 0, failed: 0 })
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/events.test.ts`
Elvárt: FAIL — `Cannot find module './events.js'`

- [ ] **3. lépés: Írd meg az eseményfolyamot**

`src/events.ts`:

```ts
import type { CaptionSource } from './types.js'

/**
 * A mag kimenete. A CLI ezt haladásjelzéssé rendereli, a naplózó JSON
 * sorokká — a mag maga soha nem ír a konzolra.
 */
export type RunEvent =
  | { type: 'scan:start'; source: string }
  | { type: 'scan:found'; count: number }
  | { type: 'item:start'; videoId: string; title: string }
  | { type: 'item:parsed'; videoId: string; cues: number }
  | {
      type: 'item:normalized'
      videoId: string
      wordsRaw: number
      wordsNormalized: number
      captionSource: CaptionSource
    }
  | { type: 'item:published'; videoId: string; path: string }
  | { type: 'item:skipped'; videoId: string; reason: string }
  | { type: 'item:failed'; videoId: string; error: string }
  | { type: 'run:done'; succeeded: number; skipped: number; failed: number }

export type EventSink = (event: RunEvent) => void

export interface RunSummary {
  succeeded: number
  skipped: number
  failed: number
}

/** Teszteléshez és a futás végi riporthoz: memóriában gyűjti az eseményeket. */
export function collectEvents(): { sink: EventSink; events: RunEvent[] } {
  const events: RunEvent[] = []
  return { sink: (e) => void events.push(e), events }
}

export function summarize(events: readonly RunEvent[]): RunSummary {
  let succeeded = 0
  let skipped = 0
  let failed = 0
  for (const e of events) {
    if (e.type === 'item:published') succeeded++
    else if (e.type === 'item:skipped') skipped++
    else if (e.type === 'item:failed') failed++
  }
  return { succeeded, skipped, failed }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/events.test.ts`
Elvárt: PASS, 3 teszt

- [ ] **5. lépés: Írd meg a konfiguráció bukó tesztjét**

`src/config.test.ts`:

```ts
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, validateConfig } from './config.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-config-'))
})

describe('loadConfig', () => {
  it('a vault jegyzet-gyökerét a VAULT_PATH alá számolja', () => {
    const cfg = loadConfig({
      VAULT_PATH: '/v',
      PINCHFLAT_DOWNLOADS: '/d',
    })
    expect(cfg.vaultPath).toBe('/v')
    expect(cfg.notesRoot).toBe('/v/Resources/Videos/YouTube')
  })

  it('az állapottárat alapból a repóba teszi, nem a vaultba', () => {
    const cfg = loadConfig({ VAULT_PATH: '/v', PINCHFLAT_DOWNLOADS: '/d' })
    expect(cfg.statePath).toContain('.state')
    expect(cfg.statePath.startsWith('/v')).toBe(false)
  })

  it('hiányzó VAULT_PATH esetén beszédes hibát dob', () => {
    expect(() => loadConfig({ PINCHFLAT_DOWNLOADS: '/d' })).toThrow(/VAULT_PATH/)
  })

  it('hiányzó PINCHFLAT_DOWNLOADS esetén beszédes hibát dob', () => {
    expect(() => loadConfig({ VAULT_PATH: '/v' })).toThrow(/PINCHFLAT_DOWNLOADS/)
  })

  it('a relatív útvonalat elutasítja, mert két gépen két útvonal van', () => {
    expect(() =>
      loadConfig({ VAULT_PATH: './vault', PINCHFLAT_DOWNLOADS: '/d' }),
    ).toThrow(/abszolút/)
  })
})

describe('validateConfig', () => {
  it('hibát dob, ha a vault nem git-repó', async () => {
    await mkdir(join(dir, 'vault'), { recursive: true })
    await mkdir(join(dir, 'downloads'), { recursive: true })
    const cfg = loadConfig({
      VAULT_PATH: join(dir, 'vault'),
      PINCHFLAT_DOWNLOADS: join(dir, 'downloads'),
    })
    await expect(validateConfig(cfg)).rejects.toThrow(/git/)
  })

  it('hibát dob, ha a letöltési mappa nem létezik', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    const cfg = loadConfig({
      VAULT_PATH: join(dir, 'vault'),
      PINCHFLAT_DOWNLOADS: join(dir, 'nincs'),
    })
    await expect(validateConfig(cfg)).rejects.toThrow(/PINCHFLAT_DOWNLOADS/)
  })

  it('átmegy, ha minden a helyén van', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    await mkdir(join(dir, 'downloads'), { recursive: true })
    const cfg = loadConfig({
      VAULT_PATH: join(dir, 'vault'),
      PINCHFLAT_DOWNLOADS: join(dir, 'downloads'),
    })
    await expect(validateConfig(cfg)).resolves.toBeUndefined()
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/config.test.ts`
Elvárt: FAIL — `Cannot find module './config.js'`

- [ ] **7. lépés: Írd meg a konfigurációt**

`src/config.ts`:

```ts
import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

/** A vaulton belüli jegyzet-gyűjtemény, ahova a publisher ír. */
const NOTES_SUBDIR = 'Resources/Videos/YouTube'

const EnvSchema = z.object({
  VAULT_PATH: z
    .string()
    .min(1, 'A VAULT_PATH kötelező.')
    .refine(isAbsolute, 'A VAULT_PATH abszolút útvonal kell legyen.'),
  PINCHFLAT_DOWNLOADS: z
    .string()
    .min(1, 'A PINCHFLAT_DOWNLOADS kötelező.')
    .refine(isAbsolute, 'A PINCHFLAT_DOWNLOADS abszolút útvonal kell legyen.'),
  REFINERY_STATE_PATH: z.string().optional(),
})

export interface Config {
  vaultPath: string
  notesRoot: string
  pinchflatDownloads: string
  statePath: string
}

/**
 * Környezeti változók → konfiguráció. Tisztán szinkron és fájlrendszertől
 * független, hogy tesztelhető legyen; a létezés-ellenőrzés a
 * `validateConfig` dolga.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    const name = first.path[0] ?? 'konfiguráció'
    throw new Error(`${String(name)}: ${first.message}`)
  }
  const e = parsed.data
  return {
    vaultPath: e.VAULT_PATH,
    notesRoot: join(e.VAULT_PATH, NOTES_SUBDIR),
    pinchflatDownloads: e.PINCHFLAT_DOWNLOADS,
    statePath: e.REFINERY_STATE_PATH ?? join(process.cwd(), '.state', 'refinery.db'),
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Indulási feltételek ellenőrzése. A program nem indul el, ha a vault nem
 * elérhető vagy nem git-repó — a publisher git-műveletei enélkül elhasalnának
 * a futás közepén.
 */
export async function validateConfig(cfg: Config): Promise<void> {
  if (!(await isDirectory(cfg.vaultPath))) {
    throw new Error(`VAULT_PATH: nem létező mappa: ${cfg.vaultPath}`)
  }
  if (!(await isDirectory(join(cfg.vaultPath, '.git')))) {
    throw new Error(`VAULT_PATH: nem git-repó: ${cfg.vaultPath}`)
  }
  if (!(await isDirectory(cfg.pinchflatDownloads))) {
    throw new Error(
      `PINCHFLAT_DOWNLOADS: nem létező mappa: ${cfg.pinchflatDownloads}`,
    )
  }
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/config.test.ts`
Elvárt: PASS, 8 teszt

- [ ] **9. lépés: Commitolj**

```bash
git add src/config.ts src/config.test.ts src/events.ts src/events.test.ts
git commit -m "feat(core): konfiguráció-validálás és struktúrált eseményfolyam"
```

---

### Feladat 10: Forrás-adapter — Pinchflat letöltési mappa

**Fájlok:**
- Létrehoz: `src/source/types.ts`, `src/source/folder.ts`
- Teszt: `src/source/folder.test.ts`

**Interfészek:**
- Fogyaszt: `SourceItem` (Feladat 1)
- Előállít: `Source` interfész, `folderSource(root: string): Source`

> **A metaadat forrása az `.info.json`, nem a mappanév.** Ez teszi
> tárgytalanná a csatornanév-normalizálás problémáját: a kanonikus
> csatornanév, a videóazonosító, az URL és a dátum mind a metaadatfájlban van.
> A mappanév csak a fájlok megtalálására kell.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/source/folder.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { folderSource } from './folder.js'

let root: string

async function makeVideo(
  channelDir: string,
  base: string,
  info: Record<string, unknown>,
  extras: { srt?: boolean; vtt?: boolean; mp4?: boolean } = { srt: true },
): Promise<void> {
  const dir = join(root, 'youtube', channelDir)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${base}.info.json`), JSON.stringify(info), 'utf8')
  if (extras.srt) await writeFile(join(dir, `${base}.en.srt`), '', 'utf8')
  if (extras.vtt) await writeFile(join(dir, `${base}.hu.vtt`), '', 'utf8')
  if (extras.mp4) await writeFile(join(dir, `${base}.mp4`), '', 'utf8')
}

const INFO = {
  id: 'q6p-_W6_VoM',
  title: 'Agent Orchestration',
  channel: 'Burke Holland',
  upload_date: '20260714',
  webpage_url: 'https://www.youtube.com/watch?v=q6p-_W6_VoM',
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-source-'))
})

describe('folderSource', () => {
  it('a metaadatot az .info.json-ból veszi, nem a mappanévből', async () => {
    await makeVideo('Burke_Holland', 'Agent Orchestration', INFO)
    const [item] = await folderSource(root).discover()
    expect(item!.videoId).toBe('q6p-_W6_VoM')
    expect(item!.channel).toBe('Burke Holland')
    expect(item!.title).toBe('Agent Orchestration')
  })

  it('a feltöltési dátumot ISO alakra hozza', async () => {
    await makeVideo('Burke_Holland', 'Agent Orchestration', INFO)
    const [item] = await folderSource(root).discover()
    expect(item!.uploadedAt).toBe('2026-07-14')
  })

  it('megtalálja az azonos alapnevű feliratot', async () => {
    await makeVideo('Burke_Holland', 'Agent Orchestration', INFO)
    const [item] = await folderSource(root).discover()
    expect(item!.subtitlePath.endsWith('Agent Orchestration.en.srt')).toBe(true)
  })

  it('a .vtt feliratot is elfogadja', async () => {
    await makeVideo('C', 'V', INFO, { vtt: true })
    const [item] = await folderSource(root).discover()
    expect(item!.subtitlePath.endsWith('.vtt')).toBe(true)
  })

  it('rögzíti a médiafájl útvonalát, ha van', async () => {
    await makeVideo('C', 'V', INFO, { srt: true, mp4: true })
    const [item] = await folderSource(root).discover()
    expect(item!.mediaPath).not.toBeNull()
  })

  it('kihagyja a felirat nélküli videót', async () => {
    await makeVideo('C', 'V', INFO, {})
    expect(await folderSource(root).discover()).toEqual([])
  })

  it('a uploader mezőre esik vissza, ha nincs channel', async () => {
    const { channel: _drop, ...rest } = INFO
    await makeVideo('C', 'V', { ...rest, uploader: 'Feltöltő' })
    const [item] = await folderSource(root).discover()
    expect(item!.channel).toBe('Feltöltő')
  })

  it('átugorja az értelmezhetetlen .info.json fájlt, nem áll le', async () => {
    await mkdir(join(root, 'youtube', 'C'), { recursive: true })
    await writeFile(join(root, 'youtube', 'C', 'rossz.info.json'), '{', 'utf8')
    await writeFile(join(root, 'youtube', 'C', 'rossz.en.srt'), '', 'utf8')
    await makeVideo('C', 'jo', INFO)
    expect(await folderSource(root).discover()).toHaveLength(1)
  })

  it('nem létező gyökérre üres listát ad', async () => {
    expect(await folderSource(join(root, 'nincs')).discover()).toEqual([])
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/source/folder.test.ts`
Elvárt: FAIL — `Cannot find module './folder.js'`

- [ ] **3. lépés: Írd meg a `Source` interfészt**

`src/source/types.ts`:

```ts
import type { SourceItem } from '../types.js'

/**
 * Egy ingest-forrás. A v1-ben egy implementáció van (letöltési mappa); a
 * második, URL-alapú implementáció igazolja majd visszamenőleg ezt a vágást.
 */
export interface Source {
  readonly id: string
  discover(): Promise<SourceItem[]>
}
```

- [ ] **4. lépés: Írd meg a mappa-adaptert**

`src/source/folder.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SourceItem } from '../types.js'
import type { Source } from './types.js'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/** `20260714` → `2026-07-14`. Ismeretlen alaknál változatlanul hagyja. */
function isoDate(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

/**
 * Megkeresi a metaadatfájl mellett álló, azonos alapnevű feliratot. A
 * Pinchflat `<alapnév>.<nyelv>.<kiterjesztés>` alakban ír, ezért előtag
 * szerint keresünk, nem pontos névre.
 */
function findSibling(
  files: readonly string[],
  infoPath: string,
  extensions: readonly string[],
): string | null {
  const base = infoPath.slice(0, -'.info.json'.length)
  const dir = dirname(infoPath)
  for (const file of files) {
    if (dirname(file) !== dir) continue
    if (!file.startsWith(base)) continue
    if (extensions.some((ext) => file.toLowerCase().endsWith(ext))) return file
  }
  return null
}

/**
 * A letöltő mappájából olvas. Offline és determinisztikus: a fejlesztés és a
 * tesztelés nem függ hálózattól.
 */
export function folderSource(root: string): Source {
  return {
    id: 'folder',

    async discover(): Promise<SourceItem[]> {
      const files = await walk(root)
      const infos = files.filter((f) => f.endsWith('.info.json'))
      const items: SourceItem[] = []

      for (const infoPath of infos) {
        let info: Record<string, unknown>
        try {
          // Szándékosan `unknown`, nem `any`: a JSON.parse kimenetét
          // ellenőrizzük, mielőtt bármit kiolvasnánk belőle.
          const parsed: unknown = JSON.parse(await readFile(infoPath, 'utf8'))
          if (typeof parsed !== 'object' || parsed === null) continue
          info = parsed as Record<string, unknown>
        } catch {
          continue // sérült metaadat: átugorjuk, a futás nem áll le
        }

        const videoId = typeof info.id === 'string' ? info.id : null
        const title = typeof info.title === 'string' ? info.title : null
        if (!videoId || !title) continue

        const subtitlePath = findSibling(files, infoPath, SUBTITLE_EXTENSIONS)
        if (!subtitlePath) continue // felirat nélkül nincs mit feldolgozni

        const channel =
          (typeof info.channel === 'string' && info.channel) ||
          (typeof info.uploader === 'string' && info.uploader) ||
          'ismeretlen csatorna'

        const url =
          typeof info.webpage_url === 'string'
            ? info.webpage_url
            : `https://www.youtube.com/watch?v=${videoId}`

        items.push({
          videoId,
          title,
          channel,
          uploadedAt: isoDate(info.upload_date),
          url,
          subtitlePath,
          mediaPath: findSibling(files, infoPath, ['.mp4', '.mkv', '.webm']),
        })
      }

      return items
    },
  }
}
```

- [ ] **5. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/source/folder.test.ts`
Elvárt: PASS, 9 teszt

- [ ] **6. lépés: Commitolj**

```bash
git add src/source/
git commit -m "feat(source): Pinchflat mappa-adapter az .info.json metaadataival"
```

---

### Feladat 11: Publisher és git-műveletek

**Fájlok:**
- Létrehoz: `src/vault/publish.ts`, `src/vault/git.ts`
- Teszt: `src/vault/publish.test.ts`, `src/vault/git.test.ts`

**Interfészek:**
- Fogyaszt: semmit a korábbi feladatokból
- Előállít: `publishNote(filePath, content, opts): Promise<PublishResult>`,
  `gitPullFfOnly(repo): Promise<void>`,
  `gitCommitPaths(repo, paths, message): Promise<boolean>`,
  `gitPush(repo): Promise<PushResult>`

> **A commit útvonalra szűkített, nem `git add -A`.** Így fizikailag képtelen
> felsöpörni a félbehagyott kézi szerkesztéseket. És azért kell egyáltalán
> commitolni, mert enélkül a munkafa piszkos marad — és akkor a *következő*
> futás előtti `git pull --ff-only` megbicsaklik.

- [ ] **1. lépés: Írd meg a publisher bukó tesztjét**

`src/vault/publish.test.ts`:

```ts
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { publishNote } from './publish.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-publish-'))
})

describe('publishNote', () => {
  it('létrehozza a hiányzó mappákat és kiírja a fájlt', async () => {
    const target = join(root, 'Csatorna', 'Cím', 'jegyzet.md')
    const result = await publishNote(target, 'tartalom', {})
    expect(result.status).toBe('written')
    expect(await readFile(target, 'utf8')).toBe('tartalom')
  })

  it('létező fájlt nem ír felül, hanem kihagy', async () => {
    const target = join(root, 'jegyzet.md')
    await writeFile(target, 'kézi tartalom', 'utf8')
    const result = await publishNote(target, 'gépi tartalom', {})
    expect(result.status).toBe('skipped')
    expect(await readFile(target, 'utf8')).toBe('kézi tartalom')
  })

  it('--force esetén felülír', async () => {
    const target = join(root, 'jegyzet.md')
    await writeFile(target, 'régi', 'utf8')
    const result = await publishNote(target, 'új', { force: true })
    expect(result.status).toBe('written')
    expect(await readFile(target, 'utf8')).toBe('új')
  })

  it('dry-run módban semmit nem ír ki', async () => {
    const target = join(root, 'uj', 'jegyzet.md')
    const result = await publishNote(target, 'tartalom', { dryRun: true })
    expect(result.status).toBe('written')
    await expect(readFile(target, 'utf8')).rejects.toThrow()
  })

  it('meglévő mappába is ír', async () => {
    await mkdir(join(root, 'meglevo'), { recursive: true })
    const target = join(root, 'meglevo', 'jegyzet.md')
    expect((await publishNote(target, 'x', {})).status).toBe('written')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/publish.test.ts`
Elvárt: FAIL — `Cannot find module './publish.js'`

- [ ] **3. lépés: Írd meg a publishert**

`src/vault/publish.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'

export interface PublishOptions {
  force?: boolean
  dryRun?: boolean
}

export interface PublishResult {
  status: 'written' | 'skipped'
  path: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Write-once fájlírás. A vaultban évek kézi munkája van; létező fájlt
 * kizárólag explicit `force` mellett írunk felül.
 */
export async function publishNote(
  filePath: string,
  content: string,
  opts: PublishOptions,
): Promise<PublishResult> {
  if (!opts.force && (await exists(filePath))) {
    return { status: 'skipped', path: filePath }
  }
  if (opts.dryRun) {
    return { status: 'written', path: filePath }
  }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { status: 'written', path: filePath }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/vault/publish.test.ts`
Elvárt: PASS, 5 teszt

- [ ] **5. lépés: Írd meg a git bukó tesztjét**

`src/vault/git.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { gitCommitPaths, isDirty } from './git.js'

const run = promisify(execFile)
let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'refinery-git-'))
  await run('git', ['init', '-b', 'main'], { cwd: repo })
  await run('git', ['config', 'user.email', 'teszt@example.com'], { cwd: repo })
  await run('git', ['config', 'user.name', 'Teszt'], { cwd: repo })
  await writeFile(join(repo, 'alap.txt'), 'alap', 'utf8')
  await run('git', ['add', 'alap.txt'], { cwd: repo })
  await run('git', ['commit', '-m', 'alap'], { cwd: repo })
})

describe('gitCommitPaths', () => {
  it('csak a megadott útvonalakat commitolja', async () => {
    await writeFile(join(repo, 'gepi.md'), 'gépi', 'utf8')
    await writeFile(join(repo, 'kezi.md'), 'félbehagyott kézi munka', 'utf8')

    const committed = await gitCommitPaths(repo, ['gepi.md'], 'docs: gépi')
    expect(committed).toBe(true)

    const { stdout } = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
    expect(stdout.trim().split('\n')).toEqual(['gepi.md'])
  })

  it('a nem commitolt kézi fájl a munkafában marad', async () => {
    await writeFile(join(repo, 'gepi.md'), 'gépi', 'utf8')
    await writeFile(join(repo, 'kezi.md'), 'kézi', 'utf8')
    await gitCommitPaths(repo, ['gepi.md'], 'docs: gépi')
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd: repo })
    expect(stdout).toContain('kezi.md')
  })

  it('üres útvonallistára nem hoz létre commitot', async () => {
    expect(await gitCommitPaths(repo, [], 'docs: semmi')).toBe(false)
  })

  it('változatlan fájlra nem hoz létre üres commitot', async () => {
    expect(await gitCommitPaths(repo, ['alap.txt'], 'docs: semmi')).toBe(false)
  })
})

describe('isDirty', () => {
  it('tisztának látja a friss repót', async () => {
    expect(await isDirty(repo)).toBe(false)
  })

  it('piszkosnak látja, ha van követetlen fájl', async () => {
    await writeFile(join(repo, 'uj.md'), 'x', 'utf8')
    expect(await isDirty(repo)).toBe(true)
  })
})
```

- [ ] **6. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/vault/git.test.ts`
Elvárt: FAIL — `Cannot find module './git.js'`

- [ ] **7. lépés: Írd meg a git-műveleteket**

`src/vault/git.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface PushResult {
  pushed: boolean
  reason?: string
}

/**
 * Futás előtti frissítés. Szándékosan `--ff-only`: ha a történet divergált,
 * inkább hasaljon el itt, mint hogy a publisher egy elavult fára írjon.
 */
export async function gitPullFfOnly(repo: string): Promise<void> {
  await run('git', ['pull', '--ff-only'], { cwd: repo })
}

/** Van-e bármilyen követetlen vagy módosított fájl a munkafában? */
export async function isDirty(repo: string): Promise<boolean> {
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: repo })
  return stdout.trim() !== ''
}

/**
 * Kizárólag a megadott útvonalakat stage-eli és commitolja. Soha nem
 * `git add -A` — így képtelen felsöpörni a félbehagyott kézi szerkesztéseket.
 * `false`-t ad, ha nem volt mit commitolni.
 */
export async function gitCommitPaths(
  repo: string,
  paths: readonly string[],
  message: string,
): Promise<boolean> {
  if (paths.length === 0) return false
  await run('git', ['add', '--', ...paths], { cwd: repo })
  const { stdout } = await run('git', ['diff', '--cached', '--name-only'], { cwd: repo })
  if (stdout.trim() === '') return false
  await run('git', ['commit', '-m', message], { cwd: repo })
  return true
}

/**
 * Push a távolira. Elhasalás esetén **nincs force és nincs
 * újrapróbálkozás** — a commit lokálisan marad, a hívó jelenti, és a
 * következő futás előtti pull rendezi.
 */
export async function gitPush(repo: string): Promise<PushResult> {
  try {
    await run('git', ['push'], { cwd: repo })
    return { pushed: true }
  } catch (error) {
    return { pushed: false, reason: (error as Error).message }
  }
}
```

- [ ] **8. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/vault/git.test.ts`
Elvárt: PASS, 6 teszt

- [ ] **9. lépés: Commitolj**

```bash
git add src/vault/publish.ts src/vault/publish.test.ts src/vault/git.ts src/vault/git.test.ts
git commit -m "feat(vault): write-once publisher és útvonalra szűkített git-commit"
```

---

### Feladat 12: Csővezeték, CLI és végponttól végpontig ellenőrzés

**Fájlok:**
- Létrehoz: `src/pipeline.ts`, `src/cli.ts`, `src/index.ts`
- Teszt: `src/pipeline.test.ts`, `src/e2e.test.ts`

**Interfészek:**
- Fogyaszt: minden korábbi feladat
- Előállít: `processItem(item, deps): Promise<ItemOutcome>`,
  `runPipeline(opts): Promise<RunSummary>`, `main(argv): Promise<number>`

> Ez a feladat köti össze a darabokat, és **itt igazolódik a roadmap mind az
> öt sikerkritériuma.** A `src/e2e.test.ts` szó szerint ezeket állítja.

- [ ] **1. lépés: Írd meg a csővezeték bukó tesztjét**

`src/pipeline.test.ts`:

```ts
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectEvents } from './events.js'
import { processItem } from './pipeline.js'
import { openState, type StateStore } from './state/db.js'
import type { SourceItem } from './types.js'

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ez egy sor.

2
00:00:01,000 --> 00:00:03,000
Ez egy sor.

3
00:00:02,000 --> 00:00:04,000
Ez egy másik sor.
`

let vault: string
let work: string
let store: StateStore
let item: SourceItem

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-pipe-'))
  vault = join(work, 'vault')
  await mkdir(vault, { recursive: true })
  const srtPath = join(work, 'video.en.srt')
  await writeFile(srtPath, SRT, 'utf8')
  store = openState(join(work, 'state.db'))
  item = {
    videoId: 'abc123',
    title: 'A cím',
    channel: 'A csatorna',
    uploadedAt: '2026-07-14',
    url: 'https://www.youtube.com/watch?v=abc123',
    subtitlePath: srtPath,
    mediaPath: null,
  }
})

afterEach(() => store.close())

describe('processItem', () => {
  it('jegyzetet ír, és a tartalomban nincs duplikált sor', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(outcome.status).toBe('published')
    const { readFile } = await import('node:fs/promises')
    const md = await readFile(outcome.path!, 'utf8')
    expect(md.match(/Ez egy sor\./g)).toHaveLength(1)
    expect(md).toContain('Ez egy másik sor.')
  })

  it('a fájlt a vault konvenciója szerint nevezi el', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(outcome.path).toContain(join('A csatorna', 'A cím', 'Youtube - A cím_transcript.md'))
  })

  it('másodszor futtatva kihagy, és nem ír semmit', async () => {
    const { sink } = collectEvents()
    await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    const second = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(second.status).toBe('skipped')
  })

  it('sérült feliratnál hibát ad, de nem dob kivételt', async () => {
    const broken = { ...item, subtitlePath: join(work, 'nincs.en.srt') }
    const { sink } = collectEvents()
    const outcome = await processItem(broken, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toBeTruthy()
  })

  it('a kiírt jegyzet átmegy a vault linterén', async () => {
    const { sink } = collectEvents()
    const outcome = await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    const { readFile } = await import('node:fs/promises')
    const { lintVaultMarkdown } = await import('./vault/lint.js')
    expect(lintVaultMarkdown(await readFile(outcome.path!, 'utf8'))).toEqual([])
  })

  it('eseményeket bocsát ki, nem ír a konzolra', async () => {
    const { sink, events } = collectEvents()
    await processItem(item, { notesRoot: vault, store, sink, version: '0.1.0', options: {} })
    expect(events.map((e) => e.type)).toContain('item:normalized')
    expect(events.map((e) => e.type)).toContain('item:published')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy bukik**

Futtasd: `mise exec -- pnpm vitest run src/pipeline.test.ts`
Elvárt: FAIL — `Cannot find module './pipeline.js'`

- [ ] **3. lépés: Írd meg a csővezetéket**

`src/pipeline.ts`:

```ts
import { readFile } from 'node:fs/promises'
import type { EventSink } from './events.js'
import { classifyCaptions, punctuationDensity } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { StateStore } from './state/db.js'
import type { NormalizedTranscript, SourceItem } from './types.js'
import { lintVaultMarkdown } from './vault/lint.js'
import { resolveChannelDir, transcriptFile, videoDir } from './vault/paths.js'
import { publishNote, type PublishOptions } from './vault/publish.js'
import { renderTranscriptNote } from './vault/render.js'

export interface PipelineDeps {
  notesRoot: string
  store: StateStore
  sink: EventSink
  version: string
  options: PublishOptions
}

export interface ItemOutcome {
  status: 'published' | 'skipped' | 'failed'
  path?: string
  error?: string
}

const ARTIFACT_KIND = 'transcript'

/** Egyetlen elem végigvitele a csővezetéken. Soha nem dob kivételt. */
export async function processItem(
  item: SourceItem,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const { notesRoot, store, sink, version, options } = deps
  sink({ type: 'item:start', videoId: item.videoId, title: item.title })
  store.recordVideo(item)

  if (!options.force && store.isDone(item.videoId, ARTIFACT_KIND)) {
    sink({ type: 'item:skipped', videoId: item.videoId, reason: 'már feldolgozva' })
    return { status: 'skipped' }
  }

  try {
    const raw = await readFile(item.subtitlePath, 'utf8')
    const cues = parseSubtitle(raw, item.subtitlePath)
    sink({ type: 'item:parsed', videoId: item.videoId, cues: cues.length })

    const rawText = cues.flatMap((c) => c.lines).join(' ')
    const lines = dedupeLines(cues)
    const normalizedText = lines.join(' ')

    const transcript: NormalizedTranscript = {
      lines,
      wordsRaw: countWords(rawText),
      wordsNormalized: countWords(normalizedText),
      captionSource: classifyCaptions(normalizedText),
      punctuationDensity: punctuationDensity(normalizedText),
    }

    sink({
      type: 'item:normalized',
      videoId: item.videoId,
      wordsRaw: transcript.wordsRaw,
      wordsNormalized: transcript.wordsNormalized,
      captionSource: transcript.captionSource,
    })
    store.recordTranscript(
      item.videoId,
      transcript.captionSource,
      transcript.wordsRaw,
      transcript.wordsNormalized,
    )

    const markdown = renderTranscriptNote(item, transcript, version)
    const lintErrors = lintVaultMarkdown(markdown)
    if (lintErrors.length > 0) {
      throw new Error(`a jegyzet megsérti a vault linkszabályát: ${lintErrors.join('; ')}`)
    }

    const channelDir = await resolveChannelDir(notesRoot, item.channel)
    const target = transcriptFile(videoDir(notesRoot, channelDir, item.title), item.title)
    const result = await publishNote(target, markdown, options)

    if (result.status === 'skipped') {
      store.recordArtifact(item.videoId, ARTIFACT_KIND, 'done', result.path, null)
      sink({ type: 'item:skipped', videoId: item.videoId, reason: 'a fájl már létezik' })
      return { status: 'skipped', path: result.path }
    }

    if (!options.dryRun) {
      store.recordArtifact(item.videoId, ARTIFACT_KIND, 'done', result.path, null)
    }
    sink({ type: 'item:published', videoId: item.videoId, path: result.path })
    return { status: 'published', path: result.path }
  } catch (error) {
    const message = (error as Error).message
    store.recordArtifact(item.videoId, ARTIFACT_KIND, 'failed', null, message)
    sink({ type: 'item:failed', videoId: item.videoId, error: message })
    return { status: 'failed', error: message }
  }
}
```

- [ ] **4. lépés: Futtasd, és győződj meg róla, hogy zöld**

Futtasd: `mise exec -- pnpm vitest run src/pipeline.test.ts`
Elvárt: PASS, 6 teszt

- [ ] **5. lépés: Írd meg a CLI-t**

`src/cli.ts` — az argumentumértelmezés a beépített `node:util` `parseArgs`
függvényével megy, tehát nincs hozzá külső függőség:

```ts
#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { loadConfig, validateConfig, type Config } from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import { classifyCaptions } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { processItem } from './pipeline.js'
import { parseSubtitle } from './subtitle/parse.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'
import type { SourceItem } from './types.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from './vault/git.js'

const VERSION = '0.1.0'

const USAGE = `refinery <parancs> [kapcsolók]

Parancsok:
  scan    Felderíti a feldolgozható videókat, és nem ír semmit.
  run     Átiratot készít és a vaultba írja.

Kapcsolók:
  --channel <név>   csak a megadott csatorna
  --limit <szám>    legfeljebb ennyi elem
  --dry-run         megmutatja, mi történne, de nem ír fájlt
  --force           létező fájlt is felülír
  --no-commit       nem commitol és nem pushol a vault repójába
`

function applyFilters(
  items: SourceItem[],
  filters: { channel?: string; limit?: number },
): SourceItem[] {
  let out = items
  if (filters.channel) {
    const wanted = filters.channel.toLocaleLowerCase()
    out = out.filter((i) => i.channel.toLocaleLowerCase() === wanted)
  }
  if (filters.limit !== undefined) out = out.slice(0, filters.limit)
  return out
}

function render(event: RunEvent): string | null {
  switch (event.type) {
    case 'scan:found':
      return `${event.count} feldolgozható videó`
    case 'item:normalized':
      return `  ${event.videoId}: ${event.wordsRaw} → ${event.wordsNormalized} szó (${event.captionSource})`
    case 'item:published':
      return `  ✓ ${event.path}`
    case 'item:skipped':
      return `  – ${event.videoId}: ${event.reason}`
    case 'item:failed':
      return `  ✗ ${event.videoId}: ${event.error}`
    default:
      return null
  }
}

async function commandScan(cfg: Config): Promise<number> {
  const items = await folderSource(cfg.pinchflatDownloads).discover()
  console.log(`${items.length} feldolgozható videó\n`)
  for (const item of items) {
    let detail: string
    try {
      const raw = await readFile(item.subtitlePath, 'utf8')
      const cues = parseSubtitle(raw, item.subtitlePath)
      const rawText = cues.flatMap((c) => c.lines).join(' ')
      const normalized = dedupeLines(cues).join(' ')
      detail = `${countWords(rawText)} → ${countWords(normalized)} szó, ${classifyCaptions(normalized)}`
    } catch (error) {
      detail = `olvashatatlan felirat: ${(error as Error).message}`
    }
    console.log(`  ${item.videoId}  ${item.channel}  ${item.title}`)
    console.log(`      ${detail}`)
  }
  return 0
}

async function commandRun(
  cfg: Config,
  flags: {
    channel?: string
    limit?: number
    dryRun: boolean
    force: boolean
    commit: boolean
  },
): Promise<number> {
  if (flags.commit && !flags.dryRun) await gitPullFfOnly(cfg.vaultPath)

  const store = openState(cfg.statePath)
  const { sink, events } = collectEvents()
  const printing = (e: RunEvent) => {
    sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }

  try {
    const all = await folderSource(cfg.pinchflatDownloads).discover()
    const items = applyFilters(all, flags)
    printing({ type: 'scan:found', count: items.length })

    const written: string[] = []
    for (const item of items) {
      const outcome = await processItem(item, {
        notesRoot: cfg.notesRoot,
        store,
        sink: printing,
        version: VERSION,
        options: { force: flags.force, dryRun: flags.dryRun },
      })
      if (outcome.status === 'published' && outcome.path) written.push(outcome.path)
    }

    const summary = summarize(events)
    printing({ type: 'run:done', ...summary })
    console.log(
      `\nKész: ${summary.succeeded} sikeres, ${summary.skipped} kihagyva, ${summary.failed} hibás.`,
    )

    if (flags.commit && !flags.dryRun && written.length > 0) {
      const message = `docs(videos): átirat ${written.length} videóhoz`
      if (await gitCommitPaths(cfg.vaultPath, written, message)) {
        const push = await gitPush(cfg.vaultPath)
        if (!push.pushed) console.log(`A push nem sikerült, a commit lokálisan maradt.`)
      }
    }

    return summary.failed > 0 ? 1 : 0
  } finally {
    store.close()
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE)
    return command ? 0 : 1
  }

  const { values } = parseArgs({
    args: [...argv.slice(1)],
    options: {
      channel: { type: 'string' },
      limit: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-commit': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const cfg = loadConfig(process.env)
  await validateConfig(cfg)

  if (command === 'scan') return commandScan(cfg)
  if (command === 'run') {
    return commandRun(cfg, {
      channel: values.channel,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      dryRun: values['dry-run'],
      force: values.force,
      commit: !values['no-commit'],
    })
  }

  console.error(`Ismeretlen parancs: ${command}\n\n${USAGE}`)
  return 1
}

const isEntrypoint = process.argv[1]?.endsWith('cli.js') ?? false
if (isEntrypoint) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message)
      process.exit(1)
    })
}
```

- [ ] **6. lépés: Írd meg a mag publikus API-ját**

`src/index.ts`:

```ts
export { loadConfig, validateConfig, type Config } from './config.js'
export { collectEvents, summarize, type EventSink, type RunEvent } from './events.js'
export { processItem, type ItemOutcome, type PipelineDeps } from './pipeline.js'
export { folderSource } from './source/folder.js'
export type { Source } from './source/types.js'
export { openState, type StateStore } from './state/db.js'
export type { CaptionSource, Cue, NormalizedTranscript, SourceItem } from './types.js'
```

- [ ] **7. lépés: Írd meg a végponttól végpontig tesztet**

`src/e2e.test.ts` — **ez a roadmap Fázis 0 mind az öt sikerkritériuma:**

```ts
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { collectEvents, summarize } from './events.js'
import { processItem } from './pipeline.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'
import { gitCommitPaths, isDirty } from './vault/git.js'

const run = promisify(execFile)

const SRT = (line: string) => `1
00:00:00,000 --> 00:00:02,000
${line}

2
00:00:01,000 --> 00:00:03,000
${line}

3
00:00:02,000 --> 00:00:04,000
${line}

4
00:00:03,000 --> 00:00:05,000
Egy második, eltérő sor.
`

let work: string
let vault: string
let notesRoot: string
let downloads: string

async function makeVideo(id: string, title: string, channel: string, broken = false) {
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
  await writeFile(join(dir, `${title}.en.srt`), broken ? '' : SRT('Ismételt sor.'), 'utf8')
}

async function processAll(force = false) {
  const store = openState(join(work, 'state.db'))
  const { sink, events } = collectEvents()
  const items = await folderSource(downloads).discover()
  const written: string[] = []
  for (const item of items) {
    const outcome = await processItem(item, {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force },
    })
    if (outcome.status === 'published' && outcome.path) written.push(outcome.path)
  }
  store.close()
  return { summary: summarize(events), written, events }
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-e2e-'))
  vault = join(work, 'vault')
  notesRoot = join(vault, 'Resources/Videos/YouTube')
  downloads = join(work, 'downloads')
  await mkdir(notesRoot, { recursive: true })
  await run('git', ['init', '-b', 'main'], { cwd: vault })
  await run('git', ['config', 'user.email', 'teszt@example.com'], { cwd: vault })
  await run('git', ['config', 'user.name', 'Teszt'], { cwd: vault })
  await writeFile(join(vault, '.gitkeep'), '', 'utf8')
  await run('git', ['add', '.'], { cwd: vault })
  await run('git', ['commit', '-m', 'alap'], { cwd: vault })
})

describe('Fázis 0 sikerkritériumai', () => {
  it('1. a szkennelés hálózat nélkül kilistázza az elemeket a metaadataikkal', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    await makeVideo('b2', 'Második videó', 'Csatorna B')
    const items = await folderSource(downloads).discover()
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.channel).sort()).toEqual(['Csatorna A', 'Csatorna B'])
  })

  it('2. a jegyzetben nincs duplikált sor, a frontmatter érvényes, wikilink nincs', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    const { written } = await processAll()
    const md = await readFile(written[0]!, 'utf8')
    expect(md.match(/Ismételt sor\./g)).toHaveLength(1)
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('video_id: a1')
    expect(md).not.toMatch(/\[\[.+\]\]/)
  })

  it('3. másodszor futtatva semmit nem ír, és kihagyottnak jelenti', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    await processAll()
    const second = await processAll()
    expect(second.summary.succeeded).toBe(0)
    expect(second.summary.skipped).toBe(1)
  })

  it('4. egy sérült felirat mellett a többi elem sikeres, és a riport megnevezi a hibásat', async () => {
    await makeVideo('a1', 'Jó videó', 'Csatorna A')
    await makeVideo('b2', 'Rossz videó', 'Csatorna B', true)
    const { summary, events } = await processAll()
    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(1)
    const failure = events.find((e) => e.type === 'item:failed')
    expect(failure).toBeDefined()
    expect(failure && 'videoId' in failure && failure.videoId).toBe('b2')
  })

  it('5. a futás után a vault munkafája tiszta, és egy commit csak a jegyzeteket érinti', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    const { written } = await processAll()
    expect(await isDirty(vault)).toBe(true)

    const committed = await gitCommitPaths(vault, written, 'docs(videos): átirat 1 videóhoz')
    expect(committed).toBe(true)
    expect(await isDirty(vault)).toBe(false)

    const { stdout } = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: vault })
    const files = stdout.trim().split('\n')
    expect(files).toHaveLength(1)
    expect(files[0]!.startsWith('Resources/Videos/YouTube/')).toBe(true)
  })
})
```

- [ ] **8. lépés: Futtasd a teljes csomagot**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Elvárt: minden teszt PASS, típushiba nincs, ESLint-hiba nincs

- [ ] **9. lépés: Ellenőrizd valós adaton, dry-run módban**

```bash
export VAULT_PATH=<a vault abszolút útvonala>
export PINCHFLAT_DOWNLOADS=<a letöltési mappa abszolút útvonala>
mise exec -- pnpm build
mise exec -- node dist/cli.js scan
mise exec -- node dist/cli.js run --limit 1 --dry-run
```

Elvárt: a `scan` kilistázza a valós videókat; a `run --dry-run` szószám-párokat
ír ki, és **egyetlen fájlt sem hoz létre** a vaultban. Ellenőrizd `git status`-szal.

- [ ] **10. lépés: Futtasd élesben egyetlen elemre**

```bash
mise exec -- node dist/cli.js run --limit 1 --no-commit
```

Elvárt: pontosan egy `Youtube - <cím>_transcript.md` keletkezik a helyes
csatorna- és videómappában. Nyisd meg Obsidianban, és nézd meg, hogy
olvasható-e.

- [ ] **11. lépés: Commitolj**

```bash
git add src/pipeline.ts src/pipeline.test.ts src/cli.ts src/index.ts src/e2e.test.ts
git commit -m "feat(cli): scan és run parancs a teljes fázis 0 csővezetékkel"
```

---

## Amit ez a fázis szándékosan nem tartalmaz

- **Semmilyen modellhívást.** Az első recept a Fázis 1 dolga.
- **Whisper-újratranszkribálást.** A minőségi kapu besorol, de a Fázis 0 az
  automatikus feliratot is változatlanul dolgozza fel; az újratranszkribálás a
  Fázis 2.
- **Ütemezett futtatást.** A `launchd` akkor kerül be, amikor van mit
  ütemezni.
- **URL-alapú ingestet.** A második forrás-adapter a Fázis 4.
