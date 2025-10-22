
import '../../lang/index.js'
import { createApp } from 'vue'
import { directives } from '@/directives'
import App from './App.vue'
import '@milkdown/crepe/theme/common/style.css'
import './style.less'
import '@/assets/iconfont/iconfont.css'
import '@/assets/iconfont/iconfont.js'
import '@/themes/theme-main.less'
import 'vditor/src/assets/less/index.less'


const app = createApp(App)

Object.entries(directives).forEach(([name, directive]) => {
  app.directive(name, directive)
})


app.mount('#app')
