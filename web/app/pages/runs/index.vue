<script setup lang="ts">
const { data, error } = await useFetch('/api/runs')
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Futások</h1>
    <ErrorAlert v-if="error" :error="error" />
    <p v-else-if="data && data.length === 0" class="text-muted">Még nincs futásnapló.</p>
    <div v-else-if="data" class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left">
            <th class="py-1 pr-4">indulás</th>
            <th class="py-1 pr-4">parancs</th>
            <th class="py-1 pr-4">állapot</th>
            <th class="py-1 pr-4">egység</th>
            <th class="py-1 pr-4">sikeres / hibás</th>
            <th class="py-1 pr-4">költés</th>
            <th class="py-1 pr-4">időtartam</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in data" :key="run.runId" class="border-t border-default">
            <td class="py-1 pr-4">
              <NuxtLink :to="`/runs/${run.runId}`" class="underline">
                {{ run.startedAt ? formatDate(run.startedAt) : run.runId }}
              </NuxtLink>
            </td>
            <td class="py-1 pr-4 font-mono">{{ run.command ?? '–' }}</td>
            <td class="py-1 pr-4">
              <UBadge :color="runStatusColor(run.status)" variant="subtle">
                {{ runStatusLabel(run.status) }}
              </UBadge>
            </td>
            <td class="py-1 pr-4">{{ run.units ?? '–' }}</td>
            <td class="py-1 pr-4">{{ run.succeeded }} / {{ run.failed }}</td>
            <td class="py-1 pr-4">{{ formatUsd(run.spentUsd) }}</td>
            <td class="py-1 pr-4">{{ formatDuration(run.durationMs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
