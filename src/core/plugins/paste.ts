/**
 * Milkup 粘贴处理插件
 *
 * 处理粘贴的 Markdown 文本和图片
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Node, Schema } from "prosemirror-model";
import { MarkdownParser } from "../parser";
import { milkupSchema } from "../schema";

/** 插件 Key */
export const pastePluginKey = new PluginKey("milkup-paste");

/** 图片粘贴方式 */
export type ImagePasteMethod = "base64" | "local" | "remote";

/** 图片上传函数类型 */
export type ImageUploader = (file: File) => Promise<string>;

/** 本地图片保存函数类型 */
export type LocalImageSaver = (file: File) => Promise<string>;

/** 粘贴插件配置 */
export interface PastePluginConfig {
  /** 获取图片粘贴方式 */
  getImagePasteMethod?: () => ImagePasteMethod;
  /** 图片上传函数（用于 remote 模式） */
  imageUploader?: ImageUploader;
  /** 本地图片保存函数（用于 local 模式） */
  localImageSaver?: LocalImageSaver;
}

/** 默认配置 */
const defaultConfig: PastePluginConfig = {
  getImagePasteMethod: () => {
    const method = localStorage.getItem("pasteMethod");
    return (method as ImagePasteMethod) || "base64";
  },
};

/**
 * 创建粘贴处理插件
 */
export function createPastePlugin(config: PastePluginConfig = {}): Plugin {
  const parser = new MarkdownParser(milkupSchema);
  const mergedConfig = { ...defaultConfig, ...config };

  return new Plugin({
    key: pastePluginKey,

    props: {
      handlePaste(view, event, slice) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // 检查是否有图片
        const files = clipboardData.files;
        if (files && files.length > 0) {
          const hasImage = Array.from(files).some((file) => file.type.startsWith("image/"));
          if (hasImage) {
            // 处理图片粘贴
            handleImagePaste(view, files, mergedConfig);
            return true;
          }
        }

        // 获取粘贴的纯文本
        const text = clipboardData.getData("text/plain");
        if (!text) return false;

        // 检查是否包含 Markdown 语法
        if (!containsMarkdownSyntax(text)) {
          return false; // 让默认处理器处理
        }

        // 解析 Markdown
        const { doc } = parser.parse(text);

        // 获取解析后的内容
        const content = doc.content;

        // 如果内容为空，不处理
        if (content.size === 0) return false;

        // 获取当前选区
        const { $from, $to } = view.state.selection;

        // 计算替换范围
        // 如果在空段落中，替换整个段落
        const parent = $from.parent;
        const isEmptyParagraph =
          parent.type.name === "paragraph" && parent.content.size === 0 && $from.parentOffset === 0;

        let from: number, to: number;

        if (isEmptyParagraph && $from.depth > 0) {
          // 替换整个空段落
          from = $from.before($from.depth);
          to = $from.after($from.depth);
        } else {
          // 使用选区范围
          from = $from.pos;
          to = $to.pos;
        }

        // 创建事务
        const tr = view.state.tr.replaceWith(from, to, content);
        view.dispatch(tr);

        return true;
      },
    },
  });
}

/**
 * 处理图片粘贴
 */
async function handleImagePaste(
  view: any,
  files: FileList,
  config: PastePluginConfig
): Promise<void> {
  const method = config.getImagePasteMethod?.() || "base64";
  const schema = view.state.schema;
  const nodes: Node[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;

    try {
      let src: string;

      switch (method) {
        case "base64":
          src = await fileToBase64(file);
          break;

        case "remote":
          if (config.imageUploader) {
            src = await config.imageUploader(file);
          } else {
            console.warn("Image uploader not configured, falling back to base64");
            src = await fileToBase64(file);
          }
          break;

        case "local":
          if (config.localImageSaver) {
            src = await config.localImageSaver(file);
          } else {
            // 尝试使用 Electron API
            src = await saveImageLocally(file);
          }
          break;

        default:
          src = await fileToBase64(file);
      }

      const imageNode = schema.nodes.image?.createAndFill({
        src,
        alt: file.name,
        title: "",
      });

      if (imageNode) {
        nodes.push(imageNode);
      }
    } catch (error) {
      console.error("Failed to process image:", error);
    }
  }

  if (nodes.length > 0) {
    const { $from } = view.state.selection;
    let tr = view.state.tr;

    for (const node of nodes) {
      tr = tr.insert($from.pos, node);
    }

    view.dispatch(tr);
  }
}

/**
 * 将文件转换为 base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * 保存图片到本地
 */
export async function saveImageLocally(file: File): Promise<string> {
  // 检查是否在 Electron 环境中
  if (typeof window !== "undefined" && (window as any).electronAPI) {
    const electronAPI = (window as any).electronAPI;

    // 尝试获取剪贴板中的文件路径
    const filePath = await electronAPI.getFilePathInClipboard?.();
    if (filePath) {
      return filePath;
    }

    // 检查 File 对象是否有 path 属性（Electron 环境）
    const absolutePath = (file as any).path;
    if (absolutePath) {
      return absolutePath;
    }

    // 将图片保存到临时目录
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const localImagePath = localStorage.getItem("localImagePath") || "/temp";
    const tempPath = await electronAPI.writeTempImage?.(buffer, localImagePath);

    if (tempPath) {
      return tempPath;
    }
  }

  // 如果不在 Electron 环境或保存失败，回退到 base64
  console.warn("Local image saving not available, falling back to base64");
  return fileToBase64(file);
}

/**
 * 检查文本是否包含 Markdown 语法
 */
function containsMarkdownSyntax(text: string): boolean {
  const patterns = [
    /^#{1,6}\s/m, // 标题
    /\*\*[^*]+\*\*/, // 粗体
    /\*[^*]+\*/, // 斜体
    /~~[^~]+~~/, // 删除线
    /`[^`]+`/, // 行内代码
    /^```/m, // 代码块
    /\[[^\]]+\]\([^)]*\)/, // 链接（允许空 URL）
    /!\[[^\]]*\]\([^)]+\)/, // 图片
    /^>\s?/m, // 引用
    /^[-*+]\s/m, // 无序列表
    /^\d+\.\s/m, // 有序列表
    /^[-*_]{3,}\s*$/m, // 分隔线
    /==[^=]+==/, // 高亮
    /^\$\$/m, // 数学块
    /\$[^$]+\$/, // 行内数学
    /^- \[[ xX]\]/m, // 任务列表
  ];

  return patterns.some((pattern) => pattern.test(text));
}
