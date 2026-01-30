# milkup 项目专属 Skills

这个目录包含了为 milkup 项目定制的 Claude Code skills，用于简化常见的开发任务。

## 可用的 Skills

### 1. milkup-build
**用途**：构建和打包应用

用于构建 milkup 应用的不同平台版本（Windows、macOS、Linux），支持多种架构（x64、arm64）。

**使用方式**：
```bash
/milkup-build
```

**主要功能**：
- 开发构建
- 生产构建
- 平台特定构建（Windows/macOS/Linux）
- 多架构支持（x64/arm64）

---

### 2. milkup-dev
**用途**：开发环境管理

用于启动开发服务器、运行 Electron 应用、进行热重载调试等开发任务。

**使用方式**：
```bash
/milkup-dev
```

**主要功能**：
- 启动 Vite 开发服务器
- 启动 Electron 应用
- 热重载支持
- 开发调试工具

---

### 3. milkup-lint
**用途**：代码质量检查

使用 oxlint 和 oxfmt 进行代码检查和格式化，确保代码符合项目规范。

**使用方式**：
```bash
/milkup-lint
```

**主要功能**：
- 代码语法检查
- 代码格式化
- 自动修复问题
- Git 钩子集成

---

### 4. milkup-release
**用途**：版本发布管理

管理版本号、生成更新日志、创建发布标签等版本发布相关任务。

**使用方式**：
```bash
/milkup-release
```

**主要功能**：
- 版本号管理（遵循 Semver）
- 自动生成更新日志
- 创建 Git 标签
- 发布流程指导

---

## 如何使用

在 Claude Code 中，你可以通过以下方式使用这些 skills：

1. **直接调用**：在对话中输入 `/skill-name`，例如 `/milkup-build`
2. **自然语言**：描述你想做的事情，Claude 会自动选择合适的 skill
   - "帮我构建 Windows 版本" → 自动使用 milkup-build
   - "启动开发环境" → 自动使用 milkup-dev
   - "检查代码质量" → 自动使用 milkup-lint
   - "发布新版本" → 自动使用 milkup-release

## Skills 之间的关系

```
milkup-dev (开发)
    ↓
milkup-lint (检查)
    ↓
milkup-build (构建)
    ↓
milkup-release (发布)
```

典型的工作流程：
1. 使用 `milkup-dev` 启动开发环境进行开发
2. 使用 `milkup-lint` 检查和格式化代码
3. 使用 `milkup-build` 构建应用
4. 使用 `milkup-release` 发布新版本

## 自定义和扩展

这些 skills 都是开源的，你可以根据项目需要进行修改和扩展：

1. 编辑 `.agent/skills/<skill-name>/SKILL.md` 文件
2. 添加新的命令或工作流程
3. 调整配置以适应项目变化

## 贡献

如果你创建了新的有用的 skill 或改进了现有的 skill，欢迎提交 PR 分享给社区！

---

**注意**：这些 skills 是专门为 milkup 项目设计的，使用了项目特定的配置和工具。
如果你想在其他项目中使用类似的 skills，需要根据具体项目进行调整。
