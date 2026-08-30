import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SourceItem } from '../types.js'
import type { Source } from './types.js'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/** `20260714` → `2026-07-14`. Ismeretlen alaknál változatlanul hagyja. */
function isoDate(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

/**
 * Megkeresi a metaadatfájl mellett álló, azonos alapnevű feliratot. A
 * Pinchflat `<alapnév>.<nyelv>.<kiterjesztés>` alakban ír, ezért előtag
 * szerint keresünk, nem pontos névre.
 */
function findSibling(
  files: readonly string[],
  infoPath: string,
  extensions: readonly string[],
): string | null {
  const base = infoPath.slice(0, -'.info.json'.length)
  const dir = dirname(infoPath)
  for (const file of files) {
    if (dirname(file) !== dir) continue
    if (!file.startsWith(base)) continue
    if (extensions.some((ext) => file.toLowerCase().endsWith(ext))) return file
  }
  return null
}

/**
 * A letöltő mappájából olvas. Offline és determinisztikus: a fejlesztés és a
 * tesztelés nem függ hálózattól.
 */
export function folderSource(root: string): Source {
  return {
    id: 'folder',

    async discover(): Promise<SourceItem[]> {
      const files = await walk(root)
      const infos = files.filter((f) => f.endsWith('.info.json'))
      const items: SourceItem[] = []

      for (const infoPath of infos) {
        let info: Record<string, unknown>
        try {
          // Szándékosan `unknown`, nem `any`: a JSON.parse kimenetét
          // ellenőrizzük, mielőtt bármit kiolvasnánk belőle.
          const parsed: unknown = JSON.parse(await readFile(infoPath, 'utf8'))
          if (typeof parsed !== 'object' || parsed === null) continue
          info = parsed as Record<string, unknown>
        } catch {
          continue // sérült metaadat: átugorjuk, a futás nem áll le
        }

        const videoId = typeof info.id === 'string' ? info.id : null
        const title = typeof info.title === 'string' ? info.title : null
        if (!videoId || !title) continue

        const subtitlePath = findSibling(files, infoPath, SUBTITLE_EXTENSIONS)
        if (!subtitlePath) continue // felirat nélkül nincs mit feldolgozni

        const channel =
          (typeof info.channel === 'string' && info.channel) ||
          (typeof info.uploader === 'string' && info.uploader) ||
          'ismeretlen csatorna'

        const url =
          typeof info.webpage_url === 'string'
            ? info.webpage_url
            : `https://www.youtube.com/watch?v=${videoId}`

        items.push({
          videoId,
          title,
          channel,
          uploadedAt: isoDate(info.upload_date),
          url,
          subtitlePath,
          mediaPath: findSibling(files, infoPath, ['.mp4', '.mkv', '.webm']),
        })
      }

      return items
    },
  }
}
