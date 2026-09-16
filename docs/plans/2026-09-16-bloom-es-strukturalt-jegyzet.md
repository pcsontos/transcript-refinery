# Bloom-taxonómiás kártyák és strukturált jegyzet — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Két új recept: a `bloom` Bloom-szintekre tagolt, a Decks-plugin által paklinak felismert kártyapaklit ír, a `notes` fogalmakra, példákra és összefoglaló táblázatra épülő strukturált jegyzetet.

**Architecture:** Mindkét recept sémás: a modell objektumot ad, a Markdownt a renderer írja, így a kötelező elemek (szintsorrend, címkesor, példa, variáció, táblázat) szerkezeti garanciák. A `flashcards` fejléc-escape-je és kártyaelemzője közös modulba költözik, a `Recipe` opcionális `tags` mezőt kap, amit a renderer a frontmatterbe fésül. Az átiraton túli pedagógiai tartalmat egy új, receptenként paraméterezett hűségbíró kezeli, a renderer által kitett címkék alapján.

**Tech Stack:** TypeScript (ESM, `.js` importvégződések), Vitest, Zod, Vercel AI SDK LiteLLM mögött, evalite. **Nulla új függőség.**

**Spec:** [`docs/plans/2026-09-16-bloom-es-strukturalt-jegyzet-spec.md`](<./2026-09-16-bloom-es-strukturalt-jegyzet-spec.md>)

## Global Constraints

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet; angol produkciós azonosító, prompt, renderer-címke és gap-üzenet.
- **Nulla új függőség.** Mermaid-szintaxist nem ellenőrzünk.
- Minden teszt hálózat és API-kulcs nélkül fut; modellhívás egyetlen tesztben sincs.
- A mag nem ír konzolra és nem ír fájlt.
- Recept nem kerülhet be a rubrikája nélkül.
- **A `summary`, `flashcards`, `qa` és `clean` promptja bájtra változatlan** — az 1. feladat ujjlenyomat-tesztje őrzi.
- **A sémákban nincs opcionális mező** (`strict: true` a gatewaynél); ahol a hiány megengedett, üres string jelzi.
- Az importok `.js` végződésűek (ESM), a fájlok a meglévő mappaszerkezetet követik.
- Futtatás: `mise exec -- pnpm vitest run <útvonal>`, teljes ellenőrzés: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`.
- **A `vitest run` nem típusellenőriz.** Ahol egy lépés típushibára számít, ott a `pnpm typecheck` az ellenőrzés.
- **Ág:** a kód a `feat/bloom-es-jegyzet` ágon készül, ami a docs-PR (spec + ez a terv) merge-e **után**, a friss `main`-ről indul. Soha nem közvetlenül a `main`-en.
- **Commitok:** feladatonként egy, `Refs #36` lábléccel; a kód-PR zárja az issue-t (`Closes #36`).
- **Valódi pénzt költő lépés (6. és 7. feladat) csak a felhasználó kifejezett jóváhagyása után indul**, előtte kiírt becsléssel.

---

### Task 1: Ujjlenyomat-horgony és közös kártyamodulok

A `flashcards` fejléc-escape-je, sorösszevonása és kártyaelemzője két közös modulba költözik, hogy a `bloom` és a `notes` ugyanazt használja. **Viselkedésváltozás nincs** — ezt a meglévő `flashcards.test.ts` és egy új ujjlenyomat-teszt bizonyítja.

**Files:**
- Create: `src/recipe/prompts.test.ts`
- Create: `src/recipe/markdown.ts`, `src/recipe/markdown.test.ts`
- Create: `src/recipe/cards.ts`, `src/recipe/cards.test.ts`
- Modify: `src/recipe/flashcards.ts` (teljes csere, lent)

**Interfaces:**
- Consumes: semmit korábbi feladatból.
- Produces:
  - `escapeHeadings(text: string): string` és `singleLine(text: string): string` (`src/recipe/markdown.ts`)
  - `interface ParsedCard { question: string; body: string }`, `parseCards(output: string): ParsedCard[]`, `checkCardBasics(cards: readonly ParsedCard[]): string[]` (`src/recipe/cards.ts`)
  - A 4. és 5. feladat ezekre épül.

- [ ] **Step 1: Írd meg az ujjlenyomat-horgonyt**

Hozd létre a `src/recipe/prompts.test.ts` fájlt. Az értékek a szelet előtti `main`-ről származnak (2026-09-16), ugyanezzel a bemenettel számolva:

```ts
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { RECIPES } from './registry.js'

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

const INPUT = { item: ITEM, transcript: 'A, majd B.', timed: [{ start: 0, text: 'A, majd B.' }] }

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * A meglévő receptek promptjainak ujjlenyomata a Bloom- és jegyzetszelet
 * előtti `main`-ről. Regressziós horgony: a közös modulokba költözés és a
 * címkevarrat egyetlen bájtot sem változtathat a promptokon.
 */
const EXPECTED: Record<string, { prompt: string; repair: string }> = {
  summary: {
    prompt: '8f7bf756ccfff9e3fb881c6b3d682446397adfa47fab8c95e094ccf42ede2c6e',
    repair: 'a487815e6c5cbb033aa636708fa777f2c3dc13a81c996366c5fdf787b9730953',
  },
  flashcards: {
    prompt: 'f515047dfc8c95c92f2669f148fbf1ebb7396abb6569a520a5505e567832f3ff',
    repair: '63394bd2a58311ffdd6d40b8287748e1c81a6bada6bc89f0f548e56b12807d42',
  },
  qa: {
    prompt: 'a3be6367760592a0fbb6d5ab48e12913c76902b0fa46459b02b0756e41a435cf',
    repair: '90cd8cf2f8b000addca27c4ff52ea2c2f7dbb1f2aa6afa92a02aa685515e5d54',
  },
  clean: {
    prompt: '95458655342096b5a39ea368a523273a5e41e148211ffb595098e35f56f5a302',
    repair: '5b34753065aa9cf6ebe557133be2357edb37b214d02a6db3c2def8a45264d00a',
  },
}

describe('a meglévő receptek promptjai', () => {
  for (const [id, expected] of Object.entries(EXPECTED)) {
    it(`a ${id} promptja és javító promptja bájtra változatlan`, () => {
      const recipe = RECIPES[id]!
      expect(sha256(recipe.prompt(INPUT))).toBe(expected.prompt)
      expect(
        sha256(recipe.repairPrompt({ ...INPUT, previous: 'ELŐZŐ', gaps: ['HIÁNY'] })),
      ).toBe(expected.repair)
    })
  }
})
```

- [ ] **Step 2: Futtasd — a horgonynak a MAI kódon át kell mennie**

Run: `mise exec -- pnpm vitest run src/recipe/prompts.test.ts`
Expected: PASS, 4 teszt. Ha bármelyik bukik, **állj meg**: a horgony rossz, nem a kód — jelezd, ne írd át az értéket.

- [ ] **Step 3: Írd meg a közös modulok bukó tesztjeit**

`src/recipe/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { escapeHeadings, singleLine } from './markdown.js'

describe('escapeHeadings', () => {
  it('az ATX fejlécet elfedi', () => {
    expect(escapeHeadings('## Nem fejléc\nszöveg')).toBe('\\## Nem fejléc\nszöveg')
  })

  it('három szóköz behúzásig a behúzott ATX sort is elfedi, a behúzást megtartja', () => {
    expect(escapeHeadings('  ## Fantom')).toBe('  \\## Fantom')
  })

  it('a négy szóközzel behúzott sort nem bántja: az kódblokk, nem fejléc', () => {
    expect(escapeHeadings('    ## kód')).toBe('    ## kód')
  })

  it('a szövegsor alatti setext aláhúzást elfedi', () => {
    expect(escapeHeadings('Cím\n---')).toBe('Cím\n\\---')
  })

  it('az üres sor utáni `---`-t nem bántja: az nem fejléc', () => {
    expect(escapeHeadings('Első.\n\n---\n\nMásodik.')).toBe('Első.\n\n---\n\nMásodik.')
  })
})

describe('singleLine', () => {
  it('a sortörést és a körülötte álló szóközt egyetlen szóközzé olvasztja', () => {
    expect(singleLine('Mi az\n  A fogalom?')).toBe('Mi az A fogalom?')
  })

  it('a széli szóközt levágja', () => {
    expect(singleLine('  kérdés \n')).toBe('kérdés')
  })
})
```

`src/recipe/cards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkCardBasics, parseCards } from './cards.js'

describe('parseCards', () => {
  it('a `##` fejléceket kártyának, az alattuk lévő szöveget hátoldalnak olvassa', () => {
    expect(parseCards('## A?\n\nVálasz A.\n\n## B?\n\nVálasz B.')).toEqual([
      { question: 'A?', body: 'Válasz A.' },
      { question: 'B?', body: 'Válasz B.' },
    ])
  })

  it('az első fejléc előtti szöveget eldobja', () => {
    expect(parseCards('Bevezető.\n\n## A?\n\nVálasz.')).toEqual([{ question: 'A?', body: 'Válasz.' }])
  })

  it('a behúzott `##`-t is kártyakezdetnek veszi, ahogy Obsidian', () => {
    expect(parseCards('  ## A?\n\nVálasz.')).toHaveLength(1)
  })

  it('az escape-elt `\\##` sort nem veszi kártyakezdetnek', () => {
    expect(parseCards('## A?\n\n\\## nem kártya')).toHaveLength(1)
  })
})

describe('checkCardBasics', () => {
  it('szabályos kártyákra nincs hiány', () => {
    expect(
      checkCardBasics([
        { question: 'A?', body: 'a' },
        { question: 'B?', body: 'b' },
      ]),
    ).toEqual([])
  })

  it('az üres hátoldalt megnevezi', () => {
    expect(checkCardBasics([{ question: 'A?', body: '' }])).toEqual([
      'The card "A?" is a heading without an answer below it.',
    ])
  })

  it('az ismétlődő kérdést kis-nagybetűtől függetlenül megfogja, és az elsőt nevezi meg', () => {
    expect(
      checkCardBasics([
        { question: 'Mi az A?', body: 'a' },
        { question: 'mi az a?', body: 'b' },
      ]),
    ).toEqual(['Two cards ask the same question: "Mi az A?". Ask about a different point instead.'])
  })

  it('előbb az üres hátoldalakat, aztán az ismétlődéseket sorolja — a flashcards mai sorrendje', () => {
    const gaps = checkCardBasics([
      { question: 'A?', body: 'a' },
      { question: 'a?', body: '' },
    ])
    expect(gaps[0]).toMatch(/without an answer/)
    expect(gaps[1]).toMatch(/same question/)
  })
})
```

- [ ] **Step 4: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/recipe/markdown.test.ts src/recipe/cards.test.ts`
Expected: FAIL — `Failed to resolve import "./markdown.js"` / `"./cards.js"`.

- [ ] **Step 5: Hozd létre a `src/recipe/markdown.ts` modult**

```ts
/**
 * Fejléc-alakú sorok egy renderelt mezőben. A Markdown **három szóköz
 * behúzásig** még fejlécnek olvassa az ATX sort, a `---`/`===` aláhúzás pedig
 * az előtte álló szövegsorból csinál fejlécet (setext) — mindkettő ugyanúgy
 * szétrobbantja a renderer szerkezetét (fantomkártya, fantom szakasz), mint egy
 * behúzatlan `##`.
 */
