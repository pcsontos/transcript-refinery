import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import type { deployNotes } from '../deploy/deploy.js'
import { currentScope, RecipeTimeout } from '../model/deadline.js'
import type { RunRuntime } from '../cli.js'
import { GLOSSARY_SEPARATOR } from '../recipe/glossary.js'
import { textItemId } from '../source/text.js'
import { gitCommitPaths, gitPullFfOnly, gitPush, gitRestorePaths } from '../vault/git.js'
import type { CallbackBody } from './job.js'
import { openState } from '../state/db.js'
import { CANCELLED_RUN, runRecipes } from './summary.js'

const ID = 'abcdefghijk'

function client(calls: { generate: number }): ReturnType<RunRuntime['createClient'] & object> {
  return {
    generate() {
      calls.generate += 1
      return Promise.resolve({
        value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    },
    generateObject<T>() {
      return Promise.resolve({
        value: { score: 1, gaps: [] } as T,
        usage: { inputTokens: 5, outputTokens: 2 },
      })
    },
  }
}

const GERMAN = '## Zusammenfassung\n\nDas ist ein Satz aus der Notiz, und er ist für die Zusammenfassung nicht schlecht.\n'
const HUNGARIAN =
  '## Összefoglaló\n\nEz a videó arról szól, hogy a figyelem és a türelem hogyan segít a tanulásban, és a tanító azt mondja, hogy nem kell sietni.\n'

/** A summary-hívásra a `summaryText`-et, a német fordítás kérésére a német szöveget adja. */
function writer(calls: { generate: number }, summaryText: string): ReturnType<RunRuntime['createClient'] & object> {
  return {
    ...client(calls),
    generate(_role, prompt) {
      calls.generate += 1
      return Promise.resolve({
        value: prompt.startsWith('Translate the note below into German') ? `${GERMAN}${GLOSSARY_SEPARATOR}\n` : summaryText,
        usage: { inputTokens: 10, outputTokens: 5 },
      })
    },
  }
}

function gitWith(push: typeof gitPush = gitPush) {
  return { pull: gitPullFfOnly, commit: gitCommitPaths, push, restore: gitRestorePaths }
}

const TRANSCRIPT = 'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_transcript.md'

async function scene(
  costLimitUsd = 5,
  modelExtra: Record<string, unknown> = {},
  pricingExtra: Record<string, unknown> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'refinery-summary-'))
  const origin = join(root, 'origin.git')
  const vault = join(root, 'vault')
  const outDir = join(root, 'telegram')
  await mkdir(outDir, { recursive: true })
  await mkdir(join(root, 'state'), { recursive: true })
  await mkdir(join(root, 'logs'), { recursive: true })
  await writeFile(
    join(outDir, `Beszéd [${ID}].hu.vtt`),
    'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello from the video.\n',
  )
  await writeFile(
    join(outDir, `Beszéd [${ID}].info.json`),
    JSON.stringify({ id: ID, title: 'Beszéd', language: 'hu' }),
  )
  execFileSync('git', ['init', '-b', 'main', vault])
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: vault })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: vault })
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: vault })
  execFileSync('git', ['init', '--bare', origin])
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: vault })
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: vault })
  const raw = {
    vault: { path: vault },
    sources: [outDir],
    state: { path: join(root, 'state', 'refinery.db') },
    logs: { dir: join(root, 'logs') },
    model: {
      base_url: 'http://localhost:4000/v1',
      draft: 'proba-draft',
      judge: 'proba-judge',
      ...modelExtra,
    },
    pricing: {
      'proba-draft': { input_per_million: 3, output_per_million: 15 },
      'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
      ...pricingExtra,
    },
    cost_limit_usd: costLimitUsd,
  }
  const load = () => Promise.resolve({ cfg: loadConfig(raw, join(root, 'refinery.config.yaml'), root), raw })
  return { root, vault, outDir, load }
}

