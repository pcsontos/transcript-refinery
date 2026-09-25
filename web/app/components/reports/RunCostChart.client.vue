<script setup lang="ts">
import { GroupedBar } from '@unovis/ts'
import { VisAxis, VisGroupedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import type { RunCostPoint } from 'transcript-refinery'

const props = defineProps<{ runs: RunCostPoint[] }>()

const x = (_: RunCostPoint, i: number): number => i
const y = [(d: RunCostPoint) => d.spentUsd, (d: RunCostPoint) => d.estimateUsd ?? 0]
const color = (_: RunCostPoint, i: number): string =>
  i === 0 ? 'var(--viz-1)' : 'var(--viz-estimate)'

const tickFormat = (i: number): string =>
  barTickLabel(
    props.runs.map((run) => run.startedAt?.slice(5, 10) ?? ''),
    i,
  )

function tooltip(d: RunCostPoint): string {
  const ratio =
    d.estimateUsd !== null && d.estimateUsd > 0
      ? ` · ${(d.spentUsd / d.estimateUsd).toFixed(2)}×`
      : ''
  return [
    `<strong>${formatDate(d.startedAt)}</strong>`,
    `<code>${escapeHtml(d.command ?? d.runId)}</code>`,
    `tényleges: ${formatUsd(d.spentUsd)}`,
    `becsült: ${d.estimateUsd === null ? '–' : formatUsd(d.estimateUsd)}${ratio}`,
    `állapot: ${runStatusLabel(d.status)}`,
  ].join('<br>')
}

const events = {
  [GroupedBar.selectors.bar]: {
    click: (d: RunCostPoint) => navigateTo(`/runs/${d.runId}`),
  },
}
</script>

<template>
  <div>
    <div class="mb-2 flex gap-4 text-sm text-muted">
      <span class="flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm" style="background: var(--viz-1)" />
        tényleges
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block size-3 rounded-sm" style="background: var(--viz-estimate)" />
        becsült
      </span>
    </div>
    <VisXYContainer :data="runs" :height="260">
      <VisGroupedBar
        :x="x"
        :y="y"
        :color="color"
        :rounded-corners="4"
        :group-padding="0.2"
        :bar-padding="0.1"
        :events="events"
        cursor="pointer"
      />
      <VisAxis type="x" :tick-format="tickFormat" :num-ticks="Math.min(runs.length, 10)" :grid-line="false" />
      <VisAxis type="y" :tick-format="(v: number) => `$${v.toFixed(2)}`" />
      <VisTooltip :triggers="{ [GroupedBar.selectors.bar]: tooltip }" />
    </VisXYContainer>
  </div>
</template>
