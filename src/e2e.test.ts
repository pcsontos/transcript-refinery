import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { collectEvents, summarize } from './events.js'
import { processItem } from './pipeline.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'
import { gitCommitPaths, isDirty } from './vault/git.js'

const run = promisify(execFile)

const SRT = (line: string) => `1
00:00:00,000 --> 00:00:02,000
${line}

2
00:00:01,000 --> 00:00:03,000
${line}

3
00:00:02,000 --> 00:00:04,000
${line}

4
00:00:03,000 --> 00:00:05,000
Egy második, eltérő sor.
`

let work: string
let vault: string
let notesRoot: string
let downloads: string

async function makeVideo(id: string, title: string, channel: string, broken = false) {
  const dir = join(downloads, 'youtube', channel)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${title}.info.json`),
    JSON.stringify({
      id,
      title,
      channel,
      upload_date: '20260714',
      webpage_url: `https://www.youtube.com/watch?v=${id}`,
    }),
    'utf8',
  )
  await writeFile(join(dir, `${title}.en.srt`), broken ? '' : SRT('Ismételt sor.'), 'utf8')
}

async function processAll(force = false) {
  const store = openState(join(work, 'state.db'))
  const { sink, events } = collectEvents()
  const items = await folderSource(downloads).discover()
  const written: string[] = []
  for (const item of items) {
    const outcome = await processItem(item, {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force },
    })
    if (outcome.status === 'published' && outcome.path) written.push(outcome.path)
  }
  store.close()
  return { summary: summarize(events), written, events }
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-e2e-'))
  vault = join(work, 'vault')
  notesRoot = join(vault, 'Resources/Videos/YouTube')
  downloads = join(work, 'downloads')
  await mkdir(notesRoot, { recursive: true })
  await run('git', ['init', '-b', 'main'], { cwd: vault })
  await run('git', ['config', 'user.email', 'teszt@example.com'], { cwd: vault })
  await run('git', ['config', 'user.name', 'Teszt'], { cwd: vault })
  // A git alapból escape-eli a nem-ASCII útvonalneveket a kimenetében;
  // enélkül a lenti útvonal-ellenőrzés az ékezetes címeken elbukna.
  await run('git', ['config', 'core.quotepath', 'false'], { cwd: vault })
  await writeFile(join(vault, '.gitkeep'), '', 'utf8')
  await run('git', ['add', '.'], { cwd: vault })
  await run('git', ['commit', '-m', 'alap'], { cwd: vault })
})

describe('Fázis 0 sikerkritériumai', () => {
  it('1. a szkennelés hálózat nélkül kilistázza az elemeket a metaadataikkal', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    await makeVideo('b2', 'Második videó', 'Csatorna B')
    const items = await folderSource(downloads).discover()
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.channel).sort()).toEqual(['Csatorna A', 'Csatorna B'])
  })

  it('2. a jegyzetben nincs duplikált sor, a frontmatter érvényes, wikilink nincs', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    const { written } = await processAll()
    const md = await readFile(written[0]!, 'utf8')
    expect(md.match(/Ismételt sor\./g)).toHaveLength(1)
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('video_id: a1')
    expect(md).not.toMatch(/\[\[.+\]\]/)
  })

  it('3. másodszor futtatva semmit nem ír, és kihagyottnak jelenti', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    await processAll()
    const second = await processAll()
    expect(second.summary.succeeded).toBe(0)
    expect(second.summary.skipped).toBe(1)
  })

  it('4. egy sérült felirat mellett a többi elem sikeres, és a riport megnevezi a hibásat', async () => {
    await makeVideo('a1', 'Jó videó', 'Csatorna A')
    await makeVideo('b2', 'Rossz videó', 'Csatorna B', true)
    const { summary, events } = await processAll()
    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(1)
    const failure = events.find((e) => e.type === 'item:failed')
    expect(failure).toBeDefined()
    expect(failure && 'videoId' in failure && failure.videoId).toBe('b2')
  })

  it('5. a futás után a vault munkafája tiszta, és egy commit csak a jegyzeteket érinti', async () => {
    await makeVideo('a1', 'Első videó', 'Csatorna A')
    const { written } = await processAll()
    expect(await isDirty(vault)).toBe(true)

    const committed = await gitCommitPaths(vault, written, 'docs(videos): átirat 1 videóhoz')
    expect(committed).toBe(true)
    expect(await isDirty(vault)).toBe(false)

    const { stdout } = await run('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: vault })
    const files = stdout.trim().split('\n')
    expect(files).toHaveLength(1)
    expect(files[0]!.startsWith('Resources/Videos/YouTube/')).toBe(true)
  })
})
