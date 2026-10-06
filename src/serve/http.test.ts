import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { USAGE, main } from '../cli.js'
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

  it('a summary recept 202 és az onJob látja, a szám recept 400', async () => {
    const seen: unknown[] = []
    server = createServeServer({
      secret: 'titok',
      gate,
      onJob: (job) => {
        seen.push(job.recipe)
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
      recipe: 'summary',
    }
    expect(await post(port, 'titok', job)).toBe(202)
    expect(seen).toEqual(['summary'])
    expect(await post(port, 'titok', { ...job, jobId: 'job-2', recipe: 1 })).toBe(400)
  })
})

describe('serve parancs', () => {
  it('a USAGE felsorolja a serve parancsot', () => {
    expect(USAGE).toContain('serve')
  })

  it('a refinery serve --help a súgót írja, és nem nyit portot', async () => {
    expect(await main(['serve', '--help'])).toBe(0)
  })
})
