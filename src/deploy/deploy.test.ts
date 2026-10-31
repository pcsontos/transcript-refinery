import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Config, loadConfig } from '../config.js'
import { type DeployReport, deployHeader, deployLines, deployNotes, dryRunLines } from './deploy.js'
import type { Transform, TransformResult } from './llm.js'

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
    Accordions: { attributes: { type: { type: 'enum', values: ['single', 'multiple'], required: false } } },
    Accordion: { attributes: { title: { type: 'string', required: true } } },
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

/** `run`-onként sorban ad eredményt (az utolsó ismétlődik; `Error` dobás), és számolja a hívást. */
function fakeTransform(...results: (TransformResult | Error)[]): Transform & { calls: number } {
  const transform = {
    calls: 0,
    run: () => {
      const result = results[Math.min(transform.calls++, results.length - 1)]!
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    },
    usage: () => ({ inputTokens: 0, outputTokens: 0, usd: 0, budgetSkipped: 0 }),
  }
  return transform
}
const final = (body: string): TransformResult => ({ kind: 'final', body })
const valid = () => fakeTransform(final('Jó <Callout type="note">x</Callout>'))

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
    const transform = valid()
    const first = await deployNotes({ cfg, transform })
    expect(first.planned).toEqual([{ target: 'vid1/summary.hu.mdx', action: 'new', route: 'llm' }])
    expect(transform.calls).toBe(1)
    const report = await deployNotes({ cfg, transform })
    expect(report).toMatchObject({ written: [], commits: 0, push: null, planned: [], unchanged: 1 })
    expect(transform.calls).toBe(1)
  })

  it('újragenerált jegyzet frissül', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    await note('vid1', 'summary', { ...BASE, generated_at: 'T2' })
    const report = await deployNotes({ cfg })
    expect(report.written).toContain('vid1/summary.hu.mdx')
    expect(report.planned[0]?.action).toBe('update')
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('generated_at: T2')
  })

  it('mdx_fallback jegyzetet transformmal újra átalakít, nélküle nem', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_fallback: true')
    expect((await deployNotes({ cfg })).written).toEqual([])
    const report = await deployNotes({ cfg, transform: valid() })
    expect(report.written).toEqual(['vid1/summary.hu.mdx'])
    expect(await show('content/notes/vid1/summary.hu.mdx')).not.toContain('mdx_fallback')
  })

  it('le nem forduló transform-kimenet helyett a determinisztikus megy', async () => {
    await note('vid1', 'summary', BASE)
    const report = await deployNotes({ cfg, transform: fakeTransform(final('<Callout>')) })
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_fallback: true')
    expect(report.skipped.map((s) => s.reason).join('\n')).toContain('LLM-kimenet elvetve')
  })

  it('listán kívüli komponens helyett a determinisztikus megy', async () => {
    for (const out of ['<Foo />', '<Callout type="danger">x</Callout>']) {
      await rm(join(clone, 'content'), { recursive: true, force: true })
      await git(clone, 'reset', '-q', '--hard', 'origin/main')
      await note('vid1', 'summary', { ...BASE, generated_at: out })
      const report = await deployNotes({ cfg, transform: fakeTransform(final(out)) })
      expect(report.skipped.map((s) => s.reason).join('\n')).toContain('LLM-kimenet elvetve')
      expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_fallback: true')
    }
  })

  it('jó transform-kimenet megy, jelző nélkül', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg, transform: valid() })
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
    const report = await deployNotes({ cfg, transform: fakeTransform(final('<Foo />')) })
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
    const report = await deployNotes({ cfg })
    expect(report.pendingCommits).toBe(1)
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
    // az ok is látszik, nem csak a „Command failed: git push”
    expect(deployLines(first).join('\n')).toContain('pre-receive hook declined')
    expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(false)
    await rm(join(remote, 'deny'))
    const second = await deployNotes({ cfg })
    expect(second.push?.pushed).toBe(true)
    expect(second.pendingCommits).toBe(1)
    expect(deployLines(second)).toContain('deploy: korábbi futás függő munkája is kimegy: 1 commit')
    expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(true)
    const third = await deployNotes({ cfg })
    expect(third.pendingCommits).toBe(0)
    expect(deployLines(third).join('\n')).not.toContain('függő munka')
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

  describe('útvonalak', () => {
    const read = (target: string) => readFile(join(clone, 'content', 'notes', target), 'utf8')

    it('kártya végleges, átalakító nélkül is', async () => {
      await note('vid1', 'flashcards', BASE, '# Cím\n\n## K\n\nV\n')
      const report = await deployNotes({ cfg })
      const out = await show('content/notes/vid1/flashcards.hu.mdx')
      expect(out).toContain('<Accordions')
      expect(out).not.toContain('mdx_fallback')
      expect(report.written).toEqual(['vid1/flashcards.hu.mdx'])
      expect((await deployNotes({ cfg })).written).toEqual([])
    })

    it('régi fallback kártya átalakító nélkül is újraíródik', async () => {
      await note('vid1', 'flashcards', BASE, '# Cím\n\n## K\n\nV\n')
      const target = join(clone, 'content', 'notes', 'vid1', 'flashcards.hu.mdx')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(
        target,
        `---\n${stringify({ item_id: 'vid1', title: 'Cím', kind: 'flashcards', language: 'hu', generated_at: 'T1', source: 'youtube', origin: 'cli', mdx_fallback: true })}---\n\nrégi\n`,
      )
      await deployNotes({ cfg })
      const out = await read('vid1/flashcards.hu.mdx')
      expect(out).toContain('<Accordions')
      expect(out).not.toContain('mdx_fallback')
    })

    it('nem bontható kártya mdx_failed-et kap, és nem íródik újra', async () => {
      await note('vid1', 'qa', BASE, '# Cím\n\nCsak szöveg\n')
      await deployNotes({ cfg })
      const out = await show('content/notes/vid1/qa.hu.mdx')
      expect(out).toContain('mdx_fallback: true')
      expect(out).toContain('mdx_failed: T1')
      expect((await deployNotes({ cfg })).written).toEqual([])
    })

    it('szójegyzék végleges', async () => {
      await note('vid1', 'summary', BASE)
      await note('vid1', 'glossary-hu', { title: 'Cím', language: 'hu', source_language: 'en' }, '| a | b |\n')
      await git(vault, 'add', '.')
      await git(vault, 'commit', '-qm', 'vault')
      await deployNotes({ cfg })
      expect(await show('content/notes/vid1/glossary.hu.mdx')).not.toContain('mdx_fallback')
    })

    it('LLM-fajta transform nélkül fallback, mdx_failed nélkül', async () => {
      await note('vid1', 'summary', BASE)
      await deployNotes({ cfg })
      const out = await show('content/notes/vid1/summary.hu.mdx')
      expect(out).toContain('mdx_fallback: true')
      expect(out).not.toContain('mdx_failed')
    })

    it('kétszer bukott oldal mdx_failed-et kap, a következő futás nem hív, a --retry-failed igen', async () => {
      const vaultPath = await note('vid1', 'summary', BASE)
      const transform = fakeTransform({ kind: 'failed', reason: 'szó szerinti eltérés' })
      const report = await deployNotes({ cfg, transform })
      const out = await show('content/notes/vid1/summary.hu.mdx')
      expect(out).toContain('mdx_fallback: true')
      expect(out).toContain('mdx_failed: T1')
      expect(report.skipped.map((s) => s.reason).join('\n')).toContain('LLM-kimenet elvetve')
      const second = await deployNotes({ cfg, transform })
      expect(transform.calls).toBe(1)
      expect(second.skipped).toContainEqual({
        path: vaultPath,
        target: 'vid1/summary.hu.mdx',
        reason: 'mdx_failed (--retry-failed nélkül)',
      })
      expect(deployLines(second)).toContain('  kihagyva: vid1_summary.md — mdx_failed (--retry-failed nélkül)')
      const retried = await deployNotes({ cfg, transform, retryFailed: true })
      expect(transform.calls).toBe(2)
      expect(retried.planned).toEqual([{ target: 'vid1/summary.hu.mdx', action: 'retry', route: 'llm' }])
      // új generated_at mellett retryFailed nélkül is hív
      await note('vid1', 'summary', { ...BASE, generated_at: 'T2' })
      await deployNotes({ cfg, transform })
      expect(transform.calls).toBe(3)
    })

    it('a plafon után nincs LLM-hívás, a kint lévő oldal marad', async () => {
      await note('vid1', 'summary', BASE)
      await deployNotes({ cfg })
      const before = await read('vid1/summary.hu.mdx')
      await note('vid2', 'summary', BASE)
      const report = await deployNotes({ cfg, transform: fakeTransform({ kind: 'budget' }) })
      expect(await read('vid1/summary.hu.mdx')).toBe(before)
      expect(report.written).toEqual(['vid2/summary.hu.mdx'])
      const fresh = await show('content/notes/vid2/summary.hu.mdx')
      expect(fresh).toContain('mdx_fallback: true')
      expect(fresh).not.toContain('mdx_failed')
      // a következő futás átalakítja
      await deployNotes({ cfg, transform: valid() })
      expect(await show('content/notes/vid2/summary.hu.mdx')).not.toContain('mdx_fallback')
    })

    it('plafon egy futásban: az első végleges, a kint lévő fallback érintetlen, az új fallback mdx_failed nélkül', async () => {
      await note('vid1', 'summary', BASE)
      await note('vid2', 'summary', BASE)
      await note('vid3', 'summary', BASE)
      await deployNotes({ cfg }) // mind a háromból fallback kerül ki
      await note('vid1', 'summary', { ...BASE, generated_at: 'T2' }) // újragenerált: sorra kerül
      await note('vid4', 'summary', BASE) // új oldal
      const before = await read('vid2/summary.hu.mdx')
      const transform = fakeTransform(final('Jó <Callout type="note">x</Callout>'), { kind: 'budget' })
      await deployNotes({ cfg, transform })
      expect(await read('vid1/summary.hu.mdx')).not.toContain('mdx_fallback')
      expect(await read('vid2/summary.hu.mdx')).toBe(before)
      const fresh = await read('vid4/summary.hu.mdx')
      expect(fresh).toContain('mdx_fallback: true')
      expect(fresh).not.toContain('mdx_failed')
    })

    it('átalakított oldal a második futásban 0 hívás, 0 commit', async () => {
      await note('vid1', 'summary', BASE)
      const transform = valid()
      await deployNotes({ cfg, transform })
      const report = await deployNotes({ cfg, transform })
      expect(transform.calls).toBe(1)
      expect(report.commits).toBe(0)
    })

    it('a végleges kimenetet a deploy is ellenőrzi', async () => {
      await note('vid1', 'summary', BASE)
      const report = await deployNotes({ cfg, transform: fakeTransform(final('<Foo />')) })
      const out = await show('content/notes/vid1/summary.hu.mdx')
      expect(out).toContain('mdx_fallback: true')
      expect(out).toContain('mdx_failed: T1')
      expect(report.skipped.map((s) => s.reason).join('\n')).toContain('ismeretlen komponens')
    })

    it('a transform dobása is mdx_failed', async () => {
      await note('vid1', 'summary', BASE)
      const transform = fakeTransform(new Error('finish_reason: length\nrészletek'))
      const report = await deployNotes({ cfg, transform })
      expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('mdx_failed: T1')
      expect(report.skipped.map((s) => s.reason)).toContain('LLM-kimenet elvetve: finish_reason: length')
      await deployNotes({ cfg, transform })
      expect(transform.calls).toBe(1)
      await deployNotes({ cfg, transform, retryFailed: true })
      expect(transform.calls).toBe(2)
    })
  })

  it('deployLines kiírja a költséget', () => {
    const base = { written: [], skipped: [], commits: 0, push: null, planned: [], unchanged: 0, pendingCommits: 0 }
    const usage = { inputTokens: 10, outputTokens: 20, usd: 0.0123, budgetSkipped: 1 }
    expect(deployLines({ ...base, transform: usage })).toContain(
      'deploy: átalakítás: 10+20 token, 0.0123 $, 1 oldal kimaradt a költségplafon miatt',
    )
    expect(deployLines({ ...base, transform: { ...usage, budgetSkipped: 0 } })).toContain(
      'deploy: átalakítás: 10+20 token, 0.0123 $',
    )
    expect(deployLines({ ...base, transform: null }).join('\n')).not.toContain('átalakítás')
  })

  it('showroom blokk nélkül dob', async () => {
    await expect(deployNotes({ cfg: { ...cfg, showroom: null } })).rejects.toThrow('showroom')
  })
})

