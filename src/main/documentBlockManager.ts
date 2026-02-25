/**
 * 文档块管理器
 *
 * 在主进程中管理大文件的分块，实现虚拟滚动
 * 渲染进程通过 IPC 请求需要的内容块
 */

import { ipcMain } from "electron";
import { VS_BLOCK_SIZE, VS_THRESHOLD } from "../shared/virtual-scroll-config";

/** 块配置 */
interface BlockConfig {
  blockSize: number;
  threshold: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: BlockConfig = {
  blockSize: VS_BLOCK_SIZE,
  threshold: VS_THRESHOLD,
};

/** 文档块 */
interface DocumentBlock {
  index: number; // 块索引
  startLine: number; // 起始行号
  endLine: number; // 结束行号
  content: string; // 块内容
}

/** 文档块管理器 */
class DocumentBlockManager {
  private fullContent: string = "";
  private lines: string[] = [];
  private blocks: DocumentBlock[] = [];
  private config: BlockConfig = DEFAULT_CONFIG;
  private enabled: boolean = false;

  /**
   * 设置文档内容
   */
  setContent(content: string, config?: Partial<BlockConfig>): void {
    this.fullContent = content;
    this.lines = content.split("\n");
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.enabled = this.lines.length > this.config.threshold;

    if (this.enabled) {
      this.createBlocks();
    }
  }

  /**
   * 创建块
   */
  private createBlocks(): void {
    this.blocks = [];
    const totalLines = this.lines.length;
    let currentLine = 0;

    while (currentLine < totalLines) {
      const startLine = currentLine;
      const endLine = Math.min(currentLine + this.config.blockSize - 1, totalLines - 1);
      const blockLines = this.lines.slice(startLine, endLine + 1);

      this.blocks.push({
        index: this.blocks.length,
        startLine,
        endLine,
        content: blockLines.join("\n"),
      });

      currentLine = endLine + 1;
    }
  }

  /**
   * 获取块
   */
  getBlocks(blockIndices: number[]): DocumentBlock[] {
    if (!this.enabled) {
      // 未启用分块，返回完整内容
      return [
        {
          index: 0,
          startLine: 0,
          endLine: this.lines.length - 1,
          content: this.fullContent,
        },
      ];
    }

    return blockIndices
      .filter((index) => index >= 0 && index < this.blocks.length)
      .map((index) => this.blocks[index]);
  }

  /**
   * 获取块信息（不包含内容）
   */
  getBlockInfo(): {
    enabled: boolean;
    totalBlocks: number;
    totalLines: number;
    blockSize: number;
  } {
    return {
      enabled: this.enabled,
      totalBlocks: this.blocks.length,
      totalLines: this.lines.length,
      blockSize: this.config.blockSize,
    };
  }

  /**
   * 根据行号获取块索引
   */
  getBlockIndexByLine(lineNumber: number): number {
    if (!this.enabled) return 0;

    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      if (lineNumber >= block.startLine && lineNumber <= block.endLine) {
        return i;
      }
    }

    return 0;
  }

  /**
   * 清空内容
   */
  clear(): void {
    this.fullContent = "";
    this.lines = [];
    this.blocks = [];
    this.enabled = false;
  }
}

// 全局块管理器实例
const blockManager = new DocumentBlockManager();

/**
 * 注册文档块相关的 IPC 处理器
 */
export function registerDocumentBlockHandlers(): void {
  // 设置文档内容
  ipcMain.handle("document-block:set-content", (_event, content: string) => {
    blockManager.setContent(content);
    return blockManager.getBlockInfo();
  });

  // 获取块信息
  ipcMain.handle("document-block:get-info", () => {
    return blockManager.getBlockInfo();
  });

  // 获取指定的块
  ipcMain.handle("document-block:get-blocks", (_event, blockIndices: number[]) => {
    return blockManager.getBlocks(blockIndices);
  });

  // 根据行号获取块索引
  ipcMain.handle("document-block:get-block-index", (_event, lineNumber: number) => {
    return blockManager.getBlockIndexByLine(lineNumber);
  });

  // 清空内容
  ipcMain.handle("document-block:clear", () => {
    blockManager.clear();
  });
}

/**
 * 获取块管理器实例（用于主进程内部）
 */
export function getBlockManager(): DocumentBlockManager {
  return blockManager;
}
