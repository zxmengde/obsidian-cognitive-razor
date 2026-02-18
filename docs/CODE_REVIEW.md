# Cognitive Razor 代码审计报告（SOLID / KISS / DRY / YAGNI）

## 审计说明
- 审计时间：第二轮深度复核。
- 审计范围：`main.ts`、`src/core/**`、`src/data/**`、`src/ui/**`、`src/types.ts`。
- 审计方法：符号级分析（方法/类/引用链）+ 全仓检索（`rg`）+ 反证校验（确认是否真实被引用/是否属于设计必需）。
- 目标：覆盖问题且避免误报，本报告仅保留证据充分的问题项。

## 结论总览
- 高风险：4 项。
- 中风险：8 项。
- 低风险：8 项。
- 核心矛盾：重复实现 + 胖依赖接口 + 上帝对象 + 历史兼容层残留。

---

## 高风险问题（High）

### H-01 编排器重复实现覆盖 4 个类，且已出现行为漂移
- 违反原则：`DRY`、`OCP`、`KISS`
- 证据：
- `src/core/create-orchestrator.ts:439`
- `src/core/merge-orchestrator.ts:174`
- `src/core/amend-orchestrator.ts:150`
- `src/core/create-orchestrator.ts:714`
- `src/core/merge-orchestrator.ts:398`
- `src/core/amend-orchestrator.ts:369`
- `src/core/verify-orchestrator.ts:300`
- `src/core/create-orchestrator.ts:1030`
- `src/core/merge-orchestrator.ts:1213`
- `src/core/amend-orchestrator.ts:871`
- `src/core/create-orchestrator.ts:1366`
- `src/core/merge-orchestrator.ts:1373`
- `src/core/amend-orchestrator.ts:1042`
- `src/core/verify-orchestrator.ts:598`
- `src/core/merge-orchestrator.ts:1261`
- `src/core/amend-orchestrator.ts:919`
- `src/core/create-orchestrator.ts:1077`
- 分析：
- `confirmWrite / handleTaskFailed / verify 启动 / 报告追加` 在多个编排器里存在高相似复制。
- 错误处理已出现分支漂移：`merge/amend` 对 `E320_TASK_CONFLICT` 做了友好提示，`create` 对应分支缺失。
- 影响：规则演进需要多点同步，遗漏后直接形成用户行为不一致。
- 最小修复建议：抽取 `PipelineLifecycle` 共享组件（状态迁移、任务回调、失败处理、Verify 后处理），各编排器仅保留差异策略。

### H-02 多个关键类呈“上帝对象”形态，职责边界失效
- 违反原则：`SRP`、`KISS`
- 证据：
- `src/core/task-runner.ts:1`（1763 行）
- `src/data/settings-store.ts:1`（1424 行）
- `src/core/task-queue.ts:1`（1146 行）
- `src/ui/settings-tab.ts:1`（1220 行）
- `src/ui/command-dispatcher.ts:57`（类到 728 行）
- `src/ui/workbench-panel.ts:61`（类到 695 行）
- `src/core/task-runner.ts:529`
- `src/core/task-runner.ts:762`
- `src/data/settings-store.ts:546`
- `src/ui/settings-tab.ts:119`
- `src/ui/command-dispatcher.ts:114`
- `src/ui/workbench-panel.ts:544`
- 分析：单类内同时承担“状态管理 + 业务编排 + IO + UI 交互 + 错误显示”多重职责。
- 影响：改动扩散范围大，回归风险高，测试拆分困难。
- 最小修复建议：按职责拆分执行器、配置服务、UI 分区组件和面向场景的门面层。

### H-03 胖接口与 Service Locator 叠加，依赖反转/接口隔离失效
- 违反原则：`DIP`、`ISP`
- 证据：
- `src/core/orchestrator-deps.ts:28`
- `src/core/orchestrator-deps.ts:30`
- `src/core/orchestrator-deps.ts:36`
- `src/core/orchestrator-deps.ts:44`
- `src/core/orchestrator-deps.ts:50`
- `src/core/orchestrator-deps.ts:54`
- `src/core/verify-orchestrator.ts:74`
- `main.ts:795`
- `src/ui/workbench-panel.ts:102`
- `src/ui/command-dispatcher.ts:423`
- 分析：
- `OrchestratorDeps` 过宽（17 依赖），具体 orchestrator 仅使用子集却被迫耦合全量。
- `plugin.getComponents()` 让 UI 可直接抓取大量内部服务，服务边界变弱。
- 影响：可替换性降低，mock 成本升高，依赖关系不透明。
- 最小修复建议：为每个 orchestrator 定义最小依赖接口；UI 改为能力门面而非全量组件暴露。

