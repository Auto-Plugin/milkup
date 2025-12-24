<script setup lang="ts">
import type { ThemeName } from '@/types/theme'
import { MilkdownEditor } from '@renderer/components/core/editor'
import autotoast from 'autotoast.js'
import { onMounted, onUnmounted, ref } from 'vue'
import useTheme from '@/hooks/useTheme'
import { themeEditorWindowControl } from '@/renderer/services'
import { isWin } from '@/renderer/shared/platform'
import ColorPicker from '@/ui/ColorPicker.vue'

const { tempTheme, getAllCssVarsDes, getThemeByCn, addTempTheme, saveTheme, getEditingThemeFromStorage, clearEditingThemeFromStorage } = useTheme()

// 原始主题备份
const originalThemeBackup = ref<any>(null)

const css_config = getAllCssVarsDes()

// 更新预览
function updatePreview() {
  if (!tempTheme.value)
    return

  // 同步更新 themeProperties
  tempTheme.value.data.themeProperties = {
    ...tempTheme.value.data.appCssProperties,
    ...tempTheme.value.data.milkdownCssProperties,
  }

  const root = document.documentElement

  // 全部应用
  Object.entries(tempTheme.value.data.themeProperties).forEach(([key, value]) => {
    root.style.setProperty(key, value)
  })
}

// 关闭窗口
function handleClose() {
  // 清理编辑状态
  clearEditingThemeFromStorage()

  if (window.electronAPI) {
    themeEditorWindowControl('close')
  }
}

// 重置主题
function handleReset() {
  if (!tempTheme.value || !originalThemeBackup.value) {
    return
  }

  // 恢复原始主题数据
  tempTheme.value = originalThemeBackup.value

  // 更新预览
  updatePreview()

  // 显示重置成功提示
  autotoast.show('主题已重置', 'warn')
}

// 保存主题
function handleSave() {
  // return
  saveTheme()

  // 关闭窗口
  handleClose()
}

// 组件挂载时初始化
onMounted(() => {
  // 从 localStorage 读取编辑中的主题数据
  const editingTheme = getEditingThemeFromStorage()

  if (editingTheme) {
    // 如果有主题数据，说明是编辑模式

    // 在列表中找到主题
    const theme = getThemeByCn(editingTheme)

    if (!theme) {
      autotoast.show('未找到指定主题', 'error')

      return
    }

    // 设置临时主题
    tempTheme.value = theme

    // 复制一份原始主题作为备份
    originalThemeBackup.value = JSON.parse(JSON.stringify(theme))
  } else {
    // 确保主题已初始化
    if (!tempTheme.value) {
      addTempTheme()
    }

    // 复制一份原始主题作为备份
    if (tempTheme.value) {
      originalThemeBackup.value = JSON.parse(JSON.stringify(tempTheme.value))
    }
  }

  // 应用当前主题到预览
  updatePreview()
})

// 组件卸载时处理
onUnmounted(() => {
  // 清理编辑状态
  clearEditingThemeFromStorage()
})

// 应用预设
function applyThemePreset(cn: ThemeName) {
  const theme = getThemeByCn(cn)

  const { milkdownCssProperties, appCssProperties } = theme.data

  tempTheme.value!.data.appCssProperties = appCssProperties
  tempTheme.value!.data.milkdownCssProperties = milkdownCssProperties

  // 同步更新 themeProperties
  tempTheme.value!.data.themeProperties = {
    ...appCssProperties,
    ...milkdownCssProperties,
  }

  updatePreview()
}

// 获取描述
function getCssVarDes(attr: string) {
  // 合并css_config中的所有配置对象
  const properties: Record<string, string> = {
    ...css_config.app,
    ...css_config.editor,
  }

  return properties[attr] || '未定义'
}

// 示例Markdown内容
const demoContent = `
<br />

# MilkUp

<br />

> 这是一段测试文字

<br />

***

<br />

* item1
* item2
* item3

代码：

\`\`\`JavaScript
const text = "Hello Word!"
console.log(text)
\`\`\`

<br />

| 1  | 2  | 3  |
| :- | :- | :- |
| 1  | 2  | 3  |
| 1  | 2  | 3  |


`
</script>

