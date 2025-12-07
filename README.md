# Cognitive Razor

一个 Obsidian 插件，帮助你将模糊的想法转化为结构化的知识节点。通过 AI 辅助，实现概念的标准化、分类、内容生成和语义去重，同时保持本地优先和人机协作的原则。

> **版本**: 2.0.0  
> **最低 Obsidian 版本**: 1.5.7  
> **设计文档**: [公理化设计文档](docs/公理化设计文档.md)

本插件基于公理化设计方法构建，严格遵循设计文档的所有规范，确保功能完整、设计一致、用户可用。

## ✨ 核心特性

### 🎯 概念标准化
- 将模糊的想法快速转化为结构化的知识节点
- AI 自动生成中英文标准名称和 3-10 个别名
- 智能判断知识类型（Domain、Issue、Theory、Entity、Mechanism）
- 自动生成包含元数据的 Stub 笔记

### 🔍 语义去重检测
- 自动检测同类型概念的语义相似度
- 智能识别重复概念（默认阈值 0.9）
- 在侧边栏显示待处理的重复对
- 支持 AI 辅助的概念合并

### 🤖 AI 内容生成
- 根据知识类型生成结构化内容
- Issue 类型：核心张力分析（X vs Y）
- Theory 类型：公理化理论框架
- Mechanism 类型：因果链机制描述
- Entity 类型：属加种差定义
- Domain 类型：领域边界划分

### 📝 增量改进
- 对现有笔记进行渐进式完善
- AI 辅助的内容改进建议
- 可视化差异预览
- 状态自动降级（Evergreen → Draft）

### ↩️ 可逆写入
- 所有写入操作自动创建快照
- 5 秒内可一键撤销
- 查看和管理操作历史
- 自动清理旧快照（默认保留 100 个）

### 📋 任务队列管理
- 可视化任务队列
- 支持任务暂停、取消和重试
- 智能锁机制防止冲突
- 状态栏实时显示任务进度

### 🔒 本地优先
- 所有数据存储在本地
- 向量索引本地化
- 仅在必要时调用 AI API
- 保护数据隐私和主权

## 📦 安装

### 系统要求

- **Obsidian**: 1.5.7 或更高版本
- **Node.js**: 22+ LTS（仅开发时需要）
- **AI API**: OpenAI 或 Google Gemini API Key

### 从 Obsidian 社区插件安装（推荐）

1. 打开 Obsidian 设置
2. 进入 **社区插件** → 关闭安全模式
3. 点击 **浏览** 搜索 "Cognitive Razor"
4. 点击 **安装**
5. 安装完成后点击 **启用**

### 手动安装

