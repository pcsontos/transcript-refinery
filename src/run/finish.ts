import { readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Kiírja a riportot, a hiányzó mappát létrehozva. */
export async function writeReport(path: string, markdown: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, markdown, 'utf8')
}

/**
 * Hány futás naplója van a mappában. Az állapottár sémája nem tud a
 * futásokról, és nem is fog: ez a szám a naplófájlokból jön, és a riport is
 * így nevezi meg.
 */
export function countRunLogs(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).length
  } catch {
    return 0
  }
}

/**
 * A Ctrl+C is riportot hagy maga után. Egyszeri lefutás: a második SIGINT ne
 * írjon félbehagyott riportot az elsőre.
 *
 * A visszaadott függvény leiratkozik: hívás után a `commandRun` visszatérte
 * után egy késői jel ne fusson neki egy már lezárt állapottárnak.
 */
export function installSigint(
  handler: () => void,
  target: {
    on(event: string, listener: () => void): unknown
    off?(event: string, listener: () => void): unknown
  } = process,
): () => void {
  let fired = false
  const listener = () => {
    if (fired) return
    fired = true
    handler()
  }
  target.on('SIGINT', listener)
  return () => target.off?.('SIGINT', listener)
}
