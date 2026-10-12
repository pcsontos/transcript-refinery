import { describe, expect, it } from 'vitest'
import { noteCommitMessage } from './commit.js'

describe('noteCommitMessage', () => {
  it('rövid címnél a cím és az azonosító is ép', () => {
    expect(noteCommitMessage('summary', 'Beszéd', 'dQw4w9WgXcQ')).toBe(
      'docs(transcript-refinery): summary | Beszéd [dQw4w9WgXcQ]',
    )
  })

  it('hosszú címnél az első sor pontosan 80 karakter, az azonosító ép', () => {
    const message = noteCommitMessage('summary-hu', 'It took me 10+ years to realize what really matters', 'D0Vw5X2PSIQ')
    expect([...message].length).toBe(80)
    expect(message.startsWith('docs(transcript-refinery): summary-hu | It took me 10+ years')).toBe(true)
    expect(message.endsWith('…[D0Vw5X2PSIQ]')).toBe(true)
  })

  it('a címben ismétlődő azonosítót és a sortörést kiveszi', () => {
    expect(noteCommitMessage('qa', 'Beszéd\nmásodik sor [dQw4w9WgXcQ]', 'dQw4w9WgXcQ')).toBe(
      'docs(transcript-refinery): qa | Beszéd második sor [dQw4w9WgXcQ]',
    )
  })

  it('ha az azonosító mellett nem fér el cím, az azonosító akkor is teljes', () => {
    const id = 'x'.repeat(60)
    expect(noteCommitMessage('summary', 'Beszéd', id)).toBe(`docs(transcript-refinery): summary | …[${id}]`)
  })
})
