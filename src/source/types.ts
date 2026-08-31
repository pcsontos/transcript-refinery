import type { SourceItem } from '../types.js'

/**
 * Egy ingest-forrás. A v1-ben egy implementáció van (letöltési mappa); a
 * második, URL-alapú implementáció igazolja majd visszamenőleg ezt a vágást.
 */
export interface Source {
  readonly id: string
  discover(): Promise<SourceItem[]>
}
