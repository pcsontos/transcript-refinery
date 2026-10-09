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
    const bindings = await readFile('worker/migrations/0003_bindings.sql', 'utf8')
    expect(bindings).toContain('ALTER TABLE jobs ADD COLUMN sub TEXT')
    expect(bindings).toContain('CREATE TABLE bindings')
    expect(bindings).toContain('CREATE TABLE link_tokens')
    const runs = await readFile('worker/migrations/0004_runs.sql', 'utf8')
    expect(runs).toContain('CREATE TABLE runs')
    expect(runs).toContain("WHERE phase = 'summary'")
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
        first: <T>() =>
          Promise.resolve(
            (state.sql.includes('FROM bindings')
              ? { telegram_user_id: '42', sub: 'sub-42', email: 'en@example.com', bound_at: 0 }
              : null) as T | null,
          ),
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
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: 'abcdefghijk' },
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

  it('a gombkoppintás üres answerCallbackQuery választ kér, idegen chatnél kopogtatás nélkül', async () => {
    const calls: { url: string; body: string }[] = []
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const raw = init?.body
      calls.push({ url, body: typeof raw === 'string' ? raw : '' })
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    const env = {
      DB: memoryDb(),
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const request = new Request('https://worker.test/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook' },
      body: JSON.stringify({
        update_id: 50,
        callback_query: { id: 'cq', data: 'summary:5:abcdefghijk', from: { id: 7 }, message: { chat: { id: 7 } } },
      }),
    })
    const response = await worker.fetch(request, env, {
      waitUntil: (promise) => {
        void promise
      },
    })
    expect(response.status).toBe(200)
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.telegram.org/bottoken/answerCallbackQuery',
    ])
    expect(JSON.parse(calls[0]!.body)).toEqual({ callback_query_id: 'cq' })
  })

  it('a /link azonosító nélkül 403, a /Link és a //link 404, ismeretlen tokenre a hibaoldal', async () => {
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 200 }))
    const env = {
      DB: memoryDb(),
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const link = `/link?t=${'A'.repeat(43)}`
    const get = (path: string) => new Request(`https://worker.test${path}`)
    const plain = { waitUntil: () => undefined }
    const signed = {
      waitUntil: () => undefined,
      access: { getIdentity: () => Promise.resolve({ email: 'en@example.com', user_uuid: 'sub-42' }) },
    }
    const empty = { waitUntil: () => undefined, access: { getIdentity: () => Promise.resolve(undefined) } }
    const broken = { waitUntil: () => undefined, access: { getIdentity: () => Promise.reject(new Error('nincs')) } }
    const noUuid = {
      waitUntil: () => undefined,
      access: { getIdentity: () => Promise.resolve({ email: 'en@example.com', user_uuid: '' }) },
    }
    expect((await worker.fetch(get(link), env, plain)).status).toBe(403)
    expect((await worker.fetch(get(link), env, empty)).status).toBe(403)
    expect((await worker.fetch(get(link), env, broken)).status).toBe(403)
    expect((await worker.fetch(get(link), env, noUuid)).status).toBe(403)
    expect((await worker.fetch(get('/Link?t=x'), env, signed)).status).toBe(404)
    expect((await worker.fetch(get('//link?t=x'), env, signed)).status).toBe(404)
    const page = await worker.fetch(get(link), env, signed)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('A link lejárt vagy már nem érvényes. Kérj újat a botban: /start')
  })
  it('a /notes azonosító nélkül 403, a pontatlan útvonal 404, belépve lista, az ismeretlen jegyzet 404', async () => {
    globalThis.fetch = () => Promise.reject(new Error('a GitHub nem hívható'))
    const env = {
      DB: memoryDb(),
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const get = (path: string) => new Request(`https://worker.test${path}`)
    const plain = { waitUntil: () => undefined }
    const signed = {
      waitUntil: () => undefined,
      access: { getIdentity: () => Promise.resolve({ email: 'en@example.com', user_uuid: 'sub-42' }) },
    }
    expect((await worker.fetch(get('/notes'), env, plain)).status).toBe(403)
    expect((await worker.fetch(get('/notes/5:abcdefghijk/summary'), env, plain)).status).toBe(403)
    for (const path of ['/Notes', '/notes/', '//notes', '/notes/5:abcdefghijk', '/notes/a/b/c']) {
      expect((await worker.fetch(get(path), env, signed)).status).toBe(404)
    }
    expect((await worker.fetch(new Request('https://worker.test/notes', { method: 'POST' }), env, signed)).status).toBe(404)
    const list = await worker.fetch(get('/notes'), env, signed)
    expect(list.status).toBe(200)
    expect(await list.text()).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
    expect((await worker.fetch(get('/notes/5:abcdefghijk/summary'), env, signed)).status).toBe(404)
  })
  it('a futás visszahívása a kérés saját címére tett /notes linket küldi', async () => {
    const bodies: string[] = []
    globalThis.fetch = (_input, init) => {
      const raw = init?.body
      bodies.push(typeof raw === 'string' ? raw : '')
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    // A visszahívás csak ezeket a mezőket olvassa, a többit a toRow és a toRun undefined-ként adja át.
    const job = { job_id: '5:abcdefghijk', update_id: 5, chat_id: '42' }
    const run = { run_id: '5:abcdefghijk:summary', job_id: '5:abcdefghijk', recipes: 'summary', lang: null, status: 'accepted', notified: 0 }
    const db: D1Like = {
      prepare(sql: string): D1Statement {
        const statement: D1Statement = {
          bind: () => statement,
          all: <T>() => Promise.resolve({ results: (sql.includes('WHERE update_id') ? [job] : []) as T[] }),
          first: <T>() => Promise.resolve((sql.includes('FROM runs WHERE run_id') ? run : null) as T | null),
          run: () => Promise.resolve({}),
        }
        return statement
      },
    }
    const env = {
      DB: db,
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const response = await worker.fetch(
      new Request('https://worker.test/internal/jobs/5%3Aabcdefghijk%3Asummary', {
        method: 'POST',
        headers: { authorization: 'Bearer titok' },
        body: JSON.stringify({ status: 'ready', title: 'Cím', noteUrl: 'Inbox/a_transcript.md' }),
      }),
      env,
      { waitUntil: () => undefined },
    )
    expect(response.status).toBe(200)
    expect(bodies).toHaveLength(1)
    expect((JSON.parse(bodies[0]!) as { text: string }).text).toBe(
      'Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/abcdefghijk/summary',
    )
  })

  it('a felirat kész üzenete gombsort küld, a kapcsoló editMessageText-et', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') })
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    const job = { job_id: '5:abcdefghijk', update_id: 5, chat_id: '42', video_id: 'abcdefghijk', status: 'ready', notified_ready: 0, sub: 'sub-42' }
    const run = { run_id: '5:abcdefghijk:summary', job_id: '5:abcdefghijk', recipes: 'summary', lang: null, status: 'ready', notified: 1 }
    const binding = { telegram_user_id: '42', sub: 'sub-42', email: 'en@example.com', bound_at: 0 }
    const db: D1Like = {
      prepare(sql: string): D1Statement {
        const statement: D1Statement = {
          bind: () => statement,
          all: <T>() =>
            Promise.resolve({
              results: (sql.includes('WHERE update_id') ? [job] : sql.includes('FROM runs WHERE job_id') ? [run] : []) as T[],
            }),
          first: <T>() => Promise.resolve((sql.includes('FROM bindings') ? binding : null) as T | null),
          run: () => Promise.resolve({}),
        }
        return statement
      },
    }
    const env = {
      DB: db,
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const ctx = { waitUntil: () => undefined }
    await worker.fetch(
      new Request('https://worker.test/internal/jobs/5%3Aabcdefghijk', {
        method: 'POST',
        headers: { authorization: 'Bearer titok' },
        body: JSON.stringify({ status: 'ready', title: 'Cím' }),
      }),
      env,
      ctx,
    )
    expect(calls[0]?.url).toBe('https://api.telegram.org/bottoken/sendMessage')
    const sent = calls[0]?.body as { reply_markup: { inline_keyboard: unknown[][] } }
    expect(sent.reply_markup.inline_keyboard[2]?.[2]).toEqual({ text: 'fordítás', callback_data: 'f:5:abcdefghijk' })

    calls.length = 0
    await worker.fetch(
      new Request('https://worker.test/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'hook' },
        body: JSON.stringify({
          update_id: 60,
          callback_query: { id: 'cq', data: 't:1:5:abcdefghijk', from: { id: 42 }, message: { message_id: 9, chat: { id: 42 } } },
        }),
      }),
      env,
      ctx,
    )
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.telegram.org/bottoken/answerCallbackQuery',
      'https://api.telegram.org/bottoken/editMessageText',
    ])
    expect(calls[1]?.body).toEqual({
      chat_id: '42',
      message_id: 9,
      text: 'Melyik jegyzetet fordítsam?',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✓ summary', callback_data: 't:0:5:abcdefghijk' }],
          [{ text: 'tovább', callback_data: 'n:1:5:abcdefghijk' }],
        ],
      },
    })
  })
})
