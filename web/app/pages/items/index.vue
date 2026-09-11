<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const { data, error } = await useFetch('/api/items')
const NuxtLink = resolveComponent('NuxtLink')
const UBadge = resolveComponent('UBadge')

type Row = NonNullable<typeof data.value>[number]
type Cell = Row['cells'][string]

const ALL = 'mind'
const STATUS_LABELS = [ALL, 'kész', 'hibás', 'hátra']
const STATUS_OF: Record<string, string> = { kész: 'done', hibás: 'failed', hátra: 'pending' }
const SORTS = ['felderítés', 'pontszám (gyengébb elöl)', 'költség', 'frissítés']

const rows = computed<Row[]>(() => data.value ?? [])
const kinds = computed(() => Object.keys(rows.value[0]?.cells ?? {}))
const sources = computed(() => [ALL, ...new Set(rows.value.map((row) => row.source))])
const channels = computed(() => [
  ALL,
  ...new Set(rows.value.flatMap((row) => (row.channel ? [row.channel] : []))),
])

const source = ref(ALL)
const channel = ref(ALL)
const kind = ref('summary')
const status = ref(ALL)
const sort = ref(SORTS[0] ?? '')
const onlyBelow = ref(false)

const cellOf = (row: Row): Cell | undefined => row.cells[kind.value]

const visible = computed(() => {
  const selected = rows.value.filter((row) => {
    const cell = cellOf(row)
    if (source.value !== ALL && row.source !== source.value) return false
    if (channel.value !== ALL && row.channel !== channel.value) return false
    if (status.value !== ALL && cell?.status !== STATUS_OF[status.value]) return false
    if (onlyBelow.value && !cell?.belowThreshold) return false
    return true
  })
  if (sort.value === SORTS[1]) {
    return [...selected].sort((a, b) => (cellOf(a)?.score ?? 2) - (cellOf(b)?.score ?? 2))
  }
  if (sort.value === SORTS[2]) {
    return [...selected].sort((a, b) => (cellOf(b)?.costUsd ?? 0) - (cellOf(a)?.costUsd ?? 0))
  }
  if (sort.value === SORTS[3]) {
    return [...selected].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }
  return selected
})

function cellBadge(cell: Cell | undefined) {
  if (!cell || cell.status === 'pending') return '–'
  if (cell.status === 'failed') return h(UBadge, { color: 'error', variant: 'subtle' }, () => '✗')
  const label = cell.score === null ? '✓' : `✓ ${formatScore(cell.score)}`
  return h(
    UBadge,
    { color: cell.belowThreshold ? 'warning' : 'success', variant: 'subtle' },
    () => label,
  )
}

const captionLabel = (value: Row['captionSource']): string =>
  value === 'auto' ? 'automatikus' : value === 'creator' ? 'szerzői' : '–'

const columns = computed<TableColumn<Row>[]>(() => [
  {
    accessorKey: 'title',
    header: 'Cím',
    cell: ({ row }) =>
      h(
        NuxtLink,
        { to: `/items/${encodeURIComponent(row.original.itemId)}`, class: 'underline' },
        () => row.original.title,
      ),
  },
  { accessorKey: 'source', header: 'Forrás' },
  { accessorKey: 'channel', header: 'Csatorna', cell: ({ row }) => row.original.channel ?? '–' },
  {
    accessorKey: 'captionSource',
    header: 'Felirat',
    cell: ({ row }) => captionLabel(row.original.captionSource),
  },
  ...kinds.value.map(
    (k): TableColumn<Row> => ({
      id: k,
      header: kindLabel(k),
      cell: ({ row }) => cellBadge(row.original.cells[k]),
    }),
  ),
])
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Elemek</h1>
    <ErrorAlert v-if="error" :error="error" />
    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <USelect v-model="source" :items="sources" class="w-40" aria-label="Forrás" />
        <USelect v-model="channel" :items="channels" class="w-48" aria-label="Csatorna" />
        <USelect v-model="kind" :items="kinds" class="w-40" aria-label="Műtermék-típus" />
        <USelect v-model="status" :items="STATUS_LABELS" class="w-32" aria-label="Állapot" />
        <USelect v-model="sort" :items="SORTS" class="w-56" aria-label="Rendezés" />
        <UCheckbox v-model="onlyBelow" label="csak a küszöb alattiak" />
      </div>
      <p class="text-sm text-muted">{{ visible.length }} / {{ rows.length }} elem</p>
      <UTable :data="visible" :columns="columns" />
    </template>
  </div>
</template>