### H-04 向量数学逻辑重复且语义不一致
- 违反原则：`DRY`、`KISS`
- 证据：
- `src/core/vector-index.ts:805`
- `src/core/vector-index.ts:830`
- `src/core/duplicate-manager.ts:626`
- `src/core/duplicate-manager.ts:646`
- 分析：
- `normalize` 与 `normalizeVector` 重复。
- `dotProduct` 维度不一致行为不一致：`VectorIndex` 抛错，`DuplicateManager` 静默截断。
- 影响：相似度计算语义可能漂移，问题不易定位。
- 最小修复建议：抽取统一 `VectorMath`，并统一维度策略（建议 fail-fast）。

---

## 中风险问题（Medium）

### M-01 Prompt 构建流程在 3 个入口重复
- 违反原则：`DRY`、`KISS`
- 证据：
- `src/core/prompt-manager.ts:244`
- `src/core/prompt-manager.ts:414`
- `src/core/prompt-manager.ts:766`
- 影响：模板规则变更需要多点同步，容易漏改。
- 最小修复建议：抽取统一的模板渲染管线，差异通过槽位契约策略注入。

### M-02 输入清洗与 JSON fenced 解析重复实现
- 违反原则：`DRY`
- 证据：
- `src/core/task-runner.ts:121`
- `src/core/create-orchestrator.ts:117`
- `src/core/task-runner.ts:858`
- `src/core/create-orchestrator.ts:178`
- 影响：安全/容错规则在不同入口可能逐步漂移。
- 最小修复建议：抽取 `InputSanitizer` 与 `JsonBlockParser` 共享实现。

### M-03 Diff 标签映射重复（WorkbenchPanel 与 DuplicatesSection）
- 违反原则：`DRY`
- 证据：
- `src/ui/workbench-panel.ts:610`
- `src/ui/workbench/duplicates-section.ts:384`
- 影响：i18n key 变更时双点维护。
- 最小修复建议：抽取 `buildDiffViewLabels(t)`。

### M-04 状态栏 fallback 文本重复定义
- 违反原则：`DRY`
- 证据：
- `src/ui/status-badge.ts:132`
- `src/ui/status-badge-format.ts:101`
- 影响：文案策略修改可能不一致。
- 最小修复建议：保留单一 fallback 实现。

### M-05 CommandDispatcher 中激活 Markdown 文件判断重复
- 违反原则：`DRY`、`KISS`
- 证据：
- `src/ui/command-dispatcher.ts:332`
- `src/ui/command-dispatcher.ts:338`
- `src/ui/command-dispatcher.ts:359`
- `src/ui/command-dispatcher.ts:365`
- 影响：行为规则改动需要多处同步。
- 最小修复建议：抽取 `withActiveMarkdownFile` 高阶门控。

### M-06 `types.ts` 聚合过度，跨域耦合高
- 违反原则：`SRP`、`KISS`
- 证据：
- `src/types.ts:1`（1470 行）
- `src/types.ts:429`
- `src/types.ts:525`
- 影响：任意领域改动都需要进入超大文件，冲突概率高。
- 最小修复建议：按 domain/task/provider/result 拆分类型文件。

### M-07 `main.ts` 组合根方法过长
- 违反原则：`SRP`、`KISS`
- 证据：
- `main.ts:295`
- `main.ts:472`
- 影响：初始化顺序依赖复杂，排障困难。
- 最小修复建议：拆分为基础设施、AI 能力、编排器、运行态恢复四个注册阶段。

### M-08 `i18n.t()` 兼容接口把 `any` 扩散到 UI 层
- 违反原则：`KISS`、`ISP`
- 证据：
- `src/core/i18n.ts:81`
- `src/core/i18n.ts:84`
- `src/core/i18n.ts:87`
- `src/ui/settings-tab.ts:65`
- `src/ui/status-badge.ts:101`
- 分析：`t()` 无参返回整棵翻译对象（`any`），调用方大量依赖动态属性访问。
- 影响：类型系统无法约束键路径，重构/改键时运行时风险增大。
- 最小修复建议：主路径统一使用 `t("a.b.c")`；无参模式保留为过渡接口并加弃用计划。

---

## 低风险问题（Low）

