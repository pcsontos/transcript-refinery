import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A feldolgozási sor fájlneve a `notes_dir` gyökerében. */
export const QUEUE_FILE = '_queue.md'

export function queuePath(notesRoot: string): string {
  return join(notesRoot, QUEUE_FILE)
}

/** A sor szövege, vagy `null`, ha még nincs. Minden más olvasási hiba továbbmegy. */
export async function readQueueFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
