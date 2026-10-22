import { textItemId } from 'transcript-refinery/text'
import { describe, expect, it, vi } from 'vitest'
import {
  applyKnocks,
  findRow,
  handleCallback,
  handleCron,
  handleLink,
  handleTap,
  handleUpdate,
  type PlannedKnock,
  type WorkerDeps,
} from './handle.js'
import {
  DROPPED_LINE,
  langKeyboard,
  maskRecipes,
  parseTap,
  pickKeyboard,
  recipeKeyboard,
  retryKeyboard,
  runId,
  runReadyMessage,
  hashToken,
  type Key,
  type Probe,
} from './plan.js'
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
  cancelled: string[]
} {
  const sent: string[] = []
  const chats: string[] = []
  const knocked: string[] = []
  const knocks: PlannedKnock[] = []
  const keyboards: Key[][][] = []
  const edits: { chatId: string; messageId: number; text: string; keyboard: Key[][] }[] = []
  const answered: string[] = []
  const cancelled: string[] = []
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
    cancelled,
    cancel: (id) => {
      cancelled.push(id)
      return Promise.resolve('ok')
    },
    probe: () => Promise.resolve({ ok: true, ms: 7, version: '1.16.0', busy: null }),
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
    download: () => Promise.resolve(null),
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
const TRANSCRIPT_URL = 'Inbox/transcript-refinery/a_transcript.md'

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

function command(updateId: number, text: string, from = 42) {
  return { update_id: updateId, message: { message_id: updateId, chat: { id: from }, from: { id: from }, text } }
}

const ID2 = 'bcdefghijkl'

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
    expect(missing.sent).toEqual([`[${ID}] Cím: notes: A jegyzet linkje hiányzik.`])
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('failed')

    await store.saveRun(readyRun(['notes'], null, { status: 'accepted', noteUrl: null, notified: false }))
    const dropped = deps(store, { send: () => Promise.resolve(false) })
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, dropped)
    expect(await store.run(`5:${ID}:notes`)).toMatchObject({ status: 'accepted', noteUrl: TRANSCRIPT_URL, notified: false })

    const ok = deps(store)
    await handleCallback(`5:${ID}:notes`, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, ok)
    expect(ok.sent).toEqual([`Cím · notes. A jegyzet megvan.\nhttps://worker.test/notes/${ID}/notes`])
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
    expect(own.sent).toEqual([`[${ID}] Cím: qa: A futás megállt.`])
    expect(await store.run(`5:${ID}:qa`)).toMatchObject({ status: 'failed', error: 'A futás megállt.' })
    expect((await store.listByUpdate(5))[0]?.status).toBe('ready')
  })
})

