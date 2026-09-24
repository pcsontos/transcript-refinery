/**
 * A fordítási típusok közös sorozata. A mag `TRANSLATION_SERIES` értéke; itt
 * szövegként, mert a kliens a mag csomagjából csak típust importál.
 */
export const TRANSLATION_SERIES = 'fordítás'

/** Sorozatonként rögzített szín: az alaprecept sorrendje a regiszteré. */
const SERIES_COLORS: Record<string, string> = {
  summary: 'var(--viz-1)',
  flashcards: 'var(--viz-2)',
  qa: 'var(--viz-3)',
  clean: 'var(--viz-4)',
  bloom: 'var(--viz-5)',
  notes: 'var(--viz-6)',
  [TRANSLATION_SERIES]: 'var(--viz-7)',
}

/** Egy sorozat színe; az ismeretlen (új) alaprecept a 8. slotot kapja. */
export function seriesColor(series: string): string {
  return SERIES_COLORS[series] ?? 'var(--viz-8)'
}

export function seriesLabel(series: string): string {
  return series === TRANSLATION_SERIES ? 'fordítás' : kindLabel(series)
}

/** A katalógus cellájának szövege: `kész/összes`, hiánynál a hátralévők. */
export function coverageText(cell: { done: number; failed: number; total: number }): string {
  const base = `${cell.done}/${cell.total}`
  if (cell.done === cell.total) return base
  const rest = cell.total - cell.done
  return cell.failed > 0
    ? `${base} · ${rest} hátra (ebből ${cell.failed} hibás)`
    : `${base} · ${rest} hátra`
}

/** Ezres tagolás szóközzel; determinisztikus, a szerveren és a böngészőben azonos. */
export function formatWords(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export function formatRatio(part: number, whole: number): string {
  return whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`
}
