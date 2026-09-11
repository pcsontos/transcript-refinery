import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commandRun, commandScanQueue } from './cli.js'
import { DEFAULT_NOTES_DIR, loadConfig } from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import type { ModelClient } from './model/client.js'
import { processItem } from './pipeline.js'
import { queuePath } from './queue/file.js'
import { renderReport } from './run/report.js'
import { discoverAll } from './source/folder.js'
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
    expect(written).toEqual([
      join(root, 'youtube', '3Blue1Brown', 'Transformers_transcript.md'),
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

    expect(written).toContain(join(root, 'youtube', 'A_transcript.md'))
    expect(written).toContain(join(root, 'meetings', 'B_transcript.md'))
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

    await gitCommitPaths(vault, written, 'docs(videos): átirat 1 felirathoz')

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
        draft: { input_per_million: 3, output_per_million: 15 },
        judge: { input_per_million: 0.2, output_per_million: 0.5 },
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
        (await readFile(sor, 'utf8')).replace('  - [ ] summary', '  - [x] summary'),
        'utf8',
      )

      const code = await commandRun(
        cfg,
        raw,
        { queue: true, dryRun: false, force: false, commit: true },
        { createClient: () => client },
      )
      expect(code).toBe(0)

      const log = await run('git', ['log', '--format=%s'], { cwd: repo })
      expect(log.stdout.trim().split('\n')).toEqual([
        'docs(videos): 2 jegyzet a feldolgozási sorból',
        'docs(videos): feldolgozási sor frissítése',
        'kezdet',
      ])

      const elso = (await discoverAll(cfg.sources, cfg.languages)).find((i) => i.baseName === 'Elso')!
      const show = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo })
      expect(show.stdout.trim().split('\n').sort()).toEqual(
        [
          relative(repo, noteFile(cfg.notesRoot, elso, '_transcript.md')),
          relative(repo, noteFile(cfg.notesRoot, elso, '_summary.md')),
          relative(repo, sor),
        ].sort(),
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
