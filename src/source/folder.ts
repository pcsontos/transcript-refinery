import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, matchesGlob, relative, resolve, sep } from 'node:path'
import type { SourceDir } from '../config.js'
import type { SourceItem } from '../types.js'
import { itemIdFor } from './identity.js'
import { readSidecar } from './metadata.js'
import { readTextSource, TEXT_EXTENSIONS, textItemId } from './text.js'
import type { Source } from './types.js'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/** Amit a `--dir`/`--file` felvehet. A konfigurált `sources` csak feliratot. */
export const AD_HOC_EXTENSIONS: readonly string[] = [...SUBTITLE_EXTENSIONS, ...TEXT_EXTENSIONS]

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

async function walk(dir: string, skipHidden = false): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // nem létező vagy olvashatatlan mappa: nincs mit felszedni
  }
  const files: string[] = []
  for (const entry of entries) {
    // Az ad hoc bejárás a rejtett és a függőségi mappákat nem veszi fel (`.git`, `.obsidian`, `node_modules`).
    if (skipHidden && (entry.name.startsWith('.') || entry.name === 'node_modules')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full, skipHidden)))
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
export function splitSubtitleName(
  fileName: string,
  extensions: readonly string[] = SUBTITLE_EXTENSIONS,
): SubtitleName | null {
  const lower = fileName.toLowerCase()
  const ext = extensions.find((candidate) => lower.endsWith(candidate))
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
 * Feliratfájlokból elemek: csoportosítás mappa + alapnév szerint, nyelvválasztás,
 * sidecar-keresés. A nem feliratfájlokat kihagyja.
 */
async function subtitleItems(
  files: readonly string[],
  source: SourceDir,
  languages: readonly string[],
): Promise<SourceItem[]> {
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
      return subtitleItems(await walk(source.path), source, languages)
    },
  }
}

/** Azonos azonosítóból az első előfordulás marad. */
export function firstById(items: readonly SourceItem[]): SourceItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.itemId)) return false
    seen.add(item.itemId)
    return true
  })
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
  const items: SourceItem[] = []
  for (const source of sources) {
    items.push(...(await folderSource(source, languages).discover()))
  }
  return firstById(items)
}

/**
 * Egy `.txt`/`.md` átirat eleme. Az azonosító a tartalomból jön. Az
 * olvashatatlan fájl az útvonalból kap azonosítót: így a felderítés nem áll
 * meg miatta, a hibát pedig a `normalizeItem` megnevezve adja.
 */
export async function textItem(path: string, source: SourceDir): Promise<SourceItem> {
  const { base, language } = splitSubtitleName(basename(path), TEXT_EXTENSIONS)!
  const sourceFile = toPosix(relative(source.path, path))
  let itemId: string
  try {
    itemId = textItemId(await readTextSource(path))
  } catch {
    // ponytail: útvonal-hash azonosító; a fájl javítása után új tétel lesz belőle.
    // Az abszolút útból képzett: a forrásnévtől és a gyökértől függetlenül ugyanaz
    // marad, ha a tételt a sor horgonyából építjük újra.
    itemId = `t-${itemIdFor('', path)}`
  }
  return {
    itemId,
    source: source.name,
    sourceFile,
    subtitlePath: path,
    baseName: base,
    title: base,
    language,
    metadata: {},
    format: 'text',
  }
}

/** Egy futásra a `sources` helyére lépő forrás: `--dir` (és `--match`) vagy `--file`. */
export interface AdHoc {
  dir?: string
  file?: string
  match?: string
}

/**
 * Az ad hoc forrás elemei. A forrás neve a mappa neve, `--file`-nál a fájlt
 * tartalmazó mappáé. A `/` nélküli minta a fájlnévre illik, mint a
 * `.gitignore`-ban: relatív útra illesztve a `'*.md'` csendben kihagyná az
 * almappákat.
 */
export async function discoverAdHoc(
  adHoc: AdHoc,
  languages: readonly string[],
  sources: readonly SourceDir[] = [],
): Promise<SourceItem[]> {
  const root = resolve(adHoc.file === undefined ? adHoc.dir! : dirname(adHoc.file))
  const source: SourceDir = { name: basename(root), path: root }
  // Ha a mappa egy konfigurált forrás belsejében van, a feliratok azonosítója és
  // forrásneve a konfigurált forrásból jön, különben ugyanaz a videó második
  // tételként (más azonosítóval) kerülne a sorba.
  const configured = sources.find((candidate) => {
    const base = resolve(candidate.path)
    return root === base || root.startsWith(base + sep)
  })
  let files = adHoc.file === undefined ? await walk(root, true) : [resolve(adHoc.file)]
  const pattern = adHoc.match?.replace(/^\.\//, '')
  if (pattern !== undefined) {
    files = files.filter((path) =>
      matchesGlob(pattern.includes('/') ? toPosix(relative(root, path)) : basename(path), pattern),
    )
  }
  const texts = files.filter((path) => splitSubtitleName(basename(path), TEXT_EXTENSIONS) !== null).sort()
  return firstById([
    ...(await subtitleItems(files, configured ?? source, languages)),
    ...(await Promise.all(texts.map((path) => textItem(path, source)))),
  ])
}

/**
 * Egy sorbeli szöveges tétel újraépítése a horgony útvonalából. Hiba helyett
 * az okot adja: a hívó a „nem található” listára teszi.
 */
export async function queuedTextItem(itemId: string, path: string): Promise<SourceItem | string> {
  if (splitSubtitleName(basename(path), TEXT_EXTENSIONS) === null) {
    return `nem található: nem .txt vagy .md fájl (${path})`
  }
  if (!existsSync(path)) return `nem található: ${path}`
  const item = await textItem(path, { name: basename(dirname(path)), path: dirname(path) })
  return item.itemId === itemId
    ? item
    : `nem található: a fájl tartalma megváltozott a sorba vétel óta (${path})`
}
