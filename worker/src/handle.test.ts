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
import { langKeyboard, pickKeyboard, recipeKeyboard, runId, hashToken, type Key } from './plan.js'
import { memoryStore, type JobRow, type RunRow } from './store.js'

const ID = 'abcdefghijk'
const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const INVALID = 'A link lejárt vagy már nem érvényes. Kérj újat: /start'

function deps(store: ReturnType<typeof memoryStore>, over: Partial<WorkerDeps> = {}): WorkerDeps & {
  sent: string[]
  chats: string[]
  knocked: string[]
  knocks: PlannedKnock[]
  keyboards: Key[][][]
  edits: { chatId: string; messageId: number; text: string; keyboard: Key[][] }[]
  answered: string[]
} {
  const sent: string[] = []
  const chats: string[] = []
  const knocked: string[] = []
  const knocks: PlannedKnock[] = []
  const keyboards: Key[][][] = []
  const edits: { chatId: string; messageId: number; text: string; keyboard: Key[][] }[] = []
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
    keyboards,
    edits,
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
    send: (chatId, text, keyboard) => {
      chats.push(chatId)
      sent.push(text)
      if (keyboard) keyboards.push(keyboard)
      return Promise.resolve(true)
    },
    edit: (chatId, messageId, text, keyboard) => {
      edits.push({ chatId, messageId, text, keyboard })
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
    error: null,
    title: null,
    notifiedReady: false,
    acceptedAt: 1,
    sub: 'sub-42',
    ...partial,
  }
}

const VIDEO_URL = `https://www.youtube.com/watch?v=${ID}`
const TRANSCRIPT_URL = 'https://github.com/tulaj/repo/blob/main/a_transcript.md'

function readyRow(partial: Partial<JobRow> = {}): JobRow {
  return acceptedRow({ status: 'ready', notifiedReady: true, title: 'Cím', ...partial })
}

function readyRun(recipes: string[], lang: string | null = null, partial: Partial<RunRow> = {}): RunRow {
  return {
    runId: runId(`5:${ID}`, recipes, lang),
    jobId: `5:${ID}`,
    recipes,
    lang,
    status: 'ready',
    error: null,
    noteUrl: TRANSCRIPT_URL,
    notified: true,
    acceptedAt: 1,
    ...partial,
  }
}

function tap(updateId: number, data: string, from = 42, messageId?: number) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cq${updateId}`,
      data,
      from: { id: from },
      message: messageId === undefined ? { chat: { id: from } } : { message_id: messageId, chat: { id: from } },
    },
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
      error: null,
      title: null,
      notifiedReady: false,
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

  it('a már értesített, de újrakopogtatott sor a kész visszahívásra ready lesz, üzenet nélkül', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ notifiedReady: true, title: 'Cím' }))
    const repeat = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, repeat)
    expect(repeat.sent).toEqual([])
    expect((await store.listByUpdate(5))[0]?.status).toBe('ready')
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
      error: null,
      title: null,
      notifiedReady: false,
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

  it('a felirat kész üzenete a kilenc gombot kapja', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const ok = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.sent).toEqual(['Cím. A felirat megvan.'])
    expect(ok.keyboards).toEqual([recipeKeyboard(`5:${ID}`)])
  })

  it('a futás kész linkje kimegy, noteUrl nélkül failed, küldési hibánál accepted, az ismétlés nem küld', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['notes'], null, { status: 'accepted', noteUrl: null, notified: false }))
    const missing = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím' }, missing)
    expect(missing.sent).toEqual(['notes: A jegyzet linkje hiányzik.'])
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('failed')

    await store.saveRun(readyRun(['notes'], null, { status: 'accepted', noteUrl: null, notified: false }))
    const dropped = deps(store, { send: () => Promise.resolve(false) })
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, dropped)
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'accepted', noteUrl: TRANSCRIPT_URL, notified: false })

    const ok = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, ok)
    expect(ok.sent).toEqual([`Cím · notes. A jegyzet megvan.\nhttps://worker.test/notes/5:${ID}/notes`])
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'ready', notified: true })
    const repeat = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, repeat)
    expect(repeat.sent).toEqual([])
  })

  it('a futás hibasora a chatbe megy, a futás failed, a felirat sora marad', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['qa'], null, { status: 'accepted', notified: false }))
    const own = deps(store)
    await handleCallback(`5:${ID}:qa`, { status: 'failed', error: 'A futás megállt.' }, own)
    expect(own.sent).toEqual(['qa: A futás megállt.'])
    expect(await store.run(`5:${ID}:qa`)).toMatchObject({ status: 'failed', error: 'A futás megállt.' })
    expect((await store.listByUpdate(5))[0]?.status).toBe('ready')
  })
})

