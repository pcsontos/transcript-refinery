import { describe, expect, it } from 'vitest'
import { renderMeasurementReport } from './report.js'
import { aggregate, decide, type RunRecord } from './stats.js'

const REKORDOK: RunRecord[] = [
  { itemId: 'TITKOS-AZONOSITO-1', repeat: 0, scores: [0.5, 0.9], usdPerRound: [0.02, 0.02] },
  { itemId: 'TITKOS-AZONOSITO-1', repeat: 1, scores: [0.6, 0.9], usdPerRound: [0.02, 0.02] },
  { itemId: 'TITKOS-AZONOSITO-2', repeat: 0, scores: [0.7, 0.95], usdPerRound: [0.02, 0.02] },
]

const AGG = aggregate(REKORDOK, 0.8)

const META = {
  items: 20,
  repeats: 3,
  generations: 3,
  totalUsd: 7.41,
  draftModel: 'claude-sonnet-5',
  judgeModel: 'grok-4-fast-reasoning',
}

describe('renderMeasurementReport', () => {
  it('receptenként kiírja a döntést és a mennyiségeket', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).toContain('summary')
    expect(md).toMatch(/zajszint/i)
    expect(md).toMatch(/mentési arány/i)
    expect(md).toMatch(/standard hiba/i)
    expect(md).toMatch(/maxIterations/)
  })

  it('a táblába a TÉNYLEGES számok kerülnek, négy tizedesre', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    const masodik = md.split('\n').find((s) => s.startsWith('| 2 |'))
    expect(masodik).toBeDefined()
    // Átlagpontszám a 2. körben: (0,9 + 0,9 + 0,95) / 3 = 0,9167.
    expect(masodik).toContain('0.9167')
    // Javulás a bukott párokon: (0,4 + 0,3 + 0,25) / 3 = 0,3167.
    expect(masodik).toContain('0.3167')
    // Mentési arány: mindhárom pár átjutott.
    expect(masodik).toContain('100.0%')
  })

  it('a százalék tényleg százalék, nem a nyers arány', () => {
    const felenek = aggregate(
      [
        { itemId: 'x', repeat: 0, scores: [0.5, 0.9], usdPerRound: [0.02, 0.02] },
        { itemId: 'y', repeat: 0, scores: [0.5, 0.6], usdPerRound: [0.02, 0.02] },
      ],
      0.8,
    )
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: felenek, decision: decide(felenek) }],
      META,
    )
    expect(md.split('\n').find((s) => s.startsWith('| 2 |'))).toContain('50.0%')
  })

  it('a döntés maxIterations értéke a tényleges döntésből jön', () => {
    // Nulla bukott pár: a javító kör sosem indulna, tehát nullára áll.
    const mind = aggregate(
      [{ itemId: 'x', repeat: 0, scores: [1, 1], usdPerRound: [0.02, 0.02] }],
      0.8,
    )
    const d = decide(mind)
    expect(d.maxIterations).toBe(0)
    const md = renderMeasurementReport([{ recipe: 'summary', agg: mind, decision: d }], META)
    expect(md).toContain('`maxIterations: 0`')
    expect(md).not.toContain('`maxIterations: 2`')
  })

  it('egyetlen elemazonosítót sem tartalmaz', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).not.toContain('TITKOS')
  })

  it('kimondja a bíró nem-determinizmusát mint korlátot', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).toMatch(/nem-determinisztikus/i)
  })

  it('a riport átmegy a vault linterén: minden linkcél szögletes zárójelben', async () => {
    const { lintVaultMarkdown } = await import('../../src/vault/lint.js')
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(lintVaultMarkdown(md)).toEqual([])
  })
})
