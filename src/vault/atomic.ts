import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Fájl cseréje atomi átnevezéssel.
 *
 * A queue-jegyzet az egyetlen vault-fájl, amit a pipeline helyben frissít —
 * és közben nyitva lehet Obsidianban. Az ideiglenes fájl ugyanabban a
 * mappában születik, így az átnevezés ugyanazon a fájlrendszeren marad, tehát
 * atomi; és nem `.md` kiterjesztésű, hogy az Obsidian ne indexelje.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const dir = dirname(path)
  const tmp = join(dir, `.${basename(path)}.${String(process.pid)}.tmp`)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}
