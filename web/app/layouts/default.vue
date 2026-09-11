<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const items: NavigationMenuItem[] = [
  { label: 'Áttekintő', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Elemek', icon: 'i-lucide-list', to: '/items' },
  { label: 'Hibák', icon: 'i-lucide-triangle-alert', to: '/failures' },
  { label: 'Futások', icon: 'i-lucide-activity', to: '/runs' },
]
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-default">
      <UContainer class="flex items-center gap-6 py-2">
        <span class="font-semibold">Transcript Refinery</span>
        <UNavigationMenu orientation="horizontal" :items="items" />
      </UContainer>
    </header>
    <UContainer class="py-6">
      <slot />
    </UContainer>
  </div>
</template>
