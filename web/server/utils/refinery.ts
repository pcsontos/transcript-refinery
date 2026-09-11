import { join } from 'node:path'
import { CONFIG_FILENAME, loadConfig, readConfigFile, type Config } from 'transcript-refinery'

/**
 * A konfiguráció, ahogy a gyökérből futtatott CLI is látja. A repó gyökere
 * build-időben rögzül (`nuxt.config.ts`); a fájl helyét a `REFINERY_CONFIG`
 * felülírhatja — a CLI `--config` kapcsolójának megfelelője. Beállítási értéket
 * környezeti változó nem ír felül.
 */
export async function useRefineryConfig(): Promise<Config> {
  const root = String(useRuntimeConfig().refineryRoot)
  const configPath = process.env.REFINERY_CONFIG ?? join(root, CONFIG_FILENAME)
  try {
    return loadConfig(await readConfigFile(configPath), configPath, root)
  } catch (error) {
    throw createError({ statusCode: 500, message: (error as Error).message })
  }
}

/**
 * Egy API-útvonal törzse: konfiguráció, a mag egy függvénye, és a mag hibája
 * olvasható 500-as válaszként. A már HTTP-hibaként dobott kivétel (például a
 * 404) változatlanul megy tovább.
 */
export async function coreHandler<T>(run: (cfg: Config) => T | Promise<T>): Promise<T> {
  const cfg = await useRefineryConfig()
  try {
    return await run(cfg)
  } catch (error) {
    if (typeof (error as { statusCode?: unknown }).statusCode === 'number') throw error
    throw createError({ statusCode: 500, message: (error as Error).message })
  }
}
