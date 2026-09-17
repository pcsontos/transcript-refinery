import { describe, expect, it } from 'vitest'
import type { NormalizedTranscript, SourceItem } from '../types.js'
import { noteBody } from './note-body.js'
import { renderRecipeNote } from './render.js'

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: '/s/youtube/csatorna/Beszéd.en.srt',
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: {},
  ...overrides,
})

const transcript: NormalizedTranscript = {
  lines: ['Első mondat.'],
  timed: [{ start: 0, text: 'Első mondat.' }],
  wordsRaw: 10,
  wordsNormalized: 9,
  captionSource: 'creator',
  punctuationDensity: 4.2,
}

const META = { recipe: 'clean', model: 'modell', iterations: 1, score: 1, costUsd: 0.01 }

const TORZS = [
  '# Introduction',
  '',
  '[00:01] First paragraph.',
  '',
  '---',
  '',
  '[00:19] After a horizontal rule.',
].join('\n')

describe('noteBody', () => {
  it('a renderelt jegyzetből pontosan a tartalmat adja vissza, linksorral és többsoros leírással', () => {
    const note = renderRecipeNote(
      item({
        metadata: {
          url: 'https://www.youtube.com/watch?v=x',
          description: 'Leírás\n---\n# Nem cím',
        },
      }),
      transcript,
      TORZS,
      META,
      '0.1.0',
    )

    const { body, generatedAt } = noteBody(note)

    expect(body).toBe(TORZS)
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('linksor nélküli jegyzeten is a tartalmat adja', () => {
    expect(noteBody(renderRecipeNote(item(), transcript, TORZS, META, '0.1.0')).body).toBe(TORZS)
  })

  it('az egysoros %%-megjegyzéseket — a Decks horgonyait is — kiveszi', () => {
    const note = renderRecipeNote(
      item(),
      transcript,
      '## What is it? %%dk:h:abc123%%\n\nAn answer.',
      META,
      '0.1.0',
    )
    expect(noteBody(note).body).toBe('## What is it?\n\nAn answer.')
  })

  it('generated_at nélküli, kézzel szerkesztett frontmatternél null időpontot ad', () => {
    expect(noteBody('---\nitem_id: a\n---\n# Cím\n\n---\n\nTartalom.\n')).toEqual({
      body: 'Tartalom.',
      generatedAt: null,
    })
  })

  it('fel nem ismerhető fejlécnél beszédes hibát dob', () => {
    expect(() => noteBody('# Cím\n\nTartalom.\n')).toThrow(
      'a forrásjegyzet fejléce nem ismerhető fel',
    )
  })
})
