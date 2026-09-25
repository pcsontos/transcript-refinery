import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTES_DIR,
  loadCliConfig,
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

  it('a logs.dir alapértelmezése a logs mappa, és a projekt gyökeréhez képest oldódik fel', () => {
    const cfg = loadConfig(
      { vault: { path: '/v' }, sources: ['/s'] },
      '/p/refinery.config.yaml',
    )
    expect(cfg.logsDir).toBe(resolve(process.cwd(), 'logs'))
  })

  it('a logs.dir megadható a YAML-ban', () => {
    const cfg = loadConfig(
      { vault: { path: '/v' }, sources: ['/s'], logs: { dir: 'naplok' } },
      '/p/refinery.config.yaml',
    )
    expect(cfg.logsDir).toBe(resolve(process.cwd(), 'naplok'))
  })

  it('translate kulcs nélkül nincs fordítás', () => {
    expect(loadConfig(MIN, '/p/c.yaml').translate).toBeNull()
  })

  it('a translate kulcsot célnyelvvel és forrásreceptekkel olvassa be', () => {
    expect(
      loadConfig({ ...MIN, translate: { to: 'hu', recipes: ['clean', 'summary'] } }, '/p/c.yaml')
        .translate,
    ).toEqual({ to: 'hu', recipes: ['clean', 'summary'] })
  })

  it('ismeretlen célnyelvre felsorolja az ismert nyelveket', () => {
    expect(() =>
      loadConfig({ ...MIN, translate: { to: 'xx', recipes: ['clean'] } }, '/p/c.yaml'),
    ).toThrow('translate.to: Ismeretlen célnyelv; ismert nyelvek: en, hu, nl, de, es, fr, it. (/p/c.yaml)')
  })

  it('üres forráslistára beszédes hibát dob', () => {
    expect(() => loadConfig({ ...MIN, translate: { to: 'hu', recipes: [] } }, '/p/c.yaml')).toThrow(
      'translate.recipes: Legalább egy forrásrecept kell. (/p/c.yaml)',
    )
  })

  it('ismétlődő forrásreceptre beszédes hibát dob', () => {
    expect(() =>
      loadConfig({ ...MIN, translate: { to: 'hu', recipes: ['clean', 'clean'] } }, '/p/c.yaml'),
    ).toThrow('translate.recipes: Egy forrásrecept csak egyszer szerepelhet. (/p/c.yaml)')
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

  it('a judge_enabled alapértelmezése igaz', () => {
    expect(loadModelConfig(RAW, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml').judgeEnabled).toBe(true)
  })

  it('a judge_enabled kikapcsolható a YAML-ból', () => {
    const raw = { ...RAW, model: { ...RAW.model, judge_enabled: false } }
    expect(loadModelConfig(raw, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml').judgeEnabled).toBe(false)
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

  it('hibát dob, ha két forrásmappa alapneve ütközik, és mindkét útvonalat megnevezi', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    const path1 = join(dir, 'vol1', 'feliratok')
    const path2 = join(dir, 'vol2', 'feliratok')
    await mkdir(path1, { recursive: true })
    await mkdir(path2, { recursive: true })
    const cfg = loadConfig(
      { vault: { path: join(dir, 'vault') }, sources: [path1, path2] },
      '/p/c.yaml',
    )
    await expect(validateConfig(cfg)).rejects.toThrow(/feliratok/)
    let message = ''
    try {
      await validateConfig(cfg)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(path1)
    expect(message).toContain(path2)
  })
})

describe('loadConfig — alapmappa', () => {
  it('a relatív állapot- és naplóútvonalat a megadott alapmappához oldja fel', () => {
    const cfg = loadConfig(
      { ...MIN, state: { path: '.state/refinery.db' }, logs: { dir: 'logs' } },
      '/p/refinery.config.yaml',
      '/repo',
    )
    expect(cfg.statePath).toBe('/repo/.state/refinery.db')
    expect(cfg.logsDir).toBe('/repo/logs')
  })

  it('alapmappa nélkül a munkakönyvtárhoz oldja fel, ahogy eddig', () => {
    const cfg = loadConfig(MIN, '/p/refinery.config.yaml')
    expect(cfg.statePath).toBe(resolve(process.cwd(), '.state', 'refinery.db'))
    expect(cfg.logsDir).toBe(resolve(process.cwd(), 'logs'))
  })

  it('az abszolút útvonalat az alapmappa nem írja át', () => {
    const cfg = loadConfig(
      { ...MIN, state: { path: '/abs/state.db' }, logs: { dir: '/abs/logs' } },
      '/p/refinery.config.yaml',
      '/repo',
    )
    expect(cfg.statePath).toBe('/abs/state.db')
    expect(cfg.logsDir).toBe('/abs/logs')
  })
})

describe('loadCliConfig', () => {
  const YAML = 'vault:\n  path: /v\nsources:\n  - /s/youtube\n'

  it('a relatív állapot- és naplóútvonalat a config mappájához oldja fel, nem a munkakönyvtárhoz', async () => {
    const configDir = join(dir, 'projekt')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'refinery.config.yaml'), YAML, 'utf8')

    const { cfg } = await loadCliConfig(join(configDir, 'refinery.config.yaml'), join(dir, 'mashol'))

    expect(cfg.statePath).toBe(join(configDir, '.state', 'refinery.db'))
    expect(cfg.logsDir).toBe(join(configDir, 'logs'))
  })

  it('--config nélkül a munkakönyvtár refinery.config.yaml-ját olvassa', async () => {
    await writeFile(join(dir, 'refinery.config.yaml'), YAML, 'utf8')
    const { cfg } = await loadCliConfig(undefined, dir)
    expect(cfg.configPath).toBe(join(dir, 'refinery.config.yaml'))
  })

  it('a config melletti .env-et tölti be', async () => {
    delete process.env.REFINERY_PROBA_KULCS
    await writeFile(join(dir, 'refinery.config.yaml'), YAML, 'utf8')
    await writeFile(join(dir, '.env'), 'REFINERY_PROBA_KULCS=fajlbol\n', 'utf8')
    try {
      await loadCliConfig(join(dir, 'refinery.config.yaml'), tmpdir())
      expect(process.env.REFINERY_PROBA_KULCS).toBe('fajlbol')
    } finally {
      delete process.env.REFINERY_PROBA_KULCS
    }
  })

  it('a környezetben már beállított változót a .env nem írja felül', async () => {
    process.env.REFINERY_PROBA_KULCS = 'kornyezetbol'
    await writeFile(join(dir, 'refinery.config.yaml'), YAML, 'utf8')
    await writeFile(join(dir, '.env'), 'REFINERY_PROBA_KULCS=fajlbol\n', 'utf8')
    try {
      await loadCliConfig(join(dir, 'refinery.config.yaml'), tmpdir())
      expect(process.env.REFINERY_PROBA_KULCS).toBe('kornyezetbol')
    } finally {
      delete process.env.REFINERY_PROBA_KULCS
    }
  })

  it('.env nélkül sem hibázik', async () => {
    await writeFile(join(dir, 'refinery.config.yaml'), YAML, 'utf8')
    await expect(loadCliConfig(join(dir, 'refinery.config.yaml'), tmpdir())).resolves.toBeDefined()
  })
})
