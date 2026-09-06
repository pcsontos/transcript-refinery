import { readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { SourceDir } from '../config.js'
import type { SourceItem } from '../types.js'
import { itemIdFor } from './identity.js'
import { readSidecar } from './metadata.js'
import type { Source } from './types.js'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/**
 * Nyelvkódnak látszó utótag: `en`, `hu`, `en-US`. A szűkítés szándékos — a
 * `Some.Talk.srt` alapneve `Some.Talk` marad, nem `Some`.
 *
 * A nyelvrész (kötőjel előtti szakasz) KIZÁRÓLAG kisbetűs lehet — a
 * régiókód (kötőjel utáni szakasz) case-insensitive marad, mert a
 * yt-dlp/whisper `en-US` alakja is nagybetűs régiót ad. A megszorítás a
 * `Rész.II.srt` / `Rész.III.srt` osztályt üti ki: a római szám nagybetűs,
 * tehát levágás nélkül marad az alapnév része.
 *
 * Két ismert korlát, mindkettő tudatosan vállalt:
 * 1. A kézzel írt NAGYBETŰS nyelvkód (`Talk.EN.srt`) nem ismerődik fel — a
 *    yt-dlp és a whisper is kisbetűset ad, a megkülönböztetés a római
 *    számoktól viszont enélkül nem megoldható.
 * 2. A címvégi kisbetűs kétbetűs szótag (`Bevezetés a Node.js.srt`) alakilag
 *    azonos egy valódi nyelvkóddal, ezért levágódik: az alapnév csonka lesz
 *    és a `language` hamis. A metaadat viszont NEM vész el — a
 *    sidecar-keresés a levágás nélküli nevet is próbálja.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

/** Az útvonal `/` elválasztóval, hogy a frontmatter platformfüggetlen legyen. */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // nem létező vagy olvashatatlan mappa: nincs mit felszedni
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

export interface SubtitleName {
  base: string
  language: string | null
}

/**
 * `Beszéd.en.srt` → `{ base: 'Beszéd', language: 'en' }`. Nem feliratfájlra
 * `null`. Az alapnév a metaadatfájl megtalálásának és az elem
 * azonosításának is az alapja, ezért a levágás szabályai szűkek.
 */
export function splitSubtitleName(fileName: string): SubtitleName | null {
  const lower = fileName.toLowerCase()
  const ext = SUBTITLE_EXTENSIONS.find((candidate) => lower.endsWith(candidate))
  if (!ext) return null

  const withoutExt = fileName.slice(0, -ext.length)
  const dot = withoutExt.lastIndexOf('.')
  if (dot > 0) {
    const tag = withoutExt.slice(dot + 1)
    if (LANGUAGE_TAG.test(tag)) {
      return { base: withoutExt.slice(0, dot), language: tag }
    }
  }
  return { base: withoutExt, language: null }
}

interface Candidate {
  path: string
  language: string | null
}

/**
 * Determinisztikus tartalék: `.srt` előbb, mint `.vtt`, azon belül
 * ábécésorrend. Enélkül a fájlrendszer felsorolási sorrendje döntene, és két
 * gépen két másik jegyzet készülne ugyanabból a mappából. A rendezés
 * kódpont szerinti, nem kollációs: a `localeCompare` az ICU aktuális
 * locale-jától függ (`LANG`/`LC_ALL`), ami gépenként eltér — a
 * gépfüggetlenséghez a puszta `<`/`>` összehasonlítás kell.
 */
function byFallback(a: Candidate, b: Candidate): number {
  const rank = (c: Candidate) => (c.path.toLowerCase().endsWith('.srt') ? 0 : 1)
  return rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

function chooseSubtitle(
  candidates: readonly Candidate[],
  languages: readonly string[],
): Candidate {
  const sorted = [...candidates].sort(byFallback)
  for (const wanted of languages) {
    const hit = sorted.find((c) => c.language?.toLowerCase().startsWith(wanted.toLowerCase()))
    if (hit) return hit
  }
  return sorted[0]!
}

/**
 * Feliratmappából olvas. Offline és determinisztikus: a fejlesztés és a
 * tesztelés nem függ hálózattól.
 *
 * A felderítés a **feliratfájlokon** iterál. A metaadatfájl kiegészítés: ha
 * van, gazdagabb lesz a jegyzet, de a hiánya nem ejt ki elemet.
 */
export function folderSource(source: SourceDir, languages: readonly string[]): Source {
  return {
    id: source.name,

    async discover(): Promise<SourceItem[]> {
      const files = await walk(source.path)

      // Csoportosítás mappa + alapnév szerint: egy alapnévhez egy elem
      // tartozik, akárhány nyelven van hozzá felirat.
      const groups = new Map<string, Candidate[]>()
      for (const path of files) {
        const parsed = splitSubtitleName(basename(path))
        if (!parsed) continue
        const key = join(dirname(path), parsed.base)
        const list = groups.get(key) ?? []
        list.push({ path, language: parsed.language })
        groups.set(key, list)
      }

      const items: SourceItem[] = []
      const keys = [...groups.keys()].sort()
      for (const key of keys) {
        const chosen = chooseSubtitle(groups.get(key)!, languages)
        // A metaadatfájl elsőként a levágott alapnév mellett várt, de ha a
        // nyelvkódnak látszó utótag valójában a cím része (pl. `Node.js`),
        // az info.json a LEVÁGÁS NÉLKÜLI névvel fekszik ott — ezt a tartalék
        // keresés találja meg, ahelyett hogy az elem metaadat nélkül maradna.
        const sidecar =
          (await readSidecar(`${key}.info.json`)) ??
          (chosen.language ? await readSidecar(`${key}.${chosen.language}.info.json`) : null)
        const baseName = basename(key)
        const relBase = toPosix(relative(source.path, key))

        items.push({
          itemId: itemIdFor(source.name, relBase, sidecar?.metadata.videoId),
          source: source.name,
          sourceFile: toPosix(relative(source.path, chosen.path)),
          subtitlePath: chosen.path,
          baseName,
          title: sidecar?.title ?? baseName,
          language: chosen.language,
          metadata: sidecar?.metadata ?? {},
        })
      }

      return items
    },
  }
}

/**
 * Az összes konfigurált forrás bejárása, a konfigurációban megadott
 * sorrendben.
 *
 * Az azonos azonosítójú elem kimarad: ha ugyanaz a videó két forrásban is ott
 * van, az állapottár egyetlen elemként tartaná nyilván, de két külön jegyzetet
 * írna — a második futás pedig „már feldolgozva" címén kihagyná az egyiket.
 * Az első előfordulás nyer.
 */
export async function discoverAll(
  sources: readonly SourceDir[],
  languages: readonly string[],
): Promise<SourceItem[]> {
  const seen = new Set<string>()
  const items: SourceItem[] = []
  for (const source of sources) {
    for (const item of await folderSource(source, languages).discover()) {
      if (seen.has(item.itemId)) continue
      seen.add(item.itemId)
      items.push(item)
    }
  }
  return items
}
