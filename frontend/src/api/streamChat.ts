import type { ChatMessage } from '@/types/chatTypes'

type StreamChatParams = {
  messages: ChatMessage[]
  model?: string
  signal?: AbortSignal
  onToken?: (tokenText: string) => void
  onDone?: () => void
  onError?: (error: unknown) => void
}

const extractTokenFromSseData = (data: string): string => {
  const trimmed = data.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed) as { response?: string; token?: string; text?: string }
    if (typeof parsed.response === 'string') return parsed.response
    if (typeof parsed.token === 'string') return parsed.token
    if (typeof parsed.text === 'string') return parsed.text
  } catch {
    // Workers AI may emit plain text chunks in `data:` lines.
  }

  return data
}

export const streamChat = async ({
  messages,
  model,
  signal,
  onToken,
  onDone,
  onError,
}: StreamChatParams): Promise<void> => {
  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, model }),
      signal,
    })

    if (!response.ok) {
      let errorMessage = `Request failed (${response.status})`
      try {
        const errorBody = (await response.json()) as { error?: string }
        if (typeof errorBody.error === 'string') {
          errorMessage = errorBody.error
        }
      } catch {
        // Ignore JSON parsing failures when building error messages.
      }

      throw new Error(errorMessage)
    }

    if (!response.body) {
      throw new Error('Streaming response body is empty')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let isDone = false

    while (!isDone) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trimEnd()
        if (!line || !line.startsWith('data:')) continue

        const data = line.slice(5).trimStart()
        if (data === '[DONE]') {
          isDone = true
          break
        }

        onToken?.(extractTokenFromSseData(data))
      }
    }

    if (!isDone) {
      const lastLine = buffer.trim()
      if (lastLine.startsWith('data:')) {
        const data = lastLine.slice(5).trimStart()
        if (data !== '[DONE]') {
          onToken?.(extractTokenFromSseData(data))
        }
      }
    }

    onDone?.()
  } catch (error) {
    onError?.(error)
    throw error
  }
}
