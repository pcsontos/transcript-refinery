import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, layoutError, noteFile, transcriptFile } from './paths.js'
import type { SourceItem } from '../types.js'

const item = (overrides: Partial<SourceItem> = {}): SourceItem => {
  const sourceFile = overrides.sourceFile || '3Blue1Brown/Transformers.en.srt'
  const fileName = sourceFile.split('/').pop() || ''
  // Kiterjesztés eltávolítása: .en.srt, .srt stb.
  const computedBaseName = fileName.replace(/(\.[a-z]{2})?\.srt$/, '')

  const { baseName: overriddenBaseName, ...restOverrides } = overrides
  return {
    itemId: 'a1b2c3',
    source: 'youtube',
    sourceFile: '3Blue1Brown/Transformers.en.srt',
    subtitlePath: '/s/youtube/3Blue1Brown/Transformers.en.srt',
    baseName: overriddenBaseName || computedBaseName,
    title: 'Transformers, the tech behind LLMs',
    language: 'en',
    metadata: {},
    ...restOverrides,
  }
}

describe('noteFile', () => {
  const withChannel = (extra: Partial<SourceItem['metadata']> = {}) =>
    item({ metadata: { channel: '3Blue1Brown', ...extra } })

  it('csatornával: forrás/csatorna/item_id/alapnév', () => {
    expect(noteFile('/v/gy', withChannel(), '_transcript.md')).toBe(
      '/v/gy/youtube/3Blue1Brown/a1b2c3/Transformers_transcript.md',
    )
  })

  it('csatorna nélkül: forrás/item_id/alapnév', () => {
    expect(noteFile('/v/gy', item(), '_transcript.md')).toBe(
      '/v/gy/youtube/a1b2c3/Transformers_transcript.md',
    )
  })

  it('a csak szóközt tartalmazó csatorna is hiányzik', () => {
    expect(noteFile('/v/gy', withChannel({ channel: '  ' }), '_transcript.md')).toBe(
      '/v/gy/youtube/a1b2c3/Transformers_transcript.md',
    )
  })

  it('a fájlnevet az alapnévből képzi, nem a metaadat címéből', () => {
    const path = noteFile('/v/gy', item({ title: 'Egészen más cím' }), '_transcript.md')
    expect(path.endsWith('/Transformers_transcript.md')).toBe(true)
  })

  it('a pinnedDir felülírja a sablont', () => {
    expect(noteFile('/v/gy', withChannel(), '_notes.md', { pinnedDir: '/v/gy/régi/mappa' })).toBe(
      '/v/gy/régi/mappa/Transformers_notes.md',
    )
  })

  it('a megadott sablont használja', () => {
    expect(noteFile('/v/gy', withChannel({ videoId: 'q6p' }), '_x.md', { layout: '{video_id}' })).toBe(
      '/v/gy/youtube/q6p/Transformers_x.md',
    )
  })

  it('a fájlrendszerre veszélyes karaktereket minden szegmensben cseréli', () => {
    const risky = item({ source: 'a:b', baseName: 'E*F', metadata: { channel: 'c?d' } })
    expect(noteFile('/v/gy', risky, '_transcript.md')).toBe('/v/gy/a：b/c？d/a1b2c3/E＊F_transcript.md')
  })

  it('a recept utótagját változatlanul fűzi hozzá', () => {
    expect(noteFile('/v/gy', item(), '_summary.md').endsWith('Transformers_summary.md')).toBe(true)
  })
})

describe('layoutError', () => {
  it('az elírt mezőnevet megnevezi', () => {
    expect(layoutError('{chanel}/{item_id}')).toContain('{chanel}')
  })
  it('a nem {mező} szegmens hiba', () => {
    expect(layoutError('videos/{item_id}')).not.toBeNull()
  })
  it('az alapértelmezés érvényes', () => {
    expect(layoutError(DEFAULT_LAYOUT)).toBeNull()
  })
})

describe('transcriptFile', () => {
  it('a noteFile speciális esete', () => {
    expect(transcriptFile('/v/gy', item())).toBe(noteFile('/v/gy', item(), '_transcript.md'))
  })
})
