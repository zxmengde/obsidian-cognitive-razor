# Cognitive Razor - 用户使用设计文档

## 0. 引用
- `docs/System-Formalism.md`: 定义 `SidebarPanel`, `TaskQueue`, `StateBadge` 等原语。
- `docs/PRD-产品需求文档.md`: 规定任务体系、节点生命周期、数据结构。
- `docs/PDD-提示词设计文档.md`: 提供任务所需的 Prompt 模板结构。

## 1. 设计原则
- 面向具备高结构化意愿的知识工作者，强调低频高强度的专注体验。
- 所有写入操作由用户显式触发，AI 不主动生成内容。
- 同一操作通路在 UI、命令面板与快捷键之间保持一致的语义标签。
- 侧边栏作为唯一持久界面，任何关键状态均需可视化呈现。

## 2. 界面结构

### 2.1 侧边栏布局
1. **InputConsole**（顶部）
    - 输入框：接受概念、段落或深化指令。
    - “分析”按钮：触发 `Normalization` 任务。
    - 历史输入下拉：提供 `naming_cache` 命中结果。
2. **QueueMonitor**
    - 列表按 `priority` 排序，显示 `taskType`, `targetId`, `status`, `providerId`, `updatedAt`。
    - 行内操作：`Run Now`, `Pause`, `Resume`, `Reorder`, `Undo`。
3. **DedupCenter**
    - 展示待处理 `DedupCluster`，每个集群显示成员概要、相似度、建议动作。
4. **TaskHistory**
    - 最近任务与撤销记录，支持过滤 `taskType`、`status`。
5. **GlobalStatus**（底部）
    - 显示 `maxConcurrency`, 活跃任务数量、当前 Provider。
    - 提供入口打开设置面板。

### 2.2 状态栏组件
- `CR Queue` 指示器：显示等待/运行/失败任务计数，点击后聚焦侧边栏 QueueMonitor。
- `CR Provider` 指示器：显示当前默认 Provider 名称以及 Grounding 支持状态。

### 2.3 编辑器内 StateBadge
- 显示 `nodeState` 与 `nodeType`。
- 提供动作按钮：`Generate Content`, `Request Revision`, `Fact-check`, `Mark Evergreen`, `Downgrade Draft`（依据当前状态动态展示）。

## 3. 关键交互流程

### 3.1 新节点创建
1. 用户在 InputConsole 输入概念 → 点击“分析”。
2. Normalization 结果以内联面板显示：候选名称 + 类型 + 置信度。
3. 用户确认类型 → 自动创建 `MetadataSynthesis` 任务并进入队列。
4. 任务完成后在 TaskHistory 中提示“Stub ready”，同时打开笔记（仅 YAML）。
5. 用户从 StateBadge 或 QueueMonitor 触发“生成正文” → `ContentSynthesis` 任务执行。
6. 内容生成完成后，状态从 Stub 变为 Draft；StateBadge 显示“Draft”并提供后续操作按钮。

### 3.2 深化操作
1. 用户在打开的父节点中点击 StateBadge 的“深化”按钮或通过命令面板输入 Deepen 命令。
2. 弹出对话框收集子节点数量上限与提示信息。
3. 系统批量创建 `Normalization` 子任务，并以 `parentTaskId` 聚合作为 `TaskGroup` 在 QueueMonitor 中显示进度（已完成/全部）。
4. 每个子任务完成后进入相同流程：确认类型 → Metadata → Content。

### 3.3 Draft 审阅与 Evergreen
1. Draft 状态的笔记在 StateBadge 中显示 `Mark Evergreen` 与 `Request Revision`。
2. 用户点击 `Request Revision` 打开弹窗，填写自然语言指示，生成 `ContentSynthesis` (revise) 任务。
3. AI 输出更新正文并附变更摘要，StateBadge 若原为 Evergreen 自动降级为 Draft。
4. 用户完成人工审阅后点击 `Mark Evergreen`，仅在本地写入，队列不参与。

