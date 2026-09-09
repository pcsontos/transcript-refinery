/** Egy mintavételi jelölt: elemazonosító és a normalizált átirat szószáma. */
export interface SampleCandidate {
  itemId: string
  words: number
}

/**
 * Hossz szerint rétegzett, determinisztikus minta.
 *
 * A korpusz hossza két nagyságrendet fog át, ezért egy találomra vett minta
 * kihagyhatja a hosszú elemeket — pedig épp ott érdekes a javító kör, mert ott
 * van a legtöbb lefedni való. A jelölteket ezért szóhossz szerint `strata`
 * egyenlő rétegre osztjuk, és mindegyikből `perStratum` elemet veszünk,
 * egyenletesen szétszórva a rétegen belül.
 *
 * A determinizmus nem kényelmi kérdés: a mérés ismétlései csak akkor
 * ismétlések, ha ugyanazt a halmazt mérik. Ezért rendezünk (hossz, azonosító)
 * szerint — az azonosító a holtverseny feloldása.
 *
 * Kevés jelöltnél **hibát dob**: egy csendben kisebb minta a mérés erejét
 * gyengítené anélkül, hogy bárki észrevenné.
 */
export function stratifiedSample(
  candidates: readonly SampleCandidate[],
  perStratum: number,
  strata = 4,
): string[] {
  const kell = perStratum * strata
  if (candidates.length < kell) {
    throw new Error(
      `túl kevés jelölt a mintavételhez: ${String(candidates.length)} van, ${String(kell)} kellene`,
    )
  }

  const rendezett = [...candidates].sort(
    (a, b) => a.words - b.words || a.itemId.localeCompare(b.itemId),
  )

  const valasztott: string[] = []
  const retegMeret = Math.floor(rendezett.length / strata)
  for (let reteg = 0; reteg < strata; reteg++) {
    const kezdet = reteg * retegMeret
    // Az utolsó réteg viszi a maradékot, hogy egyetlen elem se vesszen el.
    const veg = reteg === strata - 1 ? rendezett.length : kezdet + retegMeret
    const hossz = veg - kezdet
    for (let i = 0; i < perStratum; i++) {
      // Egyenletes szétszórás a rétegen belül, a szélek elkerülésével.
      const eltolas = Math.floor(((i + 0.5) * hossz) / perStratum)
      valasztott.push(rendezett[kezdet + eltolas]!.itemId)
    }
  }
  return valasztott
}