### L-01 废弃 `DiffView` 仍保留大段实现且无实例化
- 违反原则：`YAGNI`、`KISS`
- 证据：
- `src/ui/diff-view.ts:71`
- `src/ui/diff-view.ts:74`
- `src/ui/diff-view.ts:488`
- 全仓检索：`rg -n "new DiffView\(" src` 无命中。
- 最小修复建议：移除旧类或迁入 `legacy/` 隔离区。

### L-02 `DuplicateManager.startMerge` 未被调用且职责注释冲突
- 违反原则：`YAGNI`
- 证据：
- `src/core/duplicate-manager.ts:288`
- `src/core/duplicate-manager.ts:311`
- 全仓检索：`rg -n "startMerge\(" src main.ts` 仅命中定义。
- 最小修复建议：删除未使用 API，或接入真实流程后统一任务 ID 职责。

### L-03 `CreateOrchestrator.standardizeDirect` 为未使用别名
- 违反原则：`YAGNI`
- 证据：
- `src/core/create-orchestrator.ts:206`
- 全仓检索：`rg -n "standardizeDirect\(" src main.ts` 仅命中定义。
- 最小修复建议：删除或标注 `@deprecated` 并设定移除窗口。

### L-04 SettingsStore 双命名 API 并存
- 违反原则：`KISS`、`YAGNI`
- 证据：
- `src/data/settings-store.ts:349`
- `src/data/settings-store.ts:1286`
- `src/data/settings-store.ts:386`
- `src/data/settings-store.ts:1403`
- `src/data/settings-store.ts:393`
- `src/data/settings-store.ts:1414`
- `src/data/settings-store.ts:435`
- `src/data/settings-store.ts:1421`
- 最小修复建议：统一公开 API 命名，兼容名进入弃用流程。

### L-05 默认值常量重复定义
- 违反原则：`DRY`
- 证据：
- `src/data/settings-store.ts:42`
- `src/core/task-queue.ts:100`
- 最小修复建议：集中到单一 defaults 源。

### L-06 `validators.ts` 存在 4 个全仓未引用导出函数
- 违反原则：`YAGNI`、`KISS`
- 证据：
- `src/data/validators.ts:54`（`generateTimestamp`）
- `src/data/validators.ts:73`（`validateCRFrontmatter`）
- `src/data/validators.ts:174`（`validateTaskRecord`）
- `src/data/validators.ts:254`（`validateDuplicatePair`）
- 引用链校验：`find_referencing_symbols` 对上述 4 个符号均返回空列表。
- 最小修复建议：删除未使用导出；若保留给未来功能，改为内部并补充启用路径。

### L-07 重复对列表的多选交互未闭环（复选框状态不产生业务效果）
- 违反原则：`YAGNI`、`KISS`
- 证据：
- `src/ui/workbench/duplicates-section.ts:25`
- `src/ui/workbench/duplicates-section.ts:26`
- `src/ui/workbench/duplicates-section.ts:124`
- `src/ui/workbench/duplicates-section.ts:129`
- `src/ui/workbench/duplicates-section.ts:131`
- 分析：代码已维护 `selectedDuplicates`，但无任何批量动作消费该集合。
- 最小修复建议：要么补齐批量操作，要么移除多选 UI 与状态。

### L-08 `StatusBadge.getStatusText_forTest` 全仓未引用
- 违反原则：`YAGNI`
- 证据：
- `src/ui/status-badge.ts:207`
- 全仓检索：`rg -n "getStatusText_forTest"` 仅命中定义。
- 最小修复建议：移除该方法，或迁移到测试专用辅助层。

---

## 已复核但不计入问题（避免误报）
- `FileStorage` 的向量读写薄封装不是冗余死代码：`VectorIndex` 与 `ExpandOrchestrator` 有明确调用路径。
- `TaskQueue.stop()` 虽为轻量实现，但在 `onunload` 生命周期中被显式调用，不属于未使用接口。
- `TaskRunner.executeWriteLegacy()` 仍是 `WRITE_PHASES` 异常场景的回退分支，当前不按死代码处理。

---

## 优先整改建议
1. 第一阶段：先做 `H-01 ~ H-04`，优先消除重复实现与胖依赖。
2. 第二阶段：处理 `M-01 ~ M-08`，统一中层抽象和类型边界。
3. 第三阶段：处理 `L-01 ~ L-08`，清理历史残留与未闭环交互。

## 备注
- 本报告仅聚焦 SOLID/KISS/DRY/YAGNI，不替代功能正确性和性能评测报告。
- 若需要，我可以继续输出“逐文件重构任务拆解（含回归测试点与风险顺序）”。
