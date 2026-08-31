import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

/** A vaulton belüli jegyzet-gyűjtemény, ahova a publisher ír. */
const NOTES_SUBDIR = 'Resources/Videos/YouTube'

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
