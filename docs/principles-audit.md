# KISS/YAGNI/DRY/SOLID 审计报告

范围：审查 `main.ts` 与 `src/**` TypeScript 代码，聚焦可维护性与架构一致性。

## 发现与建议

1) **PipelineOrchestrator 过于庞大且职责混杂（KISS，SRP 违反）**  
- 证据：`src/core/pipeline-orchestrator.ts:91` 定义的单个类长达 2,887 行，既管理管线状态/事件（如 `startCreatePipeline*` 等起始流程）、又负责文件写入 (`atomicWriteVault` at `:2389`)、内容渲染 (`renderObjectArray` at `:2525` 等)、前置校验与 frontmatter 解析 (`parseFrontmatter` at `:2796`)。  
- 影响：难以测试、修改任一职责都会牵动其它路径，违反单一职责与简洁性。  
- 建议：拆分为专用组件，例如 PipelineStateService（管线状态/事件与任务映射）、ContentRenderer（render*/build* 系列）、FrontmatterService（解析/生成）、FileWriter（统一复用 FileStorage 进行原子写入），通过接口注入减轻耦合。

2) **Frontmatter/文件名处理重复实现（DRY 违反）**  
- 证据：`src/core/pipeline-orchestrator.ts:2376-2378` 的 `sanitizeFileName` 与 `src/core/naming-utils.ts:159-165` 重复；`pipeline-orchestrator` 中的 `parseFrontmatter`/`buildFrontmatterString` (`:2796` 与 `:2847`) 与 `src/core/frontmatter-utils.ts:29`、`:129` 已提供的生成/解析逻辑重复。  
- 影响：行为漂移风险（如空白修剪、数组处理细节不同），维护成本上升。  
- 建议：统一改用 `naming-utils` 与 `frontmatter-utils` 的实现，并将 PipelineOrchestrator 中的同名方法替换为注入式依赖。

3) **TaskQueue 同时承担调度、锁、持久化、事件发布（SRP/KISS 违反）**  
- 证据：`src/core/task-queue.ts:57` 初始化读写文件、`enqueue` 里持久化+事件（`:97` 及后续）、`tryScheduleAll`/`scheduleOneTask` 调度（`:456`, `:486`）、`handleTaskSuccess`/`handleTaskFailure` 状态机与日志（`:618`, `:663`），`restoreQueueState` 再次处理持久化格式 (`:959`)。  
- 影响：逻辑交叉使得任何重试/并发改动都需遍历多处路径，难以验证。  
- 建议：拆分 QueueStore（加载/保存/trim 历史）、Scheduler（锁检查与并发槽管理）、EventBus（publish/subscribe），TaskQueue 只协调它们；同时为持久化与调度分别建立单元测试。

4) **TaskRunner 职责过载，既做校验又做文件与向量索引操作（SRP 违反）**  
- 证据：`src/core/task-runner.ts:43` 内嵌 InputValidator、`run` 入口 (`:193`) 校验 Provider 能力并分发、`updateNoteStatus` 及 frontmatter 更新 (`:340` 以后) 直接读写文件、向量索引删除写入 (`:419` 起) 也在同一类内。  
- 影响：LLM 调用、文件 I/O、索引操作耦合，难以分别替换或测试。  
- 建议：抽离 InputValidator 为独立可复用服务；将文件/索引相关操作下沉到 NoteRepository/VectorIndexService，通过接口注入，TaskRunner 仅编排任务步骤。

5) **SettingsStore 手写字段验证与合并逻辑冗长（KISS/DRY 违反）**  
- 证据：`validateSettingsDetailed` 从 `src/data/settings-store.ts:479` 起手工检查每个字段类型/范围，一直到 `:930`；`mergePartialSettings`/`applyNumberUpdate` (`:960` 之后) 再次逐字段处理。此类校验未复用现有 `src/data/validator.ts` 与 `validators.ts` 中的通用方法。  
- 影响：新增字段需要多处同步修改，容易遗漏边界；重复代码阻碍演进。  
- 建议：用统一的 schema 描述（例如基于字段定义映射）驱动校验与合并，或复用 Validator/validators 中的通用检查，减少手写分支并集中错误消息。

6) **WorkbenchPanel UI 组件过大且混入业务流程（SRP/KISS/DRY 违反）**  
- 证据：`src/ui/workbench-panel.ts:73` 的类长达 2,777 行；既在渲染队列/重复/创建 UI，又直接控制队列状态（`renderQueueStatus`/pause/resume at `:286-319`, `:590`）、重复概念操作 (`renderDuplicatesSection` at `:657`)、队列细节绘制 (`:2285`) 及调用管线/合并模态。  
- 影响：视图层与业务状态强耦合，重用性低，UI 变更容易引入逻辑回归。  
- 建议：拆成子组件（创建区、重复区、队列区、最近操作区）+ 一个轻量 ViewModel，视图只关心渲染与事件，业务操作通过注入的 service/dispatcher 完成。

7) **遗留/占位逻辑未清理（YAGNI 违反）**  
- 证据：`src/core/pipeline-orchestrator.ts:273-279` 的 `startCreatePipeline` 已标记废弃且只返回错误；`src/ui/settings-tab.ts:21` 定义了 `tasks` 选项但 `display` 中 `case "tasks"` 仅重用 `renderKnowledgeTab` (`:58`)，增加路径复杂度。  
- 影响：增加阅读与维护成本，混淆真实入口。  
- 建议：移除废弃入口或改为薄包装调用实际实现，并在 UI 层隐藏无效 tab，确保代码路径唯一。

8) **ProviderManager 请求执行重复（DRY 违反）**  
- 证据：`src/core/provider-manager.ts:573-760` 的 `executeChatRequest`、`executeEmbedRequest`、`executeImageRequest` 三段几乎一致（超时控制、AbortController/事件、fetch 调用、错误映射均重复），仅解析响应体不同。  
- 影响：超时/重试/错误策略更新需多处同步修改，易出现分支差异；可测试性下降。  
- 建议：提取通用 HTTP 执行器（接收解析器与成功映射回调），共享超时与错误处理；或复用 RetryHandler 内部封装，减少重复样板。

9) **DiffView 预留实现未被使用（YAGNI）**  
- 证据：`src/ui/diff-view.ts:52` 定义 `DiffView`（注释说明“预留供未来使用”）且未导出，代码库仅使用 `SimpleDiffView`；未找到对 `DiffView` 的实例化引用。  
- 影响：增加文件体积与认知负担，可能与 SimpleDiffView 行为漂移。  
- 建议：若确实不需高级 Diff，移除或将 SimpleDiffView 升级覆盖；如需保留占位，至少改为导出接口+ TODO 说明并隔离到独立文件。

## 优先级建议
- 首先处理 DRY 重复（项 2），可直接降低行为分歧风险。  
- 随后拆分超大类（项 1/3/4/6），以服务/组件化方式收敛职责，再补充针对性测试。  
- 并行考虑 ProviderManager 请求去重（项 8），减少未来接口调整的重复修改。  
- 最后清理遗留入口和未用占位（项 7/9），并为 SettingsStore 引入统一校验策略（项 5），提升可演进性。 