describe('runRecipes', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a jegyzet a vaultba kerül, a két fájl külön commitba megy, a link az átiratra mutat', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client(calls),
      load,
      git: gitWith(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.noteUrl).toBe(
      TRANSCRIPT,
    )
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--name-only', '--pretty=format:'], { cwd: vault, encoding: 'utf8' })
    expect(names.split('\n').filter(Boolean).sort()).toEqual([
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
    expect(execFileSync('git', ['log', '-2', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim().split('\n')).toEqual([
      'docs(transcript-refinery): summary | Beszéd [abcdefghijk]',
      'docs(transcript-refinery): transcript | Beszéd [abcdefghijk]',
    ])
    const second = { generate: 0 }
    const again = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client(second),
      load,
      git: gitWith(),
    })
    expect(again).toEqual(result)
    expect(second.generate).toBe(0)
  })

  describe('a Worker modellfelülírása (#292)', () => {
    const SWITCH = { switchable: { 'proba-sonnet': 'structured', 'proba-draft': 'text' } }
    const EXTRA = { 'proba-sonnet': { input_per_million: 3, output_per_million: 15 } }
    const headOf = (vault: string) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: vault, encoding: 'utf8' })

    it('a kért modell a jegyzet frontmatterjébe és a futásnapló parancsába kerül', async () => {
      process.env.LITELLM_API_KEY = 'sk-proba'
      const { root, vault, outDir, load } = await scene(5, SWITCH, EXTRA)
      roots.push(root)
      const result = await runRecipes({
        videoId: ID,
        recipes: ['summary'],
        outDir,
        models: { summary: 'proba-sonnet' },
        createClient: () => client({ generate: 0 }),
        load,
        git: gitWith(),
      })
      expect(result.ok).toBe(true)
      const note = await readFile(
        join(vault, 'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary.md'),
        'utf8',
      )
      expect(note).toMatch(/\nmodel: proba-sonnet\n/)
      const logs = (await readdir(join(root, 'logs'))).filter((name) => name.endsWith('.jsonl'))
      const started = (await Promise.all(logs.map((name) => readFile(join(root, 'logs', name), 'utf8'))))
        .flatMap((text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; command?: string }))
        .find((event) => event.type === 'run:started')
      expect(started?.command).toBe('serve recipes summary=proba-sonnet')
    })

    it('a fordítás a translate-nek megfelelő recept-azonosítón kapja a felülírást', async () => {
      process.env.LITELLM_API_KEY = 'sk-proba'
      const { root, vault, outDir, load } = await scene(5, SWITCH, EXTRA)
      roots.push(root)
      const git = gitWith()
      await runRecipes({ videoId: ID, outDir, recipes: ['summary'], createClient: () => writer({ generate: 0 }, HUNGARIAN), load, git })
      const result = await runRecipes({
        videoId: ID,
        outDir,
        recipes: ['summary'],
        lang: 'de',
        models: { 'summary-de': 'proba-draft' },
        createClient: () => writer({ generate: 0 }, HUNGARIAN),
        load,
        git,
      })
      expect(result.ok).toBe(true)
      const note = await readFile(
        join(vault, 'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary-de.md'),
        'utf8',
      )
      expect(note).toMatch(/\nmodel: proba-draft\n/)
    })

    it.each([
      ['ár nélküli modell', 'summary', 'nincs-ara', 'pricing: nincs ára'],
      ['nem váltható modell', 'summary', 'proba-judge', 'model: nem váltható modell'],
      ['text modell sémás receptnél', 'notes', 'proba-draft', 'model: nem váltható modell'],
    ])('%s: hiba, modellhívás és vault-változás nélkül', async (_name, recipe, model, message) => {
      process.env.LITELLM_API_KEY = 'sk-proba'
      const { root, vault, outDir, load } = await scene(5, SWITCH, EXTRA)
      roots.push(root)
      const before = headOf(vault)
      const calls = { generate: 0 }
      const result = await runRecipes({
        videoId: ID,
        recipes: [recipe],
        outDir,
        models: { [recipe]: model },
        createClient: () => client(calls),
        load,
        git: gitWith(),
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.startsWith(message)).toBe(true)
      expect(calls.generate).toBe(0)
      expect(headOf(vault)).toBe(before)
    })
  })

  it('a szöveges tétel a --file úton fut: jegyzet t- azonosítóval, a második kérés modell nélkül', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const text =
      'Ez a beszéd arról szól, hogy a figyelem és a türelem hogyan segít a tanulásban, és a tanító azt mondja, hogy nem kell sietni.'
    const id = await textItemId(text)
    // A scene feliratát a futás eleji takarítás (keepThisVideo) elviszi, mert nem ehhez az azonosítóhoz tartozik.
    await writeFile(join(outDir, `Beszéd [${id}].txt`), text)
    await writeFile(join(outDir, `Beszéd [${id}].info.json`), JSON.stringify({ id, title: 'Beszéd' }))
    const calls = { generate: 0 }
    const run = (createClient: RunRuntime['createClient']) =>
      runRecipes({ videoId: id, recipes: ['summary'], outDir, createClient, load, git: gitWith() })
    const result = await run(() => client(calls))
    expect(result).toEqual({ ok: true, noteUrl: `Inbox/transcript-refinery/telegram/${id}/Beszéd [${id}]_transcript.md` })
    const note = await readFile(join(vault, `Inbox/transcript-refinery/telegram/${id}/Beszéd [${id}]_summary.md`), 'utf8')
    expect(note).toMatch(new RegExp(`item_id: "?${id}"?\\n`))
    expect(note).toContain('origin: telegram\n')
    // A cím az info.json tiszta címe, a belső fájlnév utótagja és kiterjesztése nem szivároghat be.
    expect(note).toMatch(/\ntitle: Beszéd\n/)
    expect(note).not.toContain(`[${id}]`)
    expect(note).not.toMatch(/^source_file:/m)
    expect(note).not.toMatch(/^video_id:/m)
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim()).toBe(
      `docs(transcript-refinery): summary | Beszéd [${id}]`,
    )
    const again = { generate: 0 }
    expect(await run(() => client(again))).toEqual(result)
    expect(again.generate).toBe(0)
  })

  it('egy megmaradt szöveges fájl a videó azonosítóját a címében hordozva sem viszi el a videó futását', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    // Egy /scan szöveg első sora egy videólink volt: a fájl neve tartalmazza a videó azonosítóját.
    await writeFile(join(outDir, `https：⧸⧸youtu.be⧸${ID} [t-0123456789abcdef].txt`), 'Valami régi szöveg.')
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitWith(),
    })
    expect(result).toEqual({ ok: true, noteUrl: TRANSCRIPT })
  })

  it('az idegen felirat nem hív modellt és nem kerül a commitba', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    await writeFile(
      join(outDir, 'Más [zzzzzzzzzzz].hu.vtt'),
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOther video.\n',
    )
    await writeFile(
      join(outDir, 'Más [zzzzzzzzzzz].info.json'),
      JSON.stringify({ id: 'zzzzzzzzzzz', title: 'Más', language: 'hu' }),
    )
    const calls = { generate: 0 }
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client(calls),
      load,
      git: gitWith(),
    })
    expect(result.ok).toBe(true)
    expect(calls.generate).toBe(1)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--name-only', '--pretty=format:'], {
      cwd: vault,
      encoding: 'utf8',
    })
    expect(names).not.toContain('zzzzzzzzzzz')
    expect(names.split('\n').filter(Boolean).sort()).toEqual([
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
  })

  it('a vault remote-ja nem számít: alapértelmezett gittel, nem GitHub originnal is kész, vault-relatív úttal', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
    })
    expect(result).toEqual({ ok: true, noteUrl: TRANSCRIPT })
  })

  it('a serve futása origin: telegram jegyzetet ír', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitWith(),
    })
    expect(result.ok).toBe(true)
    for (const kind of ['transcript', 'summary']) {
      const note = await readFile(join(vault, 'Inbox/transcript-refinery/telegram', ID, `Beszéd [${ID}]_${kind}.md`), 'utf8')
      expect(note).toContain('origin: telegram\n')
    }
  })

  it('a pull hibája modellhívás nélkül megáll', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client(calls),
      load,
      git: { ...gitWith(), pull: () => Promise.reject(new Error('diverged')) },
    })
    expect(result).toEqual({ ok: false, error: 'A vault frissítése nem sikerült.' })
    expect(calls.generate).toBe(0)
  })

  it('a push hibája után a commit a gépen marad', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load,
      git: gitWith(() => Promise.resolve({ pushed: false })),
    })
    expect(result).toEqual({ ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' })
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--name-only', '--pretty=format:'], { cwd: vault, encoding: 'utf8' })
    expect(names.split('\n').filter(Boolean).sort()).toEqual([
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
  })

  it('a plafon nulla modellhívással megáll', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene(0.0001)
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client(calls),
      load,
      git: gitWith(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/^A futás megállt: már az első elem becsült költsége/)
    expect(calls.generate).toBe(0)
  })

  it('a recept hibája után az átirat megmarad', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => ({
        generate: () => Promise.reject(new Error('szimulált hiba')),
        generateObject: <T>() => Promise.resolve({ value: { score: 1, gaps: [] } as T, usage: { inputTokens: 1, outputTokens: 1 } }),
      }),
      load,
      git: gitWith(),
    })
    expect(result).toEqual({ ok: false, error: 'szimulált hiba' })
    const transcript = join(vault, 'Inbox/transcript-refinery/telegram', ID, `Beszéd [${ID}]_transcript.md`)
    expect(execFileSync('git', ['cat-file', '-e', `HEAD:${transcript.slice(vault.length + 1)}`], { cwd: vault, encoding: 'utf8' })).toBe('')
  })

  it('a config hibájának első sora megy ki, kliens nélkül', async () => {
    const { root, outDir } = await scene()
    roots.push(root)
    let created = 0
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => {
        created += 1
        return client({ generate: 0 })
      },
      load: () => Promise.reject(new Error('Nincs konfigurációs fájl: x\nMásodik sor')),
      git: gitWith(),
    })
    expect(result).toEqual({ ok: false, error: 'Nincs konfigurációs fájl: x' })
    expect(created).toBe(0)
  })

  it('második kérés ugyanarra a videóra más recepttel: csak az új jegyzet kap commitot', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const run = (recipes: string[]) =>
      runRecipes({ videoId: ID, outDir, recipes, createClient: () => client({ generate: 0 }), load, git: gitWith() })
    expect((await run(['summary'])).ok).toBe(true)
    expect((await run(['qa'])).ok).toBe(true)

    const log = execFileSync('git', ['log', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim().split('\n')
    expect(log).toEqual([
      'docs(transcript-refinery): qa | Beszéd [abcdefghijk]',
      'docs(transcript-refinery): summary | Beszéd [abcdefghijk]',
      'docs(transcript-refinery): transcript | Beszéd [abcdefghijk]',
      'init',
    ])
  })

  it('két recept egy futásban: mindkét jegyzet és az átirat külön commitban', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary', 'qa'],
      createClient: () => client(calls),
      load,
      git: gitWith(),
    })
    expect(result).toEqual({
      ok: true,
      noteUrl:
        TRANSCRIPT,
    })
    expect(calls.generate).toBe(2)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--name-only', '--pretty=format:'], { cwd: vault, encoding: 'utf8' })
    expect(names.split('\n').filter(Boolean).sort()).toEqual([
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_qa.md',
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary.md',
      'Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_transcript.md',
    ].sort())
  })

  it('a fordítás a kért nyelvre a kész forrásból, a config fordítása nélkül', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const git = gitWith()
    const first = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], createClient: () => writer({ generate: 0 }, HUNGARIAN), load, git })
    expect(first.ok).toBe(true)
    const german = { generate: 0 }
    const result = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], lang: 'de', createClient: () => writer(german, HUNGARIAN), load, git })
    expect(result.ok).toBe(true)
    expect(german.generate).toBe(1)
    const names = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '--name-only', '--pretty=format:'], { cwd: vault, encoding: 'utf8' })
    expect(names).toContain('Inbox/transcript-refinery/telegram/abcdefghijk/Beszéd [abcdefghijk]_summary-de.md')
  })

  it('a videó saját nyelvére kért fordítás a kihagyás okát adja', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const git = gitWith()
    await runRecipes({ videoId: ID, outDir, recipes: ['summary'], createClient: () => writer({ generate: 0 }, HUNGARIAN), load, git })
    const calls = { generate: 0 }
    const result = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], lang: 'hu', createClient: () => writer(calls, HUNGARIAN), load, git })
    expect(result).toEqual({ ok: false, error: 'a forrás már magyar' })
    expect(calls.generate).toBe(0)
  })

  it('két recept közül az első után megszakítva: egy modellhívás, és a kész jegyzet sem kerül a vaultba (#83)', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const calls = { generate: 0 }
    const controller = new AbortController()
    const inner = client(calls)
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary', 'qa'],
      signal: controller.signal,
      createClient: () => ({
        ...inner,
        generate(...args: Parameters<typeof inner.generate>) {
          controller.abort()
          return inner.generate(...args)
        },
      }),
      load,
      git: gitWith(),
    })
    expect(calls.generate).toBe(1)
    expect(result).toEqual({ ok: false, error: CANCELLED_RUN })
    expect(execFileSync('git', ['log', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim()).toBe('init')
  })
})

