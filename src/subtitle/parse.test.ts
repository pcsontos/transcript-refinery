import { describe, expect, it } from 'vitest'
import { parseSubtitle } from './parse.js'

describe('parseSubtitle', () => {
  it('.srt kiterjesztésre az SRT értelmezőt hívja', () => {
    const cues = parseSubtitle(
      '1\n00:00:00,000 --> 00:00:01,000\nszöveg\n',
      'video.en.srt',
    )
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })

  it('.vtt kiterjesztésre a VTT értelmezőt hívja', () => {
    const cues = parseSubtitle(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<c>szöveg</c>\n',
      'video.hu.vtt',
    )
    expect(cues[0]!.lines).toEqual(['szöveg'])
  })

  it('ismeretlen kiterjesztésre hibát dob', () => {
    expect(() => parseSubtitle('bármi', 'video.txt')).toThrow(
      /Nem támogatott feliratformátum/,
    )
  })
})
