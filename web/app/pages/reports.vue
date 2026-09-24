<script setup lang="ts">
import type { ChannelReport } from 'transcript-refinery'

const { data, error } = await useFetch('/api/reports')
const toast = useToast()

const channelsWithCost = computed(() =>
  (data.value?.channels ?? [])
    .filter((c) => c.channel !== null && (c.costUsd ?? 0) > 0)
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0)),
)

const quality = computed(() =>
  (data.value?.channels ?? [])
    .filter((c) => c.quality.scored > 0)
    .sort(
      (a, b) =>
        b.quality.below / b.quality.scored - a.quality.below / a.quality.scored ||
        b.quality.scored - a.quality.scored,
    ),
)

const channelName = (c: ChannelReport): string => c.channel ?? '(csatorna nélkül)'

const itemsLink = (c: ChannelReport, kind: string): string =>
  `/items?${new URLSearchParams({ channel: c.channel ?? '', kind }).toString()}`

async function copy(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    toast.add({ title: 'Parancs a vágólapon', description: command, color: 'success' })
  } catch {
    toast.add({ title: 'A vágólapra másolás nem sikerült', description: command, color: 'error' })
  }
}

const captionText = (c: ChannelReport): string =>
  `szerzői ${c.captions.creator} · automatikus ${c.captions.auto}`
</script>

