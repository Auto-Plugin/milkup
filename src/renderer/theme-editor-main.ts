import { createApp } from 'vue'
import useTheme from '@/hooks/useTheme'
import ThemeEditor from './components/ThemeEditor.vue'
import './style.less'
import '@/themes/theme-main.less'
import '@milkdown/crepe/theme/common/style.css'
import '@/assets/iconfont/iconfont.css'
import '@/assets/iconfont/iconfont.js'

// 初始化主题
const { applyCurrentTheme } = useTheme()
applyCurrentTheme()

const app = createApp(ThemeEditor)
app.mount('#theme-editor-app')
