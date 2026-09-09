# Két új recept és a strukturált kimenet — implementációs terv

> **Ágenseknek:** KÖTELEZŐ AL-SKILL: a `superpowers:subagent-driven-development`
> (ajánlott) vagy a `superpowers:executing-plans` viszi végig ezt a tervet
> feladatonként. A lépések jelölőnégyzetes (`- [ ]`) szintaxist használnak.

**Cél:** Bizonyítsuk működő kóddal, hogy egy új dokumentumtípus felvétele nem
architekturális esemény — egy prózarecept egyetlen új fájl a motor érintése
nélkül, egy strukturált recept pedig sémával kikényszerített kimenetet ad a
vault által várt sorformátumban.

**Architektúra:** A `Recipe` egyetlen opcionális `structured` mezőt kap, amiben
a típusparaméter záráson belül marad, tehát a registry, a `RecipeDeps`, a
`runRecipe`, a publisher és a `ModelClient` egyetlen sora sem változik. A
`refine` loop egy háromsoros elágazást kap; innentől mindkét ág stringet ad
vissza, tehát a pontozás és a token-elszámolás változatlan.

**Technológia:** TypeScript 5.9, Node 26.2, pnpm 11.24, vitest 4, zod 4,
ESLint 10. Minden parancs `mise exec --` előtaggal fut.

**Spec:** [`docs/plans/2026-09-09-fazis-3-receptek-spec.md`](<./2026-09-09-fazis-3-receptek-spec.md>)

## Globális megkötések

- **Magyar** a dokumentáció, a kódkomment, a felhasználói kimenet és a
  commit-üzenet. **Angol** a produkciós azonosító és minden, ami a modellnek
  megy (promptok, gap-üzenetek). Teszt-lokális magyar fixture-név megengedett.
- **Attribúciós trailer TILOS** a commitokban (`Co-Authored-By`,
  `Claude-Session`). A commit láblécében `Refs #14` áll.
- A mag nem ír konzolra és nem ír fájlt a naplón kívül.
- Minden teszt hálózat és API-kulcs nélkül fut. **Modellhívás egyetlen tesztben
  sincs** — hamis kliens megy mindenhová.
- A rubrika-motor (`src/rubric/types.ts`), a publisher (`src/vault/`) és a
  `ModelClient` felülete nem változik.
- Recept nem kerülhet be a rubrikája nélkül.
- Minden feladat végén zöld: `mise exec -- pnpm test`, `typecheck`, `lint`.
- **Commit-sorrend kötött**: motorvarrat → kártyarecept → CLI-bizonyíték →
  Q&A recept. A Q&A azért utolsó, mert a commitja hordozza az 1. sikerkritérium
  bizonyítékát.

---

## Fájlszerkezet

| fájl | felelősség | feladat |
|---|---|---|
| `src/recipe/rules.ts` | új — a vault-invariáns prompt-szabályok, névvel hivatkozva | 1 |
| `src/recipe/rules.test.ts` | új — a `summary` szabályblokkja bájtra változatlan | 1 |
| `src/recipe/structured.ts` | új — a `structuredOutput` építő és a séma-hiba magyar becsomagolása | 1 |
| `src/recipe/structured.test.ts` | új — a builder rendereli a kimenetet és becsomagolja a séma-hibát | 1 |
| `src/recipe/types.ts` | mód. — `StructuredOutput` interfész és a `Recipe.structured` mező | 1 |
| `src/refine/loop.ts` | mód. — a generálás elágazása strukturált receptre | 1 |
| `src/refine/loop.test.ts` | mód. — a strukturált ág és a javító köre | 1 |
| `src/recipe/summary.ts` | mód. — a szabályok névvel hivatkozva, bájtazonos eredménnyel | 1 |
| `src/recipe/flashcards.ts` | új — séma, normalizáló renderer, kapu és a recept | 2 |
| `src/recipe/flashcards.test.ts` | új — séma, renderer, kapu | 2 |
| `src/recipe/registry.ts` | mód. — a `flashcards`, majd a `qa` bejegyzés | 2, 4 |
| `src/recipe/registry.test.ts` | mód. — az azonosítólista | 2, 4 |
| `src/cli.test.ts` | mód. — a CLI-szintű bizonyíték három kritériumra | 3 |
| `src/recipe/qa.ts` | új — a kérdés-felelet prózarecept | 4 |
| `src/recipe/qa.test.ts` | új — a Q&A recept tesztje | 4 |

---

## Feladat 1: A motorvarrat és a közös szabályok

**Fájlok:**
- Létrehoz: `src/recipe/rules.ts`, `src/recipe/rules.test.ts`,
  `src/recipe/structured.ts`, `src/recipe/structured.test.ts`
- Módosít: `src/recipe/types.ts`, `src/refine/loop.ts:41`, `src/refine/loop.ts:55`,
  `src/recipe/summary.ts:11`
- Teszt: `src/recipe/rules.test.ts`, `src/recipe/structured.test.ts`,
  `src/refine/loop.test.ts`

**Interfészek:**
- Fogyaszt: `ModelClient` (`src/model/client.ts:22`), `ModelResult`,
  `ModelRole` (`src/types.ts`).
- Termel: `StructuredOutput` interfész és `structuredOutput<T>(schema, render)`
  építő; `RULE` névvel hivatkozható szabály-konstansok. A 2. és 4. feladat
  ezekre épül.

- [ ] **1. lépés: A szabály-konstansok tesztje (piros)**

Hozd létre a `src/recipe/rules.test.ts`-t. A teszt azt rögzíti, hogy a
kiemelés után a `summary` **összeállított szabályblokkja bájtra ugyanaz**, mint
ma — ez a spec 7. sikerkritériuma:

