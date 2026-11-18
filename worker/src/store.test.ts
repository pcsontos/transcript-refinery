import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow, type ModelOverride } from './store.js'

function row(partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: '5:t-0123456789abcdef',
    updateId: 5,
    chatId: '42',
    messageId: 5,
    videoId: 't-0123456789abcdef',
    url: '',
    status: 'queued',
    error: null,
    title: 'Cím',
    notifiedReady: false,
    acceptedAt: null,
    sub: 'sub-42',
    fileId: null,
    fileName: null,
    text: 'Szöveg.',
    ...partial,
  }
}

describe('a szöveg a sor lezárásáig él', () => {
  it('nyitott mentésnél marad, ready-nél és failed-nél kiürül', async () => {
    for (const status of ['ready', 'failed'] as const) {
      const store = memoryStore()
      await store.insert(row())
      await store.save(row({ status: 'waiting' }))
      expect((await store.listByUpdate(5))[0]?.text).toBe('Szöveg.')
      await store.save(row({ status }))
      expect((await store.listByUpdate(5))[0]?.text).toBeNull()
    }
  })

  it('a megszakítás (claimJob) is kiüríti', async () => {
    const store = memoryStore()
    await store.insert(row())
    expect(await store.claimJob(row().jobId, 'queued', 'cancelled')).toBe(true)
    expect((await store.listByUpdate(5))[0]?.text).toBeNull()
  })
})

describe('a modellfelülírások (memoryStore)', () => {
  const own = (partial: Partial<ModelOverride> = {}): ModelOverride => ({
    sub: 'sub-42',
    recipe: 'notes',
    mode: 'once',
    model: 'a',
    ...partial,
  })

  it('ugyanarra a kulcsra egy sor marad, az új modellel', async () => {
    const store = memoryStore()
    await store.setOverride(own())
    await store.setOverride(own({ model: 'b' }))
    expect(await store.overridesFor('sub-42')).toEqual([own({ model: 'b' })])
  })

  it('a mód szerinti törlés a másik módot meghagyja, mód nélkül mindkettő törlődik', async () => {
    const store = memoryStore()
    await store.setOverride(own())
    await store.setOverride(own({ mode: 'always', model: 'b' }))
    await store.clearOverride('sub-42', 'notes', 'once', 'másik')
    expect(await store.overridesFor('sub-42')).toHaveLength(2)
    await store.clearOverride('sub-42', 'notes', 'once')
    expect(await store.overridesFor('sub-42')).toEqual([own({ mode: 'always', model: 'b' })])
    await store.setOverride(own())
    await store.clearOverride('sub-42', 'notes')
    expect(await store.overridesFor('sub-42')).toEqual([])
  })

  it('más felhasználó sorai érintetlenek', async () => {
    const store = memoryStore()
    await store.setOverride(own({ sub: 'sub-9' }))
    await store.clearOverride('sub-42', 'notes')
    expect(await store.overridesFor('sub-9')).toHaveLength(1)
    expect(await store.overridesFor('sub-42')).toEqual([])
  })
})

describe('a feloldott lista (memoryStore)', () => {
  const resolve = { jobId: '7:resolve-7-0', chatId: '42', title: 'L', items: [{ videoId: 'a', url: 'u', title: 't' }], videoId: null }

  it('a takeResolve először a sort adja, másodszor null', async () => {
    const store = memoryStore()
    await store.insertResolve(resolve)
    expect(await store.takeResolve(resolve.jobId)).toEqual(resolve)
    expect(await store.takeResolve(resolve.jobId)).toBeNull()
  })

  it('a knownVideos a nyitott és ready sorokat adja, a failed és cancelled nem', async () => {
    const store = memoryStore()
    const statuses = ['queued', 'accepted', 'ready', 'failed', 'cancelled'] as const
    for (const [n, status] of statuses.entries()) {
      await store.insert(row({ jobId: `${n}:v${n}`, updateId: n, videoId: `v${n}`, status }))
    }
    expect([...(await store.knownVideos(['v0', 'v1', 'v2', 'v3', 'v4', 'v9']))].sort()).toEqual(['v0', 'v1', 'v2'])
  })
})
