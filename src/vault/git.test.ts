import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { gitCommitPaths, isDirty } from './git.js'

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
