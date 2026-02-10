export type UiChatRole = 'assistant' | 'user'

export interface UiChatMessage {
  id: number
  role: UiChatRole
  text: string
  createdAt: Date
}

export type ThemeMode = 'system' | 'light' | 'dark'
