import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../cli.js'
import { overview } from '../help.js'
import { acceptJob, claimGate, createServeServer, type ServeGate } from './http.js'
import { NotesUnavailable, type NotesSource } from './notes.js'

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

describe('createServeServer /notes', () => {
  async function start(notes?: NotesSource): Promise<number> {
    server = createServeServer({ secret: 'titok', gate, version: '9.9.9', notes, onJob: () => Promise.resolve() })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return (server.address() as { port: number }).port
  }

  const get = (port: number, path: string, secret = 'titok') =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${secret}` } })

  const view = { title: 'Cím', url: null, origin: 'cli' as const, generatedAt: null, html: '<p>x</p>' }

  function fake(): NotesSource & { asked: [string, string][] } {
    const asked: [string, string][] = []
    return {
      asked,
      list: () => Promise.resolve({ stale: false, items: [] }),
      note: (itemId, kind) => {
        asked.push([itemId, kind])
        return Promise.resolve(itemId === 'abcdefghijk' && kind === 'summary' ? view : null)
      },
    }
  }

  it('titok nélkül mindkét útvonal 401', async () => {
    const port = await start(fake())
    expect((await get(port, '/notes', 'rossz')).status).toBe(401)
    expect((await get(port, '/notes/abcdefghijk/summary', 'rossz')).status).toBe(401)
  })

  it('a lista és a jegyzet JSON, a dekódolt szakaszokkal', async () => {
    const notes = fake()
    const port = await start(notes)
    const list = await get(port, '/notes')
    expect(list.status).toBe(200)
    expect(list.headers.get('content-type')).toBe('application/json')
    expect(await list.json()).toEqual({ stale: false, items: [] })
    const one = await get(port, '/notes/abcdefghijk/summary')
    expect(one.status).toBe(200)
    expect(await one.json()).toEqual(view)
    expect((await get(port, '/notes/abcdefghijk/..%2F..%2Fetc')).status).toBe(404)
    expect(notes.asked).toEqual([
      ['abcdefghijk', 'summary'],
      ['abcdefghijk', '../../etc'],
    ])
  })

  it('a hibás kódolás, a hiányzó fajta és a POST 404', async () => {
    const notes = fake()
    const port = await start(notes)
    expect((await get(port, '/notes/%E0/summary')).status).toBe(404)
    expect((await get(port, '/notes/abcdefghijk')).status).toBe(404)
    expect((await get(port, '/notes/')).status).toBe(404)
    const post = await fetch(`http://127.0.0.1:${port}/notes`, { method: 'POST', headers: { authorization: 'Bearer titok' } })
    expect(post.status).toBe(404)
    expect(notes.asked).toEqual([])
  })

  it('vault nélkül 503, váratlan hibánál 500', async () => {
    const none = await start()
    expect((await get(none, '/notes')).status).toBe(503)
    server?.close()
    await once(server!, 'close')
    const unavailable = await start({
      list: () => Promise.reject(new NotesUnavailable('nincs config')),
      note: () => Promise.reject(new NotesUnavailable('nincs config')),
    })
    expect((await get(unavailable, '/notes')).status).toBe(503)
    expect((await get(unavailable, '/notes/abcdefghijk/summary')).status).toBe(503)
    server?.close()
    await once(server!, 'close')
    const broken = await start({ list: () => Promise.reject(new Error('váratlan')), note: () => Promise.resolve(null) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await get(broken, '/notes')).status).toBe(500)
    spy.mockRestore()
  })
})

describe('claimGate', () => {
  it('a foglalt kapu alatt a job 409, a második foglalás null, a felszabadítás után újra 202', () => {
    const local: ServeGate = { current: null }
    const release = claimGate(local, 'notes')
    expect(release).not.toBeNull()
    expect(local.current).toBe('notes')
    expect(acceptJob(local, 'job-1')).toBe(409)
    expect(claimGate(local, 'notes')).toBeNull()
    release?.()
    expect(local.current).toBeNull()
    expect(acceptJob(local, 'job-1')).toBe(202)
    expect(claimGate(local, 'notes')).toBeNull()
  })
})
