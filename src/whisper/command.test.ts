import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { openState } from '../state/db.js'
import { NO_AFTER } from './after.js'
import { commandListAudios, commandTranscribe } from './command.js'

let dir: string
let archive: string
let whisper: string

function io() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) }
}

async function put(root: string, rel: string, text = 'x'): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}

async function configFile(withWhisper: boolean): Promise<string> {
  const lines = [
    `vault:\n  path: ${dir}/vault`,
    `sources:\n  - ${dir}/src`,
    `languages: [hu]`,
    `logs:\n  dir: ${dir}/logs`,
    `audio:\n  dir: ${archive}`,
    `whisper:\n  dir: ${whisper}`,
  ]
  if (!withWhisper) lines.pop()
  const path = join(dir, 'refinery.config.yaml')
  await writeFile(path, lines.join('\n') + '\n')
  return path
}

function config(withWhisper = true, after = false): Config {
  return loadConfig(
    {
      vault: { path: `${dir}/vault` },
      sources: [`${dir}/src`],
      languages: ['hu'],
      logs: { dir: `${dir}/logs` },
      audio: { dir: archive },
      ...(withWhisper
        ? { whisper: { dir: whisper, ...(after ? { after: { recipes: ['summary'] } } : {}) } }
        : { whisper: { dir: join(dir, 'nincs-whisper') } }),
    },
    join(dir, 'refinery.config.yaml'),
  )
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'whisper-cmd-'))
  archive = join(dir, 'archive')
  whisper = join(dir, 'whisper')
  await mkdir(join(whisper, 'inbox'), { recursive: true })
  await put(archive, 'Csat/Egy [aaaaaaaaaaa].m4a')
  await put(archive, 'Csat/Egy [aaaaaaaaaaa].info.json', JSON.stringify({ title: 'Egy', channel: 'Csat', duration: 3723, upload_date: '20260301' }))
})

