import { readFile, stat } from 'node:fs/promises'
import { MAX_TEXT_BYTES, normalizeText, tooLargeMessage } from './text-core.js'

export * from './text-core.js'

/**
 * Egy `.txt`/`.md` átirat szövege a fájlból. A méretet beolvasás előtt nézi,
 * a többi szabály a `normalizeText`-ben van.
 */
export async function readTextSource(path: string): Promise<string> {
  const { size } = await stat(path)
  if (size > MAX_TEXT_BYTES) throw new Error(tooLargeMessage(size))
  return normalizeText(await readFile(path), path.toLowerCase().endsWith('.md'))
}
