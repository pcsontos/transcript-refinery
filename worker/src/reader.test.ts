import { afterEach, describe, expect, it } from 'vitest'
import { notePage, notesPage, vaultPath, type ReaderDeps } from './reader.js'
import { memoryStore, type JobRow, type JobStore, type RunRow } from './store.js'

const ID = 'zw_kFlCTPKY'
const REPO = 'tulaj/vault'
const DIR = 'Inbox/transcript-refinery'
const STEM = `Feldmár András： Csak úgy ｜ [${ID}]`
const blob = (kind: string) => `https://github.com/${REPO}/blob/main/${DIR}/${encodeURIComponent(`${STEM}_${kind}.md`)}`
const api = (kind: string) =>
  `https://api.github.com/repos/${REPO}/contents/${DIR}/${encodeURIComponent(`${STEM}_${kind}.md`)}?ref=main`
const NOTE_URL = blob('transcript')

function row(updateId: number, partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: `${updateId}:${ID}`,
    updateId,
    chatId: '42',
    messageId: 1,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'ready',
    error: null,
    title: 'Cím',
    notifiedReady: true,
    acceptedAt: Date.UTC(2026, 9, 7),
    sub: 'sub-42',
    ...partial,
  }
}

function run(updateId: number, recipes: string[], partial: Partial<RunRow> = {}): RunRow {
  const lang = partial.lang ?? null
  return {
    runId: `${updateId}:${ID}:${lang === null ? '' : `${lang}:`}${recipes.join('+')}`,
    jobId: `${updateId}:${ID}`,
    recipes,
    lang,
    status: 'ready',
    error: null,
    noteUrl: NOTE_URL,
    notified: true,
    acceptedAt: 1,
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
  it('az átirat GitHub-címéből a fajta fájljának szakaszai, minden más null', () => {
    expect(vaultPath(NOTE_URL, REPO, 'main', 'summary')).toEqual(['Inbox', 'transcript-refinery', `${STEM}_summary.md`])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'transcript')).toEqual(['Inbox', 'transcript-refinery', `${STEM}_transcript.md`])
    expect(vaultPath(NOTE_URL, REPO, 'main', 'notes-de')).toEqual(['Inbox', 'transcript-refinery', `${STEM}_notes-de.md`])
    expect(vaultPath(NOTE_URL, 'mas/vault', 'main', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, REPO, 'dev', 'summary')).toBeNull()
    expect(vaultPath(NOTE_URL, '', '', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/a_summary.md`, REPO, 'main', 'summary')).toBeNull()
    expect(vaultPath(`https://github.com/${REPO}/blob/main/x_transcript.md/a_transcript.md`, REPO, 'main', 'qa')).toEqual([
      'x_transcript.md',
      'a_qa.md',
    ])
    expect(vaultPath(`https://github.com/${REPO}/blob/main/Inbox/%E0_transcript.md`, REPO, 'main', 'summary')).toBeNull()
  })
})

