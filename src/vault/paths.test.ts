import { describe, expect, it } from 'vitest'
import { noteFile, transcriptFile } from './paths.js'
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
  it('a forrás nevét és a forráson belüli mappát tükrözi', () => {
    expect(noteFile('/v/Inbox/transcript-refinery', item(), '_transcript.md')).toBe(
      '/v/Inbox/transcript-refinery/youtube/3Blue1Brown/Transformers_transcript.md',
    )
  })

  it('a fájlnevet az alapnévből képzi, nem a metaadat címéből', () => {
    const path = noteFile('/v/gyökér', item({ title: 'Egészen más cím' }), '_transcript.md')
    expect(path.endsWith('/Transformers_transcript.md')).toBe(true)
  })

  it('metaadattal és nélküle ugyanoda ír', () => {
    const withMeta = item({ metadata: { videoId: 'q6p', channel: 'Cs', url: 'https://x' } })
    expect(noteFile('/v/gy', withMeta, '_transcript.md')).toBe(
      noteFile('/v/gy', item(), '_transcript.md'),
    )
  })

  it('a forrás gyökerében álló feliratot nem teszi almappába', () => {
    expect(noteFile('/v/gy', item({ sourceFile: 'Egy.en.srt' }), '_transcript.md')).toBe(
      '/v/gy/youtube/Egy_transcript.md',
    )
  })

  it('a mélyebb mappaszerkezetet is tükrözi', () => {
    const deep = item({ sourceFile: 'a/b/c/Mély.en.srt', baseName: 'Mély' })
    expect(noteFile('/v/gy', deep, '_transcript.md')).toBe('/v/gy/youtube/a/b/c/Mély_transcript.md')
  })

  it('a fájlrendszerre veszélyes karaktereket minden szegmensben cseréli', () => {
    const risky = item({ source: 'a:b', sourceFile: 'c?d/E*F.en.srt', baseName: 'E*F' })
    const path = noteFile('/v/gy', risky, '_transcript.md')
    expect(path).toBe('/v/gy/a：b/c？d/E＊F_transcript.md')
  })

  it('a recept utótagját változatlanul fűzi hozzá', () => {
    expect(noteFile('/v/gy', item(), '_summary.md').endsWith('Transformers_summary.md')).toBe(true)
  })
})

describe('transcriptFile', () => {
  it('a noteFile speciális esete', () => {
    expect(transcriptFile('/v/gy', item())).toBe(noteFile('/v/gy', item(), '_transcript.md'))
  })
})
