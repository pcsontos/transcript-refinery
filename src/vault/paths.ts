import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSegment } from './sanitize.js'

/**
 * Megkeresi a csatorna meglévő mappáját a vaultban, kis-nagybetű-érzéketlenül.
 * Ha nincs, a szanitizált nevet adja vissza — a mappát a publisher hozza létre.
 */
export async function resolveChannelDir(
  root: string,
  channel: string,
): Promise<string> {
  const wanted = sanitizeSegment(channel)
  let entries: string[]
  try {
    const dirents = await readdir(root, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return wanted
  }

  const exact = entries.find((e) => e === wanted)
  if (exact) return exact

  const lower = wanted.toLocaleLowerCase()
  return entries.find((e) => e.toLocaleLowerCase() === lower) ?? wanted
}

/** A videó mappája: `<gyökér>/<Csatorna>/<Cím>` — a többségi, beágyazott alak. */
export function videoDir(
  root: string,
  channelDir: string,
  title: string,
): string {
  return join(root, channelDir, sanitizeSegment(title))
}

/**
 * A vault konvenciója: `Youtube - <cím>_<típus>.md`. A típus-utótagot a
 * recept adja meg (`outputFile`), így a publisher recept-agnosztikus marad.
 */
export function recipeFile(
  videoDirPath: string,
  title: string,
  outputFile: string,
): string {
  return join(videoDirPath, `Youtube - ${sanitizeSegment(title)}${outputFile}`)
}

/** A Fázis 0 átirata: a `recipeFile` speciális esete. */
export function transcriptFile(videoDirPath: string, title: string): string {
  return recipeFile(videoDirPath, title, '_transcript.md')
}
