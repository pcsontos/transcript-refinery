import { describe, expect, it } from 'vitest'
import { applyKnocks, handleCallback, handleCron, handleUpdate, type WorkerDeps } from './handle.js'
import { memoryStore, type JobRow } from './store.js'

const ID = 'abcdefghijk'

function deps(store: ReturnType<typeof memoryStore>, over: Partial<WorkerDeps> = {}): WorkerDeps & {
  sent: string[]
  knocked: string[]
} {
  const sent: string[] = []
  const knocked: string[] = []
  return {
    ownerChatId: '42',
    store,
    now: () => 1_000_000,
    sent,
    knocked,
    knock: (job) => {
      knocked.push(job.jobId)
      return Promise.resolve(202)
    },
    send: (text) => {
      sent.push(text)
      return Promise.resolve(true)
    },
    ...over,
  }
}

describe('handleUpdate', () => {
  it('idegen chat üres, a saját chat sora kopogtatás előtt megy ki', async () => {
    const store = memoryStore()
    const foreign = deps(store)
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 7 }, text: `https://youtu.be/${ID}` },
    }
    expect((await handleUpdate(update, foreign)).status).toBe(200)
    expect(foreign.sent).toEqual([])
    expect(await store.listByUpdate(5)).toEqual([])

    const own = deps(store)
    const accepted = await handleUpdate(
      { ...update, message: { ...update.message, chat: { id: 42 } } },
      own,
    )
    expect(accepted.status).toBe(200)
    expect(own.sent).toEqual([`Sorba került: ${ID}`])
    expect(own.knocked).toEqual([])
    await applyKnocks(accepted.knocks, own)
    expect(own.knocked).toEqual([`5:${ID}`])
  })

  it('az ismételt update_id nem kopogtat újra', async () => {
    const store = memoryStore()
    const first = deps(store)
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 42 }, text: ID },
    }
    await handleUpdate(update, first)
    const second = deps(store)
    const repeated = await handleUpdate(update, second)
    expect(repeated.status).toBe(200)
    expect(repeated.knocks).toEqual([])
    expect(second.knocked).toEqual([])
    expect(second.sent).toEqual([])
    expect(await store.listByUpdate(5)).toHaveLength(1)
  })

  it('a Tunnel hiánya waiting, és az üzenet csak az első váltáskor megy', async () => {
    const store = memoryStore()
    const down = deps(store, { knock: () => Promise.resolve('down') })
    const planned = await handleUpdate(
      { update_id: 5, message: { message_id: 1, chat: { id: 42 }, text: ID } },
      down,
    )
    expect(down.sent).toEqual([`Sorba került: ${ID}`])
    await applyKnocks(planned.knocks, down)
    expect(down.sent).toEqual([`Sorba került: ${ID}`, `A gép ébredésére vár: ${ID}.`])
    const row = (await store.listByUpdate(5))[0]
    expect(row?.status).toBe('waiting')
    const again = deps(store)
    again.knock = (job) => {
      again.knocked.push(job.jobId)
      return Promise.resolve('down')
    }
    await handleCron(again)
    expect(again.sent).toEqual([])
    expect(again.knocked).toEqual([`5:${ID}`])
  })
})

describe('handleCallback', () => {
  it('a kész üzenet sikere után ready, a küldési hiba accepted marad, az ismétlés nem küld', async () => {
    const store = memoryStore()
    const row: JobRow = {
      jobId: `5:${ID}`,
      updateId: 5,
      chatId: '42',
      messageId: 1,
      videoId: ID,
      url: `https://www.youtube.com/watch?v=${ID}`,
      status: 'accepted',
      error: null,
      title: null,
      notifiedReady: false,
      acceptedAt: 1,
    }
    await store.insert(row)
    const failedSend = deps(store, { send: () => Promise.resolve(false) })
    expect(await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, failedSend)).toBe(200)
    expect((await store.listByUpdate(5))[0]?.status).toBe('accepted')
    expect((await store.listByUpdate(5))[0]?.title).toBe('Cím')

    const ok = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.sent).toEqual(['Cím. A felirat megvan.'])
    expect((await store.listByUpdate(5))[0]?.status).toBe('ready')

    const repeat = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, repeat)
    expect(repeat.sent).toEqual([])
  })

  it('a 401 failed, és a cron nem éleszti', async () => {
    const store = memoryStore()
    const own = deps(store, { knock: () => Promise.resolve(401) })
    const planned = await handleUpdate(
      { update_id: 8, message: { message_id: 1, chat: { id: 42 }, text: ID } },
      own,
    )
    await applyKnocks(planned.knocks, own)
    expect(own.sent).toContain('A konténer elutasította a hívást.')
    expect((await store.listByUpdate(8))[0]?.status).toBe('failed')
    const cron = deps(store)
    await handleCron(cron)
    expect(cron.knocked).toEqual([])
  })
})
