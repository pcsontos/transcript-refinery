<script setup lang="ts">
defineProps<{
  artifact: {
    kind: string
    status: string
    path: string | null
    error: string | null
    iterations: number | null
    score: number | null
    costUsd: number | null
    model: string | null
    createdAt: string
    threshold: number | null
    gaps: string[] | null
    missingFile: boolean
    html: string | null
    obsidianUrl: string | null
  }
  transcriptHtml: string | null
}>()
</script>

<template>
  <div class="space-y-4 pt-4">
    <UAlert
      v-if="artifact.status === 'failed'"
      color="error"
      variant="subtle"
      title="A műtermék elbukott"
      :description="artifact.error ?? 'ismeretlen hiba'"
    />
    <template v-else>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <UBadge
          :color="
            artifact.score !== null && artifact.threshold !== null && artifact.score < artifact.threshold
              ? 'warning'
              : 'success'
          "
          variant="subtle"
        >
          pontszám {{ formatScore(artifact.score) }} · küszöb {{ formatScore(artifact.threshold) }}
        </UBadge>
        <span>{{ artifact.iterations ?? '–' }} generálás</span>
        <span>{{ artifact.costUsd === null ? '–' : formatUsd(artifact.costUsd) }}</span>
        <span>{{ artifact.model ?? '–' }}</span>
        <span class="text-muted">{{ formatDate(artifact.createdAt) }}</span>
        <UButton
          v-if="artifact.obsidianUrl"
          :to="artifact.obsidianUrl"
          external
          label="Megnyitás Obsidianban"
          icon="i-lucide-external-link"
          variant="soft"
          size="sm"
        />
      </div>

      <UCard>
        <template #header>A bíró hiánylistája</template>
        <p v-if="artifact.gaps === null" class="text-sm text-muted">
          Ehhez a jegyzethez nincs rögzített hiánylista.
        </p>
        <p v-else-if="artifact.gaps.length === 0" class="text-sm text-muted">
          A bíró nem nevezett meg hiányt.
        </p>
        <ul v-else class="list-disc space-y-1 pl-5 text-sm">
          <li v-for="(gap, index) in artifact.gaps" :key="index">{{ gap }}</li>
        </ul>
      </UCard>

      <UAlert
        v-if="artifact.missingFile"
        color="warning"
        variant="subtle"
        :title="`A jegyzet nem található: ${artifact.path}`"
      />

      <div class="grid gap-6 lg:grid-cols-2">
        <section class="space-y-2">
          <h3 class="font-medium">Jegyzet</h3>
          <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="artifact.html" class="note" v-html="artifact.html" />
        </section>
        <section class="space-y-2">
          <h3 class="font-medium">Normalizált átirat</h3>
          <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="transcriptHtml" class="note" v-html="transcriptHtml" />
          <p v-else class="text-sm text-muted">Nincs átirat-jegyzet.</p>
        </section>
      </div>
    </template>
  </div>
</template>
