import type { ZodType } from 'zod'
import type { StructuredOutput } from './types.js'

/**
 * Az AI SDK séma-eredetű hibáinak nevei. **Csak ezeket** csomagoljuk be: egy
 * hálózati hibát „séma-hibaként" jelenteni félrevezetné a riportot, és a
 * hibakeresést rossz irányba küldené.
 */
const SCHEMA_ERRORS = new Set([
  'AI_TypeValidationError',
  'AI_NoObjectGeneratedError',
  'AI_JSONParseError',
])

/**
 * Tipizált építő a sémás kimenethez: a `T` a záráson belül marad, kifelé a
 * `StructuredOutput` konkrét típusa látszik. Így a receptfájl végig
 * típusbiztos, a motor pedig nem lát sémát.
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