const ATX = /^( {0,3})(#+)/
const SETEXT = /^( {0,3})(-+|=+)[ \t]*$/

/**
 * A fejléc-alakú sorok elfedése. A `\` escape a sort bekezdéssé teszi, a
 * behúzást viszont meghagyja.
 *
 * A kódblokkok belsejét **nem** kímélve escape-elünk: egy lezáratlan
 * kerítéssel a modell különben kikapcsolhatná a védelmet a mező hátralévő
 * részére. A rosszabbik eset így egy látható `\` egy ritka kódrészletben, nem
 * pedig egy szétesett jegyzet.
 */
export function escapeHeadings(text: string): string {
  const lines = text.split('\n')
  return lines
    .map((line, i) => {
      const atx = ATX.exec(line)
      if (atx) return `${atx[1]!}\\${line.slice(atx[1]!.length)}`
      // A setext aláhúzás csak akkor fejléc, ha szövegsor áll fölötte.
      const setext = SETEXT.exec(line)
      if (setext && i > 0 && lines[i - 1]!.trim() !== '') {
        return `${setext[1]!}\\${line.slice(setext[1]!.length)}`
      }
      return line
    })
    .join('\n')
}

/**
 * Többsoros szöveg egyetlen sorba: a sortörés és a körülötte álló szóköz egy
 * szóközzé olvad. Fejlécbe kerülő mezőhöz kell — a sortörés utáni rész a kész
 * szövegben már nem lenne megkülönböztethető a fejléc alatti bekezdéstől.
 */
export function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}
```

- [ ] **Step 6: Hozd létre a `src/recipe/cards.ts` modult**

```ts
/** Egy kártya a renderelt szövegből visszaolvasva. */
export interface ParsedCard {
  question: string
  body: string
}

/**
 * A renderelt paklit kártyákra bontja. A behúzott `##`-t is kártyakezdetnek
 * veszi, mert Obsidian is annak veszi; az első fejléc előtti szöveg nem kártya.
 */
export function parseCards(output: string): ParsedCard[] {
  const cards: { question: string; body: string[] }[] = []
  for (const line of output.split('\n')) {
    const heading = /^ {0,3}## (.*)$/.exec(line)
    if (heading) {
      cards.push({ question: heading[1]!.trim(), body: [] })
    } else if (cards.length > 0) {
      cards[cards.length - 1]!.body.push(line)
    }
  }
  return cards.map((c) => ({ question: c.question, body: c.body.join('\n').trim() }))
}

/**
 * A kártyapaklik közös, darabszámtól független hibái: válasz nélkül maradt
 * fejléc és ismétlődő kérdés (a modell kedvenc hibája hosszú átiraton).
 *
 * A sorrend — előbb az üres hátoldalak, aztán az ismétlődések — és az üzenetek
 * szövege a `flashcards` kapujáé, bájtra: a hiánylista a javító promptba és a
 * felületre megy. Angolul, mert a modellnek szól.
 */