1. 从 [Releases](https://github.com/your-username/obsidian-cognitive-razor/releases) 下载最新版本
2. 解压文件到你的 vault 目录：`<vault>/.obsidian/plugins/obsidian-cognitive-razor/`
3. 确保包含以下文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. 重启 Obsidian
5. 在设置中启用 Cognitive Razor 插件

## 🚀 快速开始

### 首次配置

1. 启用插件后，打开插件设置
2. 配置 AI Provider：
   - **OpenAI**: 
     - 获取 API Key: https://platform.openai.com/api-keys
     - 默认端点: `https://api.openai.com/v1`
     - 推荐模型: `gpt-4o` (聊天), `text-embedding-3-small` (嵌入)
   - **Google Gemini**:
     - 获取 API Key: https://makersuite.google.com/app/apikey
     - 默认端点: `https://generativelanguage.googleapis.com/v1beta`
     - 推荐模型: `gemini-1.5-flash`
3. 输入 API Key 并保存
4. 系统会自动验证连接
5. 配置完成后即可开始使用

> **重要提示**：从 v2.0.0 开始，插件采用统一的 Provider 架构，支持通过自定义端点使用任何兼容 OpenAI/Gemini API 的服务（包括 OpenRouter、本地模型等）。详见[配置指南](docs/快速开始指南.md)。

### 创建第一个概念

1. 使用快捷键 `Ctrl/Cmd + Shift + N` 或点击侧边栏图标
2. 在输入框中描述你的概念（例如："机器学习中的过拟合问题"）
3. 系统会自动：
   - 标准化概念名称
   - 判断知识类型
   - 生成别名
   - 检测重复
4. 确认后创建 Stub 笔记
5. 系统会自动生成结构化内容并展示预览
6. 确认写入后完成创建

## 📖 使用指南

### 知识类型说明

Cognitive Razor 支持五种知识类型：

#### 🌐 Domain（领域）
描述一个知识领域的边界、核心概念和子领域。

**示例**：机器学习、认知科学、量子物理

#### ❓ Issue（议题）
描述一个核心张力或矛盾，格式为 "X vs Y"。

**示例**：准确率 vs 可解释性、自由 vs 安全

#### 📐 Theory（理论）
基于公理的理论框架，包含公理、推论和应用。

**示例**：贝叶斯推理、进化论、相对论

#### 🏷️ Entity（实体）
具体的事物、概念或对象，使用属加种差定义。

**示例**：神经网络、DNA、黑洞

#### ⚙️ Mechanism（机制）
描述因果链和作用机制。

**示例**：反向传播算法、自然选择、光合作用

### 处理重复概念

当系统检测到重复概念时：

1. 侧边栏会显示重复对列表
2. 点击查看两个概念的详情和相似度
3. 选择操作：
   - **合并**：AI 辅助生成合并后的内容
   - **忽略**：标记为非重复
   - **稍后处理**：保留在列表中

### 增量改进笔记

对现有笔记进行改进：

1. 在笔记上右键选择 "增量改进"
2. 输入改进意图（例如："添加更多实例"）
3. AI 生成改进后的内容
4. 在差异视图中预览变更
5. 确认后写入（Evergreen 笔记会降级为 Draft）

### 撤销操作

如果发现写入错误：

1. 写入完成后 5 秒内点击通知中的 "撤销" 按钮
2. 或打开操作历史查看所有可撤销的操作
3. 选择要撤销的操作并确认
4. 系统会恢复到操作前的状态

### 管理任务队列

查看和管理 AI 任务：

1. 使用快捷键 `Ctrl/Cmd + Shift + Q` 打开队列视图
2. 查看任务状态：
   - 🔄 进行中
   - ⏳ 等待中
   - ✅ 已完成
   - ❌ 失败
3. 可以暂停、取消或重试任务
4. 状态栏显示当前任务数量

## ⚙️ 配置说明

### Provider 配置

#### Google Gemini
- **API Key**：从 [Google AI Studio](https://makersuite.google.com/app/apikey) 获取
- **默认端点**：`https://generativelanguage.googleapis.com/v1beta`
- **模型**：gemini-1.5-flash（默认）
- **支持功能**：文本生成、嵌入

#### OpenAI
- **API Key**：从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取
- **默认端点**：`https://api.openai.com/v1`
- **模型**：gpt-4-turbo-preview、gpt-3.5-turbo
- **支持功能**：文本生成、嵌入

#### 自定义端点

两种 Provider 都支持自定义端点配置，允许你使用兼容的第三方服务：

**常用配置示例**：

| 服务类型 | Provider 选择 | 自定义端点 URL | 说明 |
|---------|--------------|---------------|------|
| OpenRouter | OpenAI | `https://openrouter.ai/api/v1` | 访问多种 AI 模型 |
| Ollama (本地) | OpenAI | `http://localhost:11434/v1` | 本地运行开源模型 |
| LM Studio (本地) | OpenAI | `http://localhost:1234/v1` | 本地模型服务 |
| Azure OpenAI | OpenAI | `https://your-resource.openai.azure.com/openai/deployments/your-deployment` | 企业级 OpenAI 服务 |
| Vertex AI | Gemini | `https://your-region-aiplatform.googleapis.com/v1` | Google Cloud AI 服务 |

**配置步骤**：
1. 打开插件设置 → Provider 配置
2. 点击"添加 Provider"或编辑现有 Provider
3. 选择 Provider 类型（OpenAI 或 Gemini）
4. 输入 API Key（本地服务可以输入任意值）
5. 在"自定义端点"字段中输入 URL
6. 留空则使用默认端点
7. 点击"测试连接"验证配置
8. 保存配置

**URL 验证规则**：
- 必须以 `http://` 或 `https://` 开头
- 必须是有效的 URL 格式
- 建议使用 HTTPS 以确保安全性（本地服务除外）
- 系统会在保存前自动验证 URL 格式

**故障排除**：
- 如果连接失败，检查端点 URL 是否正确
- 本地服务确保服务已启动并监听正确端口
- 检查防火墙设置是否阻止连接
- 查看日志文件了解详细错误信息

### 高级设置

#### 去重阈值
- **默认值**：0.9
- **范围**：0.0 - 1.0
- **说明**：相似度超过此值的概念会被标记为重复

#### 并发任务数
- **默认值**：2
- **范围**：1 - 5
- **说明**：同时执行的 AI 任务数量

#### 快照上限
- **默认值**：100
- **说明**：超过此数量会自动清理最旧的快照

#### 重试次数
- **默认值**：3
- **说明**：任务失败后的最大重试次数

### 数据存储

所有数据存储在本地，遵循 Obsidian 标准和设计文档规范：

```
<vault>/.obsidian/plugins/obsidian-cognitive-razor/
├── data.json              # 插件配置（Obsidian 标准位置）
├── data/                  # 运行时数据目录
│   ├── vector-index.json      # 向量索引（按类型分桶）
│   ├── queue-state.json       # 任务队列状态
│   ├── duplicate-pairs.json   # 重复对记录
│   ├── snapshots/             # 快照文件（支持撤销）
│   │   └── index.json         # 快照索引
│   └── logs/                  # 日志文件
│       └── app.log            # 应用日志（1MB 循环）
└── prompts/               # 提示词模板
    ├── standardizeClassify.md
    ├── enrich.md
    ├── reason-domain.md
    ├── reason-issue.md
    ├── reason-theory.md
    ├── reason-entity.md
    ├── reason-mechanism.md
    ├── reason-incremental.md
    └── reason-merge.md
```

**数据安全**：
- 所有数据存储在本地，不上传到云端
- 向量索引本地化，保护隐私
- 快照自动管理，防止数据丢失
- 日志循环覆盖，避免占用过多空间

## 🎨 自定义样式

插件支持 Obsidian 的亮色和暗色主题。如需自定义样式，可以在 `styles.css` 中修改：

```css
/* 自定义工作台面板颜色 */
.cr-workbench-panel {
  --cr-primary-color: #6366f1;
  --cr-background-color: var(--background-primary);
}
```

## 🔧 开发

### 环境要求

- **Node.js**: 22+ LTS（Node 18 已于 2025 年 EOL）
- **TypeScript**: 5.7+
- **npm**: 最新版本
- **esbuild**: 0.25.x（构建工具）

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/your-username/obsidian-cognitive-razor.git
cd obsidian-cognitive-razor

# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build

# 运行测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 代码检查
npx eslint ./src/

# 代码检查并自动修复
npx eslint ./src/ --fix
```

### 开发规范

- **TypeScript**: 启用 `strict: true`，target: ES2022
- **ESLint**: 使用 Flat Config (`eslint.config.js`)
- **测试**: 使用 Vitest 和 fast-check
- **覆盖率目标**: ≥ 80%

### 项目结构

项目采用分层架构，严格遵循 UI → 应用 → 数据的单向依赖：

```
src/
├── core/                      # 应用层（核心业务逻辑）
│   ├── task-queue.ts          # 任务队列管理
│   ├── task-runner.ts         # 任务执行器
│   ├── lock-manager.ts        # 锁管理器
│   ├── duplicate-manager.ts   # 重复检测管理
│   ├── undo-manager.ts        # 撤销管理器
│   ├── provider-manager.ts    # AI Provider 管理
│   ├── prompt-manager.ts      # 提示词管理
│   ├── vector-index.ts        # 向量索引
│   ├── retry-handler.ts       # 重试处理
│   ├── merge-handler.ts       # 合并处理
│   └── incremental-improve-handler.ts  # 增量改进处理
├── data/                      # 数据层
│   ├── file-storage.ts        # 文件存储
│   ├── logger.ts              # 日志记录
│   ├── settings-store.ts      # 设置存储
│   ├── validator.ts           # 数据验证
│   └── validators.ts          # 验证规则
├── ui/                        # UI 层
│   ├── workbench-panel.ts     # 工作台面板
│   ├── queue-view.ts          # 队列视图
│   ├── diff-view.ts           # 差异视图
│   ├── status-badge.ts        # 状态栏徽章
│   ├── settings-tab.ts        # 设置界面
│   ├── modals.ts              # 模态对话框
│   ├── command-dispatcher.ts  # 命令分发器
│   ├── setup-wizard.ts        # 配置向导
│   ├── undo-history-view.ts   # 撤销历史视图
│   └── undo-notification.ts   # 撤销通知
├── types.ts                   # 类型定义
└── main.ts                    # 插件入口
```

### 测试

项目使用 Vitest 和 fast-check 进行测试：

- **单元测试**：测试单个函数和类的功能
- **属性测试**：测试通用属性（每个测试运行 100 次）
- **集成测试**：测试组件间的交互
- **端到端测试**：测试完整的用户流程

**测试覆盖率**：
- 核心组件: ≥ 90%
- UI 组件: ≥ 70%
- 整体: ≥ 80%

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Obsidian](https://obsidian.md) - 强大的知识管理工具
- [fast-check](https://github.com/dubzzz/fast-check) - 属性测试框架
- 所有贡献者和用户

## ❓ 常见问题

### 插件无法加载？

1. 确认 Obsidian 版本 ≥ 1.5.7
2. 检查插件文件是否完整（main.js, manifest.json, styles.css）
3. 查看控制台错误信息（Ctrl/Cmd + Shift + I）
4. 尝试重新安装插件

### API 调用失败？

1. 检查 API Key 是否正确
2. 确认网络连接正常
3. 查看日志文件 `data/logs/app.log`
4. 检查 API 配额是否用尽

### 向量索引损坏？

1. 备份 `data/vector-index.json`
2. 删除该文件
3. 重启插件，系统会自动重建索引

### 任务队列卡住？

1. 打开队列视图查看任务状态
2. 尝试取消卡住的任务
3. 如果无法取消，删除 `data/queue-state.json` 并重启

### 如何查看日志？

日志文件位于 `data/logs/app.log`，包含：
- 任务状态变更
- API 调用记录
- 错误和异常信息
- 系统事件

日志级别可在设置中调整（debug/info/warn/error）。

### 如何备份数据？

备份以下文件即可：
- `data.json` - 插件配置
- `data/vector-index.json` - 向量索引
- `data/duplicate-pairs.json` - 重复对记录
- `data/snapshots/` - 快照文件（可选）

### 如何迁移到新设备？

1. 复制整个插件目录到新设备
2. 或仅复制上述备份文件
3. 重启 Obsidian 即可

## 📞 支持

- 📖 [文档](docs/)
  - [公理化设计文档](docs/公理化设计文档.md)
  - [快速开始指南](docs/快速开始指南.md)
  - [常见问题解答](docs/常见问题解答.md)
  - [故障排除指南](docs/故障排除指南.md)
- 🐛 [问题反馈](https://github.com/your-username/obsidian-cognitive-razor/issues)
- 💬 [讨论区](https://github.com/your-username/obsidian-cognitive-razor/discussions)

## 🔄 从旧版本升级

### v2.0.0 重大变更

从 v2.0.0 开始，插件进行了重大简化和改进：

#### Provider 简化

**变更内容**：
- ✅ 保留：OpenAI Provider
- ✅ 保留：Gemini Provider  
- ❌ 移除：OpenRouter Provider（作为独立类型）
- ✨ 新增：自定义端点支持

**为什么这样改？**
- 简化配置流程，减少用户困惑
- 通过自定义端点提供更大灵活性
- 支持任何兼容 OpenAI/Gemini API 的服务
- 更容易支持本地模型和私有部署

#### 如何迁移 OpenRouter 配置

如果你之前使用 OpenRouter，有两种迁移方式：

**方式 1：继续使用 OpenRouter（推荐）**

1. 打开插件设置 → Provider 配置
2. 添加新的 OpenAI Provider
3. 输入你的 OpenRouter API Key
4. 在"自定义端点"中输入：`https://openrouter.ai/api/v1`
5. 选择 OpenRouter 支持的模型
6. 保存配置

**方式 2：切换到官方 API**

1. 获取 OpenAI 或 Google Gemini 的 API Key
2. 在插件设置中配置新的 Provider
3. 删除旧的 OpenRouter 配置

#### 自动迁移

插件会在启动时自动检测旧配置：

- 如果检测到 OpenRouter 配置，会显示迁移向导
- 你可以选择自动迁移或手动配置
- 所有 API Key 和模型配置都会被保留

详细迁移指南请查看：[配置迁移指南](docs/配置迁移指南.md)

### 其他重要变更

- 所有 Modal 组件替代了 `prompt()` 调用，解决了 Electron 兼容性问题
- 完整实现了所有待实现功能（创建概念、队列详情、重复管理等）
- 改进了 UI 样式和暗色主题支持
- 增强了错误处理和用户反馈

## 🔐 隐私与安全

### 数据隐私

- **本地优先**：所有数据存储在本地，不上传到云端
- **API 调用**：仅在必要时调用 AI API，不存储用户数据
- **向量索引**：本地化存储，保护隐私
- **日志记录**：仅记录系统事件，不记录笔记内容

### API Key 安全

- API Key 存储在本地配置文件中
- 不会通过网络传输给第三方
- 建议定期更换 API Key
- 使用环境变量或密钥管理工具保护 API Key

### 网络请求

插件仅在以下情况发起网络请求：
- 调用 AI API 生成内容
- 调用 Embedding API 生成向量
- 验证 API Key 有效性

所有网络请求都是必要的，不包含隐藏的遥测或分析。

## 📋 技术栈

- **语言**: TypeScript 5.7+
- **构建工具**: esbuild 0.25.x
- **测试框架**: Vitest
- **属性测试**: fast-check
- **代码检查**: ESLint 9.x (Flat Config)
- **AI 模型**: 
  - 聊天: gpt-4o (推荐), gemini-1.5-flash
  - 嵌入: text-embedding-3-small (推荐)

## 🏗️ 架构设计

本插件采用公理化设计方法，基于以下核心原则：

1. **分层架构**: UI → 应用 → 数据的单向依赖
2. **接口优先**: 先定义接口，再实现具体逻辑
3. **可测试性**: 每个模块都易于测试
4. **可逆性**: 所有操作都可撤销
5. **透明性**: 系统状态对用户可见

详细设计请参考：[公理化设计文档](docs/公理化设计文档.md)

---

**注意**：本插件需要 AI API Key 才能正常工作。请确保你有有效的 API Key 并妥善保管。API 调用会产生费用，请注意控制使用量。
