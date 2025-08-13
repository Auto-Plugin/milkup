<script setup lang="ts">
import type { ThemeName } from '@/types/theme'
import { onMounted, onUnmounted } from 'vue'

import useTheme from '@/hooks/useTheme'
import MilkdownEditor from './MilkdownEditor.vue'

const { tempTheme, getAllCssVarsDes, getThemes, getThemeByCn } = useTheme()
console.log(getAllCssVarsDes())

const css_config = getAllCssVarsDes()

// 更新预览
function updatePreview() {

}

// 关闭窗口
function handleClose() {
  console.log('主题编辑器关闭按钮被点击')
  if (window.electronAPI) {
    console.log('调用主题编辑器窗口控制: close')
    window.electronAPI.themeEditorWindowControl('close')
  } else {
    console.log('window.electronAPI 不存在')
  }
}

// 保存主题
function handleSave() {
  // // 获取自定义主题列表
  // const customThemesList = getCustomThemes()

  // // 查找临时主题
  // const tempTheme = customThemesList.find(theme => theme.name.startsWith('temp-theme-'))

  // if (tempTheme) {
  //     // 更新临时主题的变量
  //     tempTheme.variables = { ...themeVariables.value }
  //     tempTheme.color = themeVariables.value['--primary-color'] || '#4a90e2'
  //     tempTheme.label = themeLabel.value || '自定义主题'
  //     tempTheme.description = themeDescription.value || '自定义创建的主题'

  //     // 更新localStorage中的临时主题
  //     const updatedList = customThemesList.map(theme =>
  //         theme.name === tempTheme.name ? tempTheme : theme,
  //     )
  //     localStorage.setItem('custom-themes', JSON.stringify(updatedList))

  //     // 通知主窗口主题已更新
  //     if (window.electronAPI) {
  //         window.electronAPI.saveCustomTheme(tempTheme)
  //     }

  //     // 显示保存成功提示
  //     autolog.log('主题保存成功', 'success')

  //     // 保存成功后关闭窗口
  //     setTimeout(() => {
  //         if (window.electronAPI) {
  //             window.electronAPI.themeEditorWindowControl('close')
  //         }
  //     }, 300)
  // } else {
  //     // 如果没有临时主题，创建新的自定义主题
  //     const themeName = `custom-theme-${Date.now()}`

  //     const customTheme = {
  //         name: themeName,
  //         label: themeLabel.value || '自定义主题',
  //         color: themeVariables.value['--primary-color'] || '#4a90e2',
  //         description: themeDescription.value || '自定义创建的主题',
  //         variables: themeVariables.value,
  //     }

  //     // 保存主题
  //     if (window.electronAPI) {
  //         window.electronAPI.saveCustomTheme(customTheme)
  //     }

  //     // 显示保存成功提示
  //     autolog.log('主题保存成功', 'success')

  //     // 保存成功后关闭窗口
  //     setTimeout(() => {
  //         if (window.electronAPI) {
  //             window.electronAPI.themeEditorWindowControl('close')
  //         }
  //     }, 1000) // 延迟1秒让用户看到保存成功的反馈
  // }
}

// 组件挂载时初始化
onMounted(() => {

})

// 组件卸载时处理
onUnmounted(() => {
  console.log('主题编辑器组件卸载...')

  // 如果编辑的是临时主题但没有保存，则恢复原始主题
})

function applyThemePreset(cn: ThemeName) {
  console.log(cn)

  const theme = getThemeByCn(cn)

  const { milkdownCssProperties, themeProperties } = theme.data

  tempTheme.value!.data.themeProperties = themeProperties
  tempTheme.value!.data.milkdownCssProperties = milkdownCssProperties

  //   updatePreview()
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
        <span class="iconfont icon-close" @click="handleClose"></span>
      </div>
    </div>

    <div class="editor-container">
      <!-- 左侧配置面板 -->
      <div class="config-panel">
        <div class="panel-header">
          <h2>主题配置</h2>
        </div>

        <div class="panel-content">
          <!-- 错误消息 -->
          <!-- <div v-if="errorMessage" class="error-message">
                        {{ errorMessage }}
                    </div> -->

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
                  v-model="tempTheme.description" class="text-area" placeholder="输入主题描述"
                  rows="3" @change="updatePreview"
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

          <!-- 动态生成配置区域 -->
          <div v-for="config of css_config" :key="config.title" class="config-section">
            <div class="section-header">
              <h3>{{ config.title }}</h3>
              <div class="section-description">
                {{ config.description }}
              </div>
            </div>

            <div v-for="section in config.sections" :key="section.title" class="form-section">
              <h4>{{ section.title }}</h4>
              <div class="variables-list">
                <div v-for="variable in section.variables" :key="variable.key" class="variable-item">
                  <label>{{ variable.label }}</label>
                  <div class="color-input-group">
                    <input
                      v-model="themeVariables[variable.key]" type="color" class="color-picker"
                      @change="updatePreview"
                    />
                    <input
                      v-model="themeVariables[variable.key]" type="text" class="color-text"
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
            <button class="btn-reset" @click="resetToCurrentTheme">
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
    justify-content: space-between;
    padding: 0 0 0 12px;
    user-select: none;

    .window-controls {
        display: flex;
        -webkit-app-region: no-drag;

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
            margin-bottom: 24px;
            padding: 16px;

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
                        gap: 6px;

                        .color-picker {
                            width: 40px;
                            height: 28px;
                            border: 1px solid var(--border-color);
                            border-radius: 4px;
                            cursor: pointer;
                            background: none;

                            &::-webkit-color-swatch-wrapper {
                                padding: 1px;
                            }

                            &::-webkit-color-swatch {
                                border: none;
                                border-radius: 2px;
                            }

                            &:disabled {
                                cursor: not-allowed;
                            }
                        }

                        .color-text {
                            flex: 1;
                            font-size: 11px;
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
</style>
