import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SUB = /^(.*) \[([A-Za-z0-9_-]{11})\]\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(vtt|srt)$/i
const INFO = /^(.*) \[([A-Za-z0-9_-]{11})\]\.info\.json$/i

export interface SubtitleFile {
  language: string
  extension: 'vtt' | 'srt'
  absolutePath: string
}

export interface LocalPair {
  complete: boolean
  title: string
  files: SubtitleFile[]
  infoPath: string | null
}

export function subtitleKey(videoId: string, language: string, extension: string): string {
  return `videos/${videoId}/${language}.${extension}`
}

export function infoKey(videoId: string): string {
  return `videos/${videoId}/info.json`
}

function languageMatches(tag: string, languages: readonly string[]): boolean {
  const lower = tag.toLowerCase()
  return languages.some((wanted) => lower.startsWith(wanted.toLowerCase()))
}

async function readInfo(path: string): Promise<{ id: string | null; title: string; language?: string }> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { id?: unknown; title?: unknown; language?: unknown }
    const id = typeof raw.id === 'string' ? raw.id : null
    const title = typeof raw.title === 'string' ? raw.title : ''
    const language = typeof raw.language === 'string' && raw.language.trim() !== '' ? raw.language : undefined
    return { id, title, language }
  } catch {
    return { id: null, title: '' }
  }
}

/** A célmappa egy szintje. A hiányzó mappa üres, nem kész pár. */
export async function readLocalPair(
  dir: string,
  videoId: string,
  languages: readonly string[],
): Promise<LocalPair> {
  const empty: LocalPair = { complete: false, title: videoId, files: [], infoPath: null }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return empty
  }
  const found: SubtitleFile[] = []
  let infoPath: string | null = null
  let title = videoId
  let infoOk = false
  let infoLanguage: string | undefined
  for (const name of names) {
    const sub = SUB.exec(name)
    if (sub?.[2] === videoId && sub[3] !== undefined && sub[4] !== undefined) {
      const absolutePath = join(dir, name)
      const file = await stat(absolutePath)
      if (file.size > 0) {
        const extension = sub[4].toLowerCase()
        if (extension === 'vtt' || extension === 'srt') {
          found.push({ language: sub[3], extension, absolutePath })
        }
      }
    }
    const meta = INFO.exec(name)
    if (meta?.[2] === videoId) {
      const path = join(dir, name)
      infoPath = path
      const info = await readInfo(path)
      if (info.id === videoId) {
        infoOk = true
        infoLanguage = info.language
        title = info.title.trim() === '' ? videoId : info.title
      }
    }
  }
  const accepted = infoLanguage ? [infoLanguage] : languages
  const files = found.filter((file) => languageMatches(file.language, accepted))
  return { complete: files.length > 0 && infoOk, title, files, infoPath }
}

/** Minden olyan fájl, amelynek a neve erre a videóra illik. Más videó marad. */
export async function deleteLocalPair(dir: string, videoId: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    const sub = SUB.exec(name)
    const meta = INFO.exec(name)
    if (sub?.[2] === videoId || meta?.[2] === videoId) await rm(join(dir, name))
  }
}
