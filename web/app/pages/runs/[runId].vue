<script setup lang="ts">
const route = useRoute()
const runId = computed(() => String(route.params.runId))
const { data, error, refresh } = await useFetch(
  () => `/api/runs/${encodeURIComponent(runId.value)}`,
)

// Futó futásnál az események SSE-n jönnek; lezártnál a teljes napló már a válaszban van.
const running = computed(() => data.value?.summary.status === 'running')
const { lines: liveLines, state: liveState, live, finished } = useRunStream(runId, running)

// A folyam végén a lezárt állapot a szerverről frissül (állapot, riport).
watch(finished, (value) => {
  if (value) void refresh()
})

const state = computed(() => liveState.value ?? data.value?.state ?? null)
const lines = computed(() => (liveLines.value.length > 0 ? liveLines.value : (data.value?.lines ?? [])))
const aborted = computed(() => state.value?.aborted ?? null)
const failures = computed(() => state.value?.recentFailures ?? [])
</script>

<template>
  <div class="space-y-6">
    <NuxtLink to="/runs" class="text-sm underline">← Futások</NuxtLink>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <header class="flex flex-wrap items-center gap-3">
        <h1 class="font-mono text-xl font-semibold">{{ data.summary.command ?? data.summary.runId }}</h1>
        <UBadge :color="runStatusColor(data.summary.status)" variant="subtle">
          {{ runStatusLabel(data.summary.status) }}
        </UBadge>
        <UBadge v-if="live" color="info" variant="outline">élő</UBadge>
        <span class="text-sm text-muted">
          {{ formatDate(data.summary.startedAt) }} · {{ formatDuration(data.summary.durationMs) }}
        </span>
      </header>

      <RunStatePanel v-if="state" :state="state" />

      <UAlert
        v-if="aborted"
        color="warning"
        variant="subtle"
        title="A plafon miatt megállt"
        :description="aborted"
      />
      <UAlert v-if="failures.length > 0" color="error" variant="subtle" title="Friss hibák">
        <template #description>
          <ul class="space-y-1">
            <li v-for="failure in failures" :key="`${failure.itemId}-${failure.kind}`">
              {{ failure.itemId }} ({{ kindLabel(failure.kind) }}): {{ failure.error }}
            </li>
          </ul>
        </template>
      </UAlert>

      <section class="space-y-2">
        <h2 class="text-lg font-semibold">Idővonal</h2>
        <p v-if="data.summary.invalid > 0" class="text-sm text-warning">
          {{ data.summary.invalid }} értelmezhetetlen naplósor kimaradt.
        </p>
        <ol class="space-y-1 font-mono text-xs">
          <li v-for="(line, index) in lines" :key="index">
            <span class="text-muted">{{ line.at ? formatTime(line.at) : '–' }}</span>
            {{ line.type }}
            <span class="text-muted">{{ lineDetail(line) }}</span>
          </li>
        </ol>
      </section>

      <section v-if="data.reportHtml" class="space-y-2">
        <h2 class="text-lg font-semibold">Riport</h2>
        <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="note" v-html="data.reportHtml" />
      </section>
    </template>
  </div>
</template>
