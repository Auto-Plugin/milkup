<script setup lang="ts">
import { computed, ref } from "vue";

type SelectorItem = string | { label: string; value: string };

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  items?: SelectorItem[];
  label?: string;
  required?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", modelValue: string): void;
}>();

const containerRef = ref<HTMLElement>();
const isActive = ref(false);
const isUpward = ref(false);

const displayValue = computed(() => {
  if (!props.items) return props.modelValue;
  const selectedItem = props.items.find((item) => getItemValue(item) === props.modelValue);
  return selectedItem ? getItemLabel(selectedItem) : props.modelValue;
});

function getItemValue(item: SelectorItem): string {
  return typeof item === "string" ? item : item.value;
}

function getItemLabel(item: SelectorItem): string {
  return typeof item === "string" ? item : item.label;
}

function handleCheckItem(item: SelectorItem) {
  emit("update:modelValue", getItemValue(item));
  isActive.value = false;
}
function handleBlur() {
  setTimeout(() => {
    isActive.value = false;
  }, 100);
}

function handleFocus() {
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    // If space below is less than 220px, pop upwards
    isUpward.value = window.innerHeight - rect.bottom < 220;
  }
  isActive.value = true;
}
</script>

<template>
  <div class="Selector">
    <span class="label" :class="{ required }"> {{ label }}</span>
    <div ref="containerRef">
      <input
        class="selector-container"
        readonly
        :value="displayValue"
        :placeholder="placeholder"
        @focus="handleFocus"
        @blur="handleBlur"
      />
      <div v-if="isActive" class="selector-items" :class="{ upward: isUpward }">
        <div
          v-for="item in items"
          :key="getItemValue(item)"
          class="selector-item"
          @click="handleCheckItem(item)"
        >
          {{ getItemLabel(item) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.Selector {
  width: 100%;
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
        content: "*";
        color: rgba(233, 83, 83, 0.829);
      }
    }
  }

  > div {
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
    max-height: 250px;
    overflow-y: auto;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);

    &.upward {
      top: auto;
      bottom: 100%;
      margin-bottom: 4px;
      box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.1);
    }

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
