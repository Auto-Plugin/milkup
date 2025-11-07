<script setup lang='ts'>
import { ref } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  label?: string
  required?: boolean
  type?: 'text' | 'number'
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', modelValue: string): void
  (e: 'change'): void
}>()
const modelValue = ref<string>(props.modelValue)

function handleChange() {
  emit('update:modelValue', modelValue.value)
  emit('change')
}
</script>

<template>
  <div class="input-container">
    <span class="label" :class="{ required }"> {{ label }}</span>
    <div class="Input">
      <input v-model="modelValue" :type="type" :placeholder="placeholder" @change="handleChange" />
    </div>
  </div>
</template>

<style lang='less' scoped>
.input-container {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;

  .label {
    min-width: 100px;
    display: inline-block;

    &.required {
      &::after {
        content: '*';
        color: rgba(233, 83, 83, 0.829);
      }
    }
  }
}

.Input {
  width: 100%;
  height: 40px;

  border: 1px solid var(--border-color-1);
  border-radius: 4px;
  background-color: var(--background-color-1);

  input {
    width: 100%;
    height: 100%;
    border: none;
    outline: none;
    background-color: transparent;
    color: var(--text-color-1);
    padding: 0 10px;
    font-size: 14px;
  }
}
</style>
