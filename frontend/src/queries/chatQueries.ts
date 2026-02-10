import { postChat } from '@/apis/chatApi'
import { queryClient } from '@/lib/queryClient'
import type { ChatRequest, ChatResponse } from '@/types/chatTypes'

export const chatMutationKey = ['chat', 'message'] as const

export const mutateChat = async (payload: ChatRequest): Promise<ChatResponse> => {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: chatMutationKey,
    mutationFn: postChat,
  })

  return mutation.execute(payload)
}
