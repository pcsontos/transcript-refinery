import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../cli.js'
import { overview } from '../help.js'
import { createServeServer, type ServeGate } from './http.js'

const gate: ServeGate = { current: null }
let server: Server | undefined

afterEach(async () => {
  if (server?.listening) {
    server.close()
    await once(server, 'close')
  }
  gate.current = null
})

async function post(port: number, secret: string, body: unknown): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.status
}

describe('createServeServer', () => {
  it('rossz titok 401, az első munka 202, ugyanaz a munka még egyszer 202, a másik 409', async () => {
    const started: string[] = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server = createServeServer({
      secret: 'titok',
      gate,
      version: '9.9.9',
      onJob: (job) => {
        started.push(job.jobId)
        return held
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const job = { jobId: 'job-1', videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' }
    expect(await post(port, 'rossz', job)).toBe(401)
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2' })).toBe(409)
    expect(started).toEqual(['job-1'])
    release()
  })

  it('a receptlista 202 és az onJob látja, a rossz lista, a rossz nyelv és a régi recipe mező 400', async () => {
    const seen: unknown[] = []
    server = createServeServer({
      secret: 'titok',
      gate,
      version: '9.9.9',
      onJob: (job) => {
        seen.push([job.recipes, job.lang])
        return Promise.resolve()
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const job = {
      jobId: 'job-1',
      videoId: 'abcdefghijk',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      recipes: ['summary', 'notes'],
      lang: 'de',
    }
    expect(await post(port, 'titok', job)).toBe(202)
    expect(seen).toEqual([[['summary', 'notes'], 'de']])
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipes: 'summary' })).toBe(400)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipes: [] })).toBe(400)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipes: [1] })).toBe(400)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', lang: 1 })).toBe(400)
    expect(await post(port, 'titok', { jobId: 'job-2', videoId: job.videoId, url: job.url, recipe: 'summary' })).toBe(400)
  })

  it('a /ping és a /version titok nélkül válaszol, a /status csak titokkal, a busy a futó job', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server = createServeServer({ secret: 'titok', gate, version: '9.9.9', onJob: () => held })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${port}`

    const ping = await fetch(`${base}/ping`)
    expect(ping.status).toBe(200)
    expect(ping.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await ping.text()).toBe('ok')

    const version = await fetch(`${base}/version`)
    expect(version.status).toBe(200)
    expect(version.headers.get('content-type')).toBe('application/json')
    expect(await version.json()).toEqual({ version: '9.9.9' })

    const status = (secret?: string) =>
      fetch(`${base}/status`, secret === undefined ? {} : { headers: { authorization: `Bearer ${secret}` } })
    const anonymous = await status()
    expect(anonymous.status).toBe(401)
    expect(await anonymous.text()).toBe('')
    expect((await status('rossz')).status).toBe(401)
    const idle = await status('titok')
    expect(idle.status).toBe(200)
    expect(idle.headers.get('content-type')).toBe('application/json')
    expect(await idle.json()).toEqual({ version: '9.9.9', busy: null })

    const job = { jobId: 'job-1', videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' }
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await (await status('titok')).json()).toEqual({ version: '9.9.9', busy: 'job-1' })
    release()
    await vi.waitFor(async () => {
      expect(await (await status('titok')).json()).toEqual({ version: '9.9.9', busy: null })
    })

    expect((await fetch(`${base}/ismeretlen`)).status).toBe(404)
    expect((await fetch(`${base}/ping`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/jobs`)).status).toBe(404)
  })
})

describe('serve parancs', () => {
  it('az áttekintés felsorolja a serve parancsot', () => {
    expect(overview()).toContain('  serve ')
  })

  it('a refinery serve --help a súgót írja, és nem nyit portot', async () => {
    expect(await main(['serve', '--help'])).toBe(0)
  })
})