<template>
  <div class="theme-editor">
    <!-- 标题栏 -->
    <div class="TitleBarBox">
      <div class="title">
        主题编辑器
      </div>
      <div class="window-controls">
        <span v-if="isWin" class="iconfont icon-close" @click="handleClose"></span>
      </div>
    </div>

    <div class="editor-container">
      <!-- 左侧配置面板 -->
      <div class="config-panel">
        <div class="panel-header">
          <h2>主题配置</h2>
        </div>

        <div class="panel-content">
          <!-- 主题信息配置 -->
          <div v-if="tempTheme" class="config-section">
            <div class="section-header">
              <h3>主题信息</h3>
              <div class="section-description">
                设置主题的名称和描述
              </div>
            </div>
            <div class="form-section">
              <div class="variable-item">
                <label>主题名称</label>
                <input
                  v-model="tempTheme.label" type="text" class="text-input" placeholder="输入主题名称"
                  @change="updatePreview"
                />
              </div>
              <div class="variable-item">
                <label>主题描述</label>
                <textarea
                  v-model="tempTheme.description" class="text-area" placeholder="输入主题描述" rows="3"
                  @change="updatePreview"
                ></textarea>
              </div>
            </div>
          </div>

          <!-- 主题预设 -->
          <div class="config-section">
            <div class="section-header">
              <h3>主题预设</h3>
              <div class="section-description">
                快速应用预设主题
              </div>
            </div>
            <div class="form-section">
              <div class="preset-buttons">
                <button class="preset-btn" @click="applyThemePreset('normal')">
                  亮色
                </button>

                <button class="preset-btn" @click="applyThemePreset('normal-dark')">
                  暗色
                </button>
              </div>
            </div>
          </div>

          <!-- app -->
          <div class="config-section">
            <div class="section-header">
              <h3>应用颜色配置</h3>
              <div class="section-description">
                配置应用界面的颜色主题
              </div>
            </div>

            <div v-for="(_, attr) in tempTheme?.data.appCssProperties" :key="attr" class="form-section">
              <div class="variables-list">
                <div class="variable-item">
                  <label>{{ getCssVarDes(attr) }}</label>
                  <div class="color-input-group">
                    <ColorPicker
                      v-model="tempTheme!.data.appCssProperties[attr]" size="medium"
                      @change="updatePreview"
                    />
                    <input
                      v-model="tempTheme!.data.appCssProperties[attr]" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- editor -->
          <div class="config-section">
            <div class="section-header">
              <h3>编辑器颜色配置</h3>
              <div class="section-description">
                配置Markdown编辑器的颜色主题
              </div>
            </div>

            <div v-for="(_, attr) in tempTheme?.data.milkdownCssProperties" :key="attr" class="form-section">
              <div class="variables-list">
                <div class="variable-item">
                  <label>{{ getCssVarDes(attr) }}</label>
                  <div class="color-input-group">
                    <ColorPicker
                      v-model="tempTheme!.data.milkdownCssProperties[attr]" size="medium"
                      @change="updatePreview"
                    />
                    <input
                      v-model="tempTheme!.data.milkdownCssProperties[attr]" type="text" class="color-text"
                      @change="updatePreview"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="panel-footer">
          <div class="button-group">
            <button class="btn-reset" @click="handleReset">
              重置
            </button>
            <button class="btn-save" @click="handleSave">
              保存主题
            </button>
          </div>
        </div>
      </div>

      <!-- 右侧预览面板 -->
      <div class="preview-panel">
        <div class="panel-header">
          <h2>实时预览</h2>
        </div>
        <div class="preview-content">
          <MilkdownEditor :model-value="demoContent" class="preview-editor" />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.theme-editor {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--background-color);
  color: var(--text-color);
}

// 保存成功提示样式
.save-success-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  background: var(--primary-color);
  color: white;
  padding: 12px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateX(100%);
  opacity: 0;
  transition: all 0.3s ease;

  &.show {
    transform: translateX(0);
    opacity: 1;
  }

  .toast-content {
    display: flex;
    align-items: center;
    gap: 8px;

    .toast-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    span {
      font-size: 14px;
      font-weight: 500;
    }
  }
}

