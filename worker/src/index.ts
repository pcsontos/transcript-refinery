import { createD1Store, type D1Like } from './d1.js'
import {
  applyKnocks,
  handleCallback,
  handleCron,
  handleLink,
  handleTap,
  handleUpdate,
  type WorkerDeps,
} from './handle.js'
import { LINK_INVALID_PAGE, newToken } from './plan.js'

interface Env {
  DB: D1Like
  TELEGRAM_ALLOWED_EMAILS: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_BOT_USERNAME: string
  TELEGRAM_WEBHOOK_SECRET: string
  REFINERY_SERVE_SECRET: string
  SERVE_URL: string
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  access?: { getIdentity(): Promise<{ email?: unknown; user_uuid?: unknown } | undefined> }
}

function sameText(actual: string | undefined, expected: string | undefined): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected === '' || actual.length !== expected.length) {
    return false
  }
  let diff = 0
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return diff === 0
}

async function identity(ctx: ExecutionContext): Promise<{ sub: string; email: string } | null> {
  if (ctx.access === undefined) return null
  try {
    const who = await ctx.access.getIdentity()
    if (who === undefined || typeof who.email !== 'string' || who.email === '') return null
    if (typeof who.user_uuid !== 'string' || who.user_uuid === '') return null
    return { sub: who.user_uuid, email: who.email }
  } catch {
    return null
  }
}

function deps(env: Env, linkBase = ''): WorkerDeps {
  return {
    allowedEmails: env.TELEGRAM_ALLOWED_EMAILS,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    linkBase,
    store: createD1Store(env.DB),
    now: () => Date.now(),
    newToken,
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
    send: async (chatId, text, button) => {
      const payload: {
        chat_id: string
        text: string
        reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] }
      } = { chat_id: chatId, text }
      if (button) payload.reply_markup = { inline_keyboard: [[{ text: button.text, callback_data: button.data }]] }
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return response.ok
      } catch {
        return false
      }
    },
    answerTap: async (callbackQueryId) => {
      try {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQueryId }),
        })
      } catch {
        return undefined
      }
    },
  }
}

function hasNumericId(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number'
}

function isTap(value: unknown): value is {
  update_id: number
  callback_query: { id: string; data?: string; from?: { id: number }; message?: { chat: { id: number } } }
} {
  if (typeof value !== 'object' || value === null) return false
  const update = value as { update_id?: unknown; callback_query?: unknown }
  if (typeof update.update_id !== 'number') return false
  if (typeof update.callback_query !== 'object' || update.callback_query === null) return false
  const query = update.callback_query as { id?: unknown; from?: unknown }
  if (query.from !== undefined && !hasNumericId(query.from)) return false
  return typeof query.id === 'string'
}

function isUpdate(value: unknown): value is {
  update_id: number
  message?: { message_id: number; chat: { id: number }; from?: { id: number }; text?: string }
} {
  if (typeof value !== 'object' || value === null) return false
  const update = value as { update_id?: unknown; message?: unknown }
  if (typeof update.update_id !== 'number') return false
  if (update.message === undefined) return true
  if (typeof update.message !== 'object' || update.message === null) return false
  const message = update.message as { message_id?: unknown; chat?: unknown; from?: unknown }
  if (typeof message.message_id !== 'number') return false
  if (message.from !== undefined && !hasNumericId(message.from)) return false
  return hasNumericId(message.chat)
}

function isCallback(
  value: unknown,
): value is { status: 'ready'; title: string; noteUrl?: string } | { status: 'failed'; error: string } {
  if (typeof value !== 'object' || value === null) return false
  const body = value as { status?: unknown; title?: unknown; error?: unknown; noteUrl?: unknown }
  if (body.status === 'ready') {
    if (typeof body.title !== 'string') return false
    return body.noteUrl === undefined || typeof body.noteUrl === 'string'
  }
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
      const workerDeps = deps(env, url.origin)
      if (isTap(update)) {
        const knocks = await handleTap(update, workerDeps)
        ctx.waitUntil(applyKnocks(knocks, workerDeps))
        return new Response(null, { status: 200 })
      }
      if (!isUpdate(update)) return new Response(null, { status: 400 })
      const result = await handleUpdate(update, workerDeps)
      ctx.waitUntil(applyKnocks(result.knocks, workerDeps))
      return new Response(null, { status: 200 })
    }
    if (url.pathname === '/link' && request.method === 'GET') {
      const who = await identity(ctx)
      if (who === null) return new Response(null, { status: 403 })
      const result = await handleLink(url.searchParams.get('t') ?? '', who, deps(env, url.origin))
      if (result.status === 302) return Response.redirect(result.location, 302)
      const page = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Transcript Refinery</title><p>${LINK_INVALID_PAGE}</p></html>`
      return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
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