```ts
import { describe, expect, it } from 'vitest'
import { summaryRecipe } from './summary.js'
import { RULE } from './rules.js'
import type { SourceItem } from '../types.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'proba',
  sourceFile: 'Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: {},
}

/** A mai `summary` szabályblokkja, szó szerint. Ez a regressziós horgony. */
const EXPECTED = [
  '- Write in the same language as the transcript. Do not translate.',
  '- Every statement must be traceable to the transcript. Do not add outside',
  '  knowledge, and do not speculate about what the speaker meant.',
  '- Open with a short paragraph on what the video is about, then use `##`',
  '  sections with bullet points for the substance.',
  '- Do not emit YAML frontmatter; it is added separately.',
  '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
  '  brackets: `[Name](<https://example.com>)`.',
  "- Aim for roughly a tenth of the transcript's length.",
].join('\n')

describe('vault-invariáns szabályok', () => {
  it('a summary szabályblokkja bájtra változatlan a kiemelés után', () => {
    const prompt = summaryRecipe.prompt({ item: ITEM, transcript: 'A, majd B.' })
    expect(prompt).toContain(EXPECTED)
  })

  it('a szabályok angolul szólnak, mert a promptba mennek', () => {
    expect(RULE.language).toMatch(/do not translate/i)
    expect(RULE.noWikilinks).toMatch(/wikilink/i)
  })

  it('a nem-invariáns szabályokat nem tartalmazza', () => {
    const osszes = Object.values(RULE).join('\n')
    expect(osszes).not.toMatch(/tenth of the transcript/i)
    expect(osszes).not.toMatch(/bullet points/i)
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy elbukik**

Futtasd: `mise exec -- pnpm vitest run src/recipe/rules.test.ts`
Várt: FAIL — `Cannot find module './rules.js'`.

- [ ] **3. lépés: A szabálymodul**

Hozd létre a `src/recipe/rules.ts`-t. **Névvel** hivatkozható konstansok, nem
egy tömb: a `summary` a saját szabályait a lista *közepére* szúrja be, tehát a
sorrendet a receptnek kell összeállítania.

```ts
/**
 * A vault-invariáns prompt-szabályok. Minden recept ugyanezeket idézi: a
 * jegyzet nyelve, a visszavezethetőség és a vault írási szabályai nem
 * recept-függőek.
 *
 * A recept-specifikus szabályt (hossz, szerkezet) mindegyik recept maga fűzi
 * hozzá, a saját sorrendjében — ezért nevesített konstansok, nem kész lista.
 *
 * Angolul, mert a promptba mennek.
 */
export const RULE = {
  language: '- Write in the same language as the transcript. Do not translate.',

  traceable: [
    '- Every statement must be traceable to the transcript. Do not add outside',
    '  knowledge, and do not speculate about what the speaker meant.',
  ].join('\n'),

  noFrontmatter: '- Do not emit YAML frontmatter; it is added separately.',

  noWikilinks: [
    '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
    '  brackets: `[Name](<https://example.com>)`.',
  ].join('\n'),
} as const
```

- [ ] **4. lépés: A `summary` átállítása a konstansokra**

A `src/recipe/summary.ts:11` `RULES` konstansát cseréld le. A sorrend
**pontosan** a mai marad, különben a 1. lépés tesztje elbukik:

```ts
import { RULE } from './rules.js'

const RULES = [
  RULE.language,
  RULE.traceable,
  [
    '- Open with a short paragraph on what the video is about, then use `##`',
    '  sections with bullet points for the substance.',
  ].join('\n'),
  RULE.noFrontmatter,
  RULE.noWikilinks,
  "- Aim for roughly a tenth of the transcript's length.",
].join('\n')
```

- [ ] **5. lépés: Futtasd — zöldnek kell lennie, a `summary` tesztjeivel együtt**

Futtasd: `mise exec -- pnpm vitest run src/recipe/`
Várt: PASS. A `src/recipe/summary.test.ts` **egyetlen sorát sem** szabad
módosítanod — ha bukik, a sorrend csúszott el.

- [ ] **6. lépés: A strukturált építő tesztje (piros)**

Hozd létre a `src/recipe/structured.test.ts`-t:

```ts
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ModelClient } from '../model/client.js'
import { structuredOutput } from './structured.js'

const Schema = z.object({ items: z.array(z.string()) })

function kliens(impl: ModelClient['generateObject']): ModelClient {
  return {
    generate: () => Promise.reject(new Error('a strukturált út nem hívhat generate-et')),
    generateObject: impl,
  }
}

describe('structuredOutput', () => {
  it('a sémás választ rendereli, és a használatot változatlanul adja tovább', async () => {
    const so = structuredOutput(Schema, (v) => v.items.join(', '))
    const client = kliens(() =>
      Promise.resolve({
        value: { items: ['egy', 'kettő'] },
        usage: { inputTokens: 100, outputTokens: 20 },
      }),
    )

    const result = await so.generate(client, 'draft', 'PROMPT')

    expect(result.value).toBe('egy, kettő')
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 })
  })

  it('a sémát és a szerepet változatlanul adja a kliensnek', async () => {
    const generateObject = vi.fn(() =>
      Promise.resolve({ value: { items: [] }, usage: { inputTokens: 1, outputTokens: 1 } }),
    )
    const so = structuredOutput(Schema, () => 'x')

    await so.generate(kliens(generateObject as never), 'draft', 'PROMPT')

    expect(generateObject).toHaveBeenCalledWith('draft', 'PROMPT', Schema)
  })

  it('a séma-hibát érthető magyar üzenetbe csomagolja, az okot megtartva', async () => {
    const eredeti = Object.assign(new Error('value did not match schema'), {
      name: 'AI_TypeValidationError',
    })
    const so = structuredOutput(Schema, () => 'x')

    await expect(so.generate(kliens(() => Promise.reject(eredeti)), 'draft', 'P')).rejects.toThrow(
      /nem a sémának megfelelő/i,
    )
  })

  it('a nem séma eredetű hibát változatlanul engedi tovább', async () => {
    const halozati = Object.assign(new Error('socket hang up'), { name: 'Error' })
    const so = structuredOutput(Schema, () => 'x')

    await expect(
      so.generate(kliens(() => Promise.reject(halozati)), 'draft', 'P'),
    ).rejects.toThrow('socket hang up')
  })
})
```

- [ ] **7. lépés: Futtasd, és győződj meg róla, hogy elbukik**

Futtasd: `mise exec -- pnpm vitest run src/recipe/structured.test.ts`
Várt: FAIL — `Cannot find module './structured.js'`.

- [ ] **8. lépés: A `StructuredOutput` interfész**

A `src/recipe/types.ts` **típus-only** marad; ide csak az interfész kerül, a
futásidejű építő külön fájlba:

```ts
import type { ModelClient, ModelResult } from '../model/client.js'
import type { ModelRole, SourceItem } from '../types.js'

