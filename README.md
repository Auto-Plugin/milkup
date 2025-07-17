<div align="center">
  <img src="./src/renderer/public/logo.svg" alt="MilkUp Logo" width="150"> 
  <h1>MilkUp</h1>
</div>

MilkUp 是一个桌面端 Markdown 编辑器, 目前支持 windows (其他平台即将支持)。

## 项目简介

MilkUp 提供了一个简单易用的界面，用于编辑 Markdown 文档。它的设计目标是为用户提供高效的 Markdown 操作体验，同时支持多种渲染和编辑功能。

## 功能特点

* **所见即所得**: 基于 milkdown 的所见即所得的编辑体验，实时预览 Markdown 文档。
* **免费开源**: 完全免费，开源代码托管在 GitHub 上。

## TODO

以下是未来计划添加的功能：

* [x] hybrid 所见即所得。
* [x] 打开和保存本地文件。
* [x] 增加快捷键支持，提高编辑效率。
* [x] 增强的语法高亮支持。
* [x] 增加多主题支持（暗黑模式等）。
* [ ] 更多设置项。
* [ ] 大纲功能。
* [ ] 支持 MacOS 和 Linux
* [ ] 支持 Markdown 文件的导出为 PDF 或 HTML。
* [ ] 自定义图床。
* [ ] 自定义 CSS。
* [ ] 支持插件扩展，允许用户自定义功能。
* [ ] 干翻 typora。

## 安装与运行

### 克隆项目

```Shell
git clone https://github.com/auto-plugin/milkup.git
cd milkup
```

### 安装依赖

```Shell
pnpm install
```

### 运行项目

```Shell
pnpm run dev
```

### 打包应用

```Shell
pnpm run dist
```

## 贡献指南

欢迎贡献代码！请确保在提交代码前运行所有测试，并遵循项目的代码风格。

## 许可证

本项目使用 [MIT License](LICENSE)。
