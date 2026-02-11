<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ArrowUp, Laptop, Moon, Plus, Sun } from 'lucide-vue-next'
import { marked } from 'marked'
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

const visibleMessages = computed(() => {
  return messages.value.filter((message) => {
    if (message.role !== 'assistant') return true
    return message.text.trim().length > 0
  })
})

const renderMarkdown = (text: string) => {
  const normalized = text
    .replace(/\\([`*_{}\[\]()#+\-.!])/g, '$1')
    .replace(/\r\n/g, '\n')

  return marked.parse(normalized, { gfm: true, breaks: true }) as string
}

const scrollToBottom = async () => {
  await nextTick()
  const el = messageContainer.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

const onSend = async () => {
  const message = input.value.trim()
  if (!message || isSending.value) return

  input.value = ''
  await chatStore.sendMessage(message)
}

const onNewChat = () => {
  chatStore.resetConversation()
  input.value = ''
}

watch(
  () => messages.value.map((message) => message.text).join('\n'),
  () => {
    scrollToBottom()
  },
  { flush: 'post', immediate: true },
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
            <p class="text-xs text-muted-foreground">Guardian of Context</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" class="size-8" title="New chat" @click="onNewChat">
            <Plus class="size-4" />
            <span class="sr-only">New chat</span>
          </Button>
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
      </div>
    </header>

    <section ref="messageContainer" class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div v-if="!hasMessages" class="pt-8 text-center text-sm text-muted-foreground">
        Start a conversation with The Keeper.
      </div>
      <article
        v-for="message in visibleMessages"
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
          <div
            v-if="message.role === 'assistant'"
            class="[&_a]:font-medium [&_a]:underline [&_a]:decoration-current/60 hover:[&_a]:decoration-current [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol]:my-2 [&_ol]:space-y-1 [&_p]:mb-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:my-2 [&_ul]:space-y-1 [&>*:last-child]:mb-0"
            v-html="renderMarkdown(message.text)"
          ></div>
          <p v-else class="whitespace-pre-wrap">{{ message.text }}</p>
          <time class="mt-1 block text-xs opacity-75">
            {{ message.createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
          </time>
        </div>
      </article>
      <article v-if="isSending" class="flex items-end gap-2 justify-start">
        <img :src="keeperAvatar" alt="Keeper" class="size-7 shrink-0 rounded-full border object-cover" />
        <div class="rounded-2xl rounded-bl-sm border bg-card px-3 py-3 text-card-foreground">
          <div class="flex items-center gap-1.5">
            <span class="size-2 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.3s]"></span>
            <span class="size-2 rounded-full bg-muted-foreground/70 animate-bounce [animation-delay:-0.15s]"></span>
            <span class="size-2 rounded-full bg-muted-foreground/70 animate-bounce"></span>
          </div>
        </div>
      </article>
    </section>

    <footer class="border-t bg-background px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-4">
      <form class="flex items-center gap-2" @submit.prevent="onSend">
        <input
          v-model="input"
          type="text"
          placeholder="Ask anything..."
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