/**
 * Sémával kikényszerített kimenet. A típusparaméter az építő zárásán belül
 * marad, ezért ez az interfész konkrét: sem generikus, sem `unknown` nem
 * szivárog a `refine` loopba és a registrybe.
 */
export interface StructuredOutput {
  generate(
    client: ModelClient,
    role: ModelRole,
    prompt: string,
  ): Promise<ModelResult<string>>
}
```

és a `Recipe` interfészbe, a `rubric` mező elé:

```ts
  /**
   * Ha jelen van, a generálás objektumot kér a sémára, és a renderelt
   * Markdown megy tovább pontozásra és publikálásra. Prózarecepteknél
   * hiányzik.
   */
  structured?: StructuredOutput
```

- [ ] **9. lépés: A `structuredOutput` építő**

Hozd létre a `src/recipe/structured.ts`-t:

```ts
import type { ZodType } from 'zod'
import type { StructuredOutput } from './types.js'

/**
 * Az AI SDK séma-eredetű hibáinak nevei. Csak ezeket csomagoljuk be: egy
 * hálózati hibát „séma-hibaként" jelenteni félrevezetné a riportot.
 */
const SCHEMA_ERRORS = new Set([
  'AI_TypeValidationError',
  'AI_NoObjectGeneratedError',
  'AI_JSONParseError',
])

/**
 * Tipizált építő a sémás kimenethez: a `T` a záráson belül marad, kifelé a
 * `StructuredOutput` konkrét típusa látszik.
 *
 * A séma-hiba **nem** indít javító kört: egy sémát eltévesztő modelltől újabb
 * kört rendelni pénzbe kerül és ritkán segít. Az elem `item:failed` lesz, a
 * riport megnevezi az okot, és a `--retry-failed` előveheti.
 */
export function structuredOutput<T>(
  schema: ZodType<T>,
  render: (value: T) => string,
): StructuredOutput {
  return {
    async generate(client, role, prompt) {
      try {
        const { value, usage } = await client.generateObject(role, prompt, schema)
        return { value: render(value), usage }
      } catch (error) {
        const { name, message } = error as Error
        if (!SCHEMA_ERRORS.has(name)) throw error
        throw new Error(`a modell nem a sémának megfelelő kimenetet adott: ${message}`, {
          cause: error,
        })
      }
    },
  }
}
```

- [ ] **9b. lépés: Futtasd — zöld**

Futtasd: `mise exec -- pnpm vitest run src/recipe/structured.test.ts`
Várt: PASS (4 teszt).

- [ ] **10. lépés: A loop strukturált ágának tesztje (piros)**

Told hozzá a `src/refine/loop.test.ts`-hez. A hamis kliens `generate`-je
**dob**, tehát a teszt bizonyítja, hogy a strukturált út megy:

```ts
import { structuredOutput } from '../recipe/structured.js'
import { z } from 'zod'

const Cards = z.object({ cards: z.array(z.string()) })

/** Kliens, ami csak a sémás úton válaszol; a `generate` hívása hiba. */
function strukturaltKliens(valaszok: { cards: string[] }[]) {
  let i = 0
  return {
    generate: () => Promise.reject(new Error('prózautat hívott a strukturált recept')),
    generateObject: <T>() => {
      const valasz = valaszok[Math.min(i, valaszok.length - 1)]!
      i++
      return Promise.resolve({
        value: valasz as T,
        usage: { inputTokens: 100, outputTokens: 10 },
      })
    },
  } as ModelClient
}

describe('refine — strukturált recept', () => {
  it('a sémás úton generál, és a RENDERELT Markdownt pontozza', async () => {
    const pontszamok = new Map([['- egy\n- kettő', 0.9]])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok)),
      structured: structuredOutput(Cards, (v) => v.cards.map((c) => `- ${c}`).join('\n')),
    }

    const result = await refine(recipe, INPUT, strukturaltKliens([{ cards: ['egy', 'kettő'] }]))

    expect(result.output).toBe('- egy\n- kettő')
    expect(result.score).toBe(0.9)
    expect(result.generations).toBe(1)
  })

  it('a javító kör is a sémás úton megy, és a jobbik kimenetet tartja meg', async () => {
    const pontszamok = new Map([
      ['- gyenge', 0.4],
      ['- jobb', 0.95],
    ])
    const recipe: Recipe = {
      ...recept(tablazatosRubrika(pontszamok)),
      structured: structuredOutput(Cards, (v) => v.cards.map((c) => `- ${c}`).join('\n')),
    }

    const result = await refine(recipe, INPUT, strukturaltKliens([
      { cards: ['gyenge'] },
      { cards: ['jobb'] },
    ]))

    expect(result.output).toBe('- jobb')
    expect(result.generations).toBe(2)
  })
})
```

- [ ] **11. lépés: Futtasd, és győződj meg róla, hogy elbukik**

Futtasd: `mise exec -- pnpm vitest run src/refine/loop.test.ts`
Várt: FAIL — „prózautat hívott a strukturált recept", mert a loop ma mindig
`client.generate`-et hív.

- [ ] **12. lépés: A loop elágazása**

A `src/refine/loop.ts`-ben, közvetlenül a `usage`/`add` segédek után:

```ts
  /**
   * A generálás egyetlen elágazása: strukturált receptnél sémás hívás és
   * renderelés, egyébként a mai prózaút. Mindkét ág **stringet** ad vissza,
   * ezért innentől a loop többi része változatlan.
   */
  const generate = (prompt: string): Promise<ModelResult<string>> =>
    recipe.structured
      ? recipe.structured.generate(client, recipe.role, prompt)
      : client.generate(recipe.role, prompt)
