# Cognitive Razor 功能正确性检查与性能评测报告（2026-02-18）

## 1. 目标与范围

- 目标：对插件进行功能正确性检查与性能评测，形成可复现结论。
- 范围：`main.ts`、`src/**`、运行时命令与工作台视图、构建与单测链路。
- 本次未执行：会触发外部 AI Provider 实际请求的完整在线流水线（Define/Tag/Write/Amend/Merge/Verify/Image 远程阶段）。
- 未执行原因：当前配置存在非空 Provider 凭据与生产 Base URL，按项目危险操作规则，发送外部请求前需用户明确确认。

## 2. 测试环境

- 时间：2026-02-18
- 平台：Windows + PowerShell
- Obsidian：`1.12.1 (installer 1.10.6)`
- Node.js：`v24.12.0`
- npm：`11.6.2`
- 仓库状态：存在大量未提交改动（脏工作区），本次评测未回滚任何现有改动

## 3. 执行方法

### 3.1 自动化正确性检查

- `npm run build`
- `npm run test`
- `npm run test:coverage`

### 3.2 运行时正确性检查（obsidian-cli）

- 插件重载：`obsidian plugin:reload id=obsidian-cognitive-razor`
- 错误检查：`obsidian dev:errors`
- 插件加载态：`obsidian eval code="app.plugins.plugins['obsidian-cognitive-razor'] ? 'loaded' : 'not loaded'" | Out-String`
- 组件可达性：`getComponents()` 组件清单
- 命令可执行性：执行 10 个不触发外部 API 的命令并记录返回码
- 工作台渲染验证：`app.workspace.getLeavesOfType('cr-workbench')` 与 `.cr-workbench-root`

### 3.3 性能评测

- 工程链路耗时：build/test/reload
- 运行时命令耗时：`open-workbench`、`pause-queue`、`resume-queue`
- 数据层微基准：`taskQueue.getStatus`、`duplicateManager.getPendingPairs`、`vectorIndex.getStats`
- 文件 I/O 微基准：`vault.cachedRead`、`vault.modify`（测试文件 `__test_functional_eval.md`）
- 内存观测：`performance.memory.usedJSHeapSize`

## 4. 功能正确性结果

### 4.1 自动化结果

| 检查项 | 结果 | 关键信息 |
|---|---|---|
| `npm run build` | 通过 | 退出码 `0`，耗时 `2518ms`，存在 `40` 条 Svelte warning |
| `npm run test` | 通过 | `10` 个测试文件、`103` 个测试全部通过，退出码 `0` |
| `npm run test:coverage` | 失败 | 缺失依赖：`@vitest/coverage-v8`，退出码 `1` |

### 4.2 运行时结果

- 插件重载成功，`RELOAD_TO_LOADED_MS=312ms`。
- `dev:errors` 全流程多次检查均为 `No errors captured`。
- 插件状态为 `loaded`，`getComponents()` 返回 `22` 个核心组件。
- 命令注册共 `13` 个，全部可枚举。
- 已执行的 10 个命令（Create/Improve/Expand/InsertImage/OpenWorkbench/Merge/ViewDuplicates/ViewHistory/Pause/Resume）均 `EXIT=0`。
- 工作台视图可正常打开：`cr-workbench` 叶子数 `1`，`.cr-workbench-root` 数量 `1`。

### 4.3 覆盖矩阵（功能维度）

| 功能 | 结论 | 证据 |
|---|---|---|
| 构建可用性 | 通过 | `npm run build` 成功 |
| 单元测试回归 | 通过 | `103/103` 通过 |
| 插件加载与注册 | 通过 | `loaded` + `22` 组件 + `13` 命令 |
| 工作台入口与基础命令 | 通过 | 10 个命令执行成功，且无 runtime error |
| 队列基础控制（暂停/恢复） | 通过 | 命令执行成功，`taskQueue.getStatus()` 状态一致 |
| 向量索引/去重只读能力 | 通过 | `vectorIndex.getStats()`、`getPendingPairs()` 正常 |
| 在线 AI 流水线端到端 | 未覆盖 | 涉及外部请求，按危险操作规则未执行 |

