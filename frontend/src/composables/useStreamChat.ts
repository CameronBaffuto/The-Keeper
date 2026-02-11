import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chatStore'

export const useStreamChat = () => {
  const chatStore = useChatStore()
  const { isStreaming, error } = storeToRefs(chatStore)

  const sendStreaming = (userText: string) => chatStore.sendMessageStreaming(userText)
  const cancelStreaming = () => chatStore.cancelStreaming()

  return {
    sendStreaming,
    cancelStreaming,
    isStreaming,
    error,
  }
}
