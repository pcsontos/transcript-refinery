import type { ModelPricing } from '../config.js'
import type { ModelUsage } from './client.js'

/**
 * Szó→token szorzó a becsléshez. Angol prózára nagyjából 1,3–1,4 token esik
 * egy szóra. Ez **becslés és nem mérés**: a tényleges elszámolás mindig a
 * modell válaszában visszaküldött `usage`-ből megy, ez a szám csak a futás
 * előtti kapuhoz kell.
 */
export const TOKENS_PER_WORD = 1.35

/** Token-felhasználás → dollár. */
export function costOf(usage: ModelUsage, pricing: ModelPricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  )
}