describe('handleCallback — életjel és leállás', () => {
  async function accepted(recipes: string[], lang: string | null = null) {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(recipes, lang, { status: 'accepted', noteUrl: null, notified: false })
    await store.insertRun(run)
    return { store, run }
  }

  it('az életjel új üzenetként megy, az állapot nem változik', async () => {
    const { store, run } = await accepted(['qa'])
    const d = deps(store)
    await handleCallback(run.runId, { status: 'progress', text: 'qa: kb. 9 000 szó kész, még dolgozik' }, d)
    expect(d.sent).toEqual(['qa: kb. 9 000 szó kész, még dolgozik'])
    expect(d.keyboards).toEqual([])
    expect((await store.run(run.runId))?.status).toBe('accepted')
  })

  it('a leállás üzenete Újra és Eldobás gombot visz, az állapot nem változik', async () => {
    const { store, run } = await accepted(['qa'])
    const d = deps(store)
    await handleCallback(run.runId, { status: 'stalled', text: 'Leállt. Újra próbáljam?' }, d)
    expect(d.sent).toEqual(['Leállt. Újra próbáljam?'])
    expect(d.keyboards[0]!.flat().map((key) => key.text)).toEqual(['Újra', 'Eldobás'])
    expect(parseTap(d.keyboards[0]![0]![0]!.data)).toEqual({ type: 'recipe', recipe: 'qa', jobId: `5:${ID}` })
    expect(d.keyboards[0]![0]![1]!.data).toBe(`d:5:${ID}`)
    expect((await store.run(run.runId))?.status).toBe('accepted')
  })

  it('fordításfutás leállásánál az Újra a nyelvvel és az összes recepttel indul', async () => {
    const { store, run } = await accepted(['summary', 'qa'], 'de')
    const d = deps(store)
    await handleCallback(run.runId, { status: 'stalled', text: 'Leállt. Újra próbáljam?' }, d)
    const retry = parseTap(d.keyboards[0]![0]![0]!.data)
    expect(retry).toMatchObject({ type: 'lang', lang: 'de', jobId: `5:${ID}` })
    expect(maskRecipes((retry as { mask: number }).mask)).toEqual(['summary', 'qa'])
  })

  it('kész jegyzet nélküli leállás után a záró hiba nem küld üzenetet, a futás failed', async () => {
    const { store, run } = await accepted(['qa'])
    const d = deps(store)
    await handleCallback(run.runId, { status: 'failed', error: 'Leállt.', done: [] }, d)
    expect(d.sent).toEqual([])
    expect(await store.run(run.runId)).toMatchObject({ status: 'failed', error: 'Leállt.' })
  })

  it('kész jegyzetekkel zárt leállásnál csak az elkészültek linkje megy', async () => {
    const { store, run } = await accepted(['summary', 'qa'], 'hu')
    const d = deps(store)
    await handleCallback(run.runId, { status: 'failed', error: 'Leállt.', done: ['summary-hu'] }, d)
    expect(d.sent).toHaveLength(1)
    expect(d.sent[0]).toContain(`https://worker.test/notes/${ID}/summary-hu`)
    expect(d.sent[0]).not.toContain('qa-hu')
    expect((await store.run(run.runId))?.status).toBe('failed')
  })

  it('a leállás üzenete a záró hiba után is kimegy, a futás failed marad', async () => {
    const { store, run } = await accepted(['qa'])
    await handleCallback(run.runId, { status: 'failed', error: 'Leállt.', done: [] }, deps(store))
    const late = deps(store)
    await handleCallback(run.runId, { status: 'stalled', text: 'Leállt. Újra próbáljam?' }, late)
    expect(late.sent).toEqual(['Leállt. Újra próbáljam?'])
    expect((await store.run(run.runId))?.status).toBe('failed')
  })

  it('a megszakított futás életjelét és leállását elnyeli', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['qa'], null, { status: 'cancelled', notified: false })
    await store.insertRun(run)
    const d = deps(store)
    await handleCallback(run.runId, { status: 'progress', text: 'még dolgozik' }, d)
    await handleCallback(run.runId, { status: 'stalled', text: 'Leállt.' }, d)
    expect(d.sent).toEqual([])
  })

  it('a felirat sorához érkező életjel semmit nem csinál', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const d = deps(store)
    expect(await handleCallback(`5:${ID}`, { status: 'progress', text: 'még dolgozik' }, d)).toBe(200)
    expect(d.sent).toEqual([])
    expect((await findRow(store, `5:${ID}`))?.status).toBe('accepted')
  })
})

describe('handleTap', () => {
  it('a szöveges tétel futásüzenete a vault-azonosítóval és a címmel kezdődik', async () => {
    const store = await boundStore()
    const textId = 't-0123456789abcdef'
    await store.insert(readyRow({ videoId: textId, jobId: `5:${textId}`, title: 'eloadas-jegyzet' }))
    const d = deps(store)
    await handleTap(tap(20, `r:notes:5:${textId}`), d)
    expect(d.sent).toEqual([`Sorba került [${textId}] eloadas-jegyzet: notes`])
  })

  it('a receptgomb futást nyit és kopogtat, a második koppintás már sorban, az ismételt update hallgat', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const first = deps(store)
    const knocks = await handleTap(tap(20, `r:notes:5:${ID}`), first)
    expect(knocks).toEqual([{ jobId: `5:${ID}:notes`, videoId: ID, url: VIDEO_URL, recipes: ['notes'] }])
    expect(first.answered).toEqual(['cq20'])
    expect(first.sent).toEqual([`Sorba került [${ID}] Cím: notes`])
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
    expect(again.sent).toEqual([`Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/${ID}/summary`])
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
    expect(lang.sent).toEqual([`Sorba került [${ID}] Cím: summary, notes → de`])
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

describe('handleTap — leállt recept: Újra és Eldobás', () => {
  it('az Eldobás átírja az üzenetet, és nem kér futást', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['qa'], null, { status: 'failed', error: 'Leállt.', notified: false }))
    const d = deps(store)
    const knocks = await handleTap(tap(30, `d:5:${ID}`, 42, 77), d)
    expect(knocks).toEqual([])
    expect(d.edits).toEqual([{ chatId: '42', messageId: 77, text: DROPPED_LINE, keyboard: [] }])
    expect((await store.run(`5:${ID}:qa`))?.status).toBe('failed')
  })

  it('az Újra a leállt (failed) futást ugyanazzal az azonosítóval újraindítja', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['qa'], null, { status: 'failed', error: 'Leállt.', notified: false })
    await store.insertRun(run)
    const d = deps(store)
    const retry = retryKeyboard(run)[0]![0]!.data
    const knocks = await handleTap(tap(31, retry), d)
    expect(knocks.map((knock) => knock.jobId)).toEqual([run.runId])
    expect((await store.run(run.runId))?.status).toBe('queued')
  })

  it('futás közben az Újra „már folyamatban” üzenetet ad, és nem kopogtat', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['qa'], null, { status: 'accepted', noteUrl: null, notified: false })
    await store.insertRun(run)
    const d = deps(store)
    const knocks = await handleTap(tap(32, retryKeyboard(run)[0]![0]!.data), d)
    expect(knocks).toEqual([])
    expect(d.sent).toHaveLength(1)
    expect((await store.run(run.runId))?.status).toBe('accepted')
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

