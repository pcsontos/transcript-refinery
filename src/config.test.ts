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
