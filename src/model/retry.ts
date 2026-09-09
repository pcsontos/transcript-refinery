import type { ModelClient } from './client.js'

/** Ennyi kísérlet fér bele egy hívásba, az elsőt is beleszámítva. */
export const DEFAULT_ATTEMPTS = 3

/** Az első várakozás; minden további a duplája. */
export const BASE_DELAY_MS = 1000

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
])

const TRANSIENT_NAMES = new Set(['AbortError', 'TimeoutError'])

/** Csak tiszta számjegysorozat — se üres, se előjeles/tizedes, se tudományos alak. */
const NUMERIC_STATUS = /^\d+$/

/**
 * Számmá alakítja a státuszkódot, ha az szám vagy szigorúan számjegyekből
 * álló string — néhány SDK és proxy stringként küldi (`statusCode: '429'`).
 * Az üres/csak szóközből álló string, a tudományos jelölés (`'4e2'`) és
 * minden más nem-számjegy string `undefined`-ot ad, hogy a hívó a maradék
 * jeleket (kód, név, ok) is megvizsgálhassa, ahelyett hogy egy nem-státusz
 * stringet félreértelmezve véglegesnek (vagy — az üres stringnél — tévesen
 * 0-s, tehát szintén véglegesnek) minősítené a hibát.
 */
function toStatus(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return NUMERIC_STATUS.test(trimmed) ? Number(trimmed) : undefined
  }
  return undefined
}

/**
 * Átmeneti-e a hiba, tehát van-e értelme újrapróbálni.
 *
 * A besorolás szándékosan szigorú: a 4xx (a 408 és a 429 kivételével), a
 * séma- és validációs hibák véglegesek. Egy végleges hiba újrapróbálása
 * háromszor fizetteti ki ugyanazt a kudarcot.
 */
export function isTransient(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {
    statusCode?: unknown
    status?: unknown
    code?: unknown
    name?: unknown
    cause?: unknown
  }

  // A közvetlen státusz — ha értelmezhető — a specifikusabb jel, ezért
  // szándékosan megelőzi az ok-lánc vizsgálatát: pl. egy 400-as hiba akkor
  // is végleges marad, ha az oka egy burkolt 503-as.
  const status = toStatus(e.statusCode) ?? toStatus(e.status)
  if (status !== undefined) return status === 408 || status === 429 || status >= 500

  if (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code)) return true
  if (typeof e.name === 'string' && TRANSIENT_NAMES.has(e.name)) return true

  return e.cause !== undefined && isTransient(e.cause)
}

export interface RetryInfo {
  /** Hányadik kísérlet bukott el; egytől számozva. */
  attempt: number
  delayMs: number
  reason: string
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  /** Tesztelhetőség: az alapértelmezés valódi várakozás. */
  sleep?: (ms: number) => Promise<void>
  onRetry?: (info: RetryInfo) => void
}

/**
 * Újrapróbálkozó dekorátor a modellkliens köré.
 *
 * A védelem a **hívás** szintjén van, nem az elemén: egy elem teljes
 * újrafuttatása másodszor is kifizettetné a már sikeres generálásokat.
 */
export function retrying(client: ModelClient, opts: RetryOptions = {}): ModelClient {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS
  const baseDelayMs = opts.baseDelayMs ?? BASE_DELAY_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call()
      } catch (error) {
        if (!isTransient(error) || attempt >= attempts) throw error
        const delayMs = baseDelayMs * 2 ** (attempt - 1)
        opts.onRetry?.({ attempt, delayMs, reason: (error as Error).message })
        await sleep(delayMs)
      }
    }
  }

  return {
    generate: (role, prompt) => withRetry(() => client.generate(role, prompt)),
    generateObject: (role, prompt, schema) =>
      withRetry(() => client.generateObject(role, prompt, schema)),
  }
}