describe('indulási üzenet', () => {
  const STARTED = (label: string) => `Elkezdődött a feldolgozás [${ID}] Cím: ${label}. Hamarosan jelzem az eredményt.`

  it('a receptfuttatás 202-es elfogadása után egyszer megy, a fordításé a nyelvvel', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const own = deps(store)
    const knocks = await handleTap(tap(60, `r:notes:5:${ID}`), own)
    await applyKnocks(knocks, own)
    expect(own.sent).toEqual([`Sorba került [${ID}] Cím: notes`, STARTED('notes')])
    expect((await store.run(`5:${ID}:notes`))?.status).toBe('accepted')

    const translate = deps(store)
    const planned = await handleTap(tap(61, `l:3:de:5:${ID}`), translate)
    await applyKnocks(planned, translate)
    expect(translate.sent.at(-1)).toBe(STARTED('summary, notes → de'))
  })

  it('a 409 csendes, a cron későbbi 202-je küldi; a már elfogadott futás újrakopogtatása nem', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const busy = deps(store, { knock: () => Promise.resolve(409) })
    const knocks = await handleTap(tap(62, `r:qa:5:${ID}`), busy)
    await applyKnocks(knocks, busy)
    expect(busy.sent).toEqual([`Sorba került [${ID}] Cím: qa`])
    expect((await store.run(`5:${ID}:qa`))?.status).toBe('queued')

    const cron = deps(store)
    await handleCron(cron)
    expect(cron.sent).toEqual([STARTED('qa')])
    expect((await store.run(`5:${ID}:qa`))?.status).toBe('accepted')

    const again = deps(store)
    await applyKnocks([{ jobId: `5:${ID}:qa`, videoId: ID, url: VIDEO_URL, recipes: ['qa'] }], again)
    expect(again.sent).toEqual([])
  })

  it('a feliratjob elfogadása után nincs indulási üzenet, a sikertelen küldés nem tartja vissza az állapotot', async () => {
    const store = await boundStore()
    const own = deps(store)
    const planned = await handleUpdate(
      { update_id: 5, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: ID } },
      own,
    )
    await applyKnocks(planned.knocks, own)
    expect(own.sent).toEqual([`Sorba került: ${ID}`])

    await store.insert(readyRow({ jobId: `6:${ID}`, updateId: 6 }))
    const mute = deps(store, { send: () => Promise.resolve(false) })
    const knocks = await handleTap(tap(63, `r:bloom:6:${ID}`), mute)
    await applyKnocks(knocks, mute)
    expect((await store.run(`6:${ID}:bloom`))?.status).toBe('accepted')
  })

  it('a gomb és a cron egyszerre kopogtat ugyanarra a futásra: egyetlen indulási üzenet megy', async () => {
    const base = await boundStore()
    // A D1 másolatot ad vissza, a memóriás tár közös hivatkozást: klónozva kapjuk a versenyhelyzetet.
    const store: ReturnType<typeof memoryStore> = {
      ...base,
      run: async (id) => structuredClone(await base.run(id)),
      dueRuns: async (now) => structuredClone(await base.dueRuns(now)),
    }
    await store.insert(readyRow())
    let release: (code: 202) => void = () => {}
    const gate = new Promise<202>((resolve) => {
      release = resolve
    })
    const own = deps(store, { knock: () => gate })
    const knocks = await handleTap(tap(70, `r:notes:5:${ID}`), own)
    const both = Promise.all([applyKnocks(knocks, own), handleCron(own)])
    release(202)
    await both
    expect(own.sent.filter((line) => line.startsWith('Elkezdődött'))).toHaveLength(1)
  })
})

