<script setup lang="ts">
const { data, error } = await useFetch('/api/overview')

const sources = computed(() => [
  ...new Set(
    (data.value?.corpus ?? []).flatMap((entry) => entry.status.bySource.map((s) => s.source)),
  ),
])

function sourceCell(
  rows: { source: string; done: number; failed: number; pending: number }[],
  source: string,
): string {
  const row = rows.find((r) => r.source === source)
  return row ? `${row.done} / ${row.failed} / ${row.pending}` : '–'
}

function barHeight(count: number, buckets: number[]): number {
  const max = Math.max(...buckets)
  return max === 0 ? 0 : Math.round((count / max) * 100)
}
</script>

<template>
  <div class="space-y-8">
    <h1 class="text-2xl font-semibold">Áttekintő</h1>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <UAlert
        v-for="run in data.running"
        :key="run.runId"
        color="info"
        variant="subtle"
        icon="i-lucide-activity"
        :title="`Fut: ${run.command ?? run.runId}`"
      >
        <template #description>
          <NuxtLink :to="`/runs/${run.runId}`" class="underline">Élő követés</NuxtLink>
        </template>
      </UAlert>

      <UAlert
        v-if="!data.hasState"
        color="neutral"
        variant="subtle"
        title="Még nincs feldolgozott elem"
        :description="`${data.discovered} felderített elem vár feldolgozásra.`"
      />

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">A korpusz állapota</h2>
        <p class="text-sm text-muted">
          {{ data.discovered }} felderített elem · eddigi költés: {{ formatUsd(data.totalCostUsd) }}
        </p>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="py-1 pr-4">forrás</th>
                <th v-for="entry in data.corpus" :key="entry.kind" class="py-1 pr-4">
                  {{ kindLabel(entry.kind) }}
                  <span class="block text-xs font-normal text-muted">kész / hibás / hátra</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="source in sources" :key="source" class="border-t border-default">
                <td class="py-1 pr-4">{{ source }}</td>
                <td v-for="entry in data.corpus" :key="entry.kind" class="py-1 pr-4">
                  {{ sourceCell(entry.status.bySource, source) }}
                </td>
              </tr>
              <tr class="border-t border-default font-medium">
                <td class="py-1 pr-4">összesen</td>
                <td v-for="entry in data.corpus" :key="entry.kind" class="py-1 pr-4">
                  {{ entry.status.done }} / {{ entry.status.failed }} / {{ entry.status.pending }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Pontszámok receptenként</h2>
        <div class="grid gap-4 md:grid-cols-3">
          <UCard v-for="dist in data.scores" :key="dist.recipe">
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium">{{ kindLabel(dist.recipe) }}</span>
                <UBadge :color="dist.belowThreshold > 0 ? 'warning' : 'success'" variant="subtle">
                  {{ dist.belowThreshold }} a küszöb ({{ formatScore(dist.threshold) }}) alatt
                </UBadge>
              </div>
            </template>
            <div class="flex h-24 items-end gap-1">
              <div
                v-for="(count, index) in dist.buckets"
                :key="index"
                class="flex-1 rounded-t bg-primary"
                :style="{ height: `${barHeight(count, dist.buckets)}%` }"
                :title="`${(index / 10).toFixed(1)}–${((index + 1) / 10).toFixed(1)}: ${count}`"
              />
            </div>
            <p class="mt-2 text-xs text-muted">{{ dist.scored }} pontozott jegyzet</p>
          </UCard>
        </div>
      </section>

      <section v-if="data.queue" class="space-y-3">
        <h2 class="text-lg font-semibold">A feldolgozási sor</h2>
        <p v-if="data.queue.length === 0" class="text-sm text-muted">Nincs kipipált pár.</p>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="text-left">
              <th class="py-1 pr-4">recept</th>
              <th class="py-1 pr-4">kipipálva</th>
              <th class="py-1 pr-4">kész</th>
              <th class="py-1 pr-4">hibás</th>
              <th class="py-1 pr-4">hátra</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.queue" :key="row.recipe" class="border-t border-default">
              <td class="py-1 pr-4">{{ kindLabel(row.recipe) }}</td>
              <td class="py-1 pr-4">{{ row.checked }}</td>
              <td class="py-1 pr-4">{{ row.done }}</td>
              <td class="py-1 pr-4">{{ row.failed }}</td>
              <td class="py-1 pr-4">{{ row.pending }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
