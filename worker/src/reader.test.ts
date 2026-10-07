import { afterEach, describe, expect, it } from 'vitest'
import { notePage, notesPage, vaultPath, type ReaderDeps } from './reader.js'
import { memoryStore, type JobRow, type JobStore } from './store.js'

const ID = 'zw_kFlCTPKY'
const REPO = 'tulaj/vault'
const NAME = `Feldmár András： Csak úgy ｜ [${ID}]_summary.md`
const NOTE_URL = `https://github.com/${REPO}/blob/main/Inbox/transcript-refinery/${encodeURIComponent(NAME)}`
const API = `https://api.github.com/repos/${REPO}/contents/Inbox/transcript-refinery/${encodeURIComponent(NAME)}?ref=main`
const TRANSCRIPT = `Feldmár András： Csak úgy ｜ [${ID}]_transcript.md`
const TRANSCRIPT_URL = `https://github.com/${REPO}/blob/main/Inbox/transcript-refinery/${encodeURIComponent(TRANSCRIPT)}`
const TRANSCRIPT_API = `https://api.github.com/repos/${REPO}/contents/Inbox/transcript-refinery/${encodeURIComponent(TRANSCRIPT)}?ref=main`

function row(updateId: number, partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: `${updateId}:${ID}`,
    updateId,
    chatId: '42',
    messageId: 1,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'ready',
    phase: 'summary',
    error: null,
    title: 'Cím',
    noteUrl: NOTE_URL,
    notifiedReady: true,
    noteNotified: true,
    acceptedAt: Date.UTC(2026, 9, 7),
    sub: 'sub-42',
    ...partial,
  }
}

const original = globalThis.fetch
afterEach(() => {
  globalThis.fetch = original
})

function reader(
  store: JobStore,
  respond: () => Promise<Response> = () => Promise.resolve(new Response('<article><h1>Cím</h1></article>')),
): ReaderDeps & { calls: { url: string; headers: Record<string, string> }[] } {
  const calls: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (input, init) => {
    calls.push({ url: input as string, headers: init?.headers as Record<string, string> })
    return respond()
  }
  return { store, vaultRepo: REPO, vaultBranch: 'main', vaultToken: 'olvaso', calls }
}

describe('vaultPath', () => {
  it('a GitHub-címből a fajta fájljának szakaszai, minden más null', () => {
    expect(vaultPath(NOTE_URL, REPO, 'main', 'summary')).toEqual(['Inbox', 'transcript-refinery', NAME])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'transcript')).toEqual(['Inbox', 'transcript-refinery', TRANSCRIPT])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'qa')).toBeNull()
    expect(vaultPath(NOTE_URL, 'mas/vault', 'main', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, REPO, 'dev', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, '', '', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/a_bloom.md`, REPO, 'main', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/x_summary.md/a_summary.md`, REPO, 'main', 'transcript')).toEqual(['x_summary.md', 'a_transcript.md'])
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/%E0_summary.md`, REPO, 'main', 'summary')).toBeNull()
  })
})

describe('notesPage', () => {
  it('csak a saját, jegyzettel bíró sorok, újak elöl, escape-elt címmel', async () => {
    const store = memoryStore()
    await store.insert(row(5, { title: 'Régi', acceptedAt: Date.UTC(2026, 9, 6) }))
    await store.insert(row(6, { title: '<b>Új</b>' }))
    await store.insert(row(7, { title: 'Idegen', sub: 'sub-7' }))
    await store.insert(row(8, { title: 'Félkész', noteUrl: null }))
    const response = await notesPage('sub-42', reader(store))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    expect(html).toContain(
      `<li>&#60;b&#62;Új&#60;/b&#62; · 2026-10-07 — <a href="/notes/6:${ID}/summary">summary</a> · <a href="/notes/6:${ID}/transcript">transcript</a></li>`,
    )
    expect(html).toContain(
      `<li>Régi · 2026-10-06 — <a href="/notes/5:${ID}/summary">summary</a> · <a href="/notes/5:${ID}/transcript">transcript</a></li>`,
    )
    expect(html.indexOf(`/notes/6:`)).toBeLessThan(html.indexOf(`/notes/5:`))
    expect(html).not.toContain('Idegen')
    expect(html).not.toContain('Félkész')
  })

  it('jegyzet nélkül a biztató mondat', async () => {
    const html = await (await notesPage('sub-42', reader(memoryStore()))).text()
    expect(html).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
  })
})

describe('notePage', () => {
  it('a summary és a transcript a GitHub renderelt HTML-jével és a saját GitHub-linkjével, pontos fejlécekkel', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    const deps = reader(store)
    const response = await notePage(`5:${ID}`, 'summary', 'sub-42', deps)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<title>Cím · summary</title>')
    expect(html).toContain(`<a href="${NOTE_URL}">Megnyitás a GitHubon</a>`)
    expect(html).toContain('<article><h1>Cím</h1></article>')
    expect(html).toContain('color-scheme:light dark')

    const transcript = await (await notePage(`5:${ID}`, 'transcript', 'sub-42', deps)).text()
    expect(transcript).toContain('<title>Cím · transcript</title>')
    expect(transcript).toContain(`<a href="${TRANSCRIPT_URL}">Megnyitás a GitHubon</a>`)

    const headers = {
      accept: 'application/vnd.github.html+json',
      authorization: 'Bearer olvaso',
      'user-agent': 'transcript-refinery',
    }
    expect(deps.calls).toEqual([
      { url: API, headers },
      { url: TRANSCRIPT_API, headers },
    ])
  })

  it('az idegen, a nem létező, a link nélküli, az idegen előtagú sor és az ismeretlen fajta ugyanaz a 404, GitHub-hívás nélkül', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    await store.insert(row(6, { noteUrl: 'https://github.com/mas/repo/blob/main/a_summary.md' }))
    await store.insert(row(7, { noteUrl: null }))
    const deps = reader(store)
    const cases: [string, string, string][] = [
      [`5:${ID}`, 'summary', 'sub-7'],
      [`5:${ID}`, 'qa', 'sub-42'],
      [`9:${ID}`, 'summary', 'sub-42'],
      [`6:${ID}`, 'summary', 'sub-42'],
      [`7:${ID}`, 'summary', 'sub-42'],
      ['x', 'summary', 'sub-42'],
    ]
    for (const [jobId, kind, sub] of cases) {
      const response = await notePage(jobId, kind, sub, deps)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
    }
    expect(deps.calls).toEqual([])
  })

  it('a GitHub hibája a táblázat mondata 502-vel, a cím escape-elve', async () => {
    const store = memoryStore()
    await store.insert(row(5, { title: '<script>x</script>' }))
    const cases: [() => Promise<Response>, string][] = [
      [() => Promise.resolve(new Response(null, { status: 404 })), 'A jegyzet nincs a vaultban.'],
      [() => Promise.resolve(new Response(null, { status: 401 })), 'A vault nem olvasható.'],
      [() => Promise.resolve(new Response(null, { status: 403 })), 'A vault nem olvasható.'],
      [() => Promise.resolve(new Response(null, { status: 500 })), 'A GitHub nem érhető el.'],
      [() => Promise.reject(new Error('hálózat')), 'A GitHub nem érhető el.'],
    ]
    for (const [respond, line] of cases) {
      const response = await notePage(`5:${ID}`, 'summary', 'sub-42', reader(store, respond))
      expect(response.status).toBe(502)
      const html = await response.text()
      expect(html).toContain(`<p>${line}</p>`)
      expect(html).toContain('&#60;script&#62;x&#60;/script&#62;')
      expect(html).not.toContain('<script>')
    }
  })
})
