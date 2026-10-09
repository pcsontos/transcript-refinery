import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ServeJob } from './job.js'

export interface ServeGate {
  current: string | null
}

export function acceptJob(gate: ServeGate, jobId: string): 202 | 409 {
  if (gate.current === null) {
    gate.current = jobId
    return 202
  }
  if (gate.current === jobId) return 202
  return 409
}

function authorized(header: string | undefined, secret: string): boolean {
  const actual = Buffer.from(header ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
  })
}

function isJob(value: unknown): value is ServeJob {
  if (typeof value !== 'object' || value === null) return false
  const job = value as { jobId?: unknown; videoId?: unknown; url?: unknown; recipe?: unknown; recipes?: unknown; lang?: unknown }
  if (typeof job.jobId !== 'string' || typeof job.videoId !== 'string' || typeof job.url !== 'string') return false
  // A régi, egyreceptes alakot a felirat-munka helyett hibaként kell látni.
  if (job.recipe !== undefined) return false
  if (job.recipes !== undefined) {
    if (!Array.isArray(job.recipes) || job.recipes.length === 0) return false
    if (!job.recipes.every((id) => typeof id === 'string')) return false
  }
  return job.lang === undefined || typeof job.lang === 'string'
}

function send(response: ServerResponse, status: number): void {
  response.writeHead(status)
  response.end()
}

function sendBody(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { 'content-type': contentType })
  response.end(body)
}

function rejectUnauthorized(request: IncomingMessage, response: ServerResponse): void {
  const rawIp = request.headers['x-forwarded-for'] ?? request.socket.remoteAddress
  const clientIp = Array.isArray(rawIp) ? rawIp[0] : (rawIp ?? 'unknown')
  console.warn(`[serve] 401 Jogosulatlan kérés: ${clientIp}`)
  send(response, 401)
}

export interface ServeServerInput {
  secret: string
  gate: ServeGate
  version: string
  onJob: (job: ServeJob) => Promise<void>
}

export function createServeServer(input: ServeServerInput): Server {
  return createServer((request, response) => {
    void handle(request, response, input)
  })
}

async function handle(request: IncomingMessage, response: ServerResponse, input: ServeServerInput): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && path === '/ping') {
    sendBody(response, 200, 'text/plain; charset=utf-8', 'ok')
    return
  }
  if (request.method === 'GET' && path === '/version') {
    sendBody(response, 200, 'application/json', JSON.stringify({ version: input.version }))
    return
  }
  if (request.method === 'GET' && path === '/status') {
    if (!authorized(request.headers.authorization, input.secret)) {
      rejectUnauthorized(request, response)
      return
    }
    sendBody(response, 200, 'application/json', JSON.stringify({ version: input.version, busy: input.gate.current }))
    return
  }
  if (request.method !== 'POST' || path !== '/jobs') {
    send(response, 404)
    return
  }
  if (!authorized(request.headers.authorization, input.secret)) {
    rejectUnauthorized(request, response)
    return
  }
  let body: unknown
  try {
    body = JSON.parse(await readBody(request)) as unknown
  } catch {
    console.warn(`[serve] 400 Hibás JSON body`)
    send(response, 400)
    return
  }
  if (!isJob(body)) {
    console.warn(`[serve] 400 Nem érvényes ServeJob body`)
    send(response, 400)
    return
  }
  const fresh = input.gate.current === null
  const status = acceptJob(input.gate, body.jobId)
  console.log(`[serve] POST /jobs: jobId=${body.jobId} videoId=${body.videoId} -> HTTP ${status} (fresh=${fresh})`)
  if (status === 202 && fresh) {
    void Promise.resolve()
      .then(() => input.onJob(body))
      .finally(() => {
        input.gate.current = null
      })
  }
  send(response, status)
}
