<script setup lang="ts">
import type { FontSizeType, FontType } from '@/types/font'
import { onMounted, ref } from 'vue'
import { fontConfig, fontSizeConfig } from '@/config/fonts'
import useFont from '@/hooks/useFont'

const {
  fontList,
  currentFont,
  currentFontSize,
  fontSizeOptions,
  setFont,
  setFontSize,
} = useFont()

const fontSettingsExpanded = ref(false)
const fontSizeSettingsExpanded = ref(false)

function toggleFontSettings() {
  fontSettingsExpanded.value = !fontSettingsExpanded.value
}

function toggleFontSizeSettings() {
  fontSizeSettingsExpanded.value = !fontSizeSettingsExpanded.value
}

onMounted(() => {

})
</script>

<template>
  <div class="font-page">
    <!-- 字体设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="toggleFontSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-text">字体设置</span>
          </h2>
          <p class="section-desc">
            配置编辑器和代码的字体样式
          </p>
        </div>
        <span class="iconfont icon-arrow-right" :class="{ active: fontSettingsExpanded }"></span>
      </div>
      <div class="section-content" :class="{ expanded: fontSettingsExpanded }">
        <div class="font-sections">
          <div v-for="font in fontConfig" :key="font.value" class="font-section">
            <div
              class="font-preview" :style="{
                fontFamily: currentFont[font.value as FontType]?.value,
                fontSize: currentFontSize[font.value === 'editor-font' ? 'editor-font-size' : 'code-font-size'],
              }"
            >
              <template v-if="font.value === 'editor-font'">
                <div class="preview-text">
                  Aa
                </div>
                <div class="preview-chinese">
                  中文
                </div>
              </template>
              <template v-else-if="font.value === 'code-font'">
                <div class="preview-code">
                  const msg = 'Hello Milkup';
                </div>
                <div class="preview-code-2">
                  function() { return 123; }
                </div>
              </template>
            </div>
            <h3 class="font-title">
              {{ font.label }}
            </h3>
            <p class="font-desc">
              {{ font.desc }}
            </p>
            <div class="font-selector">
              <label :for="font.value" class="selector-label">
                字体选择
              </label>
              <select
                :id="font.value"
                :value="currentFont[font.value as FontType]?.value"
                class="font-select"
                @change="setFont(font.value as FontType, fontList.find(f => f.value === ($event.target as HTMLSelectElement).value)!)"
              >
                <option v-for="item in fontList" :key="item.value" :value="item.value" :style="{ fontFamily: item.value }">
                  {{ item.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 字号设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="toggleFontSizeSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-text">字号设置</span>
          </h2>
          <p class="section-desc">
            配置不同文本元素的字体大小
          </p>
        </div>
        <span class="iconfont icon-arrow-right" :class="{ active: fontSizeSettingsExpanded }"></span>
      </div>
      <div class="section-content" :class="{ expanded: fontSizeSettingsExpanded }">
        <div class="font-size-grid">
          <div v-for="fontSize in fontSizeConfig" :key="fontSize.value" class="font-size-item">
            <div class="font-size-preview" :style="{ fontSize: currentFontSize[fontSize.value as FontSizeType] }">
              <template v-if="fontSize.value === 'editor-font-size'">
                <div class="preview-text">
                  正文内容
                </div>
              </template>
              <template v-else-if="fontSize.value === 'code-font-size'">
                <div class="preview-code">
                  const code = 'example';
                </div>
              </template>
              <template v-else-if="fontSize.value === 'editor-font-size-h1'">
                <div class="preview-h1">
                  一级标题
                </div>
              </template>
              <template v-else-if="fontSize.value === 'editor-font-size-h2'">
                <div class="preview-h2">
                  二级标题
                </div>
              </template>
              <template v-else-if="fontSize.value === 'editor-font-size-h3'">
                <div class="preview-h3">
                  三级标题
                </div>
              </template>
              <template v-else-if="fontSize.value === 'editor-font-size-h4'">
                <div class="preview-h4">
                  四级标题
                </div>
              </template>
              <template v-else-if="fontSize.value === 'editor-font-size-h5'">
                <div class="preview-h5">
                  五级标题
                </div>
              </template>
              <template v-else-if="fontSize.value === 'editor-font-size-h6'">
                <div class="preview-h6">
                  六级标题
                </div>
              </template>
            </div>
            <h3 class="font-title">
              {{ fontSize.label }}
            </h3>
            <p class="font-desc">
              {{ fontSize.desc }}
            </p>
            <div class="font-size-selector">
              <label :for="fontSize.value" class="selector-label">
                字体大小
              </label>
              <select
                :id="fontSize.value"
                :value="currentFontSize[fontSize.value as FontSizeType]"
                class="font-select"
                @change="setFontSize(fontSize.value as FontSizeType, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="item in fontSizeOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.font-page {
  display: flex;
  flex-direction: column;
  gap: 16px;

  // 折叠抽屉样式
  .collapsible-section {
    background: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    overflow: hidden;
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

  // 字体设置内容样式
  .font-sections {
    display: flex;
    gap: 20px;
    padding: 20px;

    .font-section {
      flex: 1;
      max-width: 250px;
      padding: 16px;
      background: var(--background-color-1);
      border: 1px solid var(--border-color-2);
      border-radius: 6px;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      &:hover {
        border-color: var(--primary-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .font-preview {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 20px 16px;
        border-radius: 6px;
        text-align: center;
        margin-bottom: 16px;
        min-height: 80px;
        justify-content: center;

        .preview-text {
          font-weight: 700;
          color: var(--text-color);
          line-height: 1;
        }

        .preview-chinese {
          color: var(--text-color);
          line-height: 1;
        }

        .preview-code {
          color: var(--text-color);
          line-height: 1.2;
          font-weight: 400;
        }

        .preview-code-2 {
          color: var(--text-color-2);
          line-height: 1.2;
          font-weight: 400;
        }
      }

      .font-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-color);
        margin: 0 0 6px 0;
      }

      .font-desc {
        font-size: 12px;
        color: var(--text-color-2);
        margin: 0 0 16px 0;
        line-height: 1.4;
      }

      .font-selector {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: auto;

        .selector-label {
          font-size: 13px;
          color: var(--text-color);
          font-weight: 500;
        }

        .font-select {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid var(--border-color-2);
          border-radius: 4px;
          background: var(--background-color-2);
          color: var(--text-color);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;

          &:hover {
            border-color: var(--primary-color);
          }

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }

          option {
            padding: 6px;
            background: var(--background-color-2);
            color: var(--text-color);
          }
        }
      }
    }
  }

  // 字号设置内容样式
  .font-size-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    padding: 20px;

    .font-size-item {
      padding: 16px;
      background: var(--background-color-1);
      border: 1px solid var(--border-color-2);
      border-radius: 6px;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      &:hover {
        border-color: var(--primary-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .font-size-preview {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px 16px;
        border-radius: 6px;
        margin-bottom: 16px;
        min-height: 60px;
        background: var(--background-color-2);
        border: 1px solid var(--border-color-1);

        .preview-text,
        .preview-code,
        .preview-h1,
        .preview-h2,
        .preview-h3,
        .preview-h4,
        .preview-h5,
        .preview-h6 {
          color: var(--text-color);
          line-height: 1.2;
          font-weight: 400;
        }

        .preview-h1,
        .preview-h2,
        .preview-h3,
        .preview-h4,
        .preview-h5,
        .preview-h6 {
          font-weight: 600;
        }

        .preview-code {
          font-family: var(--milkup-font-code, monospace);
        }
      }

      .font-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-color);
        margin: 0 0 6px 0;
      }

      .font-desc {
        font-size: 12px;
        color: var(--text-color-2);
        margin: 0 0 16px 0;
        line-height: 1.4;
      }

      .font-size-selector {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: auto;

        .selector-label {
          font-size: 13px;
          color: var(--text-color);
          font-weight: 500;
        }

        .font-select {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid var(--border-color-2);
          border-radius: 4px;
          background: var(--background-color-2);
          color: var(--text-color);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;

          &:hover {
            border-color: var(--primary-color);
          }

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }

          option {
            padding: 6px;
            background: var(--background-color-2);
            color: var(--text-color);
          }
        }
      }
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .font-page {
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

    .font-sections {
      flex-direction: column;
      gap: 16px;
      padding: 16px;

      .font-section {
        max-width: none;
        padding: 14px;

        .font-preview {
          padding: 16px;
          margin-bottom: 12px;
          min-height: 60px;
        }
      }
    }

    .font-size-grid {
      grid-template-columns: 1fr;
      gap: 12px;
      padding: 16px;

      .font-size-item {
        padding: 14px;

        .font-size-preview {
          padding: 16px;
          min-height: 50px;
        }
      }
    }
  }
}
</style>
