<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import Chat from '@/views/Chat.vue'
import { useThemeStore } from '@/stores/themeStore'

const themeStore = useThemeStore()

onMounted(() => {
  themeStore.initializeTheme()
})

onBeforeUnmount(() => {
  themeStore.disposeTheme()
})
</script>

<template>
  <div>
    <Chat />
  </div>
</template>
