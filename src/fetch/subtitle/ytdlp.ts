import { spawn } from 'node:child_process'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export type ProcessRunner = (args: readonly string[]) => Promise<ProcessResult>

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
    '%(title)s [%(id)s].%(ext)s',
    '--',
    input.url,
  ]
}

export interface VideoProbe {
  id: string
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

export function parseVideoProbe(stdout: string): VideoProbe | null {
  try {
    const raw = JSON.parse(stdout) as {
      id?: unknown
      title?: unknown
      channel?: unknown
      uploader?: unknown
      language?: unknown
      subtitles?: unknown
      automatic_captions?: unknown
    }
    if (typeof raw.id !== 'string' || !VIDEO_ID.test(raw.id)) return null
    return {
      id: raw.id,
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

/** A yt-dlp folyamat. Az ENOENT a Promise elutasítása, `code: 'ENOENT'` mezővel. */
export function createYtdlpRunner(): ProcessRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    })
}
