import { mkdir, readFile, stat } from 'node:fs/promises'
import { loadCliConfig } from '../config.js'
import { installSigint } from '../run/finish.js'
import { classifyInput } from './classify.js'
import { parseSubtitleArgs, type SubtitleArgs } from './subtitle/args.js'
import { alreadyFetched, playlistDir, prepareIncomplete, videoDir } from './subtitle/skip.js'
import {
  createYtdlpRunner,
  downloadArgs,
  originalSubtitleLang,
  parsePlaylistProbe,
  parseVideoProbe,
  playlistProbeArgs,
  type ProcessResult,
  type ProcessRunner,
  versionArgs,
  videoProbeArgs,
  YTDLP_MISSING,
} from './subtitle/ytdlp.js'

export interface FetchRuntime {
  runner?: ProcessRunner
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  signals?: {
    on(event: string, listener: () => void): unknown
    off?(event: string, listener: () => void): unknown
  }
}

export function listEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

const USAGE = `Használat: refinery fetch subtitle <url> [kapcsolók...]
           refinery fetch subtitle --list <fájl> [kapcsolók...]

Módok:
  subtitle   YouTube feliratok és metaadatok letöltése

Kapcsolók (subtitle):
  <url|id>                  Egyetlen videó vagy lejátszási lista címe/azonosítója
  --list <fájl>             Szövegfájl, soronként egy YouTube-cím
  --out <út>                Célmappa, abszolút útvonal
  --sub-lang <kódok>        Vesszővel tagolt nyelvkódok (pl. hu,en-US)
  --sub-format <formátum>   Formátum: vtt, srt vagy srt,vtt (alapból: vtt,srt)
  --overwrite               Meglévő fájlok felülírása
  --flat                    Csatornamappa kihagyása, közvetlenül az --out gyökerébe
  --playlist-items <elemek> Lejátszási lista elemei (pl. 1:10)
  --yes-playlist            watch?v=...&list=... esetén a teljes lista letöltése
  --config <út>             Konfigurációs fájl útvonala
`

type Kind = 'downloaded' | 'skipped' | 'no-subtitle' | 'failed'

function summary(rows: readonly Kind[]): string {
  const count = (kind: Kind) => rows.filter((row) => row === kind).length
  return `Kész: ${count('downloaded')} letöltve, ${count('skipped')} átugorva, ${count('no-subtitle')} felirat nélkül, ${count('failed')} hibás.`
}

function finish(rows: readonly Kind[], stopped: boolean, stdout: (line: string) => void): number {
  if (stopped) {
    if (rows.length > 0) stdout(summary(rows))
    return 130
  }
  stdout(summary(rows))
  return rows.some((row) => row === 'failed' || row === 'no-subtitle') ? 1 : 0
}

function firstLine(str: string): string {
  const line = str.split(/\r?\n/).map((s) => s.trim()).find((s) => s !== '')
  return line ?? ''
}

