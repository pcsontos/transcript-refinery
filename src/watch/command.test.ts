import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { queuePath } from '../queue/file.js'
import { commandWatch, type WatchRuntime } from './command.js'

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

const start = (
  stop: Promise<void>,
  source?: string,
  hooks: { onLine?: (line: string) => void; signals?: WatchRuntime['signals'] } = {},
) =>
  commandWatch(
    cfg,
    { source, commit: false },
    {
      out: (l) => {
        lines.push(l)
        hooks.onLine?.(l)
      },
      now: () => new Date(2026, 8, 25, 14, 32, 5),
      quietMs: 200,
      stabilityMs: 200,
      signals: hooks.signals ?? { on: () => {}, off: () => {} },
      stop,
    },
  )

const READY = 'várom az új feliratokat'

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
    // A kör első sorára (az átiratra) kérünk leállítást: a kör ekkor még fut,
    // a _queue.md-sor csak utána jön.
    const done = start(new Promise<void>((r) => (stop = r)), undefined, {
      onLine: (l) => {
        if (l.includes('új átirat: ') && l.includes('Új')) stop()
      },
    })
    await until(() => lines.some((l) => l.includes(READY)))
    await writeFile(join(downloads, 'Csatorna', 'Új.en.srt'), SRT, 'utf8')
    expect(await done).toBe(0)
    const stopAt = lines.findIndex((l) => l.includes('új átirat: ') && l.includes('Új'))
    const tail = lines.slice(stopAt)
    expect(tail).toEqual([
      '14:32:05  új átirat: letoltes / Új (en)',
      '14:32:05  _queue.md frissítve: +1 elem',
      '14:32:05  leállítva',
    ])
    expect(await readFile(queuePath(cfg.notesRoot), 'utf8')).toContain('Új')
    const all = await readdir(work, { recursive: true })
    expect(all.some((p) => p.endsWith('state.db'))).toBe(true)
  })

  it('a felzárkózó kör alatti Ctrl+C megvárja a kört, nem indít figyelést, és 0-val lép ki', async () => {
    await writeFile(join(downloads, 'Csatorna', 'Régi.en.srt'), SRT, 'utf8')
    const listeners = new Map<string, () => void>()
    const signals = {
      on: (event: string, listener: () => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    }
    const done = start(new Promise<void>(() => {}), undefined, {
      signals,
      onLine: (l) => {
        if (l.includes('új átirat: ')) listeners.get('SIGINT')?.()
      },
    })
    expect(await done).toBe(0)
    expect(lines.slice(1)).toEqual([
      '14:32:05  új átirat: letoltes / Régi (en)',
      '14:32:05  _queue.md frissítve: +1 elem',
      '14:32:05  leállítva',
    ])
    expect(listeners.size).toBe(0)
  })

  it('a felzárkózó kör alatt érkező feliratot is feldolgozza', async () => {
    await writeFile(join(downloads, 'Csatorna', 'Régi.en.srt'), SRT, 'utf8')
    let stop!: () => void
    // A felzárkózó kör az elemeit már felderítette, amikor az átirat sora kijön:
    // az ekkor érkező felirat csak a figyelésből tudhat.
    const done = start(new Promise<void>((r) => (stop = r)), undefined, {
      onLine: (l) => {
        if (l.includes('új átirat: ') && l.includes('Régi')) {
          writeFileSync(join(downloads, 'Csatorna', 'Közben.en.srt'), SRT, 'utf8')
        }
      },
    })
    await until(() => lines.some((l) => l.includes('új átirat: ') && l.includes('Közben')))
    stop()
    expect(await done).toBe(0)
  })

  it('a már feldolgozott, indításkor ott lévő felirat a figyelés alatt nem ad új sort', async () => {
    await writeFile(join(downloads, 'Csatorna', 'Régi.en.srt'), SRT, 'utf8')
    let stop!: () => void
    const done = start(new Promise<void>((r) => (stop = r)))
    await until(() => lines.some((l) => l.includes(READY)))
    // A csend (200 ms) + stabilitás (200 ms) bőven lejár: egy esetleges utólagos
    // macOS-esemény köre is lefutna.
    await new Promise((r) => setTimeout(r, 1000))
    stop()
    expect(await done).toBe(0)
    const after = lines.slice(lines.findIndex((l) => l.includes(READY)) + 1)
    expect(after).toEqual(['14:32:05  leállítva'])
  })
})