### 3.4 Fact-check
1. 用户在 StateBadge 中点击 `Fact-check`，并选择待核查的段落范围（可选）。
2. `FactVerification` 任务加入队列，需 Grounding 能力的 Provider。
3. 任务完成后在笔记末尾追加 `## Verification` 区块条目，并在 TaskHistory 中列出结果摘要。
4. 用户可在 TaskHistory 中点击“撤销”删除最新条目。

### 3.5 去重处理
1. DedupCenter 列出待处理集群，行内显示候选节点、相似度、最近修改时间。
2. 用户点击“解析”触发 `DedupResolution` 任务。
3. AI 输出合并或保留指令后，UI 显示变更摘要与重定向列表，并提供“撤销”按钮。
4. 集群处于 `Pending/Resolving` 时，涉及节点在 StateBadge 与节点列表上展示“去重处理中”锁图标，禁用 `Generate Content`、`Fact-check` 等写入入口；只有当用户确认决议并完成任务后锁定状态才解除。

### 3.6 队列管理
- 调整优先级：拖拽任务或在任务菜单中选择“提升优先级/降低优先级”。
- 并行设置：GlobalStatus 提供“并行度”控制滑块；更改后立即持久化 `settings.json`。
- 暂停所有：QueueMonitor 顶部提供 `Pause All` / `Resume All` 按钮。
- 被 `dedupLocked` 的任务在列表中以灰色锁图标显示“等待去重”，点击后跳转 DedupCenter 以提示用户优先处理。

## 4. 信息架构
- 侧边栏列表项采用紧凑行高，每行展示任务类型图标 + 文本描述。
- Context menu 使用统一快捷键提示（如 `Ctrl+Shift+R` 对应“Request Revision”）。
- 重要状态（任务失败、去重冲突）在 GlobalStatus 上以红色点位提示，悬停显示详情。

## 5. 命令面板映射
- `CR: Toggle Sidebar`
- `CR: Analyze Concept`
- `CR: Deepen Current Node`
- `CR: Generate Content`
- `CR: Request Revision`
- `CR: Fact-check Node`
- `CR: Open Dedup Center`
- `CR: Undo Last Task`
- `CR: Increase Queue Priority`
- `CR: Decrease Queue Priority`

所有命令默认未绑定快捷键，由用户按需配置。

## 6. 状态与反馈
- 成功反馈：任务完成后在 TaskHistory 中闪烁 2 秒绿色高亮，并在状态栏显示摘要。
- 错误反馈：QueueMonitor 行内出现红色“重试”按钮，悬停展示错误详情；同时状态栏显示感叹号并可点击定位。
- 撤销反馈：执行完成后在 TaskHistory 中插入“Undo”记录，显示恢复目标的 Hash 校验结果。

## 7. 可访问性与国际化
- 支持键盘完全操作：InputConsole、QueueMonitor 均可使用 Tab/Arrow 导航；提供 `Space` 激活行操作。
- 所有状态颜色同时提供图标/文字提示，确保色弱用户可识别。
- 文案采用中文主界面，设置中可切换英文（需准备 i18n 字典）。

## 8. 引导与帮助
- 首次安装展示导览弹窗：
  1. 介绍侧边栏结构。
  2. 指引完成一次标准化→生成→审阅流程。
  3. 提醒设置 `namingTemplate` 与 Provider。
- 帮助菜单提供链接至项目文档与常见问题，FAQ 包含撤销机制、去重策略、并发设置说明。

## 9. 系统状态同步
- 插件启动时：
  - 读取 `queue_state.json` 并重建队列视图。
  - 重放 TaskHistory 最近 20 条以供参考。
  - 若在 `data/snapshots/` 发现未消费的 `.bak`，弹窗提示用户是否恢复。
- 插件关闭时：
  - 将当前 UI 状态（展开面板、选中任务）写入 `ui_state.json` 以便下次恢复。

## 10. 评估指标（供 UX 验证）
- 平均任务调度操作次数 ≤ 2 次/任务。
- 用户在 5 分钟内独立完成一次节点从概念到 Evergreen 的流程。
- 去重结果的撤销率 < 5%，验证合并策略可靠。
