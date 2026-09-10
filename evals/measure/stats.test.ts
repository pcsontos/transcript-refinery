import { describe, expect, it } from 'vitest'
import { aggregate, decide, type RunRecord } from './stats.js'

/** Elemenként megadott körönkénti pontszámok, ismétlésenként egy sor. */
function rekordok(
  terv: { itemId: string; korok: number[][] }[],
  usd = 0.02,
): RunRecord[] {
  return terv.flatMap((elem) =>
    elem.korok.map((scores, repeat) => ({
      itemId: elem.itemId,
      repeat,
      scores,
      usdPerRound: scores.map(() => usd),
    })),
  )
}

describe('aggregate — üres bemenet', () => {
  it('üres nyomvonalat ad, nem `-Infinity` körszámot', () => {
    const agg = aggregate([], 0.8)
    expect(agg.rounds).toEqual([])
    expect(agg.noise).toBe(0)
  })
})

describe('aggregate', () => {
  it('az átlagpontszám MINDEN párra számít, a javulás csak a bukottakra', () => {
    const agg = aggregate(
      rekordok([
        // Bukott elsőre (0,5 < 0,8): a javulása beleszámít.
        { itemId: 'a', korok: [[0.5, 0.7]] },
        // Elsőre átment (0,9): a javulása NEM számít bele.
        { itemId: 'b', korok: [[0.9, 1.0]] },
      ]),
      0.8,
    )
    // Átlagpontszám a 2. körben: (0,7 + 1,0) / 2 = 0,85 — mindkét pár.
    expect(agg.rounds[1]!.meanScore).toBeCloseTo(0.85, 5)
    // Javulás: csak az 'a' pár +0,2-je. Ha 'b' is beleszámítana, 0,15 lenne.
    expect(agg.rounds[1]!.meanGain).toBeCloseTo(0.2, 5)
    expect(agg.rounds[1]!.rescueBase).toBe(1)
  })

  it('az első kör javulása és standard hibája nulla', () => {
    const agg = aggregate(rekordok([{ itemId: 'a', korok: [[0.5, 0.9]] }]), 0.8)
    expect(agg.rounds[0]!.meanGain).toBe(0)
    expect(agg.rounds[0]!.gainStdErr).toBe(0)
  })

  it('a zajszint az elemenkénti első köri szórások mediánja, nem az átlaga', () => {
    // Három elem szórása: 0 / 0,01 / 0,30. Medián 0,01, átlag 0,1033.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.5], [0.5], [0.5]] },
        { itemId: 'b', korok: [[0.5], [0.51], [0.52]] },
        { itemId: 'c', korok: [[0.2], [0.5], [0.8]] },
      ]),
      0.8,
    )
    expect(agg.noise).toBeCloseTo(0.01, 5)
    expect(agg.noise).not.toBeCloseTo(0.1033, 3)
  })

  it('a mentési arány nevezője csak az előző körben megbukott párok száma', () => {
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.5, 0.9]] },
        { itemId: 'b', korok: [[0.5, 0.6]] },
        { itemId: 'c', korok: [[0.9, 0.95]] },
      ]),
      0.8,
    )
    expect(agg.rounds[1]!.rescueBase).toBe(2)
    expect(agg.rounds[1]!.rescueRate).toBeCloseTo(0.5, 5)
  })

  it('a standard hiba a javulások szórása osztva a gyökér mintaszámmal', () => {
    // Négy bukott pár, javulásaik: 0,1 / 0,2 / 0,3 / 0,4.
    // Mintaszórás = 0,1290994; n = 4; SE = 0,0645497.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.5, 0.6]] },
        { itemId: 'b', korok: [[0.5, 0.7]] },
        { itemId: 'c', korok: [[0.5, 0.8]] },
        { itemId: 'd', korok: [[0.5, 0.9]] },
      ]),
      0.8,
    )
    expect(agg.rounds[1]!.gainStdErr).toBeCloseTo(0.0645497, 6)
  })

  it('a küszöböt PONTOSAN elérő kör átmentnek számít, nem bukottnak', () => {
    // A `scoreRubric` küszöbe `>=`, tehát a 0,8 pontosan átmegy. Ha a bukás
    // feltétele `<=` lenne, ez a pár tévesen a javító kör mintájába kerülne.
    const agg = aggregate(
      rekordok([
        { itemId: 'a', korok: [[0.8, 0.9]] },
        { itemId: 'b', korok: [[0.5, 0.9]] },
      ]),
      0.8,
    )
    // Csak a 'b' bukott elsőre.
    expect(agg.rounds[1]!.rescueBase).toBe(1)
    expect(agg.rounds[1]!.meanGain).toBeCloseTo(0.4, 5)
  })

  it('egyenetlen hosszú rekordokat is kezel: a rövidebb kimarad a késői körökből', () => {
    // A nyers adat lehet egyenetlen, ha egy futás korábban ért véget.
    const agg = aggregate(
      [
        { itemId: 'a', repeat: 0, scores: [0.5, 0.6, 0.7], usdPerRound: [0.02, 0.02, 0.02] },
        { itemId: 'b', repeat: 0, scores: [0.5, 0.9], usdPerRound: [0.02, 0.02] },
      ],
      0.8,
    )
    expect(agg.rounds).toHaveLength(3)
    // A 3. körben már csak az 'a' van jelen.
    expect(agg.rounds[2]!.meanScore).toBeCloseTo(0.7, 5)
    // A 2. körben mindkettő.
    expect(agg.rounds[1]!.meanScore).toBeCloseTo(0.75, 5)
  })

  it('a halmozott átlagköltség körönként nő', () => {
    const agg = aggregate(rekordok([{ itemId: 'a', korok: [[0.5, 0.6, 0.7]] }], 0.03), 0.8)
    expect(agg.rounds[0]!.meanUsd).toBeCloseTo(0.03, 6)
    expect(agg.rounds[1]!.meanUsd).toBeCloseTo(0.06, 6)
    expect(agg.rounds[2]!.meanUsd).toBeCloseTo(0.09, 6)
  })
})

