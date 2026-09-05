export const CAPTION_SOURCES = ['creator', 'auto'] as const
export type CaptionSource = (typeof CAPTION_SOURCES)[number]

/**
 * Modellszerep. A receptek szerepet kérnek, nem modellnevet — a konkrét
 * modell a konfigurációé, mert a választás mérési eredmény, nem vélemény
 * (`decisions/0004`).
 */
export const MODEL_ROLES = ['draft', 'judge'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

/**
 * A feliratfájl melletti metaadatfájlból kiolvasott mezők. Mind opcionális:
 * metaadat nélkül is teljes értékű elem születik, csak kevesebbet tudunk róla.
 */
export interface ItemMetadata {
  videoId?: string
  channel?: string
  /** ISO-alakú dátum (`2026-07-14`). */
  uploadedAt?: string
  url?: string
  /** Hossz másodpercben. */
  duration?: number
  tags?: string[]
  description?: string
}

/** Egy feliratblokk: időtartomány és a hozzá tartozó szövegsorok. */
export interface Cue {
  /** kezdet másodpercben */
  start: number
  /** vég másodpercben */
  end: number
  lines: string[]
}

/** Egy feldolgozandó videó a forrás-adaptertől. */
export interface SourceItem {
  videoId: string
  title: string
  channel: string
  uploadedAt: string
  url: string
  subtitlePath: string
  mediaPath: string | null
}

/** A normalizálás eredménye. */
export interface NormalizedTranscript {
  lines: string[]
  wordsRaw: number
  wordsNormalized: number
  captionSource: CaptionSource
  punctuationDensity: number
}
