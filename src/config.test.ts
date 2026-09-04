import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, loadDotEnv, validateConfig } from './config.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-config-'))
})

describe('loadConfig', () => {
  it('a vault jegyzet-gyökerét a VAULT_PATH alá számolja', () => {
    const cfg = loadConfig({
      VAULT_PATH: '/v',
      PINCHFLAT_DOWNLOADS: '/d',
    })
    expect(cfg.vaultPath).toBe('/v')
    expect(cfg.notesRoot).toBe('/v/Resources/Videos/YouTube')
  })

  it('az állapottárat alapból a repóba teszi, nem a vaultba', () => {
    const cfg = loadConfig({ VAULT_PATH: '/v', PINCHFLAT_DOWNLOADS: '/d' })
    expect(cfg.statePath).toContain('.state')
    expect(cfg.statePath.startsWith('/v')).toBe(false)
  })

  it('hiányzó VAULT_PATH esetén beszédes hibát dob', () => {
    expect(() => loadConfig({ PINCHFLAT_DOWNLOADS: '/d' })).toThrow(/VAULT_PATH/)
  })

  it('hiányzó PINCHFLAT_DOWNLOADS esetén beszédes hibát dob', () => {
    expect(() => loadConfig({ VAULT_PATH: '/v' })).toThrow(/PINCHFLAT_DOWNLOADS/)
  })

  it('a relatív útvonalat elutasítja, mert két gépen két útvonal van', () => {
    expect(() =>
      loadConfig({ VAULT_PATH: './vault', PINCHFLAT_DOWNLOADS: '/d' }),
    ).toThrow(/abszolút/)
  })
})

describe('validateConfig', () => {
  it('hibát dob, ha a vault nem git-repó', async () => {
    await mkdir(join(dir, 'vault'), { recursive: true })
    await mkdir(join(dir, 'downloads'), { recursive: true })
    const cfg = loadConfig({
      VAULT_PATH: join(dir, 'vault'),
      PINCHFLAT_DOWNLOADS: join(dir, 'downloads'),
    })
    await expect(validateConfig(cfg)).rejects.toThrow(/git/)
  })

  it('hibát dob, ha a letöltési mappa nem létezik', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    const cfg = loadConfig({
      VAULT_PATH: join(dir, 'vault'),
      PINCHFLAT_DOWNLOADS: join(dir, 'nincs'),
    })
    await expect(validateConfig(cfg)).rejects.toThrow(/PINCHFLAT_DOWNLOADS/)
  })

  it('átmegy, ha minden a helyén van', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    await mkdir(join(dir, 'downloads'), { recursive: true })
    const cfg = loadConfig({
      VAULT_PATH: join(dir, 'vault'),
      PINCHFLAT_DOWNLOADS: join(dir, 'downloads'),
    })
    await expect(validateConfig(cfg)).resolves.toBeUndefined()
  })
})

describe('loadDotEnv', () => {
  let dir: string
  const savedKeys = new Set(Object.keys(process.env))

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'refinery-env-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    for (const key of Object.keys(process.env)) {
      if (!savedKeys.has(key)) delete process.env[key]
    }
  })

  it('betölti a fájlban lévő változót', async () => {
    await writeFile(join(dir, '.env'), 'REFINERY_PROBA_A=fajlbol\n', 'utf8')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.REFINERY_PROBA_A).toBe('fajlbol')
  })

  it('a már beállított környezeti változót nem írja felül', async () => {
    process.env.REFINERY_PROBA_B = 'shellbol'
    await writeFile(join(dir, '.env'), 'REFINERY_PROBA_B=fajlbol\n', 'utf8')
    loadDotEnv(join(dir, '.env'))
    expect(process.env.REFINERY_PROBA_B).toBe('shellbol')
  })

  it('hiányzó fájl esetén nem dob', () => {
    expect(() => loadDotEnv(join(dir, 'nincs-ilyen'))).not.toThrow()
  })
})

import { loadModelConfig } from './config.js'

const TELJES_MODELL_ENV = {
  LITELLM_BASE_URL: 'http://localhost:4000/v1',
  LITELLM_API_KEY: 'sk-proba',
  REFINERY_MODEL_DRAFT: 'claude-sonnet-5',
  REFINERY_MODEL_JUDGE: 'grok-4-fast-reasoning',
  REFINERY_PRICE_DRAFT_IN: '3.00',
  REFINERY_PRICE_DRAFT_OUT: '15.00',
  REFINERY_PRICE_JUDGE_IN: '0.20',
  REFINERY_PRICE_JUDGE_OUT: '0.50',
  REFINERY_COST_LIMIT_USD: '5.00',
}

describe('loadModelConfig', () => {
  it('szerepenként képezi le a modellt és az árat', () => {
    const cfg = loadModelConfig(TELJES_MODELL_ENV)
    expect(cfg.models.draft).toBe('claude-sonnet-5')
    expect(cfg.models.judge).toBe('grok-4-fast-reasoning')
    expect(cfg.pricing.draft).toEqual({ inputPerMillion: 3, outputPerMillion: 15 })
    expect(cfg.pricing.judge).toEqual({ inputPerMillion: 0.2, outputPerMillion: 0.5 })
    expect(cfg.costLimitUsd).toBe(5)
  })

  it('a plafon hiányában elutasít — köteg nem indul felső korlát nélkül', () => {
    const { REFINERY_COST_LIMIT_USD: _elhagyva, ...env } = TELJES_MODELL_ENV
    expect(() => loadModelConfig(env)).toThrow(/REFINERY_COST_LIMIT_USD/)
  })

  it('a nulla plafont is elutasítja', () => {
    expect(() =>
      loadModelConfig({ ...TELJES_MODELL_ENV, REFINERY_COST_LIMIT_USD: '0' }),
    ).toThrow(/REFINERY_COST_LIMIT_USD/)
  })

  it('hiányzó kulcsra a változó nevét mondja meg', () => {
    const { LITELLM_API_KEY: _elhagyva, ...env } = TELJES_MODELL_ENV
    expect(() => loadModelConfig(env)).toThrow(/LITELLM_API_KEY/)
  })

  it('érvénytelen alap-URL-t elutasít', () => {
    expect(() =>
      loadModelConfig({ ...TELJES_MODELL_ENV, LITELLM_BASE_URL: 'nem-url' }),
    ).toThrow(/LITELLM_BASE_URL/)
  })

  it('a Fázis 0 loadConfigja nem követeli meg a modell-változókat', () => {
    const cfg = loadConfig({
      VAULT_PATH: '/vault',
      PINCHFLAT_DOWNLOADS: '/letoltesek',
    })
    expect(cfg.vaultPath).toBe('/vault')
  })
})