describe('szűrés', () => {
  const translation = (kind: string, language: string, extra: Record<string, unknown> = {}) => ({
    ...BASE,
    language,
    translation_of: kind,
    source_language: 'hu-orig',
    source_generated_at: 'T1',
    ...extra,
  })

  it('tételszűrés: más tételre nem hív modellt és nem ír', async () => {
    await note('A', 'summary', BASE)
    await note('B', 'summary', BASE)
    const transform = valid()
    const report = await deployNotes({ cfg, transform, filter: { items: ['A'] } })
    expect(transform.calls).toBe(1)
    expect(report.written).toEqual(['A/summary.hu.mdx'])
    expect(await remoteHas('content/notes/B/summary.hu.mdx')).toBe(false)
  })

  it('ismeretlen tétel a klón érintése előtt hibát ad', async () => {
    await note('A', 'summary', BASE)
    const transform = valid()
    const before = [await git(clone, 'rev-parse', 'HEAD'), await git(clone, 'status', '--porcelain')]
    await expect(deployNotes({ cfg, transform, filter: { items: ['A', 'X', 'Y'] } })).rejects.toThrow(
      '--item: nincs ilyen tétel a vaultban: X, Y',
    )
    await expect(deployNotes({ cfg, transform, filter: { kinds: ['clean', 'foo'] } })).rejects.toThrow(
      '--kind: ismeretlen fajta: foo. Ismert: clean, clean-mild',
    )
    expect([await git(clone, 'rev-parse', 'HEAD'), await git(clone, 'status', '--porcelain')]).toEqual(before)
    expect(transform.calls).toBe(0)
  })

  it('fajtaszűrés: summary mindkét nyelven, clean minden clean-*', async () => {
    await note('vid1', 'summary', BASE)
    await note('vid1', 'summary-en', translation('summary', 'en'))
    await note('vid1', 'notes', BASE)
    await note('vid1', 'clean-mild', BASE)
    await note('vid1', 'clean-deep', BASE)
    const first = await deployNotes({ cfg, filter: { kinds: ['summary'] } })
    expect(first.written.sort()).toEqual(['vid1/summary.en.mdx', 'vid1/summary.hu.mdx'])
    const second = await deployNotes({ cfg, filter: { kinds: ['clean'] } })
    expect(second.written.sort()).toEqual(['vid1/clean-deep.hu.mdx', 'vid1/clean-mild.hu.mdx'])
  })

  it('fajtaszűrés: a kizárt fajta kihagyása nem látszik, a kiválasztotté igen', async () => {
    await note('vid1', 'summary', BASE)
    const summaryDe = await note('vid1', 'summary-de', translation('summary', 'de', { language: 'de' }))
    await note('vid1', 'qa-de', translation('qa', 'de', { language: 'de' }))
    const report = await deployNotes({ cfg, filter: { kinds: ['summary'] } })
    expect(report.skipped).toEqual([{ path: summaryDe, reason: 'nyelv: de' }])
  })

  it('fajtaszűrés mellett a szójegyzék megkapja a testvér forrás-adatát', async () => {
    await note('vid1', 'summary', BASE)
    await note('vid1', 'glossary-hu', { title: 'Cím', language: 'hu', source_language: 'en' }, '| a | b |\n')
    await git(vault, 'add', '.')
    await git(vault, 'commit', '-qm', 'vault')
    const report = await deployNotes({ cfg, filter: { kinds: ['glossary'] } })
    expect(report.written).toEqual(['vid1/glossary.hu.mdx'])
    expect(await show('content/notes/vid1/glossary.hu.mdx')).toContain('source: youtube')
  })

  it('fajtaszűrt futás meta.json-ja a teljes futás címét írja', async () => {
    await note('vid1', 'summary', { ...BASE, title: 'Eredeti' })
    await note('vid1', 'summary-en', translation('summary', 'en', { title: 'Translated' }))
    await deployNotes({ cfg, filter: { kinds: ['summary'] } })
    expect(JSON.parse(await show('content/notes/vid1/meta.json'))).toEqual({ title: 'Eredeti' })
    await note('vid2', 'clean-deep', { ...BASE, title: 'Mély' })
    await note('vid2', 'summary', { ...BASE, title: 'Össz' })
    await deployNotes({ cfg, filter: { kinds: ['summary'] } })
    expect(JSON.parse(await show('content/notes/vid2/meta.json'))).toEqual({ title: 'Mély' })
  })

  it('csatorna- és forrásszűrés a vault frontmatterén, kis- és nagybetű nélkül', async () => {
    await note('A', 'summary', { ...BASE, channel: 'Csatorna A' })
    await note('B', 'summary', { ...BASE, channel: 'Más' })
    const byChannel = await deployNotes({ cfg, filter: { channel: 'csatorna a' } })
    expect(byChannel.written).toEqual(['A/summary.hu.mdx'])
    const bySource = await deployNotes({ cfg, filter: { source: 'YOUTUBE', items: ['B'] } })
    expect(bySource.written).toEqual(['B/summary.hu.mdx'])
  })

  it('semmire nem illeszkedő szűrés: nincs találat, a klón érintetlen', async () => {
    await note('A', 'summary', { ...BASE, channel: 'Csatorna A' })
    await mkdir(join(clone, 'content', 'notes', 'vid9'), { recursive: true })
    await writeFile(join(clone, 'content', 'notes', 'vid9', 'summary.hu.mdx'), 'maradék')
    const before = [await git(clone, 'rev-parse', 'HEAD'), await git(clone, 'status', '--porcelain')]
    for (const filter of [
      { items: ['A'], channel: 'Más' },
      { items: ['A'], kinds: ['qa'] },
    ]) {
      const report = await deployNotes({ cfg, filter })
      expect(report).toMatchObject({ noMatch: true, commits: 0, push: null })
      expect(deployLines(report)).toEqual(['deploy: Nincs a szűrőnek megfelelő jegyzet.'])
      expect([await git(clone, 'rev-parse', 'HEAD'), await git(clone, 'status', '--porcelain')]).toEqual(before)
    }
  })
})

