import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const TSX = join('node_modules', '.bin', 'tsx')

/**
 * A `main()` csak akkor fut le, ha a fájlt tényleg belépési pontként hívták
 * meg — importként (a tesztek `commandRun`/`main`-t importálják) nem szabad
 * mellékhatást kiváltania. Ezt csak valódi alfolyamat-indítással lehet
 * leellenőrizni: az `import.meta.url`/`process.argv[1]` egyszer, modulbetöltéskor
 * értékelődik ki, egy már importált modulon belül nem szimulálható újra.
 */
describe('cli belépési pont', () => {
  it('tsx-szel, forrásból (.ts) meghívva is lefut a main() — nem csak dist/cli.js néven', async () => {
    // A `--help` a config beolvasása előtt visszatér (lásd `main()` eleje),
    // tehát a teszt hermetikus: friss klónon, config nélkül is lefut.
    const { stdout } = await run(TSX, ['src/cli.ts', '--help'])
    expect(stdout).toContain('refinery <parancs>')
    expect(stdout).toContain('--no-judge')
    expect(stdout).toContain('--fix')
    expect(stdout).toContain('--help, -h')
  })

  it('alparancs után megadott --help kapcsolóval is a teljes súgót adja', async () => {
    const { stdout } = await run(TSX, ['src/cli.ts', 'run', '--help'])
    expect(stdout).toContain('refinery <parancs>')
    expect(stdout).toContain('--no-judge')
    expect(stdout).toContain('--fix')
  })

  describe('szimlinken át meghívva', () => {
    let dir: string | undefined

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
      dir = undefined
    })

    it('npm/pnpm bin-szimlinken át hívva is lefut a main()', async () => {
      // Az `import.meta.url` a Node ESM-loaderében szimlinkeken átkövetkezik
      // (a valódi fájlra mutat), a `process.argv[1]` viszont a hívási
      // útvonalat őrzi — ez pontosan az a helyzet, amit egy `node_modules/.bin`
      // alatti bin-szimlink (pl. `pnpm exec refinery`) előidéz.
      dir = await mkdtemp(join(tmpdir(), 'refinery-entrypoint-'))
      const link = join(dir, 'cli-link.ts')
      await symlink(resolve('src/cli.ts'), link)

      const { stdout } = await run(TSX, [link, '--help'])
      expect(stdout).toContain('refinery <parancs>')
    })
  })
})

describe('más munkakönyvtárból, --config-gal indítva', () => {
  let work: string | undefined

  afterEach(async () => {
    if (work) await rm(work, { recursive: true, force: true })
    work = undefined
  })

  it('az állapottár és a napló a config mellé kerül, a munkakönyvtárban nem jön létre .state', async () => {
    work = await mkdtemp(join(tmpdir(), 'refinery-cwd-'))
    const projekt = join(work, 'projekt')
    const mashol = join(work, 'mashol')
    const vault = join(work, 'vault')
    const letoltes = join(work, 'letoltes', 'Csatorna')
    await mkdir(projekt, { recursive: true })
    await mkdir(mashol, { recursive: true })
    await mkdir(letoltes, { recursive: true })
    await mkdir(vault, { recursive: true })
    await run('git', ['init', '-q'], { cwd: vault })
    await writeFile(
      join(letoltes, 'Egy videó.en.srt'),
      '1\n00:00:00,000 --> 00:00:02,000\nThis is a test sentence for the probe.\n',
      'utf8',
    )
    await writeFile(
      join(projekt, 'refinery.config.yaml'),
      `vault:\n  path: ${vault}\nsources:\n  - ${join(work, 'letoltes')}\n`,
      'utf8',
    )

    await run(
      resolve(TSX),
      [resolve('src/cli.ts'), 'run', '--dry-run', '--config', join(projekt, 'refinery.config.yaml')],
      { cwd: mashol },
    )

    expect(existsSync(join(projekt, '.state', 'refinery.db'))).toBe(true)
    expect(existsSync(join(projekt, 'logs'))).toBe(true)
    expect(existsSync(join(mashol, '.state'))).toBe(false)
    expect(existsSync(join(mashol, 'logs'))).toBe(false)
  })
})
