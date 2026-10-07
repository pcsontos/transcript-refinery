import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow, type LinkToken } from './store.js'
import {
  MISSING_NOTE_URL,
  REJECTED_SECRET,
  alreadyLine,
  decideStart,
  decideTap,
  hashToken,
  isAllowed,
  isToken,
  linesForMessage,
  newToken,
  noteReadyMessage,
  queuedLine,
  readyLine,
  summaryButton,
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
    phase: 'subtitle',
    error: null,
    title: null,
    noteUrl: null,
    notifiedReady: false,
    noteNotified: false,
    acceptedAt: null,
    sub: null,
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

  it('a claim csak a várt állapotból ír, a rememberUpdate egyszer enged', async () => {
    const store = memoryStore()
    await store.insert(row({ status: 'ready', phase: 'subtitle' }))
    const lost = await store.claim(
      `1:${ID}`,
      { phase: 'summary', status: 'ready' },
      { phase: 'summary', status: 'queued' },
    )
    expect(lost).toBeNull()
    const won = await store.claim(
      `1:${ID}`,
      { phase: 'subtitle', status: 'ready' },
      { phase: 'summary', status: 'queued' },
    )
    expect(won?.phase).toBe('summary')
    expect(won?.status).toBe('queued')
    expect(won?.error).toBeNull()
    expect(won?.acceptedAt).toBeNull()
    const again = await store.claim(
      `1:${ID}`,
      { phase: 'subtitle', status: 'ready' },
      { phase: 'summary', status: 'queued' },
    )
    expect(again).toBeNull()
    expect(await store.rememberUpdate(9)).toBe(true)
    expect(await store.rememberUpdate(9)).toBe(false)
    await store.insert(row({ jobId: `4:${ID}`, updateId: 4, status: 'queued', phase: 'summary' }))
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

  it('a jegyzet mondata két sor, a gomb adata a munka azonosítója', () => {
    expect(noteReadyMessage('Cím', 'https://github.com/tulaj/repo/blob/main/a.md')).toBe(
      'Cím. A jegyzet megvan.\nhttps://github.com/tulaj/repo/blob/main/a.md',
    )
    expect(summaryButton(`1:${ID}`)).toEqual({ text: 'summary', data: `summary:1:${ID}` })
    expect(MISSING_NOTE_URL).toBe('A jegyzet linkje hiányzik.')
  })

  it('a cím újsora és vezérlőkaraktere egy szóköz, a link marad a második sor', () => {
    const noteUrl = 'https://github.com/tulaj/repo/blob/main/a.md'
    expect(noteReadyMessage('Cím\nhttps://evil.example\u0007', noteUrl)).toBe(
      `Cím https://evil.example. A jegyzet megvan.\n${noteUrl}`,
    )
    expect(readyLine('Cím\r\nmásodik')).toBe('Cím második. A felirat megvan.')
  })

  it('a koppintás a fázis és a státusz szerint dönt', () => {
    expect(decideTap(null, true)).toEqual({ type: 'ignore' })
    expect(decideTap(row({ status: 'ready' }), false)).toEqual({ type: 'ignore' })
    expect(decideTap(row({ status: 'ready', phase: 'subtitle' }), true)).toEqual({ type: 'start' })
    expect(decideTap(row({ status: 'accepted', phase: 'summary' }), true)).toEqual({ type: 'busy' })
    expect(decideTap(row({ status: 'ready', phase: 'summary', noteNotified: true }), true)).toEqual({ type: 'resend' })
    expect(decideTap(row({ status: 'failed', phase: 'summary' }), true)).toEqual({ type: 'retry' })
    expect(decideTap(row({ status: 'queued', phase: 'subtitle' }), true)).toEqual({ type: 'ignore' })
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
