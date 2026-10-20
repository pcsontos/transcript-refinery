import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRun, commandScan, commandScanQueue } from './cli.js'
import { DEFAULT_NOTES_DIR, loadConfig } from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import type { ModelClient } from './model/client.js'
import { processItem } from './pipeline.js'
import { queuePath } from './queue/file.js'
import { NOT_FOUND_MARK } from './queue/merge.js'
import { renderReport } from './run/report.js'
import { discoverAdHoc, discoverAll } from './source/folder.js'
import { openState } from './state/db.js'
import { gitCommitPaths, isDirty } from './vault/git.js'
import { noteFile } from './vault/paths.js'

const run = promisify(execFile)

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ismételt sor.

2
00:00:01,000 --> 00:00:03,000
Ismételt sor.

3
00:00:02,000 --> 00:00:04,000
Egy második, eltérő sor.
`

// Írásjelek nélkül: a `classifyCaptions` a 2/100 szavas küszöb alatt
// automatikusnak sorolja be — nulla írásjel messze a küszöb alatt van.
const AUTO_SRT = `1
00:00:00,000 --> 00:00:02,000
ez egy automatikus felirat irasjelek nelkul

2
00:00:02,000 --> 00:00:04,000
a masodik sor is irasjel nelkul jon
`

let work: string
let vault: string
let subsA: string
let subsB: string

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-e2e-'))
  vault = join(work, 'vault')
  subsA = join(work, 'youtube')
  subsB = join(work, 'meetings')
  await mkdir(vault, { recursive: true })
  await run('git', ['init', '-q'], { cwd: vault })
  await run('git', ['config', 'user.email', 'teszt@pelda.hu'], { cwd: vault })
  await run('git', ['config', 'user.name', 'Teszt'], { cwd: vault })
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

function config(sources: string[], notesDir?: string) {
  return loadConfig(
    {
      vault: notesDir ? { path: vault, notes_dir: notesDir } : { path: vault },
      sources,
      state: { path: join(work, 'state.db') },
    },
    join(work, 'refinery.config.yaml'),
  )
}

async function processAll(sources: string[], notesDir?: string) {
  const cfg = config(sources, notesDir)
  const store = openState(cfg.statePath)
  const { sink, events } = collectEvents()
  const items = await discoverAll(cfg.sources, cfg.languages)
  const written: string[] = []
  for (const item of items) {
    const outcome = await processItem(item, {
      notesRoot: cfg.notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    })
    if (outcome.path && outcome.status === 'published') written.push(outcome.path)
  }
  store.close()
  return { written, summary: summarize(events), notesRoot: cfg.notesRoot, events, items }
}

/** Az első `limit` elemet dolgozza fel — a megszakadt köteget utánozza. */
async function processSome(sources: string[], limit: number) {
  const cfg = config(sources)
  const store = openState(cfg.statePath)
  const { sink, events } = collectEvents()
  const items = (await discoverAll(cfg.sources, cfg.languages)).slice(0, limit)
  for (const item of items) {
    await processItem(item, {
      notesRoot: cfg.notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    })
  }
  store.close()
  return { summary: summarize(events), events, items }
}

describe('végponttól végpontig', () => {
  it('metaadat nélküli feliratból is jegyzet lesz, az alapértelmezett mappában', async () => {
    await write(join(subsA, '3Blue1Brown', 'Transformers.en.srt'), SRT)

    const { written, notesRoot: root } = await processAll([subsA])

    expect(root).toBe(join(vault, DEFAULT_NOTES_DIR))
    // Csatorna nélkül: forrás/item_id/alapnév.
    expect(written).toHaveLength(1)
    expect(relative(root, written[0]!).split('/')).toEqual([
      'youtube',
      expect.stringMatching(/^[0-9a-f]+$/),
      'Transformers_transcript.md',
    ])

    const note = await readFile(written[0]!, 'utf8')
    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('title: Transformers')
    expect(note).toContain('source: youtube')
    expect(note).toContain('source_file: 3Blue1Brown/Transformers.en.srt')
    expect(note).not.toContain('video_id')
    // A duplikált sor pontosan egyszer szerepel a törzsben.
    expect(note.split('Ismételt sor.').length - 1).toBe(1)
  })

  it('a metaadat a frontmatterbe kerül, ha van', async () => {
    await write(join(subsA, 'Cs', 'Beszéd.en.srt'), SRT)
    await write(
      join(subsA, 'Cs', 'Beszéd.info.json'),
      JSON.stringify({
        id: 'q6p',
        title: 'Agent Orchestration',
        channel: 'Burke Holland',
        upload_date: '20260714',
        webpage_url: 'https://example.com/v',
        duration: 1806,
        tags: ['ai'],
        description: 'Egy sor\nMásik sor',
      }),
    )

    const { written } = await processAll([subsA])
    const note = await readFile(written[0]!, 'utf8')

    expect(note).toContain('video_id: q6p')
    expect(note).toContain('channel: Burke Holland')
    expect(note).toContain('uploaded: 2026-07-14')
    expect(note).toContain('duration: 1806')
    expect(note).toContain('description: |2-')
    // A fájlnév az alapnévből jön, nem a metaadat címéből.
    expect(written[0]!.endsWith('Beszéd_transcript.md')).toBe(true)
  })

  it('két forrás két almappát kap a vaultban', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)
    await write(join(subsB, 'B.hu.vtt'), SRT.replace(/,/g, '.').replace(/^/, 'WEBVTT\n\n'))

    const { written, notesRoot: root } = await processAll([subsA, subsB])

    expect(written.some((p) => p.startsWith(join(root, 'youtube') + '/') && p.endsWith('/A_transcript.md'))).toBe(true)
    expect(written.some((p) => p.startsWith(join(root, 'meetings') + '/') && p.endsWith('/B_transcript.md'))).toBe(true)
  })

  it('a notes_dir felülírja az alapértelmezett mappát, és az alapértelmezett létre sem jön', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)

    const { written } = await processAll([subsA], 'Inbox/masik')

    expect(written[0]!.startsWith(join(vault, 'Inbox', 'masik'))).toBe(true)
    // Spec 5. sikerkritériuma: a notes_dir megadásakor az alapértelmezett
    // Inbox/transcript-refinery mappa nem jön létre a vaultban.
    expect(existsSync(join(vault, DEFAULT_NOTES_DIR))).toBe(false)
  })

  it('a második futás semmit nem ír újra', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)
    await processAll([subsA])

    const second = await processAll([subsA])

    expect(second.written).toEqual([])
    expect(second.summary.skipped).toBe(1)
  })

  it('a sérült felirat nem állítja meg a futást, és a riport megnevezi', async () => {
    await write(join(subsA, 'Jó.en.srt'), SRT)
    await write(join(subsA, 'Rossz.en.srt'), '')

    const { written, summary, events, items } = await processAll([subsA])

    expect(written).toHaveLength(1)
    expect(summary.failed).toBe(1)

    // Nem elég a hibák száma: a riportnak a VALÓBAN hibás elemet kell
    // megneveznie. Metaadat híján az azonosító útvonal-hash, ezért a
    // felderített elemből vesszük.
    const rossz = items.find((i) => i.baseName === 'Rossz')
    expect(rossz).toBeDefined()
    const failed = events.filter(
      (e): e is Extract<RunEvent, { type: 'item:failed' }> => e.type === 'item:failed',
    )
    expect(failed).toHaveLength(1)
    expect(failed[0]!.itemId).toBe(rossz!.itemId)
  })

  it('a futás után a vault munkafája tiszta, egyetlen új committal', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)
    const { written } = await processAll([subsA])

    await gitCommitPaths(vault, written, 'docs(transcript-refinery): átirat 1 felirathoz')

    expect(await isDirty(vault)).toBe(false)
    const log = await run('git', ['log', '--oneline'], { cwd: vault })
    expect(log.stdout.trim().split('\n')).toHaveLength(1)
  })

  it('a köteg közepén megszakadt futás után az újrafuttatás nem ír újra', async () => {
    await write(join(subsA, 'Cs', 'Elso.en.srt'), SRT)
    await write(join(subsA, 'Cs', 'Masodik.en.srt'), SRT)

    // Első futás: a köteg az első elem után „megszakad".
    const elso = await processSome([subsA], 1)
    expect(elso.summary.succeeded).toBe(1)

    // Második futás: mindkét elem sorra kerül, de a kész kimarad.
    const masodik = await processAll([subsA])
    expect(masodik.summary.succeeded).toBe(1)
    expect(masodik.summary.skipped).toBe(1)

    // A köteg-szintű állapot a két futás összegét mutatja.
    const cfg = config([subsA])
    const store = openState(cfg.statePath)
    const corpus = store.corpusStatus(masodik.items, 'transcript')
    store.close()

    expect(corpus.done).toBe(2)
    expect(corpus.pending).toBe(0)
  })

  it('a riport a felirat-forrás szerint bont, és megnevezi az automatikus elemet', async () => {
    await write(join(subsA, 'Cs', 'Kreatori.en.srt'), SRT)
    await write(join(subsB, 'Cs', 'Automatikus.en.srt'), AUTO_SRT)
    // A metaadat szándékosan más címet ad, mint a fájlnév, és az azonosító
    // sem a címből jön: így a riport állítása tényleg a NÉVRŐL szól.
    await write(
      join(subsB, 'Cs', 'Automatikus.info.json'),
      JSON.stringify({ id: 'auto-1', title: 'Gépi felirattal készült előadás' }),
    )

    const { summary, items } = await processAll([subsA, subsB])
    expect(summary.byCaptionSource).toEqual({ creator: 1, auto: 1 })
    expect(summary.autoItems).toHaveLength(1)

    const cfg = config([subsA, subsB])
    const store = openState(cfg.statePath)
    const corpus = store.corpusStatus(items, 'transcript')
    store.close()

    const markdown = renderReport({
      runId: '2026-09-07T02-14-03',
      startedAt: new Date('2026-09-07T02:14:03Z'),
      finishedAt: new Date('2026-09-07T02:20:00Z'),
      command: 'run',
      summary,
      corpora: [{ kind: 'transcript', status: corpus }],
      runs: 1,
      logPath: join(cfg.logsDir, '2026-09-07T02-14-03.jsonl'),
    })

    const auto = summary.autoItems[0]!
    expect(auto).toEqual({ itemId: 'auto-1', title: 'Gépi felirattal készült előadás' })

    expect(markdown).toContain('kreátori 1 / automatikus 1')
    // A felsorolás a nevet viszi, az azonosító csak mellette áll.
    expect(markdown).toContain(`- ${auto.title} (\`${auto.itemId}\`)`)
    expect(markdown).toContain('| youtube |')
    expect(markdown).toContain('| meetings |')
  })
})

