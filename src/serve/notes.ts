import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import MarkdownIt from 'markdown-it'
import { parse as parseYaml } from 'yaml'
import type { Config } from '../config.js'
import { gitPullFfOnly } from '../vault/git.js'
import { FRONTMATTER } from '../vault/lint.js'
import type { NoteOrigin } from '../vault/render.js'

// A jegyzet modell írta szöveg: nyers HTML nem kerülhet belőle az oldalba
// (ugyanúgy, mint a `web/server/utils/markdown.ts`-ben). Teszt őrzi.
const markdown = new MarkdownIt({ html: false, linkify: false })

/** Egy fajta neve: kisbetűs szavak kötőjellel (`summary`, `notes-hu`, `clean-moderate-hu`). */
export const KIND = /^[a-z]+(-[a-z]+)*$/

const TRANSCRIPT_END = '_transcript.md'

/** A `serve` kimeneti mappájának neve: az `origin` nélküli régi jegyzeteknél ebből látszik a Telegram. */
const SERVE_SOURCE = 'serve-out'

const PULL_TIMEOUT_MS = 10_000

export interface NoteListItem {
  itemId: string
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
  kinds: string[]
}

export interface NoteList {
  stale: boolean
  items: NoteListItem[]
}

/** A frontmatter egy mezője megjeleníthető szövegként. */
export interface NoteMeta {
  key: string
  value: string
}

export interface NoteView {
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
  /** A teljes frontmatter a YAML sorrendjében. */
  meta: NoteMeta[]
  html: string
}

export interface NotesSource {
  list(): Promise<NoteList>
  note(itemId: string, kind: string): Promise<NoteView | null>
}

/** A config nem tölthető be, tehát a `serve` nem éri el a vaultot. A HTTP-réteg 503-at ad rá. */
export class NotesUnavailable extends Error {}

interface NoteFile {
  path: string
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
}

interface ScannedItem {
  itemId: string
  files: Map<string, NoteFile>
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value
  if (value instanceof Date) return value.toISOString()
  return null
}

export function originOf(fields: Record<string, unknown>): NoteOrigin {
  if (fields.origin === 'telegram' || fields.origin === 'cli') return fields.origin
  return fields.source === SERVE_SOURCE ? 'telegram' : 'cli'
}

/** Egy YAML-érték megjeleníthető szövege: a lista vesszős, a dátum ISO, a többsoros szöveg többsoros marad. */
function shown(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(shown).join(', ')
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value.trimEnd()
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value) ?? ''
}

