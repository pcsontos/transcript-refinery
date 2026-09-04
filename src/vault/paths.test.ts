import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { recipeFile, resolveChannelDir, transcriptFile, videoDir } from './paths.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-paths-'))
})

describe('resolveChannelDir', () => {
  it('a meglévő mappát adja vissza, ha csak a kis-nagybetű tér el', async () => {
    await mkdir(join(root, 'Zen van Riel'), { recursive: true })
    expect(await resolveChannelDir(root, 'Zen Van Riel')).toBe('Zen van Riel')
  })

  it('a szanitizált nevet adja, ha nincs meglévő mappa', async () => {
    expect(await resolveChannelDir(root, 'Új/Csatorna')).toBe('Új⧸Csatorna')
  })

  it('a pontos egyezést részesíti előnyben', async () => {
    await mkdir(join(root, 'Alex Finn'), { recursive: true })
    expect(await resolveChannelDir(root, 'Alex Finn')).toBe('Alex Finn')
  })

  it('nem létező gyökérnél sem dob hibát', async () => {
    expect(await resolveChannelDir(join(root, 'nincs'), 'X')).toBe('X')
  })
})

describe('videoDir és transcriptFile', () => {
  it('beágyazott elrendezést ad: <Csatorna>/<Cím>', () => {
    expect(videoDir(root, 'Alex Finn', 'A: cím?')).toBe(
      join(root, 'Alex Finn', 'A： cím？'),
    )
  })

  it('a vault fájlnév-konvencióját követi', () => {
    expect(transcriptFile('/x/y', 'A cím')).toBe(
      '/x/y/Youtube - A cím_transcript.md',
    )
  })

  it('a fájlnévben is szanitizál', () => {
    expect(transcriptFile('/x/y', 'a/b')).toBe(
      '/x/y/Youtube - a⧸b_transcript.md',
    )
  })
})

describe('recipeFile', () => {
  it('a vault névkonvenciója szerint nevez el', () => {
    expect(recipeFile('/vault/Csatorna/Cim', 'Cim', '_summary.md')).toBe(
      '/vault/Csatorna/Cim/Youtube - Cim_summary.md',
    )
  })

  it('szanitizálja a címet a fájlnévben', () => {
    expect(recipeFile('/vault/C/V', 'A/B: C?', '_summary.md')).not.toContain('/A/B')
  })

  it('a transcriptFile ugyanennek a speciális esete', () => {
    expect(transcriptFile('/vault/C/V', 'Cim')).toBe(
      recipeFile('/vault/C/V', 'Cim', '_transcript.md'),
    )
  })
})
