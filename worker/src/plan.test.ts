import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow } from './store.js'
import {
  REJECTED_SECRET,
  alreadyLine,
  linesForMessage,
  queuedLine,
  readyLine,
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
})

describe('mondatok', () => {
  it('a spec mondatai', () => {
    expect(queuedLine(ID)).toBe(`Sorba került: ${ID}`)
    expect(waitingLine(ID)).toBe(`A gép ébredésére vár: ${ID}.`)
    expect(readyLine('Cím')).toBe('Cím. A felirat megvan.')
    expect(alreadyLine(ID)).toBe(`Már sorban van: ${ID}.`)
    expect(REJECTED_SECRET).toBe('A konténer elutasította a hívást.')
  })
})
