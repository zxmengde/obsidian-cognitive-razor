# Cognitive Razor 代码审计报告分散，违反 OCP

- 证据：
  - `TaskRunner` 中存在 pipeline 顺序和能力映射分支：`TASK_PIPELINE_ORDER`、`switch (currentTaskType)`、`getRequiredCapability`  
    参考：`src/core/task-runner.ts:45`、`src/core/task-runner.ts:514`、`src/core/task-runner.ts:1779`
  - 多个 orchestrator 依赖 `switch (task.taskType)` 驱动流程：  
    `src/core/create-orchestrator.ts:699`、`src/core/amend-orchestrator.ts:357`、`src/core/merge-orchestrator.ts:386`
- 原则影响：
  - `OCP`：新增任务类型需要在多个模块改 `switch`。
  - `KISS`：行为规则分散在运行器与多个 orchestrator，理解路径长。
- 风险：
  - 新任务接入易漏改（能力映射、顺序校验、完成态处理）。
- 建议：
  - 引入 `TaskTypeRegistry`（单一配置源）声明：能力、顺序、handler、后置动作。
  - orchestrator 侧改为注册式 dispatch，避免重复 `switch`。

## 3.3 严重：反馈通道分散，通知过载，错误信息泄漏技术细节

- 证据：
  - `src/ui` 目录中 `new Notice(...)` 直接调用共 111 处（命令分发、设置页、工作台、向导、模态框等）。
  - `showErrorNotice(...)` 与 `new Notice(...)` 并行存在，策略不统一。
  - 多处直接展示 `result.error.message`：  
    `src/ui/settings-tab.ts:592`、`src/ui/settings-tab.ts:872`、`src/ui/workbench/create-section.ts:322`、`src/ui/workbench/queue-section.ts:444`、`src/ui/command-dispatcher.ts:243`
- 原则影响：
  - `KISS`：用户反馈来源多头，行为不可预测。
  - `DRY`：同类通知模板在多文件重复拼接。
  - UX：违反“错误可恢复、通知分级”。
- 风险：
  - 用户收到过多同层级通知（注意力噪声）。
  - 暴露底层错误信息，不利于可恢复操作引导。
- 建议：
  - 统一为 `UiFeedbackService`：
    - `success/info/warn/error/undo` 五类通道。
    - 统一时长策略。
    - 错误展示限定为 `[错误码]+用户可理解文案`，技术细节只进日志。

## 3.4 高：Diff 预览存在 i18n 缺口和决策对称性问题

- 证据：
  - `WorkbenchPanel` 只传了 4 个标签给 `SimpleDiffView`：  
    `src/ui/workbench-panel.ts:611`
  - `SimpleDiffView` 其余标签回退英文默认值：  
    `src/ui/diff-view.ts:516`、`src/ui/diff-view.ts:520`
  - `DuplicatesSection` 已实现完整标签注入（对照组）：  
    `src/ui/workbench/duplicates-section.ts:421`
  - 接受按钮使用 `cr-btn-primary`，拒绝按钮无对应对称样式：  
    `src/ui/diff-view.ts:599`
  - 旧 `DiffView` 类包含硬编码中文文案且未被引用：  
    `src/ui/diff-view.ts:73`（类定义），`find_referencing_symbols(DiffView)=[]`
- 原则影响：
  - `YAGNI`：保留未使用 `DiffView` 增加维护噪声。
  - UX：多语言不一致、决策按钮显著性不对称。
- 风险：
  - 中文环境混入英文术语，破坏体验一致性。
  - 用户被“主色按钮”隐式 nudging（接受比拒绝更醒目）。
- 建议：
  - 删除未使用的 `DiffView`（或明确迁移计划并标注 deprecated）。
  - `SimpleDiffView` 强制要求完整 label 对象，不允许内部英文默认回退。
  - 接受/拒绝采用对称样式（同级按钮），仅在破坏性动作时使用 danger 语义。

## 3.5 高：设置页过于集中 + 全量重绘，违反 KISS/SRP

- 证据：
  - `CognitiveRazorSettingTab` 单类承载 1000+ 行逻辑：  
    `src/ui/settings-tab.ts:23`
  - `display()` 每次清空并整页重建：  
    `src/ui/settings-tab.ts:33`
  - 多处交互后直接 `this.display()` 刷新：  
    `src/ui/settings-tab.ts:96`、`src/ui/settings-tab.ts:596`、`src/ui/settings-tab.ts:1086` 等
  - 存在多处 JS 内联宽度硬编码：  
    `src/ui/settings-tab.ts:205`、`src/ui/settings-tab.ts:254`、`src/ui/settings-tab.ts:490`
- 原则影响：
  - `SRP`：导航、表单渲染、校验、Provider 管理、导入导出耦合在同类中。
  - `KISS`：全量重绘使状态管理复杂（焦点/滚动/展开态易丢失）。
  - 与 Obsidian 官方“避免 JS/HTML 样式硬编码”建议冲突。
- 风险：
  - 设置项继续增加会快速恶化可维护性。
  - 用户在设置页操作时出现跳动或焦点丢失。
