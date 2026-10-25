import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Config, loadConfig } from '../config.js'
import { deployLines, deployNotes, type Transform } from './deploy.js'

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]) => (await run('git', args, { cwd })).stdout.trim()

const CONTRACT = {
  components: {
    Callout: {
      attributes: {
        type: { type: 'enum', values: ['note', 'tip', 'warning'], required: false },
        title: { type: 'string', required: false },
      },
    },
  },
}

let root: string
let remote: string
let clone: string
let vault: string
let cfg: Config

async function configure(repo: string) {
  await git(repo, 'config', 'user.email', 'teszt@example.com')
  await git(repo, 'config', 'user.name', 'Teszt')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-deploy-'))
  remote = join(root, 'remote.git')
  clone = join(root, 'clone')
  vault = join(root, 'vault')
  await run('git', ['init', '--bare', '-b', 'main', remote])
  await run('git', ['clone', remote, clone])
  await configure(clone)
  await git(clone, 'checkout', '-B', 'main')
  await mkdir(join(clone, 'contract'), { recursive: true })
  await writeFile(join(clone, 'contract', 'mdx-components.json'), JSON.stringify(CONTRACT))
  await git(clone, 'add', '.')
  await git(clone, 'commit', '-m', 'alap')
  await git(clone, 'push', '-u', 'origin', 'main')
  await mkdir(join(vault, 'notes'), { recursive: true })
  await run('git', ['init', '-b', 'main', vault])
  await configure(vault)
  cfg = loadConfig(
    {
      vault: { path: vault, notes_dir: 'notes' },
      sources: [join(root, 'subs')],
      showroom: { deploy: 'manual', clone_path: clone },
    },
    join(root, 'c.yaml'),
    root,
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const BASE = { title: 'Cím', language: 'hu', source: 'youtube', generated_at: 'T1' }

/**
 * Egy vault-jegyzet: a tételhez tartozó `<alap>_<fajta>.md`, plusz az átirat-horgony. Az átirat
 * mezői egy kiküldhető jegyzetéi, hogy csak a fajtája zárja ki.
 */
async function note(itemId: string, kind: string, fields: Record<string, unknown>, body = '# Szöveg\n\nEgy {x} < y.\n') {
  const dir = join(vault, 'notes', 'youtube')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${itemId}_transcript.md`), `---\n${stringify({ item_id: itemId, ...BASE })}---\nátirat\n`)
  const path = join(dir, `${itemId}_${kind}.md`)
  await writeFile(path, `---\n${stringify({ item_id: itemId, ...fields })}---\n${body}`)
  return path
}

const show = (path: string) => git(remote, 'show', `main:${path}`)
const remoteHas = async (path: string) => {
  try {
    await show(path)
    return true
  } catch {
    return false
  }
}
const VALID: Transform = () => Promise.resolve('Jó <Callout type="note">x</Callout>')

describe('deployNotes', () => {
  it('első futás kiírja és pusholja', async () => {
    await note('vid1', 'summary', BASE)
    await note('vid1', 'summary-en', {
      ...BASE,
      language: 'en',
      translation_of: 'summary',
      source_language: 'hu-orig',
      source_generated_at: 'T1',
    })
    const report = await deployNotes({ cfg })
    expect(report.commits).toBe(1)
    expect(report.push?.pushed).toBe(true)
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('kind: summary')
    expect(await show('content/notes/vid1/summary.en.mdx')).toContain('translation_of: summary')
    expect(JSON.parse(await show('content/notes/vid1/meta.json'))).toEqual({ title: 'Cím' })
    expect(await remoteHas('content/notes/vid1/transcript.hu.mdx')).toBe(false)
    // az átirat kizárása nem kihagyás, nem kerül a naplóba
    expect(report.skipped).toEqual([])
    expect(report.written.sort()).toEqual(['vid1/summary.en.mdx', 'vid1/summary.hu.mdx'])
  })

  it('második futás változatlan vaultnál nem ír és nem commitol', async () => {
    await note('vid1', 'summary', BASE)
    const transform = vi.fn(VALID)
    await deployNotes({ cfg, transform })
    expect(transform).toHaveBeenCalled()
    transform.mockClear()
    const report = await deployNotes({ cfg, transform })
    expect(report).toMatchObject({ written: [], commits: 0, push: null })
    expect(transform).not.toHaveBeenCalled()
  })

  it('újragenerált jegyzet frissül', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    await note('vid1', 'summary', { ...BASE, generated_at: 'T2' })
    const report = await deployNotes({ cfg })
    expect(report.written).toContain('vid1/summary.hu.mdx')
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('generated_at: T2')
  })

  it('mdx_fallback jegyzetet transformmal újra átalakít, nélküle nem', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_fallback: true')
    expect((await deployNotes({ cfg })).written).toEqual([])
    const report = await deployNotes({ cfg, transform: VALID })
    expect(report.written).toEqual(['vid1/summary.hu.mdx'])
    expect(await show('content/notes/vid1/summary.hu.mdx')).not.toContain('mdx_fallback')
  })

  it('le nem forduló transform-kimenet helyett a determinisztikus megy', async () => {
    await note('vid1', 'summary', BASE)
    const report = await deployNotes({ cfg, transform: () => Promise.resolve('<Callout>') })
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_fallback: true')
    expect(report.skipped.map((s) => s.reason).join('\n')).toContain('LLM-kimenet elvetve')
  })

  it('listán kívüli komponens helyett a determinisztikus megy', async () => {
    for (const out of ['<Foo />', '<Callout type="danger">x</Callout>']) {
      await rm(join(clone, 'content'), { recursive: true, force: true })
      await git(clone, 'reset', '-q', '--hard', 'origin/main')
      await note('vid1', 'summary', { ...BASE, generated_at: out })
      const report = await deployNotes({ cfg, transform: () => Promise.resolve(out) })
      expect(report.skipped.map((s) => s.reason).join('\n')).toContain('LLM-kimenet elvetve')
      expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_fallback: true')
    }
  })

  it('jó transform-kimenet megy, jelző nélkül', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg, transform: VALID })
    const out = await show('content/notes/vid1/summary.hu.mdx')
    expect(out).toContain('<Callout type="note">x</Callout>')
    expect(out).not.toContain('mdx_fallback')
  })

  it('a komponenslista a pull után olvasódik', async () => {
    await note('vid1', 'summary', BASE)
    const other = join(root, 'other')
    await run('git', ['clone', remote, other])
    await configure(other)
    const wide = { components: { ...CONTRACT.components, Foo: { attributes: {} } } }
    await writeFile(join(other, 'contract', 'mdx-components.json'), JSON.stringify(wide))
    await git(other, 'commit', '-qam', 'Foo')
    await git(other, 'push')
    const report = await deployNotes({ cfg, transform: () => Promise.resolve('<Foo />') })
    expect(report.skipped).toEqual([])
    expect(await show('content/notes/vid1/summary.hu.mdx')).not.toContain('mdx_fallback')
  })

  it('de fordítás nem kerül a commitba, a napló megnevezi', async () => {
    const path = await note('vid1', 'summary-de', {
      ...BASE,
      language: 'de',
      translation_of: 'summary',
      source_language: 'hu',
      source_generated_at: 'T1',
    })
    const report = await deployNotes({ cfg })
    expect(report.skipped).toEqual([{ path, reason: 'nyelv: de' }])
    expect(deployLines(report).join('\n')).toContain('vid1_summary-de.md')
    expect(await remoteHas('content/notes/vid1/summary.de.mdx')).toBe(false)
  })

  it('URL nélküli tétel url nélkül kimegy', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    expect(await show('content/notes/vid1/summary.hu.mdx')).not.toContain('url:')
  })

  it('szójegyzék glossary.hu-ként megy, a vault-commit idejével', async () => {
    await note('vid1', 'summary', BASE)
    const path = await note('vid1', 'glossary-hu', { title: 'Cím', language: 'hu', source_language: 'en' }, '| a | b |\n')
    await git(vault, 'add', '.')
    await git(vault, 'commit', '-qm', 'vault')
    await deployNotes({ cfg })
    const first = await show('content/notes/vid1/glossary.hu.mdx')
    expect(first).toContain('kind: glossary')
    expect(first).not.toContain('source_language')
    const committedAt = await git(vault, 'log', '-1', '--format=%cI', '--', path)
    expect(first).toContain(`generated_at: ${committedAt}`)
    expect(first).toContain('source: youtube')
    expect(first).toContain('origin: cli')
    await new Promise((r) => setTimeout(r, 1100))
    await writeFile(path, `---\n${stringify({ item_id: 'vid1', title: 'Cím', language: 'hu', source_language: 'en' })}---\n| a | b |\n| c | d |\n`)
    await git(vault, 'commit', '-qam', 'bővítés')
    const report = await deployNotes({ cfg })
    expect(report.written).toEqual(['vid1/glossary.hu.mdx'])
  })

  it('commitolatlan szójegyzék kimarad és naplózódik', async () => {
    await note('vid1', 'summary', BASE)
    await git(vault, 'add', '.')
    await git(vault, 'commit', '-qm', 'vault')
    const path = await note('vid1', 'glossary-hu', { title: 'Cím', language: 'hu', source_language: 'en' }, '| a | b |\n')
    const report = await deployNotes({ cfg })
    expect(report.skipped).toEqual([{ path, reason: 'a szójegyzék még nincs commitolva' }])
    expect(await remoteHas('content/notes/vid1/glossary.hu.mdx')).toBe(false)
  })

  it('fordítás hiányzó source_generated_at-je az eredetiből pótlódik', async () => {
    await note('vid1', 'summary', { ...BASE, generated_at: 'T7' })
    await note('vid1', 'summary-en', { ...BASE, language: 'en', translation_of: 'summary', source_language: 'hu' })
    await deployNotes({ cfg })
    expect(await show('content/notes/vid1/summary.en.mdx')).toContain('source_generated_at: T7')
  })

  it('ugyanarra a célútra eső két fájl közül az eredeti nyer', async () => {
    await note('vid1', 'summary', BASE)
    const translation = await note('vid1', 'summary-hu', {
      ...BASE,
      translation_of: 'summary',
      source_language: 'en',
      source_generated_at: 'T1',
    })
    const report = await deployNotes({ cfg })
    expect(report.skipped).toEqual([{ path: translation, reason: 'ütközik: vid1/summary.hu.mdx' }])
    expect(await show('content/notes/vid1/summary.hu.mdx')).not.toContain('translation_of')
  })

  it('cím nélküli jegyzet nem írja felül a meta.json címét', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    const { title: _t, ...nincs } = BASE
    await note('vid1', 'summary', { ...nincs, generated_at: 'T2' })
    const report = await deployNotes({ cfg })
    expect(report.skipped.map((s) => s.reason)).toEqual(['vid1/summary.hu.mdx: hiányzik: title'])
    expect(report.commits).toBe(0)
    expect(JSON.parse(await show('content/notes/vid1/meta.json'))).toEqual({ title: 'Cím' })
  })

  it('nem main-en álló klónnál megáll', async () => {
    await note('vid1', 'summary', BASE)
    await git(clone, 'checkout', '-b', 'masik')
    await expect(deployNotes({ cfg })).rejects.toThrow('a klón nem a main ágon áll (masik)')
    expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(false)
  })

  it('itemIds szűr', async () => {
    await note('A', 'summary', BASE)
    await note('B', 'summary', BASE)
    const report = await deployNotes({ cfg, itemIds: new Set(['A']) })
    expect(report.written).toEqual(['A/summary.hu.mdx'])
    expect(await remoteHas('content/notes/B/summary.hu.mdx')).toBe(false)
  })

  it('félbemaradt írás a következő futásban commitba kerül', async () => {
    const stray = join(clone, 'content', 'notes', 'vid1', 'summary.hu.mdx')
    await mkdir(dirname(stray), { recursive: true })
    await writeFile(stray, 'félbemaradt')
    await deployNotes({ cfg })
    expect(await show('content/notes/vid1/summary.hu.mdx')).toBe('félbemaradt')
  })

  it('elutasított push után a következő futás pusholja', async () => {
    await note('vid1', 'summary', BASE)
    const hook = join(remote, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\n[ -e "$(dirname "$0")/../deny" ] && exit 1\nexit 0\n')
    await chmod(hook, 0o755)
    await writeFile(join(remote, 'deny'), '')
    const first = await deployNotes({ cfg })
    expect(first.push?.pushed).toBe(false)
    expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(false)
    await rm(join(remote, 'deny'))
    const second = await deployNotes({ cfg })
    expect(second.push?.pushed).toBe(true)
    expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(true)
  })

  it('elutasított push után előrelépett távoli main mellett is pusholja', async () => {
    await note('vid1', 'summary', BASE)
    const hook = join(remote, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\n[ -e "$(dirname "$0")/../deny" ] && exit 1\nexit 0\n')
    await chmod(hook, 0o755)
    await writeFile(join(remote, 'deny'), '')
    expect((await deployNotes({ cfg })).push?.pushed).toBe(false)
    await rm(join(remote, 'deny'))
    const other = join(root, 'other')
    await run('git', ['clone', remote, other])
    await configure(other)
    await writeFile(join(other, 'README.md'), 'kézi')
    await git(other, 'add', '.')
    await git(other, 'commit', '-qm', 'kézi')
    await git(other, 'push')
    // a félbemaradt írás (új és módosított követett fájl) is a közbejött távoli commit mellett kerül commitba
    const stray = join(clone, 'content', 'notes', 'vid2', 'summary.hu.mdx')
    await mkdir(dirname(stray), { recursive: true })
    await writeFile(stray, 'félbemaradt')
    await writeFile(join(clone, 'content', 'notes', 'vid1', 'meta.json'), 'félbemaradt')
    const second = await deployNotes({ cfg })
    expect(second.push?.pushed).toBe(true)
    expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(true)
    expect(await show('content/notes/vid2/summary.hu.mdx')).toBe('félbemaradt')
    expect(await show('README.md')).toBe('kézi')
    expect(JSON.parse(await show('content/notes/vid1/meta.json'))).toEqual({ title: 'Cím' })
  })

  it('showroom blokk nélkül dob', async () => {
    await expect(deployNotes({ cfg: { ...cfg, showroom: null } })).rejects.toThrow('showroom')
  })
})
