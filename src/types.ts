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

/** Egy feldolgozandó elem a forrás-adaptertől. */
export interface SourceItem {
  /** Stabil azonosító: a metaadat videóazonosítója, vagy útvonal-hash. */
  itemId: string
  /** A forrás neve: a konfigurációbeli útvonal utolsó szegmense. */
  source: string
  /** A feliratfájl útvonala a forrás gyökeréhez képest, `/` elválasztóval. */
  sourceFile: string
  /** A feliratfájl abszolút útvonala. */
  subtitlePath: string
  /** A fájlnév nyelvi utótag és kiterjesztés nélkül. Ez adja a jegyzet nevét. */
  baseName: string
  /** A metaadat címe, ha van; egyébként az alapnév. */
  title: string
  /** A választott felirat nyelvi utótagja, ha volt a fájlnévben. */
  language: string | null
  /** A metaadatfájl mezői; üres objektum, ha nincs metaadat. */
  metadata: ItemMetadata
}

/** A normalizálás eredménye. */
export interface NormalizedTranscript {
  lines: string[]
  wordsRaw: number
  wordsNormalized: number
  captionSource: CaptionSource
  punctuationDensity: number
}
