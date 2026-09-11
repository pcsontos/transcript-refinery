/** Egy `(elem, ismétlés)` pár körönkénti mérőszámai. */
export interface RunRecord {
  itemId: string
  /** Hányadik ismétlés, nullától. */
  repeat: number
  /** Körönkénti pontszám, generálásonként egy. */
  scores: number[]
  /** Körönkénti költség dollárban. */
  usdPerRound: number[]
  /**
   * A megtartott (legjobb pontszámú) generálás szövege. Csak a privát,
   * gitignore-olt nyers adatba kerül — az `aggregate()` és a `decide()` nem
   * olvassa, a publikált riport tehát ettől függetlenül szövegmentes marad.
   * Azért van itt, hogy egy későbbi éles futtatás ugyanazon elemekre ne
   * fizessen rá még egyszer a generálásért.
   */
  output?: string
}

export interface RoundStats {
  /** Hányadik generálás, egytől. */
  round: number
  /** Az összes párra vett átlagpontszám — leíró adat. */
  meanScore: number
  /**
   * Mennyivel magasabb az előző körnél, **kizárólag azokon a párokon, ahol az
   * előző kör a küszöb alatt maradt**. Éles futásban a javító kör csak ilyenkor
   * indul; a többi páron a mérési mód üres hiánylistával küldene javító
   * promptot, amit a produkció sosem küld ki. Az első körnél nulla.
   */
  meanGain: number
  /** A javulás átlagának standard hibája: a javulások szórása / √n. */
  gainStdErr: number
  /** Az előző körben megbukott párok közül hány érte el a küszöböt. */
  rescueRate: number
  /**
   * A megbukott párok száma. Ez **egyszerre** a mentési arány nevezője és a
   * javulás mintája — a két mérőszám ugyanazt a produkciós feltételt méri.
   */
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
 * szórás: az byItem nehézsége eltér, és minket az érdekel, mennyit ingadozik
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

  const roundCount = Math.max(...records.map((r) => r.scores.length))

  const byItem = new Map<string, number[]>()
  for (const r of records) {
    const elso = r.scores[0]
    if (elso === undefined) continue
    byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), elso])
  }
  const noise = median([...byItem.values()].map(stdev))

  const rounds: RoundStats[] = []
  for (let k = 0; k < roundCount; k++) {
    const jelen = records.filter((r) => r.scores.length > k)
    const scores = jelen.map((r) => r.scores[k]!)

    const previouslyFailed = k === 0 ? [] : jelen.filter((r) => r.scores[k - 1]! < passThreshold)
    const rescued = previouslyFailed.filter((r) => r.scores[k]! >= passThreshold)
    // A javulás mintája ugyanaz, mint a mentési arányé: csak azok a párok,
    // ahol az előző kör megbukott — vagyis ahol a produkció tényleg javítana.
    const gains = previouslyFailed.map((r) => r.scores[k]! - r.scores[k - 1]!)

    rounds.push({
      round: k + 1,
      meanScore: mean(scores),
      meanGain: mean(gains),
      gainStdErr: gains.length === 0 ? 0 : stdev(gains) / Math.sqrt(gains.length),
      rescueRate: previouslyFailed.length === 0 ? 0 : rescued.length / previouslyFailed.length,
      rescueBase: previouslyFailed.length,
      meanUsd: mean(
        jelen.map((r) => r.usdPerRound.slice(0, k + 1).reduce((s, v) => s + v, 0)),
      ),
    })
  }

  return { noise, rounds }
}

/**
 * Hány standard hibányi javulás számít bizonyítottnak. A kettő a szokásos
 * ~95%-os konvenció. A bizonyítás terhe szándékosan a **javító körön** van:
 * minden futásnál pénzbe kerül, ezért maradjon bekapcsolva csak akkor, ha a
 * haszna kimutatható.
 */
const SIGMA = 2

/**
 * Az előre rögzített döntési szabály (spec §5). A szabály a futás **előtt**
 * született; ez a függvény csak alkalmazza.
 *
 * Egy kör akkor „nem éri meg", ha a javulása nem különböztethető meg nullától
 * **és** a mentési aránya a küszöb alatt. A két feltétel kapcsolata `és`: egy
 * kör, ami keveset javít átlagban, de sok bukott elemet átvisz a küszöbön,
 * megéri a pénzét.
 *
 * **Mihez mérünk.** A javulás átlagát a saját **standard hibájához**, nem az
 * egyedi megfigyelések szórásához. A különbség nem elméleti: egy olyan
 * eloszlás, ahol hatvan párból hatvan pontosan ugyanannyival javul — tehát a
 * javulás saját szórása nulla —, a per-megfigyelés szóráshoz mérve „zajnak"
 * minősülne, holott kivétel nélküli. A standard hiba azt a kérdést teszi fel,
 * amit fel akarunk tenni: megkülönböztethető-e a javulás a nullától.
 *
 * Az összehasonlítás `<=`, nem `<`: ha semmi nem mozdul, a javulás és a
 * standard hiba is nulla, és a szigorú `<` mellett a `0 < 0` hamis lenne — a
 * szabály azt állítaná, hogy a kör kifizeti magát, holott semmit nem csinált.
 *
 * Mindkét javítás valós adaton derült ki, de még a mérés lefuttatása
 * **előtt**, tehát a szabály továbbra is előre rögzített.
 */
export function decide(agg: Aggregate, rescueFloor = 0.2): Decision {
  // Adat nélkül nincs döntés. E nélkül az őr nélkül egy olyan recept, aminek
  // minden futása elbukott, magabiztosan azt kapná, hogy „mindkét javító kör
  // kifizeti magát" — nulla mérésből.
  if (agg.rounds.length === 0) {
    throw new Error('nincs mérési adat: döntés nem hozható')
  }

  const notWorthIt = (k: number): boolean => {
    const r = agg.rounds[k]
    if (!r) return false
    return r.meanGain <= SIGMA * r.gainStdErr && r.rescueRate < rescueFloor
  }

  const szam = (n: number): string => n.toFixed(4)
  const explain = (k: number, ordinal: string): string => {
    const r = agg.rounds[k]!
    return (
      `a ${ordinal} kör javulása ${szam(r.meanGain)} ≤ ${String(SIGMA)}× standard hiba ` +
      `(${szam(SIGMA * r.gainStdErr)}), mentési aránya ${szam(r.rescueRate)} ` +
      `${String(r.rescueBase)} megbukott páron — nem éri meg`
    )
  }

  if (notWorthIt(1)) return { maxIterations: 0, reason: explain(1, 'második') }
  if (notWorthIt(2)) return { maxIterations: 1, reason: explain(2, 'harmadik') }
  return {
    maxIterations: 2,
    reason: 'mindkét javító kör kimutathatóan javít vagy elég bukott elemet ment',
  }
}