export function checkCardBasics(cards: readonly ParsedCard[]): string[] {
  const gaps: string[] = []

  for (const card of cards.filter((c) => c.body === '')) {
    gaps.push(`The card "${card.question}" is a heading without an answer below it.`)
  }

  const seen = new Map<string, string>()
  for (const card of cards) {
    const key = card.question.toLocaleLowerCase()
    const first = seen.get(key)
    if (first === undefined) {
      seen.set(key, card.question)
    } else {
      gaps.push(
        `Two cards ask the same question: "${first}". Ask about a different point instead.`,
      )
    }
  }

  return gaps
}
```

- [ ] **Step 7: Állítsd át a `flashcards.ts`-t a közös modulokra**

A `src/recipe/flashcards.ts` teljes új tartalma. A promptok és a rubrika szövege változatlan; csak a kiemelt segédek helye változik:

```ts
import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, faithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { Criterion, Score } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { checkCardBasics, parseCards } from './cards.js'
import { escapeHeadings, singleLine } from './markdown.js'
import { languageRule, RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/**
 * A kártyakészlet sémája. A `trim()` a csupa szóköz oldalt is kiszűri, a
 * hármas alsó korlát pedig azt, hogy egy egész videóból egyetlen kártya
 * szülessen. Felső korlátot nem írunk elő: a hosszabb átirat több kártyát
 * érdemel, a költséget pedig a futásonkénti plafon fogja.
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
 * A renderer **normalizál, nem hibázik**. A kérdésbe került sortörés egyetlen
 * sorrá olvad, a válasz fejléc-alakú sorai escape-et kapnak. Mindkettőt itt
 * kell megoldani, mert a kész szövegben már nem lennének megkülönböztethetők
 * a szabályos kártyahatároktól (`markdown.ts`).
 */
export function renderCards({ cards }: Flashcards): string {
  return cards
    .map((card) => `## ${singleLine(card.question)}\n\n${escapeHeadings(card.answer)}`)
    .join('\n\n')
}

/**
 * Determinisztikus kártya-kapu: nulla token, és bukása esetén a bíró-hívások
 * el sem indulnak.
 *
 * A közös ellenőrzéseken (`cards.ts`) túl a kártyaszámot nézi — védelmi réteg
 * a renderer hibája ellen, a sémán már fennakadna.
 *
 * A hiányüzenetek angolul szólnak, mert visszamennek a javító promptba.
 */
export function checkFlashcards(output: string): Score {
  const cards = parseCards(output)
  const gaps: string[] = []

  if (cards.length < 3) {
    gaps.push(
      `The note has ${String(cards.length)} card(s). Write at least three cards, each as a "## question" heading followed by its answer.`,
    )
  }
  gaps.push(...checkCardBasics(cards))

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
const flashcardFormatCriterion: Criterion = {
  name: 'flashcards-format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkFlashcards(ctx.output)),
}

const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    RULE.traceable,
    '- One card per idea. Ask about a single fact, definition, or causal link.',
    '- The question must be answerable from the transcript alone, without the video.',
    '- Keep the answer to one or two sentences.',
    '- Do not ask the same question twice.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
    '- Aim for 8 to 15 cards for a typical video; never fewer than three.',
  ].join('\n')

/**
 * Az első strukturált recept: tanulókártyák a normalizált átiratból.
 *
 * A modell nem sorformátumot ír, hanem objektumot ad: a `##` elválasztó a
 * rendererre tartozik, tehát a vault-formátum sosem a modell figyelmén múlik.
 */
export const flashcardsRecipe: Recipe = {
  id: 'flashcards',
  outputFile: '_flashcards.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,

  structured: structuredOutput(FlashcardsSchema, renderCards),

  prompt: ({ item, transcript }) =>
    [
      'Write study flashcards from the transcript of the video below.',
      '',
      'Rules:',
      rules(item),
      '',
      `Title: ${item.title}`,
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
      rules(item),
      '',
      `Title: ${item.title}`,
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
      languageCriterion,
      faithfulnessCriterion,
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga, ahogy a `summary`-nál: a kapuk nem
    // pontoznak, csak átengednek vagy megállítanak.
    passThreshold: 0.8,
  },
}
```

- [ ] **Step 8: Futtasd a közös modulok, a flashcards és a horgony tesztjeit**

Run: `mise exec -- pnpm vitest run src/recipe/markdown.test.ts src/recipe/cards.test.ts src/recipe/flashcards.test.ts src/recipe/prompts.test.ts`
Expected: PASS — a `flashcards.test.ts` egyetlen sora sem változott, és mind a 4 ujjlenyomat egyezik.

- [ ] **Step 9: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/recipe/prompts.test.ts src/recipe/markdown.ts src/recipe/markdown.test.ts src/recipe/cards.ts src/recipe/cards.test.ts src/recipe/flashcards.ts
git commit -m "refactor(recipe): közös kártya- és Markdown-segédek

- Az escape, a sorösszevonás és a kártyaelemzés közös modulba költözik
- Ujjlenyomat-horgony őrzi a meglévő négy recept promptját
- A flashcards viselkedése változatlan, a tesztjei érintetlenek

Refs #36"
```

---

### Task 2: Címkevarrat — a `decks` címke a frontmatterben

A Decks-plugin csak a `#decks` címkés jegyzetből épít paklit, a renderer viszont ma csak a videó metaadat-címkéit írja ki. A `Recipe` opcionális `tags` mezőt kap, és a `flashcards` már itt megkapja a `decks`-et.

**Files:**
- Modify: `src/recipe/types.ts:41-79` (a `Recipe` új mezője)
- Modify: `src/vault/render.ts:16-44` (`baseFields`), `:62-95` (`RecipeNoteMeta`, `renderRecipeNote`)
- Modify: `src/pipeline.ts:179-185` (a meta kitöltése)
- Modify: `src/recipe/flashcards.ts` (a recept objektumában egy sor)
- Test: `src/vault/render.test.ts`, `src/pipeline.test.ts`, `src/recipe/flashcards.test.ts`

**Interfaces:**
- Consumes: semmit korábbi feladatból.
- Produces: `Recipe.tags?: readonly string[]`, `RecipeNoteMeta.tags?: readonly string[]`. A 4. feladat (`bloomRecipe.tags`) erre épül.

- [ ] **Step 1: Írd meg a bukó teszteket**

A `src/vault/render.test.ts` `describe('renderRecipeNote', ...)` blokkjának végére:

```ts
  it('a recept címkéit a metaadat-címkék után fűzi, ismétlés nélkül', () => {
    const note = renderRecipeNote(
      item({ metadata: { tags: ['ai', 'decks'] } }),
      transcript,
      'A törzs.',
      { ...meta, tags: ['decks', 'bloom'] },
      '0.1.0',
    )
    expect(note).toContain('tags: [ai, decks, bloom]')
  })

  it('metaadat-címke nélkül csak a recept címkéi kerülnek be', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', { ...meta, tags: ['decks'] }, '0.1.0')
    expect(note).toContain('tags: [decks]')
  })

  it('recept-címke nélkül a tags mező pontosan a mai', () => {
    const withTags = renderRecipeNote(item({ metadata: { tags: ['ai'] } }), transcript, 'A törzs.', meta, '0.1.0')
    expect(withTags).toContain('tags: [ai]')
    expect(renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')).not.toContain('tags')
  })
```

A `src/pipeline.test.ts` `describe('processItem recepttel', ...)` blokkjában, a `'recepttel a jegyzetet is kiírja, a recept fájlnevével'` teszt **után**:

```ts
  it('a recept címkéit a jegyzet frontmatterjébe írja', async () => {
    const outcome = await processItem(item(), {
      ...alapDeps(),
      recipeDeps: {
        recipe: { ...ATMENO_RECEPT, tags: ['decks'] },
        client: probaKliens('## Generált jegyzet\n'),
        modelConfig: MODELL_CFG,
        guard: createCostGuard(5),
      },
    })

    const irt = await readFile(outcome.recipePath!, 'utf8')
    expect(irt).toContain('tags: [decks]')
  })
```

A `src/recipe/flashcards.test.ts` `describe('flashcardsRecipe', ...)` blokkjában, a `'sémával kikényszerített kimenetet kér'` teszt **után**:

```ts
  it('decks címkét kap, hogy a Decks plugin paklinak ismerje fel', () => {
    expect(flashcardsRecipe.tags).toEqual(['decks'])
  })
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/vault/render.test.ts src/pipeline.test.ts src/recipe/flashcards.test.ts`
Expected: FAIL — a három új render-teszt közül az első kettő (nincs `tags: [ai, decks, bloom]` / `tags: [decks]`), a pipeline-teszt és a flashcards-teszt (`undefined` ≠ `['decks']`).

- [ ] **Step 3: Vedd fel a `tags` mezőt a `Recipe`-re**

A `src/recipe/types.ts`-ben a `Recipe` interfészbe, az `outputRatio?` mező **után**:

```ts
  /**
   * A jegyzet frontmatterjébe kerülő címkék, a videó metaadat-címkéi után.
   * A Decks-plugin a `decks` címkéből ismeri fel a paklit; enélkül egy
   * kártyarecept jegyzete a vaultban nem válik ismételhető paklivá.
   */
  tags?: readonly string[]
```

- [ ] **Step 4: Fésüld össze a címkéket a rendererben**

A `src/vault/render.ts`-ben a `baseFields` **elé**:

```ts
/**
 * A metaadat-címkék érintetlenül, a mai sorrendben; utánuk a recept címkéi,
 * csak ha még nincsenek a listában. Recept-címke nélkül a metaadat listáját
 * adja vissza változatlanul — így a címke nélküli receptek frontmatterje
 * bájtra ugyanaz marad.
 */
function mergeTags(
  metadata: readonly string[] | undefined,
  extra: readonly string[] | undefined,
): readonly string[] | undefined {
  if (extra === undefined || extra.length === 0) return metadata
  const merged = [...(metadata ?? [])]
  for (const tag of extra) {
    if (!merged.includes(tag)) merged.push(tag)
  }
  return merged
}
```

A `baseFields` aláírása és a `tags` sora:

```ts
function baseFields(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
  extraTags?: readonly string[],
): FrontmatterField[] {
```

```ts
    ['tags', mergeTags(item.metadata.tags, extraTags)],
```

A `RecipeNoteMeta` új mezője a `costUsd` **után**:

```ts
  /** A recept címkéi; a metaadat-címkék után kerülnek a frontmatterbe. */
  tags?: readonly string[]
```

A `renderRecipeNote` törzsében a `baseFields` hívása:

```ts
    ...baseFields(item, transcript, generatorVersion, meta.tags),
```

A `renderTranscriptNote` hívása (`baseFields(item, transcript, generatorVersion)`) **nem változik**.

- [ ] **Step 5: Add át a recept címkéit a csővezetékben**

A `src/pipeline.ts`-ben a `renderRecipeNote` hívásának meta-objektuma:

```ts
  const markdown = renderRecipeNote(item, transcript, result.output, {
    recipe: recipe.id,
    model: modelConfig.models[recipe.role],
    iterations: result.generations,
    score: result.score,
    costUsd: usd,
    tags: recipe.tags,
  }, deps.version)
```

- [ ] **Step 6: A `flashcards` megkapja a címkét**

A `src/recipe/flashcards.ts`-ben a `flashcardsRecipe` objektumban, a `maxIterations: 0,` sor **után**:

```ts
  tags: ['decks'],
```

- [ ] **Step 7: Futtasd a teszteket**

Run: `mise exec -- pnpm vitest run src/vault/render.test.ts src/pipeline.test.ts src/recipe/flashcards.test.ts src/recipe/prompts.test.ts`
Expected: PASS — a horgony is: a címke a frontmatterbe megy, nem a promptba.

- [ ] **Step 8: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/recipe/types.ts src/vault/render.ts src/vault/render.test.ts src/pipeline.ts src/pipeline.test.ts src/recipe/flashcards.ts src/recipe/flashcards.test.ts
git commit -m "feat(vault): receptenkénti címkék a frontmatterben

- A Recipe opcionális tags mezőt kap, a renderer a metaadat után fésüli
- A flashcards decks címkét kap: a Decks eddig nem ismerte fel paklinak
- Címke nélküli receptnél a frontmatter bájtra a mai

Refs #36"
```

---

### Task 3: Pedagógiai hűségszabály és bíró

A két új recept szándékosan túlmehet az átiraton, de csak megnevezett zónákban, és ott sem mondhat ellent neki. A `RULE.traceable` és a `faithfulnessCriterion` érintetlen marad.

**Files:**
- Modify: `src/recipe/rules.ts` (új függvény a `languageRule` után)
- Modify: `src/rubric/judge.ts` (új gyártó a `coverageCriterion` után)
- Test: `src/recipe/rules.test.ts`, `src/rubric/judge.test.ts`

**Interfaces:**
- Consumes: `judgeCriterion({ name, instruction })` (`src/rubric/judge.ts:34`).
- Produces: `pedagogicalRule(freeParts: string): string`, `pedagogicalFaithfulnessCriterion(freeParts: string): Criterion` (név: `pedagogical-faithfulness`). A 4. és 5. feladat erre épül.

- [ ] **Step 1: Írd meg a bukó teszteket**

A `src/recipe/rules.test.ts` importja:

```ts
import { languageRule, pedagogicalRule, RULE } from './rules.js'
```

A fájl végére:

```ts
describe('pedagogicalRule', () => {
  it('megnevezi a szabad zónát', () => {
    expect(pedagogicalRule('every example')).toContain('every example')
  })

  it('a szabad zónának is megtiltja az ellentmondást és a beszélő szájába adást', () => {
    const rule = pedagogicalRule('every example')
    expect(rule).toMatch(/never contradict the transcript/i)
    expect(rule).toMatch(/speaker did not say/i)
  })

  it('nem a RULE.traceable: a külső tudás általános tilalma nincs benne', () => {
    expect(pedagogicalRule('every example')).not.toContain('Do not add outside')
  })
})
```

A `src/rubric/judge.test.ts` importja:

```ts
import {
  coverageCriterion,
  faithfulnessCriterion,
  judgeCriterion,
  pedagogicalFaithfulnessCriterion,
} from './judge.js'
```

A fájl végére:

```ts
describe('pedagogicalFaithfulnessCriterion', () => {
  it('nem blokkoló, és saját neve van', () => {
    const criterion = pedagogicalFaithfulnessCriterion('every example')
    expect(criterion.blocking).toBeUndefined()
    expect(criterion.name).toBe('pedagogical-faithfulness')
  })

  it('a bíró promptja megnevezi a szabad zónát, és ott csak az ellentmondást bünteti', async () => {
    const { client, promptok } = fixBiro({ score: 1, gaps: [] })

    await pedagogicalFaithfulnessCriterion(
      'every paragraph that starts with **Example:**',
    ).score(CTX, client)

    expect(promptok[0]).toContain('every paragraph that starts with **Example:**')
    expect(promptok[0]).toContain('Do not penalise them for going beyond the transcript.')
    expect(promptok[0]).toMatch(/contradicts the transcript/)
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/recipe/rules.test.ts src/rubric/judge.test.ts`
Expected: FAIL — `pedagogicalRule is not a function` / `pedagogicalFaithfulnessCriterion is not a function`.

- [ ] **Step 3: Írd meg a szabályt**

A `src/recipe/rules.ts` végére:

```ts
/**
 * A két tanulási recept (`bloom`, `notes`) hűségszabálya, a `RULE.traceable`
 * helyett. Ezek a receptek szándékosan túlmehetnek az átiraton — példával,
 * alkalmazással —, de csak a megnevezett zónákban, és ott sem mondhatnak
 * ellent neki. A zónát a recept nevezi meg, a saját sémamezőinek nyelvén.
 */
export function pedagogicalRule(freeParts: string): string {
  return [
    '- Whatever describes what the video says must be traceable to the transcript.',
    '  Do not speculate about what the speaker meant.',
    `- These parts may go beyond the transcript to apply, illustrate or add context: ${freeParts}.`,
    '  They must never contradict the transcript, and must never present as said by',
    '  the speaker something the speaker did not say.',
  ].join('\n')
}
```

- [ ] **Step 4: Írd meg a bírót**

A `src/rubric/judge.ts` végére:

```ts
/**
 * A tanulási receptek hűség-bírója. A szabad zónákat a **renderer által írt**
 * címkék jelölik ki (pl. `**Example:**`), ezért a bíró szerkezeti jelre
 * támaszkodik, nem a modell megfogalmazására. A zónán kívül a mai
 * `faithfulnessCriterion` mércéje érvényes; a zónán belül csak az ellentmondás
 * és a beszélő szájába adott állítás hiba.
 */
export function pedagogicalFaithfulnessCriterion(freeParts: string): Criterion {
  return judgeCriterion({
    name: 'pedagogical-faithfulness',
    instruction: [
      'You are grading study material written from the transcript below.',
      '',
      `Free parts: ${freeParts}.`,
      'Free parts may add examples, applications or context that the transcript does',
      'not contain. Do not penalise them for going beyond the transcript. Penalise a',
      'free part only if it contradicts the transcript, or presents as said by the',
      'speaker something the speaker did not say.',
      '',
      'Everything else must be traceable to the transcript. A claim that is true in',
      'general but never stated in the transcript is a failure there. Paraphrase is',
      'fine; invention is not.',
      '',
      'Return a score between 0 and 1, where 1 means there is no problem. List each',
      'problem as its own gap: quote the offending phrase, and say whether it is',
      'unsupported or contradicts the transcript.',
    ].join('\n'),
  })
}
```

- [ ] **Step 5: Futtasd a teszteket**

Run: `mise exec -- pnpm vitest run src/recipe/rules.test.ts src/rubric/judge.test.ts src/recipe/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/recipe/rules.ts src/recipe/rules.test.ts src/rubric/judge.ts src/rubric/judge.test.ts
git commit -m "feat(rubric): pedagógiai hűségszabály és bíró

- A megnevezett szabad zóna túlmehet az átiraton, de nem mondhat ellent
- A zónán kívül a mai hűségmérce érvényes
- A RULE.traceable és a faithfulness bíró érintetlen

Refs #36"
```

---

### Task 4: A `bloom` recept

**Files:**
- Create: `src/recipe/bloom.ts`, `src/recipe/bloom.test.ts`
- Create: `evals/bloom.eval.ts`
- Modify: `src/recipe/registry.ts:1-20`, `src/recipe/registry.test.ts:27`
- Modify: `src/view/overview.test.ts:36`, `:138`, `:189-194`
- Modify: `src/view/items.test.ts:84-89`
- Modify: `web/app/utils/format.ts:1-7`

**Interfaces:**
- Consumes: `escapeHeadings`, `singleLine` (1. feladat), `parseCards`, `checkCardBasics` (1. feladat), `Recipe.tags` (2. feladat), `pedagogicalRule`, `pedagogicalFaithfulnessCriterion` (3. feladat), `structuredOutput` (`src/recipe/structured.ts:29`).
- Produces: `BLOOM_LEVELS`, `type BloomLevel`, `BloomSchema`, `type Bloom`, `renderBloom(bloom: Bloom): string`, `checkBloom(output: string): Score`, `BLOOM_FREE_PARTS`, `bloomRecipe: Recipe` (`id: 'bloom'`). A 6. feladat a `bloomRecipe`-t használja.

- [ ] **Step 1: Írd meg a bukó tesztet**

`src/recipe/bloom.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { refine } from '../refine/loop.js'
import type { SourceItem } from '../types.js'
import {
  BLOOM_LEVELS,
  BloomSchema,
  bloomRecipe,
  checkBloom,
  renderBloom,
  type Bloom,
  type BloomLevel,
} from './bloom.js'

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

const INPUT = { item: ITEM, transcript: 'A, majd B.', timed: [] }

const kartya = (level: BloomLevel, n: number) => ({
  level,
  difficulty: 'beginner' as const,
  question: `${level} question ${String(n)}?`,
  answer: `Answer ${level} ${String(n)}.`,
  explanation: `Because ${level} ${String(n)}.`,
})

/** Szabályos pakli: mind a hat szinten három kártya. */
const PAKLI: Bloom = {
  cards: BLOOM_LEVELS.flatMap((level) => [1, 2, 3].map((n) => kartya(level, n))),
}

describe('BloomSchema', () => {
  it('ismeretlen szintet elutasít', () => {
    const rossz = { cards: [{ ...kartya('apply', 1), level: 'memorize' }] }
    expect(BloomSchema.safeParse(rossz).success).toBe(false)
  })

  it('üres paklit elutasít', () => {
    expect(BloomSchema.safeParse({ cards: [] }).success).toBe(false)
  })

  it('csupa szóköz magyarázatot elutasít', () => {
    const rossz = { cards: [{ ...kartya('apply', 1), explanation: '   ' }] }
    expect(BloomSchema.safeParse(rossz).success).toBe(false)
  })

  it('a széli szóközöket levágja', () => {
    const parsed = BloomSchema.parse({ cards: [{ ...kartya('apply', 1), answer: '  Igen.  ' }] })
    expect(parsed.cards[0]!.answer).toBe('Igen.')
  })
})

describe('renderBloom', () => {
  it('egy kártyát kérdés, válasz, magyarázat és címkesor alakban ír', () => {
    expect(renderBloom({ cards: [{ ...kartya('apply', 1), difficulty: 'intermediate' }] })).toBe(
      '## apply question 1?\n\nAnswer apply 1.\n\n**Why:** Because apply 1.\n\n*Apply · Intermediate*',
    )
  })

  it('szintsorrendbe rendez, szinten belül megtartja a modell sorrendjét', () => {
    const rendered = renderBloom({
      cards: [kartya('create', 1), kartya('remember', 2), kartya('remember', 1)],
    })
    const kerdesek = [...rendered.matchAll(/^## (.*)$/gm)].map((m) => m[1])
    expect(kerdesek).toEqual(['remember question 2?', 'remember question 1?', 'create question 1?'])
  })

  it('a kérdés sortörését egyetlen sorrá olvasztja', () => {
    const rendered = renderBloom({ cards: [{ ...kartya('apply', 1), question: 'Mi az\nA?' }] })
    expect(rendered).toContain('## Mi az A?')
  })

  it('a válaszban és a magyarázatban lévő `##` sort elfedi', () => {
    const rendered = renderBloom({
      cards: [{ ...kartya('apply', 1), answer: '## Fantom', explanation: 'Első.\n## Fantom' }],
    })
    expect(rendered.match(/^## /gm)).toHaveLength(1)
  })
})

describe('checkBloom', () => {
  it('szabályos paklira 1-et ad, hiányok nélkül', () => {
    expect(checkBloom(renderBloom(PAKLI))).toEqual({ value: 1, gaps: [] })
  })

  it('ha egy szinten kevés a kártya, megnevezi a szintet és a darabszámot', () => {
    const keves = {
      cards: PAKLI.cards.filter((c) => !(c.level === 'apply' && c.question.endsWith('3?'))),
    }
    const score = checkBloom(renderBloom(keves))
    expect(score.value).toBe(0)
    expect(score.gaps).toEqual([
      'The level "Apply" has 2 card(s). Write 3 to 5 cards for every level.',
    ])
  })

  it('ha egy szinten ötnél több kártya van, azt is megfogja', () => {
    const sok = {
      cards: [...PAKLI.cards, kartya('evaluate', 4), kartya('evaluate', 5), kartya('evaluate', 6)],
    }
    expect(checkBloom(renderBloom(sok)).gaps).toEqual([
      'The level "Evaluate" has 6 card(s). Write 3 to 5 cards for every level.',
    ])
  })

  it('a címkesor nélküli kártyát megnevezi', () => {
    const rendered = `${renderBloom(PAKLI)}\n\n## Címke nélkül?\n\nCsak válasz.`
    expect(checkBloom(rendered).gaps).toContain(
      'The card "Címke nélkül?" does not end with a level label.',
    )
  })

  it('az ismétlődő kérdést a közös ellenőrzés megfogja', () => {
    const ismetlodo = {
      cards: [...PAKLI.cards.slice(0, -1), { ...kartya('create', 3), question: 'CREATE question 1?' }],
    }
    expect(checkBloom(renderBloom(ismetlodo)).gaps.join(' ')).toMatch(/same question/)
  })

  it('a gap-üzenetek angolul szólnak, mert visszamennek a modellnek', () => {
    const score = checkBloom(renderBloom({ cards: [kartya('apply', 1)] }))
    expect(score.gaps.join(' ')).not.toMatch(/[áéíóöőúüű]/i)
  })
})

describe('bloomRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(bloomRecipe.id).toBe('bloom')
    expect(bloomRecipe.outputFile).toBe('_bloom.md')
  })

  it('publikálható, draft szerepű, javító kör nélküli, sémás recept', () => {
    expect(bloomRecipe.publishable).toBe(true)
    expect(bloomRecipe.role).toBe('draft')
    expect(bloomRecipe.maxIterations).toBe(0)
    expect(bloomRecipe.structured).toBeDefined()
  })

  it('decks címkét kap, hogy a Decks plugin paklinak ismerje fel', () => {
    expect(bloomRecipe.tags).toEqual(['decks'])
  })

  it('a kimeneti aránya a 0,1-es alapértelmezés fölött van', () => {
    expect(bloomRecipe.outputRatio).toBeGreaterThan(0.1)
  })

  it('rubrikája öt kritérium, az első három blokkoló', () => {
    const nevek = bloomRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual([
      'format',
      'bloom-format',
      'language',
      'pedagogical-faithfulness',
      'coverage',
    ])
    expect(bloomRecipe.rubric.criteria.slice(0, 3).every((c) => c.blocking === true)).toBe(true)
    expect(bloomRecipe.rubric.criteria.slice(3).every((c) => c.blocking === undefined)).toBe(true)
  })

  it('a prompt kéri a szintenkénti 3–5 kártyát, és benne van az átirat és a cím', () => {
    const prompt = bloomRecipe.prompt(INPUT)
    expect(prompt).toContain('3 to 5 cards for every level')
    expect(prompt).toContain('A, majd B.')
    expect(prompt).toContain('Title: Cím')
  })

  it('a prompt a pedagógiai szabályt idézi, nem a RULE.traceable-t', () => {
    const prompt = bloomRecipe.prompt(INPUT)
    expect(prompt).toContain('must never contradict the transcript')
    expect(prompt).not.toContain('Do not add outside')
  })

  it('a prompt SOHA nem tartalmaz Channel: sort', () => {
    expect(bloomRecipe.prompt(INPUT)).not.toContain('Channel:')
    expect(bloomRecipe.prompt(INPUT)).not.toContain('Csatorna')
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = bloomRecipe.repairPrompt({
      ...INPUT,
      previous: '## Régi kérdés?\n\nRégi válasz.',
      gaps: ['The level "Apply" has 2 card(s).'],
    })
    expect(prompt).toContain('The level "Apply" has 2 card(s).')
    expect(prompt).toContain('## Régi kérdés?')
  })

  it('rossz kártyaszámnál a bírók el sem indulnak, és a hiány megnevezi a szintet', async () => {
    const szerepek: string[] = []
    const client: ModelClient = {
      generate: () => Promise.reject(new Error('a recept sémás, szöveges hívás nem lehet')),
      generateObject: (role) => {
        szerepek.push(role)
        // Az első Remember-kártya hiányzik: a szinten csak kettő marad.
        return Promise.resolve({
          value: { cards: PAKLI.cards.slice(1) } as never,
          usage: { inputTokens: 1, outputTokens: 1 },
        })
      },
    }

    const result = await refine(bloomRecipe, INPUT, client)

    expect(szerepek).toEqual(['draft'])
    expect(result.score).toBe(0)
    expect(result.gaps).toEqual([
      'The level "Remember" has 2 card(s). Write 3 to 5 cards for every level.',
    ])
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/recipe/bloom.test.ts`
Expected: FAIL — `Failed to resolve import "./bloom.js"`.

- [ ] **Step 3: Írd meg a receptet**

`src/recipe/bloom.ts`:

```ts
import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, pedagogicalFaithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { Criterion, Score } from '../rubric/types.js'
import type { SourceItem } from '../types.js'
import { checkCardBasics, parseCards } from './cards.js'
import { escapeHeadings, singleLine } from './markdown.js'
import { languageRule, pedagogicalRule, RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/** A Bloom-taxonómia hat szintje, a kognitív igény növekvő sorrendjében. */
export const BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const
export type BloomLevel = (typeof BLOOM_LEVELS)[number]

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
type Difficulty = (typeof DIFFICULTIES)[number]

const LEVEL_LABELS: Record<BloomLevel, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

const MIN_PER_LEVEL = 3
const MAX_PER_LEVEL = 5

/** A renderer által írt címkesor; a kapu ebből olvassa vissza a szintet. */
const LABEL =
  /^\*(Remember|Understand|Apply|Analyze|Evaluate|Create) · (Beginner|Intermediate|Advanced)\*$/

/**
 * A pakli sémája. A szintenkénti darabszám **szándékosan nem** itt van: a
 * sémahiba `item:failed`, nyom nélkül; a kapu viszont megnevezett hiánnyal,
 * látható 0-s pontszámmal publikál (spec, 4. szakasz). Opcionális mező nincs,
 * mert a gateway `strict: true` sémát kap.
 */
export const BloomSchema = z.object({
  cards: z
    .array(
      z.object({
        level: z.enum(BLOOM_LEVELS),
        difficulty: z.enum(DIFFICULTIES),
        question: z.string().trim().min(1),
        answer: z.string().trim().min(1),
        explanation: z.string().trim().min(1),
      }),
    )
    .min(1),
})

export type Bloom = z.infer<typeof BloomSchema>

/**
 * Pakli → a Decks fejléc-bekezdés alakja, szintsorrendben. A szint és a
 * nehézség a kártya **utolsó** sorában áll, dőlt címkeként: a Decks
 * alapbeállításával működik, és a kapu ebből olvassa vissza.
 */
export function renderBloom({ cards }: Bloom): string {
  return BLOOM_LEVELS.flatMap((level) => cards.filter((card) => card.level === level))
    .map((card) =>
      [
        `## ${singleLine(card.question)}`,
        escapeHeadings(card.answer),
        `**Why:** ${escapeHeadings(card.explanation)}`,
        `*${LEVEL_LABELS[card.level]} · ${DIFFICULTY_LABELS[card.difficulty]}*`,
      ].join('\n\n'),
    )
    .join('\n\n')
}

/**
 * Determinisztikus Bloom-kapu, nulla token. A közös kártyaellenőrzéseken túl
 * minden kártya címkesorral zárul-e (a renderer hibája elleni védőréteg), és
 * mind a hat szinten 3–5 kártya van-e. Angolul, mert a modellnek szól.
 */
export function checkBloom(output: string): Score {
  const cards = parseCards(output)
  const gaps = checkCardBasics(cards)

  const counts = new Map<string, number>(Object.values(LEVEL_LABELS).map((label) => [label, 0]))
  for (const card of cards) {
    const last = card.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .at(-1)
    const label = last === undefined ? null : LABEL.exec(last)
    if (!label) {
      gaps.push(`The card "${card.question}" does not end with a level label.`)
      continue
    }
    counts.set(label[1]!, (counts.get(label[1]!) ?? 0) + 1)
  }

  for (const [label, count] of counts) {
    if (count < MIN_PER_LEVEL || count > MAX_PER_LEVEL) {
      gaps.push(
        `The level "${label}" has ${String(count)} card(s). Write ${String(MIN_PER_LEVEL)} to ${String(MAX_PER_LEVEL)} cards for every level.`,
      )
    }
  }

  return { value: gaps.length === 0 ? 1 : 0, gaps }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
const bloomFormatCriterion: Criterion = {
  name: 'bloom-format',
  blocking: true,
  score: (ctx) => Promise.resolve(checkBloom(ctx.output)),
}

/**
 * A bíró a RENDERELT jegyzetet olvassa, ezért a szabad zónát a renderer
 * címkéivel nevezzük meg. A magasabb szinteken a kérdés is szabad, mert maga
 * állít fel új helyzetet.
 */
export const BLOOM_FREE_PARTS =
  'the question and answer of every card whose last line is labelled Apply, Analyze, Evaluate or Create, and every paragraph that starts with **Why:**'

/** A modell a sémát tölti ki, ezért a promptban a sémamezők nyelvén szólunk. */
const FREE_IN_PROMPT =
  'the question and answer of apply, analyze, evaluate and create cards, and every explanation'

const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    pedagogicalRule(FREE_IN_PROMPT),
    '- Remember and understand cards must be answerable from the transcript alone.',
    "- Organise the cards by the six levels of Bloom's taxonomy:",
    '  remember: recall facts and terms (define, identify, list, recall);',
    '  understand: explain ideas (describe, explain, summarise, classify);',
    '  apply: use a procedure in a situation (apply, demonstrate, implement, solve);',
    '  analyze: break it into parts and relate them (compare, contrast, differentiate);',
    '  evaluate: judge against criteria (assess, critique, justify, recommend);',
    '  create: combine ideas into something new (design, formulate, plan, synthesise).',
    '- Write 3 to 5 cards for every level.',
    '- Rate each card beginner, intermediate or advanced; aim for roughly 40% beginner,',
    '  40% intermediate and 20% advanced.',
    '- The question must make sense on its own, without the video.',
    '- Keep the answer to one or two sentences and the explanation to two or three.',
    '- Do not ask the same question twice.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')

/**
 * Bloom-taxonómiás tanulókártyák: szintenként 3–5 kártya, válasszal, rövid
 * magyarázattal, szint- és nehézségcímkével. Önálló recept a `flashcards`
 * mellett, nem annak bővítése.
 */
export const bloomRecipe: Recipe = {
  id: 'bloom',
  outputFile: '_bloom.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  // Kezdőérték feltevésből (30 kártya × 100 szó a medián, 4050 szavas elemen);
  // a kalibráló futás (6. feladat) írja felül.
  outputRatio: 0.74,
  tags: ['decks'],

  structured: structuredOutput(BloomSchema, renderBloom),

  prompt: ({ item, transcript }) =>
    [
      "Write study flashcards organised by the levels of Bloom's taxonomy from the transcript of the video below.",
      '',
      'Rules:',
      rules(item),
      '',
      `Title: ${item.title}`,
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
      rules(item),
      '',
      `Title: ${item.title}`,
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
      bloomFormatCriterion,
      languageCriterion,
      pedagogicalFaithfulnessCriterion(BLOOM_FREE_PARTS),
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga, ahogy a `flashcards`-nál.
    passThreshold: 0.8,
  },
}
```

- [ ] **Step 4: Futtasd a recept tesztjét**

Run: `mise exec -- pnpm vitest run src/recipe/bloom.test.ts`
Expected: PASS.

- [ ] **Step 5: Vedd fel a registrybe, és igazítsd a registry-függő teszteket**

`src/recipe/registry.ts` — import és bejegyzés:

```ts
import { bloomRecipe } from './bloom.js'
```

```ts
export const RECIPES: Record<string, Recipe> = {
  [summaryRecipe.id]: summaryRecipe,
  [flashcardsRecipe.id]: flashcardsRecipe,
  [qaRecipe.id]: qaRecipe,
  [cleanRecipe.id]: cleanRecipe,
  [bloomRecipe.id]: bloomRecipe,
}
```

`src/recipe/registry.test.ts:27`:

```ts
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa', 'clean', 'bloom'])
```

`src/view/overview.test.ts:36`:

```ts
    expect(artifactKinds()).toEqual(['transcript', 'summary', 'flashcards', 'qa', 'clean', 'bloom'])
```

`src/view/overview.test.ts:138`:

```ts
    expect(overview.scores.map((s) => s.recipe)).toEqual(['summary', 'flashcards', 'qa', 'clean', 'bloom'])
```

`src/view/overview.test.ts`, a `readOverview` első tesztjének listája:

```ts
    expect(overview.corpus.map((c) => [c.kind, c.status.pending])).toEqual([
      ['transcript', 2],
      ['summary', 2],
      ['flashcards', 2],
      ['qa', 2],
      ['clean', 2],
      ['bloom', 2],
    ])
```

`src/view/items.test.ts`, a `'típusonként állapotcellát ad, a küszöb alattiak jelölésével'` teszt `cells` elvárása a `clean` sor **után**:

```ts
      bloom: { status: 'pending', score: null, costUsd: null, belowThreshold: false },
```

`web/app/utils/format.ts`, a `KIND_LABELS` a `clean` sor **után**:

```ts
  bloom: 'Bloom-kártya',
```

- [ ] **Step 6: Írd meg az evalt**

`evals/bloom.eval.ts`:

```ts
import { evalite } from 'evalite'
import { dedupeTimedLines } from '../src/normalize/dedupe.js'
import { BLOOM_LEVELS, bloomRecipe, checkBloom } from '../src/recipe/bloom.js'
import { refine } from '../src/refine/loop.js'
import { parseSubtitle } from '../src/subtitle/parse.js'
import type { SourceItem } from '../src/types.js'
import { fixtureClient } from './fixture-model.js'
import { PUBLIC_FIXTURES, type Fixture } from './fixtures/transcripts.js'
import { loadPrivateFixtures } from './private-layer.js'

function itemOf(fixture: Fixture): SourceItem {
  return {
    itemId: fixture.id,
    source: 'fixtures',
    sourceFile: `${fixture.id}.srt`,
    subtitlePath: `${fixture.id}.srt`,
    baseName: fixture.id,
    title: fixture.title,
    language: 'en',
    metadata: {
      videoId: fixture.id,
      channel: fixture.channel,
      uploadedAt: '2026-01-01',
      url: `https://example.com/${fixture.id}`,
    },
  }
}

evalite('bloom recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    const timed = dedupeTimedLines(parseSubtitle(fixture.srt, `${fixture.id}.srt`))
    const lines = timed.map((line) => line.text)
    const transcript = lines.join(' ')

    // A paklit a fixture SAJÁT soraiból rakjuk össze, szintenként hármat: így a
    // blokkoló kapuk konstrukció szerint átmennek, és a teljes út — séma,
    // renderer, kapu, két bíró — valódi kódon fut, kézzel írt JSON nélkül.
    const deck = {
      cards: BLOOM_LEVELS.flatMap((level, l) =>
        [0, 1, 2].map((n) => {
          const line = lines[(l * 3 + n) % Math.max(lines.length, 1)] ?? transcript
          return {
            level,
            difficulty: 'beginner',
            question: `Which point does ${level} card ${String(n + 1)} ask about?`,
            answer: line,
            explanation: `The transcript says: ${line}`,
          }
        }),
      ),
    }

    const result = await refine(
      bloomRecipe,
      { item: itemOf(fixture), transcript, timed },
      // Két modell-bíró van (pedagógiai hűség, lefedettség), tehát
      // generálásonként két ítélet kell.
      fixtureClient(fixture, {
        notes: [JSON.stringify(deck)],
        verdicts: [
          { score: 0.9, gaps: [] },
          { score: 0.9, gaps: [] },
        ],
      }),
    )

    return {
      output: result.output,
      score: result.score,
      cards: (result.output.match(/^## /gm) ?? []).length,
    }
  },

  scorers: [
    {
      name: 'bloom-kapu',
      description: 'Determinisztikus: szintsorrend, címkesor, szintenként 3–5 kártya.',
      scorer: ({ output }) => checkBloom(output.output).value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Kártya', value: output.cards },
    { label: 'Pontszám', value: output.score },
  ],
})
```

- [ ] **Step 7: Futtasd az evalt**

Run: `mise exec -- pnpm eval`
Expected: hálózat és kulcs nélkül lefut. A `bloom recept` evalnál a `bloom-kapu` 1,00, a `Kártya` oszlop 18; a `formatumhiba` fixture-nél is 18, mert a vázlat itt nem a fixture wikilinkes jegyzete. A meglévő `summary` és `clean` eval eredménye nem változik.

- [ ] **Step 8: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/recipe/bloom.ts src/recipe/bloom.test.ts src/recipe/registry.ts src/recipe/registry.test.ts src/view/overview.test.ts src/view/items.test.ts web/app/utils/format.ts evals/bloom.eval.ts
git commit -m "feat(recipe): Bloom-taxonómiás kártyák

- Szintenként 3–5 kártya, válasz, rövid magyarázat, szint- és nehézségcímke
- Sémás kimenet; a szintsorrendet és a címkesort a renderer garantálja
- Nulla tokenes kapu: szintenkénti darabszám, ismétlődés, üres hátoldal
- Pedagógiai hűségbíró: a magasabb szintek és a magyarázat szabad zóna
- decks címke, registry, webes címke és offline eval

Refs #36"
```

---

### Task 5: A `notes` recept

**Files:**
- Create: `src/recipe/notes.ts`, `src/recipe/notes.test.ts`
- Create: `evals/notes.eval.ts`
- Modify: `src/recipe/registry.ts`, `src/recipe/registry.test.ts:27`
- Modify: `src/view/overview.test.ts` (ugyanaz a három hely, mint a 4. feladatban)
- Modify: `src/view/items.test.ts` (a `cells` elvárás)
- Modify: `web/app/utils/format.ts`

**Interfaces:**
- Consumes: `escapeHeadings`, `singleLine` (1. feladat), `pedagogicalRule`, `pedagogicalFaithfulnessCriterion` (3. feladat), `structuredOutput`.
- Produces: `NotesSchema`, `type Notes`, `diagramSource(raw: string): string | null`, `renderNotes(notes: Notes): string`, `NOTES_FREE_PARTS`, `notesRecipe: Recipe` (`id: 'notes'`). A 6. feladat a `notesRecipe`-t használja.

- [ ] **Step 1: Írd meg a bukó tesztet**

`src/recipe/notes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { NotesSchema, diagramSource, notesRecipe, renderNotes, type Notes } from './notes.js'

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

const INPUT = { item: ITEM, transcript: 'A, majd B.', timed: [] }

const JEGYZET: Notes = {
  summary: 'The video explains caching.',
  diagram: 'flowchart LR\n  A[Request] --> B[Cache]',
  concepts: [
    {
      name: 'Cache hit',
      definition: 'Data found in the cache.',
      explanation: 'The request is served from memory.',
      example: 'A CDN returns a stored image.',
      variation: 'What if the entry expired? → It becomes a miss.',
    },
    {
      name: 'Cache miss',
      definition: 'Data not in the cache.',
      explanation: 'The request goes to the origin.',
      example: 'A first visit to a page.',
      variation: 'What if the origin is down? → The request fails.',
    },
    {
      name: 'Eviction',
      definition: 'Removing entries.',
      explanation: 'Old entries make room for new ones.',
      example: 'LRU drops the oldest read.',
      variation: 'What if memory grows? → Fewer evictions.',
    },
  ],
}

describe('NotesSchema', () => {
  it('háromnál kevesebb fogalmat elutasít', () => {
    expect(NotesSchema.safeParse({ ...JEGYZET, concepts: JEGYZET.concepts.slice(0, 2) }).success).toBe(false)
  })

  it('a diagram mező kötelező, de üres lehet — strict sémában nincs opcionális mező', () => {
    expect(NotesSchema.safeParse({ summary: JEGYZET.summary, concepts: JEGYZET.concepts }).success).toBe(false)
    expect(NotesSchema.safeParse({ ...JEGYZET, diagram: '' }).success).toBe(true)
  })

  it('csupa szóköz példát elutasít', () => {
    const rossz = {
      ...JEGYZET,
      concepts: [{ ...JEGYZET.concepts[0]!, example: '   ' }, ...JEGYZET.concepts.slice(1)],
    }
    expect(NotesSchema.safeParse(rossz).success).toBe(false)
  })
})

describe('diagramSource', () => {
  it('a kerítés nélküli forrást változatlanul adja', () => {
    expect(diagramSource('flowchart LR\n  A --> B')).toBe('flowchart LR\n  A --> B')
  })

  it('a ```mermaid kerítést leszedi', () => {
    expect(diagramSource('```mermaid\nflowchart LR\n  A --> B\n```')).toBe('flowchart LR\n  A --> B')
  })

  it('a nyelv nélküli kerítést is leszedi', () => {
    expect(diagramSource('```\nmindmap\n  root\n```')).toBe('mindmap\n  root')
  })

  it('üres vagy csupa szóköz forrásra null', () => {
    expect(diagramSource('')).toBeNull()
    expect(diagramSource('  \n ')).toBeNull()
  })

  it('bent maradt kerítéssorra null: a félbevágott kerítés elrontaná a jegyzetet', () => {
    expect(diagramSource('flowchart LR\n```\nA --> B')).toBeNull()
  })
})

describe('renderNotes', () => {
  it('összefoglaló, diagram, fogalmak példával és variációval, a megadott sorrendben', () => {
    const expected = [
      'The video explains caching.',
      '',
      '## Overview',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Request] --> B[Cache]',
      '```',
      '',
      '## Key Concepts',
      '',
      '### Cache hit',
      '',
      'The request is served from memory.',
      '',
      '**Example:** A CDN returns a stored image.',
      '',
      '**Variation:** What if the entry expired? → It becomes a miss.',
      '',
      '### Cache miss',
    ].join('\n')
    const rendered = renderNotes(JEGYZET)
    expect(rendered.slice(0, expected.length)).toBe(expected)
  })

  it('a táblázatot a fogalmakból építi, fogalmanként egy sorral', () => {
    const expected = [
      '## Summary Table',
      '',
      '| Term | Definition | Example |',
      '| --- | --- | --- |',
      '| Cache hit | Data found in the cache. | A CDN returns a stored image. |',
      '| Cache miss | Data not in the cache. | A first visit to a page. |',
      '| Eviction | Removing entries. | LRU drops the oldest read. |',
    ].join('\n')
    const rendered = renderNotes(JEGYZET)
    expect(rendered.slice(-expected.length)).toBe(expected)
  })

  it('üres diagramnál az Overview szakasz kimarad', () => {
    const rendered = renderNotes({ ...JEGYZET, diagram: '' })
    expect(rendered).not.toContain('## Overview')
    expect(rendered).not.toContain('```')
    expect(rendered.startsWith('The video explains caching.\n\n## Key Concepts\n\n### Cache hit')).toBe(true)
  })

  it('a cellában a `|` escape-et kap, a sortörés szóközzé olvad', () => {
    const rendered = renderNotes({
      ...JEGYZET,
      concepts: [{ ...JEGYZET.concepts[0]!, definition: 'A | B\nC' }, ...JEGYZET.concepts.slice(1)],
    })
    expect(rendered).toContain('| Cache hit | A \\| B C | A CDN returns a stored image. |')
  })

  it('a magyarázatban lévő fejléc-alakú sort elfedi', () => {
    const rendered = renderNotes({
      ...JEGYZET,
      concepts: [{ ...JEGYZET.concepts[0]!, explanation: 'Első.\n## Fantom' }, ...JEGYZET.concepts.slice(1)],
    })
    expect(rendered).toContain('Első.\n\\## Fantom')
    expect(rendered.match(/^## /gm)).toHaveLength(3)
  })
})

describe('notesRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(notesRecipe.id).toBe('notes')
    expect(notesRecipe.outputFile).toBe('_notes.md')
  })

  it('publikálható, draft szerepű, javító kör nélküli, sémás recept, címke nélkül', () => {
    expect(notesRecipe.publishable).toBe(true)
    expect(notesRecipe.role).toBe('draft')
    expect(notesRecipe.maxIterations).toBe(0)
    expect(notesRecipe.structured).toBeDefined()
    expect(notesRecipe.tags).toBeUndefined()
  })

  it('a kimeneti aránya a 0,1-es alapértelmezés fölött van', () => {
    expect(notesRecipe.outputRatio).toBeGreaterThan(0.1)
  })

  it('rubrikája négy kritérium, az első kettő blokkoló', () => {
    const nevek = notesRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'language', 'pedagogical-faithfulness', 'coverage'])
    expect(notesRecipe.rubric.criteria.slice(0, 2).every((c) => c.blocking === true)).toBe(true)
    expect(notesRecipe.rubric.criteria.slice(2).every((c) => c.blocking === undefined)).toBe(true)
  })

  it('a prompt kéri a kulcsfogalmakat és az üres diagramot, és benne van az átirat', () => {
    const prompt = notesRecipe.prompt(INPUT)
    expect(prompt).toContain('3 to 8 key concepts')
    expect(prompt).toContain('otherwise an empty string')
    expect(prompt).toContain('A, majd B.')
    expect(prompt).toContain('Title: Cím')
  })

  it('a prompt a pedagógiai szabályt idézi, nem a RULE.traceable-t', () => {
    const prompt = notesRecipe.prompt(INPUT)
    expect(prompt).toContain('must never contradict the transcript')
    expect(prompt).not.toContain('Do not add outside')
    expect(prompt).not.toContain('Channel:')
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = notesRecipe.repairPrompt({
      ...INPUT,
      previous: '### Régi fogalom',
      gaps: ['The example of "Cache hit" contradicts the transcript.'],
    })
    expect(prompt).toContain('The example of "Cache hit" contradicts the transcript.')
    expect(prompt).toContain('### Régi fogalom')
  })
})
```

- [ ] **Step 2: Futtasd, és győződj meg róla, hogy bukik**

Run: `mise exec -- pnpm vitest run src/recipe/notes.test.ts`
Expected: FAIL — `Failed to resolve import "./notes.js"`.

- [ ] **Step 3: Írd meg a receptet**

`src/recipe/notes.ts`:

```ts
import { z } from 'zod'
import { formatCriterion } from '../rubric/format.js'
import { coverageCriterion, pedagogicalFaithfulnessCriterion } from '../rubric/judge.js'
import { languageCriterion } from '../rubric/language.js'
import type { SourceItem } from '../types.js'
import { escapeHeadings, singleLine } from './markdown.js'
import { languageRule, pedagogicalRule, RULE } from './rules.js'
import { structuredOutput } from './structured.js'
import type { Recipe } from './types.js'

/**
 * A strukturált jegyzet sémája. A `diagram` kötelező, de üres lehet: a gateway
 * `strict: true` sémát kap, amiben az opcionális mező elutasítható.
 */
export const NotesSchema = z.object({
  summary: z.string().trim().min(1),
  /** Mermaid-forrás kerítés nélkül; üres string = nincs diagram. */
  diagram: z.string().trim(),
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        definition: z.string().trim().min(1),
        explanation: z.string().trim().min(1),
        example: z.string().trim().min(1),
        variation: z.string().trim().min(1),
      }),
    )
    .min(3),
})

export type Notes = z.infer<typeof NotesSchema>

const FENCED = /^```[\w-]*[ \t]*\n([\s\S]*?)\n```$/

/**
 * A diagram forrása kerítés nélkül, vagy `null`, ha nincs diagram.
 *
 * Ha a modell a tiltás ellenére bekerítette, a kerítést leszedjük. Ha ezután is
 * marad benne kerítéssor, a diagram kimarad: egy félbevágott kerítés a
 * jegyzet hátralévő részét kódblokká tenné.
 */
export function diagramSource(raw: string): string | null {
  const trimmed = raw.trim()
  const fenced = FENCED.exec(trimmed)
  const source = (fenced ? fenced[1]! : trimmed).trim()
  if (source === '' || /^[ \t]*```/m.test(source)) return null
  return source
}

/** Táblázatcella: egy sorba, a `|` escape-pel — a futásriport tábláinak szabálya. */
function tableCell(text: string): string {
  return singleLine(text).replace(/\|/g, '\\|')
}

/**
 * Jegyzet → Markdown. A példa és a variáció címkéjét a renderer írja ki, és a
 * táblázat a fogalmakból épül: így a kötelező elemek nem a modell figyelmén
 * múlnak, és a bíró szabad zónája szerkezeti jelre támaszkodik.
 */
export function renderNotes(notes: Notes): string {
  const parts = [escapeHeadings(notes.summary)]

  const diagram = diagramSource(notes.diagram)
  if (diagram !== null) {
    parts.push('## Overview', ['```mermaid', diagram, '```'].join('\n'))
  }

  parts.push('## Key Concepts')
  for (const concept of notes.concepts) {
    parts.push(
      `### ${singleLine(concept.name)}`,
      escapeHeadings(concept.explanation),
      `**Example:** ${escapeHeadings(concept.example)}`,
      `**Variation:** ${escapeHeadings(concept.variation)}`,
    )
  }

  parts.push(
    '## Summary Table',
    [
      '| Term | Definition | Example |',
      '| --- | --- | --- |',
      ...notes.concepts.map(
        (c) => `| ${tableCell(c.name)} | ${tableCell(c.definition)} | ${tableCell(c.example)} |`,
      ),
    ].join('\n'),
  )

  return parts.join('\n\n')
}

