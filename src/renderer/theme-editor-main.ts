import '../../lang/index.js'

import { createApp, onMounted } from 'vue'
import useTheme from '@/hooks/useTheme'

import ThemeEditor from './components/ThemeEditor.vue'

import './style.less'
import '@/themes/theme-main.less'
import '@milkdown/crepe/theme/common/style.css'
import '@/assets/iconfont/iconfont.css'

const { init } = useTheme()
onMounted(() => init())

const app = createApp(ThemeEditor)
app.mount('#theme-editor-app')
