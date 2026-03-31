<script setup lang="ts">
import AppIcon from "@/renderer/components/ui/AppIcon.vue";
import AISetting from "./AISetting.vue";
import ImageConfig from "./ImageConfig.vue";
import SpellCheckSetter from "./SpellCheckSetter.vue";
import WorkspaceSetting from "./WorkspaceSetting.vue";

const settingSections = [
  {
    title: "拼写检查",
    desc: "控制编辑器中的拼写检查能力",
    icon: "check-circle",
    component: SpellCheckSetter,
  },
  {
    title: "图片粘贴",
    desc: "设置粘贴图片后的保存与上传方式",
    icon: "image-config",
    component: ImageConfig,
  },
  {
    title: "AI 续写设置",
    desc: "配置 AI 提供商、模型与连接参数",
    icon: "magic-wand",
    component: AISetting,
  },
  {
    title: "工作区",
    desc: "设置启动时自动打开的文件夹与左侧边栏状态",
    icon: "folder-opened",
    component: WorkspaceSetting,
  },
] as const;
</script>

<template>
  <div class="SettingBaseBox">
    <div v-for="section in settingSections" :key="section.title" class="settingItem">
      <div class="settingHeader">
        <span class="titleBadge">
          <AppIcon :name="section.icon" />
        </span>
        <div class="titleGroup">
          <h2 class="title">{{ section.title }}</h2>
          <span class="desc">{{ section.desc }}</span>
        </div>
      </div>
      <div class="settingContent">
        <component :is="section.component" />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.SettingBaseBox {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 10px 200px;
  box-sizing: border-box;
  gap: 40px;
  max-width: 800px;

  .settingItem {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0;

    .settingHeader {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .titleBadge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 14px;
      flex-shrink: 0;
      color: var(--primary-color);
      background: color-mix(in srgb, var(--primary-color) 14%, transparent);
      font-size: 18px;
    }

    .titleGroup {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .title {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.3;
      color: var(--text-color);
      margin: 0;
    }

    .desc {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-color-2);
    }

    .settingContent {
      padding-left: 54px;
    }
  }
}

@media (max-width: 768px) {
  .SettingBaseBox {
    padding: 0 10px 160px;

    .settingItem {
      .settingContent {
        padding-left: 0;
      }
    }
  }
}
</style>
