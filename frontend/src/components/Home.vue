<script setup lang="ts">
import keeperLogo from '@/assets/thekeeper.png'
const name = 'The Keeper'
</script>

<template>
  <div class="flex flex-col justify-start gap-4">
    <h1 class="text-3xl font-bold">{{ name }}</h1>
    <img :src="keeperLogo" class="w-32" />
  </div>
</template>
