import { describe, expect, it } from 'vitest'
import {
  PUNCTUATION_THRESHOLD,
  classifyCaptions,
  punctuationDensity,
} from './classify.js'

describe('punctuationDensity', () => {
  it('száz szóra vetített írásjelszámot ad', () => {
    // 4 szó, 2 írásjel → 50 / 100 szó
    expect(punctuationDensity('szia, világ. hogy vagy')).toBe(50)
  })

  it('nullát ad írásjel nélküli szövegre', () => {
    expect(punctuationDensity('agent orchestration otherwise known as')).toBe(0)
  })

  it('nullát ad üres szövegre, nem oszt nullával', () => {
    expect(punctuationDensity('   ')).toBe(0)
  })
})

describe('classifyCaptions', () => {
  it('az írásjel nélküli ASR-szöveget automatikusnak sorolja', () => {
    const text =
      'agent orchestration otherwise known as what yes the latest hot ' +
      'trend for vibe coders or agentic engineers is here in this video'
    expect(classifyCaptions(text)).toBe('auto')
  })

  it('a rendesen központozott szöveget szerzőinek sorolja', () => {
    const text =
      'Agent orchestration, otherwise known as what? Yes, the latest hot ' +
      'trend for vibe coders is here. In this video, we take a look.'
    expect(classifyCaptions(text)).toBe('creator')
  })

  it('a küszöböt pontosan a mért szakadék közepére teszi', () => {
    expect(PUNCTUATION_THRESHOLD).toBe(2)
  })

  it('a küszöb felülbírálható', () => {
    expect(classifyCaptions('a, b', 1000)).toBe('auto')
  })
})
