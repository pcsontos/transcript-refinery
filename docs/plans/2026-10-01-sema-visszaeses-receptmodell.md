# Sémás visszaesés és receptenkénti modell — implementációs terv

> **Végrehajtóknak:** KÖTELEZŐ al-skill: `superpowers:executing-plans` (a felhasználó döntése: **Opus 5.5**, executing-plans, alügynök-dispatch nélkül). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** a sémás hívás (a `flashcards`, `notes`, `bloom` recept és a bíró) kényszerített `tool_choice`-ot elutasító modellen is működjön; a configban receptenként lehessen modellt választani; a költség mindig a ténylegesen használt modell árán könyvelődjön.

**Architektúra:** a #78 a modellkliensen belül marad: a `generateObject` a gateway forced-`tool_choice` 400-ára egyszer, modellenként megjegyezve `toolChoice: 'auto'`-s tool-hívásra vált (`src/model/tool-fallback.ts` + `src/model/client.ts`). A #79 a config betöltőjében (`pricing` modellnév szerint, `model.recipes`) és egy receptre szabott `ModelConfig`-nézetben (`modelConfigFor`) él; a szerep szerint számoló kód (költségőr, könyvelés, becslés) a nézetet kapja, és változatlan logikával helyes modellt és árat használ.

**Tech stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Node ≥ 26.2, `ai@7.0.91`, `@ai-sdk/openai-compatible@3.0.43`, `zod@4.5.2`, `yaml`, vitest, pnpm.

**Spec:** `docs/plans/2026-10-01-sema-visszaeses-receptmodell-spec.md` — a végrehajtó mindkettőt olvassa.

## Globális megkötések

- A gateway-üzenet jellemző része pontosan: `does not support forced tool_choice`.
- A tool-úton a séma neve: `submit_result`; `toolChoice: 'auto'`.
- A config új alakja: `model.recipes: { <receptazonosító>: <modell> }` (opcionális) és `pricing: { <modellnév>: { input_per_million, output_per_million } }`.
- A régi `pricing.draft` / `pricing.judge` alak beszédes hibával áll meg (kivéve, ha tényleg van `draft`/`judge` nevű használt modell).
- A receptkulcs pontos azonosító; **nincs öröklés** a forrásreceptből a fordításra (`notes` ≠ `notes-hu`).
- A felülbírálás csak a generálást érinti; a pontozás mindig `model.judge`.
- Nincs új hibaút: a tool-út kudarca `AI_NoObjectGeneratedError`, amit a `src/recipe/structured.ts` a mai módon csomagol.
- A kódkommentek és a hibaüzenetek **magyarul**, a modellnek szóló szöveg (tool-leírás) angolul, mint a promptok.
- Minden task végén: `pnpm vitest run`, `pnpm typecheck`, `pnpm lint` zöld.
- Commit minden task végén a **`commit-message` skillel** (a felhasználó szabálya); a lépésekben szereplő üzenet csak javaslat. A `.mise.toml` a felhasználó módosítása, **soha ne kerüljön stage-be**.

## Review Focus

1. **Prózába ágyazott JSON a szöveges válaszban** („Here is the result: {…} Hope this helps") — egy ember azt várja, hogy ez is elfogadott legyen. → Task 1 teszt (`a szöveg körüli prózát levágja`).
2. **Opus-bíró szöveges recepten** (`summary`) — a pontozás fusson le, ne buktassa el a receptet. → Task 2 teszt (`a bíró a visszaesés után is pontoz`), Task 8 valódi próba.
3. **A retry-réteg és a visszaesés együtt** — a `retrying()` alatt se menjen ki fölösleges harmadik kérés. → Task 2 teszt (`retry mellett is pontosan két kérés`).
4. **Régi `pricing` alakú config modellhívás nélküli parancsnál** (`scan`, `list`) — ezek továbbra is fussanak, a hiba csak recepttel jöjjön. → Task 3 teszt (`a loadConfig a régi pricing-alakot nem nézi`).
5. **Pontot és dupla kötőjelet tartalmazó modellnév YAML-kulcsként** (`sub2api--grok-4.7`) a `check-pricing --fix`-ben. → Task 5 teszt.

---

### Task 0: Munkaág

- [ ] **Step 1:** A spec + terv PR merge-e után friss `main`-ről új ág:

```bash
git switch main && git pull --ff-only
git switch -c feat/sema-fallback-receptmodell
```

- [ ] **Step 2:** Kiinduló állapot zöld:

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: minden zöld (1073 teszt körül).

---

### Task 1: Visszaesési segédek (`tool-fallback.ts`)

**Files:**
- Create: `src/model/tool-fallback.ts`
- Test: `src/model/tool-fallback.test.ts`

**Interfaces:**
- Produces:
  - `FORCED_TOOL_CHOICE_MARKER: string`
  - `isForcedToolChoiceRejection(error: unknown): boolean`
  - `interface ToolChoiceFallback { has(model: string): boolean; add(model: string): void }`
  - `toolChoiceFallback(onFirst?: (model: string) => void): ToolChoiceFallback`
  - `type Extracted<T> = { ok: true; value: T } | { ok: false; reason: string }`
  - `extractObject<T>(schema: ZodType<T>, toolInput: unknown, text: string): Extracted<T>`

- [ ] **Step 1: A bukó teszt**

`src/model/tool-fallback.test.ts`:

```ts
import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  extractObject,
  isForcedToolChoiceRejection,
  toolChoiceFallback,
} from './tool-fallback.js'

const SEMA = z.object({ score: z.number(), gaps: z.array(z.string()) })

/** A LiteLLM tényleges üzenete (2026-09-25, `logs/2026-09-26T08-08-21.md`). */
const OPUS_400 =
  'litellm.BadRequestError: AnthropicException - {"error":{"message":"claude-opus-5-5 does not support forced tool_choice; use auto or none","type":"invalid_request_error"},"type":"error"}. Received Model Group=sub2api--claude-opus-5-5'

function hivasHiba(message: string, responseBody?: string): APICallError {
  return new APICallError({
    message,
    url: 'http://localhost:4000/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 400,
    responseBody,
    isRetryable: false,
  })
}

describe('isForcedToolChoiceRejection', () => {
  it('felismeri a gateway elutasítását az üzenetben', () => {
    expect(isForcedToolChoiceRejection(hivasHiba(OPUS_400))).toBe(true)
  })

  it('felismeri a válasz törzsében is', () => {
    expect(isForcedToolChoiceRejection(hivasHiba('Bad Request', OPUS_400))).toBe(true)
  })

  it('felismeri az ok-láncban is', () => {
    const burkolt = new Error('a hívás elbukott', { cause: hivasHiba(OPUS_400) })
    expect(isForcedToolChoiceRejection(burkolt)).toBe(true)
  })

  it('más 400-as hibát nem tekint elutasításnak', () => {
    expect(isForcedToolChoiceRejection(hivasHiba('context length exceeded'))).toBe(false)
  })

  it('nem objektum hibára hamis', () => {
    expect(isForcedToolChoiceRejection('does not support forced tool_choice')).toBe(false)
    expect(isForcedToolChoiceRejection(undefined)).toBe(false)
  })
})

describe('toolChoiceFallback', () => {
  it('kezdetben egyik modellt sem ismeri', () => {
    expect(toolChoiceFallback().has('opus')).toBe(false)
  })

  it('a rögzített modellt megjegyzi', () => {
    const fallback = toolChoiceFallback()
    fallback.add('opus')
    expect(fallback.has('opus')).toBe(true)
    expect(fallback.has('sonnet')).toBe(false)
  })

  it('modellenként egyszer jelez, ismételt rögzítésre nem', () => {
    const jelzett: string[] = []
    const fallback = toolChoiceFallback((model) => jelzett.push(model))
    fallback.add('opus')
    fallback.add('opus')
    fallback.add('grok')
    expect(jelzett).toEqual(['opus', 'grok'])
  })
})

describe('extractObject', () => {
  it('a tool-hívás argumentumát validálja', () => {
    expect(extractObject(SEMA, { score: 0.7, gaps: [] }, '')).toEqual({
      ok: true,
      value: { score: 0.7, gaps: [] },
    })
  })

  it('szövegként érkező tool-argumentumot is értelmez', () => {
    expect(extractObject(SEMA, '{"score":0.7,"gaps":[]}', '')).toEqual({
      ok: true,
      value: { score: 0.7, gaps: [] },
    })
  })

  it('a séma-sértő tool-argumentumot elutasítja, megnevezve a mezőt', () => {
    const result = extractObject(SEMA, { score: 0.7, gaps: 'nem tömb' }, '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('gaps')
  })

  it('tool-hívás nélkül a szöveges JSON-t validálja', () => {
    expect(extractObject(SEMA, undefined, '{"score":0.4,"gaps":["x"]}')).toEqual({
      ok: true,
      value: { score: 0.4, gaps: ['x'] },
    })
  })

  it('a ```json kerítést leszedi', () => {
    const text = '```json\n{"score":0.4,"gaps":[]}\n```'
    expect(extractObject(SEMA, undefined, text)).toEqual({ ok: true, value: { score: 0.4, gaps: [] } })
  })

  it('a nyelv nélküli kerítést is leszedi', () => {
    const text = '```\n{"score":0.4,"gaps":[]}\n```'
    expect(extractObject(SEMA, undefined, text)).toEqual({ ok: true, value: { score: 0.4, gaps: [] } })
  })

  it('a szöveg körüli prózát levágja', () => {
    const text = 'Here is the result:\n{"score":0.4,"gaps":[]}\nHope this helps.'
    expect(extractObject(SEMA, undefined, text)).toEqual({ ok: true, value: { score: 0.4, gaps: [] } })
  })

  it('JSON nélküli szövegre beszédes okot ad', () => {
    const result = extractObject(SEMA, undefined, 'Sajnos ezt nem tudom pontozni.')
    expect(result).toEqual({ ok: false, reason: 'a modell szöveges válaszában nincs értelmezhető JSON' })
  })

  it('se tool-hívás, se szöveg: beszédes ok', () => {
    expect(extractObject(SEMA, undefined, '   ')).toEqual({
      ok: false,
      reason: 'a modell se tool-hívást, se szöveget nem adott',
    })
  })
})
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `pnpm vitest run src/model/tool-fallback.test.ts`
Expected: FAIL — `Failed to resolve import "./tool-fallback.js"`.