describe('végponttól végpontig — a feldolgozási sor valódi gittel', () => {
  it('scan --queue, pipálás, run --queue: pontosan a várt commitok, tiszta és pusholt munkafa', async () => {
    // Csupasz távoli repó, hogy a pull --ff-only és a push is valódi legyen.
    const remote = join(work, 'remote.git')
    const repo = join(work, 'vault-klon')
    await run('git', ['init', '-q', '--bare', remote])
    await run('git', ['clone', '-q', remote, repo])
    await run('git', ['config', 'user.email', 'teszt@pelda.hu'], { cwd: repo })
    await run('git', ['config', 'user.name', 'Teszt'], { cwd: repo })
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'kezdet'], { cwd: repo })
    await run('git', ['push', '-q', '-u', 'origin', 'HEAD'], { cwd: repo })

    await write(join(subsA, 'Cs', 'Elso.en.srt'), SRT)
    await write(join(subsA, 'Cs', 'Masodik.en.srt'), SRT)
    const raw = {
      vault: { path: repo },
      sources: [subsA],
      state: { path: join(work, 'state.db') },
      logs: { dir: join(work, 'logs') },
      model: { base_url: 'http://localhost:4000/v1', draft: 'proba-draft', judge: 'proba-judge' },
      pricing: {
        'proba-draft': { input_per_million: 3, output_per_million: 15 },
        'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
      },
      cost_limit_usd: 5,
    }
    const cfg = loadConfig(raw, join(work, 'refinery.config.yaml'))
    const client: ModelClient = {
      generate: () =>
        Promise.resolve({
          value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      generateObject: <T>() =>
        Promise.resolve({
          value: { score: 1, gaps: [] } as T,
          usage: { inputTokens: 5, outputTokens: 2 },
        }),
    }

    const mentettKulcs = process.env.LITELLM_API_KEY
    process.env.LITELLM_API_KEY = 'sk-proba'
    try {
      expect(await commandScanQueue(cfg, { dryRun: false, commit: true })).toBe(0)
      const sor = queuePath(cfg.notesRoot)
      // Az első videó summary-sora: a felderítés rendezett, az `Elso` áll elöl.
      await writeFile(
        sor,
        (await readFile(sor, 'utf8')).replace('- [ ] summary', '- [x] summary'),
        'utf8',
      )

      const code = await commandRun(
        cfg,
        raw,
        { queue: true, dryRun: false, force: false, commit: true },
        { createClient: () => client },
      )
      expect(code).toBe(0)

      const elso = (await discoverAll(cfg.sources, cfg.languages)).find((i) => i.baseName === 'Elso')!
      const log = await run('git', ['log', '--format=%s'], { cwd: repo })
      expect(log.stdout.trim().split('\n')).toEqual([
        `docs(transcript-refinery): summary | ${elso.title} [${elso.metadata.videoId ?? elso.itemId}]`,
        `docs(transcript-refinery): transcript | ${elso.title} [${elso.metadata.videoId ?? elso.itemId}]`,
        'docs(transcript-refinery): feldolgozási sor frissítése',
        'kezdet',
      ])

      // A sor fájlja az utolsó jegyzet commitjával megy.
      const show = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
      expect(show.stdout.trim().split('\n').sort()).toEqual(
        [relative(repo, noteFile(cfg.notesRoot, elso, '_summary.md')), relative(repo, sor)].sort(),
      )
      expect(await isDirty(repo)).toBe(false)
      const status = await run('git', ['status', '-sb'], { cwd: repo })
      expect(status.stdout).not.toContain('ahead')
    } finally {
      if (mentettKulcs === undefined) delete process.env.LITELLM_API_KEY
      else process.env.LITELLM_API_KEY = mentettKulcs
    }
  })
})

