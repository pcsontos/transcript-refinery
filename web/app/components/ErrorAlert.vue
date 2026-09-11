<script setup lang="ts">
defineProps<{ error: unknown }>()
</script>

<template>
  <UAlert
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    title="Az adat nem tölthető be"
    :description="errorMessage(error)"
  />
</template>
