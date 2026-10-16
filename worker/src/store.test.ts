import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow } from './store.js'

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
