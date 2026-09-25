import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'

registerSW({ immediate: true })

createApp(App).use(ElementPlus, { locale: zhCn }).mount('#app')
