import { describe, expect, it } from 'vitest'
import { parseSrt } from './parse-srt.js'

const SAMPLE = `1
00:00:00,160 --> 00:00:08,000
Agent orchestration, otherwise known as

2
00:00:03,919 --> 00:00:11,599
what? Yes, the latest hot trend for vibe

3
00:00:08,000 --> 00:00:12,719
coders or agentic engineers is here. In
`

describe('parseSrt', () => {
  it('minden blokkot cue-vá alakít', () => {
    const cues = parseSrt(SAMPLE)
    expect(cues).toHaveLength(3)
    expect(cues[0]).toEqual({
      start: 0.16,
      end: 8,
      lines: ['Agent orchestration, otherwise known as'],
    })
  })

  it('megtartja az átfedő időzítést', () => {
    const cues = parseSrt(SAMPLE)
    expect(cues[1]!.start).toBeLessThan(cues[0]!.end)
  })

  it('több szövegsort is összegyűjt egy cue-ba', () => {
    const cues = parseSrt('1\n00:00:00,000 --> 00:00:01,000\nelső\nmásodik\n')
    expect(cues[0]!.lines).toEqual(['első', 'második'])
  })

  it('elviseli a sorszám nélküli blokkot', () => {
    const cues = parseSrt('00:00:00,000 --> 00:00:01,000\nszöveg\n')
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })

  it('üres bemenetre üres tömböt ad', () => {
    expect(parseSrt('')).toEqual([])
  })

  it('elviseli a CRLF sorvégeket', () => {
    const cues = parseSrt('1\r\n00:00:00,000 --> 00:00:01,000\r\nszöveg\r\n')
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })
})
