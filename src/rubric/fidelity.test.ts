import { describe, expect, it } from 'vitest'
import { checkFidelity, fidelityCriterion } from './fidelity.js'

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
