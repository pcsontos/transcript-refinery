<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

const route = useRoute()
const itemId = computed(() => String(route.params.itemId))
const { data, error } = await useFetch(() => `/api/items/${encodeURIComponent(itemId.value)}`)

type Artifact = NonNullable<typeof data.value>['artifacts'][number]

const transcript = computed(() => data.value?.artifacts.find((a) => a.kind === 'transcript') ?? null)
const recipes = computed(() => data.value?.artifacts.filter((a) => a.kind !== 'transcript') ?? [])
const tabs = computed<TabsItem[]>(() =>
  recipes.value.map((a) => ({ label: kindLabel(a.kind), value: a.kind })),
)
const artifactOf = (value: TabsItem['value']): Artifact | undefined =>
  recipes.value.find((a) => a.kind === value)

const captionText = computed(() => {
  const value = data.value?.item.captionSource
  return value === 'auto' ? 'automatikus felirat' : value === 'creator' ? 'szerzői felirat' : 'még nincs átirat'
})
</script>

<template>
  <div class="space-y-6">
    <NuxtLink to="/items" class="text-sm underline">← Elemek</NuxtLink>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <header class="space-y-1">
        <h1 class="text-2xl font-semibold">{{ data.item.title }}</h1>
        <p class="text-sm text-muted">
          {{ data.item.source }} · {{ data.item.channel ?? 'csatorna nélkül' }} · {{ captionText }}
          <template v-if="data.item.wordsRaw !== null">
            · {{ data.item.wordsRaw }} → {{ data.item.wordsNormalized }} szó
          </template>
        </p>
        <UAlert
          v-if="!data.item.discovered"
          color="warning"
          variant="subtle"
          title="A felirat már nincs a forrásmappában"
        />
      </header>

      <p v-if="data.artifacts.length === 0" class="text-muted">
        Ehhez az elemhez még nincs rögzített műtermék.
      </p>

      <UTabs v-if="tabs.length > 0" :items="tabs" :default-value="tabs[0]?.value" class="w-full">
        <template #content="{ item }">
          <ArtifactPanel
            v-if="artifactOf(item.value)"
            :artifact="artifactOf(item.value)!"
            :transcript-html="transcript?.html ?? null"
          />
        </template>
      </UTabs>

      <section v-else-if="transcript" class="space-y-2">
        <h2 class="font-medium">Normalizált átirat</h2>
        <!-- A szerver html: false-szal renderel: nyers HTML nem jut át. -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="transcript.html" class="note" v-html="transcript.html" />
      </section>
    </template>
  </div>
</template>
