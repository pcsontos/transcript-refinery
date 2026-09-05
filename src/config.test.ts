import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTES_DIR,
  loadConfig,
  loadModelConfig,
  readConfigFile,
  validateConfig,
} from './config.js'

let dir: string

const MIN = { vault: { path: '/v' }, sources: ['/s/youtube'] }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-config-'))
})

describe('loadConfig', () => {
  it('notes_dir nélkül az Inbox/transcript-refinery alá tesz', () => {
    const cfg = loadConfig(MIN, '/p/refinery.config.yaml')
    expect(cfg.notesRoot).toBe(`/v/${DEFAULT_NOTES_DIR}`)
  })

  it('a megadott notes_dir felülírja az alapértelmezést', () => {
    const cfg = loadConfig(
      { ...MIN, vault: { path: '/v', notes_dir: 'Inbox/masik' } },
      '/p/refinery.config.yaml',
    )
    expect(cfg.notesRoot).toBe('/v/Inbox/masik')
  })

  it('a forrás nevét az útvonal utolsó szegmenséből veszi', () => {
    const cfg = loadConfig(
      { ...MIN, sources: ['/s/youtube', '/s/whisper-out'] },
      '/p/refinery.config.yaml',
    )
    expect(cfg.sources).toEqual([
      { name: 'youtube', path: '/s/youtube' },
      { name: 'whisper-out', path: '/s/whisper-out' },
    ])
  })

  it('üres sources esetén beszédes hibát dob', () => {
    expect(() => loadConfig({ ...MIN, sources: [] }, '/p/c.yaml')).toThrow(
      /forrásmappa/,
    )
  })

  it('a hibaüzenet megnevezi a mezőt és a konfigurációs fájlt', () => {
    expect(() => loadConfig({ sources: ['/s'] }, '/p/c.yaml')).toThrow(
      /vault.*\/p\/c\.yaml/s,
    )
  })

  it('a relatív forrásútvonalat elutasítja', () => {
    expect(() => loadConfig({ ...MIN, sources: ['./s'] }, '/p/c.yaml')).toThrow(
      /abszolút/,
    )
  })

  it('az állapottárat alapból a repóba teszi, nem a vaultba', () => {
    const cfg = loadConfig(MIN, '/p/refinery.config.yaml')
    expect(cfg.statePath).toContain('.state')
    expect(cfg.statePath.startsWith('/v')).toBe(false)
  })

  it('a languages alapból üres, és nem hiányzó mezőként hibázik', () => {
    expect(loadConfig(MIN, '/p/c.yaml').languages).toEqual([])
  })
})

describe('readConfigFile', () => {
  it('hiányzó fájlnál megnevezi az útvonalat és a --config kapcsolót', async () => {
    await expect(readConfigFile(join(dir, 'nincs.yaml'))).rejects.toThrow(
      /nincs\.yaml[\s\S]*--config/,
    )
  })

  it('értelmezhetetlen YAML-nál megnevezi a fájlt', async () => {
    const path = join(dir, 'rossz.yaml')
    await writeFile(path, 'vault: [\n  path: /v\n', 'utf8')
    await expect(readConfigFile(path)).rejects.toThrow(/rossz\.yaml/)
  })

  it('a YAML-t sima objektummá alakítja', async () => {
    const path = join(dir, 'jo.yaml')
    await writeFile(path, 'vault:\n  path: /v\nsources:\n  - /s/youtube\n', 'utf8')
    expect(await readConfigFile(path)).toEqual(MIN)
  })
})

describe('loadModelConfig', () => {
  const RAW = {
    ...MIN,
    model: { base_url: 'http://localhost:4000/v1', draft: 'd', judge: 'j' },
    pricing: {
      draft: { input_per_million: 3, output_per_million: 15 },
      judge: { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: 5,
  }

  it('a kulcsot a környezetből veszi, nem a YAML-ból', () => {
    const cfg = loadModelConfig(RAW, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')
    expect(cfg.apiKey).toBe('sk-1')
    expect(cfg.models.draft).toBe('d')
    expect(cfg.costLimitUsd).toBe(5)
  })

  it('hiányzó kulcsnál megmondja, hogy a .env-ből jön', () => {
    expect(() => loadModelConfig(RAW, {}, '/p/c.yaml')).toThrow(/LITELLM_API_KEY/)
  })

  it('nulla költségplafont nem fogad el', () => {
    expect(() =>
      loadModelConfig({ ...RAW, cost_limit_usd: 0 }, { LITELLM_API_KEY: 'k' }, '/p/c.yaml'),
    ).toThrow(/plafon|pozitív/)
  })
})

describe('validateConfig', () => {
  it('hibát dob, ha a vault nem git-repó', async () => {
    await mkdir(join(dir, 'vault'), { recursive: true })
    await mkdir(join(dir, 'subs'), { recursive: true })
    const cfg = loadConfig(
      { vault: { path: join(dir, 'vault') }, sources: [join(dir, 'subs')] },
      '/p/c.yaml',
    )
    await expect(validateConfig(cfg)).rejects.toThrow(/git-repó/)
  })

  it('hibát dob, ha egy forrásmappa nem létezik', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    const cfg = loadConfig(
      { vault: { path: join(dir, 'vault') }, sources: [join(dir, 'nincs')] },
      '/p/c.yaml',
    )
    await expect(validateConfig(cfg)).rejects.toThrow(/nincs/)
  })
})
