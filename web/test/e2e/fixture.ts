import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverAll, openState } from 'transcript-refinery'

/** Egy lezárt futás riporttal, és egy „futó", aminek a pid-je a tesztfolyamaté. */
export const FINISHED_RUN = '2026-09-10T08-00-00'
export const RUNNING_RUN = '2026-09-11T09-00-00'

export interface Fixture {
  root: string
  configPath: string
  runningLog: string
  summaryNote: string
}

const SRT = [
  '1',
  '00:00:00,000 --> 00:00:02,000',
  'Ez az első szintetikus mondat.',
  '',
  '2',
  '00:00:02,000 --> 00:00:04,000',
  'Ez a második szintetikus mondat.',
  '',
].join('\n')

const line = (value: object): string => `${JSON.stringify(value)}\n`

async function video(dir: string, id: string, title: string): Promise<void> {
  await writeFile(
    join(dir, `${title}.info.json`),
    JSON.stringify({
      id,
      title,
      channel: 'Szintetikus Csatorna',
      upload_date: '20260714',
      webpage_url: `https://example.com/${id}`,
    }),
    'utf8',
  )
  await writeFile(join(dir, `${title}.en.srt`), SRT, 'utf8')
}

/**
 * Szintetikus környezet a felület e2e-tesztjeihez: feliratmappa két videóval,
 * vault két jegyzettel és feldolgozási sorral, állapottár, két futásnapló és a
 * konfigurációs fájl — mind egy ideiglenes mappában, abszolút útvonalakkal.
 */
export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'refinery-web-'))

  const sources = join(root, 'feliratok', 'youtube')
  const channel = join(sources, 'Szintetikus Csatorna')
  await mkdir(channel, { recursive: true })
  await video(channel, 'szint0001', 'Első példavideó')
  await video(channel, 'szint0002', 'Második példavideó')

  const vault = join(root, 'vault')
  const notesRoot = join(vault, 'Inbox', 'transcript-refinery')
  const noteDir = join(notesRoot, 'youtube', 'Szintetikus Csatorna')
  await mkdir(noteDir, { recursive: true })
  const transcriptNote = join(noteDir, 'Első példavideó_transcript.md')
  const summaryNote = join(noteDir, 'Első példavideó_summary.md')
  await writeFile(
    transcriptNote,
    [
      '---',
      'item_id: szint0001',
      '---',
      '# Első példavideó',
      '',
      'Ez az első szintetikus mondat. Ez a második szintetikus mondat.',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    summaryNote,
    [
      '---',
      'item_id: szint0001',
      'recipe: summary',
      '---',
      '## Összefoglaló',
      '',
      'Egy szintetikus pont.',
      '',
      '<script>alert(1)</script>',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    join(notesRoot, '_queue.md'),
    [
      '## youtube/Szintetikus Csatorna',
      '- Első példavideó %%szint0001%%',
      '  - [x] summary',
      '  - [ ] flashcards',
      '  - [ ] qa',
      '- Második példavideó %%szint0002%%',
      '  - [ ] summary',
      '',
    ].join('\n'),
    'utf8',
  )

  const statePath = join(root, 'state.db')
  const items = await discoverAll([{ name: 'youtube', path: sources }], ['en'])
  const first = items.find((item) => item.itemId === 'szint0001')
  if (!first) throw new Error('a szintetikus videó felderítése nem sikerült')
  const store = openState(statePath)
  store.recordItem(first)
  store.recordTranscript('szint0001', 'creator', 12, 10)
  store.recordArtifact('szint0001', 'transcript', 'done', transcriptNote, null)
  store.recordArtifact('szint0001', 'summary', 'done', summaryNote, null, {
    iterations: 1,
    score: 0.62,
    costUsd: 0.0123,
    model: 'szintetikus-modell',
    gaps: ['kimaradt: a zárás'],
  })
  store.recordArtifact(
    'szint0001',
    'qa',
    'failed',
    null,
    'a jegyzet megsérti a vault írási szabályait: wikilink tiltott',
  )
  store.close()

  const logs = join(root, 'logs')
  await mkdir(logs, { recursive: true })
  await writeFile(
    join(logs, `${FINISHED_RUN}.jsonl`),
    [
      line({ at: '2026-09-10T08:00:00.000Z', type: 'run:started', command: 'run --recipe summary', pid: 999_999 }),
      line({ at: '2026-09-10T08:00:01.000Z', type: 'scan:found', count: 1 }),
      line({ at: '2026-09-10T08:00:02.000Z', type: 'item:start', itemId: 'szint0001', title: 'Első példavideó' }),
      line({
        at: '2026-09-10T08:00:03.000Z',
        type: 'item:normalized',
        itemId: 'szint0001',
        wordsRaw: 12,
        wordsNormalized: 10,
        captionSource: 'creator',
      }),
      line({
        at: '2026-09-10T08:00:05.000Z',
        type: 'item:refined',
        itemId: 'szint0001',
        recipe: 'summary',
        score: 0.62,
        generations: 1,
        usd: 0.0123,
      }),
      line({ at: '2026-09-10T08:00:05.100Z', type: 'item:published', itemId: 'szint0001', path: summaryNote }),
      line({ at: '2026-09-10T08:00:06.000Z', type: 'run:done', succeeded: 1, skipped: 0, failed: 0 }),
      line({ at: '2026-09-10T08:00:06.100Z', type: 'run:ended', interrupted: false }),
    ].join(''),
    'utf8',
  )
  await writeFile(join(logs, `${FINISHED_RUN}.md`), '# Futás\n\n| sikeres | 1 |\n', 'utf8')
  const runningLog = join(logs, `${RUNNING_RUN}.jsonl`)
  await writeFile(
    runningLog,
    [
      line({ at: new Date().toISOString(), type: 'run:started', command: 'run --queue', pid: process.pid }),
      line({ at: new Date().toISOString(), type: 'scan:found', count: 1 }),
    ].join(''),
    'utf8',
  )

  const configPath = join(root, 'refinery.config.yaml')
  await writeFile(
    configPath,
    [
      'vault:',
      `  path: ${JSON.stringify(vault)}`,
      'sources:',
      `  - ${JSON.stringify(sources)}`,
      'languages: [en]',
      'state:',
      `  path: ${JSON.stringify(statePath)}`,
      'logs:',
      `  dir: ${JSON.stringify(logs)}`,
      '',
    ].join('\n'),
    'utf8',
  )

  return { root, configPath, runningLog, summaryNote }
}
