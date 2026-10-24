import { describe, expect, it } from 'vitest'
import { lintVaultMarkdown } from './lint.js'
import { readGlossaryTable } from '../recipe/glossary.js'
import { readingTime, renderGlossaryNote, renderRecipeNote, renderTranscriptNote } from './render.js'
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
  timed: [
    { start: 0, text: 'Első mondat.' },
    { start: 7, text: 'Második mondat.' },
  ],
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

  it('a címke szóközét aláhúzásra cseréli, mert az Obsidian a szóközöst hibának jelzi', () => {
    const note = renderTranscriptNote(
      item({ metadata: { tags: ['machine learning', 'ai'] } }),
      transcript,
      '0.1.0',
    )
    expect(note).toContain('tags: [machine_learning, ai]')
  })
})

describe('readingTime', () => {
  it.each([
    ['', 200, '00:00'],
    ['szó '.repeat(1500), 200, '07:30'],
    ['szó '.repeat(12500), 200, '1:02:30'],
    ['szó '.repeat(1500), 100, '15:00'],
    // pontosan egy óra már órás alak
    ['szó '.repeat(12000), 200, '1:00:00'],
    // 0,9 mp: a kerekítés 1-et, a levágás 0-t adna
    ['szó szó szó', 200, '00:01'],
  ])('%#. eset', (text, wpm, expected) => {
    expect(readingTime(text, wpm)).toBe(expected)
  })

  it.each([0, -1, Number.NaN])('a %s sebesség hiba, nem „Infinity:NaN” szöveg', (wpm) => {
    expect(() => readingTime('szó szó', wpm)).toThrow(/pozitív/)
  })

  it('az átirat jegyzete a normalizált törzs olvasási idejét írja, idézve', () => {
    // 4 szó, 200 szó/percnél 1,2 mp → kerekítve 1
    expect(renderTranscriptNote(item(), transcript, '0.1.0')).toContain('reading_time: "00:01"')
  })

  it('a recept jegyzete a törzs idejét és a megadott sebességet használja, a punctuation_density után', () => {
    const meta = { recipe: 'summary', model: 'm', iterations: 1, score: 0.9, costUsd: 0.01 }
    const note = renderRecipeNote(item(), transcript, 'szó '.repeat(1500), meta, '0.1.0', 'cli', 100)
    expect(note).toContain('reading_time: "15:00"')
    expect(note.indexOf('punctuation_density')).toBeLessThan(note.indexOf('reading_time'))
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

  it('a recept címkéit a metaadat-címkék után fűzi, ismétlés nélkül', () => {
    const note = renderRecipeNote(
      item({ metadata: { tags: ['ai', 'decks'] } }),
      transcript,
      'A törzs.',
      { ...meta, tags: ['decks', 'bloom'] },
      '0.1.0',
    )
    expect(note).toContain('tags: [ai, decks, bloom]')
  })

  it('metaadat-címke nélkül csak a recept címkéi kerülnek be', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', { ...meta, tags: ['decks'] }, '0.1.0')
    expect(note).toContain('tags: [decks]')
  })

  it('recept-címke nélkül a tags mező pontosan a mai', () => {
    const withTags = renderRecipeNote(item({ metadata: { tags: ['ai'] } }), transcript, 'A törzs.', meta, '0.1.0')
    expect(withTags).toContain('tags: [ai]')
    expect(renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')).not.toContain('tags')
  })

  it('a tisztítás után azonos címke nem kerül be kétszer', () => {
    const note = renderRecipeNote(
      item({ metadata: { tags: ['machine learning'] } }),
      transcript,
      'A törzs.',
      { ...meta, tags: ['machine_learning'] },
      '0.1.0',
    )
    expect(note).toContain('tags: [machine_learning]')
  })

  it('fordításnál a jegyzet nyelvét és a forrás adatait írja, a mérőszámok után', () => {
    const note = renderRecipeNote(
      item(),
      transcript,
      'A törzs.',
      {
        ...meta,
        recipe: 'clean-moderate-hu',
        translation: {
          language: 'hu',
          sourceRecipe: 'clean-moderate',
          sourceGeneratedAt: '2026-09-16T14:11:51.001Z',
        },
      },
      '0.1.0',
    )
    expect(note).toContain('\nlanguage: hu\n')
    expect(note).toContain(
      '\ncost_usd: 0.0812\nsource_language: en\ntranslation_of: clean-moderate\n' +
        'source_generated_at: "2026-09-16T14:11:51.001Z"\n---',
    )
  })

  it('a forrás hiányzó időpontja és nyelve kimarad', () => {
    const note = renderRecipeNote(
      item({ language: null }),
      transcript,
      'A törzs.',
      { ...meta, translation: { language: 'hu', sourceRecipe: 'clean-moderate', sourceGeneratedAt: null } },
      '0.1.0',
    )
    expect(note).toContain('\ntranslation_of: clean-moderate\n---')
    expect(note).not.toContain('source_language')
    expect(note).not.toContain('source_generated_at')
  })

  it('fordítás nélkül a frontmatter mezői a maiak', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')
    expect(note).toContain('\nlanguage: en\n')
    expect(note).toContain('\ncost_usd: 0.0812\n---')
    expect(note).not.toContain('translation_of')
  })
})

describe('origin', () => {
  const meta = { recipe: 'summary', model: 'm', iterations: 1, score: 1, costUsd: 0 }

  it('az átiratban a source után áll, alapból cli', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note).toContain('source: youtube\norigin: cli\nsource_file:')
  })

  it('a Telegramból jött szöveges tételnél nincs source_file, a CLI-snél és a videónál marad', () => {
    const text = item({ sourceFile: 'Beszéd [t-0123456789abcdef].txt', format: 'text' })
    expect(renderTranscriptNote(text, transcript, '0.1.0', 'telegram')).not.toContain('source_file')
    expect(renderRecipeNote(text, transcript, 'A törzs.', meta, '0.1.0', 'telegram')).not.toContain('source_file')
    expect(renderTranscriptNote(text, transcript, '0.1.0', 'cli')).toContain('\nsource_file:')
    expect(renderTranscriptNote(item(), transcript, '0.1.0', 'telegram')).toContain(
      '\nsource_file: 3Blue1Brown/Transformers.en.srt\n',
    )
  })

  it('a megadott origin a receptjegyzetbe is bekerül', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0', 'telegram')
    expect(note).toContain('source: youtube\norigin: telegram\nsource_file:')
  })
})

describe('renderGlossaryNote', () => {
  const md = renderGlossaryNote(item(), 'de', [{ source: 'a|b', target: 'c' }], '0.1.0')

  it('lint-tiszta, kind-dal és táblázattal, bélyeg nélkül', () => {
    expect(lintVaultMarkdown(md)).toEqual([])
    expect(md).toContain('\nkind: glossary-de\n')
    expect(md).toContain('\nlanguage: de\n')
    expect(md).toContain('| forrás | cél |')
    expect(md).toContain('| a\\|b | c |')
    expect(md).not.toContain('generated_at')
    expect(md).not.toContain('recipe')
  })

  it('oda-vissza olvasható', () => {
    expect(readGlossaryTable(md).pairs).toEqual([{ source: 'a|b', target: 'c' }])
  })
})
