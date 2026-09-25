import type { Stats } from 'node:fs'
import { basename } from 'node:path'
import { watch } from 'chokidar'
import { splitSubtitleName } from '../source/folder.js'

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
 * (`ignoreInitial`): azokat a felzárkózó kör dolgozza fel. macOS-en a figyelés
 * indulása előtt épp megírt fájlra utólag egy `change` esemény is érkezhet; az
 * indulásnál nem újabb módosítású fájl `change`-e ezért nem számít.
 */
export async function watchSubtitles(
  dirs: readonly string[],
  onFile: (path: string) => void,
  onError: (error: Error) => void,
  opts: { stabilityMs?: number } = {},
): Promise<FileWatcher> {
  const startedAt = Date.now()
  const watcher = watch([...dirs], {
    ignoreInitial: true,
    alwaysStat: true,
    awaitWriteFinish: { stabilityThreshold: opts.stabilityMs ?? 2000, pollInterval: 100 },
    ignored: (path, stats) => stats?.isFile() === true && !isSubtitlePath(path),
  })
  const emit = (path: string): void => {
    if (isSubtitlePath(path)) onFile(path)
  }
  const emitChange = (path: string, stats?: Stats): void => {
    // Ezredmásodpercre kerekítve: az indulás előtt megírt fájl mtime-ja ugyanabba
    // az ezredmásodpercbe eshet, mint a `startedAt`.
    if (stats !== undefined && Math.floor(stats.mtimeMs) <= startedAt) return
    emit(path)
  }
  watcher.on('add', emit).on('change', emitChange).on('error', (error) => {
    onError(error instanceof Error ? error : new Error(String(error)))
  })
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  return { close: () => watcher.close() }
}