describe('commandTranscribe', () => {
  it('whisper-mappa nélkül: 1-es kód, a mappa nem jön létre', async () => {
    const missing = join(dir, 'nincs')
    await writeFile(join(dir, 'refinery.config.yaml'), `vault:\n  path: ${dir}/v\nsources:\n  - ${dir}/src\naudio:\n  dir: ${archive}\nwhisper:\n  dir: ${missing}\n`)
    const streams = io()
    expect(await commandTranscribe(['aaaaaaaaaaa', '--config', join(dir, 'refinery.config.yaml')], streams)).toBe(1)
    expect(streams.err).toEqual([`nincs whisper-mappa: ${missing}`])
    expect(existsSync(missing)).toBe(false)
    expect(existsSync(join(dir, 'logs'))).toBe(false)
  })

  it('config nélkül a config-betöltés hibája, 1', async () => {
    const streams = io()
    expect(await commandTranscribe(['aaaaaaaaaaa', '--config', join(dir, 'nincs.yaml')], streams)).toBe(1)
    expect(streams.err[0]).toContain('Nincs konfigurációs fájl')
  })

  it('audio blokk nélkül hiba', async () => {
    await writeFile(join(dir, 'refinery.config.yaml'), `vault:\n  path: ${dir}/v\nsources:\n  - ${dir}/src\n`)
    const streams = io()
    expect(await commandTranscribe(['a', '--config', join(dir, 'refinery.config.yaml')], streams)).toBe(1)
    expect(streams.err).toEqual(['Nincs audio blokk a configban.'])
  })

  it('rossz --lang: 1, semmi nem adódik le', async () => {
    const config = await configFile(true)
    const streams = io()
    expect(await commandTranscribe(['aaaaaaaaaaa', '--lang', 'xyz1', '--config', config], streams)).toBe(1)
    expect(streams.err).toEqual(['A --lang értéke egyetlen nyelvkód, például hu vagy en-US.'])
    expect(await readdir(join(whisper, 'inbox'))).toEqual([])
  })

  it('archivált tételre „1 tétel leadva.”, 0 és futásnapló; kész tételre kihagyva', async () => {
    const config = await configFile(true)
    const streams = io()
    expect(await commandTranscribe(['aaaaaaaaaaa', '--config', config], streams)).toBe(0)
    expect(streams.out.slice(0, 2)).toEqual(['leadva: Egy [aaaaaaaaaaa]', '1 tétel leadva.'])
    expect(await readdir(join(whisper, 'inbox'))).toContain('aaaaaaaaaaa.m4a')
    expect(await readdir(join(dir, 'logs'))).toHaveLength(1)

    await put(dir, 'src/whisper/csat/aaaaaaaaaaa.hu.srt')
    const again = io()
    expect(await commandTranscribe(['aaaaaaaaaaa', '--config', config], again)).toBe(0)
    expect(again.out[0]).toBe('kihagyva (kész): Egy [aaaaaaaaaaa]')
  })

  it('ismeretlen hang → 1', async () => {
    const config = await configFile(true)
    const streams = io()
    expect(await commandTranscribe(['nincs', '--config', config], streams)).toBe(1)
    expect(streams.out[0]).toBe('hiba: nincs: nincs ilyen hang')
  })

  describe('megvárja az átírást: kilépési kódok', () => {
    /** Élő figyelő (friss életjel); a hamis `sleep` hívásonként a következő lépést teszi. */
    async function waiting(config: string, ...list: (() => Promise<void> | void)[]) {
      await put(whisper, 'heartbeat', '')
      const streams = io()
      let calls = 0
      const code = await commandTranscribe(['aaaaaaaaaaa', '--config', config], {
        ...streams,
        isTTY: false,
        sleep: async () => {
          calls += 1
          await list[calls - 1]?.()
        },
      })
      return { code, out: streams.out }
    }

    it('kész → 0', async () => {
      const result = await waiting(await configFile(true), async () => {
        await put(dir, 'src/whisper/csat/aaaaaaaaaaa.hu.srt')
        await rm(join(whisper, 'inbox', 'aaaaaaaaaaa.m4a'))
      })
      expect(result.code).toBe(0)
      expect(result.out).toContain('kész: Egy [aaaaaaaaaaa]')
    })

    it('hiba → 1', async () => {
      const result = await waiting(await configFile(true), async () => {
        await put(whisper, 'failed/aaaaaaaaaaa.log', 'ffmpeg: invalid data\n')
        await rm(join(whisper, 'inbox', 'aaaaaaaaaaa.m4a'))
      })
      expect(result.code).toBe(1)
      expect(result.out).toContain('hiba: Egy [aaaaaaaaaaa]: ffmpeg: invalid data')
    })

    it('saját Ctrl-C várakozás közben → 130, a sorban álló tétel törlődik', async () => {
      const config = await configFile(true)
      await put(whisper, 'heartbeat', '')
      const listeners: (() => void)[] = []
      const streams = io()
      const code = await commandTranscribe(['aaaaaaaaaaa', '--config', config], {
        ...streams,
        isTTY: false,
        signals: { on: (_event: string, listener: () => void) => void listeners.push(listener), off: () => undefined },
        sleep: () => {
          listeners.forEach((listener) => listener())
          return Promise.resolve()
        },
      })
      expect(code).toBe(130)
      expect(existsSync(join(whisper, 'inbox', 'aaaaaaaaaaa.m4a'))).toBe(false)
      expect(streams.out).toContain('megszakítva: Egy [aaaaaaaaaaa]')
    })
  })
})

