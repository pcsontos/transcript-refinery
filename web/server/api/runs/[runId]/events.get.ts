import { findRun, followRunLog, isPidAlive, parseEventId } from 'transcript-refinery'

/**
 * Egy futás eseményei SSE-n. Az üzenet `id`-je a sor utáni bájt-offset: a
 * böngésző újracsatlakozáskor ezt küldi vissza (`Last-Event-ID`), és a követés
 * onnan folytatódik. A követés logikája a magban él (`followRunLog`), ez az
 * útvonal csak továbbít.
 */
export default defineEventHandler(async (event) => {
  const cfg = await useRefineryConfig()
  const files = findRun(cfg.logsDir, getRouterParam(event, 'runId', { decode: true }) ?? '')
  if (!files) throw createError({ statusCode: 404, message: 'Nincs ilyen futás.' })

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())

  const forward = async (): Promise<void> => {
    try {
      const followed = followRunLog(files.logPath, {
        fromOffset: parseEventId(getHeader(event, 'last-event-id')),
        intervalMs: 500,
        isAlive: isPidAlive,
        signal: controller.signal,
      })
      for await (const { line, end, state } of followed) {
        await stream.push({ id: String(end), data: JSON.stringify({ line, state }) })
      }
      // A lezárt folyamra a böngésző EventSource-a újra és újra csatlakozna: az
      // `end` esemény mondja meg neki, hogy vége.
      await stream.push({ event: 'end', data: '{}' })
    } catch (error) {
      // A bontott kapcsolat nem hiba; minden más a szervernaplóba kerül.
      if (!controller.signal.aborted) {
        console.error(`A futásnapló követése megszakadt: ${(error as Error).message}`)
      }
    } finally {
      await stream.close()
    }
  }
  void forward()
  return stream.send()
})
