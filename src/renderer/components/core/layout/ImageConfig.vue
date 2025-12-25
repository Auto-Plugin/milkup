<script setup lang='ts'>
import { Input } from '@renderer/components/ui/input'
import { ref } from 'vue'
import UploadConfig from './UploadConfig.vue'

type PasteMethod = 'local' | 'base64' | 'remote'
const pasteMethod = ref<PasteMethod>(localStorage.getItem('pasteMethod') as PasteMethod || 'local')
const localPath = ref<string>('/temp')

function handleChangePasteMethod(method: PasteMethod) {
  pasteMethod.value = method
  localStorage.setItem('pasteMethod', method)
}
function handleChangeLoaclPath() {
  localStorage.setItem('localImagePath', localPath.value)
}
</script>

<template>
  <div class="ImageConfigBox">
    <div class="options">
      <div>
        <input
          id="temp" type="radio" name="pasteMethod" value="local" :checked="pasteMethod === 'local'"
          @click="handleChangePasteMethod('local')"
        >
        <label for="temp">本地文件</label>
      </div>
      <div>
        <input
          id="local" type="radio" name="pasteMethod" value="base64" :checked="pasteMethod === 'base64'"
          @click="handleChangePasteMethod('base64')"
        >
        <label for="local">转为 Base64</label>
      </div>
      <div>
        <input
          id="remote" type="radio" name="pasteMethod" value="remote" :checked="pasteMethod === 'remote'"
          @click="handleChangePasteMethod('remote')"
        >
        <label for="remote">上传</label>
      </div>
    </div>
    <div class="details">
      <div v-if="pasteMethod === 'local'">
        <Input v-model="localPath" placeholder="/temp" label="本地文件路径" @change="handleChangeLoaclPath" />
      </div>
      <div v-if="pasteMethod === 'base64'">
        图片将自动转为 base64（可能会增大文件体积）
      </div>
      <UploadConfig v-if="pasteMethod === 'remote'" />
    </div>
  </div>
</template>

<style lang='less' scoped>
.ImageConfigBox {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .details {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;

    >div {
      width: 100%;
      height: 40px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 0 10px;
      border-radius: 4px;
      gap: 12px;
    }
  }

  .options {
    width: 100%;
    height: 100%;
    display: flex;
    gap: 20px;

    >div {
      cursor: pointer;

      input,
      label {
        cursor: pointer;
      }
    }
  }
}
</style>