describe('commandListAudios', () => {
  beforeEach(async () => {
    await put(archive, 'Csat/Kész [bbbbbbbbbbb].m4a')
    await put(archive, 'Csat/Vár [ccccccccccc].m4a')
    await put(archive, 'Más/Hibás [ddddddddddd].m4a')
    await put(dir, 'src/whisper/csat/bbbbbbbbbbb.hu.srt')
    await put(whisper, 'inbox/ccccccccccc.m4a')
    await put(whisper, 'failed/ddddddddddd.m4a')
    await put(whisper, 'failed/ddddddddddd.log', 'ffmpeg: invalid data\n')
    await writeFile(join(whisper, 'heartbeat'), '')
  })

  it('állapotok, hossz és dátum', async () => {
    const streams = io()
    expect(await commandListAudios(config(), {}, streams)).toBe(0)
    const text = streams.out.join('\n')
    expect(text).toContain('kész')
    expect(text).toContain('vár')
    expect(text).toContain('hibás: ffmpeg: invalid data')
    expect(text).toContain('archivált')
    expect(text).toContain('1:02:03')
    expect(text).toContain('2026-03-01')
    expect(text).not.toContain('A whisper-figyelő nem fut')
  })

  it('--status pending: csak az archivált és a hibás', async () => {
    const streams = io()
    await commandListAudios(config(), { status: 'pending' }, streams)
    const text = streams.out.join('\n')
    expect(text).toContain('aaaaaaaaaaa')
    expect(text).toContain('ddddddddddd')
    expect(text).not.toContain('bbbbbbbbbbb')
    expect(text).not.toContain('ccccccccccc')
  })

  it('--status done → hibaüzenet, 1', async () => {
    const streams = io()
    expect(await commandListAudios(config(), { status: 'done' }, streams)).toBe(1)
    expect(streams.err).toEqual(['Az --audios mellett a --status értéke csak pending lehet.'])
  })

  it('--channel részszöveg, kis-nagybetű nélkül; --limit a szűrés után', async () => {
    const streams = io()
    await commandListAudios(config(), { channel: 'MÁS' }, streams)
    expect(streams.out.join('\n')).toContain('ddddddddddd')
    expect(streams.out.join('\n')).not.toContain('bbbbbbbbbbb')
    const limited = io()
    await commandListAudios(config(), { channel: 'csat', limit: 1 }, limited)
    expect(limited.out.filter((line) => /\[?[a-z]{11}/.test(line) && line.includes('Csat'))).toHaveLength(1)
  })

  it('figyelő nélkül figyelmeztetés az elején', async () => {
    await rm(join(whisper, 'heartbeat'))
    const streams = io()
    await commandListAudios(config(), {}, streams)
    expect(streams.out[0]).toMatch(/^A whisper-figyelő nem fut \(utolsó életjel: nincs\)/)
  })

  it('whisper-mappa nélkül egy sor jelzi, az állapot archivált/kész', async () => {
    const streams = io()
    expect(await commandListAudios(config(false), {}, streams)).toBe(0)
    expect(streams.out[0]).toContain('Nincs whisper-mappa')
    expect(streams.out.join('\n')).toContain('kész')
    expect(streams.out.join('\n')).not.toContain('vár ')
  })

  describe('receptek', () => {
    beforeEach(async () => {
      await put(archive, 'Csat/Recepttel [eeeeeeeeeee].m4a')
      await put(dir, 'src/whisper/csat/eeeeeeeeeee.hu.srt')
      const cfg = config(true, true)
      const store = openState(cfg.statePath, cfg.vaultPath)
      for (const id of ['bbbbbbbbbbb', 'eeeeeeeeeee']) {
        store.recordItem({ itemId: id, source: 'whisper', sourceFile: `whisper/csat/${id}.hu.srt`, subtitlePath: `/s/${id}.hu.srt`, baseName: id, title: id, language: 'hu', metadata: {} })
      }
      store.recordArtifact('eeeeeeeeeee', 'summary', 'done', `${cfg.vaultPath}/e.md`, null)
      store.close()
    })

    const rowOf = (lines: string[], id: string): string => lines.find((line) => line.startsWith(id)) ?? ''

    it('receptek oszlop', async () => {
      const streams = io()
      expect(await commandListAudios(config(true, true), {}, streams)).toBe(0)
      expect(streams.out.find((line) => line.startsWith('kulcs'))).toMatch(/állapot +receptek$/)
      expect(rowOf(streams.out, 'eeeeeeeeeee')).toMatch(/summary ✓$/)
      expect(rowOf(streams.out, 'bbbbbbbbbbb')).toMatch(/—$/)
      expect(rowOf(streams.out, 'aaaaaaaaaaa')).toMatch(/—$/)
    })

    it('--no-recipe: az átírt, recept nélküli és a leadható tételek', async () => {
      const streams = io()
      expect(await commandListAudios(config(true, true), { noRecipe: true }, streams)).toBe(0)
      const text = streams.out.join('\n')
      expect(text).toContain('bbbbbbbbbbb')
      expect(text).toContain('aaaaaaaaaaa')
      expect(text).not.toContain('eeeeeeeeeee')
    })

    it('--no-recipe whisper.after nélkül: hiba', async () => {
      const streams = io()
      expect(await commandListAudios(config(), { noRecipe: true }, streams)).toBe(1)
      expect(streams.err).toEqual([NO_AFTER])
    })

    it('--no-recipe --status pending: a metszet', async () => {
      const streams = io()
      await commandListAudios(config(true, true), { noRecipe: true, status: 'pending' }, streams)
      const text = streams.out.join('\n')
      expect(text).toContain('aaaaaaaaaaa')
      expect(text).not.toContain('bbbbbbbbbbb')
    })
  })
})
