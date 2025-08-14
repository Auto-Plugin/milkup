<script setup lang="ts">
import type { ThemeName } from '@/types/theme'
import { onMounted } from 'vue'
import useTheme from '@/hooks/useTheme'

const { themes, currentTheme, init, setTheme, addTempTheme, removeTheme } = useTheme()

function customTheme(themeName: ThemeName) {
  addTempTheme(themeName)
}

function downloadTheme() {
  // TODO: 实现下载主题功能
  console.log('下载主题功能待实现')
}

function addTheme() {
  addTempTheme()
}

function deleteTheme(themeName: ThemeName) {
  removeTheme(themeName)
}

onMounted(() => {
  init()
})
</script>

<template>
  <div class="ThemePageBox">
    <div class="theme-header">
      <h2>主题</h2>
    </div>

    <div v-if="themes.length" class="theme-grid">
      <div
        v-for="option in themes" :key="option.name" class="theme-card"
        :class="{ active: option.name === currentTheme }" @click.stop="setTheme(option.name)"
      >
        <div class="theme-preview" :style="{ backgroundColor: option.data?.themeProperties?.['--background-color'] }">
          <div class="preview-content">
            {{ option.data?.themeProperties?.['--text-color-1'] }}
            <div class="preview-header" :style="{ backgroundColor: option.data?.themeProperties?.['--text-color-1'] }">
            </div>
            <div class="preview-lines">
              {{ option.data?.themeProperties?.['--text-color-2'] }}
              <div class="preview-line" :style="{ backgroundColor: option.data?.themeProperties?.['--text-color-1'] }">
              </div>
              <div class="preview-line" :style="{ backgroundColor: option.data?.themeProperties?.['--text-color-2'] }">
              </div>
              <div class="preview-line" :style="{ backgroundColor: option.data?.themeProperties?.['--text-color-3'] }">
              </div>
            </div>
          </div>
        </div>
        <div class="theme-info">
          <div class="theme-title">
            <h3>{{ option.label }}</h3>
            <div v-if="option.isCustom" class="theme-actions">
              <div class="edit-btn" title="编辑主题" @click.stop="customTheme(option.name)">
                <span class="iconfont icon-edit"></span>
              </div>
              <div class="download-btn" title="下载主题" @click.stop="downloadTheme">
                <span class="iconfont icon-download"></span>
              </div>
              <div class="delete-btn" title="删除主题" @click.stop="deleteTheme(option.name)">
                <span class="iconfont icon-close"></span>
              </div>
            </div>
          </div>
          <p>{{ option.description }}</p>
        </div>
      </div>

      <div class="theme-card add-theme-card" @click.stop="addTheme">
        <div class="theme-preview">
          <div class="preview-content">
            <div class="add-icon">
              <span class="iconfont icon-plus"></span>
            </div>
            <div class="add-text">
              <span>添加主题</span>
            </div>
            <div class="drag-hint">
              <span>或拖入主题文件</span>
            </div>
          </div>
        </div>
        <div class="theme-info">
          <div class="theme-title">
            <h3>自定义主题</h3>
          </div>
          <p>创建或导入自定义主题</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ThemePageBox {
  width: 100%;
  height: 100%;
  padding: 0 20px 20px 20px;

  .theme-header {
    margin-bottom: 24px;

    h2 {
      font-size: 20px;
      color: var(--text-color);
      margin-bottom: 8px;
    }

    p {
      font-size: 14px;
      color: var(--text-color-2);
    }
  }

  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 16px;
    margin-bottom: 24px;

    .theme-card {
      background: var(--background-color-2);
      border: 1px solid var(--border-color-2);
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

        .theme-actions {
          opacity: 1;
        }
      }

      &.active {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px var(--primary-color-transparent);
      }

      &.add-custom-theme {
        border-style: dashed;
        border-color: var(--border-color-1);
        position: relative;

        &:hover {
          border-color: var(--primary-color);
          background: var(--hover-background-color);
        }

        &.drag-over {
          border-color: var(--primary-color);
          background: var(--primary-color-transparent);
          transform: scale(1.02);
        }

        .add-custom-preview {
          height: 140px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background-color-1);
          position: relative;

          .add-icon {
            font-size: 48px;
            color: var(--text-color-3);
            font-weight: 300;
            transition: opacity 0.2s;
          }

          .drag-hint-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(74, 144, 226, 0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            opacity: 0;
            transition: opacity 0.2s;
            border-radius: 6px 6px 0 0;

            .drag-icon {
              width: 32px;
              height: 32px;
              margin-bottom: 8px;
            }

            span {
              font-size: 12px;
              font-weight: 500;
            }
          }

          &:hover .drag-hint-overlay {
            opacity: 1;
          }
        }
      }

      .theme-preview {
        height: 140px;
        width: 100%;
        padding: 12px;

        .preview-content {
          height: 100%;
          border-radius: 4px;
          padding: 8px;

          &.light-preview {
            background-color: rgba(255, 255, 255, 0.85);
            color: #333;
          }

          &.dark-preview {
            background-color: rgba(0, 0, 0, 0.75);
            color: #eee;
          }

          .preview-header {
            height: 12px;
            width: 70%;
            background-color: currentColor;
            opacity: 0.7;
            border-radius: 4px;
            margin-bottom: 12px;
          }

          .preview-lines {
            display: flex;
            flex-direction: column;
            gap: 6px;

            .preview-line {
              height: 8px;
              background-color: currentColor;
              opacity: 0.5;
              border-radius: 4px;

              &:nth-child(1) {
                width: 100%;
              }

              &:nth-child(2) {
                width: 85%;
              }

              &:nth-child(3) {
                width: 65%;
              }
            }
          }
        }
      }

      .theme-info {
        padding: 12px;

        .theme-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;

          h3 {
            font-size: 16px;
            color: var(--text-color);
            margin: 0;
          }

          .theme-actions {
            display: flex;
            gap: 6px;
            align-items: center;

            .edit-btn,
            .download-btn,
            .delete-btn {
              background: none;
              border: none;
              color: var(--text-color-3);
              font-size: 14px;
              cursor: pointer;
              width: 30px;
              height: 30px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 3px;
              opacity: 0.7;
              transition: all 0.2s ease;

              &:hover {
                background: var(--hover-background-color);
                color: var(--text-color-1);
                opacity: 1;
              }

              .iconfont {
                font-size: 16px;
              }
            }

            .edit-btn:hover {
              color: var(--primary-color);
            }

            .download-btn:hover {
              color: #10b981;
            }

            .delete-btn:hover {
              color: #ef4444;
            }
          }
        }

        h3 {
          font-size: 16px;
          color: var(--text-color);
          margin-bottom: 6px;
        }

        p {
          font-size: 13px;
          color: var(--text-color-2);
          line-height: 1.4;
          margin: 0;
        }
      }

      // 添加主题卡片样式
      &.add-theme-card {
        border: 2px dashed var(--border-color-1);
        background: var(--background-color-1);
        position: relative;
        transition: all 0.3s ease;

        &:hover {
          border-color: var(--primary-color);
          background: var(--hover-background-color);
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
        }

        &.drag-over {
          border-color: var(--primary-color);
          background: var(--primary-color-transparent);
          transform: scale(1.02);
          box-shadow: 0 8px 20px rgba(74, 144, 226, 0.2);
        }

        .theme-preview {
          .preview-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            background: transparent;
            gap: 12px;

            .add-icon {
              width: 48px;
              height: 48px;
              border-radius: 50%;

              display: flex;
              align-items: center;
              justify-content: center;
              color: var(--text-color-1);
              font-size: 24px;
              transition: all 0.3s ease;

              .iconfont {
                font-size: 24px;
              }
            }

            .add-text {
              span {
                font-size: 16px;
                font-weight: 600;
                color: var(--text-color);
              }
            }

            .drag-hint {
              span {
                font-size: 12px;
                color: var(--text-color-2);
                opacity: 0.8;
              }
            }
          }
        }

        .theme-info {
          background: var(--background-color-2);
          border-top: 1px solid var(--border-color-1);

          .theme-title {
            display: flex;
            justify-content: space-between;
            align-items: center;

            h3 {
              color: var(--primary-color);
              font-weight: 600;
            }

            .theme-actions {
              display: flex;
              gap: 4px;
              opacity: 0;
              transition: opacity 0.2s ease;

              .edit-btn,
              .download-btn,
              .delete-btn {
                background: none;
                border: none;
                color: var(--text-color-3);
                cursor: pointer;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                opacity: 0.7;
                transition: all 0.2s ease;

                &:hover {
                  background: var(--hover-background-color);
                  color: var(--text-color-1);
                  opacity: 1;
                }

                .icon {
                  width: 16px;
                  height: 16px;
                  fill: currentColor;
                }
              }

              .edit-btn:hover {
                color: var(--primary-color);
              }

              .download-btn:hover {
                color: #10b981;
              }

              .delete-btn:hover {
                color: #ef4444;
              }
            }
          }

          p {
            color: var(--text-color-2);
          }
        }

        // 拖拽悬停效果
        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, var(--primary-color-transparent) 0%, transparent 100%);
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          border-radius: 6px;
        }

        &.drag-over::before {
          opacity: 1;
        }
      }
    }
  }

}

// 通知样式
.theme-notification {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 16px;
  border-radius: 6px;
  color: white;
  font-size: 14px;
  z-index: 10000;
  animation: slideIn 0.3s ease;

  &.success {
    background: #10b981;
  }

  &.error {
    background: #ef4444;
  }
}

// 确认对话框样式
.theme-confirm-dialog {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;

  .dialog-content {
    background: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    padding: 24px;
    max-width: 400px;
    width: 90%;

    p {
      margin: 0 0 20px 0;
      color: var(--text-color);
      font-size: 16px;
    }

    .dialog-buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;

      button {
        padding: 8px 16px;
        border-radius: 4px;
        border: none;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;

        &.btn-cancel {
          background: var(--background-color-1);
          color: var(--text-color-2);
          border: 1px solid var(--border-color-1);

          &:hover {
            background: var(--hover-background-color);
            color: var(--text-color-1);
          }
        }

        &.btn-confirm {
          background: var(--primary-color);
          color: white;

          &:hover {
            background: var(--active-color);
          }
        }
      }
    }
  }
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }

  to {
    transform: translateX(0);
    opacity: 1;
  }
}
</style>
