import { describe, expect, it } from 'vitest'
import { aggregate, decide, type RunRecord } from './stats.js'

/** Három elem, három ismétléssel, körönként megadott pontszámmal. */
function rekordok(
  terv: { itemId: string; korok: number[][] }[],
): RunRecord[] {
  return terv.flatMap((elem) =>
    elem.korok.map((scores, repeat) => ({
      itemId: elem.itemId,
      repeat,
      scores,
      usdPerRound: scores.map(() => 0.02),
    })),
  )
}

describe('aggregate', () => {
  it('körönként átlagol, és az első kör javulását nullának veszi', () => {
    const agg = aggregate(
      rekordok([{ itemId: 'a', korok: [[0.5, 0.7], [0.5, 0.9]] }]),
      0.8,
    )
    expect(agg.rounds[0]!.meanScore).toBeCloseTo(0.5, 5)
    expect(agg.rounds[0]!.meanGain).toBe(0)
    expect(agg.rounds[1]!.meanScore).toBeCloseTo(0.8, 5)
    expect(agg.rounds[1]!.meanGain).toBeCloseTo(0.3, 5)
  })

  it('a zajszint az elemenkénti első köri szórások mediánja', () => {
    // 'a': 0,4/0,5/0,6 → mintaszórás 0,1. 'b': három egyforma → 0.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4], [0.5], [0.6]] },
        { itemId: 'b', korok: [[0.7], [0.7], [0.7]] },
      ]),
      0.8,
    )
    // Két elem: a medián a két szórás átlaga.
    expect(agg.noise).toBeCloseTo(0.05, 5)
  })

  it('a mentési arány nevezője csak az előző körben megbukott párok száma', () => {
    const agg = aggregate(
      rekordok([
        // Bukott elsőre, a második átvitte.
        { itemId: 'a', korok: [[0.5, 0.9]] },
        // Bukott elsőre, a második sem vitte át.
        { itemId: 'b', korok: [[0.5, 0.6]] },
        // Elsőre átment: nem szerepel a nevezőben.
        { itemId: 'c', korok: [[0.9, 0.95]] },
      ]),
      0.8,
    )
    expect(agg.rounds[1]!.rescueBase).toBe(2)
    expect(agg.rounds[1]!.rescueRate).toBeCloseTo(0.5, 5)
  })
})

describe('aggregate — üres bemenet', () => {
  it('üres nyomvonalat ad, nem `-Infinity` körszámot', () => {
    const agg = aggregate([], 0.8)
    expect(agg.rounds).toEqual([])
    expect(agg.noise).toBe(0)
  })
})

describe('decide', () => {
  it('adat nélkül hibát dob, nem hoz magabiztos döntést', () => {
    // Ha egy recept minden futása elbukik, a döntés nem lehet „kifizeti magát".
    expect(() => decide(aggregate([], 0.8))).toThrow(/nincs mérési adat/i)
  })

  it('a zaj alatti javulás és az alacsony mentési arány egy generálásra állít', () => {
    // Zaj 0,05; a második kör javulása 0,01; mentés 0/2.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.41], [0.5, 0.51], [0.6, 0.61]] },
        { itemId: 'b', korok: [[0.5, 0.51], [0.5, 0.51], [0.5, 0.51]] },
      ]),
      0.8,
    )
    expect(decide(agg).maxIterations).toBe(0)
  })

  it('a zaj fölötti javulás megtartja a második kört', () => {
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.9], [0.5, 0.95], [0.6, 0.92]] },
        { itemId: 'b', korok: [[0.5, 0.9], [0.5, 0.9], [0.5, 0.9]] },
      ]),
      0.8,
    )
    expect(decide(agg).maxIterations).not.toBe(0)
  })

  it('magas mentési arány önmagában megtartja a második kört', () => {
    // Egyetlen elem, három ismétléssel: 0,65/0,75 induló pontszám bukik, és a
    // második kör pontosan a küszöbig viszi — kis átlagos javulással, mert a
    // harmadik ismétlés már elsőre átment, és onnan csak alig javul. Az induló
    // pontszámok szórása (zajszint 0,126) nagyobb, mint az átlagos javulás
    // (0,07): a javulás a zaj ALATT van. A mentési arány mégis 100%, mert a
    // két bukott ismétlés mindegyike átjutott a küszöbön.
    //
    // Ez a teszt kifejezetten az ÉS/VAGY kapcsolatot választja szét: az „ÉS"
    // szabály szerint ez a kör megéri magát (a mentési arány menti), a
    // „VAGY" mutáns tévesen „nem éri meg"-nek ítélné, mert a javulás önmagában
    // a zaj alatt van.
    const agg = aggregate(
      rekordok([{ itemId: 'a', korok: [[0.65, 0.8], [0.75, 0.8], [0.9, 0.91]] }]),
      0.8,
    )
    expect(agg.rounds[1]!.rescueRate).toBe(1)
    expect(agg.rounds[1]!.meanGain).toBeLessThan(agg.noise)
    expect(decide(agg).maxIterations).not.toBe(0)
  })

  it('ha a második kör megéri, de a harmadik nem, két generálásra áll', () => {
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.9, 0.9], [0.5, 0.95, 0.95], [0.6, 0.92, 0.92]] },
        { itemId: 'b', korok: [[0.5, 0.9, 0.9], [0.5, 0.9, 0.9], [0.5, 0.9, 0.9]] },
      ]),
      0.8,
    )
    expect(decide(agg).maxIterations).toBe(1)
  })

  it('ha minden kör ugyanazt a pontszámot adja, a javító körök nem érnek semmit', () => {
    // A valós füstpróbán a `summary` 1,00 → 1,00 → 1,00-t adott. Ilyenkor a
    // javulás ÉS a zajszint is nulla. A szigorú `<` mellett a `0 < 0` hamis
    // lenne, és a szabály azt állítaná, hogy a körök kifizetik magukat —
    // holott egyikük sem mozdított semmit.
    const agg = aggregate(
      rekordok([{ itemId: 'a', korok: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] }]),
      0.8,
    )
    expect(agg.noise).toBe(0)
    expect(agg.rounds[1]!.meanGain).toBe(0)
    expect(decide(agg).maxIterations).toBe(0)
  })

  it('a döntés megnevezi az indokot, a három mennyiség értékével', () => {
    // Ugyanaz a beállítás, mint a „zaj alatti javulás" esetnél — itt a
    // szöveges indoklást ellenőrizzük, nem a maxIterations értékét.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.4, 0.41], [0.5, 0.51], [0.6, 0.61]] },
        { itemId: 'b', korok: [[0.5, 0.51], [0.5, 0.51], [0.5, 0.51]] },
      ]),
      0.8,
    )
    expect(decide(agg).reason).toMatch(/javul/i)
  })
})