describe('runRecipes — eredet (#85)', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function run(origin?: 'cli') {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    // A configban a forrás neve `sources` (a peter-mba-n a `/data/sources`), a munkamappáé `telegram`.
    const named = async () => {
      const loaded = await load()
      return { ...loaded, cfg: { ...loaded.cfg, sources: [{ name: 'sources', path: outDir }] } }
    }
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary'],
      createClient: () => client({ generate: 0 }),
      load: named,
      git: gitWith(),
      ...(origin === undefined ? {} : { origin }),
    })
    expect(result.ok).toBe(true)
    return { vault }
  }

  it('origin: cli → a config forrásneve alá kerül, és origin: cli a frontmatterben', async () => {
    const { vault } = await run('cli')
    const path = join(vault, TRANSCRIPT.replace('/telegram/', '/sources/'))
    expect(await readFile(path, 'utf8')).toContain('origin: cli')
  })

  it('origin nélkül marad a telegram mappa és az origin: telegram', async () => {
    const { vault } = await run()
    expect(await readFile(join(vault, TRANSCRIPT), 'utf8')).toContain('origin: telegram')
  })
})

describe('runRecipes — forceRecipe (#104)', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const texted = (text: string): ReturnType<RunRuntime['createClient'] & object> => ({
    ...client({ generate: 0 }),
    generate: () => Promise.resolve({ value: text, usage: { inputTokens: 10, outputTokens: 5 } }),
  })
  const SUMMARY = TRANSCRIPT.replace('_transcript.md', '_summary.md')

  it('újragenerálás után új jegyzet, egy recept-commit, átirat-commit nincs', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const base = { videoId: ID, outDir, recipes: ['summary'], load, git: gitWith() }
    expect((await runRecipes({ ...base, createClient: () => texted('## Összefoglaló\n\nRégi szöveg.\n') })).ok).toBe(true)
    const transcript = await readFile(join(vault, TRANSCRIPT), 'utf8')
    const second = await runRecipes({ ...base, forceRecipe: true, createClient: () => texted('## Összefoglaló\n\nÚj szöveg.\n') })
    expect(second.ok).toBe(true)
    expect(await readFile(join(vault, SUMMARY), 'utf8')).toContain('Új szöveg.')
    expect(await readFile(join(vault, TRANSCRIPT), 'utf8')).toBe(transcript)
    const files = execFileSync('git', ['-c', 'core.quotepath=false', 'show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: vault, encoding: 'utf8' })
    expect(files.trim()).toBe(SUMMARY)
  })

  it('megszakított újragenerálás: a régi jegyzet visszaáll', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const base = { videoId: ID, outDir, recipes: ['summary'], load, git: gitWith() }
    await runRecipes({ ...base, createClient: () => texted('## Összefoglaló\n\nRégi szöveg.\n') })
    const store = openState(join(root, 'state', 'refinery.db'))
    const cost = store.artifactOf(ID, 'summary')!.costUsd
    store.close()
    const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: vault, encoding: 'utf8' })
    const controller = new AbortController()
    const result = await runRecipes({
      ...base,
      forceRecipe: true,
      signal: controller.signal,
      createClient: () => ({
        ...texted('## Összefoglaló\n\nÚj szöveg.\n'),
        generate: () => {
          controller.abort()
          return Promise.resolve({ value: '## Összefoglaló\n\nÚj szöveg.\n', usage: { inputTokens: 1000, outputTokens: 500 } })
        },
      }),
    })
    expect(result).toEqual({ ok: false, error: CANCELLED_RUN })
    expect(await readFile(join(vault, SUMMARY), 'utf8')).toContain('Régi szöveg.')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: vault, encoding: 'utf8' }).trim()).toBe('')
    expect(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: vault, encoding: 'utf8' })).toBe(commits)
    const after = openState(join(root, 'state', 'refinery.db'))
    expect(after.artifactOf(ID, 'summary')!.costUsd).toBe(cost)
    expect(after.isDone(ID, 'summary')).toBe(true)
    after.close()
  })
})