```

Ezután a `:41` sorban `const first = await generate(recipe.prompt(input))`, az
`:55` sorban pedig
`const next = await generate(recipe.repairPrompt({ ...input, previous: best.output, gaps: best.gaps }))`.
A `ModelResult` típust importálni kell a `../model/client.js`-ből.

- [ ] **13. lépés: Futtasd az egészet — zöld**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várt: minden zöld, a `summary` tesztjei és az `evals/summary.eval.ts` érintetlenül.

- [ ] **14. lépés: Commit**

```bash
git add src/recipe/rules.ts src/recipe/rules.test.ts \
        src/recipe/structured.ts src/recipe/structured.test.ts \
        src/recipe/types.ts src/recipe/summary.ts \
        src/refine/loop.ts src/refine/loop.test.ts
git commit -m "feat(recipe): sémával kikényszerített kimenet a receptmotorban (Feladat 1)"
```

---

## Feladat 2: A tanulókártya recept

**Fájlok:**
- Létrehoz: `src/recipe/flashcards.ts`, `src/recipe/flashcards.test.ts`
- Módosít: `src/recipe/registry.ts:12`, `src/recipe/registry.test.ts`
- Teszt: `src/recipe/flashcards.test.ts`

**Interfészek:**
- Fogyaszt: `RULE` (`src/recipe/rules.ts`), `structuredOutput`
  (`src/recipe/structured.ts`), `formatCriterion` (`src/rubric/format.ts`),
  `faithfulnessCriterion` és `coverageCriterion` (`src/rubric/judge.ts`),
  `Criterion` és `Score` (`src/rubric/types.ts`).
- Termel: `flashcardsRecipe` (`id: 'flashcards'`), és exportálva a tesztnek:
  `renderCards(value: Flashcards): string`, `checkFlashcards(output: string): Score`.

**Fontos tervezési döntés — a sortörés normalizálódik, nem gap lesz.** A
renderelt szövegből egy kérdésbe került sortörés **megkülönböztethetetlen** a
válasz első sorától, tehát kapuval nem is lehetne elkapni. Ezért a renderer
normalizál (ahogy a Fázis 2 riportja escape-elte a `|` jelet a táblacellákban),
a kapu pedig arra marad, ami a renderelt szövegből tényleg látszik: az
ismétlődő kérdésre és a hiányzó kártyákra.

- [ ] **1. lépés: A séma, a renderer és a kapu tesztje (piros)**

Hozd létre a `src/recipe/flashcards.test.ts`-t:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { FlashcardsSchema, checkFlashcards, flashcardsRecipe, renderCards } from './flashcards.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Csatorna/Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Csatorna' },
}

const HAROM = {
  cards: [
    { question: 'Mi az A?', answer: 'Az A egy dolog.' },
    { question: 'Mi a B?', answer: 'A B egy másik dolog.' },
    { question: 'Mi a C?', answer: 'A C a harmadik.' },
  ],
}

describe('FlashcardsSchema', () => {
  it('háromnál kevesebb kártyát elutasít', () => {
    expect(FlashcardsSchema.safeParse({ cards: HAROM.cards.slice(0, 2) }).success).toBe(false)
  })

  it('csupa szóköz oldalt elutasít', () => {
    const rossz = { cards: [...HAROM.cards.slice(1), { question: '   ', answer: 'x' }] }
    expect(FlashcardsSchema.safeParse(rossz).success).toBe(false)
  })

  it('érvényes kártyakészletet elfogad, és levágja a széli szóközöket', () => {
    const parsed = FlashcardsSchema.parse({
      cards: [...HAROM.cards.slice(1), { question: '  Mi a D?  ', answer: '  A D.  ' }],
    })
    expect(parsed.cards[2]).toEqual({ question: 'Mi a D?', answer: 'A D.' })
  })
})

describe('renderCards', () => {
  it('kártyánként `##` fejlécet és alatta bekezdést ad', () => {
    expect(renderCards(HAROM)).toBe(
      '## Mi az A?\n\nAz A egy dolog.\n\n## Mi a B?\n\nA B egy másik dolog.\n\n## Mi a C?\n\nA C a harmadik.',
    )
  })

  it('a kérdésbe került sortörést egyetlen sorrá normalizálja', () => {
    const rendered = renderCards({
      cards: [{ question: 'Mi az\nA fogalom?', answer: 'Ez.' }, ...HAROM.cards.slice(1)],
    })
    expect(rendered).toContain('## Mi az A fogalom?')
    expect(rendered).not.toContain('## Mi az\n')
  })

  it('a válaszban lévő `##` sort elfedi, hogy ne csináljon fantomkártyát', () => {
    const rendered = renderCards({
      cards: [{ question: 'Mi az A?', answer: '## Nem fejléc\nHanem válasz.' }, ...HAROM.cards.slice(1)],
    })
    expect(rendered).toContain('\\## Nem fejléc')
    expect(rendered.match(/^## /gm)).toHaveLength(3)
  })
})

