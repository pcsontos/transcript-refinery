<script setup lang="ts">
const { data, error } = await useFetch('/api/failures')
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Hibák</h1>
    <ErrorAlert v-if="error" :error="error" />
    <p v-else-if="data && data.length === 0" class="text-muted">Nincs hibás műtermék.</p>
    <UCard v-for="group in data ?? []" :key="group.message">
      <template #header>
        <div class="flex items-start justify-between gap-3">
          <span class="font-medium">{{ group.message }}</span>
          <UBadge color="error" variant="subtle">{{ group.count }}</UBadge>
        </div>
      </template>
      <ul class="space-y-1 text-sm">
        <li v-for="entry in group.items" :key="`${entry.itemId}-${entry.kind}`">
          <NuxtLink :to="`/items/${encodeURIComponent(entry.itemId)}`" class="underline">
            {{ entry.title }}
          </NuxtLink>
          <span class="text-muted"> · {{ kindLabel(entry.kind) }}</span>
        </li>
      </ul>
    </UCard>
  </div>
</template>
