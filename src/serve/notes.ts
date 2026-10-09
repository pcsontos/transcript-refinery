import { readdir, readFile } from 'node:fs/promises'
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

export interface NoteView {
  title: string
  url: string | null
  origin: NoteOrigin
  generatedAt: string | null
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

/**
 * A `notesRoot` minden `*_transcript.md` fájlja egy elem kiindulópontja, és
 * ugyanabban a mappában az `<alapnév>_<fajta>.md` fájlok a jegyzetei. Az
 * elemek kulcsa a frontmatter `item_id` mezője, így két mappa ugyanarról a
 * videóról egy elem lesz; egy fajtából a legfrissebb (`generated_at`) marad.
 */
export async function scanNotes(notesRoot: string): Promise<Map<string, ScannedItem>> {
  const paths = await listing(notesRoot)
  const items = new Map<string, ScannedItem>()
  // ponytail: kiindulópontonként végigmegy az összes úton (O(n²)); néhány száz fájlig elég, mappánkénti csoportosítás, ha lassú lesz.
  for (const anchor of paths) {
    const name = basename(anchor)
    if (!name.endsWith(TRANSCRIPT_END) || name.startsWith('_')) continue
    const dir = dirname(anchor)
    const prefix = join(dir, `${name.slice(0, -TRANSCRIPT_END.length)}_`)
    for (const path of paths) {
      if (!path.startsWith(prefix) || !path.endsWith('.md') || dirname(path) !== dir) continue
      const kind = path.slice(prefix.length, -'.md'.length)
      if (!KIND.test(kind)) continue
      const fields = frontmatter(await readFile(join(notesRoot, path), 'utf8'))
      const itemId = fields === null ? null : text(fields.item_id)
      if (fields === null || itemId === null) continue
      const file: NoteFile = {
        path: join(notesRoot, path),
        title: text(fields.title) ?? itemId,
        url: text(fields.url),
        origin: originOf(fields),
        generatedAt: text(fields.generated_at),
      }
      let item = items.get(itemId)
      if (item === undefined) {
        item = { itemId, files: new Map() }
        items.set(itemId, item)
      }
      const current = item.files.get(kind)
      if (current === undefined || newer(file.generatedAt, current.generatedAt)) item.files.set(kind, file)
    }
  }
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
  /** Igaz, amíg a `serve` munkát végez: ilyenkor a lista nem pullol, hogy ne ütközzön a futás commitjával. */
  busy: () => boolean
  pull?: (repo: string) => Promise<void>
}): NotesSource {
  const pull = input.pull ?? ((repo: string) => gitPullFfOnly(repo, PULL_TIMEOUT_MS))

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
      let stale = input.busy()
      if (!stale) {
        try {
          await pull(cfg.vaultPath)
        } catch {
          stale = true
        }
      }
      const items = [...(await scanNotes(cfg.notesRoot)).values()].map((item): NoteListItem => {
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
      const file = (await scanNotes(cfg.notesRoot)).get(itemId)?.files.get(kind)
      if (file === undefined) return null
      const source = await readFile(file.path, 'utf8')
      const match = FRONTMATTER.exec(source)
      const body = match === null ? source : source.slice(match[0].length)
      return {
        title: file.title,
        url: file.url,
        origin: file.origin,
        generatedAt: file.generatedAt,
        html: markdown.render(body),
      }
    },
  }
}
