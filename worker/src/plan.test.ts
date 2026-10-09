import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow, type LinkToken, type RunRow } from './store.js'
import {
  MISSING_NOTE_URL,
  REJECTED_SECRET,
  alreadyLine,
  decideRun,
  decideStart,
  hashToken,
  isAllowed,
  isToken,
  langKeyboard,
  linesForMessage,
  maskRecipes,
  newToken,
  parseTap,
  pickKeyboard,
  queuedLine,
  readyBases,
  readyLine,
  recipeKeyboard,
  runId,
  runKinds,
  runQueuedLine,
  runFailedLine,
  runReadyMessage,
  waitingLine,
} from './plan.js'

const ID = 'abcdefghijk'
const OTHER = 'z2345678901'

function row(partial: Partial<JobRow>): JobRow {
  return {
    jobId: `1:${ID}`,
    updateId: 1,
    chatId: '42',
    messageId: 7,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'queued',
    error: null,
    title: null,
    notifiedReady: false,
    acceptedAt: null,
    sub: null,
    ...partial,
  }
}

function run(partial: Partial<RunRow>): RunRow {
  return {
    runId: `1:${ID}:summary`,
    jobId: `1:${ID}`,
    recipes: ['summary'],
    lang: null,
    status: 'queued',
    error: null,
    noteUrl: null,
    notified: false,
    acceptedAt: null,
    ...partial,
  }
}

