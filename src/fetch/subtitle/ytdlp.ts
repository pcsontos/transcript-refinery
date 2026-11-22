import { spawn } from 'node:child_process'
import { mediaId } from '../media-id.js'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Abortnál a gyerekfolyamat SIGTERM-et kap, és a futás a `close`-on oldódik fel (nem elutasítással). */
  signal?: AbortSignal
  /** A kimenet soronként (stdout és stderr); a haladás-jelzéshez. */
  onLine?: (line: string) => void
}

export type ProcessRunner = (args: readonly string[], options?: RunOptions) => Promise<ProcessResult>

export const YTDLP_MISSING =
  'A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp'

export function versionArgs(): string[] {
  return ['--version']
}

/** A konténerképen a Node van, a yt-dlp alapból csak a Denót kapcsolja be. */
const JS_RUNTIME = ['--js-runtimes', 'node'] as const

export function videoProbeArgs(url: string): string[] {
  return ['-J', '--no-playlist', '--skip-download', '--no-progress', ...JS_RUNTIME, '--', url]
}

export function playlistProbeArgs(url: string, playlistItems?: string): string[] {
  return [
    '-J',
    '--flat-playlist',
    '--skip-download',
    '--no-progress',
    ...(playlistItems === undefined ? [] : ['-I', playlistItems]),
    '--',
    url,
  ]
}

export function downloadArgs(input: {
  url: string
  dest: string
  languages: readonly string[]
  formats: readonly string[]
  overwrite: boolean
  id: string
}): string[] {
  return [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    input.languages.join(','),
    '--sub-format',
    input.formats.join('/'),
    '--write-info-json',
    '--no-playlist',
    '--no-progress',
    input.overwrite ? '--force-overwrites' : '--no-overwrites',
    ...JS_RUNTIME,
    '--paths',
    `home:${input.dest}`,
    '-o',
    `%(title)s [${input.id}].%(ext)s`,
    '--',
    input.url,
  ]
}

/** Hang letöltése az eredeti formátumban (konvertálás és ffmpeg nélkül), `.info.json`-nal. */
export function audioDownloadArgs(input: { url: string; dest: string; overwrite: boolean; id: string }): string[] {
  return [
    '-f',
    'bestaudio[ext=m4a]/bestaudio',
    '--write-info-json',
    '--no-playlist',
    '--newline',
    '--progress-template',
    'download:refinery-progress %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
    input.overwrite ? '--force-overwrites' : '--no-overwrites',
    ...JS_RUNTIME,
    '--paths',
    `home:${input.dest}`,
    '-o',
    `%(title)s [${input.id}].%(ext)s`,
    '--',
    input.url,
  ]
}

export interface VideoProbe {
  id: string
  /** A yt-dlp `_type` (`playlist`, `video`, …). */
  type?: string
  webpageUrl?: string
  title?: string
  channel?: string
  language?: string
  manualLangs: string[]
  automaticLangs: string[]
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function langKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value).filter((key) => key !== '')
}

