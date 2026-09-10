import type { ModelClient } from '../../src/model/client.js'

/** Egy perc milliszekundumban — a gateway korlátjának ablaka. */
const WINDOW_MS = 60_000

export interface RateLimitOptions {
  /** Hány kérés mehet ki egy percben. */
  perMinute: number
  /** Az óra; teszthez kicserélhető. */
  now?: () => number
  /** A várakozás; teszthez kicserélhető. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Csúszóablakos ütemező a modellkliens elé.
 *
 * A LiteLLM gateway kulcsonként korlátozza a kérések számát; a mérés
 * **ezernél több** hívást indít, tehát korlátozás nélkül a harmadik
 * újrapróbálkozás után elhasal. Az újrapróbálkozás (`src/model/retry.ts`) a
 * 429-et átmenetinek veszi, de az visszamenőleges gyógyítás: ha a korlátot
 * eleve nem lépjük túl, nem kell gyógyítani.
 *
 * A megvalósítás szándékosan a legegyszerűbb, ami helyes: eltároljuk az utolsó
 * kérések időbélyegeit, és ha az ablakban már `perMinute` darab van, megvárjuk,
 * amíg a legrégebbi kiöregszik. A mérés soros, ezért versenyhelyzet nincs.
 */
export function rateLimited(client: ModelClient, opts: RateLimitOptions): ModelClient {
  // Nulla vagy negatív korlátnál a gate sosem engedne át semmit, és a ciklus
  // örökre pörögne. Egy elgépelt kapcsoló így beszédes hibát ad, nem fagyást.
  if (!Number.isFinite(opts.perMinute) || opts.perMinute < 1) {
    throw new Error(
      `a percenkénti kéréskorlátnak legalább 1-nek kell lennie, kapott: ${String(opts.perMinute)}`,
    )
  }
  const now = opts.now ?? ((): number => Date.now())
  const sleep =
    opts.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)))
  const window: number[] = []

  const gate = async (): Promise<void> => {
    for (;;) {
      const t = now()
      while (window.length > 0 && t - window[0]! >= WINDOW_MS) window.shift()
      if (window.length < opts.perMinute) {
        window.push(t)
        return
      }
      await sleep(WINDOW_MS - (t - window[0]!))
    }
  }

  return {
    async generate(role, prompt) {
      await gate()
      return client.generate(role, prompt)
    },
    async generateObject(role, prompt, schema) {
      await gate()
      return client.generateObject(role, prompt, schema)
    },
  }
}
