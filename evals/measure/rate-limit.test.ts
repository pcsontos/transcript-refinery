import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../../src/model/client.js'
import { rateLimited } from './rate-limit.js'

/** Kliens, ami csak számol: a hívások száma és az idejük érdekel. */
function szamlaloKliens(hivasok: number[], ora: () => number): ModelClient {
  return {
    generate: () => {
      hivasok.push(ora())
      return Promise.resolve({ value: 'x', usage: { inputTokens: 1, outputTokens: 1 } })
    },
    generateObject: <T>() => {
      hivasok.push(ora())
      return Promise.resolve({ value: {} as T, usage: { inputTokens: 1, outputTokens: 1 } })
    },
  }
}

/** Vezérelhető óra: a `sleep` előre tekeri, valódi várakozás nélkül. */
function hamisIdo() {
  let t = 0
  return {
    now: (): number => t,
    sleep: (ms: number): Promise<void> => {
      t += ms
      return Promise.resolve()
    },
    alvasok: [] as number[],
  }
}

describe('rateLimited', () => {
  it('a korlátig nem várakoztat', async () => {
    const ido = hamisIdo()
    const hivasok: number[] = []
    const client = rateLimited(szamlaloKliens(hivasok, ido.now), {
      perMinute: 3,
      now: ido.now,
      sleep: ido.sleep,
    })

    await client.generate('draft', 'a')
    await client.generate('draft', 'b')
    await client.generate('draft', 'c')

    // Mind a három azonnal ment: az óra nem mozdult.
    expect(hivasok).toEqual([0, 0, 0])
  })

  it('a korlát fölött megvárja, amíg a legrégebbi kérés kiöregszik', async () => {
    const ido = hamisIdo()
    const hivasok: number[] = []
    const client = rateLimited(szamlaloKliens(hivasok, ido.now), {
      perMinute: 2,
      now: ido.now,
      sleep: ido.sleep,
    })

    await client.generate('draft', 'a')
    await client.generate('draft', 'b')
    await client.generate('draft', 'c')

    // A harmadik csak a teljes ablak letelte után indulhatott.
    expect(hivasok).toEqual([0, 0, 60_000])
  })

  it('a sémás hívás ugyanazt a kaput használja', async () => {
    const ido = hamisIdo()
    const hivasok: number[] = []
    const client = rateLimited(szamlaloKliens(hivasok, ido.now), {
      perMinute: 1,
      now: ido.now,
      sleep: ido.sleep,
    })

    await client.generate('draft', 'a')
    await client.generateObject('judge', 'b', {} as never)

    // Ha a két út külön számlálna, a második is nullakor indult volna.
    expect(hivasok).toEqual([0, 60_000])
  })

  it('értelmetlen korlátnál beszédes hibát dob, nem fagy le', () => {
    const ido = hamisIdo()
    const kliens = szamlaloKliens([], ido.now)
    // Nulla korlátnál a kapu sosem engedne át semmit: a ciklus örökre pörögne.
    expect(() => rateLimited(kliens, { perMinute: 0 })).toThrow(/legalább 1/i)
    expect(() => rateLimited(kliens, { perMinute: -5 })).toThrow(/legalább 1/i)
  })

  it('a kiöregedett kérések felszabadítják a helyet', async () => {
    const ido = hamisIdo()
    const hivasok: number[] = []
    const client = rateLimited(szamlaloKliens(hivasok, ido.now), {
      perMinute: 2,
      now: ido.now,
      sleep: ido.sleep,
    })

    await client.generate('draft', 'a')
    await client.generate('draft', 'b')
    // Az ablak letelik magától, külső okból.
    await ido.sleep(60_000)
    await client.generate('draft', 'c')
    await client.generate('draft', 'd')

    // A harmadik és a negyedik is várakozás nélkül fért be.
    expect(hivasok).toEqual([0, 0, 60_000, 60_000])
  })
})