/** A bíró a RENDERELT jegyzetet olvassa, ezért a renderer címkéivel szólunk. */
export const NOTES_FREE_PARTS =
  'every paragraph that starts with **Example:** or **Variation:**, and the Example column of the Summary Table'

const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    pedagogicalRule('every example and every variation'),
    '- Pick 3 to 8 key concepts of the video.',
    '- summary: one sentence on what the video is about.',
    '- For each concept: a one-sentence definition, an explanation of two to four',
    '  sentences, a concrete example of one or two sentences, and a variation in the',
    '  form "What if …? → …".',
    '- diagram: Mermaid source (flowchart, sequenceDiagram or mindmap) when the content',
    '  has a process, a structure or relationships; otherwise an empty string. Write',
    '  the diagram source only, without a ``` fence.',
    RULE.noFrontmatter,
    RULE.noWikilinks,
  ].join('\n')

/**
 * Strukturált jegyzet: fogalmanként definíció, magyarázat, példa és variáció,
 * összefoglaló táblázat, és ahol a tartalom indokolja, Mermaid-diagram. A
 * `summary`-tól a példa, a variáció és a táblázat különbözteti meg.
 */
export const notesRecipe: Recipe = {
  id: 'notes',
  outputFile: '_notes.md',
  publishable: true,
  role: 'draft',
  maxIterations: 0,
  // Kezdőérték feltevésből (kb. 1200 szó a medián, 4050 szavas elemen); a
  // kalibráló futás (6. feladat) írja felül.
  outputRatio: 0.3,

  structured: structuredOutput(NotesSchema, renderNotes),

  prompt: ({ item, transcript }) =>
    [
      'Write structured study notes built on key concepts from the transcript of the video below.',
      '',
      'Rules:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  repairPrompt: ({ item, transcript, previous, gaps }) =>
    [
      'Revise the notes below. A reviewer scored them against the transcript and',
      'listed concrete gaps. Fix every gap. Keep what already works — do not rewrite',
      'the notes wholesale.',
      '',
      'The original rules still apply:',
      rules(item),
      '',
      `Title: ${item.title}`,
      '',
      '--- GAPS TO FIX ---',
      ...gaps.map((gap) => `- ${gap}`),
      '',
      '--- CURRENT NOTES ---',
      previous,
      '',
      '--- TRANSCRIPT ---',
      transcript,
    ].join('\n'),

  rubric: {
    criteria: [
      formatCriterion,
      languageCriterion,
      pedagogicalFaithfulnessCriterion(NOTES_FREE_PARTS),
      coverageCriterion,
    ],
    // A két bíró-kritérium átlaga. Saját kapu nincs: a kötelező elemeket a
    // séma és a renderer garantálja.
    passThreshold: 0.8,
  },
}
```

- [ ] **Step 4: Futtasd a recept tesztjét**

Run: `mise exec -- pnpm vitest run src/recipe/notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Vedd fel a registrybe, és igazítsd a registry-függő teszteket**

`src/recipe/registry.ts`:

```ts
import { notesRecipe } from './notes.js'
```

```ts
  [bloomRecipe.id]: bloomRecipe,
  [notesRecipe.id]: notesRecipe,
}
```

`src/recipe/registry.test.ts:27`:

```ts
    expect(RECIPE_IDS).toEqual(['summary', 'flashcards', 'qa', 'clean', 'bloom', 'notes'])
```

`src/view/overview.test.ts`:

```ts
    expect(artifactKinds()).toEqual([
      'transcript',
      'summary',
      'flashcards',
      'qa',
      'clean',
      'bloom',
      'notes',
    ])
```

```ts
    expect(overview.scores.map((s) => s.recipe)).toEqual([
      'summary',
      'flashcards',
      'qa',
      'clean',
      'bloom',
      'notes',
    ])
```

```ts
      ['bloom', 2],
      ['notes', 2],
    ])
```

`src/view/items.test.ts`, a `bloom` cella **után**:

```ts
      notes: { status: 'pending', score: null, costUsd: null, belowThreshold: false },
```

`web/app/utils/format.ts`, a `bloom` sor **után**:

```ts
  notes: 'strukturált jegyzet',
```

- [ ] **Step 6: Írd meg az evalt**

`evals/notes.eval.ts`:

```ts
import { evalite } from 'evalite'
import { dedupeTimedLines } from '../src/normalize/dedupe.js'
import { notesRecipe } from '../src/recipe/notes.js'
import { refine } from '../src/refine/loop.js'
import { parseSubtitle } from '../src/subtitle/parse.js'
import type { SourceItem } from '../src/types.js'
import { fixtureClient } from './fixture-model.js'
import { PUBLIC_FIXTURES, type Fixture } from './fixtures/transcripts.js'
import { loadPrivateFixtures } from './private-layer.js'

function itemOf(fixture: Fixture): SourceItem {
  return {
    itemId: fixture.id,
    source: 'fixtures',
    sourceFile: `${fixture.id}.srt`,
    subtitlePath: `${fixture.id}.srt`,
    baseName: fixture.id,
    title: fixture.title,
    language: 'en',
    metadata: {
      videoId: fixture.id,
      channel: fixture.channel,
      uploadedAt: '2026-01-01',
      url: `https://example.com/${fixture.id}`,
    },
  }
}