describe('runRecipes — megszakítás (#83)', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  /** A modellhívás közben megszakít, majd rendes választ ad: a futó egység befejeződik. */
  function cancelling(controller: AbortController): ReturnType<RunRuntime['createClient'] & object> {
    const base = client({ generate: 0 })
    return {
      ...base,
      generate(role, prompt) {
        controller.abort()
        return base.generate(role, prompt)
      },
    }
  }

  const stateOf = (root: string) => openState(join(root, 'state', 'refinery.db'))
  const subjects = (vault: string) => execFileSync('git', ['log', '--format=%s'], { cwd: vault }).toString().trim().split('\n')

  it('modellhívás közbeni megszakítás után nincs commit, push, deploy, jegyzetfájl és done sor', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const controller = new AbortController()
    const deploy = vi.fn()
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary'],
      createClient: () => cancelling(controller),
      load,
      git: gitWith(),
      signal: controller.signal,
      deploy: deploy,
    })
    expect(result).toEqual({ ok: false, error: CANCELLED_RUN })
    expect(subjects(vault)).toEqual(['init'])
    expect(execFileSync('git', ['log', '--format=%s', 'main'], { cwd: join(root, 'origin.git') }).toString().trim()).toBe('init')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: vault }).toString().trim()).toBe('')
    const store = stateOf(root)
    expect(store.isDone(ID, 'summary')).toBe(false)
    expect(store.isDone(ID, 'transcript')).toBe(false)
    store.close()
    expect(deploy).not.toHaveBeenCalled()
  })

  it('a korábban kész átirat megmarad, csak az új recept görgetődik vissza', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const first = await runRecipes({ videoId: ID, outDir, recipes: ['summary'], createClient: () => client({ generate: 0 }), load, git: gitWith() })
    expect(first.ok).toBe(true)
    const controller = new AbortController()
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['qa'],
      createClient: () => cancelling(controller),
      load,
      git: gitWith(),
      signal: controller.signal,
    })
    expect(result).toEqual({ ok: false, error: CANCELLED_RUN })
    const store = stateOf(root)
    expect(store.isDone(ID, 'transcript')).toBe(true)
    expect(store.isDone(ID, 'summary')).toBe(true)
    expect(store.isDone(ID, 'qa')).toBe(false)
    store.close()
    expect(existsSync(join(vault, TRANSCRIPT))).toBe(true)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: vault }).toString().trim()).toBe('')
    expect(subjects(vault)).toHaveLength(3)
  })
})

