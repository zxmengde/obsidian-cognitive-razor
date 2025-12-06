# 发布指南

本文档说明如何发布 Cognitive Razor 插件的新版本。

## 发布前检查清单

在创建发布之前，请确保：

- [x] 所有测试通过（`npm test`）
- [x] 代码已成功构建（`npm run build`）
- [x] `manifest.json` 中的版本号已更新
- [x] `versions.json` 已更新（映射插件版本到最小 Obsidian 版本）
- [x] `README.md` 已更新（如有新功能）
- [x] 文档已更新（`docs/` 目录）

## 发布文件

每个发布必须包含以下三个文件：

1. **main.js** - 编译后的插件代码
2. **manifest.json** - 插件元数据
3. **styles.css** - 插件样式（如果有）

这些文件位于项目根目录，已通过 `npm run build` 生成。

## 创建 GitHub Release

### 步骤 1：确认版本号

当前版本：**1.0.0**（来自 `manifest.json`）

### 步骤 2：创建 Git 标签

```bash
# 创建标签（注意：不要使用 'v' 前缀）
git tag 1.0.0

# 推送标签到远程仓库
git push origin 1.0.0
```

**重要**：标签名必须与 `manifest.json` 中的 `version` 字段完全一致，不要添加 `v` 前缀。

### 步骤 3：在 GitHub 上创建 Release

1. 访问你的 GitHub 仓库
2. 点击 **Releases** → **Draft a new release**
3. 选择刚才创建的标签 `1.0.0`
4. 填写 Release 标题：`Cognitive Razor 1.0.0`
5. 填写 Release 说明（参考下面的模板）
6. 上传以下文件作为附件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
7. 点击 **Publish release**

### Release 说明模板

```markdown
# Cognitive Razor 1.0.0

## ✨ 首次发布

Cognitive Razor 是一个 Obsidian 插件，帮助你将模糊的想法转化为结构化的知识节点。

### 核心特性

- 🎯 **概念标准化**：AI 辅助将模糊概念转化为结构化知识节点
- 🔍 **语义去重检测**：自动检测和管理重复概念
- 🤖 **AI 内容生成**：根据知识类型生成结构化内容
- 📝 **增量改进**：对现有笔记进行渐进式完善
- ↩️ **可逆写入**：所有操作都可撤销
- 📋 **任务队列管理**：可视化管理 AI 任务
- 🔒 **本地优先**：所有数据存储在本地

### 支持的知识类型

- Domain（领域）
- Issue（议题）
- Theory（理论）
- Entity（实体）
- Mechanism（机制）

### 支持的 AI Provider

- Google Gemini
- OpenAI
- OpenRouter

### 安装要求

- Obsidian 1.0.0 或更高版本
- 有效的 AI API Key（Google Gemini / OpenAI / OpenRouter）

### 安装方法

#### 从社区插件安装（推荐）

1. 打开 Obsidian 设置
2. 进入 **社区插件** → 关闭安全模式
3. 点击 **浏览** 搜索 "Cognitive Razor"
4. 点击 **安装** → **启用**

#### 手动安装

1. 下载本 Release 的 `main.js`、`manifest.json` 和 `styles.css`
2. 在你的 vault 中创建目录：`.obsidian/plugins/obsidian-cognitive-razor/`
3. 将下载的文件复制到该目录
4. 重启 Obsidian
5. 在设置中启用 Cognitive Razor 插件

### 快速开始

1. 启用插件后会自动打开配置向导
2. 选择 AI 服务提供商并输入 API Key
3. 使用快捷键 `Ctrl/Cmd + Shift + N` 创建第一个概念
4. 查看 [文档](docs/) 了解更多功能

### 文档

- [快速开始指南](docs/快速开始指南.md)
- [常见问题解答](docs/常见问题解答.md)
- [故障排除指南](docs/故障排除指南.md)
- [公理化设计文档](docs/公理化设计文档.md)

### 反馈与支持

- 🐛 [报告问题](https://github.com/your-username/obsidian-cognitive-razor/issues)
- 💬 [讨论区](https://github.com/your-username/obsidian-cognitive-razor/discussions)
- 📖 [完整文档](https://github.com/your-username/obsidian-cognitive-razor)

### 致谢

感谢所有测试用户和贡献者的支持！

---

**完整更新日志**：查看 [CHANGELOG.md](CHANGELOG.md)
```

## 版本更新流程

### 发布补丁版本（1.0.x）

用于 bug 修复和小改进：

```bash
# 1. 更新版本号
npm version patch

# 2. 构建
npm run build

# 3. 提交更改
git add .
git commit -m "chore: release v1.0.1"

# 4. 创建标签并推送
git push origin main
git push origin 1.0.1

# 5. 在 GitHub 上创建 Release
```

### 发布次要版本（1.x.0）

用于新功能：

```bash
# 1. 更新版本号
npm version minor

# 2. 构建
npm run build

# 3. 提交更改
git add .
git commit -m "chore: release v1.1.0"

# 4. 创建标签并推送
git push origin main
git push origin 1.1.0

# 5. 在 GitHub 上创建 Release
```

### 发布主要版本（x.0.0）

用于重大变更：

```bash
# 1. 更新版本号
npm version major

# 2. 构建
npm run build

# 3. 提交更改
git add .
git commit -m "chore: release v2.0.0"

# 4. 创建标签并推送
git push origin main
git push origin 2.0.0

# 5. 在 GitHub 上创建 Release
```

## versions.json 格式

`versions.json` 文件映射插件版本到最小 Obsidian 版本：

```json
{
  "1.0.0": "1.0.0",
  "1.0.1": "1.0.0",
  "1.1.0": "1.0.0"
}
```

每次发布新版本时，都要在此文件中添加对应的映射。

## 提交到社区插件市场

首次发布后，如果想将插件提交到 Obsidian 社区插件市场：

1. Fork [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 仓库
2. 在 `community-plugins.json` 中添加你的插件信息
3. 创建 Pull Request
4. 等待 Obsidian 团队审核

详细流程请参考：https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin

## 注意事项

1. **版本号格式**：必须使用语义化版本（Semantic Versioning），格式为 `x.y.z`
2. **标签名称**：Git 标签名必须与 `manifest.json` 中的版本号完全一致，不要添加前缀
3. **文件完整性**：每个 Release 必须包含 `main.js`、`manifest.json` 和 `styles.css`（如果有）
4. **向后兼容**：尽量保持向后兼容，避免破坏性变更
5. **测试充分**：发布前确保所有测试通过，手动测试核心功能
6. **文档更新**：新功能必须更新相应文档

## 回滚发布

如果发现严重问题需要回滚：

1. 在 GitHub 上删除有问题的 Release
2. 删除对应的 Git 标签：
   ```bash
   git tag -d 1.0.1
   git push origin :refs/tags/1.0.1
   ```
3. 修复问题后重新发布

## 自动化发布（可选）

可以使用 GitHub Actions 自动化发布流程。创建 `.github/workflows/release.yml`：

```yaml
name: Release

on:
  push:
    tags:
      - '*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            main.js
            manifest.json
            styles.css
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

这样，每次推送标签时就会自动构建并创建 Release。

## 联系方式

如有发布相关问题，请联系：
- GitHub Issues: https://github.com/your-username/obsidian-cognitive-razor/issues
- Email: your-email@example.com
