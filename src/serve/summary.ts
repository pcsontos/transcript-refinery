import { execFile } from 'node:child_process'
import { access, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { commandRun, type RunRuntime } from '../cli.js'
import { loadCliConfig, type Config } from '../config.js'
import { splitSubtitleName } from '../source/folder.js'
import type { SourceItem } from '../types.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from '../vault/git.js'
import { noteFile } from '../vault/paths.js'
import type { SummaryOutcome } from './job.js'
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

function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim() !== '')
  return line?.trim() ?? ''
}

async function failureLine(logsDir: string): Promise<string> {
  let names: string[]
  try {
    names = (await readdir(logsDir)).filter((name) => name.endsWith('.jsonl')).sort()
  } catch {
    return 'A futás megállt.'
  }
  const latest = names.at(-1)
  if (latest === undefined) return 'A futás megállt.'
  const text = await readFile(join(logsDir, latest), 'utf8')
  const events = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { type?: string; reason?: string; spentUsd?: number; limitUsd?: number; error?: string })
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
      return line === '' ? 'A futás megállt.' : line
    }
  }
  return 'A futás megállt.'
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

export async function runSummary(input: {
  videoId: string
  outDir: string
  createClient?: RunRuntime['createClient']
  git?: SummaryGit
  load?: () => Promise<{ cfg: Config; raw: unknown }>
}): Promise<SummaryOutcome> {
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
  const cfg: Config = {
    ...loaded.cfg,
    sources: [{ name: basename(input.outDir), path: input.outDir }],
  }
  await keepThisVideo(input.outDir, input.videoId)
  const code = await commandRun(
    cfg,
    loaded.raw,
    { recipe: 'summary', dryRun: false, force: false, commit: false, command: 'serve summary' },
    { createClient: input.createClient },
  )
  const failed = code === 0 ? null : await failureLine(cfg.logsDir)
  const names = await readdir(input.outDir)
  const fileName = names.find((name) => {
    const parsed = splitSubtitleName(name)
    return parsed !== null && parsed.base.includes(input.videoId)
  })
  const parsed = fileName === undefined ? null : splitSubtitleName(fileName)
  const paths: string[] = []
  let summaryPath: string | null = null
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
    const transcriptPath = noteFile(cfg.notesRoot, item, '_transcript.md')
    summaryPath = noteFile(cfg.notesRoot, item, '_summary.md')
    if (await exists(transcriptPath)) paths.push(transcriptPath)
    if (await exists(summaryPath)) paths.push(summaryPath)
  }
  if (paths.length > 0) {
    await git.commit(cfg.vaultPath, paths, 'docs(transcript-refinery): átirat 1 videóhoz')
  }
  const pushed = await git.push(cfg.vaultPath)
  if (!pushed.pushed) return { ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' }
  if (failed !== null) return { ok: false, error: failed }
  if (summaryPath === null || !(await exists(summaryPath))) return { ok: false, error: 'A jegyzet nem készült el.' }
  const vaultRelative = relative(cfg.vaultPath, summaryPath).split(sep).join('/')
  const noteUrl = githubNoteUrl(await git.remote(cfg.vaultPath), await git.branch(cfg.vaultPath), vaultRelative)
  if (noteUrl === null) return { ok: false, error: 'A vault távoli címe nem GitHub-cím.' }
  return { ok: true, noteUrl }
}
