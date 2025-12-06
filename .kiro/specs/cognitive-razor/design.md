# 设计文档

## 概述

Cognitive Razor 是一个 Obsidian 插件，采用公理化设计方法，实现知识概念的结构化管理。插件的核心功能包括：

1. **概念标准化**：将用户输入的模糊概念转化为标准化的知识节点
2. **语义去重**：自动检测并管理重复的概念
3. **AI 内容生成**：根据知识类型生成结构化内容
4. **增量改进**：支持对现有笔记的渐进式完善
5. **可逆写入**：所有写入操作都可撤销
6. **任务队列**：管理和调度 AI 任务

## 架构

### 分层架构

系统采用三层架构，依赖关系单向：UI 层 → 应用层 → 数据层

```
┌─────────────────────────────────────────┐
│           UI 层                          │
│  WorkbenchPanel, QueueView, DiffView    │
│  StatusBadge, CommandDispatcher         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│           应用层                         │
│  TaskQueue, TaskRunner, LockManager     │
│  DuplicateManager, UndoManager          │
│  ProviderManager, PromptManager         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│           数据层                         │
│  VectorIndex, QueueState, Snapshots     │
│  Settings, Prompts, Logger              │
└─────────────────────────────────────────┘
```

### 核心组件

#### UI 层组件

- **WorkbenchPanel**：统一工作台，整合创建、重复管理、队列状态
- **QueueView**：任务队列详情视图
- **DiffView**：内容差异预览视图
- **StatusBadge**：状态栏徽章
- **CommandDispatcher**：命令统一分发器

#### 应用层组件

- **TaskQueue**：任务入队、持久化、并发调度
- **TaskRunner**：执行任务链、调用 Provider、写入结果
- **LockManager**：nodeId/type 去重/写入锁管理
- **DuplicateManager**：重复检测、重复对管理、合并协调
- **UndoManager**：快照创建/恢复/清理
- **SettingsStore**：配置读写、版本管理
- **ProviderManager**：Provider 选择、API 调用
- **PromptManager**：模板加载、槽位插值
- **Validator**：JSON 解析、Schema 校验、业务规则校验

#### 数据层组件

- **VectorIndex**：概念签名向量存储、相似度检索
- **QueueState**：任务队列持久化
- **DuplicatePairs**：重复对存储
- **Snapshots**：文件快照存储
- **Settings**：插件配置存储
- **Prompts**：提示词模板存储
- **Logger**：循环日志

## 组件和接口

### TaskQueue 接口

```typescript
interface ITaskQueue {
  enqueue(task: Omit<TaskRecord, 'id' | 'created' | 'updated'>): Result<string>;
  cancel(taskId: string): Result<boolean>;
  pause(): void;
  resume(): void;
  getStatus(): QueueStatus;
  subscribe(listener: QueueEventListener): () => void;
}
```

### TaskRunner 接口

```typescript
interface ITaskRunner {
  run(task: TaskRecord): Promise<Result<TaskResult>>;
  abort(taskId: string): void;
}
```

### VectorIndex 接口

```typescript
interface IVectorIndex {
  upsert(entry: VectorEntry): Promise<Result<void>>;
  delete(uid: string): Promise<Result<void>>;
  search(type: CRType, embedding: number[], topK: number): Promise<Result<SearchResult[]>>;
  getStats(): IndexStats;
}
```

### ProviderManager 接口

```typescript
interface IProviderManager {
  chat(request: ChatRequest): Promise<Result<ChatResponse>>;
  embed(request: EmbedRequest): Promise<Result<EmbedResponse>>;
  checkAvailability(providerId: string): Promise<Result<ProviderCapabilities>>;
  getConfiguredProviders(): ProviderInfo[];
}
```

## 数据模型

### Frontmatter 模型

```typescript
interface CRFrontmatter {
  uid: string;              // UUID v4
  type: CRType;             // 知识类型
  status: NoteState;        // 笔记状态
  created: string;          // ISO 8601
  updated: string;          // ISO 8601
  aliases?: string[];
  tags?: string[];
  parentUid?: string;
  parentType?: CRType;
  sourceUids?: string[];
  version?: string;
}

type CRType = "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";
type NoteState = "Stub" | "Draft" | "Evergreen";
```

