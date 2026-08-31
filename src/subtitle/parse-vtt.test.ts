import { describe, expect, it } from 'vitest'
import { parseVtt } from './parse-vtt.js'

const SAMPLE = `WEBVTT
Kind: captions
Language: hu

00:00:01.880 --> 00:00:04.550 align:start position:0%
 
Jó<00:00:02.080><c> napot</c><00:00:02.399><c> kívánok.</c>

00:00:04.550 --> 00:00:04.560 align:start position:0%
Jó napot kívánok.
 

00:00:04.560 --> 00:00:06.670 align:start position:0%
Jó napot kívánok.
fájdalomkezelő,<00:00:05.520><c> szakorvos,</c>
`

describe('parseVtt', () => {
  it('a WEBVTT fejlécet és a metaadatokat kihagyja', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues).toHaveLength(3)
  })

  it('eltávolítja az inline időbélyeg- és <c> tageket', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues[0]!.lines).toEqual(['Jó napot kívánok.'])
  })

  it('a cue-beállításokat nem tekinti szövegnek', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues[0]!.start).toBe(1.88)
    expect(cues[0]!.end).toBe(4.55)
  })

  it('kidobja a csak szóközt tartalmazó sorokat', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues.every((c) => c.lines.every((l) => l.trim() !== ''))).toBe(true)
  })

  it('megőrzi a gördülő ablak ismétlődéseit (a dedup nem itt történik)', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues[1]!.lines).toEqual(['Jó napot kívánok.'])
    expect(cues[2]!.lines).toEqual([
      'Jó napot kívánok.',
      'fájdalomkezelő, szakorvos,',
    ])
  })
})
