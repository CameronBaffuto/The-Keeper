<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ArrowUp, Laptop, Moon, Sun } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import keeperAvatar from '@/assets/thekeeper.png'
import { useChatStore } from '@/stores/chatStore'
import { useThemeStore } from '@/stores/themeStore'

const appName = 'The Keeper'
const input = ref('')
const messageContainer = ref<HTMLElement | null>(null)
const chatStore = useChatStore()
const themeStore = useThemeStore()
const { messages, isSending, hasMessages } = storeToRefs(chatStore)
const { themeLabel, themeMode } = storeToRefs(themeStore)

const themeIcon = computed(() => {
  if (themeMode.value === 'system') return Laptop
  if (themeMode.value === 'dark') return Moon
  return Sun
})

const scrollToBottom = async () => {
  await nextTick()
  const el = messageContainer.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

const onSend = async () => {
  await chatStore.sendMessage(input.value)
  input.value = ''
}

watch(
  () => messages.value.length,
  () => {
    scrollToBottom()
  },
  { flush: 'post', immediate: true },
)

watch(
  () => isSending.value,
  () => {
    scrollToBottom()
  },
  { flush: 'post' },
)
</script>

<template>
  <main class="mx-auto flex h-dvh max-w-2xl flex-col bg-background">
    <header class="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <img :src="keeperAvatar" alt="The Keeper avatar" class="size-9 rounded-full border object-cover" />
          <div>
            <h1 class="text-base font-semibold leading-tight">{{ appName }}</h1>
            <p class="text-xs text-muted-foreground">Chat UI prototype</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          class="size-8"
          :title="`Theme: ${themeLabel}`"
          @click="themeStore.toggleThemeMode"
        >
          <component :is="themeIcon" class="size-4" />
          <span class="sr-only">{{ themeLabel }}</span>
        </Button>
      </div>
    </header>

    <section ref="messageContainer" class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div v-if="!hasMessages" class="pt-8 text-center text-sm text-muted-foreground">
        Start a conversation with The Keeper.
      </div>
      <article
        v-for="message in messages"
        :key="message.id"
        class="flex items-end gap-2"
        :class="message.role === 'assistant' ? 'justify-start' : 'justify-end'"
      >
        <img
          v-if="message.role === 'assistant'"
          :src="keeperAvatar"
          alt="Keeper"
          class="size-7 shrink-0 rounded-full border object-cover"
        />
        <div
          class="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
          :class="
            message.role === 'assistant'
              ? 'rounded-bl-sm border bg-card text-card-foreground'
              : 'rounded-br-sm bg-primary text-primary-foreground'
          "
        >
          <p>{{ message.text }}</p>
          <time class="mt-1 block text-xs opacity-75">
            {{ message.createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
          </time>
        </div>
      </article>
    </section>

    <footer class="border-t bg-background px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-4">
      <form class="flex items-center gap-2" @submit.prevent="onSend">
        <input
          v-model="input"
          type="text"
          placeholder="Type your message..."
          class="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-base text-card-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        />
        <Button
          type="submit"
          size="icon"
          class="size-11 shrink-0 rounded-xl"
          :disabled="!input.trim() || isSending"
          :title="isSending ? 'Sending' : 'Send message'"
        >
          <ArrowUp class="size-5" />
          <span class="sr-only">{{ isSending ? 'Sending' : 'Send message' }}</span>
        </Button>
      </form>
    </footer>
  </main>
</template>
