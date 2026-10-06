import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { D1Like, D1Statement } from './d1.js'
import worker from './index.js'

describe('szállítási fájlok', () => {
  it('a Dockerfile a Node 26.2 képről indul, és a serve parancsot futtatja', async () => {
    const docker = await readFile('Dockerfile', 'utf8')
    expect(docker).toContain('node:26.2')
    expect(docker).toContain('yt-dlp')
    expect(docker).toContain('CMD ["refinery", "serve"]')
  })

  it('a wrangler percenként fut, és a D1 kötés neve DB', async () => {
    const toml = await readFile('worker/wrangler.toml', 'utf8')
    expect(toml).toContain('crons = ["* * * * *"]')
    expect(toml).toContain('binding = "DB"')
    const sql = await readFile('worker/migrations/0001_jobs.sql', 'utf8')
    expect(sql).toContain('CREATE TABLE jobs')
    expect(sql).toContain('update_id')
    expect(sql).toContain('notified_ready')
    const summary = await readFile('worker/migrations/0002_summary.sql', 'utf8')
    expect(summary).toContain('phase')
    expect(summary).toContain('note_url')
    expect(summary).toContain('note_notified')
    expect(summary).toContain('seen_updates')
  })
})

function memoryDb(): D1Like & { rows: unknown[] } {
  const rows: unknown[] = []
  return {
    rows,
    prepare(sql: string): D1Statement {
      const state = { sql, values: [] as unknown[] }
      const statement: D1Statement = {
        bind(...values: unknown[]) {
          state.values = values
          return statement
        },
        all: <T>() => Promise.resolve({ results: [] as T[] }),
        first: <T>() => Promise.resolve(null as T | null),
        run: () => {
          if (state.sql.includes('INSERT INTO jobs')) rows.push(state.values)
          return Promise.resolve({})
        },
      }
      return statement
    },
  }
}

describe('worker belépés', () => {
  const original = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = original
  })

  it('a spec chatnevét olvassa, és webhook titok nélkül 401', async () => {
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 202 }))
    const db = memoryDb()
    const env = {
      DB: db,
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_OWNER_CHAT_ID: '42',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 42 }, text: 'abcdefghijk' },
    }
    const request = (secret?: string) =>
      new Request('https://worker.test/telegram', {
        method: 'POST',
        headers: secret === undefined ? {} : { 'x-telegram-bot-api-secret-token': secret },
        body: JSON.stringify(update),
      })
    const ctx = { waitUntil: () => undefined }
    expect((await worker.fetch(request(), env, ctx)).status).toBe(401)
    expect(db.rows).toEqual([])
    expect((await worker.fetch(request('rossz'), env, ctx)).status).toBe(401)
    expect((await worker.fetch(request('hook'), env, ctx)).status).toBe(200)
    expect(db.rows).toHaveLength(1)
  })
})