/**
 * Szerkezeti pontszám: minden `###` fogalom alatt ott a példa és a variáció,
 * és a táblázat sorainak száma megegyezik a fogalmakéval.
 */
function structure(output: string): number {
  const sections = output.split(/^### /m).slice(1)
  const rows = output
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Term') && !line.startsWith('| ---'))
  const complete = sections.every((s) => s.includes('**Example:**') && s.includes('**Variation:**'))
  return sections.length > 0 && complete && rows.length === sections.length ? 1 : 0
}

evalite('notes recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    const timed = dedupeTimedLines(parseSubtitle(fixture.srt, `${fixture.id}.srt`))
    const lines = timed.map((line) => line.text)
    const transcript = lines.join(' ')
    const pick = (i: number): string => lines[i % Math.max(lines.length, 1)] ?? transcript

    // A jegyzetet a fixture SAJÁT soraiból rakjuk össze: a teljes út — séma,
    // renderer, kapuk, két bíró — valódi kódon fut, kézzel írt JSON nélkül.
    const notes = {
      summary: pick(0),
      diagram: 'flowchart LR\n  A[Start] --> B[End]',
      concepts: [0, 1, 2].map((n) => ({
        name: `Point ${String(n + 1)}`,
        definition: pick(n),
        explanation: pick(n + 1),
        example: `For example: ${pick(n + 2)}`,
        variation: 'What if this point were left out? → The note would miss it.',
      })),
    }

    const result = await refine(
      notesRecipe,
      { item: itemOf(fixture), transcript, timed },
      fixtureClient(fixture, {
        notes: [JSON.stringify(notes)],
        verdicts: [
          { score: 0.9, gaps: [] },
          { score: 0.9, gaps: [] },
        ],
      }),
    )

    return { output: result.output, score: result.score }
  },

  scorers: [
    {
      name: 'szerkezet',
      description: 'Determinisztikus: fogalmanként példa és variáció, a táblázat a fogalmakból.',
      scorer: ({ output }) => structure(output.output),
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [{ label: 'Pontszám', value: output.score }],
})
```

- [ ] **Step 7: Futtasd az evalt**

Run: `mise exec -- pnpm eval`
Expected: hálózat és kulcs nélkül lefut; a `notes recept` evalnál a `szerkezet` 1,00; a `bloom`, `summary` és `clean` eval eredménye nem változik.

- [ ] **Step 8: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/recipe/notes.ts src/recipe/notes.test.ts src/recipe/registry.ts src/recipe/registry.test.ts src/view/overview.test.ts src/view/items.test.ts web/app/utils/format.ts evals/notes.eval.ts
git commit -m "feat(recipe): strukturált jegyzet

- Fogalmanként definíció, magyarázat, példa és variáció
- Az összefoglaló táblázat a fogalmakból épül, a modell nem írja külön
- Mermaid-diagram, ha a tartalom indokolja; üres string, ha nem
- Pedagógiai hűségbíró: a példa és a variáció szabad zóna
- Registry, webes címke és offline eval

Refs #36"
```

---

### Task 6: Kalibrálás valódi hívásokkal

A két kezdő `outputRatio` feltevésből jött. Egy kis szkript három elemen (legrövidebb, medián, leghosszabb) megméri a valós kimeneti arányt és a pedagógiai bíró viselkedését. **A futás valódi pénzt költ: csak a felhasználó kifejezett jóváhagyása után indul.**

> **Ítéletet igénylő lépések** (a 4. lépés jóváhagyáskérése, a 7. lépés bíró-értékelése): ezeket az orkesztrátor végzi, nem egy végrehajtó alügynök.

**Files:**
- Create: `evals/measure/calibrate.ts`
- Modify: `package.json` (`scripts`)
- Modify: `src/recipe/bloom.ts`, `src/recipe/notes.ts` (az `outputRatio` sora és kommentje)
- Create: `docs/measurements/<a futás dátuma>-bloom-notes-kalibralas.md`

**Interfaces:**
- Consumes: `bloomRecipe` (4. feladat), `notesRecipe` (5. feladat), `metered` (`evals/measure/metered.ts`), `rateLimited` (`evals/measure/rate-limit.ts`), `retrying`, `createModelClient`, `createCostGuard`, `estimateItemUsd`, `refine`, `normalizeItem`, `discoverAll`.
- Produces: a végleges `outputRatio` értékek és a mérési dokumentum.

- [ ] **Step 1: Írd meg a szkriptet**

`evals/measure/calibrate.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { loadConfig, loadDotEnv, loadModelConfig } from '../../src/config.js'
import { createCostGuard, estimateItemUsd } from '../../src/model/budget.js'
import { createModelClient } from '../../src/model/client.js'
import { TOKENS_PER_WORD, costOf } from '../../src/model/pricing.js'
import { retrying } from '../../src/model/retry.js'
import { normalizeItem } from '../../src/pipeline.js'
import { bloomRecipe } from '../../src/recipe/bloom.js'
import { notesRecipe } from '../../src/recipe/notes.js'
import type { Recipe } from '../../src/recipe/types.js'
import { refine } from '../../src/refine/loop.js'
import { discoverAll } from '../../src/source/folder.js'
import type { SourceItem, TimedLine } from '../../src/types.js'
import { metered } from './metered.js'
import { rateLimited } from './rate-limit.js'

/**
 * A `bloom` és a `notes` kimeneti arányának kalibrálása valódi hívásokkal
 * (spec: „Kalibrálás — a szelet végén"). Három elemen fut — a legrövidebb, a
 * medián és a leghosszabb —, receptenként egy generálással, teljes rubrikával.
 *
 * A becslő a kimenetet a bemenet arányában számolja, ezért a javasolt
 * `outputRatio` a MEDIÁN elemen mért arány: ugyanaz a választás, amivel a spec
 * a kezdőértékeket számolta.
 */
const RECIPES: Recipe[] = [bloomRecipe, notesRecipe]
const RAW_PATH = join('evals', 'private', 'calibration-bloom-notes.json')

const { values } = parseArgs({
  options: {
    budget: { type: 'string' },
    /** Csak a becslést írja ki, modellhívás nélkül. */
    estimate: { type: 'boolean', default: false },
  },
})

loadDotEnv()
const raw = parseYaml(await readFile('refinery.config.yaml', 'utf8')) as Record<string, unknown>
const cfg = loadConfig(raw, 'refinery.config.yaml')
const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)

interface Candidate {
  item: SourceItem
  words: number
  transcript: string
  timed: TimedLine[]
}

// 1. Jelöltek: minden elem szószáma. Nulla modellhívás.
const candidates: Candidate[] = []
for (const item of await discoverAll(cfg.sources, cfg.languages)) {
  try {
    const normalized = await normalizeItem(item)
    candidates.push({
      item,
      words: normalized.wordsNormalized,
      transcript: normalized.lines.join(' '),
      timed: normalized.timed,
    })
  } catch {
    // Sérült feliratfájl: kimarad, nem állítja meg a kalibrálást.
  }
}
if (candidates.length === 0) {
  console.error('Nincs feldolgozható elem a forrásmappákban.')
  process.exit(2)
}
candidates.sort((a, b) => a.words - b.words)

const medianIndex = Math.floor(candidates.length / 2)
const medianId = candidates[medianIndex]!.item.itemId
const sample = [...new Set([0, medianIndex, candidates.length - 1])].map((i) => candidates[i]!)

// 2. Becslés: a mintára és a teljes korpuszra, receptenként.
const judgesOf = (recipe: Recipe): number =>
  recipe.rubric.criteria.filter((c) => !c.blocking).length
const estimateFor = (recipe: Recipe, words: number): number =>
  estimateItemUsd(words, recipe.maxIterations, modelConfig, {
    outputRatio: recipe.outputRatio,
    judges: judgesOf(recipe),
  })

let sampleUsd = 0
for (const recipe of RECIPES) {
  const recipeSample = sample.reduce((sum, c) => sum + estimateFor(recipe, c.words), 0)
  const corpus = candidates.reduce((sum, c) => sum + estimateFor(recipe, c.words), 0)
  sampleUsd += recipeSample
  console.log(
    `${recipe.id}: minta ~$${recipeSample.toFixed(2)}, teljes korpusz (${String(candidates.length)} elem) ~$${corpus.toFixed(2)}`,
  )
}
console.log(`A minta: ${sample.map((c) => `${c.item.title} (${String(c.words)} szó)`).join('; ')}`)
console.log(
  `Becsült költség összesen: $${sampleUsd.toFixed(2)}, kétszeres ráhagyással $${(sampleUsd * 2).toFixed(2)}`,
)

if (values.estimate) process.exit(0)

// 3. Költségkapu: a kétszeres ráhagyással számolt becslés a budget fölött el
//    sem indul (valódi pénzt költő futások fegyelme).
const budget = Number(values.budget)
if (!Number.isFinite(budget) || budget <= 0) {
  console.error('Kötelező a --budget kapcsoló, pozitív dollárösszeggel (pl. --budget 1).')
  process.exit(2)
}
if (sampleUsd * 2 > budget) {
  console.error('A kétszeres ráhagyással számolt becslés a budget fölött van — a kalibrálás nem indul el.')
  process.exit(2)
}

// 4. A mérés. A burkolók sorrendje a mérő harness (`run.ts`) mintája: a
//    `metered` legbelül könyvel minden tényleges hívást, akkor is, ha a
//    `refine` később dob.
const guard = createCostGuard(budget)
const client = retrying(
  rateLimited(metered(createModelClient(modelConfig), guard, modelConfig), { perMinute: 18 }),
)

interface CalibrationRecord {
  recipe: string
  itemId: string
  title: string
  words: number
  median: boolean
  outputTokens: number
  outputRatio: number
  score: number
  gaps: string[]
  usd: number
  output: string
}
const records: CalibrationRecord[] = []
const failures: { recipe: string; itemId: string; message: string }[] = []

for (const recipe of RECIPES) {
  for (const c of sample) {
    if (guard.exceeded()) break
    try {
      const result = await refine(
        recipe,
        { item: c.item, transcript: c.transcript, timed: c.timed },
        client,
      )
      const round = result.rounds[0]!
      const record: CalibrationRecord = {
        recipe: recipe.id,
        itemId: c.item.itemId,
        title: c.item.title,
        words: c.words,
        median: c.item.itemId === medianId,
        outputTokens: round.generateUsage.outputTokens,
        outputRatio: round.generateUsage.outputTokens / (c.words * TOKENS_PER_WORD),
        score: result.score,
        gaps: result.gaps,
        usd:
          costOf(round.generateUsage, modelConfig.pricing[recipe.role]) +
          costOf(round.scoreUsage, modelConfig.pricing.judge),
        output: result.output,
      }
      records.push(record)
      console.log(
        `${recipe.id} ${String(c.words)} szó: arány ${record.outputRatio.toFixed(2)}, pontszám ${record.score.toFixed(2)}, $${record.usd.toFixed(3)}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ recipe: recipe.id, itemId: c.item.itemId, message })
      console.error(`${recipe.id} ${c.item.itemId}: HIBA — ${message}`)
    }
  }
}
if (guard.exceeded()) {
  console.error(`A keret elfogyott ($${guard.spentUsd().toFixed(2)}) — a kalibrálás megállt.`)
}

