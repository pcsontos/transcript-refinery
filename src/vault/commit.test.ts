import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingNote, StateStore } from '../state/db.js'
import { commitPending, noteCommitMessage } from './commit.js'
import { gitCommitPaths } from './git.js'

vi.mock('./git.js', () => ({ gitCommitPaths: vi.fn() }))

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

  it('ha a cím csak az azonosítóból áll, a sorban csak az azonosító marad', () => {
    expect(noteCommitMessage('summary', '[dQw4w9WgXcQ]', 'dQw4w9WgXcQ')).toBe(
      'docs(transcript-refinery): summary | [dQw4w9WgXcQ]',
    )
  })

  it('a vágás nem töri ketté a több kódegységből álló karaktert', () => {
    const message = noteCommitMessage('summary', '😀'.repeat(60), 'dQw4w9WgXcQ')
    expect(message).toBe(`docs(transcript-refinery): summary | ${'😀'.repeat(29)}…[dQw4w9WgXcQ]`)
    expect([...message].length).toBe(80)
  })
})

describe('commitPending', () => {
  const note = (kind: string, path: string): PendingNote => ({ id: 'a1', title: 'Első videó', kind, path })

  function storeWith(notes: PendingNote[]) {
    const cleared: string[] = []
    const store = {
      listPendingNotes: () => notes,
      clearPendingCommits: (paths: readonly string[]) => {
        cleared.push(...paths)
      },
    } as unknown as StateStore
    return { store, cleared }
  }

  beforeEach(() => {
    vi.mocked(gitCommitPaths).mockReset()
  })

  it('jegyzetenként egy commit; a sor fájlja az utolsóval megy', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValue(true)
    const { store, cleared } = storeWith([note('transcript', '/v/t.md'), note('summary', '/v/s.md')])

    expect(await commitPending('/v', store, '/v/_queue.md')).toBe(2)

    expect(vi.mocked(gitCommitPaths).mock.calls).toEqual([
      ['/v', ['/v/t.md'], 'docs(transcript-refinery): transcript | Első videó [a1]'],
      ['/v', ['/v/s.md', '/v/_queue.md'], 'docs(transcript-refinery): summary | Első videó [a1]'],
    ])
    expect(cleared).toEqual(['/v/t.md', '/v/s.md'])
  })

  it('jegyzet nélkül a sor saját commitot kap', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValue(true)
    const { store } = storeWith([])

    expect(await commitPending('/v', store, '/v/_queue.md')).toBe(1)

    expect(vi.mocked(gitCommitPaths).mock.calls).toEqual([
      ['/v', ['/v/_queue.md'], 'docs(transcript-refinery): feldolgozási sor frissítése'],
    ])
  })

  it('jegyzet és sor nélkül nem hív gitet', async () => {
    const { store } = storeWith([])

    expect(await commitPending('/v', store, null)).toBe(0)

    expect(vi.mocked(gitCommitPaths)).not.toHaveBeenCalled()
  })

  it('nem változott fájlról nincs commit, de a jegyzet lekerül a várólistáról', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValue(false)
    const { store, cleared } = storeWith([note('transcript', '/v/t.md')])

    expect(await commitPending('/v', store, null)).toBe(0)

    expect(cleared).toEqual(['/v/t.md'])
  })

  it('ha egy commit hibát dob, a sorozat megáll, és a hátralévő jegyzet a várólistán marad', async () => {
    vi.mocked(gitCommitPaths).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('git hiba'))
    const { store, cleared } = storeWith([note('transcript', '/v/t.md'), note('summary', '/v/s.md')])

    await expect(commitPending('/v', store, null)).rejects.toThrow('git hiba')

    expect(cleared).toEqual(['/v/t.md'])
  })
})
