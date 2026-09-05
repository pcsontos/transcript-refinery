import { describe, expect, it } from 'vitest'
import { GATE_LABELS } from '../../evals/fixtures/gate.js'
import { PUNCTUATION_THRESHOLD, classifyCaptions, punctuationDensity } from './classify.js'

/** A pozitív osztály az `auto`: ez indítja majd az újratranszkribálást. */
function measure(threshold: number) {
  let tp = 0
  let fp = 0
  let fn = 0
  for (const { text, label } of GATE_LABELS) {
    const predicted = classifyCaptions(text, threshold)
    if (predicted === 'auto' && label === 'auto') tp++
    if (predicted === 'auto' && label === 'creator') fp++
    if (predicted === 'creator' && label === 'auto') fn++
  }
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  }
}

describe('a minőségi kapu mérése a címkézett halmazon', () => {
  it('kiírja a precisiont és a recallt, és mindkettő 0,9 felett van', () => {
    const { precision, recall } = measure(PUNCTUATION_THRESHOLD)

    console.log(
      `\nMinőségi kapu (küszöb ${String(PUNCTUATION_THRESHOLD)} írásjel / 100 szó), ` +
        `${String(GATE_LABELS.length)} címkézett elem:\n` +
        `  precision: ${precision.toFixed(3)}\n` +
        `  recall:    ${recall.toFixed(3)}\n`,
    )

    expect(precision).toBeGreaterThanOrEqual(0.9)
    expect(recall).toBeGreaterThanOrEqual(0.9)
  })

  it('a határeset benne van a halmazban, és a küszöb közelében mér', () => {
    const edge = GATE_LABELS.find((l) => l.id === 'hatareset')
    expect(edge).toBeDefined()

    const density = punctuationDensity(edge!.text)
    expect(density).toBeLessThan(PUNCTUATION_THRESHOLD * 2)
    expect(classifyCaptions(edge!.text)).toBe(edge!.label)
  })

  it('a halmaz mindkét osztályt tartalmazza', () => {
    const labels = new Set(GATE_LABELS.map((l) => l.label))
    expect(labels).toEqual(new Set(['creator', 'auto']))
  })

  it('egy elcsúsztatott küszöb rontja a mérést — a halmaz tehát érzékeny', () => {
    // Ha ez a teszt bukik, a címkézett halmaz nem diszkriminál, és a fenti
    // 0,9-es kapuk semmit nem bizonyítanak.
    const eltolt = measure(20)
    expect(Math.min(eltolt.precision, eltolt.recall)).toBeLessThan(0.9)
  })
})
