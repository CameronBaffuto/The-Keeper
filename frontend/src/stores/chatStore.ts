import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { streamChat } from '@/api/streamChat'
import { mutateChat } from '@/queries/chatQueries'
import type { ChatMessage as ApiChatMessage, ChatRequest } from '@/types/chatTypes'
import type { UiChatMessage, UiChatRole } from '@/types/uiTypes'

const buildId = () => Date.now() + Math.floor(Math.random() * 1000)

export const useChatStore = defineStore('chat', () => {
  const messages = ref<UiChatMessage[]>([])
  const isSending = ref(false)
  const isStreaming = ref(false)
  const streamingMessageId = ref<number | null>(null)
  const error = ref<string | null>(null)
  const abortController = ref<AbortController | null>(null)

  const hasMessages = computed(() => messages.value.length > 0)

  const addMessage = (role: UiChatRole, text: string) => {
    const nextMessage: UiChatMessage = {
      id: buildId(),
      role,
      text,
      createdAt: new Date(),
    }
    messages.value.push(nextMessage)
    return nextMessage
  }

  const appendToMessage = (id: number, tokenText: string) => {
    const target = messages.value.find((message) => message.id === id)
    if (!target) return
    target.text += tokenText
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

  const sendMessageStreaming = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming.value || isSending.value) return

    error.value = null
    addMessage('user', trimmed)

    const assistantPlaceholder = addMessage('assistant', '')
    streamingMessageId.value = assistantPlaceholder.id
    isStreaming.value = true

    const controller = new AbortController()
    abortController.value = controller

    const payload = toApiMessages(messages.value.filter((message) => message.id !== assistantPlaceholder.id))

    try {
      await streamChat({
        messages: payload,
        signal: controller.signal,
        onToken: (tokenText) => {
          appendToMessage(assistantPlaceholder.id, tokenText)
        },
      })
    } catch (streamError) {
      if (controller.signal.aborted) {
        return
      }

      error.value = streamError instanceof Error ? streamError.message : 'Streaming failed'
      if (!assistantPlaceholder.text.trim()) {
        assistantPlaceholder.text = 'I could not reach chat right now. Please try again.'
      }
    } finally {
      if (abortController.value === controller) {
        abortController.value = null
      }
      isStreaming.value = false
      streamingMessageId.value = null
    }
  }

  const cancelStreaming = () => {
    if (!abortController.value) return
    abortController.value.abort()
    abortController.value = null
    isStreaming.value = false
    streamingMessageId.value = null
  }

  const resetConversation = () => {
    cancelStreaming()
    messages.value = []
    error.value = null
  }

  return {
    messages,
    isSending,
    isStreaming,
    streamingMessageId,
    error,
    hasMessages,
    sendMessage,
    sendMessageStreaming,
    cancelStreaming,
    resetConversation,
  }
})