describe('megszakítás: verseny és késői visszahívás', () => {
  it('a kopogtatás közben megszakított sort a 202 nem írja vissza, és a serve leállítást kap', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    const d = deps(store, {
      knock: async (job) => {
        await store.claimJob(job.jobId, 'queued', 'cancelled')
        return 202
      },
    })
    await handleCron(d)
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
    expect(d.cancelled).toEqual([`5:${ID}`])
  })

  it('a kopogtatás közben megszakított futás nem indul el, és a serve leállítást kap', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['summary'], null, { status: 'queued', noteUrl: null, notified: false, acceptedAt: null })
    await store.insertRun(run)
    const d = deps(store, {
      knock: async (job) => {
        await store.claimRun(job.jobId, 'queued', 'cancelled')
        return 202
      },
    })
    await handleCron(d)
    expect((await store.run(run.runId))?.status).toBe('cancelled')
    expect(d.cancelled).toEqual([run.runId])
    expect(d.sent).toEqual([])
  })

  it('megszakított feliratsorra a késői ready és failed visszahívás csendes', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'cancelled' }))
    const d = deps(store)
    expect(await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, d)).toBe(200)
    expect(await handleCallback(`5:${ID}`, { status: 'failed', error: 'Nincs felirat' }, d)).toBe(200)
    expect(d.sent).toEqual([])
    expect(d.keyboards).toEqual([])
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
  })

  it('megszakított futásra a failed a hibasort, a ready a linkeket küldi, az állapot marad', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['summary', 'qa'], null, { status: 'cancelled', noteUrl: null, notified: false })
    await store.insertRun(run)
    const d = deps(store)
    await handleCallback(run.runId, { status: 'failed', error: 'A futás megállt: megszakítva (0.0040 $ / 5.0000 $)' }, d)
    await handleCallback(run.runId, { status: 'ready', title: 'Cím', noteUrl: TRANSCRIPT_URL }, d)
    expect(d.sent).toEqual([
      `[${ID}] Cím: summary, qa: A futás megállt: megszakítva (0.0040 $ / 5.0000 $)`,
      `Cím · summary, qa. A jegyzet megvan.\nhttps://worker.test/notes/${ID}/summary\nhttps://worker.test/notes/${ID}/qa`,
    ])
    expect((await store.run(run.runId))?.status).toBe('cancelled')
  })

  it('a megszakított futást a receptgomb újraindítja', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['summary'], null, { status: 'cancelled', noteUrl: null, notified: false }))
    const d = deps(store)
    const knocks = await handleTap(tap(60, `r:summary:5:${ID}`), d)
    expect(knocks.map((knock) => knock.jobId)).toEqual([runId(`5:${ID}`, ['summary'], null)])
    expect((await store.run(runId(`5:${ID}`, ['summary'], null)))?.status).toBe('queued')
    expect(d.sent).toEqual([`Sorba került [${ID}] Cím: summary`])
  })

  it('a cron a megszakított sort és futást nem kopogtatja', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'cancelled' }))
    await store.insertRun(readyRun(['qa'], null, { status: 'cancelled' }))
    const d = deps(store)
    await handleCron(d)
    expect(d.knocked).toEqual([])
  })
})

