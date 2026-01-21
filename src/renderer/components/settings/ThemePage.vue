<script setup lang="ts">
import { onMounted } from 'vue'
import useTheme from '@/renderer/hooks/useTheme'

const { themes, currentTheme, init, setTheme, addTempTheme, removeTheme, exportTheme, importTheme } = useTheme()

onMounted(() => {
  init()
})
</script>

<template>
  <div class="ThemePageBox">
    <div class="theme-select-area">
      <div
        v-for="option in themes" :key="option.name" class="theme-select-item" :class="{
          'active': option.name === currentTheme,
          'custom-theme': option.isCustom,
        }" @click.stop="setTheme(option.name)"
      >
        <!-- 自定义主题：上下色块 + 文字 -->
        <template v-if="option.isCustom">
          <div class="custom-theme-ellipse">
            <div
              class="custom-theme-color-main"
              :style="{ backgroundColor: option.data?.themeProperties?.['--background-color'] }"
            ></div>
            <div
              class="custom-theme-color-second"
              :style="{ backgroundColor: option.data?.themeProperties?.['--background-color-2'] }"
            ></div>
          </div>
          <div class="custom-theme-text">
            <span class="custom-theme-label">{{ option.label }}</span>
            <div class="custom-theme-icons">
              <span class="iconfont icon-edit" title="编辑主题" @click.stop="addTempTheme(option.name)"></span>
              <span class="iconfont icon-download" title="下载主题" @click.stop="exportTheme(option.name)"></span>
              <span class="iconfont icon-close" title="删除主题" @click.stop="removeTheme(option.name)"></span>
            </div>
          </div>
        </template>

        <!-- 预设主题：上下布局 -->
        <template v-else>
          <div
            class="theme-select-item-main"
            :style="{ backgroundColor: option.data?.themeProperties?.['--background-color'] }"
          ></div>
          <div
            class="theme-select-item-seceond"
            :style="{ backgroundColor: option.data?.themeProperties?.['--background-color-2'] }"
          ></div>
        </template>
      </div>

      <div class="theme-select-add " @click.stop="addTempTheme()">
        <div class="theme-select-add-btn">
          <span class="iconfont icon-plus"></span>
        </div>
      </div>
    </div>

    <div class="theme-preview-frame">
      <div class="theme-preview-page">
        <div class="theme-preview-container">
          <div class="theme-preview-tabbar">
            <div class="theme-preview-tabbar-item active">
              <p>readme.md</p>
              <div class="closeIcon">
                <span class="iconfont icon-close"></span>
              </div>
              <!-- pre -->
              <svg class="pre active" viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 5L0 5C3.33333 5 5 3.33333 5 -2.18557e-07L5 5Z" />
              </svg>
              <!-- after -->
              <svg class="after active" viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 5L5 5C1.66667 5 7.28523e-08 3.33333 2.18557e-07 -2.18557e-07L0 5Z" />
              </svg>
            </div>

            <div class="addTab">
              <div class="addTabLine"></div>
              <span class="iconfont icon-plus"></span>
            </div>
          </div>
          <div class="theme-preview-content">
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
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.ThemePageBox {
  width: 100%;
  height: 100%;
  padding: 0px;

  .theme-select-area {
    width: 100%;
    display: flex;
    flex-direction: row;
    box-sizing: border-box;
    gap: 20px;

    .theme-select-item {
      display: flex;
      flex-direction: column;
      height: 40px;
      width: 40px;
      border-radius: 50%;
      overflow: hidden;
      border: 2px solid var(--background-color-3);
      box-shadow: rgba(0, 0, 0, 0.34) 0px 0px 2px;
      cursor: pointer;
      transition: all 0.3s;

      &:hover {
        opacity: 0.6;
      }

      &.active {
        border: 2px solid var(--primary-color);
      }

      // 自定义主题样式
      &.custom-theme {
        flex-direction: row;
        align-items: center;
        height: 40px;
        width: auto;
        min-width: 120px;
        padding: 0 2px;
        border-radius: 100px;
        gap: 8px;

        .custom-theme-ellipse {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          overflow: hidden;
          //  border: 1px solid var(--background-color-3);
          box-shadow: rgba(0, 0, 0, 0.34) 0px 0px 4px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;

          .custom-theme-color-main {
            flex: 1;
          }

          .custom-theme-color-second {
            flex: 1;
          }
        }

        .custom-theme-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 80px;
          position: relative;

          .custom-theme-label {
            font-size: 12px;
            color: var(--text-color-3);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: opacity 0.2s ease;
          }

          .custom-theme-icons {
            display: flex;
            padding-right: 10px;
            gap: 10px;
            align-items: center;
            justify-content: flex-end;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            opacity: 0;
            visibility: hidden;
            transition: all 0.2s ease;

            .iconfont {
              font-size: 16px;
              color: var(--text-color-3);
              cursor: pointer;
              transition: all 0.2s ease;

              &:hover {
                transform: scale(1.1);
              }

              &.icon-edit:hover {
                color: var(--primary-color);
              }

              &.icon-download:hover {
                color: #10b981;
              }

              &.icon-close:hover {
                color: #ef4444;
              }
            }
          }

          &:hover {
            .custom-theme-label {
              opacity: 0;
            }

            .custom-theme-icons {
              opacity: 1;
              visibility: visible;
            }
          }
        }
      }

      .theme-select-item-main {
        flex: 1;
      }

      .theme-select-item-seceond {
        flex: 1;
      }
    }

    .theme-select-add {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 40px;
      width: 40px;
      padding: 0px;
      box-sizing: border-box;
      border-radius: 50%;
      overflow: hidden;
      //  background: linear-gradient(141deg, rgba(64, 158, 255, 0.46563635219712884) 0%, rgba(39, 164, 47, 0.3844038591999299) 33%, rgba(162, 49, 59, 0.5552722065388656) 59%, rgba(64, 158, 255, 0.4628352317489496) 100%);
      filter:
        drop-shadow(0 0px 1px rgba(0, 128, 255, 0.1)) drop-shadow(1px 1px 2px rgba(64, 255, 77, 0.15)) drop-shadow(-1px 1px 2px rgba(255, 107, 119, 0.15)) drop-shadow(1px -1px 2px rgba(255, 193, 7, 0.15)) drop-shadow(-1px -1px 2px rgba(138, 43, 226, 0.15)) drop-shadow(0 0px 4px rgba(255, 20, 147, 0.1));
      cursor: pointer;
      transition: all 0.3s;

      .theme-select-add-btn {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: var(--background-color-1);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      span {
        color: var(--text-color-1);
        font-size: 16px;
        font-weight: bold;
      }

      &:hover {
        opacity: 0.6;
      }

      .theme-select-item-main {
        flex: 1;
      }

      .theme-select-item-seceond {
        flex: 1;
      }
    }

  }

  .theme-preview-frame {

    // background: #000;
    width: 100%;
    // max-width: 700px;
    height: 100%;
    padding: 10px 0px 0 0;
    box-sizing: border-box;
    margin-top: 15px;

    position: relative;

    // 添加下方淡黑色渐变阴影
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 70px;
      background: linear-gradient(to bottom, transparent, var(--background-color));
      border-radius: 0 0 4px 4px;
      pointer-events: none;
    }

    .theme-preview-page {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      width: 100%;
      height: 280px;
      border-radius: 4px;
      box-shadow: rgba(0, 0, 0, 0.14) 0px 0px 3px;
      background-color: var(--background-color-3);
      // margin: 20px 0;
      padding: 10px 20px;
      box-sizing: border-box;

      .theme-preview-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: center;
      }

      .theme-preview-tabbar {
        width: 100%;
        height: 35px;
        background-color: var(--background-color-2);
        display: flex;
        border-radius: 5px 5px 0 0;
        justify-content: flex-start;
        position: relative;
        padding: 0 30px;
        box-sizing: border-box;
        overflow: hidden;

        .theme-preview-tabbar-item {
          position: absolute;
          bottom: 0px;
          // max-width: 120px;
          min-width: 100px;
          width: 100px;
          height: 26px;
          flex-shrink: 0;
          // background: var(--background-color-2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 8px;
          cursor: pointer;
          gap: 6px;
          border-radius: 6px 6px 0 0;
          // transition: all 0.3s ease;
          user-select: none;
          z-index: 0;

          .closeIcon {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;

            span {
              font-size: 10px;
              line-height: 20px;
              cursor: pointer;
              color: var(--text-color-3);
            }
          }

          p {
            margin: 0;
            font-size: 10px;
            color: var(--text-color-3);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            min-width: 0;
          }

          &.active {
            background: var(--background-color-1);
            box-shadow: 0 0px 6px rgba(0, 0, 0, 0.1);
            z-index: 2;

            p {
              color: var(--text-color-1);
            }

            .closeIcon span {
              color: var(--text-color-1);
            }
          }

          .pre {
            position: absolute;
            left: -10px;
            top: 17px;
            width: 10px;
            height: 10px;
            fill: var(--background-color-2);
            // transition: all 0.3s ease;

            &.active {
              fill: var(--background-color-1);
            }
          }

          .after {
            position: absolute;
            right: -10px;
            top: 17px;
            width: 10px;
            height: 10px;
            fill: var(--background-color-2);
            // transition: all 0.3s ease;

            &.active {
              fill: var(--background-color-1);
            }
          }
        }

        .addTab {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          gap: 4px;
          flex-shrink: 0;
          min-width: 30px;

          span {
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            cursor: pointer;
            color: var(--text-color-3);
            padding: 2px 6px;
          }

          .addTabLine {
            width: 0px;
            height: 15px;
            background: var(--border-color-1);
          }

        }
      }

      .theme-preview-content {
        width: 100%;
        height: calc(100% - 30px);
        border-radius: 0 0 5px 5px;
        background-color: var(--background-color-1);
        padding: 20px;
        box-sizing: border-box;
        position: relative;
        z-index: 1;

        .preview-header {
          height: 12px;
          width: 30%;
          background-color: currentColor;
          opacity: 0.7;
          border-radius: 4px;
          margin-bottom: 12px;
        }

        .preview-lines {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 20px;

          .preview-line {
            height: 8px;
            background-color: currentColor;
            opacity: 0.5;
            border-radius: 4px;

            &:nth-child(1) {
              width: 60%;
            }

            &:nth-child(2) {
              width: 55%;
            }

            &:nth-child(3) {
              width: 45%;
            }
          }
        }
      }
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
