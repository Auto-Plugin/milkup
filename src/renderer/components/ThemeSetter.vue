<script setup lang="ts">
import { ref } from 'vue'
import useTheme from '@/hooks/useTheme'

const { defaultThemes, theme, setTheme } = useTheme()
const isShowThemeDropdown = ref(false)

function handleChangeTheme(selectedTheme: string) {
  setTheme(selectedTheme)
  isShowThemeDropdown.value = false
}
function handleClickOutside() {
  setTimeout(() => {
    isShowThemeDropdown.value && (isShowThemeDropdown.value = false)
  }, 100)
}
</script>

<template>
  <div class="ThemeSetterBox">
    <div class="theme-options">
      <span class="dropdownBtn">
        <input
          :value="theme" class="disableInput" readonly @focus="isShowThemeDropdown = true"
          @blur="handleClickOutside"
        />
        <Transition name="fade">
          <div v-show="isShowThemeDropdown" class="dropdownPanel" :style="{ height: `${defaultThemes.length * 40}px` }">
            <div v-for="(t, idx) in defaultThemes" :key="idx" class="dropdown-items">
              <span :class="{ active: t === theme }" @click.stop="handleChangeTheme(t)">{{ t }}</span>
            </div>
          </div>
        </Transition>
      </span>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ThemeSetterBox {
  width: 100%;

  .theme-options {
    position: relative;
    display: flex;
    align-items: center;

    .disableInput {
      width: 100%;
      height: 100%;
      cursor: pointer;
      background: transparent;
      border: none;
      color: var(--text-color);
      background: var(--background-color-2);
      border: 1px solid var(--border-color-2);
      padding: 8px;
      border-radius: 4px;
    }
  }

  .dropdownPanel {
    position: absolute;
    width: 100%;
    top: calc(100% + 8px);
    left: 0;
    background: var(--background-color-3);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    max-height: 200px;
    overflow-y: auto;

    .dropdown-items {
      display: flex;
      flex-direction: column;

      &:hover {
        background: var(--hover-color);
      }

      span {
        padding: 8px;
        cursor: pointer;

        &:hover {
          background: var(--hover-background-color-2);
        }

        &.active {
          background: var(--active-background-color);
          font-weight: bold;
        }
      }
    }
  }

  .dropdownBtn {
    display: inline-block;
    position: relative;
    cursor: pointer;
    color: var(--text-color);
    transition: background 0.3s;

    span {
      display: inline-block;
      min-width: 150px;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>