describe('runRecipes — életjel és leállás', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  /** A qa receptnél a korlát miatt leáll, a summary rendben lefut. */
  function leallo(): ReturnType<RunRuntime['createClient'] & object> {
    const calls = { generate: 0 }
    return {
      ...client(calls),
      generate(role, prompt) {
        if (prompt.startsWith('Write a question-and-answer study note')) {
          return Promise.reject(new RecipeTimeout('qa', 25))
        }
        return client(calls).generate(role, prompt)
      },
    }
  }

  it('a leállt recept rögtön „stalled” üzenetet küld, és a kész jegyzeteket megnevezi', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const bodies: CallbackBody[] = []
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary', 'qa'],
      createClient: () => leallo(),
      load,
      git: gitWith(),
      notify: (body) => bodies.push(body),
    })
    expect(result).toMatchObject({ ok: false, done: ['summary'] })
    expect((result as { error: string }).error).toContain('„qa"')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.status).toBe('stalled')
    expect((bodies[0] as { text: string }).text).toMatch(/„qa" recept 25 perc után sem készült el.*Újra próbáljam\?$/)
  })

  it('a leállás mellett egy másik recept közönséges hibája is a hibasorba kerül', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const bodies: CallbackBody[] = []
    const calls = { generate: 0 }
    const vegyes: ReturnType<RunRuntime['createClient'] & object> = {
      ...client(calls),
      generate(_role, prompt) {
        if (prompt.startsWith('Write a question-and-answer study note')) return Promise.reject(new Error('kaboom'))
        return Promise.reject(new RecipeTimeout('summary', 25))
      },
    }
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary', 'qa'],
      createClient: () => vegyes,
      load,
      git: gitWith(),
      notify: (body) => bodies.push(body),
    })
    expect(result).toEqual({ ok: false, error: 'kaboom' })
    expect(bodies.map((body) => body.status)).toEqual(['stalled'])
  })

  it('egyetlen leállt recept után nincs kész jegyzet', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const bodies: CallbackBody[] = []
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['qa'],
      createClient: () => leallo(),
      load,
      git: gitWith(),
      notify: (body) => bodies.push(body),
    })
    expect(result).toMatchObject({ ok: false, done: [] })
    expect(bodies.map((body) => body.status)).toEqual(['stalled'])
  })

  it('az életjel „progress” üzenetként megy a Workernek, a szószámmal', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    // 0,002 perc = 120 ms: a 450 ms-os generálás alatt legalább egyszer jelez.
    const { root, outDir, load } = await scene(5, { heartbeat_minutes: 0.002 })
    roots.push(root)
    const calls = { generate: 0 }
    const lassu: ReturnType<RunRuntime['createClient'] & object> = {
      ...client(calls),
      async generate(role, prompt) {
        const scope = currentScope()
        if (scope !== undefined) scope.text = 'egy két három'
        await new Promise((resolve) => setTimeout(resolve, 450))
        return client(calls).generate(role, prompt)
      },
    }
    const bodies: CallbackBody[] = []
    const result = await runRecipes({
      videoId: ID,
      outDir,
      recipes: ['summary'],
      createClient: () => lassu,
      load,
      git: gitWith(),
      notify: (body) => bodies.push(body),
    })
    expect(result.ok).toBe(true)
    expect(bodies.length).toBeGreaterThanOrEqual(1)
    expect(bodies[0]).toEqual({ status: 'progress', text: 'summary: kb. 3 szó kész, még dolgozik' })
  })
})

