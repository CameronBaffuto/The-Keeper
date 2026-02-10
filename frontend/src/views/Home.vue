<script setup lang="ts">
import { Button } from '@/components/ui/button'
import keeperLogo from '@/assets/thekeeperLogo.png'
const name = 'The Keeper'
</script>

<template>
  <div class="flex flex-col justify-start gap-4">
    <h1 class="text-3xl font-bold">{{ name }}</h1>
    <img :src="keeperLogo" class="w-32" />
    <Button>Primary Button</Button> 
    <Button variant="outline">
        Default
    </Button>
    <Button variant="destructive">
      Destructive
    </Button>
  </div>
</template>