describe('checkFlashcards', () => {
  it('szabályos kártyakészletre 1-et ad, hiányok nélkül', () => {
    expect(checkFlashcards(renderCards(HAROM))).toEqual({ value: 1, gaps: [] })
  })

  it('ismétlődő kérdésre gap-et ad, és megnevezi a kérdést', () => {
    const ismetlodo = {
      cards: [HAROM.cards[0]!, HAROM.cards[1]!, { question: 'mi az a?', answer: 'Megint.' }],
    }
    const score = checkFlashcards(renderCards(ismetlodo))
    expect(score.value).toBe(0)
    expect(score.gaps.join(' ')).toMatch(/Mi az A\?/i)
  })

  it('háromnál kevesebb kártyára gap-et ad', () => {
    const score = checkFlashcards('## Egyetlen kérdés?\n\nEgyetlen válasz.')
    expect(score.value).toBe(0)
    expect(score.gaps.join(' ')).toMatch(/at least three/i)
  })

  it('üres törzsű kártyára gap-et ad', () => {
    const score = checkFlashcards('## A?\n\n## B?\n\nVálasz B.\n\n## C?\n\nVálasz C.')
    expect(score.value).toBe(0)
    expect(score.gaps.join(' ')).toMatch(/without an answer/i)
  })

  it('a gap-üzenetek angolul szólnak, mert visszamennek a modellnek', () => {
    const score = checkFlashcards('## Csak egy?\n\nVálasz.')
    expect(score.gaps.join(' ')).not.toMatch(/[áéíóöőúüű]/i)
  })
})

