import { describe, expect, it } from 'vitest'
import { SKELETON_LABELS } from '../../evals/fixtures/skeleton.js'
import { checkSkeleton } from './skeleton.js'

/** A pozitív osztály a `broken`: ezt kell a kapunak megfognia. */
function measure() {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const { source, translation, label } of SKELETON_LABELS) {
    const caught = checkSkeleton(translation, source).value === 0
    if (caught && label === 'broken') tp++
    if (caught && label === 'ok') fp++
    if (!caught && label === 'broken') fn++
  }
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  }
}

describe('a vázkapu mérése a címkézett halmazon', () => {
  it('kiírja a precisiont és a recallt, és mindkettő 0,9 felett van', () => {
    const { precision, recall } = measure()

    console.log(
      `\nVázkapu, ${String(SKELETON_LABELS.length)} címkézett eset:\n` +
        `  precision: ${precision.toFixed(3)}\n` +
        `  recall:    ${recall.toFixed(3)}\n`,
    )

    expect(precision).toBeGreaterThanOrEqual(0.9)
    expect(recall).toBeGreaterThanOrEqual(0.9)
  })

  it('minden törött esetet a várt vázelem fog meg', () => {
    for (const c of SKELETON_LABELS.filter((l) => l.label === 'broken')) {
      const { gaps } = checkSkeleton(c.translation, c.source)
      expect(
        gaps.some((gap) => c.expected!.test(gap)),
        `${c.id}: ${JSON.stringify(gaps)}`,
      ).toBe(true)
    }
  })

  it('a halmaz mindkét osztályt és mind a négy forrásreceptet tartalmazza', () => {
    expect(new Set(SKELETON_LABELS.map((l) => l.label))).toEqual(new Set(['ok', 'broken']))
    expect(new Set(SKELETON_LABELS.map((l) => l.recipe))).toEqual(
      new Set(['clean', 'summary', 'notes', 'bloom']),
    )
  })
})
