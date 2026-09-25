import { describe, expect, it } from 'vitest'
import {
  checkFidelity,
  DEFAULT_FIDELITY,
  fidelityCriterion,
  fidelityCriterionFor,
  fidelityMetrics,
} from './fidelity.js'

const TRANSCRIPT = [
  'so today we are going to talk about container storage',
  'and why it matters a lot for your home lab setup',
  'the first thing to understand is that volumes outlive containers',
  'which means your data survives a restart or an upgrade',
].join(' ')

describe('checkFidelity', () => {
  it('az enyhén szerkesztett leiratot elfogadja', () => {
    const output = [
      'So today we are going to talk about container storage, and why it matters',
      'a lot for your home lab setup.',
      '',
      'The first thing to understand is that volumes outlive containers, which',
      'means your data survives a restart or an upgrade.',
    ].join('\n')

    const result = checkFidelity(output, TRANSCRIPT)
    expect(result.value).toBe(1)
    expect(result.gaps).toEqual([])
  })

  it('az összefoglalót elutasítja, és megnevezi az arányt', () => {
    const output = 'The speaker explains that container volumes outlive containers.'
    const result = checkFidelity(output, TRANSCRIPT)
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/0\.\d+/)
    expect(result.gaps.join(' ')).toMatch(/shorter|summar/i)
  })

  it('a tartalmát lecserélő, de hasonló hosszú kimenetet elutasítja', () => {
    const output = TRANSCRIPT.split(' ').map(() => 'lorem').join(' ')
    const result = checkFidelity(output, TRANSCRIPT)
    expect(result.value).toBe(0)
    expect(result.gaps.join(' ')).toMatch(/cover/i)
  })

  it('az üres átiratra nem oszt nullával', () => {
    expect(checkFidelity('bármi', '').value).toBe(1)
  })
})

describe('fidelityCriterion', () => {
  it('blokkoló kapu', () => {
    expect(fidelityCriterion.blocking).toBe(true)
  })
})

describe('fidelityMetrics', () => {
  it('a szóarányt és a lefedettséget adja', () => {
    const m = fidelityMetrics('a b c', 'a b c d')
    expect(m.ratio).toBeCloseTo(0.75, 10)
    expect(m.coverage).toBeCloseTo(0.75, 10)
  })

  it('üres forrásra mindkettő 1', () => {
    expect(fidelityMetrics('bármi', '')).toEqual({ ratio: 1, coverage: 1 })
  })
})

describe('checkFidelity — küszöbök', () => {
  const forras = 'a b c d e f g h i j'
  const kimenet = 'a b c d e f g h' // arány 0,8, lefedettség 0,8

  it('az alapküszöb (0,85) alatt buktat', () => {
    expect(checkFidelity(kimenet, forras).value).toBe(0)
  })

  it('a megadott küszöbön pontosan átenged', () => {
    const lazabb = { ...DEFAULT_FIDELITY, minWordRatio: 0.8, minCoverage: 0.8 }
    expect(checkFidelity(kimenet, forras, lazabb).value).toBe(1)
  })

  it('edit feladatnál a hiányüzenet szerkesztésről szól, nem tisztításról', () => {
    const szigoru = { minWordRatio: 0.95, minCoverage: 0.95, task: 'edit' as const }
    const gaps = checkFidelity(kimenet, forras, szigoru).gaps.join(' ')
    expect(gaps).toMatch(/edit/i)
    expect(gaps).not.toMatch(/cleanup task/i)
  })
})

describe('fidelityCriterionFor', () => {
  it('blokkoló kapu, a megadott küszöbbel', async () => {
    const kapu = fidelityCriterionFor({ minWordRatio: 0.5, minCoverage: 0.5, task: 'edit' })
    expect(kapu.blocking).toBe(true)
    const score = await kapu.score(
      { output: 'a b c d e', transcript: 'a b c d e f g h i j' },
      { generate: () => Promise.reject(new Error('nem hívható')),
        generateObject: () => Promise.reject(new Error('nem hívható')) },
    )
    expect(score.value).toBe(1)
  })
})
