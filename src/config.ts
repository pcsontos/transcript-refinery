import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { ModelRole } from './types.js'

/** A konfigurációs fájl alapértelmezett neve a projekt gyökerében. */
export const CONFIG_FILENAME = 'refinery.config.yaml'

/**
 * A vaulton belüli jegyzet-gyűjtemény, ha a YAML nem mond mást. Egyetlen
 * helyen él: az alapértelmezés szétszórása azt jelentené, hogy két helyen
 * kellene átírni, és az egyik előbb-utóbb kimaradna.
 */
export const DEFAULT_NOTES_DIR = 'Inbox/transcript-refinery'

/**
 * Betölti az `.env`-et, ha létezik. **Egyetlen** értéket hoz: a
 * `LITELLM_API_KEY`-t — minden más beállítás a YAML-ból jön.
 *
 * A hiányzó fájl nem hiba: CI-ban a környezet közvetlenül van beállítva.
 * Minden más hiba (például szintaktikai) viszont felszínre jön, mert egy
 * csendben elnyelt elgépelés órákat visz el.
 */
export function loadDotEnv(path = join(process.cwd(), '.env')): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const absolutePath = (label: string) =>
  z
    .string()
    .min(1, `A ${label} kötelező.`)
    .refine(isAbsolute, `A ${label} abszolút útvonal kell legyen.`)

const CoreSchema = z.object({
  vault: z.object({
    path: absolutePath('vault.path'),
    notes_dir: z.string().min(1).default(DEFAULT_NOTES_DIR),
  }),
  sources: z
    .array(absolutePath('sources eleme'))
    .min(1, 'Legalább egy forrásmappa kell.'),
  languages: z.array(z.string().min(1)).default([]),
  state: z
    .object({ path: z.string().min(1) })
    .default({ path: join('.state', 'refinery.db') }),
})

/** Egy feliratforrás: a YAML-beli útvonal és a belőle képzett név. */
export interface SourceDir {
  /** Az útvonal utolsó szegmense; ez lesz a vault-beli almappa neve. */
  name: string
  path: string
}

export interface Config {
  /** A betöltött konfigurációs fájl útvonala — a hibaüzenetek ezt nevezik meg. */
  configPath: string
  vaultPath: string
  notesRoot: string
  sources: SourceDir[]
  /** Nyelvi preferencia-sorrend; üres lista esetén a determinisztikus tartalék dönt. */
  languages: string[]
  statePath: string
}

/** A zod hibáját a mező útjával és a konfigurációs fájllal együtt dobja tovább. */
function fail(error: z.ZodError, configPath: string): never {
  const first = error.issues[0]!
  const path = first.path.join('.') || 'konfiguráció'
  throw new Error(`${path}: ${first.message} (${configPath})`)
}

/**
 * Beolvassa és YAML-ként értelmezi a konfigurációs fájlt. Szándékosan nem
 * validál: a séma-ellenőrzés a `loadConfig` és a `loadModelConfig` dolga,
 * hogy a modellréteg hiánya ne akadályozza a `scan`-t.
 */
export async function readConfigFile(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Nincs konfigurációs fájl: ${path}\n` +
          `Másold le a refinery.config.example.yaml-t, vagy add meg a --config kapcsolóval.`,
        { cause: error },
      )
    }
    throw error
  }
  try {
    return parseYaml(text) as unknown
  } catch (error) {
    throw new Error(
      `A konfigurációs fájl nem értelmezhető YAML: ${path} — ${(error as Error).message}`,
      { cause: error },
    )
  }
}

/** YAML → konfiguráció. Fájlrendszertől független, hogy tesztelhető legyen. */
export function loadConfig(raw: unknown, configPath: string): Config {
  const parsed = CoreSchema.safeParse(raw)
  if (!parsed.success) fail(parsed.error, configPath)
  const c = parsed.data
  return {
    configPath,
    vaultPath: c.vault.path,
    notesRoot: join(c.vault.path, c.vault.notes_dir),
    sources: c.sources.map((p) => ({ name: basename(p), path: p })),
    languages: c.languages,
    statePath: resolve(process.cwd(), c.state.path),
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Indulási feltételek ellenőrzése. A program nem indul el, ha a vault nem
 * elérhető vagy nem git-repó — a publisher git-műveletei enélkül elhasalnának
 * a futás közepén —, és akkor sem, ha egy megadott forrásmappa nem létezik:
 * az elgépelt útvonal némán nulla elemet adna.
 */
export async function validateConfig(cfg: Config): Promise<void> {
  if (!(await isDirectory(cfg.vaultPath))) {
    throw new Error(`vault.path: nem létező mappa: ${cfg.vaultPath} (${cfg.configPath})`)
  }
  if (!(await isDirectory(join(cfg.vaultPath, '.git')))) {
    throw new Error(`vault.path: nem git-repó: ${cfg.vaultPath} (${cfg.configPath})`)
  }
  for (const source of cfg.sources) {
    if (!(await isDirectory(source.path))) {
      throw new Error(`sources: nem létező mappa: ${source.path} (${cfg.configPath})`)
    }
  }
}

const PriceSchema = z.object({
  input_per_million: z.coerce.number().nonnegative(),
  output_per_million: z.coerce.number().nonnegative(),
})

const ModelSchema = z.object({
  model: z.object({
    base_url: z.url('A model.base_url érvényes URL kell legyen.'),
    draft: z.string().min(1, 'A model.draft kötelező.'),
    judge: z.string().min(1, 'A model.judge kötelező.'),
  }),
  pricing: z.object({ draft: PriceSchema, judge: PriceSchema }),
  cost_limit_usd: z.coerce
    .number()
    .positive('Kötelező és pozitív: köteg nem indul felső korlát nélkül.'),
})

/** USD egymillió tokenre vetítve. */
export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
}

export interface ModelConfig {
  baseUrl: string
  apiKey: string
  models: Record<ModelRole, string>
  pricing: Record<ModelRole, ModelPricing>
  /** Futásonkénti felső korlát dollárban. */
  costLimitUsd: number
}

/**
 * A modellréteg konfigurációja — **szándékosan külön** a `loadConfig`-tól.
 *
 * Ha ezek a `loadConfig` sémájában lennének, a modellhívás nélküli `scan` és
 * `run` is megkövetelné a modell-blokkot és a LiteLLM-kulcsot. Így viszont a
 * modell-konfigurációt csak az fizeti meg, aki receptet futtat.
 *
 * A kulcs az egyetlen érték, ami **nem** a YAML-ból jön: titok, aminek nincs
 * helye egy verziókövetett konfigurációs fájlban.
 */
export function loadModelConfig(
  raw: unknown,
  env: Record<string, string | undefined>,
  configPath: string,
): ModelConfig {
  const parsed = ModelSchema.safeParse(raw)
  if (!parsed.success) fail(parsed.error, configPath)
  const apiKey = env.LITELLM_API_KEY
  if (!apiKey) {
    throw new Error(
      'A LITELLM_API_KEY kötelező, és kizárólag környezetből (.env) jön — a YAML nem tartalmazhatja.',
    )
  }
  const c = parsed.data
  return {
    baseUrl: c.model.base_url,
    apiKey,
    models: { draft: c.model.draft, judge: c.model.judge },
    pricing: {
      draft: {
        inputPerMillion: c.pricing.draft.input_per_million,
        outputPerMillion: c.pricing.draft.output_per_million,
      },
      judge: {
        inputPerMillion: c.pricing.judge.input_per_million,
        outputPerMillion: c.pricing.judge.output_per_million,
      },
    },
    costLimitUsd: c.cost_limit_usd,
  }
}