describe('flashcardsRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(flashcardsRecipe.id).toBe('flashcards')
    expect(flashcardsRecipe.outputFile).toBe('_flashcards.md')
  })

  it('publikálható, a draft szerepet kéri, és két javító kört enged', () => {
    expect(flashcardsRecipe.publishable).toBe(true)
    expect(flashcardsRecipe.role).toBe('draft')
    expect(flashcardsRecipe.maxIterations).toBe(2)
  })

  it('sémával kikényszerített kimenetet kér', () => {
    expect(flashcardsRecipe.structured).toBeDefined()
  })

  it('rubrikája négy kritériumból áll, az első kettő blokkoló', () => {
    const nevek = flashcardsRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'flashcards-format', 'faithfulness', 'coverage'])
    expect(flashcardsRecipe.rubric.criteria[0]!.blocking).toBe(true)
    expect(flashcardsRecipe.rubric.criteria[1]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat, a cím és a csatorna', () => {
    const prompt = flashcardsRecipe.prompt({ item: ITEM, transcript: 'A, majd B.' })
    expect(prompt).toContain('A, majd B.')
    expect(prompt).toContain('Cím')
    expect(prompt).toContain('Csatorna')
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = flashcardsRecipe.repairPrompt({
      item: ITEM,
      transcript: 'A, majd B.',
      previous: '## Régi kérdés?\n\nRégi válasz.',
      gaps: ['Two cards ask the same question'],
    })
    expect(prompt).toContain('Two cards ask the same question')
    expect(prompt).toContain('## Régi kérdés?')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy elbukik**

Futtasd: `mise exec -- pnpm vitest run src/recipe/flashcards.test.ts`
Várt: FAIL — `Cannot find module './flashcards.js'`.

- [ ] **3. lépés: A recept modulja**

Hozd létre a `src/recipe/flashcards.ts`-t:

```ts
import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import type { Criterion, Score } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/**
 * A kártyakészlet sémája. A `trim()` a szóköz-only oldalt is kiszűri, a
 * hármas alsó korlát pedig azt, hogy egy videóból egyetlen kártya szülessen.
 * Felső korlátot nem írunk elő: a hosszabb átirat több kártyát érdemel, a
 * költséget pedig a futásonkénti plafon fogja.
 */
export const FlashcardsSchema = z.object({
  cards: z
    .array(
      z.object({
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
      }),
    )
    .min(3),
})

export type Flashcards = z.infer<typeof FlashcardsSchema>

/**
 * Kártyakészlet → az Obsidian Decks plugin fejléc-bekezdés alakja: minden
 * `##` fejléc egy kártya eleje, az alatta lévő bekezdés a hátulja.
 *
 * A renderer **normalizál**, nem hibázik: a kérdésbe került sortörés egyetlen
 * sorrá olvad, a válaszban lévő `##`-kezdetű sor pedig escape-et kap. Mindkettő
 * a renderelés szintjén dől el, mert a kész szövegből már nem lennének
 * megkülönböztethetők a szabályos kártyahatároktól — ugyanaz a megfontolás,
 * mint a Fázis 2 riportjának cella-escape-elésénél.
 */
export function renderCards({ cards }: Flashcards): string {
  return cards
    .map((card) => {
      const question = card.question.replace(/\s*\n\s*/g, ' ').trim()
      const answer = card.answer.replace(/^(#+)/gm, '\\$1')
      return `## ${question}\n\n${answer}`
    })
    .join('\n\n')
}

/** Egy kártya a renderelt szövegből visszaolvasva. */
function parseCards(output: string): { question: string; body: string }[] {
  const cards: { question: string; body: string[] }[] = []
  for (const line of output.split('\n')) {
    const heading = /^## (.*)$/.exec(line)
    if (heading) {
      cards.push({ question: heading[1]!.trim(), body: [] })
    } else if (cards.length > 0) {
      cards[cards.length - 1]!.body.push(line)
    }
  }
  return cards.map((c) => ({ question: c.question, body: c.body.join('\n').trim() }))
}

/**
 * Determinisztikus kártya-kapu: nulla token, és bukása esetén a bíró-hívások
 * el sem indulnak.
 *
 * Amit a séma nem tud megfogni: két kártya azonos kérdéssel (a modell
 * kedvenc hibája hosszú átiraton), és a válasz nélkül maradt fejléc. A
 * hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFlashcards(output: string): Score {
  const gaps: string[] = []
  const cards = parseCards(output)

  if (cards.length < 3) {
    gaps.push(
      `The note has ${String(cards.length)} card(s). Write at least three cards, each as a "## question" heading followed by its answer.`,
    )
  }

  const ures = cards.filter((c) => c.body === '')
  for (const card of ures) {
    gaps.push(`The card "${card.question}" is a heading without an answer below it.`)
  }

  const latott = new Map<string, string>()
  for (const card of cards) {
    const kulcs = card.question.toLocaleLowerCase()
    const elso = latott.get(kulcs)
    if (elso !== undefined) {
      gaps.push(`Two cards ask the same question: "${elso}". Ask about a different point instead.`)
    } else {
      latott.set(kulcs, card.question)
    }
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
const flashcardFormatCriterion: Criterion = {
  name: 'flashcards-format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFlashcards(ctx.output)),
}

const RULES = [
  RULE.language,
  RULE.traceable,
  '- One card per idea. Ask about a single fact, definition, or causal link.',
  '- The question must be answerable from the transcript alone, without the video.',
  '- Keep the answer to one or two sentences.',
  '- Do not ask the same question twice.',
  RULE.noFrontmatter,
  RULE.noWikilinks,
  '- Aim for 8 to 15 cards for a typical video; never fewer than three.',
].join('\n')

function header(item: SourceItem): string[] {
  const lines = [`Title: ${item.title}`]
  if (item.metadata.channel) lines.push(`Channel: ${item.metadata.channel}`)
  return lines
}

/**
 * Az első strukturált recept: tanulókártyák a normalizált átiratból.
 *
 * A modell nem sorformátumot ír, hanem objektumot ad: a `##` elválasztó a
 * rendererre tartozik, tehát a formátum sosem a modell figyelmén múlik.
 */
export const flashcardsRecipe: Recipe = {
  id: 'flashcards',
  outputFile: '_flashcards.md',
  publishable: true,
  role: 'draft',
  maxIterations: 2,

  structured: structuredOutput(FlashcardsSchema, renderCards),

  prompt: ({ item, transcript }) =>
    [
      'Write study flashcards from the transcript of the video below.',
      '',
      'Rules:',
      RULES,
      '',
      ...header(item),
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the flashcards below. A reviewer scored them against the transcript and',
      'listed concrete gaps. Fix every gap. Keep the cards that already work — do not',
      'rewrite the whole set.',
      '',
      'The original rules still apply:',
      RULES,
      '',
      ...header(item),
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT CARDS ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [
      formatCriterion,
      flashcardFormatCriterion,
      faithfulnessCriterion,
      coverageCriterion,
    ],
    passThreshold: 0.8,
  },
}
```

- [ ] **4. lépés: Regisztráció**

A `src/recipe/registry.ts`-ben egy import és egy bejegyzés:

```ts
import { flashcardsRecipe } from './flashcards.js'
...
export const RECIPES: Record<string, Recipe> = {
  [summaryRecipe.id]: summaryRecipe,
  [flashcardsRecipe.id]: flashcardsRecipe,
}
```

A `src/recipe/registry.test.ts` utolsó tesztje ma pontosan egy receptet vár.
Írd át a mai valóságra:

```ts
  it('a receptek azonosítói a regisztráció sorrendjében állnak', () => {
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards'])
  })
```

- [ ] **5. lépés: Futtasd — zöld**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Várt: minden zöld.

- [ ] **6. lépés: Commit**

```bash
git add src/recipe/flashcards.ts src/recipe/flashcards.test.ts \
        src/recipe/registry.ts src/recipe/registry.test.ts
git commit -m "feat(recipe): tanulókártya recept sémával és Decks-formátummal (Feladat 2)"
```

---

## Feladat 3: CLI-szintű bizonyíték

**Fájlok:**
- Módosít: `src/cli.test.ts`
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Fogyaszt: `flashcardsRecipe` a registryből, a meglévő `rawWithVault`,
  `makeVideo` és `RunRuntime.createClient` teszt-segédek.
- Termel: semmit — ez a feladat bizonyítékot termel, nem kódot.

**Ez a feladat a spec 3., 4. és 5. sikerkritériumát váltja megfigyelhető
tesztre.** A `src/cli.test.ts` meglévő `hamisKliens` segédje a `draft` szerepre
prózát ad; a kártyáknak sémás választ kell adni, ezért **külön segéd** kell,
ami a szerep szerint választ.

- [ ] **1. lépés: A kártyás hamis kliens és a három teszt (piros)**

Told hozzá a `src/cli.test.ts`-hez, a meglévő `hamisKliens` mellé:

```ts
/**
 * Kártyás hamis kliens: a `draft` szerep sémás kártyakészletet ad, a `judge`
 * az ítéletet. A `generate` sosem hívódik — a kártyarecept a sémás úton megy.
 */
function kartyasKliens(
  cards: { question: string; answer: string }[],
  hivasok = { judge: 0 },
): ModelClient {
  return {
    generate: () => Promise.reject(new Error('a kártyarecept nem hívhat generate-et')),
    // eslint-disable-next-line @typescript-eslint/require-await
    async generateObject<T>(role: ModelRole) {
      if (role === 'judge') {
        hivasok.judge++
        return { value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }
      }
      return { value: { cards } as T, usage: { inputTokens: 10, outputTokens: 5 } }
    },
  }
}

const HAROM_KARTYA = [
  { question: 'Mi az A?', answer: 'Az A egy dolog.' },
  { question: 'Mi a B?', answer: 'A B másik.' },
  { question: 'Mi a C?', answer: 'A C harmadik.' },
]
```

és a három teszt:

```ts
  it('a kártyarecept jegyzetében minden kártya `##` fejléc plusz bekezdés', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const { raw, cfg, vault } = await rawWithVault(work, downloads)

    const code = await commandRun(cfg, raw, { recipe: 'flashcards', commit: false }, {
      createClient: () => kartyasKliens(HAROM_KARTYA),
    })

    expect(code).toBe(0)
    const note = await readFile(
      join(vault, 'Inbox/transcript-refinery/downloads/Csatorna A/Első videó_flashcards.md'),
      'utf8',
    )
    const fejlecek = note.match(/^## .+$/gm) ?? []
    expect(fejlecek).toHaveLength(3)
    expect(note).toContain('## Mi az A?\n\nAz A egy dolog.')
    expect(note).toContain('recipe: flashcards')
  })

  it('a kérdésbe került sortörés nem tör szét kártyát a vaultban', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const { raw, cfg, vault } = await rawWithVault(work, downloads)

    await commandRun(cfg, raw, { recipe: 'flashcards', commit: false }, {
      createClient: () =>
        kartyasKliens([
          { question: 'Mi az\nA fogalom?', answer: 'Ez az.' },
          ...HAROM_KARTYA.slice(1),
        ]),
    })

    const note = await readFile(
      join(vault, 'Inbox/transcript-refinery/downloads/Csatorna A/Első videó_flashcards.md'),
      'utf8',
    )
    expect(note).toContain('## Mi az A fogalom?')
    expect(note.match(/^## .+$/gm) ?? []).toHaveLength(3)
  })

  it('séma-sértő modellkimenetnél az elem hibás lesz, a köteg végigmegy', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const { raw, cfg } = await rawWithVault(work, downloads)

    const semaHiba = Object.assign(new Error('cards: array must contain at least 3 element(s)'), {
      name: 'AI_TypeValidationError',
    })

    const code = await commandRun(cfg, raw, { recipe: 'flashcards', commit: false }, {
      createClient: () => ({
        generate: () => Promise.reject(new Error('nem ez az út')),
        generateObject: () => Promise.reject(semaHiba),
      }),
    })

    expect(code).toBe(1)
    const md = (await readdir(cfg.logsDir)).find((f) => f.endsWith('.md'))!
    const report = await readFile(join(cfg.logsDir, md), 'utf8')
    expect(report).toContain('## Hibák')
    expect(report).toMatch(/nem a sémának megfelelő/i)
  })
```

- [ ] **2. lépés: Futtasd, és nézd meg, mi bukik**

Futtasd: `mise exec -- pnpm vitest run src/cli.test.ts`
Várt: a három új teszt fut. Ha valamelyik zölden születik, **nem fogadható el**:
mutáld a produkciós kódot (például vedd ki a renderer normalizálását), és
igazold, hogy a teszt tényleg elbukik tőle — utána állítsd vissza. A jelentésbe
írd bele, melyik mutáció melyik tesztet buktatta.

- [ ] **3. lépés: Javítsd, amit a tesztek felszínre hoznak**

Ha a jegyzet útvonala, a frontmatter mezőneve vagy a riport szakaszcíme eltér a
tesztben feltételezettől, **a tesztet igazítsd a valósághoz** — a produkciós
viselkedés a Fázis 0-2-ben már bizonyított, ez a feladat nem írja át.

- [ ] **4. lépés: Futtasd az egészet — zöld**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`

- [ ] **5. lépés: Commit**

```bash
git add src/cli.test.ts
git commit -m "test(cli): a kártyarecept végponttól végpontig bizonyítva (Feladat 3)"
```

---

## Feladat 4: A kérdés-felelet prózarecept

**Fájlok:**
- Létrehoz: `src/recipe/qa.ts`, `src/recipe/qa.test.ts`
- Módosít: `src/recipe/registry.ts` (egy import, egy bejegyzés),
  `src/recipe/registry.test.ts` (egy sor)

**Interfészek:**
- Fogyaszt: `RULE` (`src/recipe/rules.ts`), `formatCriterion`,
  `faithfulnessCriterion`, `coverageCriterion`.
- Termel: `qaRecipe` (`id: 'qa'`).

**Ez a feladat hordozza az 1. sikerkritérium bizonyítékát.** A commitja
**egyetlen sort sem** érinthet a `src/pipeline.ts`, `src/refine/`,
`src/rubric/`, `src/model/` és `src/cli.ts` alatt.

- [ ] **1. lépés: A recept tesztje (piros)**

Hozd létre a `src/recipe/qa.test.ts`-t:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { qaRecipe } from './qa.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Csatorna/Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Csatorna' },
}

const INPUT = { item: ITEM, transcript: 'The speaker explains A, then B.' }

describe('qaRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(qaRecipe.id).toBe('qa')
    expect(qaRecipe.outputFile).toBe('_qa.md')
  })

  it('publikálható, a draft szerepet kéri, és két javító kört enged', () => {
    expect(qaRecipe.publishable).toBe(true)
    expect(qaRecipe.role).toBe('draft')
    expect(qaRecipe.maxIterations).toBe(2)
  })

  it('prózarecept: nem kér sémás kimenetet', () => {
    expect(qaRecipe.structured).toBeUndefined()
  })

  it('rubrikája a három közös kritériumot tartalmazza, a formátumot elsőként', () => {
    const nevek = qaRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'faithfulness', 'coverage'])
    expect(qaRecipe.rubric.criteria[0]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat, a cím és a csatorna', () => {
    const prompt = qaRecipe.prompt(INPUT)
    expect(prompt).toContain('The speaker explains A, then B.')
    expect(prompt).toContain('Cím')
    expect(prompt).toContain('Csatorna')
  })

  it('a prompt megtiltja a fordítást, a frontmattert és a wikilinket', () => {
    const prompt = qaRecipe.prompt(INPUT)
    expect(prompt).toMatch(/do not translate/i)
    expect(prompt).toMatch(/frontmatter/i)
    expect(prompt).toMatch(/wikilink/i)
  })

  it('a prompt megköveteli, hogy a kérdés az átiratból megválaszolható legyen', () => {
    expect(qaRecipe.prompt(INPUT)).toMatch(/answerable from the transcript/i)
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = qaRecipe.repairPrompt({
      ...INPUT,
      previous: '**Mi az A?** Egy dolog.',
      gaps: ['B is missing'],
    })
    expect(prompt).toContain('B is missing')
    expect(prompt).toContain('**Mi az A?** Egy dolog.')
    expect(prompt).toMatch(/do not rewrite/i)
  })

  it('metaadat nélkül nem ír kitalált csatornát a promptba', () => {
    const prompt = qaRecipe.prompt({ item: { ...ITEM, metadata: {} }, transcript: 'A, majd B.' })
    expect(prompt).toContain('Title: Cím')
    expect(prompt).not.toContain('Channel:')
  })
})
```

- [ ] **2. lépés: Futtasd, és győződj meg róla, hogy elbukik**

Futtasd: `mise exec -- pnpm vitest run src/recipe/qa.test.ts`
Várt: FAIL — `Cannot find module './qa.js'`.

- [ ] **3. lépés: A recept**

Hozd létre a `src/recipe/qa.ts`-t. **Egyetlen motor-sort sem érintesz.**

```ts
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import type { SourceItem } from '../types.js'
import { RULE } from './rules.js'
import type { Recipe } from './types.js'

