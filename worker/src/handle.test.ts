import { describe, expect, it } from 'vitest'
import {
  applyKnocks,
  handleCallback,
  handleCron,
  handleLink,
  handleTap,
  handleUpdate,
  type PlannedKnock,
  type WorkerDeps,
} from './handle.js'
import { hashToken } from './plan.js'
import { memoryStore, type JobRow } from './store.js'

const ID = 'abcdefghijk'
const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const INVALID = 'A link lejárt vagy már nem érvényes. Kérj újat: /start'

function deps(store: ReturnType<typeof memoryStore>, over: Partial<WorkerDeps> = {}): WorkerDeps & {
  sent: string[]
  chats: string[]
  knocked: string[]
  knocks: PlannedKnock[]
  buttons: { text: string; data: string }[]
  answered: string[]
} {
  const sent: string[] = []
  const chats: string[] = []
  const knocked: string[] = []
  const knocks: PlannedKnock[] = []
  const buttons: { text: string; data: string }[] = []
  const answered: string[] = []
  let next = 0
  return {
    allowedEmails: 'en@example.com',
    botUsername: 'refinery_bot',
    linkBase: 'https://worker.test',
    store,
    now: () => 1_000_000,
    newToken: () => String.fromCharCode(65 + next++).repeat(43),
    sent,
    chats,
    knocked,
    knocks,
    buttons,
    answered,
    answerTap: (callbackQueryId) => {
      answered.push(callbackQueryId)
      return Promise.resolve()
    },
    knock: (job) => {
      knocked.push(job.jobId)
      knocks.push(job)
      return Promise.resolve(202)
    },
    send: (chatId, text, button) => {
      chats.push(chatId)
      sent.push(text)
      if (button) buttons.push(button)
      return Promise.resolve(true)
    },
    ...over,
  }
}

async function boundStore(): Promise<ReturnType<typeof memoryStore>> {
  const store = memoryStore()
  await store.bind({ telegramUserId: '42', sub: 'sub-42', email: 'en@example.com', boundAt: 0 }, '42')
  return store
}

function acceptedRow(partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: `5:${ID}`,
    updateId: 5,
    chatId: '42',
    messageId: 1,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'accepted',
    phase: 'subtitle',
    error: null,
    title: null,
    noteUrl: null,
    notifiedReady: false,
    noteNotified: false,
    acceptedAt: 1,
    sub: 'sub-42',
    ...partial,
  }
}

