import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_NOTES_DIR, loadConfig } from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import { processItem } from './pipeline.js'
import { discoverAll } from './source/folder.js'
import { openState } from './state/db.js'
import { gitCommitPaths, isDirty } from './vault/git.js'

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
})
