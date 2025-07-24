<script setup lang="ts">
import { MilkdownProvider } from "@milkdown/vue"

import useContent from "@/hooks/useContent"
import useTitle from "@/hooks/useTitle"
import useTheme from "@/hooks/useTheme"
import useSourceCode from "@/hooks/useSourceCode"
import { isShowOutline } from "@/hooks/useOutline"

import { nextTick, ref, watch } from "vue"
import emitter from "./events"

import {
  MilkdownEditor,
  Titlebar,
  MarkdownSourceEditor,
  StatusBar,
  Outline,
} from "./components"

const { updateTitle } = useTitle()
const { markdown } = useContent()
const { theme } = useTheme()
const { isShowSource } = useSourceCode()
const isShowEditor = ref(true)

watch(markdown, () => {
  updateTitle()
})
watch([theme, isShowSource], () => {
  reBuildMilkdown()
})
emitter.on("file:Change", () => {
  reBuildMilkdown()
})
function reBuildMilkdown() {
  isShowEditor.value = false
  nextTick(() => {
    isShowEditor.value = true
  })
}
</script>

<template>
  <Titlebar />
  <div class="editorArea" v-if="isShowEditor">
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