<template>
  <div class="space-y-8">
    <h1 class="text-2xl font-semibold">Riport</h1>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else-if="data">
      <UAlert
        v-if="!data.hasState"
        color="neutral"
        variant="subtle"
        title="Még nincs feldolgozott elem"
        :description="`${data.kpis.videos} felderített elem vár feldolgozásra.`"
      />

      <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <UCard>
          <p class="text-xs text-muted uppercase">Videók</p>
          <p class="text-2xl font-semibold">{{ data.kpis.videos }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Csatornák</p>
          <p class="text-2xl font-semibold">{{ data.kpis.channels }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Szószám</p>
          <p class="text-2xl font-semibold">{{ formatWords(data.kpis.words) }}</p>
          <p class="text-xs text-muted">{{ data.kpis.transcribed }} átiratolt elemen</p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">Tényleges költés</p>
          <p class="text-2xl font-semibold">{{ formatUsd(data.kpis.spentUsd) }}</p>
          <p class="text-xs text-muted">
            a sikeres finomítások minden futásban, az újrafuttatásokkal együtt; a hibára futott
            hívások nélkül
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted uppercase">A vault-tartalom költsége</p>
          <p class="text-2xl font-semibold">{{ formatUsd(data.kpis.vaultCostUsd) }}</p>
          <p class="text-xs text-muted">műtermékenként az utolsó futás</p>
          <p v-if="data.kpis.missingCost > 0" class="text-xs text-muted">
            {{ data.kpis.missingCost }} műterméknél nincs rögzített költség
          </p>
        </UCard>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Költés futásonként</h2>
        <p v-if="data.runs.length === 0" class="text-muted">Még nincs költséggel járó futás.</p>
        <template v-else>
          <ClientOnly>
            <ReportsRunCostChart :runs="data.runs" />
            <template #fallback>
              <p class="text-muted">Grafikon betöltése…</p>
            </template>
          </ClientOnly>
          <UCollapsible>
            <UButton variant="link" label="Adatok táblázatban" icon="i-lucide-table" />
            <template #content>
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left">
                    <th class="py-1 pr-4">indulás</th>
                    <th class="py-1 pr-4">parancs</th>
                    <th class="py-1 pr-4">tényleges</th>
                    <th class="py-1 pr-4">becsült</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="run in data.runs" :key="run.runId" class="border-t border-default">
                    <td class="py-1 pr-4">
                      <NuxtLink :to="`/runs/${run.runId}`" class="underline">
                        {{ formatDate(run.startedAt) }}
                      </NuxtLink>
                    </td>
                    <td class="py-1 pr-4 font-mono">{{ run.command ?? '–' }}</td>
                    <td class="py-1 pr-4">{{ formatUsd(run.spentUsd) }}</td>
                    <td class="py-1 pr-4">
                      {{ run.estimateUsd === null ? '–' : formatUsd(run.estimateUsd) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </UCollapsible>
        </template>
        <p v-if="data.invalidLogLines > 0" class="text-sm text-muted">
          {{ data.invalidLogLines }} értelmezhetetlen naplósor kimaradt.
        </p>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Költség csatornánként</h2>
        <p v-if="channelsWithCost.length === 0" class="text-muted">
          Még nincs rögzített költség.
        </p>
        <template v-else>
          <ClientOnly>
            <ReportsChannelCostChart :channels="channelsWithCost" :series="data.series" />
            <template #fallback>
              <p class="text-muted">Grafikon betöltése…</p>
            </template>
          </ClientOnly>
          <UCollapsible>
            <UButton variant="link" label="Adatok táblázatban" icon="i-lucide-table" />
            <template #content>
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left">
                      <th class="py-1 pr-4">csatorna</th>
                      <th v-for="s in data.series" :key="s" class="py-1 pr-4">
                        {{ seriesLabel(s) }}
                      </th>
                      <th class="py-1 pr-4">összesen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="c in channelsWithCost"
                      :key="channelName(c)"
                      class="border-t border-default"
                    >
                      <td class="py-1 pr-4">{{ channelName(c) }}</td>
                      <td v-for="s in data.series" :key="s" class="py-1 pr-4">
                        {{ formatUsd(c.costBySeries[s] ?? 0) }}
                      </td>
                      <td class="py-1 pr-4">{{ formatUsd(c.costUsd ?? 0) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </UCollapsible>
        </template>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Minőség csatornánként</h2>
        <p v-if="quality.length === 0" class="text-muted">Még nincs pontozott jegyzet.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="py-1 pr-4">csatorna</th>
                <th class="py-1 pr-4">átlagpontszám</th>
                <th class="py-1 pr-4">pontozott</th>
                <th class="py-1 pr-4">küszöb alatt</th>
                <th class="py-1 pr-4">arány</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in quality" :key="channelName(c)" class="border-t border-default">
                <td class="py-1 pr-4">{{ channelName(c) }}</td>
                <td class="py-1 pr-4">{{ formatScore(c.quality.meanScore) }}</td>
                <td class="py-1 pr-4">{{ c.quality.scored }}</td>
                <td class="py-1 pr-4">{{ c.quality.below }}</td>
                <td class="py-1 pr-4">{{ formatRatio(c.quality.below, c.quality.scored) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-semibold">Csatorna-katalógus</h2>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="A parancs valódi költséggel fut; a run indításkor becslést mutat."
          description="A refinery globális parancsot feltételezi — amíg nincs telepítve, cseréld node dist/cli.js-re, és a repó gyökeréből futtasd (#72)."
        />
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="py-1 pr-4">csatorna</th>
                <th class="py-1 pr-4">videó</th>
                <th class="py-1 pr-4">szószám</th>
                <th class="py-1 pr-4">nyelv</th>
                <th class="py-1 pr-4">felirat</th>
                <th class="py-1 pr-4">költség</th>
                <th v-for="kind in data.kinds" :key="kind" class="py-1 pr-4">
                  {{ kindLabel(kind) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in data.channels" :key="channelName(c)" class="border-t border-default">
                <td class="py-1 pr-4">{{ channelName(c) }}</td>
                <td class="py-1 pr-4">{{ c.videos }}</td>
                <td class="py-1 pr-4">{{ formatWords(c.words) }}</td>
                <td class="py-1 pr-4">
                  {{ c.languages.map((l) => l.code).join(', ') || '–' }}
                </td>
                <td class="py-1 pr-4 whitespace-nowrap">{{ captionText(c) }}</td>
                <td class="py-1 pr-4">{{ c.costUsd === null ? '–' : formatUsd(c.costUsd) }}</td>
                <td v-for="kind in data.kinds" :key="kind" class="py-1 pr-4 whitespace-nowrap">
                  <template v-if="c.coverage[kind]">
                    <NuxtLink
                      v-if="c.channel !== null"
                      :to="itemsLink(c, kind)"
                      class="underline"
                    >
                      {{ coverageText(c.coverage[kind]) }}
                    </NuxtLink>
                    <span v-else>{{ coverageText(c.coverage[kind]) }}</span>
                    <UButton
                      v-if="c.coverage[kind].command"
                      size="xs"
                      variant="ghost"
                      icon="i-lucide-clipboard-copy"
                      :aria-label="`Parancs másolása: ${c.coverage[kind].command}`"
                      :title="c.coverage[kind].command"
                      @click="copy(c.coverage[kind].command)"
                    />
                    <UTooltip
                      v-else-if="c.channel === null && c.coverage[kind].done < c.coverage[kind].total"
                      text="A --channel metaadat nélküli elemre nem illik."
                    >
                      <UIcon name="i-lucide-info" class="ml-1 align-middle text-muted" />
                    </UTooltip>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="grid gap-6 md:grid-cols-2">
        <div class="space-y-3">
          <h2 class="text-lg font-semibold">Legdrágább videók</h2>
          <p v-if="data.topCost.length === 0" class="text-muted">Még nincs rögzített költség.</p>
          <ol v-else class="space-y-1 text-sm">
            <li v-for="item in data.topCost" :key="item.itemId" class="flex justify-between gap-3">
              <NuxtLink :to="`/items/${encodeURIComponent(item.itemId)}`" class="underline">
                {{ item.title }}
              </NuxtLink>
              <span class="whitespace-nowrap text-muted">{{ formatUsd(item.value) }}</span>
            </li>
          </ol>
        </div>
        <div class="space-y-3">
          <h2 class="text-lg font-semibold">Leghosszabb videók</h2>
          <p v-if="data.topLong.length === 0" class="text-muted">Még nincs átiratolt elem.</p>
          <ol v-else class="space-y-1 text-sm">
            <li v-for="item in data.topLong" :key="item.itemId" class="flex justify-between gap-3">
              <NuxtLink :to="`/items/${encodeURIComponent(item.itemId)}`" class="underline">
                {{ item.title }}
              </NuxtLink>
              <span class="whitespace-nowrap text-muted">{{ formatWords(item.value) }} szó</span>
            </li>
          </ol>
        </div>
      </section>
    </template>
  </div>
</template>
