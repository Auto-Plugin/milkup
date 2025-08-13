<script setup lang="ts">
import { onMounted } from 'vue'
import useTheme from '@/hooks/useTheme'

const { currentTheme, init, setTheme, getThemes } = useTheme()

function customTheme() {
  window.electronAPI.openThemeEditor()
}

onMounted(() => init())
</script>

<template>
  <div class="ThemePageBox">
    <div class="theme-header">
      <h2>主题</h2>
    </div>

    <div class="theme-grid">
      <div
        v-for="option in getThemes()" :key="option.name" class="theme-card"
        :class="{ active: option.name === currentTheme }" @click.stop="setTheme(option.name)"
      >
        <div class="theme-preview" :style="{ backgroundColor: option.data.themeProperties['--background-color'] }">
          <div class="preview-content">
            <div class="preview-header" :style="{ backgroundColor: option.data.themeProperties['--text-color-1'] }">
            </div>
            <div class="preview-lines">
              <div class="preview-line" :style="{ backgroundColor: option.data.themeProperties['--text-color-1'] }">
              </div>
              <div class="preview-line" :style="{ backgroundColor: option.data.themeProperties['--text-color-2'] }">
              </div>
              <div class="preview-line" :style="{ backgroundColor: option.data.themeProperties['--text-color-3'] }">
              </div>
            </div>
          </div>
        </div>
        <div class="theme-info">
          <div class="theme-title">
            <h3>{{ option.label }}</h3>
          </div>
          <p>{{ option.description }}</p>
        </div>
      </div>

      <div class="theme-card" @click.stop="customTheme">
        <div class="theme-preview">
          <div class="preview-content">
            <div class="preview-header">
            </div>
            <div class="preview-lines">
              <div class="preview-line">
              </div>
              <div class="preview-line">
              </div>
              <div class="preview-line">
              </div>
            </div>
          </div>
        </div>
        <div class="theme-info">
          <div class="theme-title">
            <h3>自定义主题</h3>
          </div>
          <p>打开主题编辑器</p>
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

            .edit-btn {
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

              .icon {
                width: 20px;
                height: 20px;
                fill: currentColor;
              }
            }

            .export-btn {
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

              .icon {
                width: 20px;
                height: 20px;
                fill: currentColor;
              }
            }

            .delete-btn {
              background: none;
              border: none;
              color: var(--text-color-3);
              font-size: 18px;
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

              .icon {
                width: 20px;
                height: 20px;
                fill: currentColor;
              }
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