describe('decide', () => {
  it('adat nélkül hibát dob, nem hoz magabiztos döntést', () => {
    expect(() => decide(aggregate([], 0.8))).toThrow(/nincs mérési adat/i)
  })

  it('a kivétel nélküli, konzisztens javulást NEM minősíti zajnak', () => {
    // A záró review ellenpéldája. Hatvan párból hatvan pontosan +0,05-tel
    // javul, tehát a javulás saját szórása nulla. A régi szabály — ami az
    // egyedi megfigyelések szórásához mért — ezt „zajnak" ítélte.
    const terv = Array.from({ length: 20 }, (_, i) => {
      const alap = 0.3 + i * 0.02
      return {
        itemId: `elem-${String(i)}`,
        korok: [-0.06, 0, 0.06].map((d) => [alap + d, alap + d + 0.05]),
      }
    })
    const agg = aggregate(rekordok(terv), 0.8)

    expect(agg.rounds[1]!.rescueBase).toBe(60)
    expect(agg.rounds[1]!.meanGain).toBeCloseTo(0.05, 5)
    expect(agg.rounds[1]!.gainStdErr).toBeCloseTo(0, 6)
    expect(decide(agg).maxIterations).not.toBe(0)
  })

  it('a nullától megkülönböztethetetlen javulás egy generálásra állít', () => {
    // Vegyes előjelű, nulla körüli javulások: az átlag a standard hibán belül.
    const terv = Array.from({ length: 12 }, (_, i) => ({
      itemId: `elem-${String(i)}`,
      korok: [[0.5, 0.5 + (i % 2 === 0 ? 0.1 : -0.1)]],
    }))
    const agg = aggregate(rekordok(terv), 0.8)

    expect(agg.rounds[1]!.meanGain).toBeCloseTo(0, 6)
    expect(agg.rounds[1]!.gainStdErr).toBeGreaterThan(0)
    expect(decide(agg).maxIterations).toBe(0)
  })

  it('magas mentési arány önmagában megtartja a kört', () => {
    // Tizenegy pár épphogy átjut a küszöbön (+0,01), egy nagyot ugrik (+0,75).
    // A szórás így nagy az átlaghoz képest: az átlagos javulás (0,0717) a
    // kétszeres standard hibán (0,1233) BELÜL van, tehát nem szignifikáns —
    // a kör mégis megmarad, mert minden bukott elemet átvitt a küszöbön.
    // Ez a teszt választja szét az ÉS két oldalát: a javulás-feltétel
    // teljesül, a mentés-feltétel nem.
    const terv = Array.from({ length: 12 }, (_, i) => ({
      itemId: `elem-${String(i)}`,
      korok: i === 0 ? [[0.2, 0.95]] : [[0.79, 0.8]],
    }))
    const agg = aggregate(rekordok(terv), 0.8)

    expect(agg.rounds[1]!.rescueRate).toBe(1)
    expect(agg.rounds[1]!.meanGain).toBeLessThanOrEqual(2 * agg.rounds[1]!.gainStdErr)
    expect(decide(agg).maxIterations).not.toBe(0)
  })

  it('ha egyetlen elem sem bukik el, a javító kör sosem indulna: nullára áll', () => {
    // A pilótán a summary mindenre 1,00-t adott. Ilyenkor a javító kör éles
    // futásban el sem indul, tehát a keret fenntartása értelmetlen.
    const agg = aggregate(
      rekordok([{ itemId: 'a', korok: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] }]),
      0.8,
    )
    expect(agg.rounds[1]!.rescueBase).toBe(0)
    expect(decide(agg).maxIterations).toBe(0)
  })

  it('ha a második kör megéri, de a harmadik nem, két generálásra áll', () => {
    const terv = Array.from({ length: 12 }, (_, i) => ({
      itemId: `elem-${String(i)}`,
      // A második kör mindenkit átvisz a küszöbön; a harmadik nem mozdít.
      korok: [[0.4 + i * 0.01, 0.9, 0.9]],
    }))
    const agg = aggregate(rekordok(terv), 0.8)

    expect(agg.rounds[1]!.rescueRate).toBe(1)
    expect(agg.rounds[2]!.rescueBase).toBe(0)
    expect(decide(agg).maxIterations).toBe(1)
  })

  it('a mentési küszöb 20%: alatta bukik, fölötte megtart', () => {
    // Tíz bukott pár, ebből kettő ér a küszöbig = pontosan 20%.
    const terv = Array.from({ length: 10 }, (_, i) => ({
      itemId: `elem-${String(i)}`,
      korok: [[0.5, i < 2 ? 0.85 : 0.5]],
    }))
    const agg = aggregate(rekordok(terv), 0.8)
    expect(agg.rounds[1]!.rescueRate).toBeCloseTo(0.2, 6)
    // 0,2 nem kisebb 0,2-nél, tehát a kör megmarad.
    expect(decide(agg).maxIterations).not.toBe(0)
    // Szigorúbb küszöbnél viszont már elbukik.
    expect(decide(agg, 0.25).maxIterations).toBe(0)
  })

  it('a döntés indoklása megnevezi a javulást, a standard hibát és a mintát', () => {
    const terv = Array.from({ length: 12 }, (_, i) => ({
      itemId: `elem-${String(i)}`,
      korok: [[0.5, 0.5 + (i % 2 === 0 ? 0.1 : -0.1)]],
    }))
    const d = decide(aggregate(rekordok(terv), 0.8))
    expect(d.reason).toMatch(/javulása/i)
    expect(d.reason).toMatch(/standard hiba/i)
    expect(d.reason).toMatch(/megbukott páron/i)
  })
})
