import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QUEUE_FILE, queuePath, readQueueFile } from './file.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-sor-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('queuePath', () => {
  it('a notes_dir gyökerében lévő _queue.md', () => {
    expect(QUEUE_FILE).toBe('_queue.md')
    expect(queuePath('/v/Inbox/transcript-refinery')).toBe(
      join('/v/Inbox/transcript-refinery', '_queue.md'),
    )
  })
})

describe('readQueueFile', () => {
  it('hiányzó fájlra null-t ad', async () => {
    expect(await readQueueFile(join(dir, '_queue.md'))).toBeNull()
  })

  it('a meglévő fájl szövegét adja', async () => {
    await writeFile(join(dir, '_queue.md'), 'sor\n', 'utf8')
    expect(await readQueueFile(join(dir, '_queue.md'))).toBe('sor\n')
  })

  it('más olvasási hibát továbbad', async () => {
    // Mappa olvasása fájlként: EISDIR, nem ENOENT.
    await expect(readQueueFile(dir)).rejects.toThrow()
  })
})
