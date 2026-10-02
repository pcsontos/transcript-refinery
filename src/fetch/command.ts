import { mkdir, stat } from 'node:fs/promises'
import { loadCliConfig } from '../config.js'
import { installSigint } from '../run/finish.js'
import { classifyInput } from './classify.js'
import { parseSubtitleArgs } from './subtitle/args.js'
import { alreadyFetched, prepareIncomplete, videoDir } from './subtitle/skip.js'
import {
  createYtdlpRunner,
  downloadArgs,
  parseVideoProbe,
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

  if (
    args.listPath !== undefined ||
    (args.inputs[0] !== undefined && classifyInput(args.inputs[0], args.yesPlaylist).kind === 'playlist')
  ) {
    stderr('A lista a következő feladat.')
    return 1
  }

  let out: string
  let languages: string[]
  if (args.out !== undefined && args.subLang !== undefined && args.config === undefined) {
    out = args.out
    languages = args.subLang
  } else {
    let loaded
    try {
      loaded = await loadCliConfig(args.config)
    } catch (error) {
      stderr((error as Error).message)
      return 1
    }
    const cfg = loaded.cfg
    const resolvedOut = args.out ?? cfg.sources[0]?.path
    if (!resolvedOut) {
      stderr('Nincs célmappa: adj meg --out kapcsolót vagy config sources elemet.')
      return 1
    }
    out = resolvedOut
    languages = args.subLang ?? (cfg.languages && cfg.languages.length > 0 ? cfg.languages : ['hu', 'en'])
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

    const inputUrl = args.inputs[0]!
    const classified = classifyInput(inputUrl, args.yesPlaylist)
    if (classified.kind === 'rejected') {
      stdout(`[FAIL] ${classified.raw}: nem YouTube-cím`)
      rows.push('failed')
      return finish(rows, stopped, stdout)
    }

    const pRes = await runCmd(videoProbeArgs(classified.url))
    if ('missing' in pRes) {
      if (rows.length > 0) stdout(summary(rows))
      return 1
    }
    const probe = pRes.code === 0 ? parseVideoProbe(pRes.stdout) : null
    if (probe === null) {
      const reason = pRes.code !== 0 ? firstLine(pRes.stderr) : 'hiányzó videóazonosító'
      stdout(`[FAIL] ${classified.url}: ${reason || 'hiányzó videóazonosító'}`)
      rows.push('failed')
      return finish(rows, stopped, stdout)
    }

    const title = probe.title?.split(/\r?\n/)[0]?.trim() || probe.id
    const dest = videoDir(out, probe.channel ?? '', args.flat)

    if (!args.overwrite && (await alreadyFetched(dest, probe.id, languages))) {
      stdout(`[SKIP] ${title} [${probe.id}]`)
      rows.push('skipped')
      return finish(rows, stopped, stdout)
    }

    if (!args.overwrite) {
      await prepareIncomplete(dest, probe.id)
    }

    const dlRes = await runCmd(
      downloadArgs({
        url: classified.url,
        dest,
        languages,
        formats: args.subFormat,
        overwrite: args.overwrite,
      }),
    )
    if ('missing' in dlRes) {
      if (rows.length > 0) stdout(summary(rows))
      return 1
    }

    const fetched = await alreadyFetched(dest, probe.id, languages)
    if (fetched) {
      stdout(`[OK]   ${title} [${probe.id}]`)
      rows.push('downloaded')
    } else if (dlRes.code === 0) {
      stdout(`[SKIP] Nincs felirat: ${title} [${probe.id}]`)
      rows.push('no-subtitle')
    } else {
      const errLine = firstLine(dlRes.stderr)
      stdout(`[FAIL] ${classified.url}: ${errLine || 'letöltési hiba'}`)
      rows.push('failed')
    }

    return finish(rows, stopped, stdout)
  } finally {
    uninstall()
  }
}
