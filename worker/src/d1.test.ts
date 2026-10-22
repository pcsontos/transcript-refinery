import { describe, expect, it } from 'vitest'
import { createD1Store, type D1Like, type D1Statement } from './d1.js'
import type { JobRow } from './store.js'

function capture(): D1Like & { calls: { sql: string; values: unknown[] }[] } {
  const calls: { sql: string; values: unknown[] }[] = []
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] as unknown[] }
      calls.push(call)
      const statement: D1Statement = {
        bind(...values) {
          call.values = values
          return statement
        },
        all: <T>() => Promise.resolve({ results: [] as T[] }),
        first: () => Promise.resolve(null),
        run: () => Promise.resolve({ meta: { changes: 1 } }),
      }
      return statement
    },
  }
}

const row: JobRow = {
  jobId: '5:t-0123456789abcdef',
  updateId: 5,
  chatId: '42',
  messageId: 5,
  videoId: 't-0123456789abcdef',
  url: '',
  status: 'waiting',
  error: null,
  title: 'Cím',
  notifiedReady: false,
  acceptedAt: null,
  sub: 'sub-42',
  fileId: 'F5',
  fileName: 'átirat.md',
  text: 'Szöveg.',
}

describe('D1: szöveges sor', () => {
  it('a beszúrás és a nyitott mentés viszi a file_id-t, a nevet és a szöveget; a lezárt mentés a szöveget null-ra írja', async () => {
    const db = capture()
    const store = createD1Store(db)
    await store.insert(row)
    await store.save(row)
    await store.save({ ...row, status: 'ready' })
    const [insert, open, closed] = db.calls
    expect(insert?.values.slice(-3)).toEqual(['F5', 'átirat.md', 'Szöveg.'])
    expect(open?.values.slice(-4, -1)).toEqual(['F5', 'átirat.md', 'Szöveg.'])
    expect(closed?.values.slice(-4, -1)).toEqual(['F5', 'átirat.md', null])
  })

  it('a megszakítás a szöveget is üríti', async () => {
    const db = capture()
    await createD1Store(db).claimJob(row.jobId, 'queued', 'cancelled')
    expect(db.calls[0]?.sql).toContain('text = NULL')
  })
})

describe('D1: modellfelülírás', () => {
  const run = {
    runId: '5:abcdefghijk:notes',
    jobId: '5:abcdefghijk',
    recipes: ['notes'],
    lang: null,
    status: 'queued' as const,
    error: null,
    noteUrl: null,
    notified: false,
    acceptedAt: null,
  }

  it('az insertRun viszi a model oszlopot, modell nélkül null-t', async () => {
    const db = capture()
    const store = createD1Store(db)
    await store.insertRun({ ...run, model: 'sonnet' })
    await store.insertRun(run)
    expect(db.calls[0]?.sql).toContain('model')
    expect(db.calls[0]?.values.at(-1)).toBe('sonnet')
    expect(db.calls[1]?.values.at(-1)).toBeNull()
  })

  it('a claimRun csak modellel cseréli a model oszlopot', async () => {
    const db = capture()
    const store = createD1Store(db)
    await store.claimRun(run.runId, 'failed', 'queued', 'm')
    await store.claimRun(run.runId, 'failed', 'queued')
    expect(db.calls[0]?.sql).toContain('model = ?')
    expect(db.calls[0]?.values).toEqual(['queued', 'm', run.runId, 'failed'])
    expect(db.calls[1]?.sql).not.toContain('model')
  })

  it('a setOverride a (sub, recipe, mode) kulcson cserél', async () => {
    const db = capture()
    await createD1Store(db).setOverride({ sub: 's', recipe: 'notes', mode: 'once', model: 'm' })
    expect(db.calls[0]?.sql).toContain('ON CONFLICT(sub, recipe, mode)')
  })
})
