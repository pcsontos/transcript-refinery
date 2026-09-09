import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fájlnév-biztos futásazonosító a futás kezdetéből: `2026-09-07T02-14-03`.
 *
 * A napló és a riport is ezt a nevet kapja, tehát a kettő párban marad, és
 * a mappa listázása időrendbe rendezi őket.
 */
export function runId(now: Date): string {
  return now.toISOString().slice(0, 19).replaceAll(':', '-')
}

/**
 * Ütközésmentes futásazonosító: a `base`, ha a `<base>.jsonl` még nem
 * létezik, egyébként `<base>-2`, `<base>-3`, … közül az első szabad.
 *
 * Két azonos másodpercben induló futás enélkül egyetlen naplófájlba
 * fésülődne (a napló `a` módban nyílik), és a második riportja felülírná az
 * elsőt — pont az a bizonyíték sérülne, amiért a napló és a riport készül.
 * A normál eset formátuma nem változik: utótag csak ütközéskor kerül a névre.
 */
export function reserveRunId(dir: string, base: string): string {
  let candidate = base
  let n = 1
  while (existsSync(join(dir, `${candidate}.jsonl`))) {
    n++
    candidate = `${base}-${n}`
  }
  return candidate
}
