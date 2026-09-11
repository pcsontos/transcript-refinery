import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

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
})
