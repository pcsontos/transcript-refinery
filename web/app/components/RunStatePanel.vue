<script setup lang="ts">
const props = defineProps<{
  state: {
    units: number | null
    started: number
    succeeded: number
    failed: number
    estimate: { items: number; usd: number; limitUsd: number } | null
    spentUsd: number
    current: { itemId: string; title: string; step: string } | null
    lastScore: { itemId: string; recipe: string; score: number; gaps: number } | null
    retries: number
    lastEventAt: string | null
  }
}>()

// Az utolsó esemény óta eltelt idő: egy újrahasznosított pid ritkán hamis
// „fut"-ot adhat, ez a szám mutatja meg, ha a futás valójában áll.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const sinceLast = computed(() =>
  props.state.lastEventAt === null
    ? '–'
    : formatDuration(now.value - Date.parse(props.state.lastEventAt)),
)
</script>

<template>
  <section class="grid gap-4 md:grid-cols-3">
    <UCard>
      <template #header>Haladás</template>
      <p class="text-sm">{{ state.started }} / {{ state.units ?? '?' }} egység elkezdve</p>
      <UProgress :model-value="state.started" :max="Math.max(state.units ?? 0, 1)" class="mt-2" />
      <p class="mt-2 text-sm">
        {{ state.succeeded }} sikeres · {{ state.failed }} hibás · {{ state.retries }} újrapróba
      </p>
    </UCard>

    <UCard>
      <template #header>Költés</template>
      <p class="text-sm">
        {{ formatUsd(state.spentUsd) }}
        <template v-if="state.estimate">/ plafon {{ formatUsd(state.estimate.limitUsd) }}</template>
      </p>
      <template v-if="state.estimate">
        <UProgress
          :model-value="Math.min(state.spentUsd, state.estimate.limitUsd)"
          :max="state.estimate.limitUsd"
          class="mt-2"
        />
        <p class="mt-2 text-xs text-muted">
          becslés: {{ formatUsd(state.estimate.usd) }}, {{ state.estimate.items }} egység
        </p>
      </template>
    </UCard>

    <UCard>
      <template #header>Most</template>
      <p v-if="state.current" class="text-sm">{{ state.current.title }} — {{ state.current.step }}</p>
      <p v-else class="text-sm text-muted">Nincs feldolgozás alatt álló elem.</p>
      <p v-if="state.lastScore" class="mt-2 text-sm">
        utolsó pontszám: {{ formatScore(state.lastScore.score) }}
        ({{ kindLabel(state.lastScore.recipe) }}, {{ state.lastScore.gaps }} hiány)
      </p>
      <ClientOnly>
        <p class="mt-2 text-xs text-muted">utolsó esemény: {{ sinceLast }} ezelőtt</p>
      </ClientOnly>
    </UCard>
  </section>
</template>
