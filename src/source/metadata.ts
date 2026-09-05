import { readFile } from 'node:fs/promises'
import type { ItemMetadata } from '../types.js'

export interface SidecarData {
  /** A metaadatfájlban szereplő cím, ha van. A jegyzet címe ebből lesz. */
  title?: string
  metadata: ItemMetadata
}

/** `20260714` → `2026-07-14`. Ismeretlen alaknál változatlanul hagyja. */
function isoDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const strList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((x): x is string => typeof x === 'string' && x !== '')
  return items.length > 0 ? items : undefined
}

/**
 * A metaadatfájl **szűk** leképezése.
 *
 * Szándékosan whitelist: a mért korpusz metaadatfájljai hatvannál is több
 * kulcsot tartalmaznak, és abból a jegyzetbe csak az kerül, amit olvasunk is.
 *
 * Az URL-t nem szintetizáljuk a videóazonosítóból: az `https://youtube.com/...`
 * összerakása pontosan az a szolgáltatói feltevés, amit ez az architektúra
 * kivezet. Ha a fájl nem mond URL-t, akkor nincs URL.
 */
export function mapInfoJson(raw: unknown): SidecarData {
  if (typeof raw !== 'object' || raw === null) return { metadata: {} }
  const info = raw as Record<string, unknown>
  return {
    title: str(info.title),
    metadata: {
      videoId: str(info.id),
      channel: str(info.channel) ?? str(info.uploader),
      uploadedAt: isoDate(info.upload_date),
      url: str(info.webpage_url),
      duration: num(info.duration),
      tags: strList(info.tags),
      description: str(info.description),
    },
  }
}

/**
 * Beolvassa a felirat melletti metaadatfájlt, ha van.
 *
 * A hiányzó és a sérült fájl **ugyanaz az eset**: `null`. A metaadat
 * kiegészítés, nem belépő — egyik sem állíthatja meg a futást.
 */
export async function readSidecar(infoPath: string): Promise<SidecarData | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(infoPath, 'utf8'))
    return mapInfoJson(parsed)
  } catch {
    return null
  }
}
