import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, validateConfig } from './config.js'

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
