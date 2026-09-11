import type { LiveRunState, RunLogLine } from 'transcript-refinery'

/**
 * Egy futás eseményei SSE-n. A böngésző `EventSource`-a a megszakadt kapcsolatot
 * magától újraépíti, és a `Last-Event-ID`-vel ott folytatja, ahol abbahagyta —
 * esemény nem ismétlődik. Az `end` esemény után viszont lezárjuk, különben a
 * lezárt folyamra újra és újra csatlakozna.
 */
export function useRunStream(runId: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean>) {
  const lines = ref<RunLogLine[]>([])
  const state = ref<LiveRunState | null>(null)
  const live = ref(false)
  const finished = ref(false)
  let source: EventSource | null = null

  function stop(): void {
    source?.close()
    source = null
    live.value = false
  }

  function start(): void {
    stop()
    lines.value = []
    state.value = null
    finished.value = false
    source = new EventSource(`/api/runs/${encodeURIComponent(toValue(runId))}/events`)
    source.onopen = () => {
      live.value = true
    }
    source.onmessage = (message: MessageEvent<string>) => {
      const data = JSON.parse(message.data) as { line: RunLogLine; state: LiveRunState }
      lines.value.push(data.line)
      state.value = data.state
    }
    source.addEventListener('end', () => {
      stop()
      finished.value = true
    })
  }

  onMounted(() => {
    if (toValue(enabled)) start()
  })
  onBeforeUnmount(stop)
  return { lines, state, live, finished }
}