describe('/cancel', () => {
  it('nyitott munka nélkül ezt mondja, kötés nélkül a kösd össze sort', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(70, '/cancel'), d)
    await handleUpdate(command(71, '/cancel', 99), d)
    expect(d.sent).toEqual(['Nincs megszakítható munka.', 'Előbb kösd össze a Google-fiókoddal: /start'])
  })

  it('csak a saját nyitott munkákat listázza, a kész jobot a nyitott futása miatt, alul a Mind gombbal', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    await store.insert(acceptedRow({ jobId: `6:${ID}`, updateId: 6, sub: 'sub-masik', status: 'queued' }))
    await store.insert(readyRow({ jobId: `7:${ID2}`, updateId: 7, videoId: ID2, title: 'Cím' }))
    await store.insertRun({ ...readyRun(['qa'], null, { status: 'accepted', noteUrl: null, notified: false }), runId: `7:${ID2}:qa`, jobId: `7:${ID2}` })
    await store.insert(readyRow({ jobId: `8:${ID2}`, updateId: 8, videoId: ID2 }))
    const d = deps(store)
    await handleUpdate(command(70, '/cancel@refinery_bot'), d)
    expect(d.sent).toEqual(['Melyiket szakítsam meg?'])
    expect(d.keyboards).toEqual([
      [
        [{ text: ID, data: `c:5:${ID}` }],
        [{ text: 'Cím', data: `c:7:${ID2}` }],
        [{ text: 'Mind megszakítása', data: 'c:*' }],
      ],
    ])
  })

  it('a sorban álló job megszakítása kopogtatás és serve-hívás nélkül cancelled, és a cron sem éleszti', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    const d = deps(store)
    expect(await handleTap(tap(80, `c:5:${ID}`), d)).toEqual([])
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
    expect(d.cancelled).toEqual([])
    expect(d.sent).toEqual([`Megszakítva: ${ID}.`])
    await handleCron(d)
    expect(d.knocked).toEqual([])
  })

  it('a futó job: ok és unknown után cancelled, elérhetetlen serve mellett accepted marad és újrapróbálást kér', async () => {
    for (const [answer, status, line] of [
      ['ok', 'cancelled', `Megszakítva: ${ID}.`],
      ['unknown', 'cancelled', `Megszakítva: ${ID}.`],
      ['unreachable', 'accepted', 'Most nem érem el a szervert, próbáld újra.'],
    ] as const) {
      const store = await boundStore()
      await store.insert(acceptedRow())
      const d = deps(store, { cancel: () => Promise.resolve(answer) })
      await handleTap(tap(81, `c:5:${ID}`), d)
      expect((await findRow(store, `5:${ID}`))?.status).toBe(status)
      expect(d.sent).toEqual([line])
    }
  })

  it('a második koppintás hatástalan, az ismételt update hallgat', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const d = deps(store)
    await handleTap(tap(82, `c:5:${ID}`), d)
    await handleTap(tap(82, `c:5:${ID}`), d)
    await handleTap(tap(83, `c:5:${ID}`), d)
    expect(d.cancelled).toEqual([`5:${ID}`])
    expect(d.sent).toEqual([`Megszakítva: ${ID}.`, 'Ez már lefutott vagy meg lett szakítva.'])
  })

  it('más fiók jobjára a koppintás nem változtat semmit', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ jobId: `6:${ID}`, updateId: 6, sub: 'sub-masik' }))
    const d = deps(store)
    await handleTap(tap(84, `c:6:${ID}`), d)
    expect((await findRow(store, `6:${ID}`))?.status).toBe('accepted')
    expect(d.cancelled).toEqual([])
    expect(d.sent).toEqual(['Ez már lefutott vagy meg lett szakítva.'])
  })

  it('a kész job futó receptjét állítja le: a futás cancelled, a job ready marad', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    const run = readyRun(['summary'], null, { status: 'accepted', noteUrl: null, notified: false })
    await store.insertRun(run)
    const d = deps(store)
    await handleTap(tap(85, `c:5:${ID}`), d)
    expect((await store.run(run.runId))?.status).toBe('cancelled')
    expect((await findRow(store, `5:${ID}`))?.status).toBe('ready')
    expect(d.cancelled).toEqual([run.runId])
    expect(d.sent).toEqual(['Megszakítva: Cím.'])
  })

  it('a Mind gomb minden saját nyitott munkát megszakít', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    await store.insert(acceptedRow({ jobId: `7:${ID2}`, updateId: 7, videoId: ID2 }))
    const d = deps(store)
    await handleTap(tap(86, 'c:*'), d)
    expect((await findRow(store, `5:${ID}`))?.status).toBe('cancelled')
    expect((await findRow(store, `7:${ID2}`))?.status).toBe('cancelled')
    expect(d.sent).toEqual([`Megszakítva: ${ID}.`, `Megszakítva: ${ID2}.`])
  })
})