- [ ] **Step 3: A megvalósítás**

`src/model/tool-fallback.ts`:

```ts
import { prettifyError, type ZodType } from 'zod'

/**
 * A gateway elutasításának jellemző része. A LiteLLM a sémás kérést
 * (`response_format: json_schema`) Anthropic felé **kényszerített**
 * tool-hívásra fordítja, és a `claude-opus-5-5` ezt 400-zal utasítja el
 * (2026-09-25, issue #78). A szöveg a szolgáltatóé: ha átírják, a hiba
 * hangosan visszajön, nem némán.
 */
export const FORCED_TOOL_CHOICE_MARKER = 'does not support forced tool_choice'

/** Az ok-láncban legfeljebb ennyi szintet nézünk: a körkörös `cause` ne akassza meg. */
const MAX_DEPTH = 5

/**
 * A kényszerített `tool_choice` elutasítása-e a hiba. Az üzenetet és a válasz
 * törzsét is nézi, az ok-lánc minden szintjén: az SDK és a proxy máshol-máshol
 * hagyja a szöveget.
 */
export function isForcedToolChoiceRejection(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) return false
    const e = current as { message?: unknown; responseBody?: unknown; cause?: unknown }
    for (const field of [e.message, e.responseBody]) {
      if (typeof field === 'string' && field.includes(FORCED_TOOL_CHOICE_MARKER)) return true
    }
    current = e.cause
  }
  return false
}

/** Azok a modellek, amelyek a futás során elutasították a kényszerített `tool_choice`-t. */
export interface ToolChoiceFallback {
  has(model: string): boolean
  add(model: string): void
}

/**
 * Futásonkénti, memóriabeli emlékezet: az első elutasítás után az adott modell
 * sémás hívása egyből a tool-úton megy, így nincs több fölösleges kérés. Az
 * `onFirst` modellenként egyszer szól — a CLI ebből ír naplóeseményt.
 */
export function toolChoiceFallback(
  onFirst: (model: string) => void = () => undefined,
): ToolChoiceFallback {
  const models = new Set<string>()
  return {
    has: (model) => models.has(model),
    add(model) {
      if (models.has(model)) return
      models.add(model)
      onFirst(model)
    },
  }
}

export type Extracted<T> = { ok: true; value: T } | { ok: false; reason: string }

type Found = { found: true; value: unknown } | { found: false; reason: string }

const FENCE = /```(?:json)?\s*([\s\S]*?)```/

/** Az első `{`-tól az utolsó `}`-ig: a JSON körüli próza levágása. */
function braces(text: string): string | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : undefined
}

/**
 * JSON a modell szövegéből. Sorrendben próbálja: a kerítés belsejét, a teljes
 * szöveget, végül a kapcsos zárójelek közti részt — az Opus `json_object`
 * módban is kerítésbe tette a választ (2026-09-30-i próba).
 */
function jsonFromText(text: string): Found {
  const trimmed = text.trim()
  if (trimmed === '') return { found: false, reason: 'a modell se tool-hívást, se szöveget nem adott' }
  const candidates = [FENCE.exec(trimmed)?.[1]?.trim(), trimmed, braces(trimmed)]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    try {
      return { found: true, value: JSON.parse(candidate) as unknown }
    } catch {
      // Nem JSON — jöhet a következő jelölt.
    }
  }
  return { found: false, reason: 'a modell szöveges válaszában nincs értelmezhető JSON' }
}

/**
 * A tool-út eredménye: a tool-hívás argumentuma, ha van, különben a szöveges
 * válaszból kinyert JSON — mindkét esetben a sémával validálva. A hívó a
 * kudarcot séma-hibaként dobja tovább.
 */
export function extractObject<T>(
  schema: ZodType<T>,
  toolInput: unknown,
  text: string,
): Extracted<T> {
  const found: Found =
    toolInput === undefined
      ? jsonFromText(text)
      : typeof toolInput === 'string'
        ? jsonFromText(toolInput)
        : { found: true, value: toolInput }
  if (!found.found) return { ok: false, reason: found.reason }
  const parsed = schema.safeParse(found.value)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: prettifyError(parsed.error) }
}
```

- [ ] **Step 4: Futtasd, hogy átmenjen**

Run: `pnpm vitest run src/model/tool-fallback.test.ts`
Expected: PASS (17 teszt).

- [ ] **Step 5: Ellenőrzés és commit**

Run: `pnpm typecheck && pnpm lint`
Expected: hiba nélkül.

Commit (`commit-message` skill; javaslat): `feat(model): Add forced tool_choice fallback helpers` — `Refs #78`.

---

### Task 2: A kliens visszaesése (`client.ts`)

**Files:**
- Modify: `src/model/client.ts` (importok; `modelClientFrom`; `createModelClient`)
- Test: `src/model/client.test.ts` (új `describe`, a meglévő `createModelClient(CFG, elkapo.fetch)` hívás átírása)

**Interfaces:**
- Consumes (Task 1): `isForcedToolChoiceRejection`, `toolChoiceFallback`, `ToolChoiceFallback`, `extractObject`.
- Produces:
  - `interface ModelClientOptions { fallback?: ToolChoiceFallback }`
  - `interface CreateModelClientOptions extends ModelClientOptions { fetch?: typeof globalThis.fetch }`
  - `modelClientFrom(models: Record<ModelRole, LanguageModel>, opts?: ModelClientOptions): ModelClient`
  - `createModelClient(cfg: ModelConfig, opts?: CreateModelClientOptions): ModelClient` — **a második paraméter objektum lett** (eddig `fetch?`).

- [ ] **Step 1: A bukó tesztek**

`src/model/client.test.ts` — az importok bővülnek:

```ts
import { APICallError, type FinishReason } from 'ai'
import { structuredOutput } from '../recipe/structured.js'
import { judgeCriterion } from '../rubric/judge.js'
import { toolChoiceFallback } from './tool-fallback.js'
```

(Az első sor a meglévő `import type { FinishReason } from 'ai'` helyére kerül.)

A fájl végére:

