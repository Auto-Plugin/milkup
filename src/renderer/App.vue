<script setup lang="ts">
import MilkdownEditor from './components/MilkdownEditor.vue'
import { MilkdownProvider } from '@milkdown/vue'
import useContent from '@/hooks/useContent'
import useTitle from '@/hooks/useTitle'
import { nextTick, ref, watch } from 'vue'
import Titlebar from './components/Titlebar.vue'
import useTheme from '@/hooks/useTheme'
import useSourceCode from '@/hooks/useSourceCode'
import MarkdownSourceEditor from './components/MarkdownSourceEditor.vue'
import emitter from './events'
import StatusBar from './components/StatusBar.vue'
import Outline from './components/Outline.vue'
import { isShowOutline } from '@/hooks/useOutline'
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
  <div class="editorArea" v-if="isShowEditors">
    <Transition name="fade" mode="out-in">
      <div class="outlineBox" v-show="isShowOutline">
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
  }

  .editorBox {
    flex: 1;
    width: 0;
  }
}
</style>