describe('linesForMessage', () => {
  it('a listás watch cím videó, a summary szó nem sor', () => {
    const planned = linesForMessage(`https://www.youtube.com/watch?v=${ID}&list=PL123 summary`, [])
    expect(planned.jobs).toEqual([{ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` }])
    expect(planned.lines).toEqual([queuedLine(ID)])
    expect(planned.lines.join('\n')).not.toContain('Nem YouTube-cím')
  })

  it('a lista külön mondat, az idegen cím is, a puszta szó nem', () => {
    const planned = linesForMessage('https://www.youtube.com/playlist?list=PL123 https://vimeo.com/1 summary', [])
    expect(planned.jobs).toEqual([])
    expect(planned.lines).toEqual(['Lejátszási lista későbbre marad.', 'Nem YouTube-cím.'])
  })

  it('videó nélkül a saját mondat megy', () => {
    expect(linesForMessage('summary', []).lines).toEqual(['Nincs YouTube-videó az üzenetben.'])
  })

  it('a queued videó nem nyit új munkát', () => {
    const planned = linesForMessage(`https://youtu.be/${ID}`, [row({ status: 'queued' })])
    expect(planned.jobs).toEqual([])
    expect(planned.lines).toEqual([alreadyLine(ID)])
  })

  it('a ready videó új munkát nyit', () => {
    const planned = linesForMessage(ID, [row({ status: 'ready' })])
    expect(planned.jobs).toHaveLength(1)
  })
})

describe('memoryStore', () => {
  it('az update_id másodpéldánya ugyanazokat a sorokat adja', async () => {
    const store = memoryStore()
    await store.insert(row({}))
    expect(await store.listByUpdate(1)).toHaveLength(1)
    expect(await store.activeByVideo(ID)).not.toBeNull()
    expect(await store.activeByVideo(OTHER)).toBeNull()
  })

  it('a due a friss accepted sort kihagyja, a tizenöt perceset hozza', async () => {
    const store = memoryStore()
    const now = 1_000_000
    await store.insert(row({ jobId: 'a', status: 'accepted', acceptedAt: now }))
    await store.insert(
      row({
        jobId: 'b',
        updateId: 2,
        videoId: OTHER,
        status: 'accepted',
        acceptedAt: now - 15 * 60 * 1000 - 1,
      }),
    )
    await store.insert(row({ jobId: 'c', updateId: 3, status: 'failed' }))
    const due = await store.due(now)
    expect(due.map((item) => item.jobId)).toEqual(['b'])
  })

  it('a rememberUpdate egyszer enged, a queued sor aktív', async () => {
    const store = memoryStore()
    expect(await store.rememberUpdate(9)).toBe(true)
    expect(await store.rememberUpdate(9)).toBe(false)
    await store.insert(row({ jobId: `4:${ID}`, updateId: 4, status: 'queued' }))
    expect(await store.activeByVideo(ID)).not.toBeNull()
  })
})

describe('mondatok', () => {
  it('a spec mondatai', () => {
    expect(queuedLine(ID)).toBe(`Sorba került: ${ID}`)
    expect(waitingLine(ID)).toBe(`A gép ébredésére vár: ${ID}.`)
    expect(readyLine('Cím')).toBe('Cím. A felirat megvan.')
    expect(alreadyLine(ID)).toBe(`Már sorban van: ${ID}.`)
    expect(REJECTED_SECRET).toBe('A konténer elutasította a hívást.')
  })

  it('a hiányzó link mondata', () => {
    expect(MISSING_NOTE_URL).toBe('A jegyzet linkje hiányzik.')
  })

  it('a cím újsora és vezérlőkaraktere egy szóköz, a link marad a második sor', () => {
    expect(runReadyMessage('Cím\nhttps://evil.example\u0007', run({ recipes: ['notes'] }), 'https://w.test')).toBe(
      `Cím https://evil.example · notes. A jegyzet megvan.\nhttps://w.test/notes/1:${ID}/notes`,
    )
    expect(readyLine('Cím\r\nmásodik')).toBe('Cím második. A felirat megvan.')
  })
})

describe('kötési döntések', () => {
  it('az engedélyezőlista vesszős, kis- és nagybetű nem számít, üres e-mail nem megy át', () => {
    expect(isAllowed('En@Example.com', ' en@example.com , mas@example.com')).toBe(true)
    expect(isAllowed('harmadik@example.com', 'en@example.com')).toBe(false)
    expect(isAllowed('', 'en@example.com,')).toBe(false)
    expect(isAllowed('en@example.com', '')).toBe(false)
  })

  it('a token 43 karakteres base64url, a hash 64 hexa', async () => {
    const raw = newToken()
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isToken(raw)).toBe(true)
    expect(newToken()).not.toBe(raw)
    expect(await hashToken(raw)).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken(raw)).toBe(await hashToken(raw))
    expect(isToken('rövid')).toBe(false)
    expect(isToken(`${raw}x`)).toBe(false)
  })

  it('a decideStart csak egyező felhasználónál, élő, függő tokennel köt', () => {
    const token: LinkToken = {
      tokenHash: 'h',
      telegramUserId: '42',
      expiresAt: 100,
      pendingSub: 'sub-42',
      pendingEmail: 'en@example.com',
      used: false,
    }
    expect(decideStart(token, '42', 99, 'en@example.com')).toEqual({ type: 'bind', sub: 'sub-42', email: 'en@example.com' })
    expect(decideStart(token, '7', 99, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart(token, '42', 100, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart({ ...token, used: true }, '42', 99, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart({ ...token, pendingSub: null, pendingEmail: null }, '42', 99, 'en@example.com')).toEqual({
      type: 'invalid',
    })
    expect(decideStart(null, '42', 99, 'en@example.com')).toEqual({ type: 'invalid' })
    expect(decideStart(token, '42', 99, 'mas@example.com')).toEqual({ type: 'denied', email: 'en@example.com' })
  })
})

describe('futások', () => {
  it('a gombadat öt alakja és a régi summary gomb, a rossz recept, maszk és nyelv null', () => {
    expect(parseTap(`r:notes:5:${ID}`)).toEqual({ type: 'recipe', recipe: 'notes', jobId: `5:${ID}` })
    expect(parseTap(`summary:5:${ID}`)).toEqual({ type: 'recipe', recipe: 'summary', jobId: `5:${ID}` })
    expect(parseTap(`f:5:${ID}`)).toEqual({ type: 'translate', jobId: `5:${ID}` })
    expect(parseTap(`t:3:5:${ID}`)).toEqual({ type: 'toggle', mask: 3, jobId: `5:${ID}` })
    expect(parseTap(`n:ff:5:${ID}`)).toEqual({ type: 'next', mask: 255, jobId: `5:${ID}` })
    expect(parseTap(`l:3:de:5:${ID}`)).toEqual({ type: 'lang', mask: 3, lang: 'de', jobId: `5:${ID}` })
    for (const bad of [`r:toString:5:${ID}`, `t:g:5:${ID}`, `t:100:5:${ID}`, `l:3:pl:5:${ID}`, `l:3:__proto__:5:${ID}`, `x:5:${ID}`, '']) {
      expect(parseTap(bad)).toBeNull()
    }
  })

  it('a maszk a receptlista bitjei, az azonosító és a fajták a kérésből', () => {
    expect(maskRecipes(0b101)).toEqual(['summary', 'qa'])
    expect(maskRecipes(0)).toEqual([])
    expect(runId(`5:${ID}`, ['notes'], null)).toBe(`5:${ID}:notes`)
    expect(runId(`5:${ID}`, ['summary', 'notes'], 'de')).toBe(`5:${ID}:de:summary+notes`)
    expect(runKinds({ recipes: ['summary', 'notes'], lang: 'de' })).toEqual(['summary-de', 'notes-de'])
    expect(runKinds({ recipes: ['qa'], lang: null })).toEqual(['qa'])
  })

  it('a futás döntése az állapot szerint', () => {
    expect(decideRun(null)).toEqual({ type: 'start' })
    for (const status of ['queued', 'waiting', 'accepted'] as const) {
      expect(decideRun(run({ status }))).toEqual({ type: 'busy' })
    }
    expect(decideRun(run({ status: 'failed' }))).toEqual({ type: 'retry' })
    expect(decideRun(run({ status: 'ready', notified: true }))).toEqual({ type: 'resend' })
    expect(decideRun(run({ status: 'ready', notified: false }))).toEqual({ type: 'ignore' })
  })

  it('a kész alaprecept a lista sorrendjében, a fordítás és a nem kész nem', () => {
    expect(
      readyBases([
        run({ recipes: ['notes'], status: 'ready' }),
        run({ recipes: ['summary'], status: 'ready' }),
        run({ recipes: ['qa'], status: 'failed' }),
        run({ recipes: ['bloom'], lang: 'de', status: 'ready' }),
      ]),
    ).toEqual(['summary', 'notes'])
  })

  it('a gombsorok: kilenc gomb hármasával, a kapcsoló a saját bitjét fordítja, a nyelvek négyesével, 64 bájt alatt', () => {
    const keys = recipeKeyboard(`5:${ID}`)
    expect(keys.map((line) => line.length)).toEqual([3, 3, 3])
    expect(keys[0]?.[1]).toEqual({ text: 'notes', data: `r:notes:5:${ID}` })
    expect(keys[2]?.[2]).toEqual({ text: 'fordítás', data: `f:5:${ID}` })
    expect(pickKeyboard(1, ['summary', 'notes'], `5:${ID}`)).toEqual([
      [
        { text: '✓ summary', data: `t:0:5:${ID}` },
        { text: 'notes', data: `t:3:5:${ID}` },
      ],
      [{ text: 'tovább', data: `n:1:5:${ID}` }],
    ])
    const langs = langKeyboard(3, `5:${ID}`)
    expect(langs.map((line) => line.length)).toEqual([4, 3])
    expect(langs[0]?.[3]).toEqual({ text: 'de', data: `l:3:de:5:${ID}` })
    const longest = [...recipeKeyboard(`9999999999:${ID}`), ...langKeyboard(255, `9999999999:${ID}`)]
      .flat()
      .map((key) => new TextEncoder().encode(key.data).length)
    expect(Math.max(...longest)).toBeLessThanOrEqual(64)
  })

  it('a futás mondatai', () => {
    expect(runQueuedLine(['notes'], null)).toBe('Sorba került: notes')
    expect(runQueuedLine(['summary', 'notes'], 'de')).toBe('Sorba került: summary, notes → de')
    expect(runFailedLine(['qa'], null, 'A futás megállt.')).toBe('qa: A futás megállt.')
    expect(runFailedLine(['summary', 'notes'], 'de', 'x')).toBe('summary, notes → de: x')
    expect(runReadyMessage('Cím\n', run({ recipes: ['notes'] }), 'https://w.test')).toBe(
      `Cím · notes. A jegyzet megvan.\nhttps://w.test/notes/1:${ID}/notes`,
    )
    expect(runReadyMessage('Cím', run({ recipes: ['summary', 'notes'], lang: 'de' }), 'https://w.test')).toBe(
      `Cím · de. A fordítás megvan.\nhttps://w.test/notes/1:${ID}/summary-de\nhttps://w.test/notes/1:${ID}/notes-de`,
    )
  })

  it('a futás egyszer szúrható be, a claimRun csak a várt állapotból ír, a dueRuns a due szabálya', async () => {
    const store = memoryStore()
    expect(await store.insertRun(run({ status: 'failed', error: 'x', acceptedAt: 5, notified: true }))).toBe(true)
    expect(await store.insertRun(run({}))).toBe(false)
    expect(await store.claimRun(`1:${ID}:summary`, 'queued', 'accepted')).toBe(false)
    expect(await store.claimRun(`1:${ID}:summary`, 'failed', 'queued')).toBe(true)
    expect(await store.run(`1:${ID}:summary`)).toMatchObject({ status: 'queued', error: null, acceptedAt: null, notified: false })
    await store.insertRun(run({ runId: `1:${ID}:qa`, recipes: ['qa'], status: 'accepted', acceptedAt: 1 }))
    await store.insertRun(run({ runId: `1:${ID}:notes`, recipes: ['notes'], status: 'accepted', acceptedAt: 999_999 }))
    await store.insertRun(run({ runId: `2:${ID}:qa`, jobId: `2:${ID}`, recipes: ['qa'], status: 'ready' }))
    expect((await store.dueRuns(1_000_000)).map((item) => item.runId)).toEqual([`1:${ID}:summary`, `1:${ID}:qa`])
    expect((await store.runsFor(`1:${ID}`)).map((item) => item.runId)).toEqual([
      `1:${ID}:summary`,
      `1:${ID}:qa`,
      `1:${ID}:notes`,
    ])
    expect(await store.run('nincs')).toBeNull()
  })
})
