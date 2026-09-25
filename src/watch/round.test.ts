import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { COMMIT_SCOPE } from '../meta.js'
import { queuePath } from '../queue/file.js'
import { RECIPES } from '../recipe/registry.js'
import { watchRound } from './round.js'

const git = promisify(execFile)

const SRT = '1\n00:00:00,000 --> 00:00:02,000\nThis is a test sentence for the probe.\n'

let work: string
let downloads: string
let vault: string
let cfg: Config
let lines: string[]

async function felirat(channel: string, title: string, body: string = SRT): Promise<string> {
  const dir = join(downloads, channel)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${title}.en.srt`)
  await writeFile(path, body, 'utf8')
  return path
}

async function atiratok(): Promise<string[]> {
  const all = await readdir(cfg.notesRoot, { recursive: true })
  return all.filter((p) => p.endsWith('_transcript.md'))
}

const round = (changed: ReadonlySet<string> | null, commit = false) =>
  watchRound({ cfg, registry: RECIPES, sources: cfg.sources, commit, changed, out: (l) => lines.push(l) })

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-watch-'))
  downloads = join(work, 'letoltes')
  vault = join(work, 'vault')
  await mkdir(downloads, { recursive: true })
  await mkdir(vault, { recursive: true })
  cfg = loadConfig(
    { vault: { path: vault }, sources: [downloads], state: { path: join(work, 'state.db') } },
    join(work, 'c.yaml'),
    work,
  )
  lines = []
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('watchRound', () => {
  it('az új feliratból átirat és queue-sor lesz, és mindkettőről egy sor megy ki', async () => {
    await felirat('Csatorna', 'Egy videó')
    const result = await round(null)

    expect(result.transcripts).toBe(1)
    expect(await atiratok()).toHaveLength(1)
    expect(await readFile(queuePath(cfg.notesRoot), 'utf8')).toContain('Egy videó')
    expect(lines.some((l) => l.startsWith('új átirat: ') && l.includes('Egy videó') && l.includes('(en)'))).toBe(true)
    expect(lines.some((l) => l.startsWith('_queue.md frissítve: +1 elem'))).toBe(true)
  })

  it('a már kész elemet nem dolgozza fel újra, és változatlan sornál nem ír ki semmit', async () => {
    await felirat('Csatorna', 'Egy videó')
    await round(null)
    lines = []
    const result = await round(null)
    expect(result.transcripts).toBe(0)
    expect(result.queueChanged).toBe(false)
    expect(lines).toEqual([])
  })

  it('a hibás feliratot jelzi, a többit feldolgozza', async () => {
    await felirat('Csatorna', 'Hibás', '')
    await felirat('Csatorna', 'Jó')
    const result = await round(null)
    expect(result.failed).toBe(1)
    expect(result.transcripts).toBe(1)
    expect(lines.some((l) => l.startsWith('hiba: ') && l.includes('Hibás'))).toBe(true)
  })

  it('a korábban elbukott elemet csak akkor próbálja újra, ha a fájlja változott', async () => {
    const hibas = await felirat('Csatorna', 'Hibás', '')
    await round(null)
    lines = []

    await round(new Set())
    expect(lines.filter((l) => l.startsWith('hiba: '))).toEqual([])

    await writeFile(hibas, SRT, 'utf8')
    const result = await round(new Set([hibas]))
    expect(result.transcripts).toBe(1)
  })
})

describe('watchRound — commit', () => {
  let remote: string

  beforeEach(async () => {
    remote = join(work, 'remote.git')
    await git('git', ['init', '-q', '--bare', remote])
    await rm(vault, { recursive: true, force: true })
    await git('git', ['clone', '-q', remote, vault])
    await git('git', ['-C', vault, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'init'])
    await git('git', ['-C', vault, 'push', '-q', 'origin', 'HEAD'])
    await git('git', ['-C', vault, 'config', 'user.email', 'a@b'])
    await git('git', ['-C', vault, 'config', 'user.name', 'a'])
  })

  it('a jegyzeteket és a sort egy commitban viszi, a hash-sel és a push eredményével', async () => {
    await felirat('Csatorna', 'Egy videó')
    const result = await round(null, true)

    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(lines.some((l) => l === `commit: ${result.commit!} (push ok)`)).toBe(true)
    const { stdout } = await git('git', ['-C', vault, 'show', '--name-only', '--format=%s', 'HEAD'])
    expect(stdout).toContain('_transcript.md')
    expect(stdout).toContain('_queue.md')
    expect(stdout.split('\n')[0]).toBe(`docs(${COMMIT_SCOPE}): watch — átirat 1 videóhoz`)
  })

  it('ha csak a sor változott, a commit üzenete nem „átirat 0 videóhoz"', async () => {
    await felirat('Csatorna', 'Egy videó')
    // Commit nélkül: az átirat kész, de függő commitként sem marad meg.
    await round(null, false)
    await rm(queuePath(cfg.notesRoot))
    const result = await round(null, true)

    expect(result.transcripts).toBe(0)
    expect(result.commit).toMatch(/^[0-9a-f]{7,}$/)
    const { stdout } = await git('git', ['-C', vault, 'show', '--name-only', '--format=%s', 'HEAD'])
    expect(stdout.split('\n')[0]).toBe(`docs(${COMMIT_SCOPE}): watch — feldolgozási sor frissítése`)
    expect(stdout).not.toContain('_transcript.md')
    expect(stdout).toContain('_queue.md')
  })
})
