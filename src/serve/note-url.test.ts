import { describe, expect, it } from 'vitest'
import { githubNoteUrl } from './note-url.js'

const path = 'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md'

describe('githubNoteUrl', () => {
  it('a két origin alak, .git végződéssel és anélkül, ugyanazt a linket adja', () => {
    const expected =
      'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_summary.md'
    expect(githubNoteUrl('git@github.com:tulaj/repo.git', 'main', path)).toBe(expected)
    expect(githubNoteUrl('git@github.com:tulaj/repo', 'main', path)).toBe(expected)
    expect(githubNoteUrl('https://github.com/tulaj/repo.git', 'main', path)).toBe(expected)
    expect(githubNoteUrl('https://github.com/tulaj/repo', 'main', path)).toBe(expected)
  })

  it('más origin null', () => {
    expect(githubNoteUrl('https://gitlab.com/tulaj/repo.git', 'main', path)).toBeNull()
    expect(githubNoteUrl('nem-cím', 'main', path)).toBeNull()
  })
})
