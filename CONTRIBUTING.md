### 环境要求

- Node.js >= 20.17.0
- pnpm

### 安装运行

```bash
# 克隆项目
git clone https://github.com/auto-plugin/milkup.git
cd milkup

# 更新主分支
git checkout main
git pull upstream main

# 创建功能分支
git checkout -b feature/your-feature-name

# 安装依赖
pnpm install

# 开发模式运行
pnpm run dev

# 打包应用
pnpm run dist
```

### 平台特定打包

```bash
# Windows x64
pnpm run dist:win-x64

# macOS (Intel)
pnpm run dist:mac-x64

# macOS (Apple Silicon)
pnpm run dist:mac-arm64

# Linux x64
pnpm run dist:linux-x64

# Linux ARM64
pnpm run dist:linux-arm64
```