- 建议：
  - 按 tab 拆分为 `GeneralSettingsSection`、`ProviderSettingsSection`、`KnowledgeSettingsSection`、`SystemSettingsSection`。
  - 引入局部更新而非整页重建。
  - 宽度/布局改用 CSS 类和 design token，移除 JS `style.width`。

## 3.6 高：接口过宽，违反 ISP（OrchestratorDeps）

- 证据：
  - `OrchestratorDeps` 包含大量字段：`app/taskRunner/lockManager/schemaRegistry/pipelineStateStore/...`  
    参考：`src/core/orchestrator-deps.ts:28`
  - 例如 `VerifyOrchestrator` 实际只使用很少子集（`i18n/noteRepository/promptManager/settingsStore/taskQueue/undoManager`）。
- 原则影响：
  - `ISP`：调用方被迫依赖不需要的能力集合。
  - `DIP`：依赖粒度过粗，难以替换/测试。
- 风险：
  - 测试替身构造复杂。
  - 未来模块化困难。
- 建议：
  - 按场景拆分 deps 接口：`CommonPipelineDeps` + `CreateDeps` + `MergeDeps` + `VerifyDeps`。
  - 构造函数只注入实际需要的最小接口。

## 3.7 中：重复概念区存在“半成品状态字段”，违反 YAGNI

- 证据：
  - 存在 `currentSortOrder/currentTypeFilter/selectedDuplicates` 状态：  
    `src/ui/workbench/duplicates-section.ts:32`
  - `currentTypeFilter/currentSortOrder` 仅用于内部判断，未发现对应 UI 控件入口与状态变更通路：  
    `src/ui/workbench/duplicates-section.ts:97`、`src/ui/workbench/duplicates-section.ts:209`
  - `selectedDuplicates` 记录勾选，但未形成批量操作路径（仅用于 checkbox 状态读写）。
- 原则影响：
  - `YAGNI`：预置了未交付完整交互链的状态能力。
  - `KISS`：增加阅读和维护复杂度。
- 风险：
  - 团队误判该能力“已支持”。
- 建议：
  - 二选一：
    - 实装完整排序/筛选/批量操作 UI。
    - 或移除未落地状态字段，减少噪声。

## 3.8 中：局部实现存在可维护性风险点

- 证据：
  - `QueueSection` 的 `handleClearPending` 与 `handleClearFailed` 基本同构循环逻辑重复：  
    `src/ui/workbench/queue-section.ts:477`、`src/ui/workbench/queue-section.ts:506`
  - `MergeNameSelectionModal` 使用全局 DOM 查询：  
    `src/ui/merge-modals.ts:177`
- 原则影响：
  - `DRY`：重复控制流。
  - `KISS`：全局查询增加隐式耦合。
- 风险：
  - 弹窗并发场景下可能误选其他节点（全局 name 查询）。
- 建议：
  - 抽取 `clearByState(state)` 公共函数。
  - 将 `document.getElementsByName` 替换为 modal 容器内 scoped 查询。

## 3.9 中：UI 自动化测试缺位，复杂交互缺乏回归保护

- 证据：
  - 当前测试集中在 `src/core` 与 `src/data`，`src/ui` 基本无 `*.test.ts`。
- 原则影响：
  - `KISS`：复杂 UI 只能靠人工回归，迭代成本高。
- 风险：
  - 修复一处交互时引入另一处回归（尤其是 diff、queue、settings）。
- 建议：
  - 增补最小 UI 回归集：
    - Diff 视图（标签完整性、键盘切换、按钮语义）
    - Queue 批量操作确认流
    - Settings 局部更新与焦点保留

## 4. UX/UI 专项诊断结论

## 4.1 与 Obsidian 设计哲学的一致性

- 优点：
  - 大量使用 `--cr-*` 语义变量映射主题变量，方向正确。
  - 大部分工作台区域支持可折叠和键盘触发，基础可访问性已覆盖。
- 差距：
  - 通知/错误反馈入口分散，不满足“低噪声 + 清晰分级”。
  - 仍存在 JS 内联宽度样式，与官方建议存在冲突。
  - 多语言体验不完全一致（Diff 视图部分 fallback 到英文）。

## 4.2 参考同类经典产品实践（Obsidian / VS Code）后的优化方向

- 统一反馈中心：
  - 对齐 VS Code Notifications 原则，降低通知数量、明确分级。
- 强制完整 i18n 合同：
  - 对齐 Obsidian 多语言生态预期，禁止局部默认英语混入。
- 控制宿主风格偏离：
  - 对齐 Obsidian/VS Code Webview 指南，避免 JS 行内样式驱动布局。
- 强化可访问性细节：
  - tablist 使用 roving tabindex + 键盘箭头切换的标准交互。

## 验收指标（建议）

- 直接 `new Notice(...)` 调用点从 111 降至 ≤ 20，并全部通过统一反馈服务出口。
- UI 文案 i18n fallback（英文默认）在中文环境中为 0。
- `*-orchestrator.ts` 共享逻辑复用率显著提升（重复方法名数下降 > 50%）。
- `settings-tab.ts` 行数下降到 < 700，且无 `style.width = "xxxpx"`。
- 新增 UI 自动化回归用例 >= 15 条。

