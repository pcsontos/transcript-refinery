import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface PushResult {
  pushed: boolean
  reason?: string
}

/**
 * Futás előtti frissítés. Szándékosan `--ff-only`: ha a történet divergált,
 * inkább hasaljon el itt, mint hogy a publisher egy elavult fára írjon.
 * `timeoutMs` után a git folyamat a gyerekeivel (fetch, ssh) együtt leáll, és a
 * hívás hibát dob.
 */
export async function gitPullFfOnly(repo: string, timeoutMs?: number): Promise<void> {
  if (timeoutMs === undefined) {
    await run('git', ['pull', '--ff-only'], { cwd: repo })
    return
  }
  await new Promise<void>((resolve, reject) => {
    // Külön folyamatcsoport (az `execFile` a `detached` kapcsolót nem veszi át): lejáratkor
    // a pull alatt futó fetch és ssh is leáll, nem csak a pull maga.
    const child = spawn('git', ['pull', '--ff-only'], { cwd: repo, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(expired ? `git pull: időtúllépés (${timeoutMs} ms)` : `git pull: ${stderr.trim() || `kilépési kód ${code}`}`))
    })
  })
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

/** A HEAD rövid hashe — a watch ezzel jelzi a commitot a terminálon. */
export async function gitHeadShort(repo: string): Promise<string> {
  const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo })
  return stdout.trim()
}
