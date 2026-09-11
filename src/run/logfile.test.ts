import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRunLog } from './log.js'
import { findRun, isRunId, listRuns, parseEventId, readRunEvents } from './logfile.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-logfile-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('isRunId', () => {
  it('a futásazonosító alakját elfogadja, ütközési utótaggal is', () => {
    expect(isRunId('2026-09-07T02-14-03')).toBe(true)
    expect(isRunId('2026-09-07T02-14-03-2')).toBe(true)
  })

  it('minden más alakot elutasít', () => {
    for (const value of [
      '',
      '..',
      '../2026-09-07T02-14-03',
      '2026-09-07T02-14-03.jsonl',
      '2026-09-07',
      'x2026-09-07T02-14-03',
      '2026-09-07T02-14-03/..',
    ]) {
      expect(isRunId(value)).toBe(false)
    }
  })
})

describe('listRuns', () => {
  it('hiányzó mappára üres listát ad', async () => {
    expect(await listRuns(join(dir, 'nincs'))).toEqual([])
  })

  it('legújabb elöl, a riporttal párosítva, a más nevű fájlokat kihagyva', async () => {
    await writeFile(join(dir, '2026-09-07T02-14-03.jsonl'), '')
    await writeFile(join(dir, '2026-09-07T02-14-03.md'), '# riport')
    await writeFile(join(dir, '2026-09-08T10-00-00.jsonl'), '')
    await writeFile(join(dir, 'jegyzet.jsonl'), '')
    await writeFile(join(dir, '2026-09-08T10-00-00.txt'), '')

    expect(await listRuns(dir)).toEqual([
      {
        runId: '2026-09-08T10-00-00',
        logPath: join(dir, '2026-09-08T10-00-00.jsonl'),
        reportPath: null,
      },
      {
        runId: '2026-09-07T02-14-03',
        logPath: join(dir, '2026-09-07T02-14-03.jsonl'),
        reportPath: join(dir, '2026-09-07T02-14-03.md'),
      },
    ])
  })
})

describe('readRunEvents', () => {
  it('a lezárt sorokat adja vissza, a sor utáni bájt-offsettel', async () => {
    const path = join(dir, 'run.jsonl')
    const first = '{"at":"2026-09-07T02:14:03.000Z","type":"scan:found","count":2}\n'
    const second = '{"type":"item:start","itemId":"a","title":"Árvíztűrő tükörfúrógép"}\n'
    await writeFile(path, first + second)

    const chunk = await readRunEvents(path)
    expect(chunk.lines.map((entry) => entry.line.type)).toEqual(['scan:found', 'item:start'])
    // Bájtban, nem karakterben: az ékezetes cím miatt a kettő eltér.
    expect(chunk.lines[0]!.end).toBe(Buffer.byteLength(first))
    expect(chunk.nextOffset).toBe(Buffer.byteLength(first + second))
    expect(chunk.invalid).toBe(0)
  })

  it('a félig kiírt utolsó sort a következő olvasásra hagyja', async () => {
    const path = join(dir, 'run.jsonl')
    const whole = '{"type":"scan:found","count":1}\n'
    await writeFile(path, `${whole}{"type":"item:st`)

    const chunk = await readRunEvents(path)
    expect(chunk.lines).toHaveLength(1)
    expect(chunk.nextOffset).toBe(Buffer.byteLength(whole))

    await appendFile(path, 'art","itemId":"a","title":"t"}\n')
    const next = await readRunEvents(path, chunk.nextOffset)
    expect(next.lines.map((entry) => entry.line.type)).toEqual(['item:start'])
  })

  it('az értelmezhetetlen sort kihagyja és megszámolja', async () => {
    const path = join(dir, 'run.jsonl')
    await writeFile(path, 'nem json\n{"nincs":"típus"}\n{"type":"scan:found","count":1}\n')

    const chunk = await readRunEvents(path)
    expect(chunk.lines.map((entry) => entry.line.type)).toEqual(['scan:found'])
    expect(chunk.invalid).toBe(2)
  })

  it('a fájl végénél nem kisebb offsetre üres választ ad', async () => {
    const path = join(dir, 'run.jsonl')
    await writeFile(path, '{"type":"scan:found","count":1}\n')
    expect(await readRunEvents(path, 9999)).toEqual({ lines: [], nextOffset: 9999, invalid: 0 })
  })

  it('az openRunLog által írt naplót időbélyeggel olvassa vissza', async () => {
    const log = openRunLog(join(dir, 'run.jsonl'))
    log.sink({ type: 'scan:found', count: 3 })
    log.close()

    const [entry] = (await readRunEvents(log.path)).lines
    expect(entry!.line.type).toBe('scan:found')
    expect(typeof entry!.line.at).toBe('string')
  })
})

describe('parseEventId', () => {
  it('a nemnegatív egész szöveget számmá alakítja', () => {
    expect(parseEventId('0')).toBe(0)
    expect(parseEventId('1234')).toBe(1234)
  })

  it('minden másra nullát ad', () => {
    for (const value of [undefined, '', '-1', '1.5', '12a', ' 12']) {
      expect(parseEventId(value)).toBe(0)
    }
  })
})

describe('findRun', () => {
  it('létező futásra a fájljait adja', async () => {
    await writeFile(join(dir, '2026-09-07T02-14-03.jsonl'), '')
    expect(findRun(dir, '2026-09-07T02-14-03')).toEqual({
      runId: '2026-09-07T02-14-03',
      logPath: join(dir, '2026-09-07T02-14-03.jsonl'),
      reportPath: null,
    })
  })

  it('nem runId alakú vagy nem létező futásra null', async () => {
    await writeFile(join(dir, '2026-09-07T02-14-03.jsonl'), '')
    expect(findRun(dir, '../2026-09-07T02-14-03')).toBeNull()
    expect(findRun(dir, '2026-09-08T00-00-00')).toBeNull()
  })
})