describe('handleTap', () => {
  it('a receptgomb futást nyit és kopogtat, a második koppintás már sorban, az ismételt update hallgat', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const first = deps(store)
    const knocks = await handleTap(tap(20, `r:notes:5:${ID}`), first)
    expect(knocks).toEqual([{ jobId: `5:${ID}:notes`, videoId: ID, url: VIDEO_URL, recipes: ['notes'] }])
    expect(first.answered).toEqual(['cq20'])
    expect(first.sent).toEqual(['Sorba került: notes'])
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'queued', recipes: ['notes'], lang: null })
    await applyKnocks(knocks, first)
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('accepted')

    const second = deps(store)
    expect(await handleTap(tap(21, `r:notes:5:${ID}`), second)).toEqual([])
    expect(second.sent).toEqual([`Már sorban van: ${ID}.`])
    const repeated = deps(store)
    expect(await handleTap(tap(20, `r:notes:5:${ID}`), repeated)).toEqual([])
    expect(repeated.sent).toEqual([])
  })

  it('a régi summary gomb a summary futás, a bukott futás újraindul, a kész újraküldi a linket', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    expect(await handleTap(tap(30, `summary:5:${ID}`), deps(store))).toEqual([
      { jobId: `5:${ID}:summary`, videoId: ID, url: VIDEO_URL, recipes: ['summary'] },
    ])
    await store.saveRun(readyRun(['summary'], null, { status: 'failed', error: 'x' }))
    expect(await handleTap(tap(31, `r:summary:5:${ID}`), deps(store))).toHaveLength(1)
    expect(await store.run(`5:${ID}:summary`)).toMatchObject({ status: 'queued', error: null })
    await store.saveRun(readyRun(['summary']))
    const again = deps(store)
    expect(await handleTap(tap(32, `r:summary:5:${ID}`), again)).toEqual([])
    expect(again.sent).toEqual([`Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/5:${ID}/summary`])
  })

  it('idegen fiók, idegen sor, a még nem kész felirat sora és az ismeretlen recept nem indít', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insert(readyRow({ jobId: `6:${ID}`, updateId: 6, sub: 'sub-9' }))
    await store.insert(readyRow({ jobId: `7:${ID}`, updateId: 7, status: 'accepted' }))
    const foreign = deps(store)
    expect(await handleTap(tap(40, `r:qa:5:${ID}`, 7), foreign)).toEqual([])
    expect(foreign.answered).toEqual(['cq40'])
    const own = deps(store)
    expect(await handleTap(tap(41, `r:qa:6:${ID}`), own)).toEqual([])
    expect(await handleTap(tap(42, `r:qa:7:${ID}`), own)).toEqual([])
    expect(await handleTap(tap(43, `r:toString:5:${ID}`), own)).toEqual([])
    expect(own.sent).toEqual([])
    expect(await store.runsFor(`5:${ID}`)).toEqual([])
  })

  it('a fordítás: kész jegyzet nélkül a mondat, utána a választó, a kapcsoló és a tovább szerkeszt, a nyelv indít', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const empty = deps(store)
    expect(await handleTap(tap(50, `f:5:${ID}`), empty)).toEqual([])
    expect(empty.sent).toEqual(['Előbb készíts egy jegyzetet.'])

    await store.insertRun(readyRun(['notes']))
    await store.insertRun(readyRun(['summary']))
    const picker = deps(store)
    await handleTap(tap(51, `f:5:${ID}`), picker)
    expect(picker.sent).toEqual(['Melyik jegyzetet fordítsam?'])
    expect(picker.keyboards).toEqual([pickKeyboard(0, ['summary', 'notes'], `5:${ID}`)])

    const toggled = deps(store)
    expect(await handleTap(tap(52, `t:3:5:${ID}`, 42, 9), toggled)).toEqual([])
    expect(toggled.edits).toEqual([
      { chatId: '42', messageId: 9, text: 'Melyik jegyzetet fordítsam?', keyboard: pickKeyboard(3, ['summary', 'notes'], `5:${ID}`) },
    ])
    const toggledNoMessage = deps(store)
    expect(await handleTap(tap(57, `t:3:5:${ID}`), toggledNoMessage)).toEqual([])
    expect(toggledNoMessage.edits).toEqual([])
    const blank = deps(store)
    await handleTap(tap(53, `n:0:5:${ID}`, 42, 9), blank)
    expect(blank.edits).toEqual([])
    const next = deps(store)
    await handleTap(tap(54, `n:3:5:${ID}`, 42, 9), next)
    expect(next.edits).toEqual([{ chatId: '42', messageId: 9, text: 'Melyik nyelvre?', keyboard: langKeyboard(3, `5:${ID}`) }])
    const noMessage = deps(store)
    await handleTap(tap(55, `n:3:5:${ID}`), noMessage)
    expect(noMessage.edits).toEqual([])

    const lang = deps(store)
    expect(await handleTap(tap(56, `l:3:de:5:${ID}`, 42, 9), lang)).toEqual([
      { jobId: `5:${ID}:de:summary+notes`, videoId: ID, url: VIDEO_URL, recipes: ['summary', 'notes'], lang: 'de' },
    ])
    expect(lang.sent).toEqual(['Sorba került: summary, notes → de'])
  })

  it('a cron a felirat sorát recept nélkül, a futást a recipes és a lang mezővel ébreszti, a 401 failed', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued' }))
    await store.insert(readyRow({ jobId: `6:${ID}`, updateId: 6 }))
    await store.insertRun(
      readyRun(['summary', 'notes'], 'de', {
        jobId: `6:${ID}`,
        runId: `6:${ID}:de:summary+notes`,
        status: 'queued',
        notified: false,
      }),
    )
    const clock = deps(store)
    await handleCron(clock)
    expect(clock.knocks).toEqual([
      { jobId: `5:${ID}`, videoId: ID, url: VIDEO_URL },
      { jobId: `6:${ID}:de:summary+notes`, videoId: ID, url: VIDEO_URL, recipes: ['summary', 'notes'], lang: 'de' },
    ])
    expect((await store.run(`6:${ID}:de:summary+notes`))?.status).toBe('accepted')

    const rejected = await boundStore()
    await rejected.insert(readyRow())
    await rejected.insertRun(readyRun(['qa'], null, { status: 'queued', notified: false }))
    await handleCron(deps(rejected, { knock: () => Promise.resolve(401) }))
    expect(await rejected.run(`5:${ID}:qa`)).toMatchObject({ status: 'failed', error: 'A konténer elutasította a hívást.' })
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
