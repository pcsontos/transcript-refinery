import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
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
