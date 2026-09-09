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
  it('receptenként kiírja a döntést és a három mennyiséget', () => {
    const md = renderMeasurementReport(
      [{ recipe: 'summary', agg: AGG, decision: decide(AGG) }],
      META,
    )
    expect(md).toContain('summary')
    expect(md).toMatch(/zajszint/i)
    expect(md).toMatch(/mentési arány/i)
    expect(md).toMatch(/maxIterations/)
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
