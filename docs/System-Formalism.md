# Cognitive Razor - 系统形式化

## 1. 原语

### 1.1 数据原语
- **KnowledgeNode**：表示结构化概念的 Markdown 文件；类型限定为 `Domain`、`Issue`、`Theory`、`Entity` 或 `Mechanism`，并以 `nodeId` 建立索引。
- **NodeSchema**：机读 JSON Schema 仓库，单一事实来源位于 `docs/schemas/node_schemas.json`，定义各类型字段顺序、必填约束与描述，供提示词构建器、验证器与 UI 共享。
- **NodeState**：记录于 YAML 前置字段并在队列元数据中镜像的离散生命周期标记，取值 `{Stub, Draft, Evergreen}`。
- **TaskRecord**：描述单次 AI 操作的原子、可逆任务，包含 `{taskId, taskType, targetId, parentTaskId, status, payloadHash, createdAt, startedAt, completedAt, undoPointer}`，其中 `parentTaskId` 关联批处理容器，`status ∈ {Waiting, Running, Paused, Completed, Failed, UndoPending, Reverted}` 覆盖撤销链路。
- **TaskGroup**：以 `parentTaskId` 表示的逻辑容器，保存 `{groupId, label, childTaskIds[], constraints}`，用于跟踪深化批处理等子任务集合，并继承 AX-4 的快照记录策略。
- **TaskQueue**：持久化的 `TaskRecord` 优先级队列，尊重 `maxConcurrency` 并原生支持 `TaskRecord` 的所有状态；撤销流程会将原任务置为 `UndoPending`，成功回滚后标记为 `Reverted`。
- **ChangeSnapshot**：由任何写入型任务在执行前生成的磁盘快照，包含 `{snapshotId, targetPaths[], createdAt, storagePath, checksum}`，与 `undoPointer` 一一对应以满足 AX-4 的可逆性。
- **DedupCluster**：由相似度计算标记的 `KnowledgeNode` 集合，附带 `{clusterId, similarityMetric, threshold, members, suggestedAction}` 聚类信息，同时在相关节点上设置 `dedupLocked` 标记以阻止新的写入任务。
- **ProviderProfile**：描述单个大语言模型端点的配置包，包含 `{providerId, apiType, baseUrl, modelName, capabilities}`。
- **PromptTemplate**：引用公理与 Schema 的参数化指令工件，以结构化 JSON 存储以满足提示词工程要求。

### 1.2 过程原语
- **Normalization**：将用户输入转化为规范化命名候选及类型概率分布的 AI 流程。
- **MetadataSynthesis**：在不生成正文的前提下，输出满足 `NodeSchema` 要求字段的 YAML 数据块的 AI 流程。
- **ContentSynthesis**：生成符合 `NodeSchema` 语义与格式约束的正文内容的 AI 流程。
- **FactVerification**：调用支持溯源搜索的模型，为节点追加经验证引用的 AI 流程。
- **DedupResolution**：比较聚类节点并依据 `G1` 目标给出合并或保留指令的 AI 流程。
- **UndoExecution**：依据 `TaskRecord.undoPointer` 回放逆操作的本地确定性回滚流程，完全依赖 `ChangeSnapshot`，不调用 LLM。

### 1.3 界面原语
- **SidebarPanel**：拆分为 `{InputConsole, QueueMonitor, DedupCenter, TaskHistory, GlobalStatus}` 子视图的持久 UI 面板。
- **CommandRoute**：可绑定快捷键的命令路由，用于聚焦侧边栏或快速创建任务。
- **StateBadge**：嵌入 Obsidian 编辑器、展示当前 `NodeState` 并提供可行动作的可视标记。

## 2. 公理体系

| ID | 类别 | 陈述 |
|:---:|:---|:---|
| AX-1 | 语义完整性 | 每个 `KnowledgeNode` 必须且仅能属于一种节点类型，并持续满足对应 `NodeSchema` 的必填字段。 |
| AX-2 | 生命周期一致性 | 节点生命周期允许 `Stub → Draft → Evergreen` 及 `Evergreen → Draft`，不允许其他状态迁移。 |
| AX-3 | 人类裁决优先 | 只有用户可以触发写入；AI 任务仅响应用户确认的队列项执行。 |
| AX-4 | 可逆性确定 | 每个修改磁盘状态的任务都必须登记逆操作，以便恢复至执行前快照。 |
| AX-5 | 上下文定位 | AI 提示必须通过显式分隔符隔离指令、数据与 Schema，并与 PDD 技术公理一致。 |
| AX-6 | 本地持久化 | 除模型调用外的所有工件（队列、日志、嵌入）均以 JSON 形式存储于 `.obsidian/plugins/cognitive-razor/data/`。 |
| AX-7 | 去重充分性 | 同一 `DedupCluster` 内的任意节点对必须通过 AI 合并或仅保留一个并重定向反向链接；在决议完成前相关节点处于 `dedupLocked` 状态，不得触发新的写入任务。 |
| AX-8 | 并发安全 | 同时运行的任务数不超过 `maxConcurrency`，并发写入必须作用于互斥节点集合。 |
| AX-9 | 提供商抽象 | 任务模板引用 `ProviderProfile` 的能力契约，使提示载荷除传输细节外不依赖具体提供商。 |
| AX-10 | 可观测最小化 | 面向队列的日志仅暴露撤销和审计所需数据（差异元数据、时间戳、提供商信息），不额外保存遥测。 |

