import { afterEach, describe, expect, it } from 'vitest'
import { notePage, notesPage, type ReaderDeps } from './reader.js'

const ID = 'zw_kFlCTPKY'
const REC = 'a1b2c3d4e5f6a7b8'
const DEPS: ReaderDeps = { serveUrl: 'http://serve.test/', secret: 'titok' }

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

type Call = { url: string; headers: Record<string, string>; signal: unknown }

function serve(respond: (url: string) => Promise<Response>): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, headers: init?.headers as Record<string, string>, signal: init?.signal })
    return respond(url)
  }
  return calls
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const link = (id: string, kind: string) => `<li><a href="/notes/${id}/${kind}">${kind}</a></li>`

describe('notesPage', () => {
  it('a serve listája: címke, dátum, KIND_ORDER szerinti fajták, a transcript a végén', async () => {
    const calls = serve(() =>
      json({
        stale: false,
        items: [
          {
            itemId: ID,
            title: '<b>Új</b>',
            url: `https://www.youtube.com/watch?v=${ID}&t=1`,
            origin: 'telegram',
            generatedAt: '2026-10-07T10:00:00.000Z',
            kinds: ['transcript', 'zz-uj', 'qa', 'summary-de', 'summary', 'aa-uj'],
          },
          { itemId: REC, title: 'Felvétel', url: null, origin: 'cli', generatedAt: '2026-10-05T10:00:00.000Z', kinds: ['transcript'] },
        ],
      }),
    )
    const response = await notesPage(DEPS)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://serve.test/notes')
    expect(calls[0]!.headers).toEqual({ authorization: 'Bearer titok' })
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
    const html = await response.text()
    expect(html).toContain(
      `<li><a href="https://www.youtube.com/watch?v=${ID}&#38;t=1">&#60;b&#62;Új&#60;/b&#62;</a> · 2026-10-07 · <span class="origin">telegram</span><ul>` +
        link(ID, 'summary') +
        link(ID, 'summary-de') +
        link(ID, 'qa') +
        link(ID, 'aa-uj') +
        link(ID, 'zz-uj') +
        link(ID, 'transcript') +
        '</ul></li>',
    )
    expect(html).toContain(`<li>Felvétel · 2026-10-05 · <span class="origin">cli</span><ul>${link(REC, 'transcript')}</ul></li>`)
    expect(html.indexOf(ID)).toBeLessThan(html.indexOf('Felvétel'))
    expect(html).not.toContain('A vault most nem frissült')
  })

  it('nem http(s) címből nem lesz link', async () => {
    serve(() =>
      json({
        stale: false,
        items: [{ itemId: ID, title: 'Gonosz', url: 'javascript:alert(1)', origin: 'cli', generatedAt: null, kinds: ['transcript'] }],
      }),
    )
    const html = await (await notesPage(DEPS)).text()
    expect(html).toContain('<li>Gonosz ·  · <span class="origin">cli</span>')
    expect(html).not.toContain('javascript:')
  })

  it('stale: true esetén a figyelmeztető sor; üres listánál a biztató mondat', async () => {
    serve(() => json({ stale: true, items: [] }))
    const html = await (await notesPage(DEPS)).text()
    expect(html).toContain('A vault most nem frissült, a lista régebbi lehet.')
    expect(html).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
  })

  it('a serve hibái 502-t adnak a megfelelő mondattal', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.reject(new DOMException('lejárt', 'TimeoutError')), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => Promise.reject(new Error('hálózat')), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => json(null, 404), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => json(null, 401), 'A Worker és a serve titka nem egyezik.'],
      [() => json(null, 503), 'A serve nem éri el a vaultot.'],
      [() => json({ items: 'x' }), 'A serve hibás választ adott.'],
      [() => Promise.resolve(new Response('nem json')), 'A serve hibás választ adott.'],
    ]
    for (const [respond, line] of cases) {
      serve(respond)
      const response = await notesPage(DEPS)
      expect(response.status).toBe(502)
      expect(await response.text()).toContain(line)
    }
  })
})