describe('handleUpdate', () => {
  it('a nem kötött felhasználó a kösd össze sort kapja, a kötött sora kopogtatás előtt megy ki', async () => {
    const store = await boundStore()
    const foreign = deps(store)
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 7 }, from: { id: 7 }, text: `https://youtu.be/${ID}` },
    }
    expect((await handleUpdate(update, foreign)).status).toBe(200)
    expect(foreign.sent).toEqual(['Előbb kösd össze a Google-fiókoddal: /start'])
    expect(await store.listByUpdate(5)).toEqual([])

    const own = deps(store)
    const accepted = await handleUpdate(
      { ...update, message: { ...update.message, chat: { id: 42 }, from: { id: 42 } } },
      own,
    )
    expect(accepted.status).toBe(200)
    expect(own.sent).toEqual([`Sorba került: ${ID}`])
    expect(own.knocked).toEqual([])
    await applyKnocks(accepted.knocks, own)
    expect(own.knocked).toEqual([`5:${ID}`])
  })

  it('az ismételt update_id nem kopogtat újra', async () => {
    const store = await boundStore()
    const first = deps(store)
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID },
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
    const store = await boundStore()
    const down = deps(store, { knock: () => Promise.resolve('down') })
    const planned = await handleUpdate(
      { update_id: 5, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID } },
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
    const store = await boundStore()
    const row: JobRow = {
      jobId: `5:${ID}`,
      updateId: 5,
      chatId: '42',
      messageId: 1,
      videoId: ID,
      url: `https://www.youtube.com/watch?v=${ID}`,
      status: 'accepted',
      phase: 'subtitle',
      error: null,
      title: null,
      noteUrl: null,
      notifiedReady: false,
      noteNotified: false,
      acceptedAt: 1,
      sub: 'sub-42',
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

  it('sikertelen ébredős vagy 401-es küldésnél a sor kopogtatható marad', async () => {
    const store = await boundStore()
    const down = deps(store, {
      knock: () => Promise.resolve('down'),
      send: (_chatId, text) => Promise.resolve(!text.startsWith('A gép ébredésére vár')),
    })
    const planned = await handleUpdate(
      { update_id: 5, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID } },
      down,
    )
    await applyKnocks(planned.knocks, down)
    expect((await store.listByUpdate(5))[0]?.status).toBe('queued')

    const secretStore = await boundStore()
    const rejected = deps(secretStore, {
      knock: () => Promise.resolve(401),
      send: (_chatId, text) => Promise.resolve(text !== 'A konténer elutasította a hívást.'),
    })
    const secret = await handleUpdate(
      { update_id: 8, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID } },
      rejected,
    )
    await applyKnocks(secret.knocks, rejected)
    expect((await secretStore.listByUpdate(8))[0]?.status).toBe('queued')
  })

  it('sikertelen hibamondatnál a sor nem lesz failed', async () => {
    const store = await boundStore()
    await store.insert({
      jobId: `5:${ID}`,
      updateId: 5,
      chatId: '42',
      messageId: 1,
      videoId: ID,
      url: `https://www.youtube.com/watch?v=${ID}`,
      status: 'accepted',
      phase: 'subtitle',
      error: null,
      title: null,
      noteUrl: null,
      notifiedReady: false,
      noteNotified: false,
      acceptedAt: 1,
      sub: 'sub-42',
    })
    const failedSend = deps(store, { send: () => Promise.resolve(false) })
    expect(await handleCallback(`5:${ID}`, { status: 'failed', error: 'Nincs felirat' }, failedSend)).toBe(200)
    expect((await store.listByUpdate(5))[0]?.status).toBe('accepted')
  })

  it('a 401 failed, és a cron nem éleszti', async () => {
    const store = await boundStore()
    const own = deps(store, { knock: () => Promise.resolve(401) })
    const planned = await handleUpdate(
      { update_id: 8, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID } },
      own,
    )
    await applyKnocks(planned.knocks, own)
    expect(own.sent).toContain('A konténer elutasította a hívást.')
    expect((await store.listByUpdate(8))[0]?.status).toBe('failed')
    const cron = deps(store)
    await handleCron(cron)
    expect(cron.knocked).toEqual([])
  })

  it('a felirat kész üzenete summary gombot kap', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const ok = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.sent).toEqual(['Cím. A felirat megvan.'])
    expect(ok.buttons).toEqual([{ text: 'summary', data: `summary:5:${ID}` }])
  })

  it('a summary kész linkje kimegy, noteUrl nélkül a mondat failed', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ phase: 'summary' }))
    const missing = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, missing)
    expect(missing.sent).toEqual(['A jegyzet linkje hiányzik.'])
    expect((await store.listByUpdate(5))[0]?.status).toBe('failed')

    const quiet = await boundStore()
    await quiet.insert(acceptedRow({ phase: 'summary' }))
    const held = deps(quiet, { send: () => Promise.resolve(false) })
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, held)
    expect((await quiet.listByUpdate(5))[0]?.status).toBe('accepted')

    const unsent = await boundStore()
    await unsent.insert(acceptedRow({ phase: 'summary' }))
    const dropped = deps(unsent, { send: () => Promise.resolve(false) })
    const keptUrl = 'https://github.com/tulaj/repo/blob/main/a_summary.md'
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím', noteUrl: keptUrl }, dropped)
    expect((await unsent.listByUpdate(5))[0]?.status).toBe('accepted')
    expect((await unsent.listByUpdate(5))[0]?.noteUrl).toBe(keptUrl)
    expect((await unsent.listByUpdate(5))[0]?.noteNotified).toBe(false)

    const linked = await boundStore()
    await linked.insert(acceptedRow({ phase: 'summary' }))
    const ok = deps(linked)
    const url = 'https://github.com/tulaj/repo/blob/main/a_summary.md'
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím', noteUrl: url }, ok)
    expect(ok.sent).toEqual([`Cím. A jegyzet megvan.\n${url}`])
    const row = (await linked.listByUpdate(5))[0]
    expect(row?.status).toBe('ready')
    expect(row?.noteNotified).toBe(true)
    expect(row?.noteUrl).toBe(url)

    const repeat = deps(linked)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím', noteUrl: url }, repeat)
    expect(repeat.sent).toEqual([])
  })
})