describe('végponttól végpontig — megszakadt futás után a vault-commit', () => {
  let repo: string
  let mentettKulcs: string | undefined

  beforeEach(async () => {
    mentettKulcs = process.env.LITELLM_API_KEY
    process.env.LITELLM_API_KEY = 'sk-proba'

    const remote = join(work, 'remote.git')
    repo = join(work, 'vault-klon')
    await run('git', ['init', '-q', '--bare', remote])
    await run('git', ['clone', '-q', remote, repo])
    await run('git', ['config', 'user.email', 'teszt@pelda.hu'], { cwd: repo })
    await run('git', ['config', 'user.name', 'Teszt'], { cwd: repo })
    await run('git', ['commit', '-q', '--allow-empty', '-m', 'kezdet'], { cwd: repo })
    await run('git', ['push', '-q', '-u', 'origin', 'HEAD'], { cwd: repo })

    await write(join(subsA, 'Cs', 'Elso.en.srt'), SRT)
    await write(join(subsA, 'Cs', 'Masodik.en.srt'), SRT)
  })

  afterEach(() => {
    if (mentettKulcs === undefined) delete process.env.LITELLM_API_KEY
    else process.env.LITELLM_API_KEY = mentettKulcs
  })

  const rawConfig = () => ({
    vault: { path: repo },
    sources: [subsA],
    state: { path: join(work, 'state.db') },
    logs: { dir: join(work, 'logs') },
    model: { base_url: 'http://localhost:4000/v1', draft: 'proba-draft', judge: 'proba-judge' },
    pricing: {
      'proba-draft': { input_per_million: 3, output_per_million: 15 },
      'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: 5,
  })

  const summaryFlags = { recipe: 'summary', dryRun: false, force: false, commit: true }

  function kliens(onGenerate: (hanyadik: number) => Promise<never> | undefined = () => undefined) {
    const hivasok = { generate: 0 }
    const client: ModelClient = {
      generate: () => {
        hivasok.generate++
        return (
          onGenerate(hivasok.generate) ??
          Promise.resolve({
            value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
            usage: { inputTokens: 10, outputTokens: 5 },
          })
        )
      },
      generateObject: <T>() =>
        Promise.resolve({
          value: { score: 1, gaps: [] } as T,
          usage: { inputTokens: 5, outputTokens: 2 },
        }),
    }
    return { client, hivasok }
  }

  async function mindenJegyzetCommitolvaEsPusholva(cfg: ReturnType<typeof loadConfig>): Promise<void> {
    const items = await discoverAll(cfg.sources, cfg.languages)
    const vart = items.flatMap((item) =>
      ['_transcript.md', '_summary.md'].map((utotag) =>
        relative(repo, noteFile(cfg.notesRoot, item, utotag)),
      ),
    )
    expect(vart).toHaveLength(4)
    const head = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo })
    const commitolt = head.stdout.trim().split('\n')
    for (const path of vart) expect(commitolt).toContain(path)
    const status = await run('git', ['status', '-sb'], { cwd: repo })
    expect(status.stdout).not.toContain('ahead')
  }

  it('a Ctrl+C után az újrafuttatás a már megírt jegyzeteket is commitolja, a kézi fájlt nem', async () => {
    const raw = rawConfig()
    const cfg = loadConfig(raw, join(work, 'refinery.config.yaml'))
    const kezi = join(cfg.notesRoot, 'kezi-jegyzet.md')
    await write(kezi, 'félbehagyott kézi munka')

    let sigint: (() => void) | undefined
    let kilep: (code: number) => void = () => undefined
    const kilepett = new Promise<number>((resolve) => (kilep = resolve))
    // A második generálás soha nem tér vissza: a törzs — mint a valódi
    // `process.exit` után — nem jut el a commitig.
    const megszakito = kliens((hanyadik) => {
      if (hanyadik !== 2) return undefined
      sigint?.()
      return new Promise<never>(() => undefined)
    })
    void commandRun(cfg, raw, summaryFlags, {
      signals: {
        on(_event: string, listener: () => void) {
          sigint = listener
          return this
        },
      },
      exit: (code) => kilep(code),
      createClient: () => megszakito.client,
    })
    expect(await kilepett).toBe(130)

    const code = await commandRun(cfg, raw, summaryFlags, { createClient: () => kliens().client })
    expect(code).toBe(0)

    await mindenJegyzetCommitolvaEsPusholva(cfg)
    const status = await run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo })
    expect(status.stdout.trim().split('\n')).toEqual([`?? ${relative(repo, kezi)}`])
  })

  it('a commit hibája után az újrafuttatás commitolja a megírt jegyzeteket, akkor is, ha nincs új munka', async () => {
    const raw = rawConfig()
    const cfg = loadConfig(raw, join(work, 'refinery.config.yaml'))
    // Saját hooks-mappa: egy globális `core.hooksPath` se írhassa felül.
    const hibazo = join(work, 'hooks-hibazo')
    const ures = join(work, 'hooks-ures')
    await mkdir(hibazo, { recursive: true })
    await mkdir(ures, { recursive: true })
    await writeFile(join(hibazo, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await run('git', ['config', 'core.hooksPath', hibazo], { cwd: repo })

    await expect(
      commandRun(cfg, raw, summaryFlags, { createClient: () => kliens().client }),
    ).rejects.toThrow()

    await run('git', ['config', 'core.hooksPath', ures], { cwd: repo })
    const masodik = kliens()
    const code = await commandRun(cfg, raw, summaryFlags, { createClient: () => masodik.client })
    expect(code).toBe(0)
    expect(masodik.hivasok.generate).toBe(0)

    await mindenJegyzetCommitolvaEsPusholva(cfg)
    expect(await isDirty(repo)).toBe(false)
  })

  it('egy szűkebb válogatással futó helyreállítás a kívül eső elemek elmaradt commitját is felveszi', async () => {
    const raw = rawConfig()
    const cfg = loadConfig(raw, join(work, 'refinery.config.yaml'))
    const hibazo = join(work, 'hooks-hibazo-2')
    const ures = join(work, 'hooks-ures-2')
    await mkdir(hibazo, { recursive: true })
    await mkdir(ures, { recursive: true })
    await writeFile(join(hibazo, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await run('git', ['config', 'core.hooksPath', hibazo], { cwd: repo })

    // Mindkét elem megíródik, a commit elhasal.
    await expect(
      commandRun(cfg, raw, summaryFlags, { createClient: () => kliens().client }),
    ).rejects.toThrow()

    await run('git', ['config', 'core.hooksPath', ures], { cwd: repo })

    // A helyreállító futás `--limit 1`-gyel csak EGY elemet válogat be — a
    // másik elem jegyzetei mégis bekerülnek ugyanabba a commitba, mert a
    // commitra váró lista nem a futás válogatásától függ.
    const masodik = kliens()
    const code = await commandRun(
      cfg,
      raw,
      { ...summaryFlags, limit: 1 },
      { createClient: () => masodik.client },
    )
    expect(code).toBe(0)
    expect(masodik.hivasok.generate).toBe(0)

    await mindenJegyzetCommitolvaEsPusholva(cfg)
    expect(await isDirty(repo)).toBe(false)
  })
})

describe('szöveges átirat (--dir, --file)', () => {
  let atiratok: string
  let mentettKulcs: string | undefined

  const raw = () => ({
    vault: { path: vault },
    sources: [subsA],
    state: { path: join(work, 'state.db') },
    logs: { dir: join(work, 'logs') },
    model: { base_url: 'http://localhost:4000/v1', draft: 'proba-draft', judge: 'proba-judge' },
    pricing: {
      'proba-draft': { input_per_million: 3, output_per_million: 15 },
      'proba-judge': { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: 5,
  })
  const cfgOf = () => loadConfig(raw(), join(work, 'refinery.config.yaml'))

  /** Hamis kliens, amely a generáló promptokat gyűjti. */
  function kliens(promptok: string[]): ModelClient {
    return {
      generate: (_role, prompt) => {
        promptok.push(prompt)
        return Promise.resolve({
          value: '## Összefoglaló\n\nEgy mondat a jegyzetből.\n',
          usage: { inputTokens: 10, outputTokens: 5 },
        })
      },
      generateObject: <T>() =>
        Promise.resolve({ value: { score: 1, gaps: [] } as T, usage: { inputTokens: 5, outputTokens: 2 } }),
    }
  }

  const summary = (adHoc: { dir?: string; file?: string; match?: string }) => ({
    adHoc,
    recipe: 'summary',
    dryRun: false,
    force: false,
    commit: false,
  })

  beforeEach(async () => {
    atiratok = join(work, 'atiratok')
    await mkdir(atiratok, { recursive: true })
    mentettKulcs = process.env.LITELLM_API_KEY
    process.env.LITELLM_API_KEY = 'sk-proba'
  })

  afterEach(() => {
    process.env.LITELLM_API_KEY = mentettKulcs
  })

  it('run --file: jegyzet, done állapot, költség a riportban; átnevezve újra: nincs új hívás', async () => {
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van, írásjelekkel.\n')
    const cfg = cfgOf()
    const promptok: string[] = []

    expect(await commandRun(cfg, raw(), summary({ file: txt }), { createClient: () => kliens(promptok) })).toBe(0)

    const [item] = await discoverAdHoc({ file: txt }, cfg.languages)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_transcript.md'))).toBe(true)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_summary.md'))).toBe(true)
    const store = openState(cfg.statePath)
    expect(store.isDone(item!.itemId, 'summary')).toBe(true)
    store.close()
    const riport = (await readdir(join(work, 'logs'))).find((f) => f.endsWith('.md'))!
    expect(await readFile(join(work, 'logs', riport), 'utf8')).toContain('összköltség')

    const hivasok = promptok.length
    const atnevezett = join(atiratok, 'más-név.hu.txt')
    await rename(txt, atnevezett)
    expect(
      await commandRun(cfg, raw(), summary({ file: atnevezett }), { createClient: () => kliens(promptok) }),
    ).toBe(0)
    expect(promptok.length).toBe(hivasok)
  })

  it('.md frontmatterrel: a promptban nincs frontmatter, a fejléc igen', async () => {
    const md = join(atiratok, 'jegyzet.hu.md')
    await write(md, '---\ntitle: Titkos mező\n---\n# Fejezet\n\nSzöveg itt, mondatokkal.\n')
    const promptok: string[] = []

    expect(await commandRun(cfgOf(), raw(), summary({ file: md }), { createClient: () => kliens(promptok) })).toBe(0)

    expect(promptok[0]).not.toContain('Titkos mező')
    expect(promptok[0]).toContain('# Fejezet')
  })

  it('hibás fájlok: megnevezett hiba, a jó tétel elkészül', async () => {
    await write(join(atiratok, 'ures.hu.txt'), '\n')
    await write(join(atiratok, 'nagy.hu.txt'), 'a'.repeat(2 * 1024 * 1024 + 1))
    await write(join(atiratok, 'nul.hu.txt'), 'a\0b')
    await writeFile(join(atiratok, 'rossz.hu.txt'), Buffer.from([0xc3, 0x28]))
    await write(join(atiratok, 'jo.hu.txt'), 'Ez egy jó átirat, rendes mondatokkal.\n')
    const cfg = cfgOf()

    const code = await commandRun(cfg, raw(), { adHoc: { dir: atiratok }, dryRun: false, force: false, commit: false })

    expect(code).toBe(1)
    const items = await discoverAdHoc({ dir: atiratok }, cfg.languages)
    const by = (base: string) => items.find((i) => i.baseName === base)!
    const store = openState(cfg.statePath)
    expect(store.artifactOf(by('ures').itemId, 'transcript')?.error).toBe('a fájl üres')
    expect(store.artifactOf(by('nagy').itemId, 'transcript')?.error).toBe('a fájl túl nagy: 2.0 MB, legfeljebb 2 MB')
    expect(store.artifactOf(by('nul').itemId, 'transcript')?.error).toBe('a fájl nem UTF-8 szöveg')
    expect(store.artifactOf(by('rossz').itemId, 'transcript')?.error).toBe('a fájl nem UTF-8 szöveg')
    expect(store.isDone(by('jo').itemId, 'transcript')).toBe(true)
    store.close()
  })

  it('scan --dir --match: fejléc, részletsor, almappa, ütközés, üres eredmény', async () => {
    await write(join(atiratok, 'a.hu.srt'), SRT)
    await write(join(atiratok, 'f.hu.md'), '# F\n\nEgy mondat.\n')
    await write(join(atiratok, 'al', 'd.hu.md'), '# D\n\nMásik mondat.\n')
    const cfg = cfgOf()
    // Egy másik, azonos nevű fájl jegyzete már ott van.
    const [f] = await discoverAdHoc({ dir: atiratok, match: 'f.*' }, cfg.languages)
    await write(noteFile(cfg.notesRoot, f!, '_transcript.md'), '---\nitem_id: t-masik\n---\n')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const out = () => logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    try {
      expect(await commandScan(cfg, { dir: atiratok, match: '*.md' })).toBe(0)
      expect(out()).toContain("2 feldolgozható fájl (--match '*.md')")
      expect(out()).toContain('al/d.hu.md')
      expect(out()).toMatch(/\d+ szó, szöveg \(\.md\) · jegyzet már létezik ezen a néven/)
      expect(out()).toMatch(/\d+ szó, szöveg \(\.md\)$/m)
      logSpy.mockClear()

      expect(await commandScan(cfg, { dir: atiratok })).toBe(0)
      expect(out()).toContain('3 feldolgozható fájl')
      logSpy.mockClear()

      expect(await commandScan(cfg, { dir: atiratok, match: '*.pdf' })).toBe(0)
      expect(out()).toContain("0 feldolgozható fájl (--match '*.pdf')")
    } finally {
      logSpy.mockRestore()
    }
  })

  it('scan --queue --dir, majd run --queue: a sources-ban nem lévő tétel is feldolgozódik', async () => {
    await write(join(subsA, 'Cs', 'Video.en.srt'), SRT)
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van.\n')
    const cfg = cfgOf()
    const sor = queuePath(cfg.notesRoot)

    expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { dir: atiratok } })).toBe(0)
    const [item] = await discoverAdHoc({ dir: atiratok }, cfg.languages)
    const text = await readFile(sor, 'utf8')
    expect(text).toContain(`%%${item!.itemId} ${txt}%%`)
    expect(text).not.toContain(NOT_FOUND_MARK)

    // A sima scan --queue a szöveges tételt sem jelöli „nem található”-nak.
    expect(await commandScanQueue(cfg, { dryRun: false, commit: false })).toBe(0)
    expect(await readFile(sor, 'utf8')).not.toContain(NOT_FOUND_MARK)

    const sorok = (await readFile(sor, 'utf8')).split('\n')
    const horgony = sorok.findIndex((l) => l.includes(item!.itemId))
    const pipa = sorok.findIndex((l, n) => n > horgony && l === '- [ ] summary')
    sorok[pipa] = '- [x] summary'
    await writeFile(sor, sorok.join('\n'), 'utf8')

    expect(
      await commandRun(
        cfg,
        raw(),
        { queue: true, dryRun: false, force: false, commit: false },
        { createClient: () => kliens([]) },
      ),
    ).toBe(0)
    expect(existsSync(noteFile(cfg.notesRoot, item!, '_summary.md'))).toBe(true)
  })

  it('run --dir --queue: a sorban lévő forrásvideós pár nem lesz „nem található”', async () => {
    await write(join(subsA, 'Cs', 'Video.en.srt'), SRT)
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van.\n')
    const cfg = cfgOf()
    const sor = queuePath(cfg.notesRoot)
    expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { dir: atiratok } })).toBe(0)
    await writeFile(sor, (await readFile(sor, 'utf8')).replaceAll('- [ ] summary', '- [x] summary'), 'utf8')

    const code = await commandRun(
      cfg,
      raw(),
      { adHoc: { dir: atiratok }, queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => kliens([]) },
    )

    expect(code).toBe(0)
    const [video] = (await discoverAll(cfg.sources, cfg.languages)).slice(0, 1)
    expect(existsSync(noteFile(cfg.notesRoot, video!, '_summary.md'))).toBe(true)
    expect(await readFile(sor, 'utf8')).not.toContain(NOT_FOUND_MARK)
  })

  it.each([
    ['törölve', (path: string) => rm(path), (path: string) => `nem található: ${path}`],
    [
      'módosítva',
      (path: string) => writeFile(path, 'Teljesen más szöveg.\n', 'utf8'),
      (path: string) => `nem található: a fájl tartalma megváltozott a sorba vétel óta (${path})`,
    ],
  ])('run --queue, a fájl közben %s: a nem található listára kerül, okkal', async (_name, change, reason) => {
    const txt = join(atiratok, 'átirat.hu.txt')
    await write(txt, 'Ez egy szöveges átirat. A második mondat is itt van.\n')
    const cfg = cfgOf()
    const sor = queuePath(cfg.notesRoot)
    expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { file: txt } })).toBe(0)
    await writeFile(sor, (await readFile(sor, 'utf8')).replace('- [ ] summary', '- [x] summary'), 'utf8')
    await change(txt)

    const code = await commandRun(
      cfg,
      raw(),
      { queue: true, dryRun: false, force: false, commit: false },
      { createClient: () => kliens([]) },
    )

    expect(code).toBe(1)
    const riport = (await readdir(join(work, 'logs'))).find((f) => f.endsWith('.md'))!
    expect(await readFile(join(work, 'logs', riport), 'utf8')).toContain(reason(txt))
  })

  it('scan --queue: a %%-t tartalmazó útvonal megnevezett hiba, a sor nem kapja meg', async () => {
    const furcsa = join(work, 'a%%b')
    await write(join(furcsa, 'c.hu.txt'), 'Egy mondat.\n')
    const cfg = cfgOf()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await commandScanQueue(cfg, { dryRun: false, commit: false, adHoc: { dir: furcsa } })).toBe(1)
      expect(String(errorSpy.mock.calls[0]?.[0])).toBe(
        `Az útvonalban %% van, a sorba nem vehető fel: ${join(furcsa, 'c.hu.txt')}`,
      )
    } finally {
      errorSpy.mockRestore()
    }
    const sor = await readFile(queuePath(cfg.notesRoot), 'utf8').catch(() => '')
    expect(sor).not.toContain('c.hu.txt')
  })
})
