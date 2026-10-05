import { REJECTED_SECRET, alreadyLine, linesForMessage, queuedLine, readyLine, waitingLine } from './plan.js'
import type { JobRow, JobStore } from './store.js'

export interface PlannedKnock {
  jobId: string
  videoId: string
  url: string
}

export interface WorkerDeps {
  ownerChatId: string
  store: JobStore
  now: () => number
  knock: (job: PlannedKnock) => Promise<202 | 409 | 401 | 'down'>
  send: (text: string) => Promise<boolean>
}

type KnockResult = 202 | 409 | 401 | 'down'

async function findRow(store: JobStore, jobId: string): Promise<JobRow | null> {
  const head = jobId.split(':')[0]
  if (head === undefined || !/^\d+$/.test(head)) return null
  const rows = await store.listByUpdate(Number(head))
  return rows.find((row) => row.jobId === jobId) ?? null
}

async function settle(row: JobRow, result: KnockResult, deps: WorkerDeps): Promise<void> {
  if (result === 409) return
  if (result === 202) {
    row.status = 'accepted'
    row.acceptedAt = deps.now()
    await deps.store.save(row)
    return
  }
  if (result === 401) {
    const sent = await deps.send(REJECTED_SECRET)
    if (!sent) return
    row.status = 'failed'
    row.error = REJECTED_SECRET
    await deps.store.save(row)
    return
  }
  if (row.status === 'waiting') return
  const sent = await deps.send(waitingLine(row.videoId))
  if (!sent) return
  row.status = 'waiting'
  await deps.store.save(row)
}

export async function handleUpdate(
  update: { update_id: number; message?: { message_id: number; chat: { id: number }; text?: string } },
  deps: WorkerDeps,
): Promise<{ status: number; knocks: PlannedKnock[] }> {
  const message = update.message
  if (!message || String(message.chat.id) !== deps.ownerChatId) return { status: 200, knocks: [] }
  if ((await deps.store.listByUpdate(update.update_id)).length > 0) return { status: 200, knocks: [] }
  const planned = linesForMessage(message.text ?? '', [])
  const lines = [...planned.lines]
  const knocks: PlannedKnock[] = []
  for (const job of planned.jobs) {
    const active = await deps.store.activeByVideo(job.videoId)
    if (active) {
      const at = lines.indexOf(queuedLine(job.videoId))
      if (at !== -1) lines[at] = alreadyLine(job.videoId)
      continue
    }
    const row: JobRow = {
      jobId: `${update.update_id}:${job.videoId}`,
      updateId: update.update_id,
      chatId: String(message.chat.id),
      messageId: message.message_id,
      videoId: job.videoId,
      url: job.url,
      status: 'queued',
      error: null,
      title: null,
      notifiedReady: false,
      acceptedAt: null,
    }
    await deps.store.insert(row)
    knocks.push({ jobId: row.jobId, videoId: row.videoId, url: row.url })
  }
  if (lines.length > 0) await deps.send(lines.join('\n'))
  return { status: 200, knocks }
}

export async function applyKnocks(knocks: readonly PlannedKnock[], deps: WorkerDeps): Promise<void> {
  for (const knock of knocks) {
    const row = await findRow(deps.store, knock.jobId)
    if (!row) continue
    await settle(row, await deps.knock(knock), deps)
  }
}

export async function handleCallback(
  jobId: string,
  body: { status: 'ready'; title: string } | { status: 'failed'; error: string },
  deps: WorkerDeps,
): Promise<number> {
  const row = await findRow(deps.store, jobId)
  if (!row) return 200
  if (body.status === 'failed') {
    const sent = await deps.send(body.error)
    if (!sent) return 200
    row.status = 'failed'
    row.error = body.error
    await deps.store.save(row)
    return 200
  }
  if (row.notifiedReady) return 200
  row.title = body.title
  const sent = await deps.send(readyLine(body.title))
  if (!sent) {
    await deps.store.save(row)
    return 200
  }
  row.status = 'ready'
  row.notifiedReady = true
  await deps.store.save(row)
  return 200
}

export async function handleCron(deps: WorkerDeps): Promise<void> {
  for (const row of await deps.store.due(deps.now())) {
    await settle(row, await deps.knock({ jobId: row.jobId, videoId: row.videoId, url: row.url }), deps)
  }
}
