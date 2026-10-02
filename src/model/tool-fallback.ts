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