describe('handleTap', () => {
  it('két ready koppintásból egy summary kopogtatás indul', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'ready', phase: 'subtitle', notifiedReady: true, title: 'Cím' }))
    const first = deps(store)
    const second = deps(store)
    const tap = {
      update_id: 20,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }
    expect(await handleTap(tap, first)).toEqual([
      { jobId: `5:${ID}`, videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, recipe: 'summary' },
    ])
    expect(first.answered).toEqual(['cq'])
    expect(await handleTap({ ...tap, update_id: 21, callback_query: { ...tap.callback_query, id: 'cq2' } }, second)).toEqual([])
    expect(second.sent).toEqual([`Már sorban van: ${ID}.`])
  })

  it('az ismételt update_id nem kopogtat, a failed gomb újra queued', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'failed', phase: 'summary', error: 'A vault frissítése nem sikerült.' }))
    const depsOnce = deps(store)
    const tap = {
      update_id: 30,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }
    expect(await handleTap(tap, depsOnce)).toHaveLength(1)
    expect(await handleTap(tap, depsOnce)).toEqual([])
    expect((await store.listByUpdate(5))[0]?.status).toBe('queued')
    expect((await store.listByUpdate(5))[0]?.phase).toBe('summary')
  })

  it('idegen chat és a kiment link nem kopogtat', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({
      status: 'ready',
      phase: 'summary',
      title: 'Cím',
      noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md',
      noteNotified: true,
    }))
    const foreign = deps(store)
    await handleTap({
      update_id: 40,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 7 }, message: { chat: { id: 7 } } },
    }, foreign)
    expect(foreign.knocked).toEqual([])
    expect(foreign.sent).toEqual([])
    expect(foreign.answered).toEqual(['cq'])

    const own = deps(store)
    await handleTap({
      update_id: 41,
      callback_query: { id: 'cq2', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }, own)
    expect(own.sent).toEqual(['Cím. A jegyzet megvan.\nhttps://github.com/tulaj/repo/blob/main/a.md'])
    expect(own.knocked).toEqual([])
    const held = deps(store, { send: () => Promise.resolve(false) })
    await handleTap({
      update_id: 42,
      callback_query: { id: 'cq3', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }, held)
    expect((await store.listByUpdate(5))[0]?.noteNotified).toBe(true)
  })

  it('a cron a summary fázist recepttel ébreszti, a felirat fázist anélkül', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', phase: 'subtitle' }))
    await store.insert(acceptedRow({
      jobId: `6:${ID}`,
      updateId: 6,
      status: 'queued',
      phase: 'summary',
    }))
    const clock = deps(store)
    await handleCron(clock)
    expect(clock.knocks).toEqual([
      { jobId: `5:${ID}`, videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` },
      { jobId: `6:${ID}`, videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`, recipe: 'summary' },
    ])
  })

  it('a 401 a summary fázist failedre teszi, a fázis summary marad', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', phase: 'summary' }))
    const rejected = deps(store, { knock: () => Promise.resolve(401) })
    await handleCron(rejected)
    const row = (await store.listByUpdate(5))[0]
    expect(row?.status).toBe('failed')
    expect(row?.phase).toBe('summary')
    expect(row?.error).toBe('A konténer elutasította a hívást.')
  })
})

