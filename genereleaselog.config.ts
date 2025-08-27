import { defineConfig } from 'genereleaselog'

export default defineConfig({
  description: `### 下载说明
- **macOS Intel**: 下载 DMG 文件（不含 arm64 后缀）
- **macOS Apple Silicon**: 下载带 arm64 后缀的 DMG 文件
- **Windows x64**: 下载 EXE 安装文件

### 更新内容

`,
  assets: 'release_files/*',
})
