import { basename } from 'node:path'
import { watch } from 'chokidar'
import { splitSubtitleName } from '../source/folder.js'

/** A figyelés beindulására hagyott idő a `ready` után. */
const SETTLE_MS = 100

export interface FileWatcher {
  close(): Promise<void>
}

/** Feliratfájl-e — ugyanaz a szabály, mint a felderítésé (`splitSubtitleName`). */
export function isSubtitlePath(path: string): boolean {
  return splitSubtitleName(basename(path)) !== null
}

/**
 * A forrásmappák rekurzív figyelése. Csak a feliratfájl számít; a letöltés
 * közbeni (`.part`) és más fájl nem. Az `awaitWriteFinish` megvárja, hogy a
 * fájl mérete `stabilityMs`-ig ne változzon — a letöltő így egy félkész
 * feliratot nem ad át. Az indításkor már ott lévő fájlokat nem jelzi
 * (`ignoreInitial`): azokat a felzárkózó kör dolgozza fel. macOS-en az indulás
 * előtt épp megírt fájlra utólag egy `change` jöhet; ez csak egy üres kört okoz,
 * mert a kör a kész elemet kihagyja.
 */
export async function watchSubtitles(
  dirs: readonly string[],
  onFile: (path: string) => void,
  onError: (error: Error) => void,
  opts: { stabilityMs?: number } = {},
): Promise<FileWatcher> {
  const watcher = watch([...dirs], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: opts.stabilityMs ?? 2000, pollInterval: 100 },
    ignored: (path, stats) => stats?.isFile() === true && !isSubtitlePath(path),
  })
  const emit = (path: string): void => {
    if (isSubtitlePath(path)) onFile(path)
  }
  watcher.on('add', emit).on('change', emit).on('error', (error) => {
    onError(error instanceof Error ? error : new Error(String(error)))
  })
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  // macOS-en a `ready` után közvetlenül írt fájl eseménye néha elvész (mérve: a
  // ready utáni azonnali írásnál 1/40, 100 ms várakozás után 0/40). A hívó
  // felzárkózó köre csak ez után derít fel, így az ablakban érkező fájlt az fedi.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  return { close: () => watcher.close() }
}
