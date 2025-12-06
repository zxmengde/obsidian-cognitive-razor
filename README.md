# Cognitive Razor

一个 Obsidian 插件，帮助你将模糊的想法转化为结构化的知识节点。通过 AI 辅助，实现概念的标准化、分类、内容生成和语义去重，同时保持本地优先和人机协作的原则。

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

### 从 Obsidian 社区插件安装（推荐）

1. 打开 Obsidian 设置
2. 进入 **社区插件** → 关闭安全模式
3. 点击 **浏览** 搜索 "Cognitive Razor"
4. 点击 **安装**
5. 安装完成后点击 **启用**

### 手动安装

1. 从 [Releases](https://github.com/your-username/obsidian-cognitive-razor/releases) 下载最新版本
2. 解压文件到你的 vault 目录：`<vault>/.obsidian/plugins/obsidian-cognitive-razor/`
3. 重启 Obsidian
4. 在设置中启用 Cognitive Razor 插件

## 🚀 快速开始

### 首次配置

1. 启用插件后会自动打开配置向导
2. 选择 AI 服务提供商（Google Gemini / OpenAI / OpenRouter）
3. 输入对应的 API Key
4. 系统会自动验证 Key 的有效性
5. 配置完成后即可开始使用

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
- **模型**：gemini-pro（默认）
- **支持功能**：文本生成、嵌入

#### OpenAI
- **API Key**：从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取
- **模型**：gpt-4、gpt-3.5-turbo
- **支持功能**：文本生成、嵌入

#### OpenRouter
- **API Key**：从 [OpenRouter](https://openrouter.ai/keys) 获取
- **模型**：支持多种模型
- **支持功能**：文本生成

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

所有数据存储在本地：

```
<vault>/.obsidian/plugins/obsidian-cognitive-razor/data/
├── settings.json          # 插件配置
├── vector-index.json      # 向量索引
├── queue-state.json       # 任务队列状态
├── duplicate-pairs.json   # 重复对记录
├── snapshots/             # 快照文件
└── logs/                  # 日志文件
```

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

- Node.js 18+
- npm

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

# 运行属性测试
npm run test:property
```

### 项目结构

```
src/
├── core/              # 核心业务逻辑
│   ├── task-queue.ts
│   ├── task-runner.ts
│   ├── lock-manager.ts
│   ├── duplicate-manager.ts
│   ├── undo-manager.ts
│   ├── provider-manager.ts
│   ├── prompt-manager.ts
│   └── vector-index.ts
├── data/              # 数据层
│   ├── file-storage.ts
│   ├── logger.ts
│   ├── settings-store.ts
│   └── validator.ts
├── ui/                # UI 组件
│   ├── workbench-panel.ts
│   ├── queue-view.ts
│   ├── diff-view.ts
│   └── status-badge.ts
├── types.ts           # 类型定义
└── main.ts            # 插件入口
```

### 测试

项目使用 Jest 和 fast-check 进行测试：

- **单元测试**：测试单个函数和类
- **属性测试**：测试通用属性（每个测试运行 100 次）
- **集成测试**：测试完整流程

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

## 📞 支持

- 📖 [文档](docs/)
- 🐛 [问题反馈](https://github.com/your-username/obsidian-cognitive-razor/issues)
- 💬 [讨论区](https://github.com/your-username/obsidian-cognitive-razor/discussions)

---

**注意**：本插件需要 AI API Key 才能正常工作。请确保你有有效的 API Key 并妥善保管。
