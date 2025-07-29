<script setup lang="ts">
import { MilkdownProvider } from '@milkdown/vue'
import { nextTick, ref, watch } from 'vue'
import useContent from '@/hooks/useContent'
import { isShowOutline } from '@/hooks/useOutline'
import useSourceCode from '@/hooks/useSourceCode'
import useTheme from '@/hooks/useTheme'
import useTitle from '@/hooks/useTitle'
import MarkdownSourceEditor from './components/MarkdownSourceEditor.vue'
import MilkdownEditor from './components/MilkdownEditor.vue'
import Outline from './components/Outline.vue'
import StatusBar from './components/StatusBar.vue'
import Titlebar from './components/Titlebar.vue'
import emitter from './events'

const { updateTitle } = useTitle()
const { markdown } = useContent()
const { theme } = useTheme()
const { isShowSource } = useSourceCode()
const isShowEditors = ref(true)

watch(markdown, () => {
  updateTitle()
})
watch([theme, isShowSource], () => {
  reBuildMilkdown()
})
emitter.on('file:Change', () => {
  reBuildMilkdown()
})
function reBuildMilkdown() {
  isShowEditors.value = false
  nextTick(() => {
    isShowEditors.value = true
  })
}
</script>

<template>
  <Titlebar />
  <div v-if="isShowEditors" class="editorArea">
    <Transition name="fade" mode="out-in">
      <div v-show="isShowOutline && !isShowSource" class="outlineBox">
        <Outline />
      </div>
    </Transition>
    <div class="editorBox">
      <MilkdownProvider v-if="!isShowSource">
        <MilkdownEditor v-model="markdown" />
      </MilkdownProvider>
      <MarkdownSourceEditor v-else-if="isShowSource" v-model="markdown" />
    </div>
  </div>
  <StatusBar :content="markdown" />
</template>

<style scoped lang="less">
.editorArea {
  height: 0;
  flex: 1;
  display: flex;

  .outlineBox {
    width: 25%;
    height: 100%;
    transition: 0.2s;
  }

  .editorBox {
    flex: 1;
    width: 0;
  }
}
</style>
