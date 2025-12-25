<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'

export interface VirtualSelectOption {
  value: string
  label: string
  disabled?: boolean
  [key: string]: any
}

const props = defineProps<{
  modelValue?: string
  options: VirtualSelectOption[]
  placeholder?: string
  disabled?: boolean
  itemHeight?: number
  maxHeight?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string, option: VirtualSelectOption | null): void
}>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement>()
const listRef = ref<HTMLElement>()
const scrollTop = ref(0)

const selectedOption = computed(() => {
  return props.options.find(option => option.value === props.modelValue) || null
})

const itemHeight = props.itemHeight || 32
const maxHeight = props.maxHeight || 200
const visibleCount = Math.ceil(maxHeight / itemHeight)
const bufferSize = 5

const startIndex = computed(() => {
  const calculated = Math.floor(scrollTop.value / itemHeight) - bufferSize
  return Math.max(0, calculated)
})

const endIndex = computed(() => {
  return Math.min(
    props.options.length - 1,
    startIndex.value + visibleCount + bufferSize * 2,
  )
})

const visibleOptions = computed(() => {
  return props.options.slice(startIndex.value, endIndex.value + 1)
})

const totalHeight = computed(() => {
  return props.options.length * itemHeight
})

const offsetY = computed(() => {
  return startIndex.value * itemHeight
})

function toggleDropdown() {
  if (props.disabled)
    return
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}

function selectOption(option: VirtualSelectOption) {
  if (option.disabled)
    return

  emit('update:modelValue', option.value)
  emit('change', option.value, option)
  closeDropdown()
}

function scrollToSelected() {
  if (!selectedOption.value || !listRef.value)
    return

  const selectedIndex = props.options.findIndex(
    option => option.value === selectedOption.value?.value,
  )

  if (selectedIndex >= 0) {
    const containerHeight = listRef.value.clientHeight
    const itemPosition = selectedIndex * itemHeight

    const targetScrollTop = Math.max(0, itemPosition - containerHeight / 2 + itemHeight / 2)

    scrollTop.value = targetScrollTop
    listRef.value.scrollTop = targetScrollTop
  }
}

function handleScroll(event: Event) {
  const target = event.target as HTMLElement
  scrollTop.value = target.scrollTop
}

function handleClickOutside(event: Event) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

useEventListener(document, 'click', handleClickOutside)

watch(isOpen, (newValue) => {
  if (newValue) {
    nextTick(() => {
      if (listRef.value) {
        if (selectedOption.value) {
          scrollToSelected()
        } else {
          scrollTop.value = 0
          listRef.value.scrollTop = 0
        }
        handleScroll({ target: listRef.value } as unknown as Event)
      }
    })
  }
})

watch(() => props.modelValue, () => {
  if (isOpen.value && selectedOption.value) {
    nextTick(scrollToSelected)
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="virtual-select"
    :class="{
      'is-open': isOpen,
      'is-disabled': disabled,
    }"
  >
    <div
      class="virtual-select__input"
      @click="toggleDropdown"
    >
      <span v-if="selectedOption" class="virtual-select__selected">
        {{ selectedOption.label }}
      </span>
      <span v-else class="virtual-select__placeholder">
        {{ placeholder }}
      </span>

      <svg
        class="virtual-select__arrow"
        :class="{ 'is-open': isOpen }"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" class="virtual-select__dropdown">
        <div
          ref="listRef"
          class="virtual-select__list"
          :style="{ maxHeight: `${maxHeight}px` }"
          @scroll="handleScroll"
        >
          <div
            class="virtual-select__virtual-container"
            :style="{ height: `${totalHeight}px` }"
          >
            <div
              class="virtual-select__virtual-content"
              :style="{ transform: `translateY(${offsetY}px)` }"
            >
              <div
                v-for="option in visibleOptions"
                :key="option.value"
                class="virtual-select__option"
                :class="{
                  'is-selected': option.value === modelValue,
                  'is-disabled': option.disabled,
                }"
                :style="{ height: `${itemHeight}px` }"
                @click="selectOption(option)"
              >
                {{ option.label }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="less" scoped>
.virtual-select {
  position: relative;
  width: 100%;
  font-size: 13px;
  z-index: 9999;

  &.is-disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &__input {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 32px;
    padding: 6px 10px;
    border: 1px solid var(--border-color-2);
    border-radius: 4px;
    background: var(--background-color-2);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      border-color: var(--primary-color);
    }

    &:focus-within {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: 0 0 0 2px var(--primary-color-transparent);
    }
  }

  &__selected {
    flex: 1;
    color: var(--text-color);
    user-select: none;
  }

  &__placeholder {
    flex: 1;
    color: var(--text-color-2);
    user-select: none;
  }

  &__arrow {
    margin-left: 8px;
    color: var(--text-color-2);
    transition: transform 0.2s ease;

    &.is-open {
      transform: rotate(180deg);
    }
  }

  &__dropdown {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    z-index: 99999;
    background: var(--background-color-2);
    border: 1px solid var(--border-color-2);
    border-radius: 4px;
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }

  &__list {
    overflow-y: auto;
    overflow-x: hidden;
  }

  &__virtual-container {
    position: relative;
  }

  &__virtual-content {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }

  &__option {
    display: flex;
    align-items: center;
    padding: 0 10px;
    color: var(--text-color);
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background: var(--background-color-3);
    }

    &.is-selected {
      background: var(--primary-color-transparent);
      color: var(--primary-color);
      font-weight: 500;
    }

    &.is-disabled {
      opacity: 0.5;
      cursor: not-allowed;

      &:hover {
        background: transparent;
      }
    }
  }
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
