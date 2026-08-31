import { describe, expect, it } from 'vitest'
import { parseCueTiming, parseTimestamp } from './timestamp.js'

describe('parseTimestamp', () => {
  it('SRT alakot értelmez (vessző az ezredmásodperc előtt)', () => {
    expect(parseTimestamp('00:00:08,000')).toBe(8)
  })

  it('VTT alakot értelmez (pont az ezredmásodperc előtt)', () => {
    expect(parseTimestamp('00:00:04.550')).toBe(4.55)
  })

  it('órát, percet és másodpercet is összead', () => {
    expect(parseTimestamp('01:02:03,500')).toBe(3723.5)
  })
})

describe('parseCueTiming', () => {
  it('SRT időzítő sort értelmez', () => {
    expect(parseCueTiming('00:00:00,160 --> 00:00:08,000')).toEqual({
      start: 0.16,
      end: 8,
    })
  })

  it('a VTT cue-beállításokat figyelmen kívül hagyja', () => {
    expect(
      parseCueTiming('00:00:01.880 --> 00:00:04.550 align:start position:0%'),
    ).toEqual({ start: 1.88, end: 4.55 })
  })

  it('null-t ad, ha a sor nem időzítő', () => {
    expect(parseCueTiming('Jó napot kívánok.')).toBeNull()
  })
})