### 任务记录模型

```typescript
interface TaskRecord {
  id: string;
  nodeId: string;
  taskType: TaskType;
  state: TaskState;
  providerRef?: string;
  promptRef?: string;
  attempt: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  undoPointer?: string;
  lockKey?: string;
  created: string;
  updated: string;
  startedAt?: string;
  completedAt?: string;
  errors?: TaskError[];
}

type TaskType =
  | "embedding"
  | "standardizeClassify"
  | "enrich"
  | "reason:new"
  | "reason:incremental"
  | "reason:merge"
  | "ground";

type TaskState =
  | "Pending"
  | "Running"
  | "Completed"
  | "Failed"
  | "Cancelled";
```

### 重复对模型

```typescript
interface DuplicatePair {
  id: string;
  noteA: {
    nodeId: string;
    name: string;
    path: string;
  };
  noteB: {
    nodeId: string;
    name: string;
    path: string;
  };
  type: CRType;
  similarity: number;
  detectedAt: string;
  status: DuplicatePairStatus;
}

type DuplicatePairStatus =
  | "pending"
  | "merging"
  | "merged"
  | "dismissed";
```

## 正确性属性

*属性是一个应该在所有有效执行中保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：标准化输出完整性

*对于任意*概念描述输入，标准化处理后的输出必须包含中文名、英文名、3-10 个别名、五种类型的置信度（总和为 1.0）和核心定义。

**验证需求**：1.1, 1.2, 1.3

### 属性 2：类型置信度总和恒等

*对于任意*标准化输出，五种知识类型的置信度分数总和必须精确等于 1.0。

**验证需求**：1.3

### 属性 3：Stub 笔记元数据完整性

*对于任意*确认创建的概念，生成的 Stub 笔记的 frontmatter 必须包含 uid、type、status、created、updated 字段，且 uid 为有效的 UUID v4 格式。

**验证需求**：1.5

### 属性 4：同类型去重检索

*对于任意*新创建的概念，系统必须在同类型的概念中执行相似度检索，不得跨类型检索。

**验证需求**：2.1

### 属性 5：去重阈值判定

*对于任意*相似度大于等于阈值的概念对，系统必须将其记录到 DuplicatePairs 存储中。

**验证需求**：2.2

### 属性 6：重复对显示完整性

*对于任意*记录的重复对，在 DuplicatesPanel 中显示时必须包含两个概念的名称、相似度百分比和类型信息。

**验证需求**：2.3, 2.4

### 属性 7：Issue 类型格式约束

*对于任意*生成的 Issue 类型内容，core_tension 字段必须匹配正则表达式 `/^.+ vs .+$/`。

**验证需求**：3.2

### 属性 8：Theory 类型最小约束

*对于任意*生成的 Theory 类型内容，axioms 数组的长度必须大于等于 1。

**验证需求**：3.3

### 属性 9：Mechanism 类型最小约束

*对于任意*生成的 Mechanism 类型内容，causal_chain 数组的长度必须大于等于 2。

**验证需求**：3.4

### 属性 10：写入前快照创建

*对于任意*写入操作，系统必须在写入前创建文件快照，快照内容必须与原文件内容一致。

**验证需求**：5.1

### 属性 11：撤销操作 round trip

*对于任意*已确认的写入操作，执行撤销后文件内容必须恢复到写入前的状态，且快照文件必须被删除。

**验证需求**：5.3

### 属性 12：快照清理策略

*对于任意*快照存储，当快照数量超过上限时，系统必须自动删除最旧的快照，保持快照数量不超过上限。

**验证需求**：5.4

### 属性 13：节点锁互斥

*对于任意*nodeId，在任意时刻最多只能有一个非完成状态的任务持有该节点的锁。

**验证需求**：6.2

### 属性 14：任务取消释放锁

*对于任意*被取消的任务，系统必须释放该任务持有的所有锁，且任务状态必须更新为 Cancelled。

**验证需求**：6.5

### 属性 15：合并后清理

*对于任意*确认的合并操作，系统必须删除被合并的笔记、从 DuplicatePairs 中移除该重复对、更新向量索引。