describe('kötés', () => {
  const message = (updateId: number, from: number, text: string) => ({
    update_id: updateId,
    message: { message_id: 1, chat: { id: from }, from: { id: from }, text },
  })
  const owner = { sub: 'sub-42', email: 'en@example.com' }

  it('a nem kötött felhasználó címe nem nyit sort, az ismételt /start nem ad második tokent', async () => {
    const store = memoryStore()
    const plain = deps(store)
    const result = await handleUpdate(message(1, 42, ID), plain)
    expect(result.knocks).toEqual([])
    expect(plain.sent).toEqual(['Előbb kösd össze a Google-fiókoddal: /start'])
    expect(await store.listByUpdate(1)).toEqual([])

    const flow = deps(store)
    await handleUpdate(message(2, 42, '/start'), flow)
    await handleUpdate(message(2, 42, '/start'), flow)
    expect(flow.sent).toEqual([`Kösd össze a Google-fiókoddal (10 percig érvényes): https://worker.test/link?t=${TOKEN_A}`])
    expect(await store.token(TOKEN_A)).toBeNull()
    expect(await store.token(await hashToken(TOKEN_A))).toMatchObject({
      telegramUserId: '42',
      expiresAt: 1_000_000 + 10 * 60 * 1000,
      pendingSub: null,
      used: false,
    })
    expect(await store.token(await hashToken(TOKEN_B))).toBeNull()
  })

  it('a /link visszatérő tokenre irányít, a visszatérés köt, és a régi sorok a fiókhoz kerülnek', async () => {
    const store = memoryStore()
    await store.insert(acceptedRow({ sub: null }))
    const flow = deps(store)
    await handleUpdate(message(1, 42, '/start'), flow)
    expect(await handleLink(TOKEN_A, owner, flow)).toEqual({
      status: 302,
      location: `https://t.me/refinery_bot?start=${TOKEN_B}`,
    })
    expect(await handleLink(TOKEN_A, owner, flow)).toEqual({ status: 200 })
    expect(await handleLink(TOKEN_B, owner, flow)).toEqual({ status: 200 })

    const back = deps(store)
    await handleUpdate(message(2, 42, `/start ${TOKEN_B}`), back)
    expect(back.sent).toEqual(['Bekötve: en@example.com.'])
    expect(await store.bindingFor('42')).toMatchObject({ sub: 'sub-42', email: 'en@example.com' })
    expect((await store.listByUpdate(5))[0]?.sub).toBe('sub-42')

    const again = deps(store)
    await handleUpdate(message(3, 42, `/start ${TOKEN_B}`), again)
    expect(again.sent).toEqual([INVALID])
    const plain = deps(store)
    await handleUpdate(message(4, 42, '/start'), plain)
    expect(plain.sent).toEqual(['Már be vagy kötve: en@example.com.'])
  })

  it('az idegen linkjét a tulajdonos lépteti be: sem az idegen, sem a tulajdonos nem köt', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 7, '/start'), flow)
    expect(await handleLink(TOKEN_A, owner, flow)).toEqual({
      status: 302,
      location: `https://t.me/refinery_bot?start=${TOKEN_B}`,
    })
    const stranger = deps(store)
    await handleUpdate(message(2, 7, `/start ${TOKEN_A}`), stranger)
    expect(stranger.sent).toEqual([INVALID])
    const victim = deps(store)
    await handleUpdate(message(3, 42, `/start ${TOKEN_B}`), victim)
    expect(victim.sent).toEqual([INVALID])
    expect(await store.bindingFor('7')).toBeNull()
    expect(await store.bindingFor('42')).toBeNull()
  })

  it('a rossz felhasználó visszatérése elhasználja a tokent, a kiszivárgott token sem köt', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 7, '/start'), flow)
    await handleLink(TOKEN_A, owner, flow)
    await handleUpdate(message(2, 42, `/start ${TOKEN_B}`), deps(store))
    expect((await store.token(await hashToken(TOKEN_B)))?.used).toBe(true)
    const stranger = deps(store)
    await handleUpdate(message(3, 7, `/start ${TOKEN_B}`), stranger)
    expect(stranger.sent).toEqual([INVALID])
    expect(await store.bindingFor('7')).toBeNull()
  })

  it('a lejárt, a kitalált és a rossz alakú token a /link-en hibaoldal', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 42, '/start'), flow)
    expect(await handleLink('rövid', owner, flow)).toEqual({ status: 200 })
    expect(await handleLink('C'.repeat(43), owner, flow)).toEqual({ status: 200 })
    const late = deps(store, { now: () => 1_000_000 + 10 * 60 * 1000 })
    expect(await handleLink(TOKEN_A, owner, late)).toEqual({ status: 200 })
  })

  it('a nem engedélyezett fiók visszatérése nem köt, és a token elhasználódik', async () => {
    const store = memoryStore()
    const flow = deps(store)
    await handleUpdate(message(1, 42, '/start'), flow)
    await handleLink(TOKEN_A, { sub: 'sub-9', email: 'mas@example.com' }, flow)
    const back = deps(store)
    await handleUpdate(message(2, 42, `/start ${TOKEN_B}`), back)
    expect(back.sent).toEqual(['Ez a Google-fiók nincs engedélyezve: mas@example.com.'])
    expect(await store.bindingFor('42')).toBeNull()
    expect((await store.token(await hashToken(TOKEN_B)))?.used).toBe(true)
  })

  it('a listáról törölt e-mail kiesik, a gombja sem indít, és a sor üzenete a sor chatjére megy', async () => {
    const store = await boundStore()
    const removed = deps(store, { allowedEmails: 'mas@example.com' })
    expect((await handleUpdate(message(9, 42, ID), removed)).knocks).toEqual([])
    expect(removed.sent).toEqual(['Előbb kösd össze a Google-fiókoddal: /start'])
    await store.insert(acceptedRow({ status: 'ready', notifiedReady: true, title: 'Cím' }))
    const tap = {
      update_id: 90,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }
    expect(await handleTap(tap, removed)).toEqual([])

    const other = memoryStore()
    await other.insert(acceptedRow({ chatId: '77' }))
    const ok = deps(other)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.chats).toEqual(['77'])
  })

  it('más fiók sorára a gomb nem indít', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'ready', notifiedReady: true, title: 'Cím', sub: 'sub-9' }))
    const own = deps(store)
    const tap = {
      update_id: 91,
      callback_query: { id: 'cq', data: `summary:5:${ID}`, from: { id: 42 }, message: { chat: { id: 42 } } },
    }
    expect(await handleTap(tap, own)).toEqual([])
    expect(own.sent).toEqual([])
  })
  it('csoportban a bot hallgat: a /start <token> nem köt, más sorának sub-ja marad, és a cím nem nyit sort', async () => {
    const store = memoryStore()
    await store.insert(acceptedRow({ chatId: '-100', sub: 'sub-42' }))
    const flow = deps(store)
    await handleUpdate(message(1, 7, '/start'), flow)
    await handleLink(TOKEN_A, { sub: 'sub-7', email: 'en@example.com' }, flow)
    const group = deps(store)
    const result = await handleUpdate(
      { update_id: 2, message: { message_id: 1, chat: { id: -100 }, from: { id: 7 }, text: `/start ${TOKEN_B}` } },
      group,
    )
    expect(result).toEqual({ status: 200, knocks: [] })
    expect(group.sent).toEqual([])
    expect(await store.bindingFor('7')).toBeNull()
    expect((await store.listByUpdate(5))[0]?.sub).toBe('sub-42')

    const bound = await boundStore()
    const groupUrl = deps(bound)
    expect(
      await handleUpdate(
        { update_id: 3, message: { message_id: 1, chat: { id: -100 }, from: { id: 42 }, text: ID } },
        groupUrl,
      ),
    ).toEqual({ status: 200, knocks: [] })
    expect(groupUrl.sent).toEqual([])
    expect(await bound.listByUpdate(3)).toEqual([])
  })
})