describe('újragenerálás', () => {
  const CARDS = '# Cím\n\n## K\n\nV\n'

  it('--item a változatlan LLM-es oldalt újra a modellre küldi, nélküle nem', async () => {
    await note('vid1', 'summary', BASE)
    await note('vid2', 'summary', BASE)
    await deployNotes({ cfg, transform: valid() })
    const t = fakeTransform(final('Új <Callout type="note">y</Callout>'))
    await deployNotes({ cfg, transform: t })
    expect(t.calls).toBe(0)
    const report = await deployNotes({ cfg, transform: t, filter: { items: ['vid1'], kinds: ['summary'] } })
    expect(t.calls).toBe(1)
    expect(report.planned).toEqual([{ target: 'vid1/summary.hu.mdx', action: 'regenerate', route: 'llm' }])
    expect(await show('content/notes/vid1/summary.hu.mdx')).toContain('y</Callout>')
    expect(await show('content/notes/vid2/summary.hu.mdx')).toContain('x</Callout>')
  })

  it('--item kind nélkül a tétel minden oldalát újragenerálja', async () => {
    await note('vid1', 'summary', BASE)
    await note('vid1', 'notes', BASE)
    await note('vid1', 'qa', BASE, CARDS)
    await deployNotes({ cfg, transform: valid() })
    const t = valid()
    const report = await deployNotes({ cfg, transform: t, filter: { items: ['vid1'] } })
    expect(report.planned.map((p) => p.action)).toEqual(['regenerate', 'regenerate', 'regenerate'])
    expect(t.calls).toBe(2)
  })

  it('--item felülírja az mdx_failed-et', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg, transform: fakeTransform({ kind: 'failed', reason: 'rossz' }) })
    const t = valid()
    const report = await deployNotes({ cfg, transform: t, filter: { items: ['vid1'] } })
    expect(report.planned[0]?.action).toBe('retry')
    expect(t.calls).toBe(1)
  })

  it('elbukott újragenerálás nem rontja a kint lévő oldalt', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg, transform: valid() })
    const before = await show('content/notes/vid1/summary.hu.mdx')
    for (const t of [
      fakeTransform({ kind: 'failed', reason: 'rossz' }),
      fakeTransform(new Error('hálózat')),
      fakeTransform(final('<Callout>')),
    ]) {
      const report = await deployNotes({ cfg, transform: t, filter: { items: ['vid1'] } })
      const after = await show('content/notes/vid1/summary.hu.mdx')
      expect(after).toBe(before)
      expect(after).not.toMatch(/mdx_fallback|mdx_failed/)
      expect(report.commits).toBe(0)
      expect(report.skipped[0]?.reason).toMatch(/; a kint lévő oldal marad$/)
    }
  })

  it('bájtra azonos újragenerálás nem ír és nem commitol', async () => {
    await note('vid1', 'qa', BASE, CARDS)
    await deployNotes({ cfg })
    const report = await deployNotes({ cfg, filter: { items: ['vid1'] } })
    expect(report.planned[0]?.action).toBe('regenerate')
    expect(report.written).toEqual([])
    expect(report.commits).toBe(0)
  })
})

