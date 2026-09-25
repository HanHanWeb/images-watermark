import { createApp } from 'vue'
import ElementPlus, { ElNotification } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'

// 新版本就绪时通知，用户点击后统一刷新，保证页面资源版本一致
const updateSW = registerSW({
  onNeedRefresh() {
    ElNotification({
      title: '发现新版本',
      message: '点击刷新更新到最新版',
      type: 'info',
      duration: 0,
      onClick: () => updateSW(true),
    })
  },
})

createApp(App).use(ElementPlus, { locale: zhCn }).mount('#app')
