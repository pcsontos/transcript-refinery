<script setup lang="ts">
import { StackedBar } from '@unovis/ts'
import { VisAxis, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import type { ChannelReport } from 'transcript-refinery'

const props = defineProps<{ channels: ChannelReport[]; series: string[] }>()

// A vízszintes sáv az első elemet alulra teszi: fordítva a legdrágább kerül felülre.
const rows = computed(() => [...props.channels].reverse())

const x = (_: ChannelReport, i: number): number => i
const y = computed(() => props.series.map((s) => (d: ChannelReport) => d.costBySeries[s] ?? 0))
const color = (_: ChannelReport, i: number): string => seriesColor(props.series[i] ?? '')

const tickFormat = (i: number): string => {
  const name = rows.value[Math.round(i)]?.channel ?? ''
  return name.length > 24 ? `${name.slice(0, 23)}…` : name
}

/**
 * A halmozott sáv szelete becsomagolva kapja az adatot: a sor a `datum`, a
 * rámutatott sorozat indexe a `stackIndex`.
 */
interface StackedDatum {
  datum: ChannelReport
  stackIndex: number
}

function tooltip({ datum: d, stackIndex }: StackedDatum): string {
  const hovered = props.series[stackIndex]
  const lines = props.series
    .filter((s) => (d.costBySeries[s] ?? 0) > 0)
    .map((s) => {
      const line = `${seriesLabel(s)}: ${formatUsd(d.costBySeries[s] ?? 0)}`
      return s === hovered ? `<strong>${line}</strong>` : line
    })
  const translations = Object.entries(d.translationCost)
    .filter(([, cost]) => cost > 0)
    .map(([kind, cost]) => `&nbsp;&nbsp;${escapeHtml(kind)}: ${formatUsd(cost)}`)
  return [`<strong>${escapeHtml(d.channel ?? '')}</strong>`, ...lines, ...translations].join('<br>')
}
</script>

<template>
  <div>
    <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      <span v-for="s in series" :key="s" class="flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm" :style="{ background: seriesColor(s) }" />
        {{ seriesLabel(s) }}
      </span>
    </div>
    <VisXYContainer :data="rows" :height="Math.max(160, channels.length * 28 + 40)">
      <VisStackedBar
        :x="x"
        :y="y"
        :color="color"
        orientation="horizontal"
        :rounded-corners="4"
        :bar-padding="0.25"
      />
      <VisAxis type="y" :tick-format="tickFormat" :num-ticks="channels.length" :grid-line="false" />
      <VisAxis type="x" :tick-format="(v: number) => `$${v.toFixed(2)}`" />
      <VisTooltip :triggers="{ [StackedBar.selectors.bar]: tooltip }" />
    </VisXYContainer>
  </div>
</template>