**验证需求**：7.4, 7.5

### 属性 16：Evergreen 降级

*对于任意*状态为 Evergreen 的笔记，执行增量改进并确认后，笔记状态必须降级为 Draft。

**验证需求**：4.5

### 属性 17：本地存储约束

*对于任意*持久化操作，所有数据文件必须存储在 `.obsidian/plugins/obsidian-cognitive-razor/data/` 目录下。

**验证需求**：9.1

### 属性 18：向量本地存储

*对于任意*生成的向量嵌入，必须存储在本地 `vector-index.json` 文件中，不得依赖远程存储。

**验证需求**：9.3

### 属性 19：本地相似度检索

*对于任意*相似度检索操作，必须在本地向量索引中执行，不得依赖远程服务。

**验证需求**：9.4

### 属性 20：重试上限

*对于任意*失败的任务，系统最多重试 3 次，第 3 次失败后必须将任务标记为 Failed 状态。

**验证需求**：10.1, 10.4

### 属性 21：认证错误终止

*对于任意*返回 401 认证错误的 API 调用，系统必须立即终止任务（不重试）并提示用户检查 API Key。

**验证需求**：10.3

### 属性 22：速率限制退避

*对于任意*返回 429 速率限制错误的 API 调用，系统必须使用指数退避策略重试，每次重试的等待时间必须递增。

**验证需求**：10.2

### 属性 23：键盘焦点导航

*对于任意*交互元素，使用 Tab 键必须能够按顺序切换焦点，且焦点顺序必须符合视觉顺序。

**验证需求**：12.3

### 属性 24：键盘操作触发

*对于任意*聚焦的按钮，按下 Enter 键必须触发对应操作，且效果必须与鼠标点击一致。

**验证需求**：12.4

### 属性 25：屏幕阅读器支持

*对于任意*图标和交互元素，必须提供 aria-label 属性，且状态变更必须通过 aria-live 通知屏幕阅读器。

**验证需求**：12.5

## 错误处理

### 错误码定义

| 代码 | 名称 | 触发条件 | 处理策略 |
|------|------|----------|----------|
| E001 | PARSE_ERROR | 输出非 JSON 或解析失败 | 结构化重试 |
| E002 | SCHEMA_VIOLATION | 不符合输出 Schema | 结构化重试 |
| E003 | MISSING_REQUIRED | 必填字段缺失 | 结构化重试 |
| E004 | CONSTRAINT_VIOLATION | 违反业务规则 | 结构化重试 |
| E005 | SEMANTIC_DUPLICATE | 相似度超阈值 | 记录重复对 |
| E006 | INVALID_WIKILINK | wikilink 格式错误 | 结构化重试 |
| E007 | TYPE_MISMATCH | 类型不符 | 结构化重试 |
| E008 | CONTENT_TOO_SHORT | 内容长度不足 | 结构化重试 |
| E009 | SUM_NOT_ONE | 置信度总和 ≠ 1 | 结构化重试 |
| E010 | INVALID_PATTERN | 不匹配正则 | 结构化重试 |
| E100 | API_ERROR | Provider 返回 5xx/4xx | 指数退避重试 |
| E101 | TIMEOUT | 请求超时 | 指数退避重试 |
| E102 | RATE_LIMIT | 速率限制 (429) | 指数退避重试 |
| E103 | AUTH_ERROR | 认证失败 (401/403) | 终止，提示检查 Key |
| E200 | SAFETY_VIOLATION | 触发安全边界 | 终止，返回拒绝 |
| E201 | CAPABILITY_MISMATCH | Provider 能力不足 | 终止，提示更换 |

### 业务校验规则

| 代码 | 适用类型 | 规则描述 | 失败错误码 |
|------|----------|----------|------------|
| C001 | Issue | core_tension 必须匹配 `/^.+ vs .+$/` | E010 |
| C002 | All | wikilink 必须使用 `[[...]]` 格式 | E006 |
| C003 | Theory | axioms 数组长度 ≥ 1 | E003 |
| C004 | Theory | 每个 axiom 必须包含 justification | E003 |
| C005 | Mechanism | causal_chain 数组长度 ≥ 2 | E003 |
| C006 | Mechanism | operates_on 数组长度 ≥ 1 | E003 |
| C007 | Entity | definition 必须包含属和种差 | E004 |
| C008 | Domain | boundaries 数组长度 ≥ 1 | E003 |
| C009 | standardizeClassify | type_confidences 五值求和 = 1.0 | E009 |