## 3. 推导约束与定理

### 3.1 节点构造定理
1. **Normalization 完备性**：由 AX-1 与 AX-3，可知若无 `Normalization` 任务输出 `{canonicalName, typeCandidates}`，节点不得进入队列；用户选择即实例化 `KnowledgeNode` 元数据。
2. **Schema 满足性**：由 AX-1 与 AX-5，`MetadataSynthesis` 必须填充所有必需的 YAML 字段；若缺失则任务失败并给出诊断提示。
3. **Draft 晋升**：节点仅在最新一次 `ContentSynthesis` 成功后才能 `Stub → Draft`；撤销该任务会依据 AX-4 恢复为 `Stub`。
4. **Evergreen 认证**：只有用户的显式确认才可将 `NodeState` 设为 Evergreen；其后任意 AI 修改都会触发 `Evergreen → Draft`（AX-2）。

### 3.2 队列机制
1. **任务排序**：`TaskQueue` 先按优先级后按 FIFO 排序；用户可以调整优先级、暂停或重排等待任务，并须满足 AX-8 的并发约束。`parentTaskId` 仅影响 UI 分组与统计，不改变调度算法。
2. **持久性保证**：每次队列状态变化（含活跃计时器、`maxConcurrency` 与 `TaskGroup` 元数据）都需写入 `queue_state.json`（AX-6）。
3. **撤销执行**：撤销已完成任务时，会入队一个系统生成的 `UndoExecution`，其负载仅引用 `undoPointer` 与目标校验和，执行阶段直接读取 `ChangeSnapshot` 字节级恢复内容，并在成功后删除快照（AX-4）。

### 3.3 去重逻辑
1. **集群构建**：每次 `ContentSynthesis` 后重算嵌入；任意相似度 ≥ `dedupThreshold` 的节点会在 `dedup_clusters.json` 中形成聚类。
2. **AI 合并流程**：`DedupResolution` 需构建比较提示，包含双方 Schema；合并结果写回保留节点，并重定向被移除节点的反向链接。`dedupLocked=true` 的节点在任务完成前禁止进入 `ContentSynthesis`、`FactVerification` 等写入流程，确保 AX-7 的“不可忽略”。
3. **保留指令**：当判断无需合并时，AI 必须给出保留指令，规范所有反向链接指向优选节点，并将冗余文件归档供人工复核；解除 `dedupLocked` 后才可继续其他任务。

### 3.4 事实核查逻辑
1. **溯源追加**：事实核查输出追加至 Markdown 末尾的 `## Verification` 部分，记录带时间戳的条目与来源引用。
2. **幂等性**：针对同一节点重复核查时，要么更新既有条目的时间戳，要么追加新的日期条目；撤销则移除最近一次追加。

### 3.5 提供商与提示治理
1. **模板绑定**：提示引用 `ProviderProfile` 属性；切换提供商仅改写传输元数据，不改变 Schema 逻辑。
2. **能力约束**：任务需声明必要能力（如 `{ "grounded_search": true }`）；若提供商未满足，队列需拒绝此任务。
3. **提示序列化**：所有 `PromptTemplate` 以 `{instruction, context, schema, examples}` 字段的 JSON 持久化，以满足 AX-5。
4. **响应校验**：任务执行器必须在写入前校验模型响应是否符合 Schema；若不合格则重试或请求用户介入。

## 4. 跨文档可追溯性
- `System-Formalism.md` 定义的原语与公理被 PRD 的功能需求、PDD 的提示模板以及 UCD 的交互流程共同引用。
- 任何节点 Schema 或任务类型的修改，都必须同步更新 `docs/schemas/node_schemas.json`、PRD 第 3 节与 PDD 中的相关段落，以维护 AX-1 与 AX-5。
- 若新增提供商，需要更新配置中的 `ProviderProfile` 定义，并验证提示仍符合能力约束。