describe('notesPage', () => {
  it('videónként egy bejegyzés, YouTube-linkkel, rögzített fajtasorrenddel, a legfrissebb kész jobra linkelve', async () => {
    const ID2 = 'abcdefghijk'
    const other = (updateId: number, partial: Partial<JobRow> = {}) =>
      row(updateId, { jobId: `${updateId}:${ID2}`, videoId: ID2, url: `https://www.youtube.com/watch?v=${ID2}&t=1`, ...partial })
    const otherRun = (updateId: number, recipes: string[]) =>
      run(updateId, recipes, { jobId: `${updateId}:${ID2}`, runId: `${updateId}:${ID2}:${recipes.join('+')}` })

    const store = memoryStore()
    await store.insert(row(5, { title: 'Régi', acceptedAt: Date.UTC(2026, 9, 6) }))
    await store.insertRun(run(5, ['summary']))
    await store.insertRun(run(5, ['qa']))
    await store.insert(row(6, { title: '<b>Új</b>' }))
    await store.insertRun(run(6, ['notes']))
    await store.insertRun(run(6, ['summary']))
    await store.insertRun(run(6, ['summary', 'notes'], { lang: 'de' }))
    await store.insertRun(run(6, ['qa'], { status: 'failed' }))
    await store.insert(other(9, { title: 'Másik', acceptedAt: Date.UTC(2026, 9, 5) }))
    await store.insertRun(otherRun(9, ['zz-uj']))
    await store.insertRun(otherRun(9, ['summary']))
    await store.insertRun(otherRun(9, ['aa-uj']))
    await store.insert(row(7, { title: 'Idegen', sub: 'sub-7' }))
    await store.insertRun(run(7, ['summary']))
    await store.insert(row(8, { title: 'Félkész' }))
    await store.insertRun(run(8, ['summary'], { status: 'queued' }))

    const response = await notesPage('sub-42', reader(store))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    const item = (jobId: string, kind: string) => `<li><a href="/notes/${jobId}/${kind}">${kind}</a></li>`
    expect(html).toContain(
      `<li><a href="https://www.youtube.com/watch?v=${ID}">&#60;b&#62;Új&#60;/b&#62;</a> · 2026-10-07<ul>` +
        item(`6:${ID}`, 'summary') +
        item(`6:${ID}`, 'summary-de') +
        item(`6:${ID}`, 'notes') +
        item(`6:${ID}`, 'notes-de') +
        item(`5:${ID}`, 'qa') +
        item(`6:${ID}`, 'transcript') +
        '</ul></li>',
    )
    expect(html).toContain(
      `<li><a href="https://www.youtube.com/watch?v=${ID2}&#38;t=1">Másik</a> · 2026-10-05<ul>` +
        item(`9:${ID2}`, 'summary') +
        item(`9:${ID2}`, 'aa-uj') +
        item(`9:${ID2}`, 'zz-uj') +
        item(`9:${ID2}`, 'transcript') +
        '</ul></li>',
    )
    expect(html.match(new RegExp(`watch\\?v=${ID}"`, 'g'))).toHaveLength(1)
    expect(html.indexOf(`watch?v=${ID}"`)).toBeLessThan(html.indexOf(`watch?v=${ID2}`))
    expect(html).not.toContain('Régi')
    expect(html).not.toContain('Idegen')
    expect(html).not.toContain('Félkész')
  })

  it('jegyzet nélkül a biztató mondat', async () => {
    const html = await (await notesPage('sub-42', reader(memoryStore()))).text()
    expect(html).toContain('Még nincs jegyzet. Küldj egy YouTube-címet a botnak.')
  })
})

describe('notePage', () => {
  it('a kész fajta és a transcript a GitHub renderelt HTML-jével és a saját GitHub-linkjével, pontos fejlécekkel', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    await store.insertRun(run(5, ['summary']))
    await store.insertRun(run(5, ['summary'], { lang: 'de' }))
    const deps = reader(store)
    const response = await notePage(`5:${ID}`, 'summary', 'sub-42', deps)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<title>Cím · summary</title>')
    expect(html).toContain(`<a href="${blob('summary')}">Megnyitás a GitHubon</a>`)
    expect(html).toContain('<article><h1>Cím</h1></article>')
    expect(html).toContain('color-scheme:light dark')

    const transcript = await (await notePage(`5:${ID}`, 'transcript', 'sub-42', deps)).text()
    expect(transcript).toContain('<title>Cím · transcript</title>')
    expect(transcript).toContain(`<a href="${blob('transcript')}">Megnyitás a GitHubon</a>`)
    const german = await (await notePage(`5:${ID}`, 'summary-de', 'sub-42', deps)).text()
    expect(german).toContain(`<a href="${blob('summary-de')}">Megnyitás a GitHubon</a>`)

    const headers = {
      accept: 'application/vnd.github.html+json',
      authorization: 'Bearer olvaso',
      'user-agent': 'transcript-refinery',
    }
    expect(deps.calls).toEqual([
      { url: api('summary'), headers },
      { url: api('transcript'), headers },
      { url: api('summary-de'), headers },
    ])
  })

  it('az idegen, a nem létező, a kész futás nélküli, az idegen előtagú sor és a nem kész fajta ugyanaz a 404, GitHub-hívás nélkül', async () => {
    const store = memoryStore()
    await store.insert(row(5))
    await store.insertRun(run(5, ['summary']))
    await store.insertRun(run(5, ['qa'], { status: 'failed' }))
    await store.insert(row(6))
    await store.insertRun(run(6, ['summary'], { noteUrl: 'https://github.com/mas/repo/blob/main/a_transcript.md' }))
    await store.insert(row(7))
    await store.insertRun(run(7, ['summary'], { status: 'queued', noteUrl: null }))
    const deps = reader(store)
    const cases: [string, string, string][] = [
      [`5:${ID}`, 'summary', 'sub-7'],
      [`5:${ID}`, 'qa', 'sub-42'],
      [`5:${ID}`, 'notes', 'sub-42'],
      [`9:${ID}`, 'summary', 'sub-42'],
      [`6:${ID}`, 'summary', 'sub-42'],
      [`7:${ID}`, 'summary', 'sub-42'],
      [`7:${ID}`, 'transcript', 'sub-42'],
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
    await store.insertRun(run(5, ['summary']))
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