function frontmatter(source: string): Record<string, unknown> | null {
  const match = FRONTMATTER.exec(source)
  if (match === null) return null
  try {
    const parsed: unknown = parseYaml(match[1]!)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** `a` frissebb-e `b`-nél. A hiányzó idő a legrégebbi; ISO-időbélyegeknél a szöveges sorrend az időrend. */
function newer(a: string | null, b: string | null): boolean {
  if (a === null) return false
  return b === null || a > b
}

async function listing(root: string): Promise<string[]> {
  try {
    return await readdir(root, { recursive: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
}

/** Egy fájl beolvasott állapota: a módosítási idő és a méret őrzi, hogy változott-e. */
interface CacheEntry {
  mtimeMs: number
  size: number
  /** `null`, ha a fájl nem jegyzet (nincs frontmatter vagy `item_id`). */
  note: { itemId: string; file: NoteFile } | null
}

/** Fájlútvonal → utolsó beolvasás. A `serve` megtartja két kérés között. */
export type ScanCache = Map<string, CacheEntry>

/** A frontmatter olvasása ekkora darabokban halad, amíg a záró `---` meg nem jön. */
const HEAD_CHUNK = 8 * 1024
/** Ennél hosszabb frontmatter nem jegyzet: a fájl kimarad. */
const HEAD_LIMIT = 1024 * 1024

/**
 * A fájl eleje a frontmatter végéig. A jegyzet törzse (egy átirat több száz KB
 * is lehet) nem kell a listához, ezért nem olvassuk be.
 */
async function readHead(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const chunks: Buffer[] = []
    let position = 0
    for (;;) {
      const buffer = Buffer.alloc(HEAD_CHUNK)
      const { bytesRead } = await handle.read(buffer, 0, HEAD_CHUNK, position)
      const atEnd = bytesRead < HEAD_CHUNK
      chunks.push(buffer.subarray(0, bytesRead))
      position += bytesRead
      const text = Buffer.concat(chunks).toString('utf8')
      const match = FRONTMATTER.exec(text)
      // A szövegvégi `---` még lehet egy hosszabb sor eleje: addig nem kész, amíg nem jön újsor vagy fájlvég.
      if (match !== null && (match[0].endsWith('\n') || atEnd)) return text
      if (atEnd || position >= HEAD_LIMIT) return text
    }
  } finally {
    await handle.close()
  }
}

/** Egy fájl jegyzet-adatai; a gyorsítótárból, ha a módosítási idő és a méret ugyanaz. `null`, ha nem olvasható. */
async function entryFor(path: string, cache: ScanCache): Promise<CacheEntry | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    const cached = cache.get(path)
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached
    const fields = frontmatter(await readHead(path))
    const itemId = fields === null ? null : text(fields.item_id)
    const entry: CacheEntry = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      note:
        fields === null || itemId === null
          ? null
          : {
              itemId,
              file: {
                path,
                title: text(fields.title) ?? itemId,
                url: text(fields.url),
                origin: originOf(fields),
                generatedAt: text(fields.generated_at),
              },
            },
    }
    cache.set(path, entry)
    return entry
  } catch {
    // Közben eltűnt vagy olvashatatlan fájl: kimarad, a lista nem bukik miatta.
    return null
  }
}

/**
 * A `notesRoot` minden `*_transcript.md` fájlja egy elem kiindulópontja, és
 * ugyanabban a mappában az `<alapnév>_<fajta>.md` fájlok a jegyzetei. Az
 * elemek kulcsa a frontmatter `item_id` mezője, így két mappa ugyanarról a
 * videóról egy elem lesz; egy fajtából a legfrissebb (`generated_at`) marad.
 * A fájlok tartalmát a `cache` őrzi, amíg a módosítási idejük és a méretük nem
 * változik; a már nem létező fájlok kikerülnek belőle.
 */
export async function scanNotes(notesRoot: string, cache: ScanCache = new Map()): Promise<Map<string, ScannedItem>> {
  // Mappánként a fájlnevek: egy átirathoz csak a vele egy mappában levő fájlokat nézzük.
  const byDir = new Map<string, string[]>()
  for (const path of await listing(notesRoot)) {
    const dir = dirname(path)
    const names = byDir.get(dir)
    if (names === undefined) byDir.set(dir, [basename(path)])
    else names.push(basename(path))
  }
  const items = new Map<string, ScannedItem>()
  const seen = new Set<string>()
  for (const [dir, names] of byDir) {
    for (const anchor of names) {
      if (!anchor.endsWith(TRANSCRIPT_END) || anchor.startsWith('_')) continue
      const prefix = `${anchor.slice(0, -TRANSCRIPT_END.length)}_`
      for (const name of names) {
        if (!name.startsWith(prefix) || !name.endsWith('.md')) continue
        const kind = name.slice(prefix.length, -'.md'.length)
        if (!KIND.test(kind)) continue
        const path = join(notesRoot, dir, name)
        const entry = await entryFor(path, cache)
        if (entry === null) continue
        seen.add(path)
        if (entry.note === null) continue
        const { itemId, file } = entry.note
        let item = items.get(itemId)
        if (item === undefined) {
          item = { itemId, files: new Map() }
          items.set(itemId, item)
        }
        const current = item.files.get(kind)
        if (current === undefined || newer(file.generatedAt, current.generatedAt)) item.files.set(kind, file)
      }
    }
  }
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return items
}

function latest(item: ScannedItem): NoteFile {
  let best: NoteFile | undefined
  for (const file of item.files.values()) {
    if (best === undefined || newer(file.generatedAt, best.generatedAt)) best = file
  }
  return best!
}

export function createNotesSource(input: {
  load: () => Promise<{ cfg: Config }>
  /**
   * Lefoglalja a `serve` kapuját a pull idejére, és a felszabadítót adja; `null`, ha a `serve` épp
   * dolgozik (vagy másik lista pullol). A foglalás alatt `POST /jobs` 409-et kap, így a lista és
   * egy futás pullja nem fut egyszerre ugyanazon a klónon.
   */
  claim: () => (() => void) | null
  pull?: (repo: string) => Promise<void>
}): NotesSource {
  const pull = input.pull ?? ((repo: string) => gitPullFfOnly(repo, PULL_TIMEOUT_MS))
  const cache: ScanCache = new Map()

  async function config(): Promise<Config> {
    try {
      return (await input.load()).cfg
    } catch (cause) {
      throw new NotesUnavailable(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return {
    async list() {
      const cfg = await config()
      let stale = false
      const release = input.claim()
      if (release === null) {
        stale = true
      } else {
        try {
          await pull(cfg.vaultPath)
        } catch {
          stale = true
        } finally {
          release()
        }
      }
      const items = [...(await scanNotes(cfg.notesRoot, cache)).values()].map((item): NoteListItem => {
        const head = latest(item)
        return {
          itemId: item.itemId,
          title: head.title,
          url: head.url,
          origin: head.origin,
          generatedAt: head.generatedAt,
          kinds: [...item.files.keys()],
        }
      })
      items.sort((a, b) => (newer(a.generatedAt, b.generatedAt) ? -1 : newer(b.generatedAt, a.generatedAt) ? 1 : 0))
      return { stale, items }
    },

    async note(itemId, kind) {
      if (!KIND.test(kind)) return null
      const cfg = await config()
      const file = (await scanNotes(cfg.notesRoot, cache)).get(itemId)?.files.get(kind)
      if (file === undefined) return null
      const source = await readFile(file.path, 'utf8')
      const match = FRONTMATTER.exec(source)
      const body = match === null ? source : source.slice(match[0].length)
      const fields = frontmatter(source) ?? {}
      return {
        title: file.title,
        url: file.url,
        origin: file.origin,
        generatedAt: file.generatedAt,
        meta: Object.entries(fields).map(([key, value]) => ({ key, value: shown(value) })),
        html: markdown.render(body),
      }
    },
  }
}
