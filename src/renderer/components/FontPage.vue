<script setup lang="ts">
import type { FontType } from '@/types/font'
import { onMounted } from 'vue'
import { fontConfig } from '@/config/fonts'
import useFont from '@/hooks/useFont'

// const fontConfig = {
//   'app-font': {
//     label: '应用字体',
//     desc: '用于应用界面的主要字体',
//     value: 'app-font',
//   },
//   'editor-font': {
//     label: '编辑器字体',
//     desc: '用于文本编辑器的字体',
//     value: 'editor-font',
//   },
//   'code-font': {
//     label: '代码字体',
//     desc: '用于代码显示的字体',
//     value: 'code-font',
//   },
// }

const {
  fontList,
  currentFont,
  init,
  setFont,
  getFontList,
} = useFont()

// 应用字体到当前主题
function applyAppFont(fontName: string) {
  console.log('应用字体:', fontName)
}

function applyEditorFont(fontName: string) {
  console.log('编辑器字体:', fontName)
}

function applyCodeFont(fontName: string) {
  console.log('代码字体:', fontName)
}

onMounted(() => {

})
</script>

<template>
  <div class="font-page">
    <div v-for="font in fontConfig" :key="font.value" class="font-section">
      <div class="font-preview" :style="{ fontFamily: currentFont![font.value as FontType].value }">
        <div class="preview-text">
          Aa
        </div>
        <div class="preview-chinese">
          中文
        </div>
      </div>
      <h3 class="section-title">
        {{ font.label }}
      </h3>
      <p class="section-desc">
        {{ font.desc }}
      </p>
      <div class="font-selector">
        <label :for="font.value">字体:</label>
        <select
          :id="font.value" v-model="currentFont![font.value as FontType]" class="font-select"
          @change="setFont(font.value as FontType, currentFont![font.value as FontType])"
        >
          <option v-for="item in fontList" :key="item.value" :value="item.value" :style="{ fontFamily: item.value }">
            {{ item.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- <div class="font-section">
      <div class="font-preview" :style="{ fontFamily: appFont }">
        <div class="preview-text">
          Aa
        </div>
        <div class="preview-chinese">
          中文
        </div>
      </div>
      <h3 class="section-title">
        应用字体
      </h3>
      <p class="section-desc">
        用于应用界面的主要字体
      </p>
      <div class="font-selector">
        <label for="app-font-select">字体:</label>
        <select
          id="app-font-select" v-model="currentFont!['app-font']" class="font-select"
          @change="applyAppFont(appFont)"
        >
          <option v-for="font in systemFonts" :key="font" :value="font" :style="{ fontFamily: font }">
            {{ font }}
          </option>
        </select>
      </div>
    </div>

    <div class="font-section">
      <div class="font-preview" :style="{ fontFamily: editorFont }">
        <div class="preview-text">
          Aa
        </div>
        <div class="preview-chinese">
          中文
        </div>
      </div>
      <h3 class="section-title">
        编辑器字体
      </h3>
      <p class="section-desc">
        用于文本编辑器的字体
      </p>
      <div class="font-selector">
        <label for="editor-font-select">字体:</label>
        <select
          id="editor-font-select" v-model="currentFont!['editor-font']" class="font-select"
          @change="applyEditorFont(editorFont)"
        >
          <option v-for="font in systemFonts" :key="font" :value="font" :style="{ fontFamily: font }">
            {{ font }}
          </option>
        </select>
      </div>
    </div>

    <div class="font-section">
      <div class="font-preview" :style="{ fontFamily: codeFont }">
        <div class="preview-text">
          Aa
        </div>
        <div class="preview-chinese">
          中文
        </div>
      </div>
      <h3 class="section-title">
        代码字体
      </h3>
      <p class="section-desc">
        用于代码显示的字体
      </p>
      <div class="font-selector">
        <label for="code-font-select">字体:</label>
        <select
          id="code-font-select" v-model="currentFont!['code-font']" class="font-select"
          @change="applyCodeFont(codeFont)"
        >
          <option v-for="font in systemFonts" :key="font" :value="font" :style="{ fontFamily: font }">
            {{ font }}
          </option>
        </select>
      </div>
    </div> -->
  </div>
</template>

<style lang="less" scoped>
.font-page {

  display: flex;
  gap: 20px;
  justify-content: center;

  .font-section {
    flex: 1;
    max-width: 250px;
    padding: 16px;
    background: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;

    &:hover {
      border-color: var(--border-color-2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .font-preview {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 20px 16px;

      border-radius: 6px;
      text-align: center;
      margin-bottom: 16px;
      min-height: 80px;
      justify-content: center;

      .preview-text {
        font-size: 32px;
        font-weight: 700;
        color: var(--text-color);
        line-height: 1;
      }

      .preview-chinese {
        font-size: 18px;
        color: var(--text-color);
        line-height: 1;
      }
    }

    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-color);
      margin: 0 0 6px 0;
    }

    .section-desc {
      font-size: 12px;
      color: var(--text-color-2);
      margin: 0 0 16px 0;
      line-height: 1.4;
    }

    .font-selector {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: auto;

      label {
        font-size: 13px;
        color: var(--text-color);
        font-weight: 500;
      }

      .font-select {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid var(--border-color-2);
        border-radius: 4px;
        background: var(--background-color-1);
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
          background: var(--background-color-1);
          color: var(--text-color);
        }
      }
    }
  }
}

// 响应式设计
@media (max-width: 768px) {
  .font-page {
    flex-direction: column;
    padding: 16px;

    .font-section {
      max-width: none;
      padding: 14px;

      .font-preview {
        padding: 16px;
        margin-bottom: 12px;

        .preview-text {
          font-size: 28px;
        }

        .preview-chinese {
          font-size: 16px;
        }
      }

      .font-selector {
        gap: 10px;
      }
    }
  }
}
</style>
