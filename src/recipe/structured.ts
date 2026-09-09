import type { ZodType } from 'zod'
import type { StructuredOutput } from './types.js'

/**
 * Az AI SDK séma-eredetű hibáinak nevei. **Csak ezeket** csomagoljuk be: egy
 * hálózati hibát „séma-hibaként" jelenteni félrevezetné a riportot, és a
 * hibakeresést rossz irányba küldené.
 *
 * A `generateObject` útján (`model/client.ts`, `Output.object`) a gyakorlatban
 * mindig az `AI_NoObjectGeneratedError` érkezik, a JSON- vagy séma-részlettel a
 * `cause`-ban. A másik kettő azért marad a halmazban, mert az SDK máshol
 * önállóan is dobja őket.
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
        const { name, message, cause } = error as Error
        if (!SCHEMA_ERRORS.has(name)) throw error
        // Az SDK felső szintű üzenete általános („response did not match
        // schema"); a használható részlet — melyik mező hibás — a `cause`-ban
        // van. A riport a felső szintű üzenetet kapja, ezért ide fűzzük.
        const detail = cause instanceof Error ? `${message} ${cause.message}` : message
        throw new Error(`a modell nem a sémának megfelelő kimenetet adott: ${detail}`, {
          cause: error,
        })
      }
    },
  }
}