describe('tájékoztató parancsok', () => {
  const HELP = [
    'Küldj egy YouTube-linket, és letöltöm a feliratát.',
    'Csatolt .txt vagy .md átiratot is feldolgozok.',
    '',
    '/scan <szöveg> – beillesztett átirat feldolgozása (egy üzenetnyi)',
    '/start – a bot összekötése a Google-fiókoddal',
    '/cancel – nyitott munka megszakítása',
    '/status – a szerver állapota és a nyitott munkák',
    '/ping – a szerver elérhetősége',
    '/version – a szerver verziója',
    '/help – ez a súgó',
  ].join('\n')

  it('a /help kötés nélkül is megy, a többi parancs kötést kér', async () => {
    const d = deps(memoryStore())
    await handleUpdate(command(90, '/help'), d)
    await handleUpdate(command(91, '/ping'), d)
    expect(d.sent).toEqual([HELP, 'Előbb kösd össze a Google-fiókoddal: /start'])
  })

  it('a /ping, a /version és a /status a serve válaszából', async () => {
    const store = await boundStore()
    await store.insert(acceptedRow())
    const d = deps(store, {
      probe: () => Promise.resolve({ ok: true, ms: 7, version: '1.16.0', busy: `5:${ID}` }),
    })
    await handleUpdate(command(92, '/ping'), d)
    await handleUpdate(command(93, '/version'), d)
    await handleUpdate(command(94, '/status'), d)
    expect(d.sent).toEqual([
      'A szerver él (7 ms).',
      'A szerver verziója: 1.16.0.',
      `A szerver verziója: 1.16.0. Most ezen dolgozik: 5:${ID}.\nNyitott videó: 1, nyitott receptfutás: 0.`,
    ])
  })

  it('nem elérhető serve mellett a /status a D1 számait is adja, titokeltérésnél a titok-sor megy', async () => {
    const store = await boundStore()
    await store.insert(readyRow())
    await store.insertRun(readyRun(['qa'], null, { status: 'queued', noteUrl: null, notified: false }))
    const down = (): Promise<Probe> => Promise.resolve({ ok: false, reason: 'down' })
    const secret = (): Promise<Probe> => Promise.resolve({ ok: false, reason: 'secret' })
    const d = deps(store, { probe: down })
    await handleUpdate(command(95, '/status'), d)
    await handleUpdate(command(96, '/ping'), d)
    await handleUpdate(command(97, '/version'), deps(store, { probe: secret, send: d.send }))
    expect(d.sent).toEqual([
      'A szerver nem válaszol.\nNyitott videó: 0, nyitott receptfutás: 1.',
      'A szerver nem válaszol.',
      'A Worker és a serve titka nem egyezik.',
    ])
  })

  it('az ismeretlen parancs a mai választ kapja', async () => {
    const d = deps(await boundStore())
    await handleUpdate(command(98, '/foo'), d)
    expect(d.sent).toEqual(['Nincs YouTube-videó az üzenetben.'])
  })
})

describe('megszakítás: naplózás', () => {
  it('az utólagos serve-leállítás elbukása és a sikertelen üzenet figyelmeztetést naplóz', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = await boundStore()
    await store.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    await handleCron(
      deps(store, {
        knock: async (job) => {
          await store.claimJob(job.jobId, 'queued', 'cancelled')
          return 202
        },
        cancel: () => Promise.resolve('unreachable'),
      }),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`5:${ID}`))
    warn.mockClear()

    const other = await boundStore()
    await other.insert(acceptedRow({ status: 'queued', acceptedAt: null }))
    await handleTap(tap(87, `c:5:${ID}`), deps(other, { send: () => Promise.resolve(false) }))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`5:${ID}`))
    warn.mockRestore()
  })
})

