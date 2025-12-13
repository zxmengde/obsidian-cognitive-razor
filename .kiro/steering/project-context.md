# 项目上下文索引

## 项目概述

**Cognitive Razor** 是一个 Obsidian 插件，用于 AI 驱动的知识管理。核心功能：
- 概念标准化：将模糊输入转化为结构化知识节点
- 语义去重：通过向量嵌入检测重复概念
- 可逆操作：支持快照和撤销
- 概念深化：从现有概念抽象或具化新概念

---

## 架构概览

### 三层架构（单向依赖）

```
UI 层 → 应用层 → 数据层
```

| 层级 | 目录 | 核心组件 |
|------|------|----------|
| UI 层 | `src/ui/` | WorkbenchPanel, StatusBadge, SettingsTab, CommandDispatcher, SetupWizard |
| 应用层 | `src/core/` | PipelineOrchestrator, DeepenOrchestrator, TaskQueue, TaskRunner, VectorIndex, DuplicateManager, ProviderManager, PromptManager, LockManager, UndoManager, IndexHealer, I18n |
| 数据层 | `src/data/` | FileStorage, Logger, SettingsStore, Validator |
| 工具层 | `src/utils/` | date-utils |

### 关键文件索引

| 文件 | 职责 |
|------|------|
| `main.ts` | 插件入口，组件初始化和生命周期管理 |
| `src/types.ts` | 所有类型定义和接口（约 1600 行） |
| `src/core/pipeline-orchestrator.ts` | 管线编排，协调创建/增量/合并任务链 |
| `src/core/deepen-orchestrator.ts` | 深化编排，处理概念抽象和具化 |
| `src/core/task-queue.ts` | 任务队列，调度和并发控制 |
| `src/core/task-runner.ts` | 任务执行，调用 Provider API |
| `src/core/vector-index.ts` | 向量索引，相似度搜索（分桶存储） |
| `src/core/duplicate-manager.ts` | 重复检测和管理 |
| `src/core/undo-manager.ts` | 快照和撤销管理 |
| `src/core/index-healer.ts` | 索引自愈（文件删除/重命名/修改后自动修复索引） |
| `src/core/provider-manager.ts` | AI Provider 管理，API 调用 |
| `src/core/prompt-manager.ts` | 提示词模板管理和构建 |
| `src/core/lock-manager.ts` | 并发锁管理 |
| `src/core/i18n.ts` | 国际化支持（中/英） |
| `src/core/frontmatter-utils.ts` | Frontmatter 解析和生成 |
| `src/core/naming-utils.ts` | 笔记命名工具 |
| `src/core/retry-handler.ts` | 重试策略处理 |
| `src/core/schema-registry.ts` | JSON Schema 注册表 |
| `src/core/standardize-mapper.ts` | 标准化结果映射 |
| `src/ui/workbench-panel.ts` | 统一工作台 UI |
| `src/ui/command-dispatcher.ts` | 命令注册和分发 |
| `src/ui/settings-tab.ts` | 设置面板 |
| `src/ui/setup-wizard.ts` | 首次配置向导 |
| `src/ui/deepen-modal.ts` | 深化操作模态框 |
| `src/ui/merge-modals.ts` | 合并操作模态框 |
| `src/data/error-codes.ts` | 错误码定义 |

## 架构约束

### 必须遵循

1. **Result Monad**：所有可能失败的操作返回 `Result<T>`，不抛异常
2. **单向依赖**：UI → 应用 → 数据，禁止反向依赖
3. **依赖注入**：组件通过构造函数接收依赖
4. **类型安全**：使用 `unknown` 而非 `any`，显式声明返回类型

### 禁止事项

- ❌ 在数据层引用应用层或 UI 层
- ❌ 使用 `any` 类型
- ❌ 直接抛出异常（使用 `err()` 返回错误）
- ❌ 跳过 FileStorage 直接操作文件系统
- ❌ 修改 `main.ts` 的初始化顺序（除非理解依赖关系）

---

## 数据文件

| 路径 | 用途 |
|------|------|
| `data.json` | 插件设置（Obsidian 管理） |
| `data/queue-state.json` | 任务队列状态 |
| `data/pipeline-state.json` | 管线状态持久化 |
| `data/vectors/` | 向量索引（分桶存储） |
| `data/vectors/index.json` | 向量索引元数据 |
| `data/vectors/{Type}/{uid}.json` | 单个概念向量文件 |
| `data/duplicate-pairs.json` | 重复对列表 |
| `data/app.log` | 运行日志（循环 1MB） |
| `data/snapshots/` | 快照目录 |
| `data/snapshots/index.json` | 快照索引 |

---

## 提示词模板

| 路径 | 用途 |
|------|------|
| `prompts/standardizeClassify.md` | 标准化和分类 |
| `prompts/enrich.md` | 内容丰富（别名、标签） |
| `prompts/ground.md` | 接地验证 |
| `prompts/merge.md` | 概念合并 |
| `prompts/reason-*.md` | 各类型推理模板 |
| `prompts/_base/` | 基础组件模板 |
| `prompts/_type/` | 类型特定模板 |

---

## 参考文档

- `docs/TECHNICAL_DESIGN_DOCUMENT.md`：详细技术设计
- `docs/OVER_ENGINEERING_AUDIT.md`：过度工程审计报告
- `docs/ui_ux_audit_report.md`：UI/UX 审计报告
