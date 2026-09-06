/**
 * Fájlnév-biztos futásazonosító a futás kezdetéből: `2026-09-07T02-14-03`.
 *
 * A napló és a riport is ezt a nevet kapja, tehát a kettő párban marad, és
 * a mappa listázása időrendbe rendezi őket.
 */
export function runId(now: Date): string {
  return now.toISOString().slice(0, 19).replaceAll(':', '-')
}