### 4.4 发现的问题与风险

1. 覆盖率脚本不可用（阻断覆盖率评估）
   - 现象：`npm run test:coverage` 报错缺失 `@vitest/coverage-v8`。
2. 构建告警较多（40 条）
   - 类型集中在 Svelte 响应式警告与 A11y 警告，属于潜在质量风险。
3. 核心编排器缺少对应单测文件
   - `src/core/create-orchestrator.ts`
   - `src/core/amend-orchestrator.ts`
   - `src/core/merge-orchestrator.ts`
   - `src/core/verify-orchestrator.ts`
   - `src/core/expand-orchestrator.ts`
   - `src/core/image-insert-orchestrator.ts`
4. 运行时历史中存在 1 个失败任务（历史遗留）
   - `taskQueue.getStatus()` 显示 `failed=1`，任务类型为 `amend`。

## 5. 性能评测结果

### 5.1 工程链路

| 指标 | 实测值 |
|---|---|
| Build 总耗时 | `2518ms` |
| Test 总耗时 | `1277ms`（Vitest 内部 `766ms`） |
| Reload 到 loaded | `312ms` |

### 5.2 命令与运行时响应

| 指标 | 实测值 |
|---|---|
| `obsidian eval` 调用开销（5 次） | 平均 `288.2ms`，P95 `295ms` |
| CLI `open-workbench`（5 次） | 平均 `8.6ms`，P95 `9ms` |
| 应用内首开 `open-workbench` | `4.6ms`（close 后首次打开） |
| 应用内重复执行 `open-workbench`（30 次） | 平均 `0.023ms`，P95 `0.10ms` |
| 应用内 `pause-queue` / `resume-queue` | `1.8ms` / `1.5ms` |

说明：CLI 耗时包含命令行桥接成本；应用内指标更接近插件自身执行时间。

### 5.3 数据层微基准（应用内 50,000 次）

| 操作 | 总耗时 | 平均耗时 |
|---|---|---|
| `taskQueue.getStatus()` | `1.70ms` | `0.000034ms` |
| `duplicateManager.getPendingPairs()` | `1.20ms` | `0.000024ms` |
| `vectorIndex.getStats()` | `7.90ms` | `0.000158ms` |
| `workspace.getLeavesOfType()` | `19.40ms` | `0.000388ms` |

### 5.4 文件 I/O 微基准（20 次）

| 操作 | 平均耗时 | P95 | 最大值 |
|---|---|---|---|
| `vault.cachedRead` | `0.03ms` | `0.20ms` | `0.20ms` |
| `vault.modify` | `4.97ms` | `7.90ms` | `7.90ms` |

### 5.5 内存观测

- 基线 `usedJSHeapSize` 约 `43.46MB`。
- 关闭并重开工作台、暂停/恢复队列后，观测到的瞬时增量约 `0MB`（在当前采样精度下未见明显增长）。

## 6. 综合结论

- 在“本地离线路径 + 非外部 API 命令”范围内，插件功能正确性表现良好：构建通过、单测全绿、运行时无错误、工作台和队列命令可用。
- 性能方面，核心同步接口与常用命令响应速度快，未发现明显卡顿点；`reload->loaded` 约 `312ms`，处于可接受区间。
- 当前质量短板是“覆盖率链路中断 + 构建警告较多 + 在线流水线未完成端到端验证”。

## 7. 建议（按优先级）

1. 修复覆盖率链路：安装并锁定 `@vitest/coverage-v8`，使 `npm run test:coverage` 可用。
2. 清理 Svelte warning：优先处理 A11y 与响应式告警，降低潜在回归风险。
3. 为 6 个编排器补充单测，覆盖成功路径、失败路径、队列交互与锁冲突场景。
4. 若需“完整在线 E2E 验证”，请先明确授权执行外部 Provider 请求，再对 Define/Tag/Write/Amend/Merge/Verify/Image 全链路压测与正确性验证。