describe('szöveges bemenet', () => {
  const enc = (text: string) => new TextEncoder().encode(text)
  const BODY = 'Első sor.\nMásodik sor.'

  function doc(
    updateId: number,
    document: { file_id: string; file_name?: string; file_size?: number },
    extra: Record<string, unknown> = {},
  ) {
    return {
      update_id: updateId,
      message: { message_id: updateId, chat: { id: 42 }, from: { id: 42 }, document, ...extra },
    }
  }

  function file(updateId: number, name: string, extra: Record<string, unknown> = {}) {
    return doc(updateId, { file_id: `F${updateId}`, file_name: name, file_size: 20 }, extra)
  }

  it('a csatolt .txt sort nyit a címmel, és a kopogtatás viszi a szöveget és a nyelvkódot', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc(`${BODY}\r\n`)) })
    const id = await textItemId(BODY)
    const planned = await handleUpdate(file(5, 'átirat.en.txt'), d)
    expect(d.sent).toEqual(['Sorba került: átirat'])
    expect((await store.listByUpdate(5))[0]).toMatchObject({
      jobId: `5:${id}`,
      videoId: id,
      url: '',
      title: 'átirat',
      fileId: 'F5',
      fileName: 'átirat.en.txt',
      text: null,
    })
    expect(planned.knocks).toEqual([
      { jobId: `5:${id}`, videoId: id, url: '', text: BODY, title: 'átirat', textLang: 'en' },
    ])
  })

  it('a nagybetűs kiterjesztés is jó, és az aláírás linkje nem indul', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc(BODY)) })
    const planned = await handleUpdate(file(5, 'ÁTIRAT.TXT', { caption: `https://youtu.be/${ID}` }), d)
    expect(d.sent).toEqual(['Sorba került: ÁTIRAT'])
    expect(planned.knocks).toHaveLength(1)
    expect(await store.listByUpdate(5)).toHaveLength(1)
    expect((await store.listByUpdate(5))[0]?.videoId).toBe(await textItemId(BODY))
  })

  it('ugyanaz a szöveg más néven, nyitott sor mellett: már sorban, kopogtatás nélkül', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc(BODY)) })
    await handleUpdate(file(5, 'egy.txt'), d)
    const second = await handleUpdate(file(6, 'masik.txt'), d)
    expect(d.sent).toEqual(['Sorba került: egy', 'Már sorban van: masik.'])
    expect(second.knocks).toEqual([])
  })

  it('a .pdf, a név nélküli és a 3 MB-os fájl hibát kap, letöltés és sor nélkül, a videós mondat sem jön', async () => {
    const store = await boundStore()
    let downloads = 0
    const d = deps(store, {
      download: () => {
        downloads += 1
        return Promise.resolve(enc(BODY))
      },
    })
    await handleUpdate(file(5, 'jegyzet.pdf'), d)
    await handleUpdate(doc(6, { file_id: 'F6' }), d)
    await handleUpdate(doc(7, { file_id: 'F7', file_name: 'nagy.txt', file_size: 3 * 1024 * 1024 }), d)
    expect(d.sent).toEqual([
      'Csak .txt vagy .md fájlt tudok feldolgozni.',
      'Csak .txt vagy .md fájlt tudok feldolgozni.',
      'A fájl túl nagy: 3.0 MB, legfeljebb 2 MB.',
    ])
    expect(downloads).toBe(0)
    for (const update of [5, 6, 7]) expect(await store.listByUpdate(update)).toEqual([])
  })

  it('a .md frontmatter nélkül megy tovább', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc('---\ntitle: X\n---\n# Fejezet\nszöveg\n')) })
    const planned = await handleUpdate(file(5, 'jegyzet.md'), d)
    expect(planned.knocks[0]?.text).toBe('# Fejezet\nszöveg')
  })

  it('a nem UTF-8 fájl, az üres fájl és a sikertelen letöltés megnevezett mondatot kap, sor nélkül', async () => {
    const store = await boundStore()
    const a = deps(store, { download: () => Promise.resolve(new Uint8Array([0xc3, 0x28])) })
    await handleUpdate(file(5, 'a.txt'), a)
    const b = deps(store, { download: () => Promise.resolve(enc(' \n')) })
    await handleUpdate(file(6, 'b.txt'), b)
    const c = deps(store)
    await handleUpdate(file(7, 'c.txt'), c)
    expect([...a.sent, ...b.sent, ...c.sent]).toEqual([
      'A fájl nem UTF-8 szöveg.',
      'A fájl üres.',
      'A fájlt nem tudtam letölteni, küldd újra.',
    ])
    for (const update of [5, 6, 7]) expect(await store.listByUpdate(update)).toEqual([])
  })

  it('a /scan szövegéből a cím az első sor, a szöveg a D1-ben vár', async () => {
    const store = await boundStore()
    const d = deps(store)
    const planned = await handleUpdate(command(5, '/scan \n\n  Kubernetes alapok\nMa arról lesz szó.'), d)
    const text = 'Kubernetes alapok\nMa arról lesz szó.'
    const id = await textItemId(text)
    expect(d.sent).toEqual(['Sorba került: Kubernetes alapok'])
    expect((await store.listByUpdate(5))[0]).toMatchObject({ videoId: id, title: 'Kubernetes alapok', text, fileId: null })
    expect(planned.knocks).toEqual([{ jobId: `5:${id}`, videoId: id, url: '', text, title: 'Kubernetes alapok' }])
  })

  it('a hosszú első sor 80 karakterre vágva a cím; az üres /scan tippet ad; a 3900 karakteres figyelmeztet', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(5, `/scan ${'a'.repeat(100)}`), d)
    await handleUpdate(command(6, '/scan'), d)
    await handleUpdate(command(7, `/scan ${'x'.repeat(3900)}`), d)
    expect(d.sent).toEqual([
      `Sorba került: ${'a'.repeat(80)}`,
      'Írd a /scan után a szöveget, vagy küldd fájlként.',
      `Sorba került: ${'x'.repeat(80)}\nA szöveg elérhette a Telegram-üzenet határát, lehet, hogy csonka. Hosszabb átiratot fájlként küldj.`,
    ])
    expect(await store.listByUpdate(6)).toEqual([])
  })

  it('a /scanner nem a /scan parancs', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(5, '/scanner'), d)
    expect(d.sent).toEqual(['Nincs YouTube-videó az üzenetben.'])
  })

  it('down után a cron a D1 szövegéből kopogtat, és a vár sor a címet mondja', async () => {
    const store = await boundStore()
    const down = deps(store, { knock: () => Promise.resolve('down') })
    const planned = await handleUpdate(command(5, '/scan Kubernetes alapok'), down)
    await applyKnocks(planned.knocks, down)
    expect(down.sent).toEqual(['Sorba került: Kubernetes alapok', 'A gép ébredésére vár: Kubernetes alapok.'])
    const up = deps(store)
    await handleCron(up)
    expect(up.knocks.map((knock) => knock.text)).toEqual(['Kubernetes alapok'])
  })

  it('a cron a .md csatolmányt újra letölti, a frontmatter újra lekerül; sikertelen letöltésnél nem kopogtat', async () => {
    const store = await boundStore()
    let downloads = 0
    const md = () => {
      downloads += 1
      return Promise.resolve(enc('---\ntitle: X\n---\n# Fejezet\n'))
    }
    const down = deps(store, { download: md, knock: () => Promise.resolve('down') })
    await applyKnocks((await handleUpdate(file(5, 'a.md'), down)).knocks, down)
    const failing = deps(store)
    await handleCron(failing)
    expect(failing.knocked).toEqual([])
    expect((await store.listByUpdate(5))[0]?.status).toBe('waiting')
    const up = deps(store, { download: md })
    await handleCron(up)
    expect(up.knocks).toEqual([
      {
        jobId: `5:${await textItemId('# Fejezet')}`,
        videoId: await textItemId('# Fejezet'),
        url: '',
        text: '# Fejezet',
        title: 'a',
      },
    ])
    expect(downloads).toBe(2)
  })

  it('a ready visszahívás után a szöveg kiürül, és a szöveg megvan üzenet a gombokkal jön; failed után is üres', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(5, '/scan Kubernetes alapok'), d)
    const id = await textItemId('Kubernetes alapok')
    await handleCallback(`5:${id}`, { status: 'ready', title: 'Kubernetes alapok' }, d)
    expect((await store.listByUpdate(5))[0]?.text).toBeNull()
    expect(d.sent.at(-1)).toBe('Kubernetes alapok. A szöveg megvan.')
    expect(d.keyboards.at(-1)).toEqual(recipeKeyboard(`5:${id}`))
    await handleUpdate(command(6, '/scan Másik szöveg'), d)
    const other = await textItemId('Másik szöveg')
    await handleCallback(`6:${other}`, { status: 'failed', error: 'Ismeretlen nyelv.' }, d)
    expect((await store.listByUpdate(6))[0]?.text).toBeNull()
  })

  it('a kész futás linkje /notes/t-…/summary', async () => {
    const id = await textItemId(BODY)
    expect(runReadyMessage('Cím', { jobId: `5:${id}`, recipes: ['summary'], lang: null }, 'https://worker.test')).toBe(
      `Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/${id}/summary`,
    )
  })
})
