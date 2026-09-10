import type { Aggregate, Decision } from './stats.js'

export interface ReportMeta {
  items: number
  repeats: number
  generations: number
  totalUsd: number
  draftModel: string
  judgeModel: string
}

export interface RecipeResult {
  recipe: string
  agg: Aggregate
  decision: Decision
}

const n = (v: number): string => v.toFixed(4)
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/**
 * Aggregátum → publikálható Markdown.
 *
 * A függvény **szerkezetéből** következik, hogy nem szivárogtat tartalmat:
 * kizárólag számokat, receptneveket és modellneveket kap. Elemazonosító,
 * cím vagy jegyzet-részlet nem is jut el hozzá.
 */
export function renderMeasurementReport(
  recipes: readonly RecipeResult[],
  meta: ReportMeta,
): string {
  const lines: string[] = [
    '# Javít-e a javító kör?',
    '',
    'Mérés a valós korpuszon, valódi modellhívásokkal. A dokumentum kizárólag',
    'aggregátumot közöl: elemcím, csatornanév és jegyzet-részlet nem szerepel benne.',
    '',
    '## A mérés kerete',
    '',
    '| | |',
    '|---|---|',
    `| elem | ${String(meta.items)}, hossz szerint rétegezve |`,
    `| ismétlés | ${String(meta.repeats)} |`,
    `| generálás | ${String(meta.generations)}, korai megállás nélkül |`,
    `| vázlatmodell | ${meta.draftModel} |`,
    `| bírómodell | ${meta.judgeModel} |`,
    `| tényleges költség | $${meta.totalUsd.toFixed(2)} |`,
    '',
  ]

  for (const { recipe, agg, decision } of recipes) {
    lines.push(
      `## \`${recipe}\``,
      '',
      `Zajszint (az elemenkénti első köri szórások mediánja): **${n(agg.noise)}**`,
      '',
      'A javulás és a mentési arány **ugyanazon a mintán** számít: azokon a',
      'párokon, ahol az előző kör a küszöb alatt maradt — vagyis ahol éles',
      'futásban a javító kör egyáltalán elindulna.',
      '',
      '| kör | átlagpontszám | javulás | ± standard hiba | mentési arány | minta | átlagköltség |',
      '|---|---|---|---|---|---|---|',
    )
    for (const r of agg.rounds) {
      lines.push(
        `| ${String(r.round)} | ${n(r.meanScore)} | ${n(r.meanGain)} | ${n(r.gainStdErr)} | ${pct(r.rescueRate)} | ${String(r.rescueBase)} | $${r.meanUsd.toFixed(4)} |`,
      )
    }
    lines.push(
      '',
      `**Döntés: \`maxIterations: ${String(decision.maxIterations)}\`** — ${decision.reason}`,
      '',
    )
  }

  lines.push(
    '## Korlátok',
    '',
    'A bíró maga is **nem-determinisztikus**: ugyanannak a kimenetnek két',
    'pontozása eltérhet. Az ismétlések ezt elnyelik, de nem tüntetik el — ezért',
    'mérjük a javulást a zajszinthez, és nem önmagában.',
    '',
    'A minta a valós korpusz egy rétegzett részhalmaza, nem a teljes korpusz.',
    'Az eredmény erre a korpuszra és ezekre a modellekre vonatkozik.',
    '',
  )

  return lines.join('\n')
}
