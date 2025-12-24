<script setup lang="ts">
import { computed, ref } from 'vue'
import useOtherConfig from '@/hooks/useOtherConfig'
import { Input } from '@/renderer/components/ui/input'

const {
  currentEditorPadding,
  setEditorPadding,
} = useOtherConfig()

const paddingSettingsExpanded = ref(false)

// 从完整值中提取数字部分用于显示（如 "20px" -> "20"）
const displayPaddingValue = computed(() => {
  const value = currentEditorPadding.value || ''
  // 提取数字部分（包括小数点）
  const match = value.match(/^(\d+\.?\d*)/)
  return match ? match[1] : ''
})

function togglePaddingSettings() {
  paddingSettingsExpanded.value = !paddingSettingsExpanded.value
}

function handlePaddingChange(value: string) {
  console.log(value)

  // 如果提取到数字，自动添加 "px" 单位

  setEditorPadding(`${value}px`)
}
</script>

<template>
  <div class="other-setting-page">
    <!-- 边距设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="togglePaddingSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-text">编辑器其他外观设置</span>
          </h2>
          <p class="section-desc">
            配置编辑器其他外观设置
          </p>
        </div>
        <span class="iconfont icon-arrow-right" :class="{ active: paddingSettingsExpanded }"></span>
      </div>
      <div class="section-content" :class="{ expanded: paddingSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <label class="setting-label">左右边距(PX)</label>
            <div class="setting-input-wrapper">
              <Input
                type="number"
                :model-value="displayPaddingValue"
                placeholder="请输入数字"
                @update:model-value="handlePaddingChange"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.other-setting-page {
  display: flex;
  flex-direction: column;
  gap: 16px;

  // 折叠抽屉样式
  .collapsible-section {
    background: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    transition: all 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .section-header {
      padding: 16px 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      border-bottom: 1px solid var(--border-color-1);
      display: flex;
      align-items: center;
      justify-content: space-between;

      &:hover {
        background: var(--background-color-3);
      }

      .section-content-wrapper {
        flex: 1;
      }

      .section-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-color);
        margin: 0 0 4px 0;
        line-height: 1.4;

        .title-text {
          display: block;
        }
      }

      .section-desc {
        font-size: 12px;
        color: var(--text-color-2);
        margin: 0;
        line-height: 1.4;
      }

      .iconfont {
        font-size: 20px;
        color: var(--text-color-2);
        transition: transform 0.2s ease;
        margin-left: 12px;
        flex-shrink: 0;

        &.active {
          transform: rotate(90deg);
        }
      }
    }

    .section-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease, opacity 0.3s ease;
      opacity: 0;

      &.expanded {
        max-height: 1500px;
        opacity: 1;
      }
    }
  }

  // 设置列表样式
  .setting-list {
    padding: 20px;

    .setting-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border-color-1);

      &:last-child {
        border-bottom: none;
      }

      .setting-label {
        min-width: 120px;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-color-3);
        margin: 0;
        padding-right: 16px;
        flex-shrink: 0;
      }

      .setting-input-wrapper {
        flex: 1;
        min-width: 0;

        :deep(.input-container) {
          .label {
            display: none;
          }
        }
      }
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .other-setting-page {
    gap: 12px;

    .collapsible-section {
      .section-header {
        padding: 12px 16px;

        .section-title {
          font-size: 14px;
        }

        .section-desc {
          font-size: 11px;
        }
      }
    }

    .setting-list {
      padding: 16px;

      .setting-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;

        .setting-label {
          min-width: auto;
          padding-right: 0;
        }

        .setting-input-wrapper {
          width: 100%;
        }
      }
    }
  }
}
</style>