// 5. Kiírás: a nyers adat (a kimenetekkel és a hiánylistákkal) privát.
await mkdir(join('evals', 'private'), { recursive: true })
await writeFile(
  RAW_PATH,
  JSON.stringify({ records, failures, spentUsd: guard.spentUsd() }, null, 2),
  'utf8',
)

console.log('\n| recept | szó | medián elem | kimeneti token | arány | pontszám | $ |')
console.log('|---|---|---|---|---|---|---|')
for (const r of records) {
  console.log(
    `| ${r.recipe} | ${String(r.words)} | ${r.median ? 'igen' : ''} | ${String(r.outputTokens)} | ${r.outputRatio.toFixed(2)} | ${r.score.toFixed(2)} | ${r.usd.toFixed(3)} |`,
  )
}

for (const recipe of RECIPES) {
  const median = records.find((r) => r.recipe === recipe.id && r.median)
  console.log(
    median
      ? `${recipe.id}: javasolt outputRatio ${(Math.ceil(median.outputRatio * 100) / 100).toFixed(2)} (most ${String(recipe.outputRatio)})`
      : `${recipe.id}: a medián elem mérése hiányzik — nincs javaslat.`,
  )
}
console.log(`Költés: $${guard.spentUsd().toFixed(2)} · nyers adat: ${RAW_PATH}`)
if (failures.length > 0) process.exit(1)
```

A `package.json` `scripts` blokkjában a `"measure"` sor **után**:

```json
    "calibrate": "tsx evals/measure/calibrate.ts",
