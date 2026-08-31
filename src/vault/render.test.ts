import { describe, expect, it } from 'vitest'
import type { NormalizedTranscript, SourceItem } from '../types.js'
import { lintVaultMarkdown } from './lint.js'
import { renderTranscriptNote } from './render.js'

const ITEM: SourceItem = {
  videoId: 'q6p-_W6_VoM',
  title: 'Agent Orchestration',
  channel: 'Burke Holland',
  uploadedAt: '2026-07-14',
  url: 'https://www.youtube.com/watch?v=q6p-_W6_VoM',
  subtitlePath: '/downloads/x.en.srt',
  mediaPath: '/downloads/x.mp4',
}

const TRANSCRIPT: NormalizedTranscript = {
  lines: ['Első sor.', 'Második sor.'],
  wordsRaw: 11468,
  wordsNormalized: 3939,
  captionSource: 'creator',
  punctuationDensity: 5.4,
}

describe('renderTranscriptNote', () => {
  it('YAML frontmatterrel kezdődik', () => {
    expect(renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0').startsWith('---\n')).toBe(true)
  })

  it('rögzíti a származást, hogy a mérés tudja, mit mér', () => {
    const md = renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0')
    expect(md).toContain('video_id: q6p-_W6_VoM')
    expect(md).toContain('transcript_source: creator_captions')
    expect(md).toContain('words_raw: 11468')
    expect(md).toContain('words_normalized: 3939')
    expect(md).toContain('generator: transcript-refinery@0.1.0')
  })

  it('automatikus feliratnál más származást ír', () => {
    const md = renderTranscriptNote(
      ITEM,
      { ...TRANSCRIPT, captionSource: 'auto' },
      '0.1.0',
    )
    expect(md).toContain('transcript_source: auto_captions')
  })

  it('a külső hivatkozást 🌐 emojival és szögletes zárójellel adja', () => {
    const md = renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0')
    expect(md).toContain('🌐 <https://www.youtube.com/watch?v=q6p-_W6_VoM>')
  })

  it('a szöveget bekezdésbe fűzi, nem soronként adja', () => {
    const md = renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0')
    expect(md).toContain('Első sor. Második sor.')
  })

  it('átmegy a vault linterén', () => {
    expect(lintVaultMarkdown(renderTranscriptNote(ITEM, TRANSCRIPT, '0.1.0'))).toEqual([])
  })

  it('a kettőspontot tartalmazó címet idézőjelezi a YAML-ben', () => {
    const md = renderTranscriptNote({ ...ITEM, title: 'Cím: alcím' }, TRANSCRIPT, '0.1.0')
    expect(md).toContain('title: "Cím: alcím"')
  })
})
