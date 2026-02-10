import { createApp } from 'vue'
import './style.css'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { queryClient } from '@/lib/queryClient'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
app.use(VueQueryPlugin, { queryClient })
app.mount('#app')
