import { describe, expect, it } from 'vitest'
import { stratifiedSample, type SampleCandidate } from './sample.js'

/** 100 jelölt, 100-tól 10 000 szóig egyenletesen. */
const JELOLTEK: SampleCandidate[] = Array.from({ length: 100 }, (_, i) => ({
  itemId: `elem-${String(i).padStart(3, '0')}`,
  words: 100 + i * 100,
}))

describe('stratifiedSample', () => {
  it('a kért számú elemet adja: négy réteg × öt elem', () => {
    expect(stratifiedSample(JELOLTEK, 5)).toHaveLength(20)
  })

  it('kétszer futtatva ugyanazt adja', () => {
    expect(stratifiedSample(JELOLTEK, 5)).toEqual(stratifiedSample(JELOLTEK, 5))
  })

  it('a bemenet sorrendjétől független', () => {
    const kevert = [...JELOLTEK].reverse()
    expect(stratifiedSample(kevert, 5)).toEqual(stratifiedSample(JELOLTEK, 5))
  })

  it('mind a négy hossz-negyedből választ', () => {
    const valasztott = new Set(stratifiedSample(JELOLTEK, 5))
    const hosszak = JELOLTEK.filter((c) => valasztott.has(c.itemId)).map((c) => c.words)
    // A negyedek határai a 100 elemű, egyenletes halmazon: 2500, 5000, 7500.
    expect(hosszak.filter((w) => w <= 2500).length).toBe(5)
    expect(hosszak.filter((w) => w > 2500 && w <= 5000).length).toBe(5)
    expect(hosszak.filter((w) => w > 5000 && w <= 7500).length).toBe(5)
    expect(hosszak.filter((w) => w > 7500).length).toBe(5)
  })

  it('azonos szóhossznál az azonosító dönt, tehát stabil marad', () => {
    const egyforma: SampleCandidate[] = [
      { itemId: 'c', words: 500 },
      { itemId: 'a', words: 500 },
      { itemId: 'b', words: 500 },
      { itemId: 'd', words: 500 },
    ]
    expect(stratifiedSample(egyforma, 1)).toEqual(stratifiedSample([...egyforma].reverse(), 1))
  })

  it('kevés jelöltnél hibát dob, nem ad csendben kisebb mintát', () => {
    expect(() => stratifiedSample(JELOLTEK.slice(0, 10), 5)).toThrow(/kevés jelölt/i)
  })
})

/**
 * A valós korpusz alakja: 154 elem, néggyel NEM osztható, egyenetlen
 * hosszeloszlással. A szimmetrikus, maradék nélküli fixture-ön több hiba is
 * észrevétlen marad — ez a leíró azt az utat járja, amit a mérés ténylegesen.
 */
describe('stratifiedSample — a valós korpusz alakján (154 elem, maradékkal)', () => {
  // Erősen ferde eloszlás: sok rövid elem, néhány nagyon hosszú.
  const VALOS: SampleCandidate[] = Array.from({ length: 154 }, (_, i) => ({
    itemId: `v-${String(i).padStart(3, '0')}`,
    words: Math.round(500 + 22000 * (i / 153) ** 3),
  }))
  const hosszOf = (id: string): number => VALOS.find((c) => c.itemId === id)!.words

  it('a maradékot is lefedi: a leghosszabb elemek rétege sem marad ki', () => {
    const minta = stratifiedSample(VALOS, 5)
    expect(minta).toHaveLength(20)
    // 154 / 4 = 38, maradék 2 — az utolsó rétegnek 40 elemet kell vinnie.
    // A rendezés utolsó két eleme csak akkor érhető el, ha a maradék az
    // utolsó réteghez kerül.
    const leghosszabb = Math.max(...VALOS.map((c) => c.words))
    const mintaMax = Math.max(...minta.map(hosszOf))
    // A legfelső negyed határa: a rendezett lista 115. eleme.
    const hatar = [...VALOS].sort((a, b) => a.words - b.words)[114]!.words
    expect(mintaMax).toBeGreaterThan(hatar)
    expect(mintaMax).toBeLessThanOrEqual(leghosszabb)
  })

  it('negyedenként pontosan öt elem, a ferde eloszlás ellenére', () => {
    const minta = stratifiedSample(VALOS, 5)
    const rendezett = [...VALOS].sort((a, b) => a.words - b.words || a.itemId.localeCompare(b.itemId))
    const rang = new Map(rendezett.map((c, i) => [c.itemId, i]))
    const negyedek = [0, 0, 0, 0]
    for (const id of minta) negyedek[Math.min(3, Math.floor(rang.get(id)! / 38))]!++
    expect(negyedek).toEqual([5, 5, 5, 5])
  })

  it('a rétegen belül szétszór, nem az első elemeket veszi', () => {
    const minta = stratifiedSample(VALOS, 5)
    const rendezett = [...VALOS].sort((a, b) => a.words - b.words || a.itemId.localeCompare(b.itemId))
    const rang = new Map(rendezett.map((c, i) => [c.itemId, i]))
    const elsoNegyed = minta.map((id) => rang.get(id)!).filter((r) => r < 38).sort((a, b) => a - b)
    // Ha nem szórna szét, az első réteg mintája [0,1,2,3,4] lenne.
    expect(elsoNegyed).not.toEqual([0, 1, 2, 3, 4])
    // A réteg felső felét is el kell érnie.
    expect(Math.max(...elsoNegyed)).toBeGreaterThan(19)
  })

  it('pontosan ezeket a rangokat választja — a kiválasztás lehorgonyozva', () => {
    // A determinizmus sikerkritérium: a rögzített mintát a három ismétlésnek
    // és minden későbbi futásnak azonosan kell adnia. Ez a teszt ezért a
    // kiválasztás PONTOS eredményét rögzíti, nem csak a tulajdonságait —
    // enélkül a rétegek határainak elmozdulása (a maradék kezelése, a
    // rétegméret kerekítése) észrevétlen marad.
    //
    // 154 elem / 4 réteg = 38, maradék 2; a maradékot az utolsó réteg viszi,
    // ezért annak hossza 40, és a rangjai eltérnek a többiétől.
    const rendezett = [...VALOS].sort(
      (a, b) => a.words - b.words || a.itemId.localeCompare(b.itemId),
    )
    const rang = new Map(rendezett.map((c, i) => [c.itemId, i]))
    const rangok = stratifiedSample(VALOS, 5).map((id) => rang.get(id)!)

    expect(rangok).toEqual([
      3, 11, 19, 26, 34, 41, 49, 57, 64, 72, 79, 87, 95, 102, 110, 118, 126, 134, 142, 150,
    ])
  })

  it('növekvő hossz szerint rendez: a minta első eleme a legrövidebb negyedből jön', () => {
    const minta = stratifiedSample(VALOS, 5)
    const mediánHossz = [...VALOS].sort((a, b) => a.words - b.words)[77]!.words
    // A minta első öt eleme a legrövidebb negyed — mind a medián alatt.
    for (const id of minta.slice(0, 5)) {
      expect(hosszOf(id)).toBeLessThan(mediánHossz)
    }
  })
})
