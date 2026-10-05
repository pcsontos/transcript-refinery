import { createD1Store, type D1Like } from './d1.js'
import { applyKnocks, handleCallback, handleCron, handleUpdate, type WorkerDeps } from './handle.js'

interface Env {
  DB: D1Like
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_OWNER_CHAT_ID: string
  TELEGRAM_WEBHOOK_SECRET: string
  REFINERY_SERVE_SECRET: string
  SERVE_URL: string
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

function sameText(actual: string, expected: string): boolean {
  if (expected === '' || actual.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

function deps(env: Env): WorkerDeps {
  return {
    ownerChatId: env.TELEGRAM_OWNER_CHAT_ID,
    store: createD1Store(env.DB),
    now: () => Date.now(),
    knock: async (job) => {
      try {
        const response = await fetch(`${env.SERVE_URL.replace(/\/$/, '')}/jobs`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.REFINERY_SERVE_SECRET}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(job),
        })
        if (response.status === 202 || response.status === 409 || response.status === 401) return response.status
        return 'down'
      } catch {
        return 'down'
      }
    },
    send: async (text) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: env.TELEGRAM_OWNER_CHAT_ID, text }),
        })
        return response.ok
      } catch {
        return false
      }
    },
  }
}

function isUpdate(value: unknown): value is {
  update_id: number
  message?: { message_id: number; chat: { id: number }; text?: string }
} {
  if (typeof value !== 'object' || value === null) return false
  const update = value as { update_id?: unknown; message?: unknown }
  if (typeof update.update_id !== 'number') return false
  if (update.message === undefined) return true
  if (typeof update.message !== 'object' || update.message === null) return false
  const message = update.message as { message_id?: unknown; chat?: unknown; text?: unknown }
  if (typeof message.message_id !== 'number') return false
  if (typeof message.chat !== 'object' || message.chat === null) return false
  return typeof (message.chat as { id?: unknown }).id === 'number'
}

function isCallback(value: unknown): value is { status: 'ready'; title: string } | { status: 'failed'; error: string } {
  if (typeof value !== 'object' || value === null) return false
  const body = value as { status?: unknown; title?: unknown; error?: unknown }
  if (body.status === 'ready') return typeof body.title === 'string'
  if (body.status === 'failed') return typeof body.error === 'string'
  return false
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/telegram' && request.method === 'POST') {
      const hook = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
      if (!sameText(hook, env.TELEGRAM_WEBHOOK_SECRET)) return new Response(null, { status: 401 })
      let update: unknown
      try {
        update = await request.json()
      } catch {
        return new Response(null, { status: 400 })
      }
      if (!isUpdate(update)) return new Response(null, { status: 400 })
      const workerDeps = deps(env)
      const result = await handleUpdate(update, workerDeps)
      ctx.waitUntil(applyKnocks(result.knocks, workerDeps))
      return new Response(null, { status: 200 })
    }
    const match = /^\/internal\/jobs\/([^/]+)$/.exec(url.pathname)
    if (match?.[1] !== undefined && request.method === 'POST') {
      if (!sameText(request.headers.get('authorization') ?? '', `Bearer ${env.REFINERY_SERVE_SECRET}`)) {
        return new Response(null, { status: 401 })
      }
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response(null, { status: 400 })
      }
      if (!isCallback(body)) return new Response(null, { status: 400 })
      const status = await handleCallback(decodeURIComponent(match[1]), body, deps(env))
      return new Response(null, { status })
    }
    return new Response(null, { status: 404 })
  },
  async scheduled(_controller: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleCron(deps(env))
  },
}

export default worker