describe('runRecipes — deploy', () => {
  const previous = process.env.LITELLM_API_KEY
  const roots: string[] = []

  afterEach(async () => {
    if (previous === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = previous
    vi.restoreAllMocks()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const REPORT = { written: ['x'], skipped: [], commits: 1, push: { pushed: true }, transform: null, planned: [], unchanged: 0, pendingCommits: 0 }

  /** A `load` a showroom-blokkal bővítve; a deploy hamis, az eseményeket a `log` gyűjti. */
  async function futas(deploy: 'auto' | 'manual', options: { push?: typeof gitPush; deployImpl?: typeof deployNotes } = {}) {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, outDir, load } = await scene()
    roots.push(root)
    const log: string[] = []
    const fake = vi.fn(
      options.deployImpl ??
        (async () => {
          log.push('deploy')
          await new Promise((resolve) => setTimeout(resolve, 20))
          log.push('deploy kész')
          return REPORT
        }),
    )
    const result = await runRecipes({
      videoId: ID,
      recipes: ['summary'],
      outDir,
      createClient: () => client({ generate: 0 }),
      load: async () => {
        const loaded = await load()
        return { ...loaded, cfg: { ...loaded.cfg, showroom: { deploy, clonePath: join(root, 'klon') } } }
      },
      git: gitWith(async (repo) => {
        log.push('push')
        return (options.push ?? gitPush)(repo)
      }),
      deploy: fake,
    })
    log.push('visszatért')
    return { result, log, fake }
  }

  it('auto módban a deploy nem fut a visszatérés előtt, a followUp futtatja', async () => {
    const naplo = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { result, log, fake } = await futas('auto')
    expect(result.ok).toBe(true)
    expect(log).toEqual(['push', 'visszatért'])
    expect(await result.followUp!()).toBeUndefined()
    expect(log).toEqual(['push', 'visszatért', 'deploy', 'deploy kész'])
    expect(fake).toHaveBeenCalledWith(expect.objectContaining({ itemIds: new Set([ID]) }))
    expect(naplo).toHaveBeenCalledWith('[deploy] 1 írva, 0 kihagyva, 1 commit')
  })

  it('manual módban nem deployol', async () => {
    const { result, fake } = await futas('manual')
    expect(result.ok).toBe(true)
    expect(result.followUp).toBeUndefined()
    expect(fake).not.toHaveBeenCalled()
  })

  it('sikertelen push után nem deployol', async () => {
    const { result, fake } = await futas('auto', { push: () => Promise.resolve({ pushed: false }) })
    expect(result.ok).toBe(false)
    expect(fake).not.toHaveBeenCalled()
  })

  it('a deploy hibája mellett ok: true, a hiba a naplóban', async () => {
    const figyelmeztetes = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = await futas('auto', { deployImpl: () => Promise.reject(new Error('a klón nem a main ágon áll (masik)\nrészlet')) })
    expect(result.ok).toBe(true)
    expect(await result.followUp!()).toBe('a klón nem a main ágon áll (masik)')
    expect(figyelmeztetes).toHaveBeenCalledWith('[deploy] sikertelen: a klón nem a main ágon áll (masik)')
  })

  it('a showroom-push hibája a followUp visszatérési értéke', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { result } = await futas('auto', {
      deployImpl: () => Promise.resolve({ ...REPORT, push: { pushed: false, reason: 'Command failed: git push\nrejected' } }),
    })
    expect(await result.followUp!()).toBe('a showroom-push nem sikerült')
  })
})
