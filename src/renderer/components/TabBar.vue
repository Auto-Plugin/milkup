<script setup lang="ts">
import { ref } from 'vue'

const activeTabId = ref(1)

const tabList = ref([
  {
    id: 1,
    name: 'readme.md',
    isSave: true,

  },
  {
    id: 2,
    name: 'useThemes.md',
    isSave: false,

  },
  {
    id: 3,
    name: 'package.json',
    isSave: true,

  },
])

function handleTabClick(id: number) {
  console.log(id)
  activeTabId.value = id
}

function handleAddTab() {
  tabList.value.push({
    id: tabList.value.length + 1,
    name: 'newTab.md',
    isSave: false,
  })
}

function handleCloseTab(id: number) {
  tabList.value = tabList.value.filter(tab => tab.id !== id)
}
</script>

<template>
  <div class="tabBarContarner">
    <TransitionGroup name="tab" class="tabBar" mode="out-in" tag="div">
      <div
        v-for="tab in tabList" :key="tab.id" class="tabItem" :class="{ active: activeTabId === tab.id }"
        @click="handleTabClick(tab.id)"
      >
        <p>{{ tab.name }}</p>

        <div class="closeIcon">
          <span class="iconfont icon-close" @click="handleCloseTab(tab.id)"></span>
        </div>

        <!-- pre -->

        <svg
          :class="{ active: activeTabId === tab.id }" class="pre" viewBox="0 0 4 4" fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M3 3C3.7799 2.2201 3.99414 0 3.99414 0V3.99414H0C0 3.99414 2.2201 3.7799 3 3Z" />
        </svg>

        <!-- after -->
        <svg
          :class="{ active: activeTabId === tab.id }" class="after" viewBox="0 0 4 4" fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0.994141 3C0.214236 2.2201 1.90735e-06 0 1.90735e-06 0V3.99414H3.99414C3.99414 3.99414 1.77404 3.7799 0.994141 3Z"
          />
        </svg>
      </div>

      <div key="addTab" class="addTab" @click="handleAddTab">
        <div class="addTabLine"></div>
        <span class="iconfont icon-plus"></span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style lang="less" scoped>
.tabBarContarner {

  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  .tabBar {

    display: flex;
    justify-content: flex-start;
    // gap: 15px;
    height: 30px;

    .tabItem {
      position: relative;
      -webkit-app-region: no-drag;
      max-width: 200px;
      min-width: 150px;
      background: var(--background-color-1);
      // border: 1px solid var(--border-color-1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 10px;
      cursor: pointer;
      background: var(--background-color-2);
      gap: 15px;
      border-radius: 6px 6px 0 0;
      transition: all 0.3s ease;
      user-select: none;
      z-index: 0;

      .closeIcon {
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;

        span {
          font-size: 12px;
          cursor: pointer;
          color: var(--text-color-3);
        }
      }

      .closeIcon:hover {
        span {
          color: var(--text-color-1);
        }
      }

      p {
        margin: 0;
        font-size: 12px;
        color: var(--text-color-3);

      }

      span {
        font-size: 12px;
        cursor: pointer;
        color: var(--text-color-3);

        &:hover {
          color: var(--border-color-2);
        }

      }

      &.active {
        background: var(--background-color-1);
        box-shadow: 0px 0 6px 2px rgba(0, 0, 0, 0.1);
        z-index: 2;

        p {
          color: var(--text-color-1);
        }

        span {
          color: var(--text-color-1);
        }

      }

      &:hover {
        // background: var(--hover-color);
        z-index: 1;

        p {
          color: var(--text-color-2);
        }

        .closeIcon {

          span {
            color: var(--text-color-2);
          }
        }

        .pre {
          // fill: var(--hover-color);
        }

        .after {
          // fill: var(--hover-color);
        }
      }
    }

    .addTab {

      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      gap: 6px;

      span {
        border-radius: 4px;
        -webkit-app-region: no-drag;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        color: var(--text-color-3);
        padding: 4px 11px;

      }

      .addTabLine {
        width: 1px;
        height: 20px;
        background: var(--border-color-1);
      }

      &:hover {
        span {

          background: var(--hover-color);
        }

        .addTabLine {
          background: var(--border-color-2);
        }
      }

    }

    .pre {
      position: absolute;
      left: -10px;

      bottom: -10px;
      width: 10px;
      height: 10px;
      height: 100%;
      fill: var(--background-color-2);
      animation: fadeIn 0.3s ease;
      transition: all 0.3s ease;

      &.active {
        fill: var(--background-color-1);
      }

    }

    .after {
      position: absolute;
      right: -10px;
      bottom: -10px;
      width: 10px;
      height: 10px;
      height: 100%;
      fill: var(--background-color-2);
      animation: fadeIn 0.3s ease;
      transition: all 0.3s ease;

      &.active {
        fill: var(--background-color-1);
      }
    }
  }
}

.tab-move, /* 对移动中的元素应用的过渡 */
.tab-enter-active,
.tab-leave-active {
  transition: all 0.3s ease;
}

.tab-enter-from,
.tab-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

/* 确保将离开的元素从布局流中删除
  以便能够正确地计算移动的动画。 */
.tab-leave-active {
  position: absolute;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
