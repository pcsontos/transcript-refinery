import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { ModelRole } from './types.js'

/** A vaulton belüli jegyzet-gyűjtemény, ahova a publisher ír. */
const NOTES_SUBDIR = 'Resources/Videos/YouTube'

/**
 * Betölti az `.env`-et, ha létezik.
 *
 * A `process.loadEnvFile()` a **már beállított** környezeti változókat nem
 * írja felül, tehát a shellben megadott érték erősebb a fájlénál — ez teszi
 * biztonságossá az egyszeri `VAULT_PATH=… refinery run` alakot.
 *
 * A hiányzó fájl nem hiba: CI-ban és automatizált futtatáskor a környezet
 * közvetlenül van beállítva. Minden más hiba (például szintaktikai) viszont
 * felszínre jön, mert egy csendben elnyelt elgépelés órákat visz el.
 */
export function loadDotEnv(path = join(process.cwd(), '.env')): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const EnvSchema = z.object({
  VAULT_PATH: z
    .string()
    .min(1, 'A VAULT_PATH kötelező.')
    .refine(isAbsolute, 'A VAULT_PATH abszolút útvonal kell legyen.'),
  PINCHFLAT_DOWNLOADS: z
    .string()
    .min(1, 'A PINCHFLAT_DOWNLOADS kötelező.')
    .refine(isAbsolute, 'A PINCHFLAT_DOWNLOADS abszolút útvonal kell legyen.'),
  REFINERY_STATE_PATH: z.string().optional(),
})

export interface Config {
  vaultPath: string
  notesRoot: string
  pinchflatDownloads: string
  statePath: string
}

/**
 * Környezeti változók → konfiguráció. Tisztán szinkron és fájlrendszertől
 * független, hogy tesztelhető legyen; a létezés-ellenőrzés a
 * `validateConfig` dolga.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    const name = first.path[0] ?? 'konfiguráció'
    throw new Error(`${String(name)}: ${first.message}`)
  }
  const e = parsed.data
  return {
    vaultPath: e.VAULT_PATH,
    notesRoot: join(e.VAULT_PATH, NOTES_SUBDIR),
    pinchflatDownloads: e.PINCHFLAT_DOWNLOADS,
    statePath: e.REFINERY_STATE_PATH ?? join(process.cwd(), '.state', 'refinery.db'),
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
 * a futás közepén.
 */
export async function validateConfig(cfg: Config): Promise<void> {
  if (!(await isDirectory(cfg.vaultPath))) {
    throw new Error(`VAULT_PATH: nem létező mappa: ${cfg.vaultPath}`)
  }
  if (!(await isDirectory(join(cfg.vaultPath, '.git')))) {
    throw new Error(`VAULT_PATH: nem git-repó: ${cfg.vaultPath}`)
  }
  if (!(await isDirectory(cfg.pinchflatDownloads))) {
    throw new Error(
      `PINCHFLAT_DOWNLOADS: nem létező mappa: ${cfg.pinchflatDownloads}`,
    )
  }
}

const ModelEnvSchema = z.object({
  LITELLM_BASE_URL: z.url('A LITELLM_BASE_URL érvényes URL kell legyen.'),
  LITELLM_API_KEY: z.string().min(1, 'A LITELLM_API_KEY kötelező.'),
  REFINERY_MODEL_DRAFT: z.string().min(1, 'A REFINERY_MODEL_DRAFT kötelező.'),
  REFINERY_MODEL_JUDGE: z.string().min(1, 'A REFINERY_MODEL_JUDGE kötelező.'),
  REFINERY_PRICE_DRAFT_IN: z.coerce.number().nonnegative(),
  REFINERY_PRICE_DRAFT_OUT: z.coerce.number().nonnegative(),
  REFINERY_PRICE_JUDGE_IN: z.coerce.number().nonnegative(),
  REFINERY_PRICE_JUDGE_OUT: z.coerce.number().nonnegative(),
  REFINERY_COST_LIMIT_USD: z.coerce
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
 * `run` is megkövetelné a LiteLLM-kulcsot. Így viszont a Fázis 0 útja egyetlen
 * új környezeti változó nélkül fut tovább, és a modell-konfigurációt csak az
 * fizeti meg, aki receptet futtat.
 */
export function loadModelConfig(
  env: Record<string, string | undefined>,
): ModelConfig {
  const parsed = ModelEnvSchema.safeParse(env)
  if (!parsed.success) {
    const first = parsed.error.issues[0]!
    const name = first.path[0] ?? 'konfiguráció'
    throw new Error(`${String(name)}: ${first.message}`)
  }
  const e = parsed.data
  return {
    baseUrl: e.LITELLM_BASE_URL,
    apiKey: e.LITELLM_API_KEY,
    models: {
      draft: e.REFINERY_MODEL_DRAFT,
      judge: e.REFINERY_MODEL_JUDGE,
    },
    pricing: {
      draft: {
        inputPerMillion: e.REFINERY_PRICE_DRAFT_IN,
        outputPerMillion: e.REFINERY_PRICE_DRAFT_OUT,
      },
      judge: {
        inputPerMillion: e.REFINERY_PRICE_JUDGE_IN,
        outputPerMillion: e.REFINERY_PRICE_JUDGE_OUT,
      },
    },
    costLimitUsd: e.REFINERY_COST_LIMIT_USD,
  }
}
