import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'

// 清理早期 PWA 版本注册的 Service Worker 和缓存，避免旧缓存导致样式丢失；
// 确认所有用户都已更新后可移除这段
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
}
if ('caches' in window) {
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
}

createApp(App).use(ElementPlus, { locale: zhCn }).mount('#app')
