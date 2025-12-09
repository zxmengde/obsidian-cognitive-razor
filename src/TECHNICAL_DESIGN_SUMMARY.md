# Cognitive Razor - 技术设计文档总结

**版本**: 0.9.3 | **完整文档**: `docs/TECHNICAL_DESIGN_DOCUMENT.md`

---

## 文档-代码同步守则
- 文档行号 = 实际实现行号；修改代码必须同步更新对应章节与索引。
- 所有写入前须有快照，所有写入须走原子写入（见详细文档 5/8/11 节）。

---

## 关键架构速览
- 分层：UI(`ui/*`) → 应用(`core/*`) → 数据(`data/*`) 单向依赖。
- 核心路径：`PipelineOrchestrator` 调用 `TaskQueue` → `TaskRunner` → `ProviderManager/PromptManager/Validator/VectorIndex/FileStorage`。
- 数据存储：`data/queue-state.json`、`vector-index.json`、`duplicate-pairs.json`、`snapshots/*.json`、`app.log`。

---

## 高危逻辑锚点（按严重性排序）
1) **写入安全**  
   - 快照：`src/core/undo-manager.ts:152-243`；未创建快照不可写入。  
   - 原子写：`src/data/file-storage.ts:271-370` 或 `core/pipeline-orchestrator.ts:1837-1857`(Vault 写入)。
2) **管线确认点**  
   - 创建：`confirmCreate` → Stub 写入 → reason:new → `confirmWrite`（`src/core/pipeline-orchestrator.ts:1100-1336`）。  
   - 增量/合并：`confirmWrite` 路径同上，删除/索引同步见 `719-787`。
3) **调度与锁**  
   - 入队冲突检测+锁：`src/core/task-queue.ts:140-199`; 调度并发控制：`534-652`; 重试：`758-857`。
4) **Provider 能力/网络**  
   - 能力校验：`src/core/task-runner.ts:1367-1439`; 可用性缓存：`src/core/provider-manager.ts:311-396`。

---

## 流程速览
- **创建**：标准化(414-508) → enrich/embedding → 用户确认创建(1100-1166) → reason:new(859-941) → (ground 可选 1715-1748) → 写入确认(1296-1336)。
- **增量**：`startIncrementalPipeline`(929-999) → `reason:incremental`(949-1028) → 可选 ground → `confirmWrite`(1296-1336)。
- **合并**：`startMergePipeline`(1006-1089) → `reason:merge`(1038-1141) → 可选 ground → `confirmMergeWrite`(719-787)。

---

## 快速索引
| 需求 | 路径 |
|------|------|
| 调度/锁 | `src/core/task-queue.ts:85-1156` |
| 任务执行 | `src/core/task-runner.ts:169-1460` |
| 管线编排 | `src/core/pipeline-orchestrator.ts:336-2073` |
| 向量/去重 | `src/core/vector-index.ts:116-330`, `src/core/duplicate-manager.ts:111-200` |
| 快照 | `src/core/undo-manager.ts:152-243` |
| 设置校验 | `src/data/settings-store.ts:103-361,407-735` |

---

维护步骤：修改功能→更新文档对应章节/行号→确认代码索引覆盖关键函数。
