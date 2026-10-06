import { execFileSync } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import type { RunRuntime } from '../cli.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from '../vault/git.js'
import { runSummary } from './summary.js'

const execFileAsync = promisify(execFile)
const ID = 'abcdefghijk'

function client(calls: { generate: number }): ReturnType<RunRuntime['createClient'] & object> {
  return {
    generate() {
      calls.generate += 1
      return Promise.resolve({
        value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    },
    generateObject<T>() {
      return Promise.resolve({
        value: { score: 1, gaps: [] } as T,
        usage: { inputTokens: 5, outputTokens: 2 },
      })
    },
  }
}

function gitFor(remoteUrl: string, push: typeof gitPush = gitPush) {
  return {
    pull: gitPullFfOnly,
    commit: gitCommitPaths,
    push,
    remote: () => Promise.resolve(remoteUrl),
    branch: async (repo: string) => {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo })
      return stdout.trim()
    },
  }
}

async function scene(costLimitUsd = 5) {
  const root = await mkdtemp(join(tmpdir(), 'refinery-summary-'))
  const origin = join(root, 'origin.git')
  const vault = join(root, 'vault')
  const outDir = join(root, 'telegram')
  await mkdir(outDir, { recursive: true })
  await mkdir(join(root, 'state'), { recursive: true })
  await mkdir(join(root, 'logs'), { recursive: true })
  await writeFile(
    join(outDir, `Beszéd [${ID}].hu.vtt`),
    'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello from the video.\n',
  )
  await writeFile(
    join(outDir, `Beszéd [${ID}].info.json`),
    JSON.stringify({ id: ID, title: 'Beszéd', language: 'hu' }),
  )
  execFileSync('git', ['init', '-b', 'main', vault])
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: vault })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: vault })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: vault })
  execFileSync('git', ['init', '--bare', origin])
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: vault })
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: vault })
  const raw = {
    vault: { path: vault },
    sources: [outDir],
    state: { path: join(root, 'state', 'refinery.db') },
    logs: { dir: join(root, 'logs') },
    model: {
      base_url: 'http://localhost:4000/v1',
      draft: 'proba-draft',
      judge: 'proba-judge',
    },
    pricing: {
      'proba-draft': { input_per_million: 3, output_per_million: 15 },
      'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: costLimitUsd,
  }
  const load = () => Promise.resolve({ cfg: loadConfig(raw, join(root, 'refinery.config.yaml'), root), raw })
  return { root, vault, outDir, load }
}

describe('runSummary', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a jegyzet a vaultba kerül, a commit csak a két fájlt viszi, a link a summaryra mutat', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client(calls),
      load,
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.noteUrl).toBe(
      'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_summary.md',
    )
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: vault, encoding: 'utf8' })
    expect(names.trim().split('\n').sort()).toEqual([
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
    const second = { generate: 0 }
    const again = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client(second),
      load,
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(again).toEqual(result)
    expect(second.generate).toBe(0)
  })

  it('az idegen felirat nem hív modellt és nem kerül a commitba', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    await writeFile(
      join(outDir, 'Más [zzzzzzzzzzz].hu.vtt'),
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOther video.\n',
    )
    await writeFile(
      join(outDir, 'Más [zzzzzzzzzzz].info.json'),
      JSON.stringify({ id: 'zzzzzzzzzzz', title: 'Más', language: 'hu' }),
    )
    const calls = { generate: 0 }
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client(calls),
      load,
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(result.ok).toBe(true)
    expect(calls.generate).toBe(1)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'], {
      cwd: vault,
      encoding: 'utf8',
    })
    expect(names).not.toContain('zzzzzzzzzzz')
    expect(names.trim().split('\n').sort()).toEqual([
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
  })

  it('a git@ origin ugyanazt a linket adja', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitFor('git@github.com:tulaj/repo'),
    })
    expect(result).toEqual({
      ok: true,
      noteUrl:
        'https://github.com/tulaj/repo/blob/main/Inbox/transcript-refinery/telegram/Besz%C3%A9d%20%5Babcdefghijk%5D_summary.md',
    })
  })

  it('a nem GitHub originnak nincs linkje', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitFor('https://gitlab.com/tulaj/repo.git'),
    })
    expect(result).toEqual({ ok: false, error: 'A vault távoli címe nem GitHub-cím.' })
  })

  it('a pull hibája modellhívás nélkül megáll', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client(calls),
      load,
      git: { ...gitFor('https://github.com/tulaj/repo.git'), pull: () => Promise.reject(new Error('diverged')) },
    })
    expect(result).toEqual({ ok: false, error: 'A vault frissítése nem sikerült.' })
    expect(calls.generate).toBe(0)
  })

  it('a push hibája után a commit a gépen marad', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitFor('https://github.com/tulaj/repo.git', () => Promise.resolve({ pushed: false })),
    })
    expect(result).toEqual({ ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' })
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '-1', '--name-only', '--pretty=format:'], { cwd: vault, encoding: 'utf8' })
    expect(names.trim().split('\n').sort()).toEqual([
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
  })

  it('a plafon nulla modellhívással megáll', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene(0.0001)
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => client(calls),
      load,
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/^A futás megállt: már az első elem becsült költsége/)
    expect(calls.generate).toBe(0)
  })

  it('a recept hibája után az átirat megmarad', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => ({
        generate: () => Promise.reject(new Error('szimulált hiba')),
        generateObject: <T>() => Promise.resolve({ value: { score: 1, gaps: [] } as T, usage: { inputTokens: 1, outputTokens: 1 } }),
      }),
      load,
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(result).toEqual({ ok: false, error: 'szimulált hiba' })
    const transcript = join(vault, 'Inbox/transcript-refinery/telegram', `Beszéd [${ID}]_transcript.md`)
    expect(execFileSync('git', ['cat-file', '-e', `HEAD:${transcript.slice(vault.length + 1)}`], { cwd: vault, encoding: 'utf8' })).toBe('')
  })

  it('a config hibájának első sora megy ki, kliens nélkül', async () => {
    const { root, outDir } = await scene()
    roots.push(root)
    let created = 0
    const result = await runSummary({
      videoId: ID,
      outDir,
      createClient: () => {
        created += 1
        return client({ generate: 0 })
      },
      load: () => Promise.reject(new Error('Nincs konfigurációs fájl: x\nMásodik sor')),
      git: gitFor('https://github.com/tulaj/repo.git'),
    })
    expect(result).toEqual({ ok: false, error: 'Nincs konfigurációs fájl: x' })
    expect(created).toBe(0)
  })
})
