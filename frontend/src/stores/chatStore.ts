import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { mutateChat } from '@/queries/chatQueries'
import type { ChatMessage as ApiChatMessage, ChatRequest } from '@/types/chatTypes'
import type { UiChatMessage, UiChatRole } from '@/types/uiTypes'

const buildId = () => Date.now() + Math.floor(Math.random() * 1000)

export const useChatStore = defineStore('chat', () => {
  const messages = ref<UiChatMessage[]>([])
  const isSending = ref(false)

  const hasMessages = computed(() => messages.value.length > 0)

  const addMessage = (role: UiChatRole, text: string) => {
    messages.value.push({
      id: buildId(),
      role,
      text,
      createdAt: new Date(),
    })
  }

  const toApiMessages = (uiMessages: UiChatMessage[]): ApiChatMessage[] => {
    return uiMessages.map((message) => ({
      role: message.role,
      content: message.text,
    }))
  }

  const buildPayload = (uiMessages: UiChatMessage[]): ChatRequest => {
    const apiMessages = toApiMessages(uiMessages)
    const firstMessage = apiMessages[0]

    if (apiMessages.length === 1 && firstMessage?.role === 'user') {
      return { message: firstMessage.content }
    }

    return { messages: apiMessages }
  }

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isSending.value) return

    addMessage('user', trimmed)
    const payload = buildPayload(messages.value)
    console.log('[chat-api] request payload', payload)

    isSending.value = true
    try {
      const response = await mutateChat(payload)
      console.log('[chat-api] response payload', response)
      const reply = response.result?.answer?.trim() || 'No answer returned from API.'
      addMessage('assistant', reply)
    } catch (error) {
      console.error('[chat-api] request failed', error)
      addMessage('assistant', 'I could not reach chat right now. Please try again.')
    } finally {
      isSending.value = false
    }
  }

  const resetConversation = () => {
    messages.value = []
  }

  return {
    messages,
    isSending,
    hasMessages,
    sendMessage,
    resetConversation,
  }
})
