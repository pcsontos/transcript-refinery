export const CAPTION_SOURCES = ['creator', 'auto'] as const
export type CaptionSource = (typeof CAPTION_SOURCES)[number]

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
