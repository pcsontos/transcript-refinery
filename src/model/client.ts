import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Output, generateText, type LanguageModel } from 'ai'
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

/** Szerep→modell leképezésből épít klienst. Ez a tesztelhető mag. */
export function modelClientFrom(
  models: Record<ModelRole, LanguageModel>,
): ModelClient {
  return {
    async generate(role, prompt) {
      const { text, usage } = await generateText({ model: models[role], prompt })
      return { value: text, usage: usageOf(usage) }
    },

    async generateObject(role, prompt, schema) {
      const { output, usage } = await generateText({
        model: models[role],
        prompt,
        output: Output.object({ schema }),
      })
      return { value: output, usage: usageOf(usage) }
    },
  }
}

/**
 * A valódi kliens: egyetlen OpenAI-kompatibilis provider a LiteLLM
 * alap-URL-jére. Az útválasztás, a tartalék-útvonal és a terheléselosztás a
 * gateway dolga, nem az alkalmazásé (`architecture.md` §13).
 */
export function createModelClient(cfg: ModelConfig): ModelClient {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
  })

  const models = Object.fromEntries(
    MODEL_ROLES.map((role) => [role, provider(cfg.models[role])]),
  ) as Record<ModelRole, LanguageModel>

  return modelClientFrom(models)
}