```ts
const SEMA = z.object({ score: z.number(), gaps: z.array(z.string()) })

const OPUS_400 =
  'litellm.BadRequestError: AnthropicException - {"error":{"message":"claude-opus-5-5 does not support forced tool_choice; use auto or none"}}'

/** Egy kérés lényege: sémás (`json`) volt-e, és milyen tool-beállítással ment. */
interface Latott {
  sema: boolean
  toolChoice: string | undefined
  tools: string[]
}

const HASZNALAT = {
  inputTokens: { total: 90, noCache: 90, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
}

/**
 * Opus-szerű fixture: a sémás (`json`) kérést a gateway 400-ával utasítja el,
 * a tool-os kérésre tool-hívást (`tool`) vagy szöveget (`text`) ad. Ha a
 * `hiba` meg van adva, a sémás kérést azzal utasítja el.
 */
function opusModell(opts: {
  tool?: string
  text?: string
  finish?: FinishReason
  hiba?: string
  modelId?: string
  latott?: Latott[]
}) {
  const latott = opts.latott ?? []
  return new MockLanguageModelV4({
    modelId: opts.modelId ?? 'opus-proba',
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async (options) => {
      const sema = options.responseFormat?.type === 'json'
      latott.push({
        sema,
        toolChoice: options.toolChoice?.type,
        tools: (options.tools ?? []).map((t) => t.name),
      })
      if (sema) {
        throw new APICallError({
          message: opts.hiba ?? OPUS_400,
          url: 'http://localhost:4000/v1/chat/completions',
          requestBodyValues: {},
          statusCode: 400,
          isRetryable: false,
        })
      }
      return {
        content:
          opts.tool !== undefined
            ? [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'hivas-1',
                  toolName: 'submit_result',
                  input: opts.tool,
                },
              ]
            : [{ type: 'text' as const, text: opts.text ?? '' }],
        finishReason: {
          unified: opts.finish ?? (opts.tool !== undefined ? 'tool-calls' : 'stop'),
          raw: undefined,
        },
        usage: HASZNALAT,
        warnings: [],
      }
    },
  })
}

/** Sémát támogató fixture, ami elteszi, sémás kérés jött-e. */
function semaModell(text: string, latott: Latott[]) {
  return new MockLanguageModelV4({
    modelId: 'sonnet-proba',
    // eslint-disable-next-line @typescript-eslint/require-await
    doGenerate: async (options) => {
      latott.push({
        sema: options.responseFormat?.type === 'json',
        toolChoice: options.toolChoice?.type,
        tools: (options.tools ?? []).map((t) => t.name),
      })
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: HASZNALAT,
        warnings: [],
      }
    },
  })
}

describe('sémás hívás a kényszerített tool_choice elutasítása után', () => {
  it('tool-hívással (auto) adja a validált objektumot', async () => {
    const latott: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":0.7,"gaps":[]}', latott }),
      judge: fixModell('nem hívjuk'),
    })

    const result = await client.generateObject('draft', 'Pontozz.', SEMA)

    expect(result.value).toEqual({ score: 0.7, gaps: [] })
    expect(result.usage).toEqual({ inputTokens: 90, outputTokens: 30 })
    expect(latott).toEqual([
      { sema: true, toolChoice: 'auto', tools: [] },
      { sema: false, toolChoice: 'auto', tools: ['submit_result'] },
    ])
  })

  it('ugyanarra a modellre a következő hívás egyből a tool-úton megy', async () => {
    const latott: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":0.7,"gaps":[]}', latott }),
      judge: fixModell('nem hívjuk'),
    })

    await client.generateObject('draft', 'Első.', SEMA)
    await client.generateObject('draft', 'Második.', SEMA)

    expect(latott.map((l) => l.sema)).toEqual([true, false, false])
  })

  it('a közös emlékezet a kliensek között is él, és modellenként egyszer jelez', async () => {
    const jelzett: string[] = []
    const fallback = toolChoiceFallback((model) => jelzett.push(model))
    const latott2: Latott[] = []
    const elso = modelClientFrom(
      { draft: opusModell({ tool: '{"score":1,"gaps":[]}' }), judge: fixModell('nem hívjuk') },
      { fallback },
    )
    const masodik = modelClientFrom(
      {
        draft: opusModell({ tool: '{"score":1,"gaps":[]}', latott: latott2 }),
        judge: fixModell('nem hívjuk'),
      },
      { fallback },
    )

    await elso.generateObject('draft', 'p', SEMA)
    await masodik.generateObject('draft', 'p', SEMA)

    expect(latott2.map((l) => l.sema)).toEqual([false])
    expect(jelzett).toEqual(['opus-proba'])
  })

  it('más modellre a mai sémás út megy', async () => {
    const latottBiro: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":1,"gaps":[]}' }),
      judge: semaModell('{"score":0.9,"gaps":[]}', latottBiro),
    })

    await client.generateObject('draft', 'p', SEMA)
    const biro = await client.generateObject('judge', 'p', SEMA)

    expect(biro.value).toEqual({ score: 0.9, gaps: [] })
    expect(latottBiro.map((l) => l.sema)).toEqual([true])
  })

  it('kerítéses szöveges JSON-t is elfogad', async () => {
    const client = modelClientFrom({
      draft: opusModell({ text: '```json\n{"score":0.4,"gaps":["x"]}\n```' }),
      judge: fixModell('nem hívjuk'),
    })

    expect((await client.generateObject('draft', 'p', SEMA)).value).toEqual({
      score: 0.4,
      gaps: ['x'],
    })
  })

  it('séma-sértő tool-argumentumra séma-hibát ad, nem új hibautat', async () => {
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":"magas","gaps":[]}' }),
      judge: fixModell('nem hívjuk'),
    })
    const recept = structuredOutput(SEMA, (v) => String(v.score))

    await expect(recept.generate(client, 'draft', 'p')).rejects.toThrow(
      /nem a sémának megfelelő kimenetet adott.*score/s,
    )
  })

  it('se tool-hívás, se JSON: séma-hiba', async () => {
    const client = modelClientFrom({
      draft: opusModell({ text: 'Sajnos ezt nem tudom.' }),
      judge: fixModell('nem hívjuk'),
    })
    const recept = structuredOutput(SEMA, (v) => String(v.score))

    await expect(recept.generate(client, 'draft', 'p')).rejects.toThrow(
      /nem a sémának megfelelő kimenetet adott.*nincs értelmezhető JSON/s,
    )
  })

  it('más szövegű 400-ra nincs második kérés, a hiba továbbmegy', async () => {
    const latott: Latott[] = []
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":1,"gaps":[]}', hiba: 'context length exceeded', latott }),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generateObject('draft', 'p', SEMA)).rejects.toThrow(/context length/)
    expect(latott).toHaveLength(1)
  })

  it('a tool-úton is elzárja a csonka választ', async () => {
    const client = modelClientFrom({
      draft: opusModell({ tool: '{"score":1,"gaps":[]}', finish: 'length' }),
      judge: fixModell('nem hívjuk'),
    })

    await expect(client.generateObject('draft', 'p', SEMA)).rejects.toThrow(/csonka/)
  })

  it('retry mellett is pontosan két kérés megy ki', async () => {
    const latott: Latott[] = []
    const client = retrying(
      modelClientFrom({
        draft: opusModell({ tool: '{"score":1,"gaps":[]}', latott }),
        judge: fixModell('nem hívjuk'),
      }),
      { attempts: 3, sleep: () => Promise.resolve() },
    )

    await client.generateObject('draft', 'p', SEMA)

    expect(latott).toHaveLength(2)
  })

  it('a bíró a visszaesés után is pontoz', async () => {
    const client = modelClientFrom({
      draft: fixModell('nem hívjuk'),
      judge: opusModell({ tool: '{"score":0.6,"gaps":["B hiányzik"]}' }),
    })
    const criterion = judgeCriterion({ name: 'proba', instruction: 'Grade it.' })

    const score = await criterion.score({ transcript: 'A and B.', output: '- A\n' }, client)

    expect(score.value).toBe(0.6)
    expect(score.gaps).toEqual(['B hiányzik'])
  })
})

/** Sorban adja a megadott válaszokat, és elteszi a kimenő törzseket. */
function sorosFetch(valaszok: { status: number; body: unknown }[]): {
  torzsek: Record<string, unknown>[]
  fetch: typeof globalThis.fetch
} {
  const torzsek: Record<string, unknown>[] = []
  let i = 0
  const fetch: typeof globalThis.fetch = (_input, init) => {
    torzsek.push(JSON.parse(init?.body as string) as Record<string, unknown>)
    const valasz = valaszok[i++]!
    return Promise.resolve(
      new Response(JSON.stringify(valasz.body), {
        status: valasz.status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { torzsek, fetch }
}

describe('createModelClient — visszaesés a valódi kérésformán', () => {
  it('a 400 után a második kérés tool-t visz auto tool_choice-szal, response_format nélkül', async () => {
    const { torzsek, fetch } = sorosFetch([
      { status: 400, body: { error: { message: OPUS_400, type: null, param: null, code: '400' } } },
      {
        status: 200,
        body: {
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1,
          model: 'draft-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'submit_result', arguments: '{"score":0.5,"gaps":[]}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        },
      },
    ])
    const client = createModelClient(CFG, { fetch })

    const result = await client.generateObject('draft', 'p', SEMA)

    expect(result.value).toEqual({ score: 0.5, gaps: [] })
    expect(torzsek).toHaveLength(2)
    expect(torzsek[0]!.response_format).toMatchObject({ type: 'json_schema' })
    expect(torzsek[1]!.tool_choice).toBe('auto')
    expect(torzsek[1]!.response_format).toBeUndefined()
    const tools = torzsek[1]!.tools as { function: { name: string } }[]
    expect(tools.map((t) => t.function.name)).toEqual(['submit_result'])
  })
})
```

A meglévő teszt hívása (`createModelClient(CFG, elkapo.fetch)`) így változik:

```ts
    const client = createModelClient(CFG, { fetch: elkapo.fetch })
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `pnpm vitest run src/model/client.test.ts`
Expected: FAIL — a visszaesési tesztek 400-zal buknak (`does not support forced tool_choice`), a `modelClientFrom` második paramétere típushiba.

- [ ] **Step 3: A megvalósítás**

`src/model/client.ts` — az importok:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  NoObjectGeneratedError,
  Output,
  generateText,
  tool,
  type FinishReason,
  type LanguageModel,
} from 'ai'
import type { ZodType } from 'zod'
import type { ModelConfig } from '../config.js'
import { MODEL_ROLES, type ModelRole } from '../types.js'
import {
  extractObject,
  isForcedToolChoiceRejection,
  toolChoiceFallback,
  type ToolChoiceFallback,
} from './tool-fallback.js'
```

Az `ellenorizdAVeget` függvény után, a `modelClientFrom` helyére:

```ts
/**
 * A tool-úton a séma ezen a néven megy ki. A modell látja, ezért beszédes; a
 * válaszból csak ezt az egy tool-hívást fogadjuk el.
 */
const RESULT_TOOL = 'submit_result'

/** A modell neve a visszaesési emlékezet kulcsához. */
function modelNameOf(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId
}

export interface ModelClientOptions {
  /**
   * A kényszerített `tool_choice`-t elutasító modellek emlékezete. A CLI egy
   * futásra egyet ad, és minden receptkliens ugyanazt kapja; hiányában a
   * kliens sajátot tart.
   */
  fallback?: ToolChoiceFallback
}

/** Szerep→modell leképezésből épít klienst. Ez a tesztelhető mag. */
export function modelClientFrom(
  models: Record<ModelRole, LanguageModel>,
  opts: ModelClientOptions = {},
): ModelClient {
  const fallback = opts.fallback ?? toolChoiceFallback()

  /**
   * Sémás hívás **választható** tool-hívással (`tool_choice: auto`), a
   * kényszerített helyett — a `claude-opus-5-5` csak ezt fogadja el (#78).
   * Mivel a modell dönthet úgy is, hogy szöveget ad, az eredmény a
   * tool-argumentum vagy a szöveges JSON; mindkettő a sémán megy át. A
   * kudarc `AI_NoObjectGeneratedError`: a `structured.ts` ugyanúgy
   * csomagolja, mint a sémás út hibáját, tehát nincs új hibaút.
   */
  async function viaTool<T>(
    role: ModelRole,
    prompt: string,
    schema: ZodType<T>,
  ): Promise<ModelResult<T>> {
    const result = await generateText({
      model: models[role],
      prompt,
      tools: {
        [RESULT_TOOL]: tool({
          description: 'Submit the result. Call this tool exactly once with the complete result.',
          inputSchema: schema,
        }),
      },
      toolChoice: 'auto',
    })
    // A `tool-calls` itt a rendes vég; a csonkolást ugyanúgy elzárjuk.
    ellenorizdAVeget(role, result.finishReason)
    const call = result.toolCalls.find((c) => c.toolName === RESULT_TOOL)
    const extracted = extractObject(schema, call?.input, result.text)
    if (!extracted.ok) {
      throw new NoObjectGeneratedError({
        message: 'No object generated: the response did not match the schema.',
        cause: new Error(extracted.reason),
        text: call === undefined ? result.text : JSON.stringify(call.input),
        response: result.response,
        usage: result.usage,
        finishReason: result.finishReason,
      })
    }
    return { value: extracted.value, usage: usageOf(result.usage) }
  }

  return {
    async generate(role, prompt) {
      const { text, usage, finishReason } = await generateText({
        model: models[role],
        prompt,
      })
      ellenorizdAVeget(role, finishReason)
      return { value: text, usage: usageOf(usage) }
    },

    async generateObject(role, prompt, schema) {
      const name = modelNameOf(models[role])
      if (fallback.has(name)) return viaTool(role, prompt, schema)

      // Csak ez az egy elutasítás vált utat; minden más hiba a mai módon megy
      // tovább. A 400 nem átmeneti, tehát sem az SDK, sem a `retry.ts` nem
      // próbálja újra — a visszaesés ezért itt, a kliensen belül történik.
      const result = await generateText({
        model: models[role],
        prompt,
        output: Output.object({ schema }),
      }).catch((error: unknown) => {
        if (!isForcedToolChoiceRejection(error)) throw error
        return null
      })
      if (result === null) {
        fallback.add(name)
        return viaTool(role, prompt, schema)
      }
      // A vég ellenőrzése megelőzi az `output` kiolvasását: az egy getter,
      // ami csonka válasznál a homályos „nincs kimenet" hibával száll el.
      // Így a naplóba a tényleges ok kerül, nem a következménye.
      ellenorizdAVeget(role, result.finishReason)
      return { value: result.output, usage: usageOf(result.usage) }
    },
  }
}
```

