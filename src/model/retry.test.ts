import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ModelClient } from './client.js'
import { isTransient, retrying } from './retry.js'

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${String(status)}`), { statusCode: status })
}

describe('isTransient', () => {
  it('a 429 és az 5xx átmeneti', () => {
    expect(isTransient(httpError(429))).toBe(true)
    expect(isTransient(httpError(500))).toBe(true)
    expect(isTransient(httpError(503))).toBe(true)
    expect(isTransient(httpError(408))).toBe(true)
  })

  it('a 400 és a 401 végleges', () => {
    expect(isTransient(httpError(400))).toBe(false)
    expect(isTransient(httpError(401))).toBe(false)
  })

  it('a hálózati hibakódok átmenetiek', () => {
    expect(isTransient(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isTransient(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('a megszakított kérés átmeneti', () => {
    const error = new Error('megszakadt')
    error.name = 'AbortError'
    expect(isTransient(error)).toBe(true)
  })

  it('az ok-láncban lévő átmeneti hibát is felismeri', () => {
    expect(isTransient(new Error('burkolt', { cause: httpError(503) }))).toBe(true)
  })

  it('a stringként érkező státuszkódot is felismeri (egyes SDK-k és proxyk így küldik)', () => {
    expect(isTransient(Object.assign(new Error('HTTP 429'), { statusCode: '429' }))).toBe(true)
    expect(isTransient(Object.assign(new Error('HTTP 400'), { statusCode: '400' }))).toBe(false)
  })

  it('a nem szám alakú string státuszkódot nem olvassa státusznak, a lánc többi része érvényesül', () => {
    expect(
      isTransient(Object.assign(new Error('proba'), { statusCode: 'nope', cause: httpError(503) })),
    ).toBe(true)
  })

  it('az üres vagy csak szóközből álló string státuszkód sem olvasandó nullás státuszként', () => {
    expect(
      isTransient(Object.assign(new Error('proba'), { statusCode: '', code: 'ECONNRESET' })),
    ).toBe(true)
    expect(
      isTransient(Object.assign(new Error('proba'), { statusCode: '  ', code: 'ECONNRESET' })),
    ).toBe(true)
  })

  it('a tudományos jelölésű string (pl. "4e2") nem olvasandó státuszként', () => {
    expect(
      isTransient(Object.assign(new Error('proba'), { statusCode: '4e2', code: 'ECONNRESET' })),
    ).toBe(true)
  })

  it('a közvetlen státuszkód szándékosan nyer a burkolt átmeneti ok felett', () => {
    // A közvetlen hiba státusza a specifikusabb jel: egy 400-as hiba akkor
    // is végleges marad, ha az oka egy burkolt 503-as.
    expect(
      isTransient(Object.assign(new Error('proba'), { statusCode: 400, cause: httpError(503) })),
    ).toBe(false)
  })

  it('a séma- és egyéb hibák véglegesek', () => {
    expect(isTransient(new Error('a válasz nem felel meg a sémának'))).toBe(false)
    expect(isTransient('nem is hiba')).toBe(false)
    expect(isTransient(null)).toBe(false)
  })
})

function fakeClient(behaviour: (call: number) => string): {
  client: ModelClient
  calls: () => number
} {
  let calls = 0
  const client: ModelClient = {
    // A `ModelClient` szerződése async; ez a próba-kliens szinkron dob vagy
    // ad vissza, tehát nincs mire várnia.
    // eslint-disable-next-line @typescript-eslint/require-await
    async generate() {
      calls++
      return { value: behaviour(calls), usage: { inputTokens: 1, outputTokens: 1 } }
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async generateObject() {
      calls++
      return { value: JSON.parse(behaviour(calls)) as never, usage: { inputTokens: 1, outputTokens: 1 } }
    },
  }
  return { client, calls: () => calls }
}

describe('retrying', () => {
  it('két 429 után a harmadik hívás sikerét adja vissza', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call < 3) throw httpError(429)
      return 'kész'
    })
    const sleep = vi.fn(async () => {})
    const result = await retrying(client, { sleep }).generate('draft', 'prompt')

    expect(result.value).toBe('kész')
    expect(calls()).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('exponenciálisan növeli a várakozást', async () => {
    const { client } = fakeClient((call) => {
      if (call < 3) throw httpError(500)
      return 'kész'
    })
    const delays: number[] = []
    // eslint-disable-next-line @typescript-eslint/require-await -- a `sleep` aláírása async, ez a próba nem vár semmire.
    await retrying(client, { sleep: async (ms) => void delays.push(ms) }).generate('draft', 'p')

    expect(delays).toEqual([1000, 2000])
  })

  it('a kísérletek számát nem lépi túl', async () => {
    const { client, calls } = fakeClient(() => {
      throw httpError(503)
    })
    await expect(
      retrying(client, { sleep: async () => {} }).generate('draft', 'p'),
    ).rejects.toThrow('HTTP 503')
    expect(calls()).toBe(3)
  })

  it('végleges hibára nem próbálkozik újra', async () => {
    const { client, calls } = fakeClient(() => {
      throw httpError(400)
    })
    await expect(
      retrying(client, { sleep: async () => {} }).generate('draft', 'p'),
    ).rejects.toThrow('HTTP 400')
    expect(calls()).toBe(1)
  })

  it('minden újrapróbálkozásról értesít', async () => {
    const { client } = fakeClient((call) => {
      if (call < 2) throw httpError(429)
      return 'kész'
    })
    const onRetry = vi.fn()
    await retrying(client, { sleep: async () => {}, onRetry }).generate('draft', 'p')

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1, delayMs: 1000 })
  })

  it('a strukturált hívást ugyanúgy védi', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call < 2) throw httpError(429)
      return '{"ok":true}'
    })
    const result = await retrying(client, { sleep: async () => {} }).generateObject(
      'judge',
      'p',
      z.object({ ok: z.boolean() }),
    )

    expect(result.value).toEqual({ ok: true })
    expect(calls()).toBe(2)
  })
})
