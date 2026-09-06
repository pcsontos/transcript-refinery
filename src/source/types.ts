import type { SourceItem } from '../types.js'

/**
 * Egy feliratforrás. Az `id` a forrás neve, ahogy a konfigurációban szerepel;
 * a jelentésekben ez azonosítja, melyik mappából jött az elem.
 */
export interface Source {
  readonly id: string
  discover(): Promise<SourceItem[]>
}
