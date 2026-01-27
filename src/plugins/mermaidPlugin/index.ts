import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { MermaidConfig as MermaidLibConfig } from "mermaid";
import "./style.css"; // Import styles

import { LanguageDescription } from "@codemirror/language";
import { codeBlockConfig } from "@milkdown/kit/component/code-block";
import { commandsCtx } from "@milkdown/kit/core";
import { $command, $ctx } from "@milkdown/kit/utils";
import {
  addBlockTypeCommand,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
} from "@milkdown/preset-commonmark";
import mermaid from "mermaid";
import { mermaid as mermaidLang } from "codemirror-lang-mermaid";

// ============ 类型定义 ============

/** 插件配置 */
export interface MermaidConfig {
  /** mermaid 初始化配置 */
  mermaidOptions: MermaidLibConfig;
  /** 渲染中占位符文本 */
  placeholder: string;
  /** 错误时显示的前缀 */
  errorPrefix: string;
}

/** 默认配置 */
const defaultMermaidConfig: MermaidConfig = {
  mermaidOptions: {
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
  },
  placeholder: "渲染中...",
  errorPrefix: "Mermaid Error: ",
};

// ============ 配置 Slice ============

export const mermaidConfig = $ctx(defaultMermaidConfig, "mermaidConfigCtx");

/**
 * 合并配置的工具函数
 */
export function mergeMermaidConfig(
  options: Partial<MermaidConfig>
): (prev: MermaidConfig) => MermaidConfig {
  return (prev) => ({
    ...prev,
    ...options,
    mermaidOptions: options.mermaidOptions
      ? { ...prev.mermaidOptions, ...options.mermaidOptions }
      : prev.mermaidOptions,
  });
}

// ============ 图标 ============

export const mermaidIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`;

// ============ 渲染函数 ============

/**
 * 渲染 Mermaid 图表
 * 返回带占位符的 HTML，异步更新为 SVG
 */
function renderMermaid(content: string, config: MermaidConfig): string {
  try {
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    mermaid
      .render(id, content)
      .then(({ svg }) => {
        const previewEl = document.querySelector(`[data-mermaid-id="${id}"]`);
        if (previewEl) {
          previewEl.innerHTML = svg;
        }
      })
      .catch((err) => {
        const previewEl = document.querySelector(`[data-mermaid-id="${id}"]`);
        if (previewEl) {
          previewEl.innerHTML = `<div class="mermaid-error">${config.errorPrefix}${err.message}</div>`;
        }
      })
      .finally(() => {
        // 清理 mermaid 渲染时创建的临时元素
        // mermaid.render 会在 body 中创建 id 为 "d" + id 的容器
        const tempContainer = document.getElementById(`d${id}`);
        if (tempContainer) {
          tempContainer.remove();
        }
        // 也清理可能残留的 SVG 元素
        const tempSvg = document.getElementById(id);
        if (tempSvg && !tempSvg.closest(`[data-mermaid-id="${id}"]`)) {
          tempSvg.remove();
        }
      });

    return `<div data-mermaid-id="${id}" class="mermaid-preview">${config.placeholder}</div>`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `<div class="mermaid-error">${config.errorPrefix}${message}</div>`;
  }
}

// ============ CodeMirror 语言 ============

/**
 * 创建 Mermaid 语言描述
 */
function createMermaidLanguage(): LanguageDescription {
  return LanguageDescription.of({
    name: "Mermaid",
    alias: ["mermaid", "diagram", "flowchart"],
    extensions: [".mmd"],
    load: async () => {
      return mermaidLang();
    },
  });
}

// ============ 命令 ============

/**
 * 插入 Mermaid 代码块命令
 */
export const insertMermaidCommand = $command("insertMermaid", (ctx) => () => {
  return (_state, _dispatch) => {
    const commands = ctx.get(commandsCtx);
    commands.call(clearTextInCurrentBlockCommand.key);
    const codeBlock = codeBlockSchema.type(ctx);
    commands.call(addBlockTypeCommand.key, {
      nodeType: codeBlock,
      attrs: { language: "mermaid" },
    });
    return true;
  };
});

// ============ 斜杠菜单项配置 ============

/**
 * Mermaid 斜杠菜单项配置
 * 可直接用于 registry.registerItem()
 */
export const mermaidSlashMenuItem = {
  id: "mermaid",
  label: "流程图",
  icon: mermaidIcon,
  keywords: [
    "mermaid",
    "diagram",
    "chart",
    "flow",
    "flowchart",
    "sequence",
    "gantt",
    "流程图",
    "图表",
    "时序图",
  ],
  action: (ctx: unknown) => {
    const commands = (ctx as { get: (key: unknown) => { call: (key: unknown) => void } }).get(
      commandsCtx
    );
    commands.call(insertMermaidCommand.key);
  },
};

// ============ 初始化插件 ============

/**
 * 清理残留的 mermaid 临时元素
 */
function cleanupMermaidElements() {
  // 清理所有以 "dmermaid-" 开头的容器（mermaid 渲染时创建的）
  document.querySelectorAll('[id^="dmermaid-"]').forEach((el) => el.remove());
  // 清理所有不在预览容器内的 mermaid SVG
  document.querySelectorAll('svg[id^="mermaid-"]').forEach((el) => {
    if (!el.closest("[data-mermaid-id]")) {
      el.remove();
    }
  });
}

/**
 * 初始化插件
 * 配置 mermaid 和 codeBlockConfig
 */
const mermaidInitPlugin: MilkdownPlugin = (ctx) => async () => {
  await Promise.resolve();

  const config = ctx.get(mermaidConfig.key);

  // 清理可能残留的元素
  cleanupMermaidElements();

  // 初始化 mermaid
  mermaid.initialize(config.mermaidOptions);

  // 配置代码块
  ctx.update(codeBlockConfig.key, (prev) => ({
    ...prev,
    languages: [...(prev.languages || []), createMermaidLanguage()],
    renderPreview: (language: string, content: string, applyPreview: unknown) => {
      if (
        typeof language === "string" &&
        language.toLowerCase() === "mermaid" &&
        content.length > 0
      ) {
        return renderMermaid(content, config);
      }
      const renderPreview = prev.renderPreview as
        | ((lang: string, content: string, apply: unknown) => string | undefined)
        | undefined;
      return renderPreview?.(language, content, applyPreview);
    },
  }));
};

// ============ 导出插件 ============

/**
 * Mermaid 插件 (Renamed to 'diagram' for compatibility with existing imports)
 */
export const diagram: MilkdownPlugin[] = [mermaidConfig, insertMermaidCommand, mermaidInitPlugin];

export default diagram;