### 重试策略

#### 结构化重试

适用于错误码 E001-E010：

1. 记录错误到 error_history
2. 将错误历史附加到下次 prompt
3. 最多重试 3 次
4. 第 3 次失败后标记任务为 Failed

#### 指数退避重试

适用于错误码 E100-E102：

1. 第 1 次重试：等待 2 秒
2. 第 2 次重试：等待 4 秒
3. 第 3 次重试：等待 8 秒
4. 第 3 次失败后标记任务为 Failed

#### 立即终止

适用于错误码 E103, E200, E201：

1. 不重试
2. 立即标记任务为 Failed
3. 显示错误提示和修复建议

## 测试策略

### 单元测试

单元测试覆盖以下场景：

1. **数据模型验证**：测试 frontmatter、任务记录等数据结构的序列化和反序列化
2. **业务规则校验**：测试 C001-C009 校验规则的正确性
3. **错误码映射**：测试错误码的正确生成和映射
4. **工具函数**：测试 UUID 生成、时间戳格式化等工具函数

### 属性测试

属性测试使用 **fast-check** 库（TypeScript 的属性测试框架），每个测试运行至少 100 次迭代。

属性测试覆盖以下场景：

1. **标准化输出完整性**（属性 1-3）
2. **去重检测正确性**（属性 4-6）
3. **类型特定约束**（属性 7-9）
4. **快照和撤销机制**（属性 10-12）
5. **锁机制正确性**（属性 13-14）
6. **合并流程完整性**（属性 15）
7. **状态转换规则**（属性 16）
8. **本地存储约束**（属性 17-19）
9. **重试策略正确性**（属性 20-22）
10. **可访问性支持**（属性 23-25）

每个属性测试必须使用注释标记对应的属性编号：

```typescript
// **Feature: cognitive-razor, Property 1: 标准化输出完整性**
test('standardization output completeness', async () => {
  await fc.assert(
    fc.asyncProperty(fc.string(), async (input) => {
      const result = await standardize(input);
      expect(result).toHaveProperty('standard_name.chinese');
      expect(result).toHaveProperty('standard_name.english');
      expect(result.aliases.length).toBeGreaterThanOrEqual(3);
      expect(result.aliases.length).toBeLessThanOrEqual(10);
      // ... 更多断言
    }),
    { numRuns: 100 }
  );
});
```

### 集成测试

集成测试覆盖以下场景：

1. **完整创建流程**：从用户输入到笔记创建的端到端测试
2. **合并流程**：从检测重复到合并完成的端到端测试
3. **增量改进流程**：从触发改进到写入完成的端到端测试
4. **撤销流程**：从写入到撤销的端到端测试
5. **队列管理**：任务入队、执行、取消的集成测试

### 测试配置

- 属性测试迭代次数：100 次（可通过环境变量 `PBT_NUM_RUNS` 配置）
- 超时时间：单个测试 30 秒
- 并发执行：禁用（确保测试隔离）
- Mock 策略：仅 Mock 外部 API 调用，不 Mock 内部逻辑

## 性能要求

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 持久化延迟 | ≤ 200ms | 200 次写入最大延迟 |
| UI 刷新延迟 | ≤ 100ms | 状态变更到 UI 更新 |
| 向量检索延迟 | ≤ 500ms | 1000 条索引 TopK=10 |
| 插件启动时间 | ≤ 2s | 冷启动到可用 |

## 安全与隐私

1. **本地优先**：所有持久化数据存储在本地，远程 API 仅用于推理计算
2. **最小化外发**：仅发送用户明确输入的概念信息，不发送 vault 内容
3. **API Key 加密**：使用 Obsidian 的安全存储机制加密 API Key
4. **日志脱敏**：日志中不记录敏感信息（API Key、用户数据）
5. **安全边界**：提示词模板包含安全约束，禁止生成可执行代码或泄露信息
