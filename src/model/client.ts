import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, generateText, type FinishReason, type LanguageModel } from 'ai'
import type { ZodType } from 'zod'
import type { ModelConfig } from '../config.js'
import { MODEL_ROLES, type ModelRole } from '../types.js'

/** Egyetlen hívás tényleges token-felhasználása. */
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
}

export interface ModelResult<T> {
  value: T
  usage: ModelUsage
}

/**
 * A modellréteg teljes felülete. Szándékosan szűk: a mag ennél többet nem
 * tud a modellekről, tehát a LiteLLM lecserélése egyetlen fájl kérdése.
 */
export interface ModelClient {
  generate(role: ModelRole, prompt: string): Promise<ModelResult<string>>
  generateObject<T>(
    role: ModelRole,
    prompt: string,
    schema: ZodType<T>,
  ): Promise<ModelResult<T>>
}

/**
 * A használat mezői az AI SDK-ban opcionálisak, mert nem minden szolgáltató
 * küldi vissza őket. A hiányzó értéket nullának vesszük — a költségőr így a
 * legrosszabb esetben alábecsül, de sosem dob a futás közepén.
 */
function usageOf(usage: {
  inputTokens?: number
  outputTokens?: number
}): ModelUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  }
}

/**
 * Befejezési okok, amelyeknél a válasz nem teljes — okonként azzal, amit a
 * naplót olvasó ember tehet.
 *
 * Miért kell ez egyáltalán: az ilyen válasz **HTTP 200-zal**, hibaüzenet és
 * retry nélkül érkezik, tehát magától semmi nem jelzi. 2026-09-22-én a `clean`
 * így írt egy 2605 szavas átiratból 266 szót a vaultba, mondat közepén
 * elvágva, nulla hibával — a queue pipával késznek jelölte. A LiteLLM
 * `max_tokens` értékét azóta megemeltük, de az egyetlen modellt véd; ez a
 * kapu mindet, a jövőbelieket is.
 *
 * A felsorolás szándékosan tételes, nem `!== 'stop'`:
 * - a `'tool-calls'` a `judge` útvonalon legitim vég,
 * - az `'other'` a gateway gyűjtőkategóriája minden **ismeretlen** okra
 *   (`@ai-sdk/openai-compatible@3.0.43`, `dist/index.js:344`), tehát vele egy
 *   új modell hibátlan válaszát is elutasítanánk.
 */
const NEM_TELJES: Partial<Record<FinishReason, string>> = {
  length:
    'belefutott a kimeneti token-plafonba, ezért csonka. Emeld a `max_tokens` ' +
    'értékét a LiteLLM configjában, vagy darabold kisebb részekre a bemenetet.',
  'content-filter': 'a tartalomszűrő állította meg, ezért csonka.',
  error: 'a modell hibával állt le, ezért csonka.',
}

/**
 * Elzárja a nem teljes választ a hívó elől.
 *
 * Dobás, nem visszatérési érték: így egyetlen hívónak sem kell emlékeznie
 * arra, hogy ellenőrizzen — a csonkolás nem tud némán továbbmenni.
 *
 * A hiba szándékosan sima `Error`, státuszkód nélkül: a `retry.ts`
 * `isTransient()`-je ezt véglegesnek minősíti. Ez itt a helyes viselkedés,
 * mert ugyanaz a prompt ugyanúgy levágódna, az újrapróbálás pedig háromszor
 * fizettetné ki ugyanazt a kudarcot.
 */
function ellenorizdAVeget(role: ModelRole, finishReason: FinishReason): void {
  const baj = NEM_TELJES[finishReason]
  if (baj === undefined) return
  throw new Error(
    `A(z) „${role}" modell válasza nem teljes (finishReason: ${finishReason}): ${baj}`,
  )
}

/** Szerep→modell leképezésből épít klienst. Ez a tesztelhető mag. */
export function modelClientFrom(
  models: Record<ModelRole, LanguageModel>,
): ModelClient {
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
      const result = await generateText({
        model: models[role],
        prompt,
        output: Output.object({ schema }),
      })
      // A vég ellenőrzése megelőzi az `output` kiolvasását: az egy getter,
      // ami csonka válasznál a homályos „nincs kimenet" hibával száll el.
      // Így a naplóba a tényleges ok kerül, nem a következménye.
      ellenorizdAVeget(role, result.finishReason)
      return { value: result.output, usage: usageOf(result.usage) }
    },
  }
}

/**
 * A valódi kliens: egyetlen OpenAI-kompatibilis provider a LiteLLM
 * alap-URL-jére. Az útválasztás, a tartalék-útvonal és a terheléselosztás a
 * gateway dolga, nem az alkalmazásé (`architecture.md` §13).
 */
export function createModelClient(
  cfg: ModelConfig,
  fetch?: typeof globalThis.fetch,
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
    // Kizárólag a teszt adja meg: így a kimenő kérés törzse valódi hálózat
    // nélkül ellenőrizhető.
    ...(fetch ? { fetch } : {}),
  })

  const models = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, provider(cfg.models[role])]),
  ) as Record<ModelRole, LanguageModel>

  return modelClientFrom(models)
}