describe('szárazfutás', () => {
  const CARDS = '# Cím\n\n## K\n\nV\n'
  const deny = async () => {
    const hook = join(remote, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\n[ -e "$(dirname "$0")/../deny" ] && exit 1\nexit 0\n')
    await chmod(hook, 0o755)
    await writeFile(join(remote, 'deny'), '')
  }

  it('nem ír, nem commitol, nem pushol, nem hív modellt', async () => {
    await note('vid1', 'summary', BASE)
    await mkdir(join(clone, 'content', 'notes', 'vid9'), { recursive: true })
    await writeFile(join(clone, 'content', 'notes', 'vid9', 'summary.hu.mdx'), 'maradék')
    const state = async () => [
      await git(clone, 'rev-parse', 'HEAD'),
      await git(clone, 'status', '--porcelain'),
      await git(remote, 'rev-parse', 'main'),
      await git(vault, 'status', '--porcelain'),
    ]
    const before = await state()
    const t = valid()
    const report = await deployNotes({ cfg, transform: t, dryRun: true })
    expect(await state()).toEqual(before)
    expect(t.calls).toBe(0)
    expect(report).toMatchObject({ commits: 0, push: null })
    expect(report.planned).toEqual([{ target: 'vid1/summary.hu.mdx', action: 'new', route: 'llm' }])
  })

  it('a lista és az utána futó éles deploy ugyanazt választja', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg, itemIds: new Set(['vid1']) })
    await note('vid3', 'notes', BASE)
    await deployNotes({ cfg, itemIds: new Set(['vid3']), transform: fakeTransform({ kind: 'failed', reason: 'rossz' }) })
    await note('vid4', 'summary', BASE)
    await deployNotes({ cfg, itemIds: new Set(['vid4']), transform: valid() })
    await note('vid2', 'qa', BASE, CARDS)
    const transform = fakeTransform({ kind: 'failed', reason: 'rossz' })
    for (const opts of [{}, { retryFailed: true }, { filter: { items: ['vid4'] } }]) {
      const calls = transform.calls
      const dry = await deployNotes({ cfg, transform, dryRun: true, ...opts })
      expect(transform.calls).toBe(calls)
      const live = await deployNotes({ cfg, transform, ...opts })
      expect(dry.planned).toEqual(live.planned)
      expect(dry.unchanged).toBe(live.unchanged)
      // az átalakítás kimenetén múló kihagyásokat a szárazfutás nem ismeri
      const failed = (r: DeployReport) => r.skipped.filter((x) => x.reason.startsWith('mdx_failed'))
      expect(failed(dry)).toEqual(failed(live))
      if (opts.retryFailed) {
        expect(live.planned).toContainEqual({ target: 'vid3/notes.hu.mdx', action: 'retry', route: 'llm' })
      } else if (opts.filter) {
        expect(live.planned).toEqual([{ target: 'vid4/summary.hu.mdx', action: 'regenerate', route: 'llm' }])
      } else {
        expect(live.skipped).toContainEqual(expect.objectContaining({ target: 'vid3/notes.hu.mdx', reason: 'mdx_failed (--retry-failed nélkül)' }))
      }
    }
  })

  it('előrébb járó távoli main oldalát változatlannak látja', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg })
    await git(clone, 'reset', '-q', '--hard', 'HEAD~1')
    const head = await git(clone, 'rev-parse', 'HEAD')
    const report = await deployNotes({ cfg, dryRun: true })
    expect(report.planned).toEqual([])
    expect(report.unchanged).toBe(1)
    expect(await git(clone, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('pusholatlan helyi commit oldalát változatlannak látja', async () => {
    await note('vid1', 'summary', BASE)
    await deny()
    expect((await deployNotes({ cfg })).push?.pushed).toBe(false)
    const dry = await deployNotes({ cfg, dryRun: true })
    expect(dry.planned).toEqual([])
    expect(dry.unchanged).toBe(1)
    await rm(join(remote, 'deny'))
    const live = await deployNotes({ cfg })
    expect(live.planned).toEqual([])
    expect(live.pendingCommits).toBe(1)
  })

  it('átalakító nélkül az --item a végleges LLM-es oldalt változatlannak látja, szárazfutásban is', async () => {
    await note('vid1', 'summary', BASE)
    await deployNotes({ cfg, transform: valid() })
    const filter = { items: ['vid1'] }
    const dry = await deployNotes({ cfg, dryRun: true, filter })
    const live = await deployNotes({ cfg, filter })
    expect(dry.planned).toEqual([])
    expect(live.planned).toEqual([])
    expect(dry.unchanged).toBe(1)
    expect(live.written).toEqual([])
  })

  it('dryRunLines jelzi a függő munkát', () => {
    const report: DeployReport = { written: [], skipped: [], commits: 0, push: null, transform: null, planned: [], unchanged: 0, pendingCommits: 2 }
    expect(dryRunLines(report, true)).toEqual([
      'deploy (szárazfutás): korábbi futás függő munkája is kimegy: 2 commit',
      'deploy (szárazfutás): nincs mit írni; 0 kihagyva, 0 változatlan',
    ])
  })

  it('dryRunLines a mintát követi', () => {
    const report: DeployReport = {
      written: [],
      skipped: [{ path: '/v/B_notes-de.md', reason: 'nyelv: de' }],
      commits: 0,
      push: null,
      transform: null,
      planned: [
        { target: 'S/clean-moderate.hu.mdx', action: 'update', route: 'llm' },
        { target: 'Q/qa.hu.mdx', action: 'new', route: 'cards' },
        { target: 'Q/glossary.hu.mdx', action: 'regenerate', route: 'plain' },
        { target: 'Q/notes.hu.mdx', action: 'retry', route: 'llm' },
      ],
      unchanged: 4,
      pendingCommits: 0,
    }
    expect(dryRunLines(report, true)).toEqual([
      '  frissítés      S/clean-moderate.hu.mdx  LLM',
      '  új             Q/qa.hu.mdx              kód',
      '  újragenerálás  Q/glossary.hu.mdx        escape',
      '  frissítés      Q/notes.hu.mdx           LLM (mdx_failed, újrapróbálva)',
      '  kihagyva       B_notes-de.md            nyelv: de',
      'deploy (szárazfutás): 4 oldalt írna, ebből 2 oldalhoz hívna modellt; 1 kihagyva, 4 változatlan',
    ])
    const noLlm = dryRunLines(report, false)
    expect(noLlm[0]).toBe('  frissítés      S/clean-moderate.hu.mdx  fallback, nincs átalakító')
    expect(noLlm.at(-1)).toContain('ebből 0 oldalhoz')
    expect(dryRunLines({ ...report, planned: [] }, true)).toEqual([
      '  kihagyva  B_notes-de.md  nyelv: de',
      'deploy (szárazfutás): nincs mit írni; 1 kihagyva, 4 változatlan',
    ])
  })
})

describe('deployHeader', () => {
  it('deployHeader a szűrést és a modellt írja', () => {
    expect(deployHeader({ items: ['SlGRN8jh2RI'], kinds: ['summary'] }, { dryRun: false })).toBe('deploy: szűrés: tétel: SlGRN8jh2RI; fajta: summary')
    expect(deployHeader({ items: ['a', 'b'] }, { dryRun: true })).toBe('deploy (szárazfutás): szűrés: tétel: a, b')
    expect(deployHeader({}, { dryRun: true })).toBe('deploy (szárazfutás): szűrés nélkül')
    expect(deployHeader({ channel: 'X' }, { dryRun: false, model: 'm' })).toBe('deploy: szűrés: csatorna: X · modell: m')
    expect(deployHeader({}, { dryRun: false })).toBeNull()
  })
})
