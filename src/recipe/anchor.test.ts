import { describe, expect, it } from 'vitest'
import type { TimedLine } from '../types.js'
import { anchorParagraphs, formatTimestamp } from './anchor.js'

/** Nyolc szavas sorok, két másodpercenként — a valós korpusz alakja. */
const TIMED: TimedLine[] = [
  { start: 0, text: 'Hey everyone welcome back to the channel today' },
  { start: 2, text: 'we are going to talk about container storage' },
  { start: 4, text: 'and why it matters for your home lab' },
  { start: 64, text: 'the second thing I want to cover is' },
  { start: 66, text: 'backups because nobody thinks about them until' },
  { start: 68, text: 'the disk finally dies on a Sunday night' },
]

describe('formatTimestamp', () => {
  it('egy óra alatt percet és másodpercet ad', () => {
    expect(formatTimestamp(0)).toBe('[00:00]')
    expect(formatTimestamp(64)).toBe('[01:04]')
    expect(formatTimestamp(3599)).toBe('[59:59]')
  })

  it('egy órán túl órát is ad', () => {
    expect(formatTimestamp(3600)).toBe('[1:00:00]')
    expect(formatTimestamp(3920)).toBe('[1:05:20]')
  })
})

describe('anchorParagraphs', () => {
  it('a bekezdés elé a valódi kezdőidőt teszi', () => {
    const output = [
      'Hey everyone, welcome back to the channel. Today we are going to talk',
      'about container storage and why it matters for your home lab.',
      '',
      'The second thing I want to cover is backups, because nobody thinks about',
      'them until the disk finally dies on a Sunday night.',
    ].join('\n')

    const result = anchorParagraphs(output, TIMED)

    expect(result).toContain('[00:00] Hey everyone, welcome back')
    expect(result).toContain('[01:04] The second thing I want to cover')
  })

  it('a fejlécet változatlanul hagyja, időbélyeg nélkül', () => {
    const output = [
      '## Storage',
      '',
      'Hey everyone, welcome back to the channel. Today we are going to talk',
      'about container storage.',
    ].join('\n')

    const result = anchorParagraphs(output, TIMED)

    expect(result).toContain('## Storage')
    expect(result).not.toContain('[00:00] ## Storage')
    expect(result).toContain('[00:00] Hey everyone')
  })

  it('az enyhe szerkesztést elviseli: írásjel, nagybetű, kiesett töltelékszó', () => {
    const output = 'Welcome back to the channel — today we talk about container storage.'
    const result = anchorParagraphs(output, TIMED)
    expect(result.startsWith('[00:00] ')).toBe(true)
  })

  it('horgonyozhatatlan bekezdésnél dob, a bekezdés elejét megnevezve', () => {
    const output = 'Completely unrelated sentence about quantum chromodynamics and nothing else.'
    expect(() => anchorParagraphs(output, TIMED)).toThrow(/nem horgonyozható/)
  })

  it('a túl rövid bekezdésnél dob, mert nem lehet magabiztosan illeszteni', () => {
    const output = 'Right.'
    expect(() => anchorParagraphs(output, TIMED)).toThrow(/túl rövid/)
  })
})
