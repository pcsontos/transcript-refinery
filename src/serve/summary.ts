import { execFile } from 'node:child_process'
import { access, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { commandRun, type RunRuntime } from '../cli.js'
import { loadCliConfig, type Config } from '../config.js'
import type { LanguageTag } from '../lang/identify.js'
import { recipesFor } from '../recipe/registry.js'
import { splitSubtitleName } from '../source/folder.js'
import type { SourceItem } from '../types.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from '../vault/git.js'
import { noteFile } from '../vault/paths.js'
import type { RecipesOutcome } from './job.js'
import { githubNoteUrl } from './note-url.js'

const exec = promisify(execFile)

type SummaryGit = {
  pull(repo: string): Promise<void>
  commit(repo: string, paths: readonly string[], message: string): Promise<boolean>
  push(repo: string): Promise<{ pushed: boolean }>
  remote(repo: string): Promise<string>
  branch(repo: string): Promise<string>
}

const defaultGit: SummaryGit = {
  pull: gitPullFfOnly,
  commit: gitCommitPaths,
  push: gitPush,
  async remote(repo) {
    const { stdout } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: repo })
    return stdout.trim()
  },
  async branch(repo) {
    const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })
    return stdout.trim()
  },
}

type RunEvent = { type?: string; reason?: string; spentUsd?: number; limitUsd?: number; error?: string }

function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim() !== '')
  return line?.trim() ?? ''
}

async function logNames(logsDir: string): Promise<string[]> {
  try {
    return (await readdir(logsDir)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
}

/**
 * Az e futás alatt született napló eseményei. Név szerint nem lehet a legutolsót
 * venni: egy másodpercen belüli második futás `<id>-2.jsonl`, ami a `<id>.jsonl` elé rendeződik.
 */
async function runEvents(logsDir: string, before: ReadonlySet<string>): Promise<RunEvent[]> {
  const latest = (await logNames(logsDir)).find((name) => !before.has(name))
  if (latest === undefined) return []
  const text = await readFile(join(logsDir, latest), 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RunEvent)
}

/** A futás naplójából a Telegramnak szóló mondat: plafon, hiba, kihagyás, ebben a sorrendben. */
function failureLine(events: readonly RunEvent[], fallback: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'run:aborted' && typeof event.reason === 'string') {
      const spent = typeof event.spentUsd === 'number' ? event.spentUsd : 0
      const limit = typeof event.limitUsd === 'number' ? event.limitUsd : 0
      return `A futás megállt: ${event.reason} (${spent.toFixed(4)} $ / ${limit.toFixed(4)} $)`
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'item:failed' && typeof event.error === 'string') {
      const line = firstLine(event.error)
      return line === '' ? fallback : line
    }
  }
  const skipped = events.findLast((event) => event.type === 'item:skipped' && typeof event.reason === 'string')
  return skipped?.reason ?? fallback
}

async function keepThisVideo(outDir: string, videoId: string): Promise<void> {
  const names = await readdir(outDir)
  await Promise.all(
    names
      .filter((name) => !name.includes(videoId))
      .map((name) => rm(join(outDir, name), { recursive: true, force: true })),
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function runRecipes(input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
  createClient?: RunRuntime['createClient']
  git?: SummaryGit
  load?: () => Promise<{ cfg: Config; raw: unknown }>
}): Promise<RecipesOutcome> {
  const git = input.git ?? defaultGit
  let loaded: { cfg: Config; raw: unknown }
  try {
    loaded = input.load ? await input.load() : await loadCliConfig(undefined)
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    return { ok: false, error: message === '' ? 'A futás megállt.' : message }
  }
  try {
    await git.pull(loaded.cfg.vaultPath)
  } catch {
    return { ok: false, error: 'A vault frissítése nem sikerült.' }
  }
  const lang = input.lang
  const cfg: Config = {
    ...loaded.cfg,
    sources: [{ name: basename(input.outDir), path: input.outDir }],
    // A célnyelv a kérésé, nem a configé: a futás idejére a kért forrásokból lesz fordítórecept.
    ...(lang === undefined ? {} : { translate: { to: lang, recipes: [...input.recipes] } }),
  }
  const ids = lang === undefined ? [...input.recipes] : input.recipes.map((id) => `${id}-${lang}`)
  await keepThisVideo(input.outDir, input.videoId)
  const logsBefore = new Set(await logNames(cfg.logsDir))
  const code = await commandRun(
    cfg,
    loaded.raw,
    { recipes: ids, dryRun: false, force: false, commit: false, command: 'serve recipes' },
    { createClient: input.createClient },
  )
  const events = await runEvents(cfg.logsDir, logsBefore)
  const names = await readdir(input.outDir)
  const fileName = names.find((name) => {
    const parsed = splitSubtitleName(name)
    return parsed !== null && parsed.base.includes(input.videoId)
  })
  const parsed = fileName === undefined ? null : splitSubtitleName(fileName)
  let transcriptPath: string | null = null
  const notePaths: string[] = []
  if (fileName !== undefined && parsed !== null) {
    const item: SourceItem = {
      itemId: input.videoId,
      source: basename(input.outDir),
      sourceFile: fileName,
      subtitlePath: join(input.outDir, fileName),
      baseName: parsed.base,
      title: parsed.base,
      language: parsed.language,
      metadata: {},
    }
    const registry = recipesFor(cfg)
    transcriptPath = noteFile(cfg.notesRoot, item, '_transcript.md')
    for (const id of ids) notePaths.push(noteFile(cfg.notesRoot, item, registry[id]!.outputFile))
  }
  const paths: string[] = []
  for (const path of transcriptPath === null ? [] : [transcriptPath, ...notePaths]) {
    if (await exists(path)) paths.push(path)
  }
  if (paths.length > 0) {
    await git.commit(cfg.vaultPath, paths, 'docs(transcript-refinery): átirat 1 videóhoz')
  }
  const pushed = await git.push(cfg.vaultPath)
  if (!pushed.pushed) return { ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' }
  if (code !== 0) return { ok: false, error: failureLine(events, 'A futás megállt.') }
  if (transcriptPath === null) return { ok: false, error: 'A jegyzet nem készült el.' }
  for (const path of notePaths) {
    if (!(await exists(path))) return { ok: false, error: failureLine(events, 'A jegyzet nem készült el.') }
  }
  const vaultRelative = relative(cfg.vaultPath, transcriptPath).split(sep).join('/')
  const noteUrl = githubNoteUrl(await git.remote(cfg.vaultPath), await git.branch(cfg.vaultPath), vaultRelative)
  if (noteUrl === null) return { ok: false, error: 'A vault távoli címe nem GitHub-cím.' }
  return { ok: true, noteUrl }
}
