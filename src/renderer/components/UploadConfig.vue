<script setup lang='ts'>
import { ref } from 'vue'
import Input from '@/ui/Input.vue'
import Selector from '@/ui/Selector.vue'

type RequestMethod = 'post' | 'put'

const url = ref(localStorage.getItem('uploadUrl') || '')
const requestMethod = ref<RequestMethod>('post')
const headers = ref<string>('')
const bodyType = ref<string>('multipart/form-data')
const fileField = ref<string>('file')
const extraBody = ref<string>('')
const responseUrlPath = ref<string>('data.url')

function handleChange() {
  localStorage.setItem('uploadUrl', url.value)
  localStorage.setItem('uploadMethod', requestMethod.value)
  localStorage.setItem('uploadHeaders', headers.value)
  localStorage.setItem('uploadBodyType', bodyType.value)
  localStorage.setItem('uploadFileField', fileField.value)
  localStorage.setItem('uploadResponseUrlPath', responseUrlPath.value)
  localStorage.setItem('uploadExtraBody', extraBody.value)
}
</script>

<template>
  <div class="remote-options">
    <Input v-model="url" placeholder="接口地址" label="请求地址" required @change="handleChange" />
    <Selector v-model="requestMethod" :items="['post', 'put']" placeholder="请求方法" label="请求方法" required />
    <Input v-model="bodyType" placeholder="请求体类型" label="请求体类型" required />
    <Input v-model="fileField" placeholder="文件字段名" label="文件字段名" required />
    <Input v-model="responseUrlPath" placeholder="响应体中图片路径" label="响应图片路径" required />
    <Input v-model="headers" placeholder="请求头：建议粘贴" label="请求头" />
    <Input v-model="extraBody" placeholder="如：{token:xxx}" label="额外字段" />
  </div>
</template>

<style lang='less' scoped>
.remote-options {
  width: 100%;
  height: 40px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 10px;
  border-radius: 4px;
  gap: 12px;
}
</style>