```

- [ ] **Step 2: Típus- és lint-ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 3: Futtasd a becslést — modellhívás nélkül**

Run: `mise exec -- pnpm calibrate --estimate`
Expected: kiírja a mintát (3 elem, a mai korpuszon 1926, a medián és 22 477 szó körül), a receptenkénti minta- és korpuszbecslést, és a kétszeres ráhagyású összeget. **A korpuszbecslés a spec 4. sikerkritériumának ellenőrzése:** `bloom` kb. $2,2, `notes` kb. $1,3 a 19 elemre. Modellhívás nem történik, a szkript 0-s kóddal lép ki.

- [ ] **Step 4: ÁLLJ MEG — kérj jóváhagyást a felhasználótól**

Mutasd meg a 3. lépés kimenetét: a mintát, a becsült költséget és a kétszeres ráhagyású összeget, azzal, hogy a futás **$1-es plafonnal** indulna. Csak kifejezett „igen” után lépj tovább. Ha a kétszeres ráhagyású összeg $1 fölött van, ne kérj nagyobb keretet magadtól: jelezd a felhasználónak, és ő dönt.

- [ ] **Step 5: Futtasd a kalibrálást**

Run: `mise exec -- pnpm calibrate --budget 1`
Expected: receptenként három sor, a táblázat, receptenként egy javasolt `outputRatio`, és a `Költés:` sor $1 alatt. Ha a szkript 1-es kóddal lép ki (egy elem elbukott), a hiba szövegét add át a felhasználónak, és ne ismételd meg magadtól a futást.

- [ ] **Step 6: Írd át a kimeneti arányokat a mért értékre**

A `src/recipe/bloom.ts` és a `src/recipe/notes.ts` `outputRatio` sorát a szkript által javasolt értékre állítsd, és a kommentet cseréld a mérésre hivatkozóra. A `bloom.ts`-ben:

```ts
  // A medián elemen mért kimeneti arány, felfelé kerekítve
  // (docs/measurements/<a futás dátuma>-bloom-notes-kalibralas.md).
  outputRatio: <a szkript bloom-javaslata>,
