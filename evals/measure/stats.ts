/** Egy `(elem, ismétlés)` pár körönkénti mérőszámai. */
export interface RunRecord {
  itemId: string
  /** Hányadik ismétlés, nullától. */
  repeat: number
  /** Körönkénti pontszám, generálásonként egy. */
  scores: number[]
  /** Körönkénti költség dollárban. */
  usdPerRound: number[]
}

export interface RoundStats {
  /** Hányadik generálás, egytől. */
  round: number
  meanScore: number
  /** Mennyivel magasabb az előző körnél. Az első körnél nulla. */
  meanGain: number
  /** Az előző körben megbukott párok közül hány érte el a küszöböt. */
  rescueRate: number
  /** A mentési arány nevezője: hány pár bukott az előző körben. */
  rescueBase: number
  /** Az addigi körök halmozott átlagköltsége elemenként. */
  meanUsd: number
}

export interface Aggregate {
  /** Az elemenkénti első köri szórások mediánja: amennyit magától ingadozik. */
  noise: number
  rounds: RoundStats[]
}

export interface Decision {
  maxIterations: 0 | 1 | 2
  reason: string
}

/** Mintaszórás (n−1). Egyetlen mintánál nulla. */
function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * A nyers futásokból a döntéshez szükséges három mennyiség.
 *
 * A **zajszint** azért elemenkénti szórások mediánja, és nem egyetlen globális
 * szórás: az elemek nehézsége eltér, és minket az érdekel, mennyit ingadozik
 * ugyanaz az elem önmagához képest.
 *
 * A **mentési arány** nevezője szándékosan szűk: éles futásban a javító kör
 * csak akkor indul, ha az előző kör megbukott, tehát a döntés szempontjából
 * kizárólag ezek a párok számítanak.
 */
export function aggregate(
  records: readonly RunRecord[],
  passThreshold: number,
): Aggregate {
  // Üres bemenetnél a `Math.max()` `-Infinity`-t adna; ez az ág teszi
  // egyértelművé, hogy nincs mit összesíteni.
  if (records.length === 0) return { noise: 0, rounds: [] }

  const korokSzama = Math.max(...records.map((r) => r.scores.length))

  const elemek = new Map<string, number[]>()
  for (const r of records) {
    const elso = r.scores[0]
    if (elso === undefined) continue
    elemek.set(r.itemId, [...(elemek.get(r.itemId) ?? []), elso])
  }
  const noise = median([...elemek.values()].map(stdev))

  const rounds: RoundStats[] = []
  for (let k = 0; k < korokSzama; k++) {
    const jelen = records.filter((r) => r.scores.length > k)
    const scores = jelen.map((r) => r.scores[k]!)

    const elozoBukott = k === 0 ? [] : jelen.filter((r) => r.scores[k - 1]! < passThreshold)
    const mentett = elozoBukott.filter((r) => r.scores[k]! >= passThreshold)

    rounds.push({
      round: k + 1,
      meanScore: mean(scores),
      meanGain: k === 0 ? 0 : mean(jelen.map((r) => r.scores[k]! - r.scores[k - 1]!)),
      rescueRate: elozoBukott.length === 0 ? 0 : mentett.length / elozoBukott.length,
      rescueBase: elozoBukott.length,
      meanUsd: mean(
        jelen.map((r) => r.usdPerRound.slice(0, k + 1).reduce((s, v) => s + v, 0)),
      ),
    })
  }

  return { noise, rounds }
}

/**
 * Az előre rögzített döntési szabály (spec §5). A szabály a futás **előtt**
 * született; ez a függvény csak alkalmazza.
 *
 * Egy kör akkor „nem éri meg", ha a javulása **legfeljebb** a zajszint **és**
 * a mentési aránya a küszöb alatt. A két feltétel kapcsolata `és`: egy kör,
 * ami keveset javít átlagban, de sok bukott elemet átvisz a küszöbön,
 * megéri a pénzét.
 *
 * Az összehasonlítás azért `<=` és nem `<`, ahogy a spec eredetileg írta: ha
 * a bíró minden körre ugyanazt a pontszámot adja, a javulás **és** a zajszint
 * is nulla, és a szigorú `<` mellett a `0 < 0` hamis lenne — a szabály azt
 * állítaná, hogy a kör kifizeti magát, holott semmit nem csinált. A javítás a
 * valós adaton derült ki, de még a mérés lefuttatása **előtt**, tehát a
 * szabály továbbra is előre rögzített.
 */
export function decide(agg: Aggregate, rescueFloor = 0.2): Decision {
  // Adat nélkül nincs döntés. E nélkül az őr nélkül egy olyan recept, aminek
  // minden futása elbukott, magabiztosan azt kapná, hogy „mindkét javító kör
  // kifizeti magát" — nulla mérésből.
  if (agg.rounds.length === 0) {
    throw new Error('nincs mérési adat: döntés nem hozható')
  }

  const nemEriMeg = (k: number): boolean => {
    const r = agg.rounds[k]
    if (!r) return false
    return r.meanGain <= agg.noise && r.rescueRate < rescueFloor
  }

  const szam = (n: number): string => n.toFixed(4)
  const alap = `zajszint ${szam(agg.noise)}`

  if (nemEriMeg(1)) {
    const r = agg.rounds[1]!
    return {
      maxIterations: 0,
      reason: `a második kör javulása ${szam(r.meanGain)} < ${alap}, mentési aránya ${szam(r.rescueRate)} — nem éri meg`,
    }
  }
  if (nemEriMeg(2)) {
    const r = agg.rounds[2]!
    return {
      maxIterations: 1,
      reason: `a harmadik kör javulása ${szam(r.meanGain)} < ${alap}, mentési aránya ${szam(r.rescueRate)} — nem éri meg`,
    }
  }
  return {
    maxIterations: 2,
    reason: `mindkét javító kör kifizeti magát a ${alap} mellett`,
  }
}