async function inputsFrom(args: SubtitleArgs): Promise<{ lines: string[] } | { error: string }> {
  if (args.listPath === undefined) return { lines: args.inputs }
  try {
    return { lines: listEntries(await readFile(args.listPath, 'utf8')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { error: `Nincs listafájl: ${args.listPath}.` }
    return { error: (error as Error).message }
  }
}

export async function commandFetch(argv: readonly string[], runtime?: FetchRuntime): Promise<number> {
  const stdout = runtime?.stdout ?? ((line: string) => console.log(line))
  const stderr = runtime?.stderr ?? ((line: string) => console.error(line))

  if (argv.includes('--help') || argv.includes('-h')) {
    stdout(USAGE)
    return 0
  }

  const mode = argv[0]
  if (!mode || mode.startsWith('-')) {
    stderr('Hiányzó fetch-mód. Ismert: subtitle')
    return 1
  }
  if (mode !== 'subtitle') {
    stderr(`Ismeretlen fetch-mód: ${mode}. Ismert: subtitle`)
    return 1
  }

  const parsed = parseSubtitleArgs(argv.slice(1))
  if (!parsed.ok) {
    stderr(parsed.error)
    return 1
  }
  const args = parsed.args

  const inputResult = await inputsFrom(args)
  if ('error' in inputResult) {
    stderr(inputResult.error)
    return 1
  }
  if (inputResult.lines.length === 0) {
    stderr('A listafájl nem tartalmaz címet.')
    return 1
  }

  let out: string
  if (args.out !== undefined && args.subLang !== undefined && args.config === undefined) {
    out = args.out
  } else {
    let loaded: { cfg: { sources: { path: string }[]; languages?: string[] } } | null = null
    try {
      loaded = await loadCliConfig(args.config)
    } catch (error) {
      if (args.config !== undefined || args.out === undefined) {
        stderr((error as Error).message)
        return 1
      }
    }
    const cfg = loaded?.cfg
    const resolvedOut = args.out ?? cfg?.sources[0]?.path
    if (!resolvedOut) {
      stderr('Nincs célmappa: adj meg --out kapcsolót vagy config sources elemet.')
      return 1
    }
    out = resolvedOut
  }

  try {
    const s = await stat(out)
    if (!s.isDirectory()) {
      stderr(`A --out nem mappa: ${out}`)
      return 1
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      stderr((err as Error).message)
      return 1
    }
    try {
      await mkdir(out, { recursive: true })
    } catch (mkdirErr) {
      stderr((mkdirErr as Error).message)
      return 1
    }
  }

  let stopped = false
  const uninstall = installSigint(() => {
    stopped = true
  }, runtime?.signals)

  const runner = runtime?.runner ?? createYtdlpRunner()
  const rows: Kind[] = []

  async function runCmd(cmdArgs: readonly string[]): Promise<ProcessResult | { missing: true }> {
    try {
      return await runner(cmdArgs)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        stderr(YTDLP_MISSING)
        return { missing: true }
      }
      throw err
    }
  }

  async function fetchSubtitle(
    url: string,
    destOf: (channel: string) => string,
    fallbackTitle?: string,
  ): Promise<'halt' | 'stop' | 'next'> {
    const pRes = await runCmd(videoProbeArgs(url))
    if ('missing' in pRes) return 'halt'
    if (stopped) return 'stop'

    const probe = pRes.code === 0 ? parseVideoProbe(pRes.stdout) : null
    if (probe === null) {
      const reason = pRes.code !== 0 ? firstLine(pRes.stderr) : 'hiányzó videóazonosító'
      stdout(`[FAIL] ${url}: ${reason || 'hiányzó videóazonosító'}`)
      rows.push('failed')
      return 'next'
    }

    const title = probe.title?.split(/\r?\n/)[0]?.trim() || fallbackTitle?.split(/\r?\n/)[0]?.trim() || probe.id
    const lang = originalSubtitleLang(probe)
    const language = probe.language
    if (!language || !lang) {
      stdout(`[SKIP] Nincs felirat: ${title} [${probe.id}]`)
      rows.push('no-subtitle')
      return 'next'
    }

    const dest = destOf(probe.channel ?? '')
    if (!args.overwrite && (await alreadyFetched(dest, probe.id, [language]))) {
      stdout(`[SKIP] ${title} [${probe.id}]`)
      rows.push('skipped')
      return 'next'
    }

    if (!args.overwrite) await prepareIncomplete(dest, probe.id)

    const dlRes = await runCmd(
      downloadArgs({
        url,
        dest,
        languages: [lang],
        formats: args.subFormat,
        overwrite: args.overwrite,
      }),
    )
    if ('missing' in dlRes) return 'halt'
    if (stopped) return 'stop'

    const fetched = await alreadyFetched(dest, probe.id, [language])
    if (fetched) {
      stdout(`[OK]   ${title} [${probe.id}]`)
      rows.push('downloaded')
    } else if (dlRes.code === 0) {
      stdout(`[SKIP] Nincs felirat: ${title} [${probe.id}]`)
      rows.push('no-subtitle')
    } else {
      const errLine = firstLine(dlRes.stderr)
      stdout(`[FAIL] ${url}: ${errLine || 'letöltési hiba'}`)
      rows.push('failed')
    }
    return 'next'
  }

  try {
    const vRes = await runCmd(versionArgs())
    if ('missing' in vRes) {
      return 1
    }
    if (vRes.code !== 0) {
      const line = firstLine(vRes.stderr)
      stderr(line || 'A yt-dlp --version nem sikerült.')
      return 1
    }

    for (const raw of inputResult.lines) {
      if (stopped) break
      const classified = classifyInput(raw, args.yesPlaylist)
      if (classified.kind === 'rejected') {
        stdout(`[FAIL] ${classified.raw}: nem YouTube-cím`)
        rows.push('failed')
        continue
      }

      if (classified.kind === 'video') {
        const step = await fetchSubtitle(classified.url, (channel) => videoDir(out, channel, args.flat))
        if (step === 'halt') {
          if (rows.length > 0) stdout(summary(rows))
          return 1
        }
        if (step === 'stop') break
        continue
      }

      // classified.kind === 'playlist'
      const plRes = await runCmd(playlistProbeArgs(classified.url, args.playlistItems))
      if ('missing' in plRes) {
        if (rows.length > 0) stdout(summary(rows))
        return 1
      }
      if (stopped) break

      if (plRes.code !== 0) {
        const reason = firstLine(plRes.stderr) || 'ismeretlen hiba'
        stdout(`[FAIL] ${classified.url}: ${reason}`)
        rows.push('failed')
        continue
      }

      const probe = parsePlaylistProbe(plRes.stdout)
      if (probe === null) {
        stdout(`[FAIL] ${classified.url}: hiányzó listaazonosító`)
        rows.push('failed')
        continue
      }

      if (probe.entries.length === 0) {
        stdout(`[FAIL] ${classified.url}: a lista üres`)
        rows.push('failed')
        continue
      }

      const dest = playlistDir(out, probe.title ?? '', probe.id, args.flat)

      for (const entry of probe.entries) {
        if (stopped) break
        if (!entry.id) {
          stdout(`[FAIL] ${classified.url}: hiányzó videóazonosító`)
          rows.push('failed')
          continue
        }

        const videoUrl = `https://www.youtube.com/watch?v=${entry.id}`
        const step = await fetchSubtitle(videoUrl, () => dest, entry.title)
        if (step === 'halt') {
          if (rows.length > 0) stdout(summary(rows))
          return 1
        }
        if (step === 'stop') break
      }
    }

    return finish(rows, stopped, stdout)
  } finally {
    uninstall()
  }
}
