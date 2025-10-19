// 静态导入样式文件，确保样式正常加载
import '@milkdown/crepe/theme/common/style.css'
import './style.less'
import '@/assets/iconfont/iconfont.css'
import '@/assets/iconfont/iconfont.js'
import '@/themes/theme-main.less'

// 动态导入确保顺序
import('./lang/index.js' as any).then(async () => {
  // 翻译系统加载完成后，加载其他模块
  const [
    { createApp },
    { directives },
    App
  ] = await Promise.all([
    import('vue'),
    import('@/directives'),
    import('./App.vue')
  ])

  const app = createApp(App.default || App)

  Object.entries(directives).forEach(([name, directive]) => {
    app.directive(name, directive)
  })

  app.mount('#app')
}).catch(console.error)