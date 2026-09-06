import { describe, expect, it } from 'vitest'
import { renderRecipeNote, renderTranscriptNote } from './render.js'
import type { NormalizedTranscript, SourceItem } from '../types.js'

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: '3Blue1Brown/Transformers.en.srt',
  subtitlePath: '/s/youtube/3Blue1Brown/Transformers.en.srt',
  baseName: 'Transformers',
  title: 'Transformers',
  language: 'en',
  metadata: {},
  ...overrides,
})

const transcript: NormalizedTranscript = {
  lines: ['Első mondat.', 'Második mondat.'],
  wordsRaw: 100,
  wordsNormalized: 90,
  captionSource: 'creator',
  punctuationDensity: 4.2,
}

describe('renderTranscriptNote', () => {
  it('metaadat nélkül is érvényes frontmattert ad', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('item_id: a1b2c3')
    expect(note).toContain('title: Transformers')
    expect(note).toContain('source: youtube')
    expect(note).toContain('source_file: 3Blue1Brown/Transformers.en.srt')
    expect(note).toContain('words_raw: 100')
    expect(note).toContain('generator: transcript-refinery@0.1.0')
  })

  it('metaadat nélkül nem ír video_id, channel és url mezőt', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note).not.toContain('video_id')
    expect(note).not.toContain('channel')
    expect(note).not.toContain('url')
  })

  it('metaadattal a bővebb mezőket is kiírja', () => {
    const note = renderTranscriptNote(
      item({
        metadata: {
          videoId: 'q6p',
          channel: '3Blue1Brown',
          uploadedAt: '2026-07-14',
          url: 'https://example.com/v',
          duration: 1806,
          tags: ['ai'],
          description: 'Első\nMásodik',
        },
      }),
      transcript,
      '0.1.0',
    )
    expect(note).toContain('video_id: q6p')
    expect(note).toContain('channel: 3Blue1Brown')
    expect(note).toContain('uploaded: 2026-07-14')
    expect(note).toContain('duration: 1806')
    expect(note).toContain('tags: [ai]')
    expect(note).toContain('description: |2-\n  Első\n  Második')
  })

  it('a felirat eredetét rögzíti', () => {
    expect(renderTranscriptNote(item(), transcript, '0.1.0')).toContain(
      'transcript_source: creator_captions',
    )
    expect(
      renderTranscriptNote(item(), { ...transcript, captionSource: 'auto' }, '0.1.0'),
    ).toContain('transcript_source: auto_captions')
  })

  it('URL nélkül nem ír linksort a törzsbe', () => {
    expect(renderTranscriptNote(item(), transcript, '0.1.0')).not.toContain('🌐')
  })

  it('URL-lel kiírja a linksort', () => {
    const note = renderTranscriptNote(
      item({ metadata: { url: 'https://example.com/v' } }),
      transcript,
      '0.1.0',
    )
    expect(note).toContain('🌐 <https://example.com/v>')
  })

  it('a törzsben a cím és a bekezdéssé fűzött szöveg szerepel', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note).toContain('# Transformers')
    expect(note).toContain('Első mondat. Második mondat.')
  })
})

describe('renderRecipeNote', () => {
  const meta = {
    recipe: 'summary',
    model: 'claude-sonnet-5',
    iterations: 2,
    score: 0.85,
    costUsd: 0.0812,
  }

  it('a futás mérőszámait a frontmatterbe teszi', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')
    expect(note).toContain('recipe: summary')
    expect(note).toContain('model: claude-sonnet-5')
    expect(note).toContain('iterations: 2')
    expect(note).toContain('score: 0.85')
    expect(note).toContain('cost_usd: 0.0812')
  })

  it('metaadat nélkül is elkészül', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')
    expect(note).toContain('item_id: a1b2c3')
    expect(note).not.toContain('video_id')
    expect(note.trimEnd().endsWith('A törzs.')).toBe(true)
  })
})
