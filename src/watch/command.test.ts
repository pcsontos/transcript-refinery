import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { queuePath } from '../queue/file.js'
import { commandWatch } from './command.js'

const SRT = '1\n00:00:00,000 --> 00:00:02,000\nThis is a test sentence for the probe.\n'

let work: string
let downloads: string
let cfg: Config
let lines: string[]

const until = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`időtúllépés; kimenet:\n${lines.join('\n')}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-watchcmd-'))
  downloads = join(work, 'letoltes')
  await mkdir(join(downloads, 'Csatorna'), { recursive: true })
  await mkdir(join(work, 'vault'), { recursive: true })
  cfg = loadConfig(
    { vault: { path: join(work, 'vault') }, sources: [downloads], state: { path: join(work, 'state.db') } },
    join(work, 'c.yaml'),
    work,
  )
  lines = []
})
afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

const start = (stop: Promise<void>, source?: string) =>
  commandWatch(
    cfg,
    { source, commit: false },
    {
      out: (l) => lines.push(l),
      now: () => new Date(2026, 8, 25, 14, 32, 5),
      quietMs: 200,
      stabilityMs: 200,
      signals: { on: () => {}, off: () => {} },
      stop,
    },
  )

describe('commandWatch', () => {
  it('a felzárkózó kör a már ott lévő feliratot feldolgozza; utána az újat is, időbélyeges sorokkal', async () => {
    await writeFile(join(downloads, 'Csatorna', 'Régi.en.srt'), SRT, 'utf8')
    let stop!: () => void
    const done = start(new Promise<void>((r) => (stop = r)))

    await until(() => lines.some((l) => l.includes('várom az új feliratokat')))
    // Metaadat (.info.json) nélkül a csatorna helyén a forrás neve áll (`letoltes`).
    expect(lines).toContain('14:32:05  új átirat: letoltes / Régi (en)')

    await writeFile(join(downloads, 'Csatorna', 'Új.en.srt'), SRT, 'utf8')
    await until(() => lines.some((l) => l.includes('új átirat: ') && l.includes('Új')))
    await until(() => lines.filter((l) => l.includes('_queue.md frissítve')).length >= 2)

    stop()
    expect(await done).toBe(0)
    expect(lines.at(-1)).toBe('14:32:05  leállítva')
    expect(await readFile(queuePath(cfg.notesRoot), 'utf8')).toContain('Új')
  })

  it('két gyorsan érkező felirat egy körben dolgozódik fel', async () => {
    let stop!: () => void
    const done = start(new Promise<void>((r) => (stop = r)))
    await until(() => lines.some((l) => l.includes('várom az új feliratokat')))
    await writeFile(join(downloads, 'Csatorna', 'A.en.srt'), SRT, 'utf8')
    await writeFile(join(downloads, 'Csatorna', 'B.en.srt'), SRT, 'utf8')
    await until(() => lines.filter((l) => l.includes('új átirat: ')).length === 2)
    await new Promise((r) => setTimeout(r, 800))
    // A felzárkózó kör az üres forráson is létrehozza a sort (+0 elem); csak a
    // figyelés indulása utáni sorok számítanak.
    const after = lines.slice(lines.findIndex((l) => l.includes('várom az új feliratokat')))
    expect(after.filter((l) => l.includes('_queue.md frissítve'))).toEqual(['14:32:05  _queue.md frissítve: +2 elem'])
    stop()
    await done
  })

  it('ismeretlen --source névre 1-gyel kilép', async () => {
    expect(await start(Promise.resolve(), 'nincsilyen')).toBe(1)
  })

  it('leállításkor a futó kör befejeződik', async () => {
    let stop!: () => void
    const done = start(new Promise<void>((r) => (stop = r)))
    await until(() => lines.some((l) => l.includes('várom az új feliratokat')))
    stop()
    expect(await done).toBe(0)
    const all = await readdir(work, { recursive: true })
    expect(all.some((p) => p.endsWith('state.db'))).toBe(true)
  })
})
