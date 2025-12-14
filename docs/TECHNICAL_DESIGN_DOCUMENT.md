# Cognitive Razor—技术设计文档

**版本**: 2.1.0
**最后更新**: 2025-12-14
**状态**: 单一真理源（SSOT）

## 文档说明

本文档是 Cognitive Razor 项目的唯一权威设计规范。所有实现必须与本文档保持一致。

**文档原则**：
- 直接陈述设计决策，不包含历史遗留说明
- 清晰定义系统边界和约束
- 提供可验证的实现标准

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [核心概念](#3-核心概念)
4. [数据模型](#4-数据模型)
5. [核心流程](#5-核心流程)
6. [Prompt 系统](#6-prompt-系统)
7. [索引与存储](#7-索引与存储)
8. [并发与锁](#8-并发与锁)
9. [错误处理](#9-错误处理)
10. [UI 规范](#10-ui-规范)
11. [命令系统](#11-命令系统)
12. [配置与国际化](#12-配置与国际化)

## 1. 项目概述

### 1.1 项目定位

Cognitive Razor 是一个 Obsidian 桌面插件，提供 AI 驱动的知识管理能力。

**核心价值**：
- 将模糊概念转化为结构化知识节点
- 通过语义相似度检测重复概念
- 提供可逆的危险操作（快照 + 确认）

### 1.2 系统边界

**支持的功能**：
- 概念创建（Create）
- 语义去重（Dedup）
- 概念合并（Merge）
- 增量改进（Incremental Edit）
- 层级深化（Deepen）
**明确不支持**：
- 移动端（`isDesktopOnly: true`）
- 外部数据库（仅使用文件系统）
- 实时协作

### 1.3 技术栈

| 组件 | 版本 | 说明 |
|---|---|---|
| Obsidian API | 1.5.7+ | 最低支持版本 |
| TypeScript | 5.7.x | strict mode, target ES2022 |
| Node.js | 22+ LTS | 开发环境 |
| esbuild | 0.25.x | 构建工具 |
| ESLint | 9.x | Flat Config |
| Vitest | 4.x | 测试框架 |

**AI 模型**：
- 聊天：`gpt-4o`（默认）、`gpt-4o-mini`（轻量）
- 嵌入：`text-embedding-3-small`（1536 维）

## 2. 系统架构

### 2.1 三层架构

```
┌─────────────────────────────────────────┐
│           UI 层 (src/ui/)               │
│  WorkbenchPanel, StatusBadge, Modals    │
└─────────────────┬───────────────────────┘
                  │ 单向依赖
┌─────────────────▼───────────────────────┐
│         应用层 (src/core/)              │
│  PipelineOrchestrator, TaskQueue,       │
│  VectorIndex, DuplicateManager,         │
│  CruidCache, SimpleLockManager          │
└─────────────────┬───────────────────────┘
                  │ 单向依赖
┌─────────────────▼───────────────────────┐
│         数据层 (src/data/)              │
│  FileStorage, Logger, SettingsStore     │
└─────────────────────────────────────────┘
```

**依赖规则**：
- UI 层可以调用应用层和数据层
- 应用层可以调用数据层
- 数据层不依赖任何上层

### 2.2 核心组件

| 组件 | 职责 | 位置 |
|---|---|---|
| PipelineOrchestrator | 管线编排，协调任务链 | `src/core/pipeline-orchestrator.ts` |
| TaskQueue | 任务调度，并发控制 | `src/core/task-queue.ts` |
| TaskRunner | 任务执行，调用 Provider API | `src/core/task-runner.ts` |
| ImageInsertOrchestrator | 图片生成任务编排 | `src/core/image-insert-orchestrator.ts` |
| VectorIndex | 向量索引，相似度搜索 | `src/core/vector-index.ts` |
| DuplicateManager | 重复检测和管理 | `src/core/duplicate-manager.ts` |
| UndoManager | 快照创建和恢复 | `src/core/undo-manager.ts` |
| CruidCache | cruid → TFile 映射缓存（SSOT） | `src/core/cruid-cache.ts` |
| SimpleLockManager | 内存互斥锁（无持久化） | `src/core/lock-manager.ts` |
| WorkbenchPanel | 统一工作台 UI | `src/ui/workbench-panel.ts` |
| ImageInsertModal | 图片生成输入与上下文预览 | `src/ui/image-insert-modal.ts` |

### 2.3 架构约束

**必须遵循**：
1. **Result Monad**：所有可能失败的操作返回 `Result<T>`，不抛异常
2. **依赖注入**：组件通过构造函数接收依赖
3. **类型安全**：使用 `unknown` 而非 `any`
4. **单向数据流**：UI → 应用 → 数据
**禁止行为**：
- ❌ 在数据层引用应用层或 UI 层
- ❌ 使用 `any` 类型
- ❌ 直接抛出异常（使用 `err()` 返回错误）
- ❌ 跳过 FileStorage 直接操作文件系统

## 3. 核心概念

### 3.1 知识类型

系统支持五种知识类型：

```typescript
type CRType = "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";
```

| 类型 | 说明 | 示例 |
|---|---|---|
| Domain | 知识领域 | 认知科学、量子物理 |
| Issue | 核心议题 | 意识难题、测量问题 |
| Theory | 理论框架 | 预测加工理论、多世界诠释 |
| Entity | 实体概念 | 神经元、量子态 |
| Mechanism | 机制过程 | 突触传递、量子纠缠 |

### 3.2 笔记状态

```typescript
type NoteState = "Stub" | "Draft" | "Evergreen";
```

- **Stub**：初始状态，仅包含基本元数据
- **Draft**：草稿状态，内容正在完善
- **Evergreen**：成熟状态，内容稳定

### 3.3 操作风险分级

**安全操作**（自动执行）：
- **Create**：从无到有地创建新笔记，不修改既有内容
**危险操作**（需要快照 + 用户确认）：
- **Merge**：从有到有地合并两篇笔记，删除其中一篇
- **Incremental Edit**：从有到有地修改既有笔记内容

## 4. 数据模型

### 4.1 Frontmatter 规范

每个概念笔记必须包含以下 frontmatter 字段：

```yaml

cruid: "550e8400-e29b-41d4-a716-446655440000"
type: "Domain"
name: "认知科学"
status: "Draft"
created: "2025-12-13 10:30:00"
updated: "2025-12-13 15:45:00"
aliases: ["认知研究", "Cognitive Science"]
tags: ["科学", "心智"]
parents: ["[[数学 (Mathematics)]]", "[[物理学 (Physics)]]"]
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cruid` | string | ✅ | UUID v4，概念唯一标识符 |
| `type` | CRType | ✅ | 知识类型 |
| `name` | string | ✅ | 概念名称 |
| `status` | NoteState | ✅ | 笔记状态 |
| `created` | string | ✅ | 创建时间（`yyyy-MM-DD HH:mm:ss`）|
| `updated` | string | ✅ | 更新时间（`yyyy-MM-DD HH:mm:ss`）|
| `aliases` | string[] | ❌ | 别名列表（不包含 cruid）|
| `tags` | string[] | ❌ | 标签列表 |
| `parents` | string[] | ❌ | 父概念名称列表（存储笔记标题，非 cruid）|

**关键约束**：
1. 时间格式统一为 `yyyy-MM-DD HH:mm:ss`（非 ISO8601）
2. `cruid` 字段名必须小写（非驼峰 `crUid`）
3. `aliases` 不得包含任何 `cruid`
4. `parents` 存储笔记链接，便于人类阅读

### 4.2 任务模型

```typescript
interface TaskRecord {
  id: string;                    // 任务 ID
  nodeId: string;                // 关联的概念 UID
  taskType: TaskType;            // 任务类型
  state: TaskState;              // 任务状态
  attempt: number;               // 当前尝试次数
  maxAttempts: number;           // 最大尝试次数
  payload: Record<string, unknown>;  // 任务载荷
  result?: Record<string, unknown>;  // 任务结果
  created: string;               // 创建时间
  updated: string;               // 更新时间
  errors?: TaskError[];          // 错误历史
}

type TaskType = 
  | "define"    // 定义概念
  | "tag"       // 生成别名与标签
  | "write"     // 撰写正文
  | "index"     // 生成向量索引
  | "verify"    // 校验内容
  | "image-generate"; // 图片生成（chat completions image preview）

type TaskState = 
  | "Pending"      // 等待中
  | "Running"      // 执行中
  | "Completed"    // 已完成
  | "Failed"       // 失败
  | "Cancelled";   // 已取消
```

### 4.3 向量索引模型

**元数据索引**（`data/vectors/index.json`）：

```typescript
interface VectorIndexMeta {
  version: string;
  lastUpdated: number;
  stats: {
    totalConcepts: number;
    byType: Record<CRType, number>;
  };
  concepts: Record<string, ConceptMeta>;
}

interface ConceptMeta {
  id: string;              // 概念 UID
  type: CRType;            // 知识类型
  vectorFilePath: string;  // 向量文件路径（内部使用）
  lastModified: number;    // 最后修改时间
  hasEmbedding: boolean;   // 是否有嵌入向量
}
```

**向量文件**（`data/vectors/{type}/{uid}.json`）：

```typescript
interface ConceptVector {
  id: string;              // 概念 UID
  type: CRType;            // 知识类型
  embedding: number[];     // 向量嵌入（1536 维）
  metadata: {
    createdAt: number;
    updatedAt: number;
    embeddingModel: string;
    dimensions: number;
  };
}
```

**路径语义约束**：
- `VectorEntry` 不再存储 `name/path`（避免 SSOT 违规）
- `SearchResult.name/path` 在运行时通过 `CruidCache` 解析（`cruid → TFile.basename/path`）
- `vectorFilePath` 仅作为内部字段，不对外暴露

### 4.4 重复对模型

```typescript
interface DuplicatePair {
  id: string;
  nodeIdA: string;         // 仅保存 cruid
  nodeIdB: string;         // 仅保存 cruid
  type: CRType;
  similarity: number;      // 相似度 (0-1)
  detectedAt: string;      // 检测时间
  status: DuplicatePairStatus;
}

type DuplicatePairStatus = 
  | "pending"    // 待处理
  | "merging"    // 合并中
  | "merged"     // 已合并
  | "dismissed"; // 已忽略
```

### 4.5 快照模型

```typescript
interface SnapshotRecord {
  id: string;              // 快照 ID（UUID）
  nodeId: string;          // 关联的概念 UID
  taskId: string;          // 关联的任务 ID
  path: string;            // 原文件路径
  content: string;         // 原始 Markdown 内容
  created: string;         // 创建时间
  fileSize: number;        // 文件大小（字节）
  checksum: string;        // 内容校验和（MD5）
}
```

## 5. 核心流程

### 5.1 Create（创建流程）

**流程图**：

```
用户输入 → 定义 → 标记 → 撰写 → 索引 → 查重 → 写入文件
```

**阶段说明**：
1. **定义**（`define`）
    - 输入：用户描述
    - 输出：五种类型的标准名称 + 类型置信度
    - 用户选择最终类型和名称
2. **标记**（`tag`）
    - 输入：标准化元数据
    - 输出：别名列表、标签列表
3. **撰写**（`write`）
    - 输入：类型、名称、元数据
    - 输出：结构化内容（根据类型 Schema）
4. **索引**（`index`）
    - 输入：笔记全文
    - 输出：1536 维向量
5. **查重**（`checking_duplicates`）
    - 在同类型桶内检索相似概念
    - 相似度超过阈值则生成重复对
6. **写入**
    - 生成 frontmatter + 正文
    - 自动写入文件（无需用户确认）
    - **不创建快照**（删除文件即可回退）

**特殊模式**：
- **Deepen 预设路径**：支持 `targetPathOverride` 参数，用于批量创建时预设文件路径
- **抽象深化**：支持 `sources` 参数，传递来源笔记正文用于抽象推理

### 5.2 Merge（合并流程）

**流程图**：

```
选择重复对 → 选择主笔记 → 创建双快照 → 生成合并内容 → DiffView 确认 → 写入 + 删除 → 清理索引
```

**详细步骤**：
1. **选择主笔记**
    - 用户从重复对列表选择 A/B 谁是主笔记
    - 主笔记保留其 `cruid`
    - 另一篇笔记将被删除
2. **创建双快照**
    - 为主笔记创建快照（快照 ID 存储在管线上下文）
    - 为被删除笔记创建快照（快照 ID 为 `merge-delete-{pipelineId}`）
3. **生成合并内容**
    - 调用 LLM 合并两篇笔记的内容
    - 将被删除笔记的标题追加到主笔记的 `aliases`
    - 保留主笔记的 `cruid`
4. **DiffView 确认**
    - 显示 Side-by-Side 差异视图
    - 顶部显示"自动快照已启用"徽章
    - 用户确认后执行写入
5. **写入 + 删除**
    - 写入主笔记内容
    - 删除被合并笔记文件
6. **清理索引**
    - 从向量索引删除被删除笔记的 `cruid`
    - 从重复对列表删除该 pair
    - 更新主笔记的向量索引
**关键约束**：
- 必须创建双快照（主笔记 + 被删除笔记）
- 被删除笔记的 `cruid` 必须从所有数据结构中清理
- `aliases` 不得包含 `cruid`，仅包含笔记标题

### 5.3 Incremental Edit（增量改进流程）

**流程图**：

```
选择笔记 → 输入指令 → 创建快照 → 生成改进内容 → DiffView 确认 → 写入 → 更新索引
```

**详细步骤**：
1. **输入指令**
    - 用户选择目标笔记
    - 输入改进指令（如"补充更多示例"）
2. **创建快照**
    - 为目标笔记创建快照
    - 快照 ID 存储在管线上下文
3. **生成改进内容**
    - 调用 LLM 生成改进后的完整内容
    - 保留原有 frontmatter
    - 自然融合改进内容（非追加）
4. **DiffView 确认**
    - 显示 Side-by-Side 差异视图
    - 用户确认后执行写入
5. **写入 + 更新索引**
    - 写入改进后的内容
    - 更新向量索引
    - 触发去重检测
**关键约束**：
- 必须在确认前创建快照
- 输出必须包含完整的 frontmatter + 正文

### 5.4 Deepen（深化流程）

**两种模式**：

#### 5.4.1 层级深化（Domain/Issue/Theory）

**流程**：

```
解析父笔记 → 提取候选项 → 过滤已存在 → 用户勾选 → 批量创建
```

**候选项来源**：

| 父类型 | 候选字段 | 目标类型 |
|--|-|-|
| Domain | `sub_domains` | Domain |
| Domain | `issues` | Issue |
| Issue | `sub_issues` | Issue |
| Issue | `theories` | Theory |
| Theory | `sub_theories` | Theory |
| Theory | `entities` | Entity |
| Theory | `mechanisms` | Mechanism |

**路径预测**：
- 使用父笔记中的 ` [[候选名]] ` 作为文件名
- 设置 `targetPathOverride` 参数
- 冲突处理：已存在路径标记为"已存在"，非法文件名标记为"不可创建"
**关系写入**：
- 新笔记 `parents` 字段写入父笔记标题
- 新笔记 `parentUid` 字段写入父笔记 `cruid`
- 新笔记 `parentType` 字段写入父笔记类型
**限制**：
- 单次最多创建 200 个概念

#### 5.4.2 抽象深化（Entity/Mechanism）

**流程**：

```
读取当前笔记 → 相似检索 → 用户勾选 → 生成抽象概念
```

**详细步骤**：
1. **相似检索**
    - 读取当前笔记的索引向量（embedding）
    - 在同类型桶内检索相似概念
    - 返回 topK 候选
2. **用户勾选**
    - 显示相似概念列表（名称 + 相似度）
    - 用户勾选多个概念
3. **生成抽象概念**
    - 拼接当前笔记 + 所选相似笔记的完整正文
    - 作为 `CTX_SOURCES` 传入 `write`
    - 生成 1 个同类型、更抽象的概念
4. **关系写入**
    - 新笔记 `parents` 字段写入来源笔记标题
    - **不修改来源笔记**

### 5.5 Image Generate（图片生成流程）

1. Workbench/命令触发 → 校验编辑模式与光标位置，读取前后上下文（默认各 500 字符）与 frontmatter。
2. ImageInsertOrchestrator 入队 `image-generate` 任务，payload 包含用户描述、上下文、光标位置、frontmatter。
3. TaskRunner 执行：
   - 调用 ProviderManager.generateImage（chat completions 模型 `gemini-3-pro-image-preview`，带 `extra_body.google.image_config`）。
   - 解析 Markdown data URL，解码二进制。
   - 记录快照（UndoManager）。
   - 使用 `vault.getAvailablePathForAttachment` 生成附件路径并写入图片文件。
   - 在光标处插入 `![alt](path)` Markdown。
4. 任务完成后可撤销，队列状态实时刷新。

## 6. Prompt 系统

### 6.1 模块化架构

**目录结构**：

```
prompts/
├── _base/                    # 基础组件
│   ├── terminology.md        # 术语表
│   ├── output-format.md      # 输出格式规则
│   ├── writing-style.md      # 写作风格
│   ├── anti-patterns.md      # 反模式约束
│   └── operations/           # 操作模块
│       ├── create.md
│       ├── merge.md
│       └── incremental.md
├── _type/                    # 类型核心模块
│   ├── domain-core.md
│   ├── issue-core.md
│   ├── theory-core.md
│   ├── entity-core.md
│   └── mechanism-core.md
├── generate-image.md         # 图片生成模板（chat completions image preview）
└── *.md                      # 任务模板（过渡形态）
```

### 6.2 模板结构

每个可执行 prompt 必须包含以下区块：

```markdown
<system_instructions>
  <!-- 系统角色和规则 -->
</system_instructions>

<context_slots>
  <!-- 上下文槽位 -->
</context_slots>

<task_instruction>
  <!-- 任务指令 -->
</task_instruction>

<output_schema>
  <!-- JSON Schema -->
</output_schema>
```

**输出规则**：
- LLM 输出必须是原始 JSON 文本（raw JSON only）
- 不得使用 Markdown code fence（如 ```json）

### 6.3 槽位契约

**通用槽位**：
- `CTX_LANGUAGE`：语言（可选，默认 `Chinese`）
**任务型槽位**：

| 任务类型 | 必需槽位 | 可选槽位 |
|-|-|-|
| `define` | `CTX_INPUT` | `CTX_LANGUAGE` |
| `tag` | `CTX_META` | `CTX_LANGUAGE` |
| `write` | `CTX_META` | `CTX_SOURCES`, `CTX_LANGUAGE` |
| `index` | `CTX_INPUT` | `CTX_LANGUAGE` |
| `verify` | `CTX_META`, `CTX_CURRENT` | `CTX_SOURCES`, `CTX_LANGUAGE` |

**操作模块槽位**：

| 操作类型 | 必需槽位 | 可选槽位 |
|-|-|-|
| `create` | `CTX_INPUT` | `CTX_LANGUAGE` |
| `merge` | `SOURCE_A_NAME`, `CTX_SOURCE_A`, `SOURCE_B_NAME`, `CTX_SOURCE_B` | `USER_INSTRUCTION`, `CTX_LANGUAGE`, `CONCEPT_TYPE` |
| `incremental` | `CTX_CURRENT`, `USER_INSTRUCTION` | `CTX_LANGUAGE`, `CONCEPT_TYPE` |

**槽位校验**：
- 使用 `OPERATION_SLOT_MAPPING` 白名单校验
- 未声明的槽位直接报错
- 未替换的占位符（如残留 ` {{CTX_*}} `）视为构建失败

### 6.4 变量注入

**基础组件注入**：
- ` {{BASE_TERMINOLOGY}} `
- ` {{BASE_OUTPUT_FORMAT}} `
- ` {{BASE_WRITING_STYLE}} `
- ` {{BASE_ANTI_PATTERNS}} `
**操作模块注入**：
- ` {{OPERATION_BLOCK}} `
**类型注入**：
- ` {{TYPE}} `：等于 `type`，取值为 Domain/Issue/Theory/Entity/Mechanism

## 7. 索引与存储

### 7.1 向量索引架构

**分桶存储**：

```
data/vectors/
├── index.json              # 元数据索引
├── Domain/
│   ├── {uid1}.json
│   └── {uid2}.json
├── Issue/
│   └── {uid3}.json
├── Theory/
│   └── {uid4}.json
├── Entity/
│   └── {uid5}.json
└── Mechanism/
    └── {uid6}.json
```

**优势**：
- 延迟加载：仅在搜索时加载对应类型的向量
- 增量更新：单个概念变更不影响其他文件
- 可扩展性：支持大规模概念库
**搜索流程**：
1. 加载目标类型的所有向量文件
2. 计算余弦相似度（点积，向量已归一化）
3. 返回 topK 结果

### 7.2 CruidCache（SSOT）

`CruidCache` 是 `cruid → TFile` 的单一事实来源（SSOT），用于在运行时解析名称/路径，避免在索引中冗余存储。

**监听源**：

| 事件 | 触发时机 | 处理逻辑 |
|---|-|-|
| `metadataCache.changed` | frontmatter 解析/变更 | 更新 cruid 映射 |
| `vault.rename` | 文件重命名/移动 | 更新 path 映射 |
| `vault.delete` | 文件删除 | 移除映射并触发关联清理 |

**删除清理**（通过订阅 `CruidCache.onDelete` 执行）：
1. `VectorIndex.delete(cruid)`：删除向量索引条目与向量文件（不存在则忽略）
2. `DuplicateManager.removePairsByNodeId(cruid)`：清理 `pending/dismissed` 的重复对（保留 `merging`，避免与 Merge 管线竞态）

**关键变化**：
- `VectorIndex` 与 `DuplicatePair` 不再持久化 `name/path`，因此 `vault.rename/modify` 不需要索引回写

### 7.3 文件存储结构

**数据目录**（`data/`）：

```
data/
├── app.log                    # 运行日志
├── queue-state.json           # 任务队列状态
├── duplicate-pairs.json       # 重复对列表
├── snapshots/                 # 快照目录
│   ├── index.json
│   └── {snapshotId}.md
└── vectors/                   # 向量索引
    ├── index.json
    └── {type}/{uid}.json
```

`app.log` 采用 JSON Lines（单行一条结构化日志），不再提供可切换的格式选项，方便脚本分析与问题定位。

**持久化策略**：

| 文件 | 更新时机 | 格式 |
|---|-|---|
| `queue-state.json` | 入队 / 暂停状态变更 | MinimalQueueState（pendingTasks + paused） |
| `duplicate-pairs.json` | 重复对变更 | DuplicatePair[]（仅 nodeIdA/nodeIdB） |
| `vectors/index.json` | 索引变更 | VectorIndexMeta |
| `snapshots/index.json` | 快照创建/删除 | SnapshotRecord[] |

**原子写入**：
- 快照恢复使用原子写入（temp file + rename）
- 确保数据完整性

**离线迁移**：
- 提供 `scripts/migrate-phase1-2-data.js` 用于迁移 `data/` 下的旧格式文件（可选，默认会生成备份）

## 8. 并发与锁

### 8.1 锁类型

**节点锁**（按 `cruid`）：
- 防止同一笔记并发危险写入
- 例如：同时执行 Merge 和 Incremental Edit
**类型锁**（按 `type`）：
- 防止同类型桶扫描/写入冲突
- 例如：同时执行多个 Domain 类型的去重检测

### 8.2 锁管理

```typescript
class SimpleLockManager {
  private processingCruids = new Set<string>();
  tryAcquire(key: string): boolean;
  release(key: string): void;
  isLocked(key: string): boolean;
  clear(): void;
}
```

**设计决策**：
- 锁仅存在于内存：不做超时、不做持久化
- 节点锁 key = `cruid`
- 类型锁 key = `type:${CRType}`（用于 `DuplicateManager.detect` 的同类型互斥）

### 8.3 重启恢复

- **锁**：重启后自动清空，不存在僵尸锁
- **队列状态**：仅持久化 `pendingTasks`（最小字段）与 `paused`，不恢复锁
- **管线状态**：仅存在于内存，重启后清空（无 `pipeline-state.json`）

## 9. 错误处理

### 9.1 Result Monad

所有可能失败的操作返回 `Result<T>`：

```typescript
type Result<T> = Ok<T> | Err;

interface Ok<T> {
  ok: true;
  value: T;
}

interface Err {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

**使用示例**：

```typescript
const result = await vectorIndex.upsert(entry);
if (!result.ok) {
  logger.error("VectorIndex", "插入失败", result.error);
  return result;
}
// 继续处理 result.value
```

> **同步 API 约定**  
> 纯同步逻辑（例如 `TaskQueue.enqueue/cancel`）直接抛出 `CognitiveRazorError`，由异步边界使用 `toErr()` 转换为 `Result`。这样既避免了层层返回 Result，也能确保 UI 在 catch 中立即反馈错误。

### 9.2 错误码分类

| 前缀 | 类别 | 示例 |
|---|---|---|
| E001 | 输入验证错误 | 无效的 UUID 格式 |
| E002 | 配置错误 | Provider 未配置 |
| E003 | 文件系统错误 | 文件不存在 |
| E004 | 数据不一致 | 索引条目缺失 |
| E201 | Provider 错误 | API 调用失败 |
| E301 | 索引错误 | 向量索引损坏 |
| E302 | 搜索错误 | 相似度计算失败 |
| E303 | 快照错误 | 快照恢复失败 |
| E305 | 任务执行错误 | LLM 输出解析失败 |
| E306 | 管线错误 | 管线阶段转换失败 |

### 9.3 重试策略

**可重试错误**：
- 网络超时
- 速率限制（429）
- 临时服务不可用（503）
**不可重试错误**：
- 输入验证错误
- 配置错误
- 权限错误（401/403）
**重试配置**：
- 最大重试次数：`maxRetryAttempts`（默认 3）
- 退避策略：指数退避（1s, 2s, 4s）

### 9.4 UI 通知策略

- UI 层定义 `ERROR_NOTICE_DURATION = 6000`（毫秒），所有错误类 `Notice` 必须使用该常量，确保反馈时长一致且不会因主题差异导致闪烁。
- `WorkbenchPanel.showErrorNotice()` 统一封装错误提示，其它无权访问视图实例的组件（如 `DuplicatePreviewModal`、`MergeHistoryModal`）直接传入常量参数，维持相同行为。
- 成功与中性提示继续沿用 Obsidian 默认展示时长，避免与错误提示混淆。

## 10. UI 规范

### 10.1 Workbench 四区布局

```
┌─────────────────────────────────────────┐
│         创建概念区（可折叠）             │
│  输入框 + 创建按钮 + 深化按钮            │
├─────────────────────────────────────────┤
│         重复概念区（可折叠）             │
│  重复对列表 + 合并/忽略按钮              │
├─────────────────────────────────────────┤
│         队列状态区（可折叠）             │
│  运行统计 + 暂停/恢复/清空按钮           │
├─────────────────────────────────────────┤
│         最近操作区（可折叠）             │
│  快照列表 + 查看/恢复按钮                │
└─────────────────────────────────────────┘
```

**区域职责**：
1. **创建概念区**
    - 输入框：用户输入概念描述
    - 创建按钮：启动创建管线
    - 深化按钮：对当前笔记执行 Deepen
- AI 进度面板：实时显示所有活跃管线的阶段进度（Define → Tag → Write → Index → Verify → Save），提供进度条、阶段提示、失败状态以及快速操作（查看上下文、确认、预览 Diff）
2. **重复概念区**
    - 显示待处理的重复对
    - 支持排序（相似度/时间/类型）
    - 支持类型过滤
    - 合并按钮：启动 Merge 流程
    - 忽略按钮：标记为非重复
3. **队列状态区**
    - 显示任务统计（待处理/运行中/已完成/失败）
    - 暂停/恢复队列
    - 清空队列
4. **最近操作区**
    - 显示最近的快照记录
    - 查看快照：显示 Side-by-Side Diff
    - 恢复快照：恢复到快照状态

#### 阶段 3 UI/UX 增强

- 类型置信度表使用 `.cr-confidence-high/.medium/.low` 三个语义类，全部引用主题变量，`renderTypeConfidenceTable()` 不再写入内联颜色，第三方主题可直接覆盖。
- 标准化入口按钮使用 `setIcon("corner-down-left")` 渲染 Lucide 图标，加载期间仅切换 `is-loading` 类，由 `styles.css` 的 `::after` spinner 负责动画，`SimpleInputModal` 与之保持一致。
- `改进当前笔记` 按钮通过 `workspace.on("active-leaf-change")` 动态检测激活的 Markdown 笔记：无笔记时禁用并展示“请先打开一个 Markdown 笔记”提示，避免二次点击才看到报错。
- 所有 `cr-collapsible-section` 头部都带 `aria-controls`，同时 `collapseState` 默认让重复概念与历史记录折叠，强调主操作区；`toggle` 逻辑保证状态与 `aria-expanded` 同步。
- Workbench 内部错误提示调用 `showErrorNotice()`，确保 6 秒展示时间，与文档 9.4 的策略一致。
- 设置页的“任务模型配置”采用手风琴卡片：每个任务展示 Provider/模型/参数，实时显示“默认值/自定义”状态，并提供单个/全部重置。无 Provider 时禁用输入并提示配置。

### 10.2 DiffView 规范

**显示模式**：
1. **Side-by-Side**（默认）
    - 左侧：原始内容
    - 右侧：新内容
    - 左右面板同步滚动（使用 `requestAnimationFrame` 防止循环触发）
2. **Unified**（可切换）
    - 统一视图
    - 删除行标记为红色
    - 新增行标记为绿色
**确认流程**：
3. 显示差异视图
4. 顶部显示"自动快照已启用"徽章
5. 用户点击"确认"按钮后执行写入
6. 用户点击"取消"按钮后放弃操作
**适用场景**：
- Merge 确认
- Incremental Edit 确认
- 快照预览

### 10.3 Modal 组件

| Modal | 用途 | 输入 | 输出 |
|-|---|---|---|
| `DeepenModal` | 层级深化候选选择 | 候选列表 | 勾选的候选 |
| `AbstractModal` | 抽象深化相似概念选择 | 相似概念列表 | 勾选的概念 |
| `MergeNameSelectionModal` | 合并后名称选择 | A/B 名称 | 最终名称 |
| `SimpleInputModal` | 单行输入 | 提示文本 | 用户输入 |

### 10.4 主题与样式

- 所有插件样式必须在 `.cr-scope` 下生效，避免污染全局 UI。
- 颜色必须引用 Obsidian CSS 变量（如 `--text-normal`、`--background-primary`、`--interactive-accent`），禁止硬编码 HEX 与 `rgba(...)`。
- 半透明/叠加色使用 `color-mix()` 生成（例如成功/失败底色），确保第三方主题兼容。
- 禁止使用 `!important`，通过提高选择器特异性解决覆盖问题。
- 插件自定义类名统一使用 `cr-` 前缀。

### 10.5 图标规范

- 所有图标使用 Obsidian 的 `setIcon()` API（Lucide 图标库）渲染，禁止内联 SVG 字符串。
- icon-only 按钮必须提供 `aria-label`。

### 10.6 无障碍与键盘

- 所有可交互元素必须可通过键盘完成操作：
  - 具备可聚焦性（原生控件或 `tabindex="0"`）
  - 使用 `aria-*` 提供语义（例如 `role="dialog"`、`aria-modal="true"`、`aria-label`/`aria-labelledby`、`aria-checked` 等）
  - 支持 `Enter`/`Space` 触发主要动作
  - 可选：方向键在列表/卡片项之间移动焦点并切换选择
- Modal 必须设置 `role="dialog"` 与 `aria-modal="true"`，并提供标题绑定（`aria-labelledby`）。

### 10.7 动画偏好

- 必须尊重 `prefers-reduced-motion`：
  - 禁用非必要动画（加载指示、进度条等应提供无动画替代）
  - UndoNotification 的进度条在 reduce 模式下显示静态状态，不做宽度动画

## 11. 命令系统

### 11.1 命令列表

| 命令 ID | 名称 | 功能 |
|---|---|---|
| `open-workbench` | 打开工作台 | 打开 Workbench 面板 |
| `create-concept` | 创建概念 | 启动创建流程 |
| `improve-current-note` | 增量改进当前笔记 | 对当前笔记执行 Incremental Edit |
| `deepen-current-note` | 深化当前笔记 | 对当前笔记执行 Deepen |
| `insert-image` | 插入图片 | 读取上下文并创建图片生成任务 |
| `merge-duplicates` | 合并重复对 | 启动 Merge 流程 |
| `view-duplicates` | 查看重复概念 | 打开重复概念列表 |
| `view-history` | 查看操作历史 | 打开快照列表 |
| `pause-queue` | 暂停队列 | 暂停任务队列 |
| `resume-queue` | 恢复队列 | 恢复任务队列 |
| `clear-queue` | 清空队列 | 清空任务队列 |

### 11.2 快捷键策略

**默认不绑定任何快捷键**：
- 插件不预置快捷键
- 用户可在 Obsidian 的快捷键设置中自行绑定
**原因**：
- 避免与其他插件冲突
- 尊重用户的快捷键习惯

## 12. 配置与国际化

### 12.1 插件设置

```typescript
interface PluginSettings {
  // 基础设置
  version: string;
  language: "zh" | "en";
  
  // 命名设置
  namingTemplate: string;
  directoryScheme: DirectoryScheme;
  
  // 去重设置
  similarityThreshold: number;      // 相似度阈值（0-1）
  topK: number;                     // 返回数量
  
  // 队列设置
  concurrency: number;              // 并发数
  autoRetry: boolean;               // 自动重试
  maxRetryAttempts: number;         // 最大重试次数
  taskTimeoutMs: number;            // 任务超时（毫秒）
  maxTaskHistory: number;           // 任务历史保留上限
  
  // 快照设置
  maxSnapshots: number;             // 快照数量上限
  maxSnapshotAgeDays: number;       // 快照保留天数
  
  // 功能开关
  enableGrounding: boolean;         // 启用校验
  
  // Provider 配置
  providers: Record<string, ProviderConfig>;
  defaultProviderId: string;

  // 任务模型配置
  taskModels: Record<TaskType, TaskModelConfig>;

  // 图片生成配置
  imageGeneration: {
    enabled: boolean;
    defaultSize: "1024x1024" | "1792x1024" | "1024x1792" | string;
    defaultQuality: "standard" | "hd";
    defaultStyle: "vivid" | "natural";
    defaultAspectRatio?: string;
    defaultImageSize?: string;
    contextWindowSize: number;
  };

  // 日志设置
  logLevel: "debug" | "info" | "warn" | "error";
  
  // 嵌入设置
  embeddingDimension: number;       // 向量维度（默认 1536）
  providerTimeoutMs: number;        // Provider 超时（默认 60000）
}
```

### 12.2 目录方案

```typescript
interface DirectoryScheme {
  Domain: string;      // 默认 "1-领域"
  Issue: string;       // 默认 "2-议题"
  Theory: string;      // 默认 "3-理论"
  Entity: string;      // 默认 "4-实体"
  Mechanism: string;   // 默认 "5-机制"
}
```

### 12.3 Provider 配置

```typescript
interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;              // 自定义端点（用于兼容其他服务）
  defaultChatModel: string;
  defaultEmbedModel: string;
  enabled: boolean;
}
```

**支持的 Provider**：
- 系统仅支持 OpenAI 标准格式
- 可通过 `baseUrl` 兼容其他服务（如 OpenRouter）

### 12.4 国际化

**支持语言**：
- 中文（`zh`）
- 英文（`en`）
**翻译范围**：
- UI 文案
- 错误消息
- 设置说明
- 命令名称
**实现方式**：
- 使用 `I18n` 类管理翻译
- 翻译文件位于 `src/core/i18n.ts`
