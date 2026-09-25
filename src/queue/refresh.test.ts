import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { RECIPES } from '../recipe/registry.js'
import { discoverAll } from '../source/folder.js'
import { refreshQueue } from './refresh.js'

let work: string
let cfg: Config

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-refresh-'))
  const channel = join(work, 'letoltes', 'Csatorna')
  await mkdir(channel, { recursive: true })
  await mkdir(join(work, 'vault'), { recursive: true })
  await writeFile(
    join(channel, 'Egy videó.en.srt'),
    '1\n00:00:00,000 --> 00:00:02,000\nThis is a test sentence for the probe.\n',
    'utf8',
  )
  cfg = loadConfig(
    { vault: { path: join(work, 'vault') }, sources: [join(work, 'letoltes')], state: { path: join(work, 'state.db') } },
    join(work, 'c.yaml'),
    work,
  )
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('refreshQueue', () => {
  it('sor nélkül új szöveget ad az elemmel, és nem ír a lemezre', async () => {
    const items = await discoverAll(cfg.sources, cfg.languages)
    const result = await refreshQueue(cfg, RECIPES, items)
    expect(result.current).toBeNull()
    expect(result.text).toContain('Egy videó')
    expect(result.stats.addedVideos).toBe(1)
  })

  it('a saját kimenetére alkalmazva nem változtat', async () => {
    const items = await discoverAll(cfg.sources, cfg.languages)
    const first = await refreshQueue(cfg, RECIPES, items)
    await mkdir(cfg.notesRoot, { recursive: true })
    await writeFile(first.path, first.text, 'utf8')
    const second = await refreshQueue(cfg, RECIPES, items)
    expect(second.text).toBe(second.current)
  })
})