.TitleBarBox {
  -webkit-app-region: drag;
  /* ✅ 允许拖动窗口 */
  height: 32px;
  background: var(--background-color-1);
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  user-select: none;
  position: relative;

  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;
    position: absolute;
    right: 0;

    /* ✅ 控制按钮不能拖动 */
    span {
      cursor: pointer;
      font-size: 16px;
      color: var(--text-color-1);
      padding: 8px;

      &:hover {
        background: var(--hover-color);
      }

      &.icon-close:hover {
        background: #ff5f56;
        color: white;
      }
    }
  }
}

.editor-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.config-panel {
  width: 350px;
  background: var(--background-color-1);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;

  .panel-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-color);

    h2 {
      margin: 0;
      font-size: 16px;
      color: var(--text-color);
    }
  }

  .panel-content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;

    .error-message {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 16px;
      border: 1px solid #fcc;
    }

    .config-section {
      margin-bottom: 32px;
      border: 1px solid var(--border-color-1);
      border-radius: 8px;
      overflow: hidden;
      background: var(--background-color);

      .section-header {
        padding: 16px;
        background: var(--background-color-2);
        border-bottom: 1px solid var(--border-color);

        h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-color);
        }

        .section-description {
          font-size: 12px;
          color: var(--text-color-2);
          line-height: 1.4;
        }
      }
    }

    .form-section {
      // margin-bottom: 10px;
      padding: 10px 15px;

      h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: var(--text-color);
        border-bottom: 1px solid var(--border-color-1);
        padding-bottom: 6px;
        font-weight: 500;
      }

      .form-group {
        margin-bottom: 12px;

        label {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          color: var(--text-color);
          font-weight: 500;
        }

      }

      .variables-list {
        display: flex;
        flex-direction: column;
        gap: 8px;

        .variable-item {
          label {
            display: block;
            margin-bottom: 4px;
            font-size: 11px;
            color: var(--text-color);
          }

          .color-input-group {
            display: flex;
            align-items: center;
            gap: 8px;

            .color-text {
              flex: 1;
              font-size: 11px;
              padding: 4px 6px;
              border: 1px solid var(--border-color);
              border-radius: 4px;
              background: var(--background-color);
              color: var(--text-color);
              font-family: monospace;

              &:focus {
                outline: none;
                border-color: var(--primary-color);
              }
            }
          }
        }

        // 文本输入字段样式
        .text-input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          background: var(--background-color);
          color: var(--text-color);
          font-size: 12px;

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }
        }

        .text-area {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          background: var(--background-color);
          color: var(--text-color);
          font-size: 12px;
          resize: vertical;
          font-family: inherit;
          min-height: 60px;

          &:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 2px var(--primary-color-transparent);
          }
        }
      }

      .preset-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;

        .preset-btn {
          padding: 8px 12px;
          background: var(--background-color-2);
          color: var(--text-color);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s ease;

          &:hover {
            background: var(--hover-background-color);
            border-color: var(--hover-color);
          }

          &:active {
            background: var(--active-color);
            color: white;
          }
        }
      }
    }
  }

  .panel-footer {
    padding: 16px;
    border-top: 1px solid var(--border-color);

    .button-group {
      display: flex;
      gap: 8px;

      .btn-reset {
        flex: 1;
        padding: 10px;
        background: var(--background-color-2);
        color: var(--text-color);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;

        &:hover {
          background: var(--hover-background-color);
          border-color: var(--hover-color);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .btn-save {
        flex: 1;
        padding: 10px;
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;

        &:hover {
          opacity: 0.9;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .btn-export {
        flex: 1;
        padding: 10px;
        background: #4a90e2;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;

        &:hover {
          opacity: 0.9;
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }
    }
  }
}

.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;

  .panel-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-color);
    background: var(--background-color-1);

    h2 {
      margin: 0;
      font-size: 16px;
      color: var(--text-color);
    }
  }

  .preview-content {
    flex: 1;
    padding: 16px;
    background: var(--background-color);
    overflow: auto;

    .preview-editor {
      width: 100%;
      height: 100%;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
    }
  }
}

input,
select,
textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--background-color);
  color: var(--text-color);
  font-size: 12px;

  &:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--primary-color-transparent);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

textarea {
  resize: vertical;
  font-family: inherit;
}
</style>