describe('notePage', () => {
  const view = { title: 'Cím', url: null, origin: 'cli', generatedAt: '2026-10-07T10:00:00.000Z', html: '<h1>Cím</h1><p>Szöveg.</p>' }

  it('a serve HTML-je a meta-sor alatt, GitHub-link nélkül', async () => {
    const calls = serve(() => json(view))
    const response = await notePage(ID, 'summary-de', DEPS)
    expect(response.status).toBe(200)
    expect(calls[0]!.url).toBe(`http://serve.test/notes/${ID}/summary-de`)
    const html = await response.text()
    expect(html).toContain('<title>Cím · summary-de</title>')
    expect(html).toContain('<p class="meta">summary-de · cli · 2026-10-07</p><h1>Cím</h1><p>Szöveg.</p>')
    expect(html).not.toContain('GitHub')
  })

  it('a régi bot-link jobId-jából a videóazonosítót kéri', async () => {
    const calls = serve(() => json(view))
    await notePage(`123:${ID}`, 'summary', DEPS)
    expect(calls[0]!.url).toBe(`http://serve.test/notes/${ID}/summary`)
  })

  it('404 → 404 a jegyzet hiányával; a többi hiba 502', async () => {
    serve(() => json(null, 404))
    const missing = await notePage(ID, 'summary', DEPS)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('A jegyzet nincs a vaultban.')
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.reject(new Error('hálózat')), 'A peter-mba nem érhető el, a jegyzetek most nem olvashatók.'],
      [() => json(null, 401), 'A Worker és a serve titka nem egyezik.'],
      [() => json(null, 503), 'A serve nem éri el a vaultot.'],
      [() => json({ title: 'Cím' }), 'A serve hibás választ adott.'],
    ]
    for (const [respond, line] of cases) {
      serve(respond)
      const response = await notePage(ID, 'summary', DEPS)
      expect(response.status).toBe(502)
      expect(await response.text()).toContain(line)
    }
  })
})

describe('notePage — frontmatter', () => {
  const base = { title: 'Cím', url: null, origin: 'cli', generatedAt: '2026-10-07T10:00:00.000Z', html: '<h1>Cím</h1>' }

  it('az összecsukható blokk a meta-sor és a törzs között áll, mezőnként egy sor, minden escape-elve', async () => {
    serve(() =>
      json({
        ...base,
        meta: [
          { key: 'channel', value: 'Big Think' },
          { key: 'description', value: 'Első sor\n<script>alert(1)</script>' },
        ],
      }),
    )
    const html = await (await notePage(ID, 'summary', DEPS)).text()
    const block =
      '<details class="fm"><summary>Frontmatter</summary><table>' +
      '<tr><th>channel</th><td>Big Think</td></tr>' +
      '<tr><th>description</th><td>Első sor\n&#60;script&#62;alert(1)&#60;/script&#62;</td></tr>' +
      '</table></details>'
    expect(html).toContain(`<p class="meta">summary · cli · 2026-10-07</p>${block}<h1>Cím</h1>`)
    expect(html).not.toContain('<script>')
  })

  it('meta nélkül (régi serve) vagy üres metával nincs blokk, az oldal 200', async () => {
    for (const body of [base, { ...base, meta: [] }]) {
      serve(() => json(body))
      const response = await notePage(ID, 'summary', DEPS)
      expect(response.status).toBe(200)
      expect(await response.text()).not.toContain('<details')
    }
  })

  it('hibás alakú meta hibás válasznak számít', async () => {
    for (const meta of ['nem lista', [{ key: 'a' }], [{ key: 1, value: 'x' }], [null]]) {
      serve(() => json({ ...base, meta }))
      const response = await notePage(ID, 'summary', DEPS)
      expect(response.status).toBe(502)
      expect(await response.text()).toContain('A serve hibás választ adott.')
    }
  })
})
