<script setup lang='ts'>
import { nextTick, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  items: { label: string, value: any }[]
  label?: string
  required?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', modelValue: string): void
  (e: 'change', modelValue: string): void
}>()
const modelValue = ref<string>(props.modelValue)
const isActive = ref(false)
function handleCheckItem(item: string) {
  modelValue.value = item

  emit('update:modelValue', modelValue.value)
  emit('change', modelValue.value)
  isActive.value = false
}
function handleBlur() {
  setTimeout(() => {
    nextTick(() => {
      isActive.value = false
    })
  }, 150)
}
</script>

<template>
  <div class="Selector">
    <span v-if="label" class="label" :class="{ required }"> {{ label }}</span>
    <div>
      <input
        v-model="items.find(item => item.value === modelValue)!.label" class="selector-container" readonly
        :placeholder="placeholder" @focus="isActive = true" @blur="handleBlur"
      />
      <div v-if="isActive" class="selector-items">
        <div v-for="item in items" :key="item.value" class="selector-item" @click="handleCheckItem(item.value)">
          {{ item.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang='less' scoped>
.Selector {
  position: relative;
  cursor: pointer;
  display: flex;
  white-space: nowrap;
  align-items: center;
  gap: 10px;

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

  >div {
    position: relative;
  }

  .selector-container {
    width: 100%;
    height: 40px;
    display: flex;
    align-items: center;
    border: 1px solid var(--border-color-1);
    border-radius: 4px;
    padding: 0 10px;
    background-color: var(--background-color-1);
    color: var(--text-color-1);
    cursor: pointer;
  }

  .selector-items {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background-color: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 4px;
    z-index: 10;

    .selector-item {
      padding: 10px;
      cursor: pointer;

      &:hover {
        background-color: var(--hover-background-color);
      }
    }
  }
}
</style>