A `createModelClient` aláírása és a `fetch` átadása:

```ts
export interface CreateModelClientOptions extends ModelClientOptions {
  /**
   * Kizárólag a teszt adja meg: így a kimenő kérés törzse valódi hálózat
   * nélkül ellenőrizhető.
   */
  fetch?: typeof globalThis.fetch
}

/**
 * A valódi kliens: egyetlen OpenAI-kompatibilis provider a LiteLLM
 * alap-URL-jére. Az útválasztás, a tartalék-útvonal és a terheléselosztás a
 * gateway dolga, nem az alkalmazásé (`architecture.md` §13).
 */
export function createModelClient(
  cfg: ModelConfig,
  opts: CreateModelClientOptions = {},
): ModelClient {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    // E nélkül a séma **nem hagyja el a gépet**: az SDK alapértelmezése
    // hamis (`@ai-sdk/openai-compatible@3.0.43`, `dist/index.js:447`), és
    // akkor `{ type: "json_object" }` megy ki a `json_schema` helyett
    // (`:569`). A pilótán ettől lett a `flashcards` 0/5.
    supportsStructuredOutputs: true,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  })

  const models = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, provider(cfg.models[role])]),
  ) as Record<ModelRole, LanguageModel>

  return modelClientFrom(models, { fallback: opts.fallback })
}
```

Az `evals/` scriptjei a `createModelClient(modelConfig)` egyparaméteres alakot használják — ez változatlanul működik.

- [ ] **Step 4: Futtasd, hogy átmenjen**

Run: `pnpm vitest run src/model/client.test.ts src/model/tool-fallback.test.ts src/recipe/structured.test.ts src/rubric/judge.test.ts`
Expected: PASS.

Ha a `tool({ inputSchema: schema })` generikus `ZodType<T>`-vel típushibát ad, a megoldás `inputSchema: zodSchema(schema)` (`import { zodSchema } from 'ai'`) — a viselkedés ugyanaz.

- [ ] **Step 5: Ellenőrzés és commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: zöld.

Commit (javaslat): `feat(model): Fall back to auto tool_choice on rejection` — `Refs #78`.

---

### Task 3: Config — `model.recipes` és árazás modellnév szerint

**Files:**
- Modify: `src/config.ts:234–310` (`ModelSchema`, `ModelConfig`, `loadModelConfig`)
- Modify: `refinery.config.example.yaml` (a `model:` és a `pricing:` blokk)
- Test: `src/config.test.ts` (`describe('loadModelConfig')`)
- Modify (fixture-ök): `src/cli.test.ts` (`rawConfig`, `MODEL_CONFIG`), `src/e2e.test.ts` (két `pricing`), `src/model/budget.test.ts`, `src/model/client.test.ts` (`CFG`), `src/pipeline.test.ts` (`MODELL_CFG`), `src/run/plan.test.ts` (`CFG`), `evals/measure/metered.test.ts` (`CFG`)

**Interfaces:**
- Produces: a `ModelConfig` két új, kötelező mezője:
  - `recipeModels: Readonly<Record<string, string>>` — receptazonosító → modell.
  - `modelPricing: Readonly<Record<string, ModelPricing>>` — modellnév → ár.
  - A `models` és a `pricing` (szerep → érték) **megmarad**, a `draft`/`judge` modell árával töltve.

- [ ] **Step 1: A bukó tesztek**

`src/config.test.ts` — a `describe('loadModelConfig')` `RAW`-ja:

```ts
  const RAW = {
    ...MIN,
    model: { base_url: 'http://localhost:4000/v1', draft: 'd', judge: 'j' },
    pricing: {
      d: { input_per_million: 3, output_per_million: 15 },
      j: { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: 5,
  }
```

Új tesztek ugyanebben a `describe`-ban:

```ts
  it('a szerep ára a modellnév szerinti árból jön', () => {
    const cfg = loadModelConfig(RAW, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')
    expect(cfg.pricing.draft).toEqual({ inputPerMillion: 3, outputPerMillion: 15 })
    expect(cfg.pricing.judge).toEqual({ inputPerMillion: 0.2, outputPerMillion: 0.5 })
    expect(cfg.modelPricing.j).toEqual({ inputPerMillion: 0.2, outputPerMillion: 0.5 })
  })

  it('a model.recipes alapértelmezése üres', () => {
    expect(loadModelConfig(RAW, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml').recipeModels).toEqual({})
  })

  it('a receptenkénti felülbírálást beolvassa', () => {
    const raw = {
      ...RAW,
      model: { ...RAW.model, recipes: { notes: 'sonnet-proba' } },
      pricing: { ...RAW.pricing, 'sonnet-proba': { input_per_million: 3, output_per_million: 15 } },
    }
    const cfg = loadModelConfig(raw, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')
    expect(cfg.recipeModels).toEqual({ notes: 'sonnet-proba' })
  })

  it('árazott, de nem használt modellt megenged', () => {
    const raw = {
      ...RAW,
      pricing: { ...RAW.pricing, tartalek: { input_per_million: 1, output_per_million: 1 } },
    }
    expect(() => loadModelConfig(raw, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')).not.toThrow()
  })

  it('hiányzó árnál megnevezi a modellt', () => {
    const raw = { ...RAW, model: { ...RAW.model, recipes: { notes: 'sonnet-proba' } } }
    expect(() => loadModelConfig(raw, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')).toThrow(
      /pricing: nincs ára.*sonnet-proba/,
    )
  })

  it('a régi, szerep szerinti pricing-alakot átírási útmutatóval utasítja el', () => {
    const raw = {
      ...RAW,
      pricing: {
        draft: { input_per_million: 3, output_per_million: 15 },
        judge: { input_per_million: 0.2, output_per_million: 0.5 },
      },
    }
    let uzenet = ''
    try {
      loadModelConfig(raw, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')
    } catch (error) {
      uzenet = (error as Error).message
    }
    expect(uzenet).toMatch(/régi, szerep szerinti alak/)
    expect(uzenet).toContain('d: { input_per_million:')
    expect(uzenet).toContain('j: { input_per_million:')
    expect(uzenet).toContain('/p/c.yaml')
  })

  it('a loadConfig a régi pricing-alakot nem nézi', () => {
    const raw = {
      ...MIN,
      pricing: { draft: { input_per_million: 3, output_per_million: 15 } },
    }
    expect(() => loadConfig(raw, '/p/c.yaml')).not.toThrow()
  })
```

(A `loadConfig` import a fájl tetején már megvan — ellenőrizd; ha nincs, vedd fel.)

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `pnpm vitest run src/config.test.ts`
Expected: FAIL — `pricing.draft: Invalid input` (a régi séma a `d`/`j` kulcsot nem ismeri), az új mezők `undefined`-ok.

- [ ] **Step 3: A megvalósítás**

`src/config.ts` — a `ModelSchema`:

```ts
const ModelSchema = z.object({
  model: z.object({
    base_url: z.url('A model.base_url érvényes URL kell legyen.'),
    draft: z.string().min(1, 'A model.draft kötelező.'),
    judge: z.string().min(1, 'A model.judge kötelező.'),
    /** Hamisra állítva a bíró pontozói nem futnak; a determinisztikus kapuk igen. */
    judge_enabled: z.boolean().default(true),
    /**
     * Receptazonosító → modell: a `draft` felülbírálása az adott receptnél.
     * A kulcsokat a futás regisztere ellenőrzi (`assertRecipeModels`), hogy
     * a konfig ne függjön a receptektől.
     */
    recipes: z
      .record(z.string().min(1), z.string().min(1, 'A model.recipes értéke modellnév kell legyen.'))
      .default({}),
  }),
  /** Modellnév → ár. Minden használt modellnek kell ára legyen. */
  pricing: z.record(z.string().min(1), PriceSchema),
  cost_limit_usd: z.coerce
    .number()
    .positive('Kötelező és pozitív: köteg nem indul felső korlát nélkül.'),
})
```

A `ModelConfig`:

```ts
export interface ModelConfig {
  baseUrl: string
  apiKey: string
  /** Szerep → modell; a `draft` a receptek alapértelmezése. */
  models: Record<ModelRole, string>
  /** Receptazonosító → modell; a `draft` felülbírálása az adott receptnél. */
  recipeModels: Readonly<Record<string, string>>
  /** Fusson-e a bíró. A `--no-judge` kapcsoló felülírja. */
  judgeEnabled: boolean
  /** Szerep → ár: a `models` két modelljének ára, a `modelPricing`-ből. */
  pricing: Record<ModelRole, ModelPricing>
  /** Modellnév → ár. */
  modelPricing: Readonly<Record<string, ModelPricing>>
  /** Futásonkénti felső korlát dollárban. */
  costLimitUsd: number
}
```