const RULES = [
  RULE.language,
  RULE.traceable,
  '- Write question-and-answer pairs in prose. Put the question in bold on its',
  '  own line, then the answer in the paragraph below it.',
  '- Every question must be answerable from the transcript alone.',
  '- Ask about substance, not about the speaker or the video itself.',
  RULE.noFrontmatter,
  RULE.noWikilinks,
  '- Cover the main points; roughly one pair per distinct idea.',
].join('\n')

function header(item: SourceItem): string[] {
  const lines = [`Title: ${item.title}`]
  if (item.metadata.channel) lines.push(`Channel: ${item.metadata.channel}`)
  return lines
}

/**
 * Kérdés-felelet jegyzet a normalizált átiratból.
 *
 * A `summary` felállását követi: ugyanaz a három kritérium, ugyanaz a küszöb.
 * A különbség a promptban van — és pontosan ez a lényeg, amit ez a recept
 * bizonyít: egy új dokumentumtípus nem architekturális esemény.
 */
export const qaRecipe: Recipe = {
  id: 'qa',
  outputFile: '_qa.md',
  publishable: true,
  role: 'draft',
  maxIterations: 2,

  prompt: ({ item, transcript }) =>
    [
      'Write a question-and-answer study note from the transcript of the video below.',
      '',
      'Rules:',
      RULES,
      '',
      ...header(item),
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the question-and-answer note below. A reviewer scored it against the',
      'transcript and listed concrete gaps. Fix every gap. Keep what already works —',
      'do not rewrite the note wholesale.',
      '',
      'The original rules still apply:',
      RULES,
      '',
      ...header(item),
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT NOTE ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [formatCriterion, faithfulnessCriterion, coverageCriterion],
    passThreshold: 0.8,
  },
}
```

- [ ] **4. lépés: Regisztráció — egy import, egy bejegyzés, egy tesztsor**

`src/recipe/registry.ts`:

```ts
import { qaRecipe } from './qa.js'
...
  [qaRecipe.id]: qaRecipe,
