import axiosClient from '@/utils/axiosClient'
import type { ChatRequest, ChatResponse } from '@/types/chatTypes'

export const postChat = async (payload: ChatRequest): Promise<ChatResponse> => {
  try {
    const response = await axiosClient.post<ChatResponse>('/api/chat', payload)

    return response.data
  } catch (error) {
    console.error('Error in postChat:', error)
    throw error
  }
}
