import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { gitCommitPaths, gitHeadShort, gitPullFfOnly, isDirty } from './git.js'

const run = promisify(execFile)
let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'refinery-git-'))
  await run('git', ['init', '-b', 'main'], { cwd: repo })
  await run('git', ['config', 'user.email', 'teszt@example.com'], { cwd: repo })
  await run('git', ['config', 'user.name', 'Teszt'], { cwd: repo })
  await writeFile(join(repo, 'alap.txt'), 'alap', 'utf8')
  await run('git', ['add', 'alap.txt'], { cwd: repo })
  await run('git', ['commit', '-m', 'alap'], { cwd: repo })
})

describe('gitCommitPaths', () => {
  it('csak a megadott útvonalakat commitolja', async () => {
    await writeFile(join(repo, 'gepi.md'), 'gépi', 'utf8')
    await writeFile(join(repo, 'kezi.md'), 'félbehagyott kézi munka', 'utf8')

    const committed = await gitCommitPaths(repo, ['gepi.md'], 'docs: gépi')
    expect(committed).toBe(true)

    const { stdout } = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
    expect(stdout.trim().split('\n')).toEqual(['gepi.md'])
  })

  it('a nem commitolt kézi fájl a munkafában marad', async () => {
    await writeFile(join(repo, 'gepi.md'), 'gépi', 'utf8')
    await writeFile(join(repo, 'kezi.md'), 'kézi', 'utf8')
    await gitCommitPaths(repo, ['gepi.md'], 'docs: gépi')
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd: repo })
    expect(stdout).toContain('kezi.md')
  })

  it('üres útvonallistára nem hoz létre commitot', async () => {
    expect(await gitCommitPaths(repo, [], 'docs: semmi')).toBe(false)
  })

  it('változatlan fájlra nem hoz létre üres commitot', async () => {
    expect(await gitCommitPaths(repo, ['alap.txt'], 'docs: semmi')).toBe(false)
  })
})

describe('isDirty', () => {
  it('tisztának látja a friss repót', async () => {
    expect(await isDirty(repo)).toBe(false)
  })

  it('piszkosnak látja, ha van követetlen fájl', async () => {
    await writeFile(join(repo, 'uj.md'), 'x', 'utf8')
    expect(await isDirty(repo)).toBe(true)
  })
})

describe('gitHeadShort', () => {
  it('gitHeadShort a HEAD rövid hashét adja', async () => {
    const hash = await gitHeadShort(repo)
    expect(hash).toMatch(/^[0-9a-f]{7,}$/)
  })
})

describe('gitPullFfOnly időkorlát', () => {
  it('időkorláttal is lefut a sikeres pull, és a hibás pull a git üzenetével bukik', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-pull-ok-'))
    const origin = join(dir, 'origin.git')
    const repo = join(dir, 'repo')
    await run('git', ['init', '--bare', '-b', 'main', origin])
    await run('git', ['clone', origin, repo])
    await run('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-m', 'init'], { cwd: repo })
    await run('git', ['push', '-u', 'origin', 'main'], { cwd: repo })
    await expect(gitPullFfOnly(repo, 5000)).resolves.toBeUndefined()
    const alone = join(dir, 'alone')
    await run('git', ['init', '-b', 'main', alone])
    await expect(gitPullFfOnly(alone, 5000)).rejects.toThrow(/git pull:/)
  })

  it('lejáratkor a git gyerekfolyamatait is leállítja, nem csak a pull-t', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'refinery-pull-'))
    const pidFile = join(dir, 'pid')
    const ssh = join(dir, 'ssh.sh')
    // Az „ssh” felír a pidfile-ba és lógva marad: egy beragadt hálózat.
    await writeFile(ssh, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`, { mode: 0o755 })
    const repo = join(dir, 'repo')
    await run('git', ['init', '-b', 'main', repo])
    await run('git', ['remote', 'add', 'origin', 'ssh://vault.invalid/x.git'], { cwd: repo })
    await run('git', ['config', 'branch.main.remote', 'origin'], { cwd: repo })
    await run('git', ['config', 'branch.main.merge', 'refs/heads/main'], { cwd: repo })
    const before = process.env.GIT_SSH_COMMAND
    process.env.GIT_SSH_COMMAND = ssh
    let pid = 0
    try {
      await expect(gitPullFfOnly(repo, 1500)).rejects.toThrow()
      pid = Number((await readFile(pidFile, 'utf8')).trim())
      expect(pid).toBeGreaterThan(0)
      const alive = () => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      for (let tries = 0; tries < 20 && alive(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(alive()).toBe(false)
    } finally {
      if (before === undefined) delete process.env.GIT_SSH_COMMAND
      else process.env.GIT_SSH_COMMAND = before
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // már leállt
        }
      }
    }
  })
})
