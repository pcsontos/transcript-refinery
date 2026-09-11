import type { RunRecord } from './stats.js'

export interface RawData {
  results: Map<string, RunRecord[]>
  totalSpentUsd: number
}

interface RawFileShape {
  results?: [string, RunRecord[]][]
  totalSpentUsd?: number
}

/**
 * Egy korábbi (esetleg félbeszakadt) futás nyers adatát tölti be. A
 * `totalSpentUsd` hiánya régebbi fájlformátumot jelent — akkor a sikeres
 * körök összegéből pótol, ami pontos, amíg a korábbi futásban nem volt
 * költséggel járó hiba (a hibák nem hordoznak költségadatot).
 */
export function loadRawData(parsed: unknown): RawData {
  const shape = (parsed ?? {}) as RawFileShape
  const results = new Map<string, RunRecord[]>(shape.results ?? [])
  const totalSpentUsd =
    shape.totalSpentUsd ??
    [...results.values()]
      .flat()
      .reduce((sum, record) => sum + record.usdPerRound.reduce((s, u) => s + u, 0), 0)
  return { results, totalSpentUsd }
}

/** Igaz, ha erre a (recept, elem, ismétlés) hármasra már van rögzített rekord. */
export function alreadyDone(
  results: Map<string, RunRecord[]>,
  recipeId: string,
  itemId: string,
  repeat: number,
): boolean {
  return (results.get(recipeId) ?? []).some((r) => r.itemId === itemId && r.repeat === repeat)
}