A `loadModelConfig` törzse az `apiKey`-ellenőrzés után:

```ts
  const c = parsed.data
  const used = [c.model.draft, c.model.judge, ...Object.values(c.model.recipes)]

  // A régi, szerep szerinti alak (v1.5.x-ig): a `draft`/`judge` kulcs nem
  // modellnév. Előbb ezt nézzük, hogy a hiányzó-ár hiba helyett az átírási
  // útmutató jöjjön.
  const legacy = ['draft', 'judge'].filter(
    (key) => Object.hasOwn(c.pricing, key) && !used.includes(key),
  )
  if (legacy.length > 0) {
    throw new Error(
      [
        `pricing: a(z) ${legacy.join(', ')} kulcs a régi, szerep szerinti alak. Az ár mostantól modellnév szerint áll, például:`,
        '  pricing:',
        `    ${c.model.draft}: { input_per_million: …, output_per_million: … }`,
        `    ${c.model.judge}: { input_per_million: …, output_per_million: … }`,
        `(${configPath})`,
      ].join('\n'),
    )
  }

  const missing = [...new Set(used)].filter((model) => !Object.hasOwn(c.pricing, model))
  if (missing.length > 0) {
    throw new Error(
      `pricing: nincs ára a következő modellnek: ${missing.join(', ')}. Minden használt modellnek (model.draft, model.judge, model.recipes) kell ár. (${configPath})`,
    )
  }

  const modelPricing: Record<string, ModelPricing> = Object.fromEntries(
    Object.entries(c.pricing).map(([model, price]) => [
      model,
      { inputPerMillion: price.input_per_million, outputPerMillion: price.output_per_million },
    ]),
  )
  // A fenti ellenőrzés után mindkettőnek van ára.
  const priceOf = (model: string): ModelPricing => modelPricing[model]!

  return {
    baseUrl: c.model.base_url,
    apiKey,
    models: { draft: c.model.draft, judge: c.model.judge },
    recipeModels: c.model.recipes,
    judgeEnabled: c.model.judge_enabled,
    pricing: { draft: priceOf(c.model.draft), judge: priceOf(c.model.judge) },
    modelPricing,
    costLimitUsd: c.cost_limit_usd,
  }
```

- [ ] **Step 4: A fixture-ök átírása**

Nyers config (`pricing` modellnév szerint):

- `src/cli.test.ts` `rawConfig`:

```ts
  pricing: {
    'proba-draft': { input_per_million: 3, output_per_million: 15 },
    'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
  },
```

- `src/e2e.test.ts` — mindkét `pricing` (a `scan --queue, pipálás` tesztben és a `rawConfig`-ban) ugyanígy, `'proba-draft'` / `'proba-judge'` kulccsal.

Típusos `ModelConfig`-literálok — mindegyik kiegészül (a `models` után, illetve a `pricing` után):

- `src/model/budget.test.ts` `CFG`, `src/model/client.test.ts` `CFG`, `src/pipeline.test.ts` `MODELL_CFG`, `src/run/plan.test.ts` `CFG`, `evals/measure/metered.test.ts` `CFG`:

```ts
  recipeModels: {},
  modelPricing: {},
```

- `src/cli.test.ts` `MODEL_CONFIG` (a `check-pricing` ezt valóban használja a Task 5-ben):

```ts
    recipeModels: {},
    modelPricing: {
      'claude-sonnet-5': { inputPerMillion: 2, outputPerMillion: 10 },
      'grok-4-fast-reasoning': { inputPerMillion: 1.25, outputPerMillion: 2.5 },
    },
```

- [ ] **Step 5: Példa-config**

`refinery.config.example.yaml` — a `model:` blokk végére (a `judge_enabled` megjegyzés után):

```yaml
  # Receptenkénti modell (opcionális): a `draft` felülbírálása egy-egy
  # receptnél. A kulcs pontos receptazonosító; a fordítás (pl. notes-hu)
  # külön kulcs, nem örököl a forrásrecepttől. A bíró mindig a `judge`.
  # recipes:
  #   notes: claude-sonnet-5
```

A `pricing:` blokk és a fölötte álló megjegyzés helyére:

```yaml
# USD egymillió tokenre, **modellnév szerint**, be- és kimenetre. Minden
# használt modellnek (model.draft, model.judge, model.recipes) kell ár; a
# fölösleges sor nem baj. Azért konfigurációból és nem beégetett
# ártáblázatból, mert az avul: ellenőrizd a `refinery check-pricing`
# paranccsal, valahányszor a modellek változnak (ellenőrizve: 2026-09-11).
pricing:
  claude-sonnet-5: { input_per_million: 2.00, output_per_million: 10.00 }
  grok-4-fast-reasoning: { input_per_million: 1.25, output_per_million: 2.50 }
```

- [ ] **Step 6: Futtasd, hogy átmenjen**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: zöld. (A `check-pricing` tesztjei még a szerep szerinti kimenetet várják — a Task 5 írja át őket; most változatlanul zöldek, mert a `commandCheckPricing` még a `models`/`pricing` mezőkből dolgozik.)

- [ ] **Step 7: Commit**

Commit (javaslat): `feat(config): Key pricing by model, add model.recipes` — `Refs #79`.

---

### Task 4: Receptre szabott nézet és becslés

**Files:**
- Create: `src/model/recipe-model.ts`
- Test: `src/model/recipe-model.test.ts`
- Modify: `src/model/budget.ts` (`EstimateShape`, `estimateItemUsd`)
- Modify: `src/run/plan.ts` (`estimateUnits`)
- Test: `src/model/budget.test.ts`, `src/run/plan.test.ts`

**Interfaces:**
- Consumes (Task 3): `ModelConfig.recipeModels`, `ModelConfig.modelPricing`.
- Produces:
  - `modelConfigFor(cfg: ModelConfig, recipeId: string): ModelConfig`
  - `usedModels(cfg: ModelConfig): string[]`
  - `assertRecipeModels(cfg: ModelConfig, known: readonly string[]): void`
  - `EstimateShape.draftPricing?: ModelPricing`

- [ ] **Step 1: A bukó tesztek**

`src/model/recipe-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelConfig } from '../config.js'
import { assertRecipeModels, modelConfigFor, usedModels } from './recipe-model.js'

const SONNET = { inputPerMillion: 3, outputPerMillion: 15 }

const CFG: ModelConfig = {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: 'sk-proba',
  models: { draft: 'draft-modell', judge: 'judge-modell' },
  recipeModels: { notes: 'sonnet-proba', qa: 'draft-modell' },
  judgeEnabled: true,
  pricing: {
    draft: { inputPerMillion: 4, outputPerMillion: 20 },
    judge: { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  },
  modelPricing: {
    'draft-modell': { inputPerMillion: 4, outputPerMillion: 20 },
    'judge-modell': { inputPerMillion: 0.2, outputPerMillion: 0.5 },
    'sonnet-proba': SONNET,
  },
  costLimitUsd: 5,
}

describe('modelConfigFor', () => {
  it('a felülbírált recept a saját modelljét és árát kapja, a bíró marad', () => {
    const view = modelConfigFor(CFG, 'notes')
    expect(view.models).toEqual({ draft: 'sonnet-proba', judge: 'judge-modell' })
    expect(view.pricing.draft).toEqual(SONNET)
    expect(view.pricing.judge).toEqual(CFG.pricing.judge)
  })

  it('felülbírálás nélkül az alapértelmezést adja', () => {
    expect(modelConfigFor(CFG, 'summary')).toBe(CFG)
  })

  it('a fordítás nem örököl a forrásrecepttől', () => {
    expect(modelConfigFor(CFG, 'notes-hu').models.draft).toBe('draft-modell')
  })
})

describe('usedModels', () => {
  it('a használt modelleket ismétlés nélkül, a draft-tal kezdve adja', () => {
    expect(usedModels(CFG)).toEqual(['draft-modell', 'judge-modell', 'sonnet-proba'])
  })
})

describe('assertRecipeModels', () => {
  it('ismert kulcsokra nem szól', () => {
    expect(() => assertRecipeModels(CFG, ['summary', 'notes', 'qa'])).not.toThrow()
  })

  it('ismeretlen kulcsra felsorolja az ismerteket', () => {
    expect(() => assertRecipeModels(CFG, ['summary', 'notes'])).toThrow(
      'model.recipes: ismeretlen recept: qa. Ismert receptek: summary, notes.',
    )
  })
})
```

`src/model/budget.test.ts` — új teszt az `estimateItemUsd` `describe`-ban:

```ts
  it('a becslés alakjában adott draft-árat használja a szerep ára helyett', () => {
    const draga = { inputPerMillion: 300, outputPerMillion: 1500 }
    const alap = estimateItemUsd(10_000, 0, CFG)
    const felulbiralt = estimateItemUsd(10_000, 0, CFG, { draftPricing: draga })
    const nezet = { ...CFG, pricing: { ...CFG.pricing, draft: draga } }

    expect(felulbiralt).toBeGreaterThan(alap)
    expect(felulbiralt).toBeCloseTo(estimateItemUsd(10_000, 0, nezet), 10)
  })
```

`src/run/plan.test.ts` — a `shape`-et `toEqual`-lal ellenőrző két teszt (`csak a recepttel bíró egységet becsüli…` és `a fordítás bemenete az átirat…`) várt `shape`-je kiegészül: `draftPricing: CFG.pricing.draft`. Ha a `kimeneti arány nélküli forrásnál…` teszt is `shape`-et vár `toEqual`-lal, ugyanígy. Új teszt az `estimateUnits` `describe`-ban:

```ts
  it('a felülbírált recept a saját modellje árán becsül', async () => {
    const summary = getRecipe('summary')
    const draga = { inputPerMillion: 300, outputPerMillion: 1500 }
    const cfg: ModelConfig = {
      ...CFG,
      recipeModels: { summary: 'draga-modell' },
      modelPricing: { 'draga-modell': draga },
    }
    const units: WorkUnit[] = [{ item: elem(), recipe: summary }]

    const { slice } = await estimateUnits(units, cfg)

    const words = (await normalizeItem(elem())).wordsNormalized
    const nezet = { ...CFG, pricing: { ...CFG.pricing, draft: draga } }
    expect(slice.usd).toBeCloseTo(
      estimateItemUsd(words, summary.maxIterations, nezet, {
        outputRatio: summary.outputRatio,
        judges: summary.rubric.criteria.filter((c) => !c.blocking).length,
      }),
      10,
    )
  })
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `pnpm vitest run src/model/recipe-model.test.ts src/model/budget.test.ts src/run/plan.test.ts`
Expected: FAIL — a `recipe-model.js` nem létezik; a `draftPricing` nem hat; a `shape` nem tartalmazza a `draftPricing`-et.

- [ ] **Step 3: A megvalósítás**

`src/model/recipe-model.ts`:

```ts
import type { ModelConfig } from '../config.js'

/**
 * Receptre szabott nézet: a `draft` modell és ára a `model.recipes`
 * felülbírálása, ha van, a bíró a configé. A szerep szerint számoló kód
 * (költségőr, könyvelés, becslés) így változatlan logikával a ténylegesen
 * használt modell árát látja (#79). A fordítás saját azonosítóval szerepel
 * (`notes-hu`), nem örököl a forrásrecepttől.
 */
export function modelConfigFor(cfg: ModelConfig, recipeId: string): ModelConfig {
  const model = cfg.recipeModels[recipeId]
  if (model === undefined) return cfg
  const price = cfg.modelPricing[model]
  // A betöltő ezt kizárja; ha mégis ide jutunk, ne könyveljünk rossz áron.
  if (price === undefined) {
    throw new Error(`pricing: nincs ára a(z) ${model} modellnek (model.recipes.${recipeId}).`)
  }
  return {
    ...cfg,
    models: { ...cfg.models, draft: model },
    pricing: { ...cfg.pricing, draft: price },
  }
}

/** A configban ténylegesen használt modellek, ismétlés nélkül, a `draft`-tal kezdve. */
export function usedModels(cfg: ModelConfig): string[] {
  return [...new Set([cfg.models.draft, cfg.models.judge, ...Object.values(cfg.recipeModels)])]
}

/**
 * A `model.recipes` kulcsainak ellenőrzése a futás regiszterén (alapreceptek
 * és a konfigban kért fordítások). Itt, nem a konfig betöltésekor: így a
 * konfig nem függ a receptektől (`recipesFor` ugyanezt teszi).
 */
export function assertRecipeModels(cfg: ModelConfig, known: readonly string[]): void {
  const unknown = Object.keys(cfg.recipeModels).filter((id) => !known.includes(id))
  if (unknown.length === 0) return
  throw new Error(
    `model.recipes: ismeretlen recept: ${unknown.join(', ')}. Ismert receptek: ${known.join(', ')}.`,
  )
}
```

`src/model/budget.ts` — az import és az `EstimateShape`:

```ts
import type { ModelConfig, ModelPricing } from '../config.js'
```

```ts
export interface EstimateShape {
  outputRatio?: number
  judges?: number
  /** A recept generáló modelljének ára (`model.recipes`); hiánya a `draft` ára. */
  draftPricing?: ModelPricing
}
```

(Ha a `ModelConfig` import már `import type { ModelConfig } from '../config.js'` alakban van, azt bővítsd.)

Az `estimateItemUsd`-ben a `draft` költség ára:

```ts
  const draft = costOf(
    {
      inputTokens: transcriptTokens * generations,
      outputTokens: outputTokens * generations,
    },
    shape.draftPricing ?? cfg.pricing.draft,
  )
```

`src/run/plan.ts` — import:

```ts
import { modelConfigFor } from '../model/recipe-model.js'
```

Az `estimateUnits` `shape`-je:

```ts
      shape: {
        outputRatio: unit.recipe.outputRatio,
        // A bírók számát a rubrikából vesszük, nem külön mezőből: így egy
        // recept nem tud hazudni a saját költségéről.
        judges: unit.recipe.rubric.criteria.filter((c) => !c.blocking).length,
        // A receptenkénti modell ára (`model.recipes`); a bíró ára közös.
        draftPricing: modelConfigFor(cfg, unit.recipe.id).pricing.draft,
      },
```

A `cli.ts:767` (`estimateItemUsd(first.words, …, model.modelConfig, first.shape)`) a `first.shape`-ből már a helyes árat kapja — nem kell hozzányúlni.

- [ ] **Step 4: Futtasd, hogy átmenjen**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: zöld.

- [ ] **Step 5: Commit**

Commit (javaslat): `feat(model): Add per-recipe model config view` — `Refs #79`.

---

### Task 5: `check-pricing` modellenként

**Files:**
- Modify: `src/model/pricing-check.ts` (`PricingMismatch`, `PricingCheckResult`, `comparePricing`, `applyPricingFix`; a `ModelRole` import törlése)
- Modify: `src/cli.ts:325–360` (`commandCheckPricing`)
- Test: `src/model/pricing-check.test.ts`, `src/cli.test.ts` (`describe('commandCheckPricing')`)

**Interfaces:**
- Consumes (Task 4): `usedModels(cfg)`.
- Produces:
  - `interface PricingMismatch { model: string; configured: ModelPricing; live: LivePricing }`
  - `interface PricingCheckResult { mismatches: PricingMismatch[]; unknown: string[] }`
  - `comparePricing(models: readonly string[], pricing: Readonly<Record<string, ModelPricing>>, live: Map<string, LivePricing>): PricingCheckResult`
  - `applyPricingFix(configText: string, mismatches: readonly PricingMismatch[]): string` — a `pricing.<modellnév>` csomópontot írja.

- [ ] **Step 1: A bukó tesztek**

`src/model/pricing-check.test.ts` — a fejléc:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPricingFix,
  comparePricing,
  fetchLivePricing,
  type LivePricing,
} from './pricing-check.js'
import type { ModelPricing } from '../config.js'