```

`src/recipe/registry.test.ts`:

```ts
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa'])
```

- [ ] **5. lépés: Futtasd az egészet — zöld**

Futtasd: `mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint`

- [ ] **6. lépés: Commit**

```bash
git add src/recipe/qa.ts src/recipe/qa.test.ts \
        src/recipe/registry.ts src/recipe/registry.test.ts
git commit -m "feat(recipe): kérdés-felelet prózarecept (Feladat 4)"
```

- [ ] **7. lépés: A sikerkritérium bizonyítása**

Futtasd, és a kimenetet másold be a jelentésedbe:

```bash
git show --stat HEAD
git show HEAD -- src/pipeline.ts src/refine src/rubric src/model src/cli.ts
```

Várt: az első parancs négy fájlt mutat — két új (`qa.ts`, `qa.test.ts`) és két
módosított (`registry.ts`, `registry.test.ts`), utóbbiak néhány sorral. A
második parancs kimenete **üres**. Ha nem üres, a recept a motorhoz nyúlt: az
a feladat hibája, nem a kritériumé.

---

## Önellenőrzés

**Spec-lefedettség.** A spec 1. szakasza (motorvarrat) → Feladat 1; 2. szakasza
(szabálykiemelés) → Feladat 1; 3. szakasza (kártyarecept, séma, renderer, kapu,
séma-hiba) → Feladat 2 és 3; 4. szakasza (Q&A) → Feladat 4. A hét
sikerkritériumból az 1. a Feladat 4/7. lépésében, a 2. a Feladat 4 tesztjeiben
és a meglévő CLI-utakon, a 3-5. a Feladat 3 három tesztjében, a 6. a Feladat 1
loop-tesztjeiben, a 7. a Feladat 1/1. és 1/5. lépésében dől el.

**Egy eltérés a spectől, tudatosan.** A spec 4. sikerkritériuma azt írja, hogy a
kérdésbe került sortörés **kapun** akad fenn gap-üzenettel. Ez nem
megvalósítható: a renderelt szövegben a kérdés sortörése után következő rész
megkülönböztethetetlen a válasz első sorától, tehát semmilyen kapu nem tudja
kimutatni. A terv ezért **normalizál** a rendererben (a Fázis 2 cella-escape
mintája szerint), és a kapu arra marad, ami tényleg látszik: ismétlődő kérdés,
válasz nélküli fejléc, háromnál kevesebb kártya. A Feladat 3 második tesztje a
megfigyelhető viselkedést így fogalmazza újra: *a sortörés nem tör szét kártyát
a vaultban.* A spec 4. kritériumát ennek megfelelően helyesbíteni kell.

**Típus-egyezés.** `StructuredOutput.generate(client, role, prompt)` a Feladat
1-ben definiálva, a Feladat 2 `structuredOutput(FlashcardsSchema, renderCards)`
hívása ezt építi; a `refine` a `recipe.structured.generate(client, recipe.role,
prompt)` alakot hívja. A `RULE` kulcsai (`language`, `traceable`,
`noFrontmatter`, `noWikilinks`) a Feladat 1-ben születnek, és a Feladat 2, 4
ugyanezeket idézi.
