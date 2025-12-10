# 项目上下文索引

## 项目概述

**Cognitive Razor** 是一个 Obsidian 插件，用于 AI 驱动的知识管理。核心功能：
- 概念标准化：将模糊输入转化为结构化知识节点
- 语义去重：通过向量嵌入检测重复概念
- 可逆操作：支持快照和撤销

---

## 架构概览

### 三层架构（单向依赖）

```
UI 层 → 应用层 → 数据层
```

| 层级 | 目录 | 核心组件 |
|------|------|----------|
| UI 层 | `src/ui/` | WorkbenchPanel, StatusBadge, SettingsTab |
| 应用层 | `src/core/` | PipelineOrchestrator, TaskQueue, TaskRunner, VectorIndex, DuplicateManager |
| 数据层 | `src/data/` | FileStorage, Logger, SettingsStore, Validator |

### 关键文件索引

| 文件 | 职责 |
|------|------|
| `main.ts` | 插件入口，组件初始化和生命周期管理 |
| `src/types.ts` | 所有类型定义和接口 |
| `src/core/pipeline-orchestrator.ts` | 管线编排，协调任务链执行 |
| `src/core/task-queue.ts` | 任务队列，调度和并发控制 |
| `src/core/task-runner.ts` | 任务执行，调用 Provider API |
| `src/core/vector-index.ts` | 向量索引，相似度搜索 |
| `src/core/duplicate-manager.ts` | 重复检测和管理 |
| `src/core/undo-manager.ts` | 快照和撤销管理 |
| `src/ui/workbench-panel.ts` | 统一工作台 UI |

---

## 核心流程

### 概念创建管线

```
标准化 → 丰富 → 推理 → 写入 → 嵌入 → 去重
```

1. **标准化 (standardizeClassify)**：生成标准名称、类型置信度
2. **丰富 (enrich)**：生成别名、标签
3. **推理 (reason:new)**：生成概念内容
4. **写入**：创建/更新 Markdown 文件
5. **嵌入 (embedding)**：生成向量嵌入
6. **去重**：检测相似概念

### 快照策略

- **创建流程**：不创建快照（新文件无需回滚）
- **增量改进**：创建快照（保护现有内容）
- **合并流程**：创建快照（保护两个文件）

---

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
| `data/vector-index.json` | 向量索引 |
| `data/duplicate-pairs.json` | 重复对列表 |
| `data/app.log` | 运行日志 |
| `data/snapshots/` | 快照文件 |

---

## 参考文档

- `docs/TECHNICAL_DESIGN_DOCUMENT.md`：详细技术设计
- `docs/哲学设计文档.md`：设计哲学和原理
- `prompts/`：AI 提示词模板
