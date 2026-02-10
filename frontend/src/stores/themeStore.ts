import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ThemeMode } from '@/types/uiTypes'

const THEME_MODE_KEY = 'theme_mode'

export const useThemeStore = defineStore('theme', () => {
  const themeMode = ref<ThemeMode>('system')
  const systemPrefersDark = ref(false)
  const isInitialized = ref(false)

  let mediaQuery: MediaQueryList | null = null
  let onSystemThemeChange: ((event: MediaQueryListEvent) => void) | null = null

  const themeLabel = computed(() => {
    if (themeMode.value === 'system') return 'System'
    if (themeMode.value === 'dark') return 'Dark'
    return 'Light'
  })

  const applyTheme = () => {
    const resolvedTheme =
      themeMode.value === 'system'
        ? (systemPrefersDark.value ? 'dark' : 'light')
        : themeMode.value

    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }

  const persistThemeMode = (mode: ThemeMode) => {
    localStorage.setItem(THEME_MODE_KEY, mode)
  }

  const setThemeMode = (mode: ThemeMode) => {
    themeMode.value = mode
    persistThemeMode(mode)
    applyTheme()
  }

  const toggleThemeMode = () => {
    if (themeMode.value === 'system') {
      setThemeMode('light')
      return
    }

    if (themeMode.value === 'light') {
      setThemeMode('dark')
      return
    }

    setThemeMode('system')
  }

  const initializeTheme = () => {
    if (isInitialized.value) return

    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark.value = mediaQuery.matches

    const storedMode = localStorage.getItem(THEME_MODE_KEY)
    if (storedMode === 'system' || storedMode === 'light' || storedMode === 'dark') {
      themeMode.value = storedMode
    }

    onSystemThemeChange = (event: MediaQueryListEvent) => {
      systemPrefersDark.value = event.matches
      if (themeMode.value === 'system') {
        applyTheme()
      }
    }

    mediaQuery.addEventListener('change', onSystemThemeChange)
    applyTheme()
    isInitialized.value = true
  }

  const disposeTheme = () => {
    if (mediaQuery && onSystemThemeChange) {
      mediaQuery.removeEventListener('change', onSystemThemeChange)
    }
    onSystemThemeChange = null
    mediaQuery = null
    isInitialized.value = false
  }

  return {
    themeMode,
    themeLabel,
    initializeTheme,
    disposeTheme,
    setThemeMode,
    toggleThemeMode,
  }
})