function bestTag(language: string, tags: readonly string[]): string | null {
  const wanted = language.toLowerCase()
  const base = wanted.split('-')[0] ?? wanted
  const rank = (tag: string): number => {
    const candidate = tag.toLowerCase()
    if (candidate === `${wanted}-orig`) return 0
    if (candidate === wanted) return 1
    if (candidate === `${base}-orig`) return 2
    if (candidate === base) return 3
    if (candidate.startsWith(`${wanted}-`)) return 4
    return 5
  }
  const matching = tags.filter((tag) => rank(tag) < 5)
  if (matching.length === 0) return null
  return [...matching].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** A yt-dlp `--sub-langs` értéke: a videó saját nyelvén lévő kézi vagy eredeti automatikus sáv. */
export function originalSubtitleLang(probe: {
  language?: string
  manualLangs: readonly string[]
  automaticLangs: readonly string[]
}): string | null {
  const language = probe.language?.trim()
  if (!language) return null
  return bestTag(language, probe.manualLangs) ?? bestTag(language, probe.automaticLangs)
}

/**
 * A letöltendő sáv: a videó saját nyelve (`originalSubtitleLang`), különben a `fallback` (`--sub-lang`) első
 * nyelve, amelyhez kézi vagy eredeti (`-orig`) automatikus sáv van. A sima automatikus kulcs YouTube-on gépi
 * fordítás, a tartalék azt nem választja (pcsontos/issue-tracker#20).
 */
export function subtitleLang(
  probe: { language?: string; manualLangs: readonly string[]; automaticLangs: readonly string[] },
  fallback: readonly string[] = [],
): string | null {
  const own = originalSubtitleLang(probe)
  if (own !== null) return own
  const originals = probe.automaticLangs.filter((tag) => tag.toLowerCase().endsWith('-orig'))
  for (const language of fallback) {
    const tag = bestTag(language, probe.manualLangs) ?? bestTag(language, originals)
    if (tag !== null) return tag
  }
  return null
}

export function parseVideoProbe(stdout: string): VideoProbe | null {
  try {
    const raw = JSON.parse(stdout) as {
      _type?: unknown
      extractor_key?: unknown
      ie_key?: unknown
      webpage_url?: unknown
      id?: unknown
      title?: unknown
      channel?: unknown
      uploader?: unknown
      language?: unknown
      subtitles?: unknown
      automatic_captions?: unknown
    }
    const id = mediaId(raw)
    if (id === null) return null
    return {
      id,
      type: text(raw._type),
      webpageUrl: text(raw.webpage_url),
      title: text(raw.title),
      channel: text(raw.channel) ?? text(raw.uploader),
      language: text(raw.language),
      manualLangs: langKeys(raw.subtitles),
      automaticLangs: langKeys(raw.automatic_captions),
    }
  } catch {
    return null
  }
}

export interface PlaylistEntry {
  id?: string
  title?: string
}

export interface PlaylistProbe {
  id: string
  title?: string
  entries: PlaylistEntry[]
}

export function parsePlaylistProbe(stdout: string): PlaylistProbe | null {
  try {
    const raw = JSON.parse(stdout) as { id?: unknown; title?: unknown; entries?: unknown }
    if (typeof raw.id !== 'string' || raw.id === '') return null
    const entries = Array.isArray(raw.entries) ? raw.entries : []
    return {
      id: raw.id,
      title: text(raw.title),
      entries: entries.map((entry) => {
        const row = entry as { id?: unknown; title?: unknown }
        return {
          id: typeof row.id === 'string' && VIDEO_ID.test(row.id) ? row.id : undefined,
          title: text(row.title),
        }
      }),
    }
  } catch {
    return null
  }
}

/** A `--progress-template` sora: letöltött bájt, a teljes méret (`total_bytes`, különben a becslés, különben `null`). */
export function parseYtdlpProgress(line: string): { done: number; total: number | null } | null {
  const m = /^refinery-progress (\d+(?:\.\d+)?) (\S+) (\S+)$/.exec(line.trim())
  if (m === null) return null
  const size = (text: string | undefined): number | null => {
    const n = Number(text)
    return text !== 'NA' && Number.isFinite(n) ? Math.floor(n) : null
  }
  return { done: Math.floor(Number(m[1])), total: size(m[2]) ?? size(m[3]) }
}

/** A yt-dlp folyamat. Az ENOENT a Promise elutasítása, `code: 'ENOENT'` mezővel. */
export function createYtdlpRunner(): ProcessRunner {
  return (args, options) =>
    new Promise((resolve, reject) => {
      const signal = options?.signal
      // Jellel saját folyamatcsoport: abortnál a yt-dlp gyerekei (pl. ffmpeg-utófeldolgozás) is leállnak, nem írnak a
      // stagingbe. Jel nélkül marad az előtér-csoport, hogy a terminál Ctrl-C-je közvetlenül elérje a yt-dlp-t.
      const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'], detached: signal !== undefined })
      const onAbort = (): void => {
        try {
          if (child.pid === undefined) throw new Error('nincs pid')
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }
      if (signal?.aborted === true) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
      let stdout = ''
      let stderr = ''
      const onLine = options?.onLine
      // Csatornánként külön sortörő puffer, hogy a két cső töredékei ne keveredjenek.
      const liner = (): { push: (chunk: string) => void; end: () => void } => {
        let rest = ''
        return {
          push(chunk) {
            if (onLine === undefined) return
            const parts = (rest + chunk).split('\n')
            rest = parts.pop() ?? ''
            for (const part of parts) onLine(part)
          },
          end() {
            if (rest !== '') onLine?.(rest)
            rest = ''
          },
        }
      }
      const outLines = liner()
      const errLines = liner()
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        outLines.push(chunk)
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        errLines.push(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort)
        outLines.end()
        errLines.end()
        resolve({ code: code ?? 1, stdout, stderr })
      })
    })
}

export interface FeedEntry {
  /** Az epizód URL-je a `#` utáni rész nélkül. */
  url: string
  title: string
  duration: number | null
  timestamp: number | null
  /** A yt-dlp epizód-objektuma változatlanul; ez lesz az `.info.json`. */
  raw: Record<string, unknown>
}

export interface FeedProbe {
  title: string
  entries: FeedEntry[]
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A `yt-dlp -J --flat-playlist` kimenete egy podcast-feedre; hibás JSON vagy nem lista → `null`. */
export function parseFeedProbe(stdout: string): FeedProbe | null {
  try {
    const raw = JSON.parse(stdout) as { _type?: unknown; title?: unknown; entries?: unknown }
    if (raw._type !== 'playlist') return null
    const entries = Array.isArray(raw.entries) ? (raw.entries as Record<string, unknown>[]) : []
    return {
      title: text(raw.title) ?? 'névtelen',
      entries: entries.flatMap((entry) => {
        const url = entry.url
        if (typeof url !== 'string' || url === '') return []
        return [
          {
            url: url.split('#')[0] ?? url,
            title: text(entry.title) ?? 'névtelen',
            duration: num(entry.duration),
            timestamp: num(entry.timestamp),
            raw: entry,
          },
        ]
      }),
    }
  } catch {
    return null
  }
}