```

A `notes.ts`-ben ugyanígy, a `notes`-javaslattal. A recept-tesztek csak azt állítják, hogy az arány 0,1 fölött van — ha egy javaslat 0,1 vagy alatta lenne, **állj meg** és jelezd, mert az a spec feltevésének cáfolata.

Run: `mise exec -- pnpm vitest run src/recipe/bloom.test.ts src/recipe/notes.test.ts && mise exec -- pnpm calibrate --estimate`
Expected: PASS, és az új korpuszbecslés.

- [ ] **Step 7: Értékeld a pedagógiai bíró hiánylistáit**

Olvasd el az `evals/private/calibration-bloom-notes.json` `records[].gaps` mezőit. Számold meg, hány hiány kifogásol egy szabad zónát (Example, Variation, Why, vagy egy Apply–Create kártya) **pusztán azért, mert túlmegy az átiraton**, ellentmondás nélkül. Ha ilyen van, a bíró nem úgy viselkedik, ahogy a spec előírja: **ne javítsd a bírót magadtól**, hanem idézd a hiányokat a felhasználónak, és ő dönt.

- [ ] **Step 8: Írd meg a mérési dokumentumot**

`docs/measurements/<a futás dátuma>-bloom-notes-kalibralas.md` — gépnevek és útvonalak nélkül, a szkript kimenetéből:

```markdown
# Mérés — a Bloom- és a jegyzetrecept kimeneti aránya

**Dátum:** <a futás napja> · **Költés:** <a szkript „Költés:" sora> · **Modellek:** vázlat `<modelConfig.models.draft>`, bíró `<modelConfig.models.judge>`

## Kérdés

A spec kezdő `outputRatio` értékei (bloom 0,74, notes 0,30) feltevésből jöttek.
Mennyi a valós kimenet a bemenet arányában, és kíméli-e a pedagógiai bíró a
szabad zónákat?

## Módszer

Három elem a korpuszból — a legrövidebb, a medián és a leghosszabb —,
receptenként egy generálás, a teljes rubrikával. Szkript:
`pnpm calibrate --budget 1`. A nyers adat privát, verziókövetésen kívül.

## Eredmény

<a szkript táblázata, változatlanul>

## Döntés

- `bloom.outputRatio`: 0,74 → <új érték>, a medián elemen mért arány felfelé kerekítve.
- `notes.outputRatio`: 0,30 → <új érték>, ugyanígy.
- A becslés a teljes korpuszra az új aránnyal: bloom <összeg>, notes <összeg>.
- A pedagógiai bíró: <a 7. lépés számlálása — hány hiány kifogásolt szabad zónát pusztán a túllépésért>.

## A mérés korlátja

Három elem, egy ismétlés: az arány nagyságrendjét mutatja, nem eloszlást.
```

- [ ] **Step 9: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add evals/measure/calibrate.ts package.json src/recipe/bloom.ts src/recipe/notes.ts docs/measurements/
git commit -m "feat(evals): a Bloom- és jegyzetrecept kalibrálása

- Három elemen mért kimeneti arány, receptenként egy generálással
- A két outputRatio a medián elemen mért értékre áll
- Mérési dokumentum a pedagógiai bíró viselkedésével

Refs #36"
```

---

### Task 7: Füstpróba a vaultban és dokumentáció

A spec 1–2. sikerkritériuma valódi futást és kézi Obsidian-ellenőrzést kér. **A futás valódi pénzt költ és a vaultba ír (commitol): csak a felhasználó kifejezett jóváhagyása után indul.**

**Files:**
- Modify: `docs/roadmap.md` (Fázis 6)
- Modify: `README.md` (állapotblokk és a receptleírás)

**Interfaces:**
- Consumes: minden korábbi feladat.
- Produces: semmit kódként.

- [ ] **Step 1: Buildeld a CLI-t**

A `pnpm exec refinery` a `dist/`-et futtatja, ami a forrásnál régebbi lehet.

Run: `mise exec -- pnpm build`
Expected: hiba nélkül lefut.

- [ ] **Step 2: ÁLLJ MEG — kérj jóváhagyást a felhasználótól**

Mondd el: két futás jönne, `run --recipe bloom --limit 1` és `run --recipe notes --limit 1`. Mindkettő a felderítés első elemén fut (a mai korpuszon egy kb. 5100 szavas elem), a 6. feladat végleges arányaival számolva nagyjából $0,1 körüli költséggel receptenként. Mindkettő a vaultba ír és commitol, a plafon a konfiguráció `cost_limit_usd` értéke. Csak kifejezett „igen” után lépj tovább.

- [ ] **Step 3: Futtasd a két receptet**

Run: `mise exec -- pnpm exec refinery run --recipe bloom --limit 1`
Run: `mise exec -- pnpm exec refinery run --recipe notes --limit 1`
Expected: mindkettő `Becslés:` sorral indul, és a riportban egy publikált jegyzetet mutat. A `_bloom.md` frontmatterében `decks` címke van, a kártyák szintsorrendben állnak, mind a hat szinten 3–5 kártya, mindegyik `*Level · Difficulty*` sorral zárul. A `_notes.md`-ben minden `###` alatt ott az Example és a Variation, és a táblázat sorainak száma egyezik a fogalmakéval. Ha a pontszám 0, a riport hiánylistáját add át a felhasználónak.

- [ ] **Step 4: Kérd meg a felhasználót a kézi ellenőrzésre**

Két megfigyelést kérj tőle Obsidianban: (1) a Decks a `_bloom.md`-t paklinak ismeri-e fel; (2) ha a `_notes.md`-ben van diagram, az hiba nélkül rajzolódik-e ki. Az eredményt jegyezd fel a PR leírásához.

- [ ] **Step 5: Frissítsd a roadmapet**

A `docs/roadmap.md` Fázis 6 szakaszában, a tisztított leirat „Kész, ha” listája **után**:

```markdown
**A Bloom-kártyák és a strukturált jegyzet — státusz: kész** (<a commit napja>). Spec és terv:
[`plans/2026-09-16-bloom-es-strukturalt-jegyzet-spec.md`](<./plans/2026-09-16-bloom-es-strukturalt-jegyzet-spec.md>),
[`plans/2026-09-16-bloom-es-strukturalt-jegyzet.md`](<./plans/2026-09-16-bloom-es-strukturalt-jegyzet.md>).

**Kész, ha (Bloom-kártyák és strukturált jegyzet):**

- A `bloom` recept `_bloom.md`-t ír `decks` címkével, szintsorrendben, mind a
  hat szinten 3–5 kártyával, és a Decks paklinak ismeri fel.
- A `notes` recept `_notes.md`-t ír, amelyben minden fogalom alatt ott a példa
  és a variáció, és a táblázat sorai a fogalmakkal egyeznek.
- Egy új `flashcards` jegyzet is `decks` címkét kap; a meglévő négy recept
  promptja bájtra változatlan.
- Ha egy Bloom-szinten rossz a kártyaszám, a jegyzet nulla bíró-hívással,
  megnevezett hiánnyal kerül ki.
- A két kimeneti arány mért érték:
  [a kalibrálás](<./measurements/<a mérési dokumentum fájlneve>>).
```

Ugyanebben a szakaszban a

```markdown
A másik három recept — Bloom-taxonómiás tanulókártya, strukturált jegyzet,
fordítás fordítási memóriával — külön szelet, saját speckel és tervvel.
```

bekezdés helyére:

```markdown
A fordítás fordítási memóriával külön szelet, saját speckel és tervvel.
```

- [ ] **Step 6: Frissítsd a README-t**

A `README.md` állapotblokkjában a

```markdown
> szeletel, az átmeneti modellhibát korlátos újrapróbálkozás nyeli el. Négy
> recept van: összefoglaló, tanulókártya, kérdés-felelet és tisztított
> leirat (bekezdésenkénti időbélyeggel); a második iteráció mért haszna
```

sorok helyére:

```markdown
> szeletel, az átmeneti modellhibát korlátos újrapróbálkozás nyeli el. Hat
> recept van: összefoglaló, tanulókártya, kérdés-felelet, tisztított leirat
> (bekezdésenkénti időbélyeggel), Bloom-taxonómiás kártyák és strukturált
> jegyzet; a második iteráció mért haszna
```

A `--recipe clean` bekezdése **után** új bekezdés:

```markdown
A `--recipe bloom` a Bloom-taxonómia hat szintjére (Remember → Create) tagolt
kártyapaklit ír, szintenként 3–5 kártyával; a szint és a nehézség a kártya
hátulján áll, a jegyzet pedig `decks` címkét kap, így a Decks plugin paklinak
ismeri fel. A `--recipe notes` fogalmakra bontott jegyzetet ír: fogalmanként
definíció, magyarázat, példa és variáció, egy a fogalmakból összeállított
összefoglaló táblázat, és ahol a tartalom indokolja, Mermaid-diagram. Mindkét
recept sémás, a Markdownt renderer írja. A példa, a variáció és a magasabb
Bloom-szintek szándékosan túlmehetnek az átiraton — egy saját bíró azt
ellenőrzi, hogy nem mondanak ellent neki.
```

- [ ] **Step 7: Teljes ellenőrzés**

Run: `mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/roadmap.md README.md
git commit -m "docs: a Bloom- és jegyzetrecept a roadmapben és a READMEban

- Fázis 6: a második szelet státusza és kész-kritériumai
- A README állapotblokkja és receptleírása a két új recepttel

Refs #36"
```

---

## Amit a terv szándékosan nem tartalmaz

- **A fordítást fordítási memóriával** — külön szelet, saját speckel.
- **A `scan --queue` futtatását a valódi vaulton.** A két új sor a registryből
  jön (`src/cli.ts:168`), a beszúrás idempotenciáját a meglévő
  `src/queue/merge.test.ts` bizonyítja; a vault sorának bővítése a felhasználó
  döntése.
- **Becslő-változást** (fix kimeneti méret) — a spec szerint a köteg egészére
  biztonságos irányú a hiba.
- **Mermaid-szintaxis ellenőrzését** és **Decks-profil beállítását.**
- **A PR megnyitását** — a végrehajtás után, a felhasználó jóváhagyásával,
  `Closes #36` lábléccel.
