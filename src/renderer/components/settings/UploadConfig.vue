<script setup lang="ts">
import { ref, watch } from "vue";
import Input from "@/ui/Input.vue";
import Selector from "@/ui/Selector.vue";

type RequestMethod = "post" | "put";

const url = ref(localStorage.getItem("uploadUrl") || "");
const requestMethod = ref<RequestMethod>(
  (localStorage.getItem("uploadMethod") as RequestMethod) || "post"
);
const headers = ref<string>(localStorage.getItem("uploadHeaders") || "");
const bodyType = ref<string>(localStorage.getItem("uploadBodyType") || "multipart/form-data");
const fileField = ref<string>(localStorage.getItem("uploadFileField") || "file");
const extraBody = ref<string>(localStorage.getItem("uploadExtraBody") || "");
const responseUrlPath = ref<string>(localStorage.getItem("uploadResponseUrlPath") || "data.url");

// 监听所有配置项的变化，自动保存到 localStorage
watch(url, (newValue) => localStorage.setItem("uploadUrl", newValue));
watch(requestMethod, (newValue) => localStorage.setItem("uploadMethod", newValue));
watch(headers, (newValue) => localStorage.setItem("uploadHeaders", newValue));
watch(bodyType, (newValue) => localStorage.setItem("uploadBodyType", newValue));
watch(fileField, (newValue) => localStorage.setItem("uploadFileField", newValue));
watch(responseUrlPath, (newValue) => localStorage.setItem("uploadResponseUrlPath", newValue));
watch(extraBody, (newValue) => localStorage.setItem("uploadExtraBody", newValue));
</script>

<template>
  <div class="remote-options">
    <Input v-model="url" placeholder="接口地址" label="请求地址" required />
    <Selector
      v-model="requestMethod"
      :items="[
        { label: 'post', value: 'post' },
        { label: 'put', value: 'put' },
      ]"
      placeholder="请求方法"
      label="请求方法"
      required
    />
    <Input v-model="bodyType" placeholder="请求体类型" label="请求体类型" required />
    <Input v-model="fileField" placeholder="文件字段名" label="文件字段名" required />
    <Input v-model="responseUrlPath" placeholder="响应体中图片路径" label="响应图片路径" required />
    <Input v-model="headers" placeholder="请求头：建议粘贴" label="请求头" />
    <Input v-model="extraBody" placeholder="如：{token:xxx}" label="额外字段" />
  </div>
</template>

<style lang="less" scoped>
.remote-options {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 10px;
  border-radius: 4px;
  gap: 12px;
}
</style>
