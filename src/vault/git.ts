import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface PushResult {
  pushed: boolean
  reason?: string
}

/**
 * Futás előtti frissítés. Szándékosan `--ff-only`: ha a történet divergált,
 * inkább hasaljon el itt, mint hogy a publisher egy elavult fára írjon.
 */
export async function gitPullFfOnly(repo: string): Promise<void> {
  await run('git', ['pull', '--ff-only'], { cwd: repo })
}

/** Van-e bármilyen követetlen vagy módosított fájl a munkafában? */
export async function isDirty(repo: string): Promise<boolean> {
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: repo })
  return stdout.trim() !== ''
}

/**
 * Kizárólag a megadott útvonalakat stage-eli és commitolja. Soha nem
 * `git add -A` — így képtelen felsöpörni a félbehagyott kézi szerkesztéseket.
 * `false`-t ad, ha nem volt mit commitolni.
 */
export async function gitCommitPaths(
  repo: string,
  paths: readonly string[],
  message: string,
): Promise<boolean> {
  if (paths.length === 0) return false
  await run('git', ['add', '--', ...paths], { cwd: repo })
  const { stdout } = await run('git', ['diff', '--cached', '--name-only'], { cwd: repo })
  if (stdout.trim() === '') return false
  await run('git', ['commit', '-m', message], { cwd: repo })
  return true
}

/**
 * Push a távolira. Elhasalás esetén **nincs force és nincs
 * újrapróbálkozás** — a commit lokálisan marad, a hívó jelenti, és a
 * következő futás előtti pull rendezi.
 */
export async function gitPush(repo: string): Promise<PushResult> {
  try {
    await run('git', ['push'], { cwd: repo })
    return { pushed: true }
  } catch (error) {
    return { pushed: false, reason: (error as Error).message }
  }
}
