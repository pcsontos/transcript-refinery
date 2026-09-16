import { describe, expect, it } from 'vitest'
import type { Cue } from '../types.js'
import { countWords, dedupeLines, dedupeTimedLines, toParagraphs } from './dedupe.js'

const cue = (lines: string[]): Cue => ({ start: 0, end: 1, lines })

/** Cue megadott kezdettel — az időzítés megőrzésének ellenőrzéséhez. */
const timedCue = (start: number, lines: string[]): Cue => ({
  start,
  end: start + 1,
  lines,
})

describe('dedupeLines', () => {
  it('kiejti a háromszorozott sorokat', () => {
    const cues = [
      cue(["Today I'm trying out the new"]),
      cue(["Today I'm trying out the new"]),
      cue(["Today I'm trying out the new"]),
      cue(['experiments platform']),
    ]
    expect(dedupeLines(cues)).toEqual([
      "Today I'm trying out the new",
      'experiments platform',
    ])
  })

  it('kezeli a gördülő ablakot, ahol a cue megismétli az előző sorát', () => {
    const cues = [
      cue(['Jó napot kívánok.']),
      cue(['Jó napot kívánok.', 'fájdalomkezelő, szakorvos,']),
      cue(['fájdalomkezelő, szakorvos,', 'és hipnoterapeuta.']),
    ]
    expect(dedupeLines(cues)).toEqual([
      'Jó napot kívánok.',
      'fájdalomkezelő, szakorvos,',
      'és hipnoterapeuta.',
    ])
  })

  it('a nem egymás utáni ismétlődést megtartja', () => {
    const cues = [cue(['alfa']), cue(['béta']), cue(['alfa'])]
    expect(dedupeLines(cues)).toEqual(['alfa', 'béta', 'alfa'])
  })

  it('kidobja az üres és csak szóközt tartalmazó sorokat', () => {
    const cues = [cue(['alfa']), cue(['   ']), cue(['']), cue(['béta'])]
    expect(dedupeLines(cues)).toEqual(['alfa', 'béta'])
  })

  it('üres bemenetre üres tömböt ad', () => {
    expect(dedupeLines([])).toEqual([])
  })
})

describe('dedupeTimedLines', () => {
  it('a megtartott sorhoz az ELSŐ előfordulás kezdetét rendeli', () => {
    const cues = [
      timedCue(10, ['Hey everyone, Brandon Lee here with']),
      timedCue(12, ['Hey everyone, Brandon Lee here with']),
      timedCue(14, ['Hey everyone, Brandon Lee here with', 'Virtualization How To and today']),
    ]
    expect(dedupeTimedLines(cues)).toEqual([
      { start: 10, text: 'Hey everyone, Brandon Lee here with' },
      { start: 14, text: 'Virtualization How To and today' },
    ])
  })

  it('az üres és csak szóközt tartalmazó sorokat kidobja', () => {
    const cues = [timedCue(0, ['alfa']), timedCue(5, ['   ']), timedCue(9, ['béta'])]
    expect(dedupeTimedLines(cues)).toEqual([
      { start: 0, text: 'alfa' },
      { start: 9, text: 'béta' },
    ])
  })

  it('a dedupeLines ennek a vetülete: ugyanaz a szöveg, idő nélkül', () => {
    const cues = [timedCue(0, ['alfa']), timedCue(4, ['béta']), timedCue(8, ['alfa'])]
    expect(dedupeLines(cues)).toEqual(dedupeTimedLines(cues).map((l) => l.text))
    expect(dedupeLines(cues)).toEqual(['alfa', 'béta', 'alfa'])
  })
})

describe('countWords', () => {
  it('szóközzel elválasztott szavakat számol', () => {
    expect(countWords('egy két három')).toBe(3)
  })

  it('a többszörös szóközt nem számolja külön szónak', () => {
    expect(countWords('  egy   két  ')).toBe(2)
  })

  it('üres szövegre nullát ad', () => {
    expect(countWords('   ')).toBe(0)
  })
})

describe('toParagraphs', () => {
  it('a megadott soronként bekezdést tör', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    expect(toParagraphs(lines, 2)).toBe('a b\n\nc d\n\ne')
  })

  it('üres listára üres szöveget ad', () => {
    expect(toParagraphs([], 2)).toBe('')
  })
})