const MODELS = ['claude-sonnet-5', 'grok-4-fast-reasoning']

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': { inputPerMillion: 2, outputPerMillion: 10 },
  'grok-4-fast-reasoning': { inputPerMillion: 1.25, outputPerMillion: 2.5 },
}
```

A `comparePricing` tesztjeiben a várt értékek:

- `eltérést jelez, ha a bemeneti ár elcsúszott`:

```ts
    expect(result.mismatches).toEqual([
      {
        model: 'claude-sonnet-5',
        configured: PRICING['claude-sonnet-5'],
        live: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    ])
```

- `ismeretlenként jelzi…`: `expect(result.unknown).toEqual(['claude-sonnet-5'])`

Új teszt a `comparePricing`-ben:

```ts
  it('a receptes felülbírálás modelljét is ellenőrzi', () => {
    const live = new Map<string, LivePricing>([
      ['claude-sonnet-5', { inputPerMillion: 2, outputPerMillion: 10 }],
      ['grok-4-fast-reasoning', { inputPerMillion: 1.25, outputPerMillion: 2.5 }],
      ['claude-opus-5-5', { inputPerMillion: 5, outputPerMillion: 25 }],
    ])
    const pricing = { ...PRICING, 'claude-opus-5-5': { inputPerMillion: 4, outputPerMillion: 20 } }

    const result = comparePricing([...MODELS, 'claude-opus-5-5'], pricing, live)

    expect(result.mismatches.map((m) => m.model)).toEqual(['claude-opus-5-5'])
  })
```

Az `applyPricingFix` tesztjei:

```ts
describe('applyPricingFix', () => {
  const TEXT = [
    '# Ár-megjegyzés, amelynek meg kell maradnia.',
    'pricing:',
    '  claude-sonnet-5: { input_per_million: 2.00, output_per_million: 10.00 }',
    '  grok-4-fast-reasoning: { input_per_million: 1.25, output_per_million: 2.50 }',
    '',
  ].join('\n')

  it('csak az eltérő modell árát írja át, a megjegyzést és a flow-alakot megtartva', () => {
    const fixed = applyPricingFix(TEXT, [
      {
        model: 'claude-sonnet-5',
        configured: PRICING['claude-sonnet-5']!,
        live: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    ])

    expect(fixed).toContain('# Ár-megjegyzés, amelynek meg kell maradnia.')
    expect(fixed).toContain('claude-sonnet-5: { input_per_million: 3, output_per_million: 15 }')
    expect(fixed).toContain(
      'grok-4-fast-reasoning: { input_per_million: 1.25, output_per_million: 2.50 }',
    )
  })

  it('két tizedesre kerekít, mert az élő ár tokenárból visszaszorzott', () => {
    const fixed = applyPricingFix(TEXT, [
      {
        model: 'grok-4-fast-reasoning',
        configured: PRICING['grok-4-fast-reasoning']!,
        live: { inputPerMillion: 2.4999999999999996, outputPerMillion: 12.345 },
      },
    ])

    expect(fixed).toContain(
      'grok-4-fast-reasoning: { input_per_million: 2.5, output_per_million: 12.35 }',
    )
  })

  it('pontot és dupla kötőjelet tartalmazó modellnevet is talál', () => {
    const text = [
      'pricing:',
      '  sub2api--grok-4.7: { input_per_million: 2.00, output_per_million: 10.00 }',
      '',
    ].join('\n')

    const fixed = applyPricingFix(text, [
      {
        model: 'sub2api--grok-4.7',
        configured: { inputPerMillion: 2, outputPerMillion: 10 },
        live: { inputPerMillion: 3, outputPerMillion: 12 },
      },
    ])

    expect(fixed).toContain('sub2api--grok-4.7: { input_per_million: 3, output_per_million: 12 }')
  })
})
```

`src/cli.test.ts` `describe('commandCheckPricing')`:

- `1-gyel tér vissza, és jelzi az eltérést…`: `toContain('ELTÉR claude-sonnet-5')`
- `--fix-nél visszaírja…`: a YAML-szöveg

```ts
        'pricing:',
        '  claude-sonnet-5: { input_per_million: 2.00, output_per_million: 10.00 }',
        '  grok-4-fast-reasoning: { input_per_million: 1.25, output_per_million: 2.50 }',
```

és a várt sor: `toContain('claude-sonnet-5: { input_per_million: 3, output_per_million: 15 }')`.

Új teszt ugyanitt:

```ts
  it('a receptes felülbírálás modelljét is ellenőrzi', async () => {
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    stubLiteLLM([
      { model_name: 'claude-sonnet-5', input: 0.000002, output: 0.00001 },
      { model_name: 'grok-4-fast-reasoning', input: 0.00000125, output: 0.0000025 },
      { model_name: 'claude-opus-5-5', input: 0.000005, output: 0.000025 },
    ])
    const cfg = {
      ...MODEL_CONFIG,
      recipeModels: { notes: 'claude-opus-5-5' },
      modelPricing: {
        ...MODEL_CONFIG.modelPricing,
        'claude-opus-5-5': { inputPerMillion: 4, outputPerMillion: 20 },
      },
    }

    expect(await commandCheckPricing(cfg)).toBe(1)
    expect(naplo.mock.calls.flat().join('\n')).toContain('ELTÉR claude-opus-5-5')
    naplo.mockRestore()
  })
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `pnpm vitest run src/model/pricing-check.test.ts src/cli.test.ts -t "Pricing|pricing"`
Expected: FAIL — a `comparePricing` még szerepeket vár, a kimenet `ELTÉR draft`.

- [ ] **Step 3: A megvalósítás**

`src/model/pricing-check.ts` — törlendő: `import type { ModelRole } from '../types.js'`. A típusok és a két függvény:

```ts
export interface PricingMismatch {
  model: string
  configured: ModelPricing
  live: LivePricing
}

export interface PricingCheckResult {
  mismatches: PricingMismatch[]
  /** A configban szereplő modell, amit a LiteLLM nem ismer — nem ellenőrizhető. */
  unknown: string[]
}
```

```ts
/**
 * Modellenként hasonlítja a configban rögzített árat az élő LiteLLM-árhoz. A
 * `models` a ténylegesen használt modellek listája (`usedModels`), egyszer
 * mindegyik — a receptes felülbírálás modellje is.
 */
export function comparePricing(
  models: readonly string[],
  pricing: Readonly<Record<string, ModelPricing>>,
  live: Map<string, LivePricing>,
): PricingCheckResult {
  const mismatches: PricingMismatch[] = []
  const unknown: string[] = []
  for (const model of models) {
    const liveRate = live.get(model)
    if (!liveRate) {
      unknown.push(model)
      continue
    }
    // A betöltő minden használt modellhez árat követel; ár nélkül nincs mit hasonlítani.
    const configured = pricing[model]
    if (configured === undefined) continue
    const inputOff = Math.abs(configured.inputPerMillion - liveRate.inputPerMillion) > TOLERANCE_USD
    const outputOff =
      Math.abs(configured.outputPerMillion - liveRate.outputPerMillion) > TOLERANCE_USD
    if (inputOff || outputOff) {
      mismatches.push({ model, configured, live: liveRate })
    }
  }
  return { mismatches, unknown }
}
```

Az `applyPricingFix`-ben egyetlen sor változik:

```ts
    const node = doc.getIn(['pricing', mismatch.model])
```

`src/cli.ts` — import:

```ts
import { usedModels } from './model/recipe-model.js'
```

A `commandCheckPricing` összevetése és kiírása:

```ts
  const { mismatches, unknown } = comparePricing(
    usedModels(modelConfig),
    modelConfig.modelPricing,
    live,
  )
  for (const model of unknown) {
    console.log(`? ${model}: a LiteLLM nem ismeri ezt a modellt — nem ellenőrizhető.`)
  }
  for (const m of mismatches) {
    console.log(
      `ELTÉR ${m.model}: config $${m.configured.inputPerMillion.toFixed(2)}/$${m.configured.outputPerMillion.toFixed(2)} (be/ki, milliónként) — LiteLLM $${m.live.inputPerMillion.toFixed(2)}/$${m.live.outputPerMillion.toFixed(2)}`,
    )
  }
```

és a javítás visszajelzése:

```ts
    console.log(
      `Javítva a configban: ${mismatches.map((m) => m.model).join(', ')} — ${opts.configPath}`,
    )
```

- [ ] **Step 4: Futtasd, hogy átmenjen**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: zöld.

- [ ] **Step 5: Commit**

Commit (javaslat): `feat(pricing): Check prices per model, not per role` — `Refs #79`.

---

### Task 6: CLI-bekötés — receptenkénti kliens, kulcsellenőrzés, visszaesési esemény

**Files:**
- Modify: `src/events.ts` (új `RunEvent`-ág)
- Modify: `src/cli.ts` (`render`, `RunRuntime.createClient`, `ModelRuntime`, `commandRun` modellbeállítás és `depsFor`, a `printing` utáni sor)
- Test: `src/cli.test.ts` (új `describe`)

**Interfaces:**
- Consumes: `ModelClientOptions` (Task 2), `toolChoiceFallback` (Task 1), `modelConfigFor`, `assertRecipeModels` (Task 4).
- Produces:
  - `RunEvent` új ága: `{ type: 'model:fallback'; model: string }`
  - `RunRuntime.createClient?: (cfg: ModelConfig, opts?: ModelClientOptions) => ModelClient`

- [ ] **Step 1: A bukó tesztek**

`src/cli.test.ts` — import a fájl tetejére:

```ts
import type { ZodType } from 'zod'
```

Új `describe` a `commandRun — a hibás elem a naplóban és a riportban` blokk után:

```ts
describe('commandRun — receptenkénti modell és visszaesés', () => {
  /** A futásnapló eseményei. */
  async function esemenyek(logsDir: string): Promise<RunEvent[]> {
    const jsonl = (await readdir(logsDir)).find((f) => f.endsWith('.jsonl'))!
    return (await readFile(join(logsDir, jsonl), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as RunEvent)
  }

  /** A `summary` a `proba-sonnet` modellen fut, feltűnően eltérő áron. */
  const rawFelulbiralt = () => {
    const raw = rawWithVault(5)
    return {
      ...raw,
      model: { ...raw.model, recipes: { summary: 'proba-sonnet' } },
      pricing: {
        ...raw.pricing,
        'proba-sonnet': { input_per_million: 70, output_per_million: 700 },
      },
    }
  }

  it('a felülbírált recept kliense a felülbírált modellt kapja, és az ő árán könyvel', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawFelulbiralt()
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    const modellek: string[] = []

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      {
        createClient: (view) => {
          modellek.push(view.models.draft)
          return hamisKliens({ generate: 0 })
        },
      },
    )

    expect(code).toBe(0)
    expect(modellek).toEqual(['proba-sonnet'])
    const refined = (await esemenyek(cfg.logsDir)).find((e) => e.type === 'item:refined')
    if (refined?.type !== 'item:refined') throw new Error('nincs item:refined esemény')
    // Generálás a felülbírált áron (70/700), pontozás a bíró áron (0,2/0,5).
    const vart = refined.rounds.reduce(
      (sum, r) =>
        sum +
        (r.generateTokens.input * 70 + r.generateTokens.output * 700) / 1_000_000 +
        (r.scoreTokens.input * 0.2 + r.scoreTokens.output * 0.5) / 1_000_000,
      0,
    )
    expect(refined.usd).toBeCloseTo(vart, 10)
  })

  it('ismeretlen receptkulcsra a futás előtt beszédes hibával áll meg', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const alap = rawWithVault(5)
    const raw = { ...alap, model: { ...alap.model, recipes: { nots: 'proba-draft' } } }
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
    let hivott = false

    await expect(
      commandRun(
        cfg,
        raw,
        { recipe: 'summary', dryRun: false, force: false, commit: false },
        {
          createClient: () => {
            hivott = true
            return hamisKliens({ generate: 0 })
          },
        },
      ),
    ).rejects.toThrow(/model\.recipes: ismeretlen recept: nots/)
    expect(hivott).toBe(false)
  })

  it('a visszaesést modellenként egyszer írja a naplóba', async () => {
    await makeVideo(downloads, 'a1', 'Első videó', 'Csatorna A')
    const raw = rawWithVault(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')

    const code = await commandRun(
      cfg,
      raw,
      { recipe: 'summary', dryRun: false, force: false, commit: false },
      {
        createClient: (_view, opts) => {
          const kliens = hamisKliens({ generate: 0 })
          return {
            ...kliens,
            generateObject: <T>(role: ModelRole, prompt: string, schema: ZodType<T>) => {
              // Ahogy a valódi kliens: minden bíróhívásnál rögzít, a jelzés egyszeri.
              opts?.fallback?.add('proba-judge')
              return kliens.generateObject(role, prompt, schema)
            },
          }
        },
      },
    )

    expect(code).toBe(0)
    const fallbacks = (await esemenyek(cfg.logsDir)).filter((e) => e.type === 'model:fallback')
    // A napló minden sorhoz `at` időbélyeget is ír, ezért `toMatchObject`.
    expect(fallbacks).toHaveLength(1)
    expect(fallbacks[0]).toMatchObject({ type: 'model:fallback', model: 'proba-judge' })
  })
})
```

- [ ] **Step 2: Futtasd, hogy bukjon**

Run: `pnpm vitest run src/cli.test.ts -t "receptenkénti modell"`
Expected: FAIL — a kliens a `proba-draft`-ot kapja; az ismeretlen kulcsra nincs hiba; a `createClient` nem kap `opts`-ot; a `model:fallback` típus nem létezik (típushiba).

- [ ] **Step 3: A megvalósítás**

`src/events.ts` — a `RunEvent` uniójának végére (az `item:retry` ág után):

```ts
  | {
      type: 'model:fallback'
      /**
       * A modell, amely elutasította a kényszerített `tool_choice`-t; a sémás
       * hívásai mostantól választható tool-hívással mennek (#78). Modellenként
       * egyszer jön.
       */
      model: string
    }
```

`src/cli.ts` — importok:

```ts
import { createModelClient, type ModelClient, type ModelClientOptions } from './model/client.js'
import { assertRecipeModels, modelConfigFor, usedModels } from './model/recipe-model.js'
import { toolChoiceFallback } from './model/tool-fallback.js'
```

(A `usedModels` importja a Task 5-ben már bekerült — vond össze egy sorba.)

A `render` `switch`-ébe, az `item:retry` ág után:

```ts
    case 'model:fallback':
      return `  ! ${event.model}: a kényszerített tool_choice nem támogatott, tool-hívással (auto) folytatom`
```

A `RunRuntime.createClient`:

```ts
  /** A modellkliens gyártása; alapértelmezésben a valódi LiteLLM-kliens. */
  createClient?: (cfg: ModelConfig, opts?: ModelClientOptions) => ModelClient
```

A `ModelRuntime`:

```ts
/** A modellréteg egy futásra: receptenkénti kliens, egy közös költségőr. */
interface ModelRuntime {
  modelConfig: ModelConfig
  /** A receptre szabott nézet kliense; modellenként egyszer készül. */
  clientFor(view: ModelConfig): ModelClient
  guard: CostGuard
}
```

A `commandRun` modellbeállítása (a mai `// Egy kliens és egy költségőr…` megjegyzéstől a `depsFor` végéig) így alakul:

```ts
  // Egy költségőr az egész indításra: a plafon így nem receptenként, hanem
  // együtt vonatkozik minden egységre. A kliens a receptre szabott nézetből
  // készül (`model.recipes`), modellenként egyszer, és a visszaesés
  // emlékezete (`tool-fallback.ts`) mindegyiknek közös.
  let model: ModelRuntime | undefined
  // A jelzés célja a lenti `printing`; addig modellhívás nem történik, tehát
  // nincs mit elveszíteni.
  let reportFallback: (name: string) => void = () => undefined
  if (recipe || queueMode) {
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    assertRecipeModels(modelConfig, Object.keys(registry))
    const fallback = toolChoiceFallback((name) => reportFallback(name))
    const createClient = runtime.createClient ?? createModelClient
    const clients = new Map<string, ModelClient>()
    model = {
      modelConfig,
      clientFor(view) {
        let client = clients.get(view.models.draft)
        if (client === undefined) {
          client = createClient(view, { fallback })
          clients.set(view.models.draft, client)
        }
        return client
      },
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
  }
  // A CLI elsőbbsége: a megadott kapcsoló felülírja a configot, hiányában a
  // config dönt. A `--no-judge` csak kikapcsolni tud — visszakapcsolni nem
  // kell, mert a config alapértelmezése amúgy is a bekapcsolt bíró.
  const skipJudge = flags.noJudge ?? !(model?.modelConfig.judgeEnabled ?? true)

  const depsFor = (unitRecipe: Recipe | null): RecipeDeps | undefined => {
    if (!unitRecipe || !model) return undefined
    const view = modelConfigFor(model.modelConfig, unitRecipe.id)
    return {
      recipe: unitRecipe,
      client: model.clientFor(view),
      modelConfig: view,
      guard: model.guard,
      skipJudge,
    }
  }
```

Közvetlenül a `const printing = (e: RunEvent) => { … }` definíciója után (a `printing({ type: 'run:started', … })` sor elé):

```ts
  reportFallback = (name) => printing({ type: 'model:fallback', model: name })
```

- [ ] **Step 4: Futtasd, hogy átmenjen**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: zöld.

- [ ] **Step 5: Commit**

Commit (javaslat): `feat(cli): Wire per-recipe clients and fallback event` — `Refs #78, #79`.

---

### Task 7: README

**Files:**
- Modify: `README.md` (a `#### Árazás ellenőrzése (check-pricing)` szakasz és utána egy új szakasz)

- [ ] **Step 1:** A `check-pricing` szakasz első mondata:

```markdown
Összeveti a konfigurációban beállított árakat a LiteLLM élő díjszabásával,
**modellenként**: a `model.draft`, a `model.judge` és a `model.recipes`
minden modelljét egyszer.
```

- [ ] **Step 2:** A `check-pricing` szakasz után új szakasz:

````markdown
#### Receptenkénti modell (`model.recipes`)

Alapból minden recept a `model.draft` modellen generál. Egy-egy recept más
modellre tehető:

```yaml
model:
  draft: sub2api--claude-opus-5-5
  judge: sub2api--claude-sonnet-5
  recipes:
    notes: sub2api--claude-sonnet-5

pricing:
  sub2api--claude-opus-5-5: { input_per_million: 4, output_per_million: 20 }
  sub2api--claude-sonnet-5: { input_per_million: 3, output_per_million: 15 }
```

- A kulcs pontos receptazonosító; a fordítás külön kulcs (`notes-hu`), nem
  örököl a forrásrecepttől.
- A pontozás mindig a `model.judge`.
- A `pricing` modellnév szerint áll; minden használt modellnek kell ár, és a
  költség (becslés, plafon, riport) a ténylegesen használt modell árán
  számolódik.

Ha egy modell nem fogadja el a kényszerített tool-hívást (pl.
`claude-opus-5-5` a LiteLLM-en át), a sémás receptek és a bíró magától
választható tool-hívásra váltanak; a futás ezt modellenként egyszer jelzi
(`! <modell>: a kényszerített tool_choice nem támogatott…`).
````

- [ ] **Step 3:** Ellenőrzés: `pnpm lint` (a Markdownt nem lintelik, de a fájl ne törjön). Commit (javaslat): `docs(readme): Document per-recipe models and pricing` — `Refs #79`.

---

### Task 8: Záró ellenőrzés, valódi próba, PR

- [ ] **Step 1: Teljes ellenőrzés**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: zöld, a tesztszám a kiindulónál nagyobb.

- [ ] **Step 2: Záró review** — a teljes ágra (`git diff main...HEAD`) a `superpowers:requesting-code-review` szerint, a spec sikerkritériumaival szemben. A talált hibát javítsd és commitold.

- [ ] **Step 3: Próba-config (valódi költés előtt, jóváhagyás nélkül is biztonságos)**

A helyi `refinery.config.yaml`-hoz **nem nyúlunk** (az átállás a merge után jön). Másolat a repó gyökerében, hogy a relatív útvonalak (állapottár, napló) ugyanoda mutassanak:

```bash
cp refinery.config.yaml refinery.config.probe.yaml
```

A másolatban:
- `model.draft: sub2api--claude-opus-5-5`, `model.judge: sub2api--claude-opus-5-5`
- `pricing:` modellnév szerint a `sub2api--claude-opus-5-5`, `sub2api--claude-sonnet-5` és a configban maradó többi használt modell sorával
- `cost_limit_usd: 2.00`

Utána: `node dist/cli.js check-pricing --config refinery.config.probe.yaml --fix` → a próba-config árai a LiteLLM élő áraira állnak.

- [ ] **Step 4: Valódi próba A — Opus-vázlat és Opus-bíró a `notes`-on (JÓVÁHAGYÁS KELL)**

A felhasználó jóváhagyása után (becsült költés: ~0,3–1 $, plafon 2 $):

```bash
node dist/cli.js run --config refinery.config.probe.yaml --recipe notes --retry-failed --no-commit
```

Siker: a `7d8a94e02918c454` `_notes.md`-je elkészül a vaultban; a terminálon (és a `.jsonl`-ben) **egyszer** megjelenik a `! sub2api--claude-opus-5-5: a kényszerített tool_choice nem támogatott…` sor; az `item:scored` események pontszámot mutatnak (a bíró lefutott); `item:failed` nincs.

- [ ] **Step 5: Valódi próba B — receptes felülbírálás (JÓVÁHAGYÁS KELL)**

A próba-configba: `model.recipes: { flashcards: sub2api--claude-sonnet-5 }`. A felhasználó jóváhagyása után:

```bash
node dist/cli.js run --config refinery.config.probe.yaml --recipe flashcards --retry-failed --no-commit
```

Siker: a `.jsonl` `item:refined` eseményeinek `usd`-je a `rounds` tokenjeiből a **Sonnet** árával (generálás) és az Opus árával (pontozás) számolva egyezik; a kimenő modell a Sonnet (a LiteLLM `/key/info` spend-növekménye nagyságrendileg stimmel).

- [ ] **Step 6: Takarítás** — `rm refinery.config.probe.yaml`. A próbák eredménye (költés, pontszámok, a visszaesési sor) a PR leírásába kerül.

- [ ] **Step 7: Push és PR**

```bash
git push -u origin feat/sema-fallback-receptmodell
```

PR a `main` felé, címe: `feat: Sémás visszaesés kényszerített tool_choice nélkül, receptenkénti modell`, törzsében a változások, az ellenőrzés (tesztszám, a két valódi próba számai), az átállási teendő (a helyi config `pricing`-je modellnév szerint), és `Closes #78, #79`. Utána `gh pr checks` (a CI zöld kell legyen); a merge a felhasználó döntése.

## A tervben rögzített eltérések a spectől

- **A `model.recipes` kulcsait a futás regisztere ellenőrzi** (`assertRecipeModels`, `Object.keys(registry)`), nem a config betöltője. Így egy fordítás kulcsa (`notes-hu`) csak akkor érvényes, ha a `translate.recipes` tényleg kéri — pontosabb a spec „`<recept>-<nyelv>`" mintájánál, és követi a meglévő szabályt (a konfig nem függ a receptektől).
- **A visszaesési esemény neve** `model:fallback` (a spec a pontos típust a tervre hagyta